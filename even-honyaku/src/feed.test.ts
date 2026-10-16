import { describe, expect, it } from 'vitest'
import { Feed, VIEW_ROWS, wrapLine, wrapText } from './feed'

const fill = (f: Feed, n: number) => {
  for (let i = 1; i <= n; i++) f.add(`row ${i}`)
}

describe('wrapping', () => {
  it('keeps short lines whole and wraps long ones at word boundaries', () => {
    expect(wrapLine('hello there')).toEqual(['hello there'])
    const rows = wrapLine('this is a rather long sentence that should not fit on a single row of the glasses display at all')
    expect(rows.length).toBeGreaterThan(1)
    expect(rows.join(' ')).toBe('this is a rather long sentence that should not fit on a single row of the glasses display at all')
  })
  it('splits a word that is wider than a row', () => {
    expect(wrapLine('W'.repeat(80)).length).toBeGreaterThan(1)
    // ...even when it follows a short word on the same line
    const rows = wrapLine('> ' + 'W'.repeat(60))
    expect(rows[0]).toBe('>')
    expect(rows.join('')).toBe('>' + 'W'.repeat(60))
  })
  it('wraps each logical line separately', () => {
    expect(wrapText('you: hi\n> konnichiwa')).toEqual(['you: hi', '> konnichiwa'])
  })
})

describe('Feed', () => {
  it('lays out from the top, newest at the bottom', () => {
    const f = new Feed()
    fill(f, 3)
    expect(f.visible()).toEqual(['row 1', 'row 2', 'row 3'])
  })

  it('follows the newest rows once the window is full', () => {
    const f = new Feed()
    fill(f, VIEW_ROWS + 3)
    expect(f.visible()).toHaveLength(VIEW_ROWS)
    expect(f.visible().at(-1)).toBe(`row ${VIEW_ROWS + 3}`)
    expect(f.visible()[0]).toBe('row 4')
  })

  it('scrolling up pushes rows off the top, one row at a time, until the view is empty', () => {
    const f = new Feed()
    fill(f, 4)
    expect(f.scroll('up')).toBe(true)
    expect(f.visible()).toEqual(['row 2', 'row 3', 'row 4'])
    f.scroll('up'); f.scroll('up')
    expect(f.visible()).toEqual(['row 4'])
    f.scroll('up')
    expect(f.visible()).toEqual([])
    expect(f.cleared).toBe(true)
    expect(f.scroll('up')).toBe(false) // nothing further to hide
  })

  it('scrolling down brings earlier rows back, down to the very first', () => {
    const f = new Feed()
    fill(f, 20)
    for (let i = 0; i < 40; i++) f.scroll('down')
    expect(f.visible()[0]).toBe('row 1')
    expect(f.scroll('down')).toBe(false)
    f.scroll('up')
    expect(f.visible()[0]).toBe('row 2')
  })

  it('a long history can be scrolled all the way off and back', () => {
    const f = new Feed()
    fill(f, 20)
    let up = 0
    while (f.scroll('up')) up++
    expect(up).toBe(7) // from the follow position (start 13) to the end (20)
    expect(f.cleared).toBe(true)
    let down = 0
    while (f.scroll('down')) down++
    expect(down).toBe(20)
    expect(f.visible()[0]).toBe('row 1')
  })

  it('after clearing, new translations appear on their own, from the top', () => {
    const f = new Feed()
    fill(f, 4)
    for (let i = 0; i < 4; i++) f.scroll('up')
    f.add('fresh 1')
    expect(f.visible()).toEqual(['fresh 1'])
    f.add('fresh 2')
    expect(f.visible()).toEqual(['fresh 1', 'fresh 2'])
    f.scroll('down') // the hidden history is still one swipe away
    expect(f.visible().at(0)).toBe('row 4')
  })

  it('stays pinned to the newest rows after clearing, once new rows overflow the window', () => {
    const f = new Feed()
    fill(f, 4)
    for (let i = 0; i < 4; i++) f.scroll('up')
    for (let i = 1; i <= VIEW_ROWS + 2; i++) f.add(`n${i}`)
    expect(f.visible()).toHaveLength(VIEW_ROWS)
    expect(f.visible().at(-1)).toBe(`n${VIEW_ROWS + 2}`)
  })

  it('a new translation while reading history jumps back to the newest rows', () => {
    const f = new Feed()
    fill(f, 20)
    f.scroll('down'); f.scroll('down')
    expect(f.visible().at(-1)).toBe('row 18')
    f.add('latest')
    expect(f.visible().at(-1)).toBe('latest')
  })

  it('the interim phrase sits below finished rows and is replaced by the final one', () => {
    const f = new Feed()
    fill(f, 2)
    f.setLive('you: hel…')
    expect(f.visible()).toEqual(['row 1', 'row 2', 'you: hel…'])
    f.add('you: hello')
    expect(f.visible()).toEqual(['row 1', 'row 2', 'you: hello'])
  })

  it('scrolls a whole entry at a time, so a pair of lines moves together', () => {
    const f = new Feed()
    for (let i = 1; i <= 6; i++) f.add(`you: q${i}\n> a${i}`)
    // 12 rows, 7 visible, following the newest: starts mid-entry at row 5
    expect(f.visible()).toEqual(['> a3', 'you: q4', '> a4', 'you: q5', '> a5', 'you: q6', '> a6'])
    f.scroll('up') // next entry boundary is row 6 (q4)
    expect(f.visible()).toEqual(['you: q4', '> a4', 'you: q5', '> a5', 'you: q6', '> a6'])
    f.scroll('up')
    expect(f.visible()).toEqual(['you: q5', '> a5', 'you: q6', '> a6'])
    f.scroll('up'); f.scroll('up')
    expect(f.visible()).toEqual([])
    f.scroll('down')
    expect(f.visible()).toEqual(['you: q6', '> a6'])
    f.scroll('down')
    expect(f.visible()).toEqual(['you: q5', '> a5', 'you: q6', '> a6'])
    while (f.scroll('down')) { /* to the top */ }
    expect(f.visible()[0]).toBe('you: q1')
  })

  it('treats a wrapped translation as one entry', () => {
    const f = new Feed()
    f.add('you: ' + 'word '.repeat(40).trim() + '\n> ok') // wraps to several rows
    f.add('you: next\n> two')
    const before = f.visible().length
    f.scroll('up')
    expect(f.visible()).toEqual(['you: next', '> two'])
    expect(before).toBeGreaterThan(f.visible().length)
  })
})
