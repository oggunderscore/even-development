/**
 * Placeholder `LlmClient` (see `content-generator.ts`'s `LlmClient`
 * interface) for wiring the Scheduler → Content_Generator pipeline at boot
 * (task 13.1).
 *
 * TODO(real LLM integration): `Assistant_App`'s config form
 * (`webapp/assistant-config-form.ts`) only lets the user *select* a
 * provider (`"anthropic" | "openai"`) and stores that choice in
 * `STORAGE_KEYS.ASSISTANT_CONFIG` — there is no code anywhere in this
 * codebase that actually calls an LLM provider's API (confirmed by
 * searching for `fetch(`, `api.anthropic`, `api.openai`, etc.: the only
 * real network calls in `even-foresight/src` are `hud/components/weather.ts`'s
 * Open-Meteo requests). Building that real call (including how API keys are
 * supplied — Assistant_App's config form doesn't collect one either) is out
 * of scope for task 13.1, which only wires the Scheduler to run
 * independently of the SubApp lifecycle.
 *
 * Until real integration exists, `generate` always rejects. This is a
 * deliberate "safely surfaces as failed" choice: `ContentGenerator.deliver`
 * (see `content-generator.ts`) catches `LlmClient.generate` rejections and
 * resolves `"failed"` rather than throwing, so a tick's `onDeliver` never
 * crashes the Scheduler's tick loop — it just contributes to the Topic's
 * `consecutiveFailures` counter like any other transient provider failure
 * would, until Requirement 5's auto-pause-after-3-failures kicks in.
 */
import type { GenerationRequest, LlmClient } from "./content-generator";

export function createPlaceholderLlmClient(): LlmClient {
  return {
    async generate(_request: GenerationRequest): Promise<string> {
      throw new Error(
        "SmarterEveryday: no real LlmClient implementation exists yet " +
          "(TODO — see llm-client.ts); Content_Delivery cannot generate " +
          "content until Assistant_App's actual provider-calling code is " +
          "built.",
      );
    },
  };
}
