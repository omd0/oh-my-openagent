import { describe, expect, test } from "bun:test"

import type { PanelOverlayUi, PanelPopupFactory, PanelRow, PopupTui } from "../types"
import type { PopupComponent } from "./text-popup"

import { openPanelViewer, PLAIN_VIEWER_CHARS, PLAIN_VIEWER_ROWS, plainViewerText } from "./open"

interface FakeUi extends PanelOverlayUi {
  readonly notices: string[]
  readonly listeners: Array<(data: string) => { consume?: boolean; data?: string } | undefined>
  readonly unsubscribed: number[]
  readonly renders: () => number
  readonly mounted: () => PopupComponent | undefined
  rendered(): readonly string[]
  close(): void
}

function fakeUi(options: { overlay?: boolean; rawInput?: boolean } = {}): FakeUi {
  const notices: string[] = []
  const listeners: FakeUi["listeners"] = []
  const unsubscribed: number[] = []
  let renders = 0
  let component: PopupComponent | undefined
  let finish: (() => void) | undefined
  const tui: PopupTui = {
    requestRender: () => {
      renders += 1
    },
  }
  const ui: FakeUi = {
    notices,
    listeners,
    unsubscribed,
    renders: () => renders,
    mounted: () => component,
    notify(message) {
      notices.push(message)
    },
    rendered: () => component?.render(60) ?? [],
    close: () => finish?.(),
    ...(options.overlay === false
      ? {}
      : {
          custom(factory: PanelPopupFactory) {
            return new Promise<unknown>((resolve) => {
              const done = (): void => resolve(undefined)
              finish = done
              const built = factory(tui, undefined, undefined, done)
              component = built as PopupComponent
            })
          },
        }),
    ...(options.rawInput === false
      ? {}
      : {
          onTerminalInput(handler: FakeUi["listeners"][number]) {
            listeners.push(handler)
            const index = listeners.length - 1
            return () => unsubscribed.push(index)
          },
        }),
  }
  return ui
}

const body = (count: number): readonly PanelRow[] =>
  Array.from({ length: count }, (_value, index) => ({ text: `line ${index + 1}` }))

describe("openPanelViewer", () => {
  test("#given an open viewer #when a native wheel arrives #then the viewport moves and the event is claimed", async () => {
    // given
    const ui = fakeUi()
    const opened = openPanelViewer(ui, "title", body(60))
    const before = ui.rendered().join("\n")
    const viewer = ui.mounted()
    if (viewer === undefined) throw new Error("the viewer never mounted through ui.custom")

    // when
    const result = viewer.handleMouse({ type: "wheel", wheelDelta: 3 })

    // then the overlay consumes the wheel so the transcript behind never scrolls
    expect(result).toEqual({ handled: true })
    expect(ui.renders()).toBeGreaterThan(0)
    expect(ui.rendered().join("\n")).not.toBe(before)

    ui.close()
    await opened
  })

  test("#given an open viewer #when an unusable wheel arrives #then nothing is claimed and the view does not move", async () => {
    // given
    const ui = fakeUi()
    const opened = openPanelViewer(ui, "title", body(60))
    const viewer = ui.mounted()
    if (viewer === undefined) throw new Error("the viewer never mounted through ui.custom")
    const before = ui.rendered().join("\n")
    const paints = ui.renders()

    // when
    const outcomes = [
      viewer.handleMouse({ type: "wheel" }),
      viewer.handleMouse({ type: "wheel", wheelDelta: Number.NaN }),
      viewer.handleMouse({ type: "click", wheelDelta: 3 }),
    ]

    // then
    expect(outcomes).toEqual([undefined, undefined, undefined])
    expect(ui.rendered().join("\n")).toBe(before)
    expect(ui.renders()).toBe(paints)

    ui.close()
    await opened
  })

  test("#given an open viewer #when keys arrive #then close keys resolve and other keys leave it open", async () => {
    // given
    const ui = fakeUi()
    const opened = openPanelViewer(ui, "title", body(60))
    const viewer = ui.mounted()
    if (viewer === undefined) throw new Error("the viewer never mounted through ui.custom")

    // when / then an ordinary keystroke leaves the viewer mounted
    viewer.handleInput("z")
    expect(ui.mounted()).toBe(viewer)

    // when the close key arrives it resolves the overlay promise
    viewer.handleInput("q")
    await opened

    // then no raw-input listener was ever registered on the native host path
    expect(ui.listeners).toEqual([])
    expect(ui.unsubscribed).toEqual([])
  })

  test("#given a host with no raw-input seam #when opened #then the viewer still works", async () => {
    // given
    const ui = fakeUi({ rawInput: false })

    // when
    const opened = openPanelViewer(ui, "title", body(4))
    expect(ui.rendered().length).toBeGreaterThan(0)
    ui.close()
    await opened

    // then
    expect(ui.notices).toEqual([])
  })

  test("#given a host with no overlay seam #when opened #then the title heads the rows as one notification", async () => {
    // given
    const ui = fakeUi({ overlay: false })

    // when
    await openPanelViewer(ui, "title", body(2))

    // then
    expect(ui.notices).toEqual(["title\nline 1\nline 2"])
  })
})

describe("openPanelViewer notice fallback", () => {
  test("#given a host without the overlay seam #when rows carry terminal controls #then the notice carries none of them", async () => {
    // given
    const ui = fakeUi({ overlay: false })

    // when
    await openPanelViewer(ui, "title", [{ text: "a\x1b[2Jb" }, { text: "c\x07d" }])

    // then: one line per row survives, the controls do not, under the title
    expect(ui.notices).toEqual(["title\na[2Jb\ncd"])
  })

  test("#given more rows than the notice is for #when the fallback text is built #then it stops at twenty rows and says what was left out", () => {
    // given
    const rows = body(PLAIN_VIEWER_ROWS + 5)

    // when
    const text = plainViewerText(rows)

    // then
    const lines = text.split("\n")
    expect(lines.length).toBeLessThanOrEqual(PLAIN_VIEWER_ROWS + 1)
    expect(lines[lines.length - 1]).toContain("more row")
  })

  test("#given a huge title and body #when opened without the overlay seam #then the whole notification stays within budget and names the omission", async () => {
    // given a title longer than the notice keeps and a body larger than it is for
    const ui = fakeUi({ overlay: false })
    const title = "t".repeat(2000)
    const rows: readonly PanelRow[] = Array.from({ length: 60 }, () => ({ text: "x".repeat(400) }))

    // when
    await openPanelViewer(ui, title, rows)

    // then the title and the body share one budget, so a bounded title cannot push it over
    expect(ui.notices).toHaveLength(1)
    const notice = ui.notices[0] ?? ""
    expect(notice.length).toBeLessThanOrEqual(PLAIN_VIEWER_CHARS)
    expect(notice).toContain("more row")
  })
})
