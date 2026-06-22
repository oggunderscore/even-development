import {
  waitForEvenAppBridge,
  CreateStartUpPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
  OsEventTypeList,
} from '@evenrealities/even_hub_sdk'

const statusBadge = document.getElementById('status-badge')
const logEntries = document.getElementById('log-entries')

function log(message: string) {
  console.log(message)
  if (!logEntries) return
  const entry = document.createElement('div')
  entry.textContent = message
  logEntries.prepend(entry)
}

function setStatus(text: string, ok = true) {
  if (!statusBadge) return
  statusBadge.textContent = text
  statusBadge.className = ok ? 'badge badge-ok' : 'badge badge-error'
}

async function boot() {
  const bridge = await waitForEvenAppBridge()
  log('Even Hub bridge ready')

  await bridge.createStartUpPageContainer(new CreateStartUpPageContainer({
    containerTotalNum: 1,
    textObject: [new TextContainerProperty({
      containerID: 0,
      containerName: 'title',
      xPosition: 0,
      yPosition: 0,
      width: 576,
      height: 288,
      content: 'G2 Demo ready',
      isEventCapture: 1,
    })],
  }))
  log('Page container created')
  setStatus('Ready', true)

  let tapCount = 0
  bridge.onEvenHubEvent((event) => {
    const sysType = event.sysEvent?.eventType ?? -1
    const textType = event.textEvent?.eventType ?? 0

    if (sysType === OsEventTypeList.DOUBLE_CLICK_EVENT ||
        textType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
      log('Double-click — exiting')
      bridge.shutDownPageContainer()
      return
    }

    if (textType === OsEventTypeList.CLICK_EVENT) {
      tapCount += 1
      log(`Tap ${tapCount}`)
      bridge.textContainerUpgrade(new TextContainerUpgrade({
        containerID: 0,
        containerName: 'title',
        content: `Taps: ${tapCount}`,
      }))
    }

    if (sysType === OsEventTypeList.SYSTEM_EXIT_EVENT ||
        sysType === OsEventTypeList.ABNORMAL_EXIT_EVENT) {
      log('Session ended')
    }
  })
}

boot().catch((err) => {
  console.error(err)
  setStatus('Bridge init failed', false)
})
