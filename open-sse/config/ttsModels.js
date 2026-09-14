import { GOOGLE_TTS_LANGUAGES } from "./googleTtsLanguages.js";

// ── Voice definitions (DRY — reused across providers) ──────────────────────
const VOICES = {
  alloy:   { id: "alloy",   name: "Alloy" },
  ash:     { id: "ash",     name: "Ash" },
  ballad:  { id: "ballad",  name: "Ballad" },
  cedar:   { id: "cedar",   name: "Cedar" },
  coral:   { id: "coral",   name: "Coral" },
  echo:    { id: "echo",    name: "Echo" },
  fable:   { id: "fable",   name: "Fable" },
  marin:   { id: "marin",   name: "Marin" },
  nova:    { id: "nova",    name: "Nova" },
  onyx:    { id: "onyx",    name: "Onyx" },
  sage:    { id: "sage",    name: "Sage" },
  shimmer: { id: "shimmer", name: "Shimmer" },
  verse:   { id: "verse",   name: "Verse" },
};

const v = (...keys) => keys.map((k) => ({ ...VOICES[k], type: "tts" }));

// 9 voices for tts-1 / tts-1-hd
const VOICES_STANDARD = v("alloy", "ash", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer");
// 13 voices for gpt-4o-mini-tts
const VOICES_FULL = v("alloy", "ash", "ballad", "cedar", "coral", "echo", "fable", "marin", "nova", "onyx", "sage", "shimmer", "verse");

// Gemini prebuilt voices (30 voices, multi-language auto-detect)
const GEMINI_VOICES = [
  "Zephyr", "Puck", "Charon", "Kore", "Fenrir", "Leda", "Orus", "Aoede",
  "Callirrhoe", "Autonoe", "Enceladus", "Iapetus", "Umbriel", "Algieba",
  "Despina", "Erinome", "Algenib", "Rasalgethi", "Laomedeia", "Achernar",
  "Alnilam", "Schedar", "Gacrux", "Pulcherrima", "Achird", "Zubenelgenubi",
  "Vindemiatrix", "Sadachbia", "Sadaltager", "Sulafat",
].map((id) => ({ id, name: id, type: "tts" }));

// Xiaomi MiMo preset voices (from https://mimo.mi.com/docs/zh-CN/quick-start/usage-guide/audio/speech-synthesis-v2.5).
// Voice id is passed via `audio.voice`; `mimo_default` = default (冰糖 on CN cluster, Mia elsewhere).
// Voices are language-independent — the spoken language is a separate hint, not bound to the voice.
const MIMO_VOICES = [
  { id: "mimo_default", name: "mimo_default" },
  { id: "冰糖",           name: "冰糖" },
  { id: "茉莉",           name: "茉莉" },
  { id: "苏打",           name: "苏打" },
  { id: "白桦",           name: "白桦" },
  { id: "Mia",           name: "Mia" },
  { id: "Chloe",         name: "Chloe" },
  { id: "Milo",          name: "Milo" },
  { id: "Dean",          name: "Dean" },
].map((v) => ({ type: "tts", ...v }));

// Deepgram Aura-2 voices. The id list comes from the /audio/speech error response, which
// enumerates its valid voices when handed an unknown one; the trailing tag is the language.
const OPENROUTER_AURA2_VOICES = [
  { id: "aura-2-thalia-en", name: "Thalia (EN)" }, { id: "aura-2-agathe-fr", name: "Agathe (FR)" },
  { id: "aura-2-agustina-es", name: "Agustina (ES)" }, { id: "aura-2-alvaro-es", name: "Alvaro (ES)" },
  { id: "aura-2-ama-ja", name: "Ama (JA)" }, { id: "aura-2-amalthea-en", name: "Amalthea (EN)" },
  { id: "aura-2-andromeda-en", name: "Andromeda (EN)" }, { id: "aura-2-antonia-es", name: "Antonia (ES)" },
  { id: "aura-2-apollo-en", name: "Apollo (EN)" }, { id: "aura-2-aquila-es", name: "Aquila (ES)" },
  { id: "aura-2-arcas-en", name: "Arcas (EN)" }, { id: "aura-2-aries-en", name: "Aries (EN)" },
  { id: "aura-2-asteria-en", name: "Asteria (EN)" }, { id: "aura-2-athena-en", name: "Athena (EN)" },
  { id: "aura-2-atlas-en", name: "Atlas (EN)" }, { id: "aura-2-aurelia-de", name: "Aurelia (DE)" },
  { id: "aura-2-aurora-en", name: "Aurora (EN)" }, { id: "aura-2-beatrix-nl", name: "Beatrix (NL)" },
  { id: "aura-2-callista-en", name: "Callista (EN)" }, { id: "aura-2-carina-es", name: "Carina (ES)" },
  { id: "aura-2-celeste-es", name: "Celeste (ES)" }, { id: "aura-2-cesare-it", name: "Cesare (IT)" },
  { id: "aura-2-cinzia-it", name: "Cinzia (IT)" }, { id: "aura-2-cora-en", name: "Cora (EN)" },
  { id: "aura-2-cordelia-en", name: "Cordelia (EN)" }, { id: "aura-2-cornelia-nl", name: "Cornelia (NL)" },
  { id: "aura-2-daphne-nl", name: "Daphne (NL)" }, { id: "aura-2-delia-en", name: "Delia (EN)" },
  { id: "aura-2-demetra-it", name: "Demetra (IT)" }, { id: "aura-2-diana-es", name: "Diana (ES)" },
  { id: "aura-2-dionisio-it", name: "Dionisio (IT)" }, { id: "aura-2-draco-en", name: "Draco (EN)" },
  { id: "aura-2-ebisu-ja", name: "Ebisu (JA)" }, { id: "aura-2-elara-de", name: "Elara (DE)" },
  { id: "aura-2-electra-en", name: "Electra (EN)" }, { id: "aura-2-elio-it", name: "Elio (IT)" },
  { id: "aura-2-estrella-es", name: "Estrella (ES)" }, { id: "aura-2-fabian-de", name: "Fabian (DE)" },
  { id: "aura-2-flavio-it", name: "Flavio (IT)" }, { id: "aura-2-fujin-ja", name: "Fujin (JA)" },
  { id: "aura-2-gloria-es", name: "Gloria (ES)" }, { id: "aura-2-harmonia-en", name: "Harmonia (EN)" },
  { id: "aura-2-hector-fr", name: "Hector (FR)" }, { id: "aura-2-helena-en", name: "Helena (EN)" },
  { id: "aura-2-hera-en", name: "Hera (EN)" }, { id: "aura-2-hermes-en", name: "Hermes (EN)" },
  { id: "aura-2-hestia-nl", name: "Hestia (NL)" }, { id: "aura-2-hyperion-en", name: "Hyperion (EN)" },
  { id: "aura-2-iris-en", name: "Iris (EN)" }, { id: "aura-2-izanami-ja", name: "Izanami (JA)" },
  { id: "aura-2-janus-en", name: "Janus (EN)" }, { id: "aura-2-javier-es", name: "Javier (ES)" },
  { id: "aura-2-julius-de", name: "Julius (DE)" }, { id: "aura-2-juno-en", name: "Juno (EN)" },
  { id: "aura-2-jupiter-en", name: "Jupiter (EN)" }, { id: "aura-2-kara-de", name: "Kara (DE)" },
  { id: "aura-2-lara-de", name: "Lara (DE)" }, { id: "aura-2-lars-nl", name: "Lars (NL)" },
  { id: "aura-2-leda-nl", name: "Leda (NL)" }, { id: "aura-2-livia-it", name: "Livia (IT)" },
  { id: "aura-2-luciano-es", name: "Luciano (ES)" }, { id: "aura-2-luna-en", name: "Luna (EN)" },
  { id: "aura-2-maia-it", name: "Maia (IT)" }, { id: "aura-2-mars-en", name: "Mars (EN)" },
  { id: "aura-2-melia-it", name: "Melia (IT)" }, { id: "aura-2-minerva-en", name: "Minerva (EN)" },
  { id: "aura-2-neptune-en", name: "Neptune (EN)" }, { id: "aura-2-nestor-es", name: "Nestor (ES)" },
  { id: "aura-2-odysseus-en", name: "Odysseus (EN)" }, { id: "aura-2-olivia-es", name: "Olivia (ES)" },
  { id: "aura-2-ophelia-en", name: "Ophelia (EN)" }, { id: "aura-2-orion-en", name: "Orion (EN)" },
  { id: "aura-2-orpheus-en", name: "Orpheus (EN)" }, { id: "aura-2-pandora-en", name: "Pandora (EN)" },
  { id: "aura-2-phoebe-en", name: "Phoebe (EN)" }, { id: "aura-2-pluto-en", name: "Pluto (EN)" },
  { id: "aura-2-rhea-nl", name: "Rhea (NL)" }, { id: "aura-2-roman-nl", name: "Roman (NL)" },
  { id: "aura-2-sander-nl", name: "Sander (NL)" }, { id: "aura-2-saturn-en", name: "Saturn (EN)" },
  { id: "aura-2-selena-es", name: "Selena (ES)" }, { id: "aura-2-selene-en", name: "Selene (EN)" },
  { id: "aura-2-silvia-es", name: "Silvia (ES)" }, { id: "aura-2-sirio-es", name: "Sirio (ES)" },
  { id: "aura-2-theia-en", name: "Theia (EN)" }, { id: "aura-2-uzume-ja", name: "Uzume (JA)" },
  { id: "aura-2-valerio-es", name: "Valerio (ES)" }, { id: "aura-2-vesta-en", name: "Vesta (EN)" },
  { id: "aura-2-viktoria-de", name: "Viktoria (DE)" }, { id: "aura-2-zeus-en", name: "Zeus (EN)" },
].map((entry) => ({ ...entry, type: "tts" }));

// Deepgram Flux voices — the free `flux-tts` model accepts only these (all English).
const OPENROUTER_FLUX_VOICES = [
  { id: "flux-alexis-en", name: "Alexis (EN)" }, { id: "flux-bree-en", name: "Bree (EN)" },
  { id: "flux-brittany-en", name: "Brittany (EN)" }, { id: "flux-brooke-en", name: "Brooke (EN)" },
  { id: "flux-bruce-en", name: "Bruce (EN)" }, { id: "flux-cliff-en", name: "Cliff (EN)" },
  { id: "flux-cole-en", name: "Cole (EN)" }, { id: "flux-colin-en", name: "Colin (EN)" },
  { id: "flux-conor-en", name: "Conor (EN)" }, { id: "flux-donovan-en", name: "Donovan (EN)" },
  { id: "flux-drew-en", name: "Drew (EN)" }, { id: "flux-elise-en", name: "Elise (EN)" },
  { id: "flux-gemma-en", name: "Gemma (EN)" }, { id: "flux-haley-en", name: "Haley (EN)" },
  { id: "flux-hannah-en", name: "Hannah (EN)" }, { id: "flux-heather-en", name: "Heather (EN)" },
  { id: "flux-jack-en", name: "Jack (EN)" }, { id: "flux-kai-en", name: "Kai (EN)" },
  { id: "flux-kelsey-en", name: "Kelsey (EN)" }, { id: "flux-kit-en", name: "Kit (EN)" },
  { id: "flux-maeve-en", name: "Maeve (EN)" }, { id: "flux-marcelo-en", name: "Marcelo (EN)" },
  { id: "flux-marcus-en", name: "Marcus (EN)" }, { id: "flux-meena-en", name: "Meena (EN)" },
  { id: "flux-meghan-en", name: "Meghan (EN)" }, { id: "flux-miles-en", name: "Miles (EN)" },
  { id: "flux-naveen-en", name: "Naveen (EN)" }, { id: "flux-paige-en", name: "Paige (EN)" },
  { id: "flux-priya-en", name: "Priya (EN)" }, { id: "flux-rufus-en", name: "Rufus (EN)" },
  { id: "flux-sean-en", name: "Sean (EN)" }, { id: "flux-sharon-en", name: "Sharon (EN)" },
  { id: "flux-sienna-en", name: "Sienna (EN)" }, { id: "flux-tanner-en", name: "Tanner (EN)" },
  { id: "flux-wade-en", name: "Wade (EN)" }, { id: "flux-wes-en", name: "Wes (EN)" },
].map((entry) => ({ ...entry, type: "tts" }));

// ── TTS Config (config-driven, single source of truth) ─────────────────────
export const TTS_MODELS_CONFIG = {
  openai: {
    models: [
      { id: "gpt-4o-mini-tts", name: "GPT-4o Mini TTS", type: "tts" },
      { id: "tts-1-hd",        name: "TTS-1 HD",        type: "tts" },
      { id: "tts-1",           name: "TTS-1",           type: "tts" },
    ],
    voices: {
      "gpt-4o-mini-tts": VOICES_FULL,
      "tts-1":           VOICES_STANDARD,
      "tts-1-hd":        VOICES_STANDARD,
    },
    // Flat voice list (all unique voices) for backward compat
    allVoices: VOICES_FULL,
  },
  openrouter: {
    // OpenRouter serves TTS over /api/v1/audio/speech, not chat/completions, and the
    // OpenAI models this list used to name (openai/tts-1, gpt-4o-mini-tts) no longer
    // exist there — every request 400'd "does not exist". These are the 18 speech models
    // the Models API reports today (output_modalities=speech), free ones first so the
    // default costs nothing.
    models: [
      { id: "deepgram/flux-tts:free",          name: "Deepgram Flux TTS (Free)", type: "tts" },
      { id: "fish-audio/s2.1-pro-free:free",   name: "Fish Audio S2.1 Pro (Free)", type: "tts" },
      { id: "deepgram/aura-2",                 name: "Deepgram Aura-2", type: "tts" },
      { id: "fish-audio/s2.1-pro",             name: "Fish Audio S2.1 Pro", type: "tts" },
      { id: "fish-audio/s2-pro",               name: "Fish Audio S2 Pro", type: "tts" },
      { id: "fish-audio/s1",                   name: "Fish Audio S1", type: "tts" },
      { id: "google/gemini-3.1-flash-tts-preview", name: "Gemini 3.1 Flash TTS", type: "tts" },
      { id: "minimax/speech-2.8-turbo",        name: "MiniMax Speech 2.8 Turbo", type: "tts" },
      { id: "minimax/speech-2.8-hd",           name: "MiniMax Speech 2.8 HD", type: "tts" },
      { id: "x-ai/grok-voice-tts-1.0",         name: "Grok Voice TTS 1.0", type: "tts" },
      { id: "qwen/qwen-audio-3.0-tts-flash",   name: "Qwen Audio 3.0 TTS Flash", type: "tts" },
      { id: "qwen/qwen-audio-3.0-tts-plus",    name: "Qwen Audio 3.0 TTS Plus", type: "tts" },
      { id: "mistralai/voxtral-mini-tts-2603", name: "Voxtral Mini TTS", type: "tts" },
      { id: "sesame/csm-1b",                   name: "Sesame CSM 1B", type: "tts" },
      { id: "hexgrad/kokoro-82m",              name: "Kokoro 82M", type: "tts" },
      { id: "canopylabs/orpheus-3b-0.1-ft",    name: "Orpheus 3B", type: "tts" },
      { id: "microsoft/mai-voice-2",           name: "MAI Voice 2", type: "tts" },
      { id: "microsoft/mai-voice-2-flash",     name: "MAI Voice 2 Flash", type: "tts" },
    ],
    voices: {
      // Only the two Deepgram families publish their voice catalog, so only they get a
      // curated list. The rest send no voice and take OpenRouter's default; when a
      // provider insists on an explicit voice the upstream message is passed through
      // verbatim rather than guessed at here.
      "deepgram/flux-tts:free": OPENROUTER_FLUX_VOICES,
      "deepgram/aura-2":        OPENROUTER_AURA2_VOICES,
    },
    // `allVoices` must stay unset here. Voice ids are per-model and not interchangeable
    // (flux-tts rejects an aura-2 voice and vice versa), and `getTtsVoicesForModel` treats
    // `allVoices` as the *fallback* for any model without its own catalog — setting it
    // would hand the dashboard an Aura voice for fish-audio, which upstream 400s. With it
    // unset, a model that has no catalog sends no voice and takes the provider default.
    //
    // The flat `openrouter-tts-voices` key is still emitted below for the dashboard and
    // the alias baseline; it carries the default model's catalog.
  },
  elevenlabs: {
    models: [
      { id: "eleven_flash_v2_5",      name: "Flash v2.5 (Fastest)",      type: "tts" },
      { id: "eleven_turbo_v2_5",      name: "Turbo v2.5 (Fast)",         type: "tts" },
      { id: "eleven_multilingual_v2", name: "Multilingual v2 (Quality)",  type: "tts" },
      { id: "eleven_monolingual_v1",  name: "Monolingual v1 (English)",  type: "tts" },
    ],
    // voices come from API, not hardcoded
  },
  "edge-tts": {
    defaults: [
      { id: "en-US-AriaNeural",    name: "Aria (en-US)",    type: "tts" },
      { id: "en-US-GuyNeural",     name: "Guy (en-US)",     type: "tts" },
      { id: "en-GB-SoniaNeural",   name: "Sonia (en-GB)",   type: "tts" },
      { id: "vi-VN-HoaiMyNeural",  name: "Hoai My (vi-VN)", type: "tts" },
      { id: "vi-VN-NamMinhNeural", name: "Nam Minh (vi-VN)", type: "tts" },
      { id: "zh-CN-XiaoxiaoNeural", name: "Xiaoxiao (zh-CN)", type: "tts" },
      { id: "zh-CN-YunxiNeural",   name: "Yunxi (zh-CN)",   type: "tts" },
      { id: "fr-FR-DeniseNeural",  name: "Denise (fr-FR)",  type: "tts" },
      { id: "de-DE-KatjaNeural",   name: "Katja (de-DE)",   type: "tts" },
      { id: "ja-JP-NanamiNeural",  name: "Nanami (ja-JP)",  type: "tts" },
      { id: "ko-KR-SunHiNeural",   name: "SunHi (ko-KR)",   type: "tts" },
    ],
  },
  "local-device": {
    defaults: [
      { id: "default", name: "System Default Voice", type: "tts" },
    ],
  },
  "google-tts": {
    defaults: GOOGLE_TTS_LANGUAGES,
  },
  gemini: {
    models: [
      { id: "gemini-3.1-flash-tts-preview", name: "Gemini 3.1 Flash TTS", type: "tts" },
      { id: "gemini-2.5-flash-preview-tts", name: "Gemini 2.5 Flash TTS", type: "tts" },
      { id: "gemini-2.5-pro-preview-tts",   name: "Gemini 2.5 Pro TTS",   type: "tts" },
    ],
    voices: {
      "gemini-3.1-flash-tts-preview": GEMINI_VOICES,
      "gemini-2.5-flash-preview-tts": GEMINI_VOICES,
      "gemini-2.5-pro-preview-tts":   GEMINI_VOICES,
    },
    allVoices: GEMINI_VOICES,
  },
  "xiaomi-mimo": {
    models: [
      { id: "mimo-v2.5-tts", name: "MiMo V2.5 TTS", type: "tts" },
    ],
    voices: {
      "mimo-v2.5-tts": MIMO_VOICES,
    },
  },
};

// ── Helper: get voices for a specific model ────────────────────────────────
export function getTtsVoicesForModel(provider, modelId) {
  const cfg = TTS_MODELS_CONFIG[provider];
  if (!cfg?.voices) return null;
  return cfg.voices[modelId] || cfg.allVoices || null;
}

// ── Build flat entries for PROVIDER_MODELS backward compat ─────────────────
export function buildTtsProviderModels() {
  const entries = {};
  for (const [provider, cfg] of Object.entries(TTS_MODELS_CONFIG)) {
    if (cfg.models) entries[`${provider}-tts-models`] = cfg.models;
    if (cfg.allVoices) entries[`${provider}-tts-voices`] = cfg.allVoices;
    if (cfg.defaults) entries[provider] = cfg.defaults;
  }
  // Keep openai-tts-voices key pointing to full voice list for backward compat
  entries["openai-tts-voices"] = TTS_MODELS_CONFIG.openai.allVoices;
  // OpenRouter has no cross-model voice list (see the note on its config), so this flat
  // key mirrors the default model's catalog to keep the key present for the dashboard.
  const orDefault = TTS_MODELS_CONFIG.openrouter?.models?.[0]?.id;
  entries["openrouter-tts-voices"] =
    TTS_MODELS_CONFIG.openrouter?.voices?.[orDefault] || [];
  return entries;
}
