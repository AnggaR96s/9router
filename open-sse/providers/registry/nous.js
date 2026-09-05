export default {
  id: "nous",
  alias: "nous",
  uiAlias: "nous",
  display: {
    name: "Nous Research",
    icon: "router",
    color: "#B8F135",
    textIcon: "NO",
    website: "https://nousresearch.com",
    notice: {
      apiKeyUrl: "https://portal.nousresearch.com",
    },
  },
  category: "apikey",
  authType: "apikey",
  authModes: ["apikey"],
  transport: {
    baseUrl: "https://inference-api.nousresearch.com/v1/chat/completions",
    modelsUrl: "https://inference-api.nousresearch.com/v1/models",
    validateUrl: "https://inference-api.nousresearch.com/v1/models",
    thinkingFormat: "openai",
  },
  models: [],
  modelsFetcher: { url: "https://inference-api.nousresearch.com/v1/models", type: "openai" },
  passthroughModels: true,
};