// OpenRouter TTS — via the dedicated /api/v1/audio/speech endpoint.
//
// This used to post to /chat/completions with `modalities: ["text","audio"]`. OpenRouter
// no longer accepts that for speech models — every one of them answers 400
// "<model> is a text-to-speech model and cannot be used with the chat/completions
// endpoint. Use the /api/v1/audio/speech endpoint instead." The models this adapter
// targeted are gone too (openai/tts-1 and openai/gpt-4o-mini-tts no longer exist), so the
// whole path returned nothing usable. /audio/speech also matches the OpenAI speech API,
// so the audio arrives as a plain byte stream instead of base64 inside an SSE delta.
import { PROVIDER_MEDIA } from "../../providers/index.js";
import { responseToBase64, throwUpstreamError, parseModelVoice } from "./_base.js";

const TTS_CFG = PROVIDER_MEDIA["openrouter"]?.ttsConfig || {};

// Voice ids are per-model and NOT interchangeable: flux-tts answers 400 "Unknown voice
// aura-2-thalia-en" if handed an Aura voice, and fish-audio rejects any voice it does not
// know. So there is no global default here — the model's own catalog supplies the
// fallback, and a model without a catalog sends no voice at all and takes the provider
// default. (When a provider genuinely requires a voice we have none for, its own message
// is passed through unchanged rather than guessed at.)

export default {
  async synthesize(text, model, credentials) {
    if (!credentials?.apiKey) throw new Error("No OpenRouter API key configured");

    // TTS_MODELS_CONFIG is the source of truth for this provider's models (the same list
    // the dashboard renders from). PROVIDER_MODELS has no openrouter TTS entry, so
    // reading it here yielded an empty list and every id fell through to the last-slash
    // split — which mis-parses ids like "deepgram/flux-tts:free".
    const { TTS_MODELS_CONFIG } = await import("../../config/ttsModels.js");
    const cfg = TTS_MODELS_CONFIG.openrouter || {};
    const knownModels = cfg.models || [];

    // UI sends "model" or "model/voice". Ids here contain both slashes and colons, so
    // match against the known list (longest prefix wins) rather than splitting on the
    // last slash, which would cut "deepgram/flux-tts:free" in half.
    const { modelId, voiceId: requestedVoice } = parseModelVoice(
      model,
      TTS_CFG.defaultModel,
      "",
      knownModels
    );
    // The model's own catalog, when it has one, is the only valid source of a voice.
    const catalog = cfg.voices?.[modelId] || [];
    const voice = requestedVoice || catalog[0]?.id || "";

    const res = await fetch(TTS_CFG.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${credentials.apiKey}`,
        ...(TTS_CFG.headers || {}),
      },
      body: JSON.stringify({
        model: modelId,
        input: text,
        response_format: "mp3",
        ...(voice ? { voice } : {}),
      }),
    });

    if (!res.ok) await throwUpstreamError(res);
    return responseToBase64(res, "mp3");
  },
};