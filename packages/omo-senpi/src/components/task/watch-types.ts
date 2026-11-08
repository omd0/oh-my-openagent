// Structural ports for the watch surface: the host UI it draws into and the theme it paints with.
// What the watch reads and steers is described by `WatchSource` (watch-source.ts), not here.
export type WatchColor = "accent" | "dim" | "muted" | "text" | "error" | "warning" | "success"

export interface WatchTheme {
  fg(color: WatchColor, text: string): string
}

export interface WatchTui {
  readonly terminal?: { readonly rows?: number }
  requestRender(force?: boolean): void
}

export type WatchPopupFactory = (
  tui: WatchTui,
  theme: WatchTheme | undefined,
  keybindings: unknown,
  done: (value?: unknown) => void,
) => unknown

// Overlay-capable slice of the host UI. `custom` is absent on hosts without the overlay seam, and
// `onTerminalInput` exists only in interactive mode; both are optional so the watch degrades cleanly.
export interface WatchUi {
  notify(message: string, type?: "info" | "warning" | "error"): void
  onTerminalInput?(handler: (data: string) => { consume?: boolean } | undefined): () => void
  custom?(factory: WatchPopupFactory, options?: Record<string, unknown>): Promise<unknown>
}

// The pi-tui namespace the watch popup draws with. The task component loads it once at registration
// and hands it in, so the watch never reaches for the lazy loader itself.
export type WatchPiTui = typeof import("@earendil-works/pi-tui")
