export default {
  id: "opencode",
  priority: 40,
  hasFree: true,
  alias: "oc",
  uiAlias: "oc",
  display: {
    name: "OpenCode Free",
    icon: "terminal",
    color: "#E87040",
    textIcon: "OC",
  },
  category: "free",
  noAuth: true,
  transport: {
    baseUrl: "https://opencode.ai",
    headers: {
      "x-opencode-client": "desktop",
    },
    noAuth: true,
    // The free tier refuses a non-streaming upstream body with 403, so every
    // request is served as SSE and converted back for clients that asked for JSON.
    forceStream: true,
  },
  models: [
    // Muse Spark models are served by /zen/v1/responses; the rest stay on
    // /chat/completions, so the format is declared per-model, not per-provider.
    // Verified live against opencode.ai (2026-09-10): all ids below return 200.
    { id: "muse-spark-1.2-contributor-free", name: "Muse Spark 1.2 Contributor Free", targetFormat: "openai-responses" },
    { id: "muse-spark-1.3-contributor-free", name: "Muse Spark 1.3 Contributor Free", targetFormat: "openai-responses" },
    { id: "mimo-v2.5-free", name: "MiMo V2.5 Free" },
    { id: "ling-3.0-flash-fin-free", name: "Ling 3.0 Flash Fin Free" },
    { id: "nemotron-3.5-lightning-free", name: "Nemotron 3.5 Lightning Free" },
    { id: "big-pickle", name: "Big Pickle", isFree: true },
    // Union Alpha Free is served by the Anthropic /zen/v1/messages endpoint and
    // answers HTTP 500 on /chat/completions — the format is what selects it.
    // Live check (2026-09-17): 200 with the anonymous tier headers, cost 0.
    { id: "union-alpha", name: "Union Alpha Free", isFree: true, targetFormat: "claude" },
  ],
  modelsFetcher: { url: "https://opencode.ai/zen/v1/models", type: "opencode-free" },
  passthroughModels: true,
};
