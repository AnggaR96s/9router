export const TOKENHARBOR_MODELS_URL = "https://tokenharbor.ai/v1/models";

export function parseTokenharborModels(data) {
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

export async function fetchTokenharborModels(apiKey, fetchFn = fetch) {
  if (!apiKey) return { error: "No valid API key found", status: 401 };

  const response = await fetchFn(TOKENHARBOR_MODELS_URL, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (!response.ok) {
    return { error: `Failed to fetch models: ${response.status}`, status: response.status };
  }

  const models = parseTokenharborModels(await response.json());
  return { models };
}