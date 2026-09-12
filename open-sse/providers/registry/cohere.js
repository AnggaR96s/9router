export default {
  id: "cohere",
  priority: 90,
  alias: "cohere",
  display: {
    name: "Cohere",
    icon: "hub",
    color: "#39594D",
    textIcon: "CO",
    website: "https://cohere.com",
    notice: {
      apiKeyUrl: "https://dashboard.cohere.com/api-keys",
    },
  },
  category: "apikey",
  transport: {
    // Cohere has no /v1/chat/completions — that path returns 405 (confirmed
    // with and without a key, so it is not an auth problem). The OpenAI-shaped
    // surface lives on the Compatibility API, which is what the OpenAI SDK
    // points at (docs.cohere.com/docs/compatibility-api). Keeping the URL
    // OpenAI-shaped means DefaultExecutor needs no translator.
    //
    // The Compatibility API does NOT support Cohere-native extras (documents,
    // citation_options, connectors) — those exist only on /v2/chat. Do not add
    // `documents` to a request here expecting citations.
    baseUrl: "https://api.cohere.ai/compatibility/v1/chat/completions",
    // /v1/models still answers 200 on this key; the compatibility host exposes
    // no model list, so validate stays on the native host.
    validateUrl: "https://api.cohere.ai/v1/models",
  },
  models: [
    { id: "command-a-plus-05-2026", name: "Command A Plus (May 2026)" },
    { id: "command-a-03-2025", name: "Command A (Mar 2025)" },
    { id: "command-a-reasoning-08-2025", name: "Command A Reasoning (Aug 2025)" },
    { id: "command-a-vision-07-2025", name: "Command A Vision (Jul 2025)" },
    { id: "command-a-translate-08-2025", name: "Command A Translate (Aug 2025)" },
    { id: "command-r-plus-08-2024", name: "Command R+ (Aug 2024)" },
    { id: "command-r-08-2024", name: "Command R (Aug 2024)" },
  ],
};
