# Honyaku privacy policy

*Last updated: 2026-10-16 · applies to Honyaku 1.0.0*

Honyaku translates live speech between English and Japanese on Even Realities G2 glasses. It has **no
server and no accounts**. The developer never receives your audio, text, keys or any usage data.

## What the app does with your data, per permission

| Permission | Used for | Where the data goes |
| --- | --- | --- |
| `g2-microphone` | Captures speech from the glasses microphone **only while listening is on** (it starts paused; pausing closes the mic). | Streamed live to **Deepgram** (`api.deepgram.com`) for speech-to-text, using your own Deepgram key. Not recorded or stored by the app. |
| `network` | Sends the recognised text to the translation service **you choose** in Settings. | **Google Cloud Translation** (`translation.googleapis.com`), **OpenRouter** (`openrouter.ai`, which forwards to the model you pick) or **Anthropic** (`api.anthropic.com`), using your own key for that service. |

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
- The on-screen feed of recent translations lives in memory only and is gone when the app closes.
- The app keeps no recordings, transcripts, history, analytics, advertising identifiers or crash reports.

To remove your keys, empty the key fields in **Settings** and press **SAVE**, or uninstall the app. Revoke or
delete a key in the provider's own dashboard to cut off access completely.

## Children, safety and changes

Honyaku is a general-purpose tool and is not directed at children. It gives no medical, legal or financial advice
and has no emergency functions. If this policy changes, the new version will be published with the app update.

## Contact

Questions or concerns: open an issue at https://github.com/oggunderscore/even-development/issues
