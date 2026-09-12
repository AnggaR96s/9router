export default {
  id: "unikey",
  alias: "unikey",
  uiAlias: "unikey",
  display: {
    name: "UniKey",
    icon: "key",
    color: "#6C5CE7",
    textIcon: "UK",
    website: "https://www.getunikey.ai",
    notice: {
      apiKeyUrl: "https://www.getunikey.ai/console/token",
    },
  },
  category: "apikey",
  authType: "apikey",
  authModes: ["apikey"],
  transport: {
    baseUrl: "https://www.getunikey.ai/v1/chat/completions",
    modelsUrl: "https://www.getunikey.ai/v1/models",
    validateUrl: "https://www.getunikey.ai/v1/models",
    thinkingFormat: "openai",
  },
  models: [],
  modelsFetcher: { url: "https://www.getunikey.ai/v1/models", type: "openai" },
  passthroughModels: true,
  features: {
    usage: true,
    usageApikey: true,
  },
};
