/**
 * Atria live model catalog.
 *
 * /v1/models is fully auth-gated (401 without a key), so the catalog is fetched
 * per connection with that connection's key, never publicly.
 */

const ATRIA_MODELS_URL = "https://api.atria-asi.ai/v1/models";

export function parseAtriaModels(data) {
  const raw = Array.isArray(data) ? data : data?.data || data?.models || [];
  return raw
    .filter((model) => model && typeof model === "object")
    .map((model) => ({
      id: model.id,
      name: model.name || model.id,
    }))
    .filter((model) => typeof model.id === "string" && model.id.trim());
}

export async function fetchAtriaModels(connection, fetchFn = fetch) {
  const apiKey = connection?.apiKey;
  if (!apiKey) return { error: "No valid API key found", status: 401 };

  const response = await fetchFn(ATRIA_MODELS_URL, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;
    try {
      const body = await response.json();
      message = body?.error?.message || body?.error || message;
    } catch {
      // non-JSON error body — keep the generic status message
    }
    return { error: message, status: response.status };
  }

  const models = parseAtriaModels(await response.json());
  return { models };
}
