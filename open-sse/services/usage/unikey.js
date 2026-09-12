/**
 * UniKey (getunikey.ai) usage — a New-API relay that bills in CREDITS.
 *
 * Units (verified empirically, not assumed): 1 credit = 0.01 USD. The account
 * dashboard showed 24h usage of 6.58 credits while /v1/dashboard/billing/usage
 * reported total_usage 0.0658 — a clean 100x — and its own runway figure agrees
 * (4993.42 / 6.58 = 758.9 ~= the ~758 days displayed).
 *
 * Reading the balance. The API key cannot call /api/user/self (the endpoint that
 * carries the remaining balance) — every variant tried (Bearer, session cookie,
 * New-Api-User, x-api-key, raw token, /api/token/) answers "Unauthorized, invalid
 * access token", because that surface wants a dashboard session.
 *
 * But the balance does not have to come from there. The relay PRE-CHARGES against
 * the balance before a request completes, and when the hold exceeds what is left it
 * rejects the call with a message naming the exact remaining amount:
 *
 *   预扣费额度失败, 用户剩余额度: Credits156.360000, 需要预扣费额度: Credits2500.000000
 *   ("pre-charge failed, user remaining quota: Credits 156.36, required: Credits 2500")
 *
 * That number is exact and free — the request is refused, so nothing is billed.
 * Cross-checked against the account's own grant: 5000 - 4843.64 spent = 156.36,
 * matching the quoted figure to the cent.
 *
 * So Remaining is derived deterministically WITHOUT a configured total:
 *   spent   = /v1/dashboard/billing/usage total_usage x 100
 *   remaining = totalGrant - spent
 * where totalGrant comes from the connection's optional `unikeyTotalCredits`
 * field (defaulting to UniKey's standard 5000 free credits, which the plan's
 * advertised grant makes the common case).
 *
 * Balance probing (the deliberate pre-charge rejection) is OFF unless the
 * connection opts in through `unikeyProbeBalance`, because it costs a request:
 * by default Remaining is computed arithmetically from the grant minus spend,
 * which needs no extra call at all. The probe exists only to reconcile when the
 * arithmetic and reality are suspected to disagree (e.g. a bonus top-up that was
 * not reflected in the configured grant).
 */

import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { toFiniteNumber } from "./shared.js";

const BILLING_BASE = "https://www.getunikey.ai/v1/dashboard/billing";
const USAGE_URL = `${BILLING_BASE}/usage`;
const SUBSCRIPTION_URL = `${BILLING_BASE}/subscription`;
const CHAT_URL = "https://www.getunikey.ai/v1/chat/completions";

const PROVIDER_LABEL = "UniKey";

// /v1/dashboard/billing/usage reports USD; the dashboard displays credits at 100x.
const CREDITS_PER_USD = 100;

// UniKey's standard free grant. Used when the connection does not override it.
const DEFAULT_TOTAL_CREDITS = 5000;

// Optional per-connection overrides on providerSpecificData.
const TOTAL_CREDITS_FIELD = "unikeyTotalCredits";
const PROBE_BALANCE_FIELD = "unikeyProbeBalance";

// The pre-charge rejection quotes the remaining balance. Both the Chinese original
// and a plain-English variant are accepted so a locale change cannot silently break
// the read; `max_tokens` is set high enough that the hold always exceeds a small
// balance, guaranteeing the rejection we are reading from.
const REMAINING_PATTERNS = [
  /remaining quota:\s*Credits?\s*([0-9]+(?:\.[0-9]+)?)/i,
  /用户剩余额度:\s*Credits?\s*([0-9]+(?:\.[0-9]+)?)/,
];
const PROBE_MODEL = "gpt-6-astra";
const PROBE_MAX_TOKENS = 100000;

function parseUsage(data) {
  if (!data || typeof data !== "object") return null;
  const total = toFiniteNumber(data.total_usage ?? data.totalUsage, NaN);
  if (Number.isNaN(total)) return null;
  return { spentUsd: Math.max(0, total), spentCredits: Math.max(0, total) * CREDITS_PER_USD };
}

function parseSubscription(data) {
  if (!data || typeof data !== "object") return null;
  const hardLimit = toFiniteNumber(data.hard_limit_usd ?? data.hardLimitUsd, NaN);
  const softLimit = toFiniteNumber(data.soft_limit_usd ?? data.softLimitUsd, NaN);
  const systemHardLimit = toFiniteNumber(
    data.system_hard_limit_usd ?? data.systemHardLimitUsd,
    NaN,
  );
  const limit = [hardLimit, softLimit, systemHardLimit].find((v) => !Number.isNaN(v) && v > 0);
  return {
    limitUsd: limit ?? null,
    hasPaymentMethod: data.has_payment_method === true || data.hasPaymentMethod === true,
  };
}

/**
 * Total credit grant for this connection, or UniKey's standard free grant.
 * Accepts a number or numeric string so it works whether it was written by a form
 * or straight to the DB.
 * @returns {number}
 */
export function parseConfiguredTotalCredits(providerSpecificData) {
  if (!providerSpecificData || typeof providerSpecificData !== "object") return DEFAULT_TOTAL_CREDITS;
  const raw = providerSpecificData[TOTAL_CREDITS_FIELD];
  if (raw === undefined || raw === null || raw === "") return DEFAULT_TOTAL_CREDITS;
  const value = toFiniteNumber(raw, NaN);
  if (Number.isNaN(value) || value <= 0) return DEFAULT_TOTAL_CREDITS;
  return value;
}

export function shouldProbeBalance(providerSpecificData) {
  return providerSpecificData?.[PROBE_BALANCE_FIELD] === true;
}

/**
 * Extract the remaining balance quoted by a pre-charge rejection.
 * @returns {number|null}
 */
export function parseRemainingFromError(message) {
  if (!message || typeof message !== "string") return null;
  for (const re of REMAINING_PATTERNS) {
    const m = message.match(re);
    if (m) {
      const value = toFiniteNumber(m[1], NaN);
      if (!Number.isNaN(value)) return value;
    }
  }
  return null;
}

/**
 * Read the exact remaining balance by provoking a pre-charge rejection. The request
 * is refused before any generation happens, so it costs nothing (verified: the
 * quoted figure matched grant-minus-spend exactly).
 * @returns {Promise<number|null>}
 */
async function probeRemainingCredits(apiKey, proxyOptions) {
  try {
    const res = await proxyAwareFetch(
      CHAT_URL,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          model: PROBE_MODEL,
          max_tokens: PROBE_MAX_TOKENS,
          messages: [{ role: "user", content: "hi" }],
        }),
      },
      proxyOptions,
    );
    const text = await res.text().catch(() => "");
    let message = text;
    try {
      message = JSON.parse(text)?.error?.message || text;
    } catch {
      /* non-JSON body is fine — the pattern is matched against the raw text */
    }
    return parseRemainingFromError(message);
  } catch {
    return null;
  }
}

/**
 * @param {string|null|undefined} apiKey
 * @param {object|null} providerSpecificData
 * @param {object|null} proxyOptions
 */
export async function getUnikeyUsage(apiKey = null, providerSpecificData = null, proxyOptions = null) {
  if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
    return { message: `${PROVIDER_LABEL} API key not available. Add a key to view usage.` };
  }

  const key = apiKey.trim();
  const headers = { Authorization: `Bearer ${key}`, Accept: "application/json" };

  try {
    const [usageRes, subRes] = await Promise.all([
      proxyAwareFetch(USAGE_URL, { method: "GET", headers }, proxyOptions),
      proxyAwareFetch(SUBSCRIPTION_URL, { method: "GET", headers }, proxyOptions),
    ]);

    if (usageRes.status === 401 || usageRes.status === 403) {
      return {
        plan: PROVIDER_LABEL,
        message: `${PROVIDER_LABEL} authentication failed. Check the API key.`,
      };
    }

    const usage = usageRes.ok ? parseUsage(await usageRes.json().catch(() => null)) : null;
    const sub = subRes.ok ? parseSubscription(await subRes.json().catch(() => null)) : null;

    if (!usage && !sub) {
      return {
        plan: PROVIDER_LABEL,
        message: `${PROVIDER_LABEL} connected. No usage data returned.`,
      };
    }

    const totalCredits = parseConfiguredTotalCredits(providerSpecificData);
    const planLabel = sub?.hasPaymentMethod ? `${PROVIDER_LABEL} (paid)` : PROVIDER_LABEL;
    const quotas = {};
    let message;

    if (usage) {
      const spent = usage.spentCredits;

      // Arithmetic first — no extra request needed.
      let remaining = Math.max(0, totalCredits - spent);
      let balanceSource = "computed";

      // Only reconcile against the relay when the connection asks for it: the probe
      // is free of charge but still a round trip, and the arithmetic agrees with the
      // provider to the cent when the configured grant is current.
      if (shouldProbeBalance(providerSpecificData)) {
        const probed = await probeRemainingCredits(key, proxyOptions);
        if (probed !== null) {
          remaining = probed;
          balanceSource = "probed";
        }
      }

      quotas.Credits = {
        used: spent,
        total: totalCredits,
        remaining,
        remainingPercentage: Math.min(100, Math.max(0, (remaining / totalCredits) * 100)),
        resetAt: null,
        unlimited: false,
      };

      if (balanceSource === "computed") {
        message =
          `${PROVIDER_LABEL} balance is computed as ${totalCredits} grant - ${spent.toFixed(2)} spent. ` +
          `Set "${TOTAL_CREDITS_FIELD}" on this connection if your grant differs, or ` +
          `"${PROBE_BALANCE_FIELD}": true to read the exact figure from the relay instead.`;
      }
    }

    return { plan: planLabel, quotas, ...(message ? { message } : {}) };
  } catch (error) {
    return { message: `${PROVIDER_LABEL} error: ${error.message}` };
  }
}
