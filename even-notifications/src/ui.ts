import {
  type EvenAppBridge,
  CreateStartUpPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
} from '@evenrealities/even_hub_sdk'

// ── Separator line — 26 chars (520px) fits inside the 564px content area
// (576px container minus 6px paddingLength on each side), measured via @evenrealities/pretext
const SEP = '──────────────────────────'

export type UIState =
  | { name: 'connecting' }
  | { name: 'disconnected' }
  | { name: 'onboarding'; step: 1 | 2 | 3 }
  | { name: 'idle' }
  | { name: 'idle_queued'; count: number }
  | { name: 'notify'; app: string; from: string; body: string }
  | { name: 'recording' }
  | { name: 'transcribing'; partial: string }
  | { name: 'review'; transcript: string }
  | { name: 'sent'; from: string }
  | { name: 'error' }

export async function initPage(bridge: EvenAppBridge) {
  await bridge.createStartUpPageContainer(
    new CreateStartUpPageContainer({
      containerTotalNum: 3,
      textObject: [
        new TextContainerProperty({
          containerID:   1,
          containerName: 'header',
          xPosition: 0, yPosition: 0,
          width: 576,   height: 56,
          content: '',
          isEventCapture: 0,
          paddingLength: 6,
          borderWidth: 0,
        }),
        new TextContainerProperty({
          containerID:   2,
          containerName: 'body',
          xPosition: 0, yPosition: 60,
          width: 576,   height: 176,
          content: '',
          isEventCapture: 0,
          paddingLength: 6,
        }),
        new TextContainerProperty({
          containerID:   3,
          containerName: 'footer',
          xPosition: 0, yPosition: 240,
          width: 576,   height: 48,
          content: '',
          isEventCapture: 1,
          paddingLength: 6,
          borderWidth: 1,
          borderColor: 5,
        }),
      ],
    })
  )
}

export async function setState(bridge: EvenAppBridge, state: UIState) {
  const { header, body, footer } = resolve(state)
  await Promise.all([
    bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: 1, containerName: 'header', content: header })),
    bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: 2, containerName: 'body',   content: body   })),
    bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: 3, containerName: 'footer', content: footer })),
  ])
}

export async function setHeaderText(bridge: EvenAppBridge, text: string) {
  await bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: 1, containerName: 'header', content: text }))
}

export async function setBodyText(bridge: EvenAppBridge, text: string) {
  await bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: 2, containerName: 'body', content: text }))
}

// Formats live transcript text with the standard separator, for streaming
// partial/final updates into the body container without a full setState.
export function withSep(text: string): string {
  return `${SEP}\n${text}`
}

function resolve(state: UIState): { header: string; body: string; footer: string } {
  switch (state.name) {

    case 'connecting':
      return {
        header: 'Notifications',
        body:   `Connecting...\n${SEP}\nOpen APPS Bridge on your\nphone to get started.`,
        footer: '',
      }

    case 'disconnected':
      return {
        header: 'Not connected',
        body:   `${SEP}\nMake sure APPS Bridge is\nrunning on your phone.\n\nReconnecting...`,
        footer: '',
      }

    case 'onboarding':
      return resolveOnboarding(state.step)

    case 'idle':
      return {
        header: '● Notifications ready',
        body:   `${SEP}\nTexts from your phone\nwill appear here.`,
        footer: '',
      }

    case 'idle_queued':
      return {
        header: `● ${state.count} message${state.count > 1 ? 's' : ''} waiting`,
        body:   `${SEP}\nDouble-tap to exit.`,
        footer: 'Tap to read',
      }

    case 'notify':
      return {
        header: `${state.app}  ·  ${state.from}`,
        body:   `${SEP}\n${state.body}`,
        footer: '▶ Reply    ▼ Skip',
      }

    case 'recording':
      return {
        header: '● Recording',
        body:   `${SEP}\nSpeak your reply now.\n\nTap the temple\nwhen you're done.`,
        footer: '■ Stop',
      }

    case 'transcribing':
      return {
        header: 'Transcribing...',
        body:   state.partial
          ? `${SEP}\n${state.partial}`
          : `${SEP}\nConverting speech\nto text...`,
        footer: '■ Cancel',
      }

    case 'review':
      return {
        header: 'Your reply:',
        body:   `${SEP}\n${state.transcript}`,
        footer: '▶ Send    ▲ Re-record',
      }

    case 'sent':
      return {
        header: `✓ Sent to ${state.from}`,
        body:   `${SEP}\nMessage delivered.`,
        footer: '',
      }

    case 'error':
      return {
        header: '✗ Could not send',
        body:   `${SEP}\nCheck APPS Bridge on\nyour phone and try again.`,
        footer: '',
      }
  }
}

function resolveOnboarding(step: 1 | 2 | 3): { header: string; body: string; footer: string } {
  switch (step) {
    case 1:
      return {
        header: 'Welcome!',
        body:   `${SEP}\nThis app shows incoming\ntexts from your phone\ndirectly on your glasses.\n\nYou can reply by voice\nwithout touching your phone.`,
        footer: 'Tap to continue ▶',
      }
    case 2:
      return {
        header: 'How to reply',
        body:   `${SEP}\n1. A text arrives — tap\n   once to start replying.\n\n2. Speak your reply.\n\n3. Tap to stop, then\n   tap again to send.`,
        footer: 'Tap to continue ▶',
      }
    case 3:
      return {
        header: 'One more step',
        body:   `${SEP}\nOpen APPS Bridge on your\nphone and follow the setup\nto connect your texts.\n\nDouble-tap anytime to exit.`,
        footer: "Tap — I'm ready ▶",
      }
  }
}
