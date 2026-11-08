import type { Theme } from "@code-yeongyu/senpi"
import { Key, matchesKey, type TUI, type TuiMouseEvent, type TuiMouseEventResult } from "@earendil-works/pi-tui"

import { fillViewport, LiveAgentView, type AgentViewportState } from "./subagent-ui/live-agent-view"
import { StatusDialog } from "./subagent-ui/status-ui"
import type { ThreadService } from "./subagent-ui/types"

// The upstream overlay geometry (ui/status-ui.ts, AgentNavigationController.open): fullscreen, at 0,0.
const WATCH_OVERLAY_OPTIONS = {
  overlay: true,
  overlayOptions: { width: "100%", maxHeight: "100%", row: 0, col: 0, margin: 0 },
} as const

// The upstream tree title. StatusDialog counts the rows only when its title is exactly this.
const TREE_TITLE = "Agents tree"

export interface WatchUi {
  notify(message: string, type?: "info" | "warning" | "error"): void
  custom?(factory: WatchFactory, options?: Record<string, unknown>): Promise<unknown>
}

type WatchFactory = (tui: TUI, theme: Theme, keybindings: unknown, done: (value?: unknown) => void) => unknown

// The one open watch a command owns. A session shutdown closes it through this handle.
export interface WatchHolder {
  current: { close(): void } | undefined
}

export function createWatchHolder(): WatchHolder {
  return { current: undefined }
}

export interface WatchMountOptions {
  readonly ui: WatchUi
  readonly service: ThreadService
  readonly parentId: string
  // Read at every input and paint, so a session that changed under the open watch closes before it acts.
  readonly currentParentId: () => string | undefined
  readonly initialPath?: string
}

interface Child {
  render(width: number): string[]
  handleInput(data: string): void
  handleMouse?(event: TuiMouseEvent): TuiMouseEventResult | undefined
  invalidate(): void
  dispose(): void
}

// Hosts the vendored tree and the vendored watch screen in one overlay. Opening a node swaps the child
// view, as the upstream DialogSession does, so the overlay never stacks a second one.
class WatchSurface {
  private child: Child | undefined
  private closed = false
  private readonly viewports = new Map<string, AgentViewportState>()

  constructor(
    private readonly host: TUI,
    private readonly theme: Theme,
    private readonly options: WatchMountOptions,
    private readonly finish: () => void,
  ) {}

  start(): void {
    if (this.options.initialPath !== undefined) this.showWatch(this.options.initialPath)
    else this.showTree(undefined)
  }

  // Ends the watch and asks the overlay to close. Safe to call more than once.
  close(): void {
    if (this.closed) return
    this.dispose()
    this.finish()
  }

  // Releases the child view and its timers without asking the overlay to close.
  dispose(): void {
    if (this.closed) return
    this.closed = true
    this.disposeChild()
  }

  render(width: number): string[] {
    if (this.stillBound() === false) return []
    const rows = this.host.terminal?.rows ?? 24
    return fillViewport(this.child?.render(width) ?? [], width, rows)
  }

  handleInput(data: string): void {
    if (this.stillBound() === false) return
    // Ctrl+Q ends the whole watch from either screen. StatusDialog only reads it when navigation is
    // provided, and this surface never provides it, so the container claims the key first.
    if (matchesKey(data, Key.ctrl("q"))) {
      this.close()
      return
    }
    this.child?.handleInput(data)
  }

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (this.stillBound() === false) return undefined
    return this.child?.handleMouse?.(event)
  }

  invalidate(): void {
    this.child?.invalidate()
  }

  private stillBound(): boolean {
    if (this.closed) return false
    if (this.options.currentParentId() === this.options.parentId) return true
    this.close()
    return false
  }

  private showTree(selected: string | undefined): void {
    this.disposeChild()
    const dialog = new StatusDialog(
      this.host,
      this.theme,
      this.options.service,
      (path) => {
        if (path === undefined) this.close()
        else this.showWatch(path)
      },
      selected,
      TREE_TITLE,
      undefined,
      false,
      "circle",
    )
    dialog.startRefresh()
    this.child = dialog
    this.host.requestRender()
  }

  private showWatch(path: string): void {
    this.disposeChild()
    let viewport = this.viewports.get(path)
    if (viewport === undefined) {
      viewport = { scrollTop: 0, follow: true }
      this.viewports.set(path, viewport)
    }
    this.child = new LiveAgentView(
      this.host,
      this.theme,
      this.options.service,
      path,
      viewport,
      (result) => {
        // Esc returns to the tree without touching the child; Ctrl+Q ends the whole watch.
        if (result === "back") this.showTree(path)
        else this.close()
      },
      false,
      "circle",
    )
    this.host.requestRender()
  }

  private disposeChild(): void {
    const child = this.child
    this.child = undefined
    child?.dispose()
  }
}

// Mounts one watch overlay. Callers refuse a second watch while one is open, so overlays never stack.
// Every exit path (done, error, shutdown) releases the child views, their timers and the popup.
export async function mountSubagentWatch(holder: WatchHolder, options: WatchMountOptions): Promise<void> {
  const { ui } = options
  const custom = ui.custom
  if (custom === undefined) return
  let doneFn: ((value?: unknown) => void) | undefined
  let surface: WatchSurface | undefined
  // A close that lands before the overlay factory runs wins: the factory closes at once.
  let requested = false
  holder.current = {
    close: () => {
      requested = true
      if (surface !== undefined) surface.close()
      else doneFn?.(undefined)
    },
  }
  try {
    await custom((tui, theme, _keys, done) => {
      doneFn = done
      if (requested) {
        done(undefined)
        return { render: () => [], handleInput: () => {}, invalidate: () => {} }
      }
      const created = new WatchSurface(tui, theme, options, () => done(undefined))
      surface = created
      created.start()
      return created
    }, WATCH_OVERLAY_OPTIONS)
  } catch (error) {
    ui.notify(`Watch failed: ${error instanceof Error ? error.message : String(error)}`, "error")
  } finally {
    surface?.dispose()
    holder.current = undefined
  }
}
