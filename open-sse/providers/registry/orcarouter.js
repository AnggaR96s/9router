export default {
  id: "orcarouter",
  alias: "orcarouter",
  uiAlias: "orcarouter",
  display: {
    name: "OrcaRouter",
    icon: "router",
    color: "#1B2A4A",
    textIcon: "OR",
    website: "https://www.orcarouter.ai",
    notice: {
      apiKeyUrl: "https://www.orcarouter.ai/console",
    },
  },
  category: "apikey",
  authType: "apikey",
  authModes: ["apikey"],
  transport: {
    baseUrl: "https://www.orcarouter.ai/v1/chat/completions",
    modelsUrl: "https://www.orcarouter.ai/v1/models",
    validateUrl: "https://www.orcarouter.ai/v1/models",
    thinkingFormat: "openai",
  },
  models: [],
  modelsFetcher: { url: "https://www.orcarouter.ai/v1/models", type: "openai" },
  passthroughModels: true,
};