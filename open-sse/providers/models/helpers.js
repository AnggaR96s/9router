// Codex auto-generates a "-review" variant for each llm model (review quota family)
export const CODEX_REVIEW_SUFFIX = "-review";

export function withCodexReviewModels(models) {
  return models.flatMap((model) => {
    if ((model.kind || model.type || "llm") !== "llm" || model.id.endsWith(CODEX_REVIEW_SUFFIX)) {
      return [model];
    }
    return [
      model,
      {
        ...model,
        id: `${model.id}${CODEX_REVIEW_SUFFIX}`,
        name: `${model.name} Review`,
        upstreamModelId: model.upstreamModelId || model.id,
        quotaFamily: "review"
      }
    ];
  });
}

export function isMuseSparkModel(modelId) {
  if (!modelId || typeof modelId !== "string") return false;
  const clean = modelId.replace(/\([^()]+\)\s*$/, "").trim();
  const base = clean.includes("/") ? clean.split("/").pop() : clean;
  return /^muse[-_]?spark(?:$|[-_:.\s])/i.test(base);
}

// Union Alpha Free is listed in the same Zen catalog as the Chat Completions
// ids, but the upstream only serves it on the Anthropic /zen/v1/messages
// endpoint — sent to /chat/completions the same id answers HTTP 500, which
// reads like a dead model. Route by id, not by a per-provider base URL.
export const OPENCODE_MESSAGES_MODELS = new Set(["union-alpha"]);

export function isOpenCodeMessagesModel(modelId) {
  if (!modelId || typeof modelId !== "string") return false;
  const clean = modelId.replace(/\([^()]+\)\s*$/, "").trim();
  const base = clean.includes("/") ? clean.split("/").pop() : clean;
  return OPENCODE_MESSAGES_MODELS.has(base);
}

