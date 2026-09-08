export default {
  id: "apinex",
  alias: "apinex",
  uiAlias: "apinex",
  display: {
    name: "APInex",
    icon: "bolt",
    color: "#D9A441",
    textIcon: "AX",
    website: "https://apinex.bond",
    notice: {
      apiKeyUrl: "https://apinex.bond/keys",
    },
  },
  category: "apikey",
  authType: "apikey",
  authModes: ["apikey"],
  transport: {
    baseUrl: "https://api.apinex.bond/v1/chat/completions",
    modelsUrl: "https://api.apinex.bond/v1/models",
    validateUrl: "https://api.apinex.bond/v1/models",
    thinkingFormat: "openai",
  },
  models: [],
  modelsFetcher: { url: "https://api.apinex.bond/v1/models", type: "openai" },
  passthroughModels: true,
  features: {
    usage: true,
    usageApikey: true,
  },
};