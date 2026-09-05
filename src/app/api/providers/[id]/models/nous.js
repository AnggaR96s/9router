export const NOUS_MODELS_URL = "https://inference-api.nousresearch.com/v1/models";
export const NOUS_CHAT_URL = "https://inference-api.nousresearch.com/v1/chat/completions";

// The /v1/models catalog is public (no auth required); chat requires a Portal
// API key (sk-...) via Authorization: Bearer.
export function parseNousModels(data) {
  const raw = Array.isArray(data) ? data : data?.data || data?.models || [];
  return raw
    .filter((model) => model && typeof model === "object")
    .map((model) => ({
      id: model.id || model.name || model.model,
      name: model.name || model.id || model.model,
      ...(model.context_length ? { contextLength: model.context_length } : {}),
    }))
    .filter((model) => typeof model.id === "string" && model.id.trim());
}

export async function fetchNousModels(apiKey, fetchFn = fetch) {
  const response = await fetchFn(NOUS_MODELS_URL, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
  });
  if (!response.ok) {
    return { error: `Failed to fetch models: ${response.status}`, status: response.status };
  }
  return { models: parseNousModels(await response.json()) };
}

// Chat probe that actually validates the API key (unlike /models which is public).
// A valid key returns 200/400/402; only 401/403 mean the key is bad.
export async function probeNousChat(apiKey, fetchFn = fetch) {
  if (!apiKey) return { valid: false, error: "No valid API key found" };
  try {
    const response = await fetchFn(NOUS_CHAT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "inclusionai/ling-3.0-flash-sante:free",
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 1,
        stream: false,
      }),
    });
    const valid = response.status !== 401 && response.status !== 403;
    return valid
      ? { valid: true, error: null }
      : { valid: false, error: "Invalid API key" };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}