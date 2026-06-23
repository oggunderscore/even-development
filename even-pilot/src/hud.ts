import {
  type EvenAppBridge,
  CreateStartUpPageContainer,
  RebuildPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
} from '@evenrealities/even_hub_sdk'
import { type Layout, type ComponentId, cellRect, rowOf, DEFAULT_LAYOUT } from './layout'

const CID: Record<ComponentId, number> = { direction: 1, limit: 2, speed: 3, location: 4 }

// Leading newlines to push content toward vertical center / bottom of a 96px cell.
// Top row: content sits flush at line 1 — no padding.
// Mid row: one blank line visually centers a short value.
// Bot row: two blank lines push content toward the bottom edge.
const ROW_PAD: Record<'top' | 'mid' | 'bot', string> = { top: '', mid: '\n', bot: '\n\n' }

export class HUD {
  currentSpeed     = '-- mph'
  currentLimit     = '--'
  currentDirection = '--'
  currentLocation  = 'Acquiring GPS...'

  private layout: Layout = { ...DEFAULT_LAYOUT }

  constructor(private readonly bridge: EvenAppBridge) {}

  private content(id: ComponentId): string {
    const row = rowOf(this.layout[id])
    const pad = ROW_PAD[row]

    switch (id) {
      case 'speed':     return pad + this.currentSpeed
      case 'limit':     return pad + limitDisplay(this.currentLimit)
      case 'direction': return pad + this.currentDirection
      case 'location':  return pad + this.currentLocation
    }
  }

  private containers(layout: Layout): TextContainerProperty[] {
    this.layout = layout
    return (Object.keys(layout) as ComponentId[]).map(id => {
      const r = cellRect(layout[id])
      return new TextContainerProperty({
        containerID: CID[id], containerName: id,
        xPosition: r.x, yPosition: r.y, width: r.w, height: r.h,
        borderWidth: 0, borderColor: 0, paddingLength: 4,
        content: this.content(id),
        isEventCapture: id === 'speed' ? 1 : 0,
      })
    })
  }

  async init(layout: Layout): Promise<number> {
    const c = this.containers(layout)
    return this.bridge.createStartUpPageContainer(
      new CreateStartUpPageContainer({ containerTotalNum: c.length, textObject: c }),
    )
  }

  async rebuild(layout: Layout): Promise<void> {
    const c = this.containers(layout)
    await this.bridge.rebuildPageContainer(
      new RebuildPageContainer({ containerTotalNum: c.length, textObject: c }),
    )
  }

  async updateSpeed(text: string): Promise<void> {
    if (this.currentSpeed === text) return
    this.currentSpeed = text
    await this.bridge.textContainerUpgrade(
      new TextContainerUpgrade({ containerID: CID.speed, containerName: 'speed', content: this.content('speed') }),
    )
  }

  async updateSpeedLimit(text: string): Promise<void> {
    if (this.currentLimit === text) return
    this.currentLimit = text
    await this.bridge.textContainerUpgrade(
      new TextContainerUpgrade({ containerID: CID.limit, containerName: 'limit', content: this.content('limit') }),
    )
  }

  async updateDirection(text: string): Promise<void> {
    if (this.currentDirection === text) return
    this.currentDirection = text
    await this.bridge.textContainerUpgrade(
      new TextContainerUpgrade({ containerID: CID.direction, containerName: 'direction', content: this.content('direction') }),
    )
  }

  async updateLocation(text: string): Promise<void> {
    if (this.currentLocation === text) return
    this.currentLocation = text
    await this.bridge.textContainerUpgrade(
      new TextContainerUpgrade({ containerID: CID.location, containerName: 'location', content: this.content('location') }),
    )
  }
}

function limitDisplay(raw: string): string {
  return `${raw} max`
}
