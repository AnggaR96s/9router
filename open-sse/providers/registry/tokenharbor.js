export default {
  id: "tokenharbor",
  alias: "tokenharbor",
  uiAlias: "tokenharbor",
  display: {
    name: "Token Harbor",
    icon: "ship",
    color: "#0D9488",
    textIcon: "TH",
    website: "https://tokenharbor.ai",
    notice: {
      apiKeyUrl: "https://tokenharbor.ai/dashboard/api-keys",
    },
  },
  category: "apikey",
  authType: "apikey",
  authModes: ["apikey"],
  transport: {
    baseUrl: "https://tokenharbor.ai/v1/chat/completions",
    modelsUrl: "https://tokenharbor.ai/v1/models",
    validateUrl: "https://tokenharbor.ai/v1/models",
    thinkingFormat: "openai",
  },
  models: [],
  modelsFetcher: { url: "https://tokenharbor.ai/v1/models", type: "openai" },
  passthroughModels: true,
};