import crypto from "crypto";
import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { OPENCODE_USER_AGENT } from "../config/runtimeConfig.js";
import { getThinkingLevels } from "../providers/thinkingLevels.js";
import { injectReasoningContent } from "../utils/reasoningContentInjector.js";
import { resolveSessionId } from "../utils/sessionManager.js";
import { createZenSessionId, isClientZenSession } from "../utils/zenSession.js";
import { isMuseSparkModel, isOpenCodeMessagesModel } from "../providers/models/helpers.js";

// The free tier only accepts a versioned client UA; a bare "opencode" — which some
// downstreams send — is rejected, so only a real client version is forwarded. A
// version below the gate's floor is refused too, with a different status
// (426 UpgradeRequired on "opencode/1.0.0"), so it is replaced as well.
const CLIENT_UA_RE = /^opencode\/(\d+)\.(\d+)(?:\.|$)/i;
const MIN_CLIENT_UA_MAJOR = 1;
const MIN_CLIENT_UA_MINOR = 17;

function isSupportedClientUa(ua) {
  const m = String(ua || "").match(CLIENT_UA_RE);
  if (!m) return false;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  if (major !== MIN_CLIENT_UA_MAJOR) return major > MIN_CLIENT_UA_MAJOR;
  return minor >= MIN_CLIENT_UA_MINOR;
}
// Models served by /zen/v1/responses; every other model stays on /chat/completions.
const RESPONSES_MODELS = new Set([
  "muse-spark-1.2-contributor-free",
  "muse-spark-1.3-contributor-free",
]);
// The tier fingerprints the official agentic client's file-search tools: a request
// with matching headers and session but none of these still answers 403.
const FINGERPRINT_TOOLS = ["bash", "glob", "grep", "read"];

function generateRequestId() {
  return `msg_${crypto.randomUUID().replace(/-/g, "")}`;
}

function generateSessionId() {
  return `ses_${crypto.randomUUID().replace(/-/g, "")}`;
}

// Strip the thinking suffix "model(level)" so registry lookups hit the base id.
function baseModelId(model) {
  return String(model || "").replace(/\([^()]+\)\s*$/, "").trim();
}

function isResponsesModel(model) {
  const base = baseModelId(model);
  return RESPONSES_MODELS.has(base) || isMuseSparkModel(base);
}

// Union Alpha Free is only served on the Anthropic endpoint; the catalog lists
// it beside the Chat Completions ids, so the base URL cannot decide this.
function isMessagesModel(model) {
  return isOpenCodeMessagesModel(baseModelId(model));
}

function declaredToolName(tool) {
  if (!tool || typeof tool !== "object") return "";
  const nested = tool.function?.name;
  if (typeof nested === "string") return nested.trim();
  return typeof tool.name === "string" ? tool.name.trim() : "";
}

/**
 * Merge the file-search quartet into the caller's tools and make the upstream body
 * stream. Both are fingerprint axes of the anonymous tier: three or fewer quartet
 * tools, or stream:false, answer 403 however well the headers match. Tools the caller
 * declared itself are kept untouched — only the missing names are appended.
 *
 * `flat` picks the declaration shape: the Responses endpoint takes the name at the
 * top level while chat/completions nests it under `function`. The wrong shape is a
 * 400 invalid_request_error, not a gate error, so the endpoint decides, not the input.
 */
function applyFreeTierFingerprint(body, flat) {
  const tools = Array.isArray(body.tools) ? [...body.tools] : [];
  const present = new Set(tools.map(declaredToolName).filter(Boolean));
  for (const name of FINGERPRINT_TOOLS) {
    if (present.has(name)) continue;
    const declaration = {
      name,
      description: `OpenCode built-in ${name} tool`,
      parameters: { type: "object", properties: {} },
    };
    tools.push(flat ? { type: "function", ...declaration } : { type: "function", function: declaration });
    present.add(name);
  }
  body.tools = tools;
  body.stream = true;
}

function resolveOpencodeSession(body, credentials) {
  const headers = credentials?.rawHeaders || {};
  return resolveSessionId({
    headers,
    body,
    connectionId: credentials?.connectionId,
    scope: "opencode",
    generate: generateSessionId,
  });
}

/**
 * Session id for the anonymous tier. A client-shaped id is forwarded untouched;
 * otherwise, when a client-issued prefix is configured, the gateway's own session
 * is re-shaped onto it (the prefix is what the tier checks, the tail is free).
 */
function zenSessionHeader(lower, currentSessionId) {
  const downstream = lower["x-opencode-session"];
  if (isClientZenSession(downstream)) return String(downstream).trim();
  return createZenSessionId(currentSessionId || downstream || null);
}

function normalizeOpencodeReasoning(model, body) {
  const current = body.reasoning;
  const currentReasoning = current && typeof current === "object" && !Array.isArray(current)
    ? current
    : null;
  const requestedEffort = typeof body.reasoning_effort === "string"
    ? body.reasoning_effort
    : currentReasoning?.effort;
  if (typeof requestedEffort !== "string") return;

  const cleanModel = baseModelId(model || body.model);
  const supportedLevels = getThinkingLevels("opencode", cleanModel);
  let effort = requestedEffort.toLowerCase().trim();
  if ((effort === "max" || effort === "ultra") && supportedLevels?.length && !supportedLevels.includes(effort)) {
    if (effort === "ultra" && supportedLevels.includes("max")) effort = "max";
    else if (supportedLevels.includes("xhigh")) effort = "xhigh";
  }

  body.reasoning = { ...currentReasoning, effort };
  if (!body.reasoning.summary) body.reasoning.summary = "auto";
  delete body.reasoning_effort;
}

export class OpenCodeExecutor extends BaseExecutor {
  constructor() {
    super("opencode", PROVIDERS.opencode);
    this._currentSessionId = null;
  }

  transformRequest(model, body, stream, credentials) {
    this._currentSessionId = resolveOpencodeSession(body, credentials);
    if (isResponsesModel(model)) {
      // Responses API names the output cap max_output_tokens and takes thinking
      // as reasoning:{effort,summary} — normalize the Chat fields at this boundary.
      if (body.max_output_tokens === undefined) {
        if (body.max_completion_tokens !== undefined) body.max_output_tokens = body.max_completion_tokens;
        else if (body.max_tokens !== undefined) body.max_output_tokens = body.max_tokens;
      }
      delete body.max_tokens;
      delete body.max_completion_tokens;
      normalizeOpencodeReasoning(model, body);
    }
    // Union Alpha is served by the Anthropic endpoint, which the gate does not
    // fingerprint and which cannot carry OpenAI-shaped tool declarations.
    if (!isMessagesModel(model)) applyFreeTierFingerprint(body, isResponsesModel(model));
    return injectReasoningContent({ provider: this.provider, model, body });
  }

  buildUrl(model) {
    const base = this.config.baseUrl;
    if (isMessagesModel(model)) return `${base}/zen/v1/messages`;
    return isResponsesModel(model)
      ? `${base}/zen/v1/responses`
      : `${base}/zen/v1/chat/completions`;
  }

  buildHeaders(credentials, stream = true) {
    const raw = credentials?.rawHeaders || {};
    const lower = {};
    for (const [k, v] of Object.entries(raw)) lower[k.toLowerCase()] = v;

    const downstreamUa = String(lower["user-agent"] || "").trim();
    const isClientUa = isSupportedClientUa(downstreamUa);

    return {
      "Content-Type": "application/json",
      "Authorization": "Bearer public",
      "User-Agent": isClientUa ? downstreamUa : OPENCODE_USER_AGENT,
      "x-opencode-client": lower["x-opencode-client"] || "desktop",
      "x-opencode-session": zenSessionHeader(lower, this._currentSessionId),
      "x-opencode-request": lower["x-opencode-request"] || generateRequestId(),
      "x-opencode-project": lower["x-opencode-project"] || "global",
      "Accept": stream ? "text/event-stream" : "*/*",
    };
  }
}
