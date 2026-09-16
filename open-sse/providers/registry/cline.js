export default {
  id: "cline",
  priority: 80,
  alias: "cl",
  uiAlias: "cl",
  display: {
    name: "Cline",
    icon: "smart_toy",
    color: "#5B9BD5",
    textIcon: "CL",
    website: "https://cline.bot",
    notice: {
      signupUrl: "https://cline.bot",
    },
  },
  category: "oauth",
  // Cline takes both: the OAuth token minted by the extension flow, and a plain API
  // key from app.cline.bot/settings/api-keys. Both hit the same api.cline.bot/api/v1
  // endpoints (measured: GET /users/me 200 and POST /chat/completions 200 with a key),
  // and the executor already prefers credential.apiKey over accessToken in the Cline
  // headers, so a key connection needs no extra plumbing. Same shape as codebuddy-cn.
  authModes: ["oauth", "apikey"],
  hasOAuth: true,
  transport: {
    baseUrl: "https://api.cline.bot/api/v1/chat/completions",
    headers: {
      "HTTP-Referer": "https://cline.bot",
      "X-Title": "Cline",
    },
    // Non-stream chat completions come back wrapped in {"success":true,"data":{...}}
    quirks: { clineEnvelope: true },
    // Credential check for both auth modes. GET /users/me answers 401 to a missing or
    // wrong credential (measured: key 200, no key and a bogus key both 401), so the
    // connection "Test" button and the add-a-key validation path get a real verdict
    // instead of "Provider test not supported". Must live in transport — PROVIDERS is
    // built from entry.transport alone, so a top-level field never reaches them.
    validateUrl: "https://api.cline.bot/api/v1/users/me",
    tokenUrl: "https://api.cline.bot/api/v1/auth/token",
    refreshUrl: "https://api.cline.bot/api/v1/auth/refresh",
    auth: {
      combined: true,
      header: "Authorization",
      scheme: "bearer",
      hooks: [
        "clineHeaders",
      ],
    },
  },
  models: [
    // Free tier (source: api.cline.bot/api/v1/ai/cline/recommended-models → free[])
    // Feed is live & public; these are the models a free Cline account can use.
    { id: "cline-free/deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash (Free)" },
    { id: "cline-free/muse-spark-1.3-contributor", name: "Muse Spark 1.3 Contributor (Free)" },
    { id: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash (Free)" },
    { id: "z-ai/glm-5.3-flash", name: "GLM 5.3 Flash (Free)" },
    { id: "cline-free/solar-pro4", name: "Solar Pro 4 (Free)" },
    { id: "cline-free/longcat-2.0", name: "LongCat 2.0 (Free)" },
    { id: "poolside/laguna-s-2.1:free", name: "Poolside Laguna S 2.1 (Free)" },
    // Paid models are not listed here: a free Cline connection cannot run them, and
    // the provider page's "Import Cline models" action adds any of them on demand.
  ],
  oauth: {
    appBaseUrl: "https://app.cline.bot",
    apiBaseUrl: "https://api.cline.bot",
    authorizeUrl: "https://api.cline.bot/api/v1/auth/authorize",
    tokenExchangeUrl: "https://api.cline.bot/api/v1/auth/token",
    refreshUrl: "https://api.cline.bot/api/v1/auth/refresh",
  },
};
