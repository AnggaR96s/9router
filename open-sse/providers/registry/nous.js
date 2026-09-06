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
      text: "Use an inference API key, or sign in with Nous Portal (Hermes CLI device flow).",
    },
  },
  category: "oauth",
  authType: "apikey",
  hasOAuth: true,
  authModes: ["oauth", "apikey"],
  transport: {
    baseUrl: "https://inference-api.nousresearch.com/v1/chat/completions",
    modelsUrl: "https://inference-api.nousresearch.com/v1/models",
    validateUrl: "https://inference-api.nousresearch.com/v1/models",
    thinkingFormat: "openai",
    // Hermes CLI traffic passes an OpenAI python-client fingerprint upstream.
    headers: {
      "User-Agent": "OpenAI/Python 2.24.0",
      "X-Stainless-Arch": "x64",
      "X-Stainless-Async": "false",
      "X-Stainless-Lang": "python",
      "X-Stainless-Os": "Linux",
      "X-Stainless-Package-Version": "2.24.0",
      "X-Stainless-Read-Timeout": "30.0",
      "X-Stainless-Retry-Count": "0",
      "X-Stainless-Runtime": "CPython",
      "X-Stainless-Runtime-Version": "3.11.15",
    },
  },
  // OAuth device flow against portal.nousresearch.com (Hermes CLI client).
  // NOTE: no `refresh` grant block — the refresh token is carried in the
  // X-Nous-Refresh-Token header (not the body), so refresh goes through the
  // dedicated refreshNousPortalToken handler, not the generic REFRESH_GRANTS path.
  oauth: {
    clientId: "hermes-cli",
    deviceCodeUrl: "https://portal.nousresearch.com/api/oauth/device/code",
    tokenUrl: "https://portal.nousresearch.com/api/oauth/token",
    refreshUrl: "https://portal.nousresearch.com/api/oauth/token",
    scope: "inference:invoke",
    userInfoUrl: "https://portal.nousresearch.com/api/oauth/account",
  },
  models: [],
  modelsFetcher: { url: "https://inference-api.nousresearch.com/v1/models", type: "openai" },
  passthroughModels: true,
};