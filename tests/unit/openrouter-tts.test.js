// Guards OpenRouter TTS, which was entirely broken rather than merely outdated.
//
// Three separate faults, each verified against the live API:
//  1. The adapter posted to /chat/completions with `modalities: ["text","audio"]`.
//     OpenRouter now rejects every speech model there: "<model> is a text-to-speech
//     model and cannot be used with the chat/completions endpoint. Use the
//     /api/v1/audio/speech endpoint instead."
//  2. The configured models no longer exist (openai/tts-1, openai/tts-1-hd,
//     openai/gpt-4o-mini-tts all answer "does not exist"), so the default model was dead.
//  3. Voice ids are per-model, and the old code carried one shared voice list. Handing a
//     flux-tts model an aura voice answers 400 "Unknown voice", and fish-audio rejects any
//     voice it does not know.
//
// These run without network access: fetch is mocked and the "supported voices" lists are
// the ones the API returns.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import openrouter from "../../open-sse/handlers/ttsProviders/openrouter.js";
import { TTS_MODELS_CONFIG, getTtsVoicesForModel } from "../../open-sse/config/ttsModels.js";
import { PROVIDER_MEDIA } from "../../open-sse/providers/index.js";

const AUDIO = new Uint8Array(256).fill(7);
const originalFetch = global.fetch;

function okAudio() {
  return new Response(AUDIO, { status: 200, headers: { "content-type": "audio/mpeg" } });
}

const lastCall = () => {
  const [url, init] = global.fetch.mock.calls.at(-1);
  return { url, init, body: JSON.parse(init.body) };
};

describe("OpenRouter TTS endpoint", () => {
  it("speaks to /audio/speech, never /chat/completions", () => {
    // The whole provider used to 400 here. Regression on this string is the bug.
    const base = PROVIDER_MEDIA["openrouter"]?.ttsConfig?.baseUrl || "";
    expect(base).toBe("https://openrouter.ai/api/v1/audio/speech");
    expect(base).not.toContain("chat/completions");
  });
});

describe("OpenRouter TTS models", () => {
  const cfg = TTS_MODELS_CONFIG.openrouter;

  it("no longer advertises the models OpenRouter removed", () => {
    // Each of these answers "does not exist" against the live API.
    const ids = cfg.models.map((m) => m.id);
    for (const dead of ["openai/tts-1", "openai/tts-1-hd", "openai/gpt-4o-mini-tts"]) {
      expect(ids).not.toContain(dead);
    }
  });

  it("defaults to a free model", () => {
    // A paid default would bill the operator for the dashboard's own example button.
    expect(cfg.models[0].id.endsWith(":free")).toBe(true);
    expect(cfg.models[0].id).toBe("deepgram/flux-tts:free");
  });

  it("keeps the flat voice key present for the dashboard", () => {
    // The dashboard and the alias baseline both expect this key to exist.
    const flat = cfg.voices["deepgram/flux-tts:free"];
    expect(Array.isArray(flat)).toBe(true);
    expect(flat.length).toBeGreaterThan(0);
  });

  it("publishes a voice catalog only for the models that have one", () => {
    expect(getTtsVoicesForModel("openrouter", "deepgram/flux-tts:free")?.length).toBe(36);
    expect(getTtsVoicesForModel("openrouter", "deepgram/aura-2")?.length).toBe(90);
  });

  it("gives a voice-less model NO catalog instead of borrowing another's", () => {
    // This is the subtle one: `allVoices` acts as the fallback for any model without its
    // own list, so setting it would push an Aura voice onto fish-audio, which 400s.
    // Unset allVoices must therefore mean null, not a neighbouring model's voices.
    for (const id of ["fish-audio/s2.1-pro-free:free", "x-ai/grok-voice-tts-1.0"]) {
      expect(getTtsVoicesForModel("openrouter", id)).toBeNull();
    }
  });
});

describe("OpenRouter TTS request shape", () => {
  beforeEach(() => {
    global.fetch = vi.fn(async () => okAudio());
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  const creds = { apiKey: "sk-or-test" };

  it("sends model and input, and strips the voice suffix from the model id", async () => {
    // The dashboard sends "provider/model/voice"; ids contain slashes AND colons, so a
    // naive last-slash split would cut "deepgram/flux-tts:free" in half.
    const out = await openrouter.synthesize("hello", "deepgram/flux-tts:free/flux-wes-en", creds);
    const { url, init, body } = lastCall();

    expect(url).toBe("https://openrouter.ai/api/v1/audio/speech");
    expect(body.model).toBe("deepgram/flux-tts:free");
    expect(body.voice).toBe("flux-wes-en");
    expect(body.input).toBe("hello");
    expect(init.headers.Authorization).toBe("Bearer sk-or-test");
    expect(out.format).toBe("mp3");
    expect(Buffer.from(out.base64, "base64").length).toBe(AUDIO.length);
  });

  it("falls back to the model's own first voice when no voice is given", async () => {
    await openrouter.synthesize("hello", "deepgram/aura-2", creds);
    const { body } = lastCall();
    expect(body.model).toBe("deepgram/aura-2");
    expect(body.voice).toBe("aura-2-thalia-en");
  });

  it("omits the voice entirely for a model that has no catalog", async () => {
    // Sending a borrowed voice here is exactly what upstream rejects.
    await openrouter.synthesize("hello", "fish-audio/s2.1-pro-free:free", creds);
    const { body } = lastCall();
    expect(body.model).toBe("fish-audio/s2.1-pro-free:free");
    expect(body).not.toHaveProperty("voice");
  });

  it("uses the default model when the dashboard sends none", async () => {
    await openrouter.synthesize("hello", "", creds);
    const { body } = lastCall();
    expect(body.model).toBe("deepgram/flux-tts:free");
  });

  it("surfaces the upstream message instead of a bare status", async () => {
    global.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({ error: { message: 'Unknown voice "aura-2-thalia-en"' } }),
        { status: 400, headers: { "content-type": "application/json" } }
      )
    );
    await expect(openrouter.synthesize("hi", "deepgram/flux-tts:free", creds)).rejects.toThrow(
      /Unknown voice/
    );
  });

  it("refuses without a key rather than sending an unauthenticated request", async () => {
    await expect(openrouter.synthesize("hi", "deepgram/flux-tts:free", {})).rejects.toThrow(
      /No OpenRouter API key/
    );
  });
});