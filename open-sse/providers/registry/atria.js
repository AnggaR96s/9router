export default {
  id: "atria",
  alias: "atria",
  uiAlias: "atria",
  display: {
    name: "Atria",
    icon: "atria",
    color: "#1F6FEB",
    textIcon: "AT",
    website: "https://atria-asi.ai",
    notice: {
      apiKeyUrl: "https://api.atria-asi.ai/console/keys",
    },
  },
  category: "apikey",
  authType: "apikey",
  authModes: ["apikey"],
  transport: {
    baseUrl: "https://api.atria-asi.ai/v1/chat/completions",
    modelsUrl: "https://api.atria-asi.ai/v1/models",
    validateUrl: "https://api.atria-asi.ai/v1/models",
    thinkingFormat: "openai",
  },
  models: [{ id: "Atria-Dawn-Preview", name: "Atria Dawn Preview" }],
  modelsFetcher: {
    url: "https://api.atria-asi.ai/v1/models",
    type: "openai",
  },
  passthroughModels: true,
};
