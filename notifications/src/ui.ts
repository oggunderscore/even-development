import {
  type EvenAppBridge,
  CreateStartUpPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
} from '@evenrealities/even_hub_sdk'

export type UIState =
  | { name: 'idle' }
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
          containerID: 1,
          containerName: 'header',
          xPosition: 0,
          yPosition: 0,
          width: 576,
          height: 52,
          content: '● Notifications',
          isEventCapture: 0,
          paddingLength: 4,
        }),
        new TextContainerProperty({
          containerID: 2,
          containerName: 'body',
          xPosition: 0,
          yPosition: 56,
          width: 576,
          height: 180,
          content: '',
          isEventCapture: 0,
          paddingLength: 4,
        }),
        new TextContainerProperty({
          containerID: 3,
          containerName: 'footer',
          xPosition: 0,
          yPosition: 240,
          width: 576,
          height: 48,
          content: '',
          isEventCapture: 1,
          paddingLength: 4,
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

export async function setBodyText(bridge: EvenAppBridge, text: string) {
  await bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: 2, containerName: 'body', content: text }))
}

function resolve(state: UIState): { header: string; body: string; footer: string } {
  switch (state.name) {
    case 'idle':
      return { header: '● Notifications', body: '', footer: '' }
    case 'notify':
      return {
        header: `${state.app} · ${state.from}`,
        body: state.body,
        footer: '▶ Reply   ▼ Dismiss',
      }
    case 'recording':
      return { header: '● Recording...', body: '', footer: 'Tap to stop' }
    case 'transcribing':
      return { header: 'Transcribing...', body: state.partial, footer: '' }
    case 'review':
      return { header: 'Your reply:', body: state.transcript, footer: '▶ Send   ▲ Redo' }
    case 'sent':
      return { header: `✓ Sent to ${state.from}`, body: '', footer: '' }
    case 'error':
      return { header: '✗ Failed to send', body: '', footer: '' }
  }
}
