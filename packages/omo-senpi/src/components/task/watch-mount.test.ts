import { describe, expect, it } from "bun:test"

import { TUI, type Terminal } from "@earendil-works/pi-tui"

import { Theme } from "../../senpi-test-runtime"
import { mountSubagentWatch, type WatchHolder, type WatchUi } from "./watch-mount"
import type { ThreadService } from "./subagent-ui/types"

const CTRL_Q = "\x11"

// A real TUI over an in-memory terminal: never touches stdin/stdout, writes
// buffer, start/stop are no-ops, dimensions fixed. The TUI itself is never started.
class MemoryTerminal implements Terminal {
  private readonly chunks: string[] = []
  start(): void {}
  stop(): void {}
  async drainInput(): Promise<void> {}
  write(data: string): void {
    this.chunks.push(data)
  }
  get columns(): number {
    return 80
  }
  get rows(): number {
    return 24
  }
  get kittyProtocolActive(): boolean {
    return false
  }
  moveBy(): void {}
  hideCursor(): void {}
  showCursor(): void {}
  clearLine(): void {}
  clearFromCursor(): void {}
  clearScreen(): void {}
  setTitle(): void {}
  setProgress(): void {}
}

const TEST_FG_COLORS = {
  accent: "#000000",
  bashMode: "#000000",
  border: "#000000",
  borderAccent: "#000000",
  borderMuted: "#000000",
  customMessageLabel: "#000000",
  customMessageText: "#000000",
  dim: "#000000",
  error: "#000000",
  mdCode: "#000000",
  mdCodeBlock: "#000000",
  mdCodeBlockBorder: "#000000",
  mdHeading: "#000000",
  mdHr: "#000000",
  mdLink: "#000000",
  mdLinkUrl: "#000000",
  mdListBullet: "#000000",
  mdQuote: "#000000",
  mdQuoteBorder: "#000000",
  muted: "#000000",
  success: "#000000",
  syntaxComment: "#000000",
  syntaxFunction: "#000000",
  syntaxKeyword: "#000000",
  syntaxNumber: "#000000",
  syntaxOperator: "#000000",
  syntaxPunctuation: "#000000",
  syntaxString: "#000000",
  syntaxType: "#000000",
  syntaxVariable: "#000000",
  text: "#000000",
  thinkingHigh: "#000000",
  thinkingLow: "#000000",
  thinkingMax: "#000000",
  thinkingMedium: "#000000",
  thinkingMinimal: "#000000",
  thinkingOff: "#000000",
  thinkingText: "#000000",
  thinkingXhigh: "#000000",
  toolDiffAdded: "#000000",
  toolDiffContext: "#000000",
  toolDiffRemoved: "#000000",
  toolOutput: "#000000",
  toolTitle: "#000000",
  userMessageText: "#000000",
  warning: "#000000",
} as const satisfies ConstructorParameters<typeof Theme>[0]
const TEST_BG_COLORS = {
  customMessageBg: "#000000",
  selectedBg: "#000000",
  toolErrorBg: "#000000",
  toolPendingBg: "#000000",
  toolSuccessBg: "#000000",
  userMessageBg: "#000000",
} as const satisfies ConstructorParameters<typeof Theme>[1]
const TEST_THEME = new Theme(TEST_FG_COLORS, TEST_BG_COLORS, "truecolor")

function testTui(): TUI {
  return new TUI(new MemoryTerminal())
}

function stubService(): ThreadService {
  return {
    list: () => [],
    observeTranscript: () => Promise.reject(new Error("not under test")),
    steer: () => Promise.reject(new Error("not under test")),
  }
}

describe("mountSubagentWatch", () => {
  it("#given a mount #when the overlay opens #then it requests a fullscreen overlay and releases the holder afterwards", async () => {
    // given
    const holder: WatchHolder = { current: undefined }
    const notifications: string[] = []
    let heldDuring = false
    let overlayOptions: unknown
    const ui: WatchUi = {
      notify: (message) => notifications.push(message),
      custom: async (_factory, options) => {
        heldDuring = holder.current !== undefined
        overlayOptions = options
      },
    }

    // when
    await mountSubagentWatch(holder, { ui, service: stubService(), parentId: "session-a", currentParentId: () => "session-a" })

    // then the holder was held for exactly the overlay's lifetime
    expect(heldDuring).toBe(true)
    expect(holder.current).toBeUndefined()
    expect(overlayOptions).toMatchObject({ overlay: true, overlayOptions: { width: "100%", row: 0, col: 0 } })
    expect(notifications).toHaveLength(0)
  })

  it("#given a close before the overlay factory runs #when the factory runs #then it closes at once and the holder is released", async () => {
    // given a close that lands before the factory runs
    const holder: WatchHolder = { current: undefined }
    const notifications: string[] = []
    const tui = testTui()
    let doneCalls = 0
    let rendered: string[] | undefined
    const ui: WatchUi = {
      notify: (message) => notifications.push(message),
      custom: async (factory) => {
        holder.current?.close()
        const surface = factory(tui, TEST_THEME, {}, () => {
          doneCalls += 1
        }) as { render(width: number): string[]; handleInput(data: string): void; invalidate(): void }
        rendered = surface.render(80)
        surface.handleInput("x")
        surface.invalidate()
      },
    }

    // when
    await mountSubagentWatch(holder, { ui, service: stubService(), parentId: "session-a", currentParentId: () => "session-a" })
    tui.stop()

    // then the factory closed at once: done ran, the dummy paints nothing, the holder is free
    expect(doneCalls).toBe(1)
    expect(rendered).toEqual([])
    expect(holder.current).toBeUndefined()
    expect(notifications).toHaveLength(0)
  })

  it("#given a throwing overlay #when mounting #then the failure is reported and the holder is released", async () => {
    // given an overlay that fails to open
    const holder: WatchHolder = { current: undefined }
    const notifications: string[] = []
    const ui: WatchUi = {
      notify: (message) => notifications.push(message),
      custom: async () => {
        throw new Error("boom")
      },
    }

    // when
    await mountSubagentWatch(holder, { ui, service: stubService(), parentId: "session-a", currentParentId: () => "session-a" })

    // then
    expect(notifications).toEqual(["Watch failed: boom"])
    expect(holder.current).toBeUndefined()
  })

  it("#given an open watch #when the session switches #then input closes the watch and frees the holder", async () => {
    // given a mounted watch backed by a real tree surface
    const holder: WatchHolder = { current: undefined }
    const notifications: string[] = []
    const tui = testTui()
    let current: string | undefined = "session-a"
    let doneCalls = 0
    let surface: { handleInput(data: string): void } | undefined
    const ui: WatchUi = {
      notify: (message) => notifications.push(message),
      custom: async (factory) => {
        await new Promise<void>((resolve) => {
          const created = factory(tui, TEST_THEME, {}, () => {
            doneCalls += 1
            resolve()
          }) as { handleInput(data: string): void }
          surface = created
        })
      },
    }
    const mounted = mountSubagentWatch(holder, { ui, service: stubService(), parentId: "session-a", currentParentId: () => current })
    for (let i = 0; i < 1000 && surface === undefined; i++) await Promise.resolve()
    if (surface === undefined) throw new Error("watch surface never mounted")
    expect(holder.current).toBeDefined()

    // when the session switches under the open watch and input arrives
    current = "session-b"
    surface.handleInput("x")
    await mounted
    tui.stop()

    // then the watch closed and the shared holder is free
    expect(doneCalls).toBe(1)
    expect(holder.current).toBeUndefined()
  })

  it("#given an open watch #when Ctrl+Q arrives #then the watch ends", async () => {
    // given a mounted watch backed by a real tree surface
    const holder: WatchHolder = { current: undefined }
    const notifications: string[] = []
    const tui = testTui()
    let doneCalls = 0
    let surface: { handleInput(data: string): void } | undefined
    const ui: WatchUi = {
      notify: (message) => notifications.push(message),
      custom: async (factory) => {
        await new Promise<void>((resolve) => {
          const created = factory(tui, TEST_THEME, {}, () => {
            doneCalls += 1
            resolve()
          }) as { handleInput(data: string): void }
          surface = created
        })
      },
    }
    const mounted = mountSubagentWatch(holder, { ui, service: stubService(), parentId: "session-a", currentParentId: () => "session-a" })
    for (let i = 0; i < 1000 && surface === undefined; i++) await Promise.resolve()
    if (surface === undefined) throw new Error("watch surface never mounted")

    // when Ctrl+Q arrives (claimed by the container on either screen)
    surface.handleInput(CTRL_Q)
    await mounted
    tui.stop()

    // then
    expect(doneCalls).toBe(1)
    expect(holder.current).toBeUndefined()
  })
})
