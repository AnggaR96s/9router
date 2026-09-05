export const ORCAROUTER_MODELS_URL = "https://www.orcarouter.ai/v1/models";
export const ORCAROUTER_CHAT_URL = "https://www.orcarouter.ai/v1/chat/completions";

export function parseOrcarouterModels(data) {
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

export async function fetchOrcarouterModels(apiKey, fetchFn = fetch) {
  const response = await fetchFn(ORCAROUTER_MODELS_URL, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
  });
  if (!response.ok) {
    return { error: `Failed to fetch models: ${response.status}`, status: response.status };
  }
  return { models: parseOrcarouterModels(await response.json()) };
}

// Chat probe validates the API key (models endpoint may return 200 without key).
// Only 401/403 mean the key is bad; 400/402/429 all prove auth passed.
export async function probeOrcarouterChat(apiKey, fetchFn = fetch) {
  if (!apiKey) return { valid: false, error: "No valid API key found" };
  try {
    const response = await fetchFn(ORCAROUTER_CHAT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "orcarouter/free",
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