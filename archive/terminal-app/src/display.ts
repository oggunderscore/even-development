// G2 display manager for the terminal app.
//
// Layout (576 × 288 px):
//   y=  0  h=30  Container 1: status bar  ("Connected" / "Disconnected")
//   y= 30  h=216 Container 2: output      (ring-buffered PTY lines, scrollable)
//   y=246  h=42  Container 3: mic status  ("○ Tap to speak" / "● Listening...")

import {
  CreateStartUpPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge,
} from '@evenrealities/even_hub_sdk'

type Bridge = Awaited<ReturnType<typeof waitForEvenAppBridge>>

const ID_STATUS = 1
const ID_OUTPUT = 2
const ID_MIC    = 3

const VISIBLE_LINES   = 7    // lines visible in the output container at once
const RING_BUFFER_MAX = 100  // total lines kept in memory

export class Display {
  private readonly bridge: Bridge
  private lines: string[] = []
  private scrollOffset = 0  // 0 = follow newest output; N = N lines back from newest

  constructor(bridge: Bridge) {
    this.bridge = bridge
  }

  async init(): Promise<number> {
    const page = new CreateStartUpPageContainer({
      containerTotalNum: 3,
      textObject: [
        new TextContainerProperty({
          containerID:   ID_STATUS,
          containerName: 'status',
          xPosition: 0, yPosition: 0,
          width: 576,   height: 30,
          content: 'Connecting...',
          isEventCapture: 0,
        }),
        new TextContainerProperty({
          containerID:   ID_OUTPUT,
          containerName: 'output',
          xPosition: 0, yPosition: 30,
          width: 576,   height: 216,
          content: '',
          isEventCapture: 1,  // event capture lives here
        }),
        new TextContainerProperty({
          containerID:   ID_MIC,
          containerName: 'mic',
          xPosition: 0, yPosition: 246,
          width: 576,   height: 42,
          content: '○ Tap to speak',
          isEventCapture: 0,
        }),
      ],
    })
    return this.bridge.createStartUpPageContainer(page)
  }

  setStatus(text: string) {
    void this.bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: ID_STATUS, content: text }))
  }

  setMicStatus(text: string) {
    void this.bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: ID_MIC, content: text }))
  }

  pushLine(line: string) {
    if (!line.trim()) return
    this.lines.push(line)
    if (this.lines.length > RING_BUFFER_MAX) this.lines.shift()
    // Only re-render if the user is watching the live tail
    if (this.scrollOffset === 0) this.render()
  }

  // Scroll toward older output (one page back)
  scrollBack() {
    const maxOffset = Math.max(0, this.lines.length - VISIBLE_LINES)
    this.scrollOffset = Math.min(this.scrollOffset + VISIBLE_LINES, maxOffset)
    this.render()
  }

  // Scroll toward newer output (one page forward)
  scrollForward() {
    this.scrollOffset = Math.max(0, this.scrollOffset - VISIBLE_LINES)
    this.render()
  }

  private render() {
    const end   = this.lines.length - this.scrollOffset
    const start = Math.max(0, end - VISIBLE_LINES)
    const content = this.lines.slice(start, end).join('\n')
    void this.bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: ID_OUTPUT, content }))
  }
}
