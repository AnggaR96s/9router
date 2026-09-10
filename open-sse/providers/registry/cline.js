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
  authModes: ["oauth"],
  hasOAuth: true,
  transport: {
    baseUrl: "https://api.cline.bot/api/v1/chat/completions",
    headers: {
      "HTTP-Referer": "https://cline.bot",
      "X-Title": "Cline",
    },
    // Non-stream chat completions come back wrapped in {"success":true,"data":{...}}
    quirks: { clineEnvelope: true },
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
    { id: "cline-free/muse-spark-1.3-contributor", name: "Muse Spark 1.3 Contributor (Free)" },
    { id: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash (Free)" },
    { id: "z-ai/glm-5.3-flash", name: "GLM 5.3 Flash (Free)" },
    { id: "cline-free/solar-pro4", name: "Solar Pro 4 (Free)" },
    { id: "cline-free/longcat-2.0", name: "LongCat 2.0 (Free)" },
    { id: "poolside/laguna-s-2.1:free", name: "Poolside Laguna S 2.1 (Free)" },
    // Recommended paid (source: same feed → recommended[])
    { id: "anthropic/claude-opus-5", name: "Claude Opus 5" },
    { id: "anthropic/claude-sonnet-5", name: "Claude Sonnet 5" },
    { id: "openai/gpt-6-astra", name: "GPT-6 Astra" },
    { id: "x-ai/grok-4.5", name: "Grok 4.5" },
    { id: "moonshotai/kimi-k3", name: "Kimi K3" },
  ],
  oauth: {
    appBaseUrl: "https://app.cline.bot",
    apiBaseUrl: "https://api.cline.bot",
    authorizeUrl: "https://api.cline.bot/api/v1/auth/authorize",
    tokenExchangeUrl: "https://api.cline.bot/api/v1/auth/token",
    refreshUrl: "https://api.cline.bot/api/v1/auth/refresh",
  },
};
