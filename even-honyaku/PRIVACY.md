# Honyaku privacy policy

*Last updated: 2026-10-18 · applies to Honyaku 1.1.x*

Honyaku translates live speech between English and Japanese on Even Realities G2 glasses. It has **no
server and no accounts**. The developer never receives your audio, text, keys or any usage data.

## What the app does with your data, per permission

| Permission | Used for | Where the data goes |
| --- | --- | --- |
| `g2-microphone` | Captures speech from the glasses microphone **only while listening is on** (it starts paused; pausing closes the mic), and while you record or test your voice profile. | Streamed live to **Deepgram** (`api.deepgram.com`) for speech-to-text, using your own Deepgram key. Not recorded or stored by the app. Recognising *your own voice* happens on your phone and the audio used for it is never sent anywhere. |
| `network` | Sends the recognised text to the translation service **you choose** in Settings. In Predictive mode it also sends what the other person just said (and the last few turns, including which suggested replies you read) to OpenRouter or Anthropic to get reply suggestions. | **Google Cloud Translation** (`translation.googleapis.com`), **OpenRouter** (`openrouter.ai`, which forwards to the model you pick) or **Anthropic** (`api.anthropic.com`), using your own key for that service. |

Those are the only network destinations (they are the `app.json` network whitelist). Requests go straight from
your phone to the service; nothing passes through any developer-run infrastructure. Each service handles the data
under its own terms and privacy policy, and usage is billed to your own account with it:

- Deepgram: https://deepgram.com/privacy
- Google Cloud: https://cloud.google.com/terms/cloud-privacy-notice
- OpenRouter: https://openrouter.ai/privacy
- Anthropic: https://www.anthropic.com/legal/privacy

## What is stored on your device

- The API keys you enter and your settings (provider, listening mode, optional model name). They are kept in the
  Even Realities app's app storage and the WebView's local storage on your phone, and are never included in the
  app package, logged, or sent anywhere except to the matching service above.
- **Your voice profile** (if you record one): a few dozen numbers (pitch and spectral features) and loudness statistics computed from the sentences you read, in English and Japanese, plus a few more learned while you use the app. It is **not audio** and cannot be played back, but it is a biometric-style description of how you sound, so it is treated as sensitive: it is kept only in the Even Realities app's app storage and the WebView's local storage on your phone, used only on your phone to tell your voice from other people's, never sent to any service or the developer, never logged. **Delete profile** (VOICE tab) removes it; uninstalling the app does too.
- The on-screen feed of recent translations and suggested replies lives in memory only and is gone when the app closes.
- The app keeps no recordings, transcripts, history, analytics, advertising identifiers or crash reports. The microphone audio recorded while you set up your voice profile is analysed in memory and discarded.

To remove your keys, empty the key fields in **Settings** (changes save automatically), or uninstall the app. When you enter a key, the app checks it right away by contacting that service (and, for the translation key, asking the chosen model to translate one short sample phrase). Revoke or
delete a key in the provider's own dashboard to cut off access completely.

## Children, safety and changes

Honyaku is a general-purpose tool and is not directed at children. It gives no medical, legal or financial advice
and has no emergency functions. If this policy changes, the new version will be published with the app update.

## Contact

Questions or concerns: open an issue at https://github.com/oggunderscore/even-development/issues
