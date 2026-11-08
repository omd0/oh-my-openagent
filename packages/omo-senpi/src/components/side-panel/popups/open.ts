import { formatCount } from "../format/counts"
import { sanitizeTerminalText } from "../format/sanitize"
import type { PanelOverlayUi, PanelRow } from "../types"
import { createTextPopup } from "./text-popup"

/** The popup owns its own height; a percentage cap here would fight it and cost the bottom border. */
export const OVERLAY_OPTIONS: Record<string, unknown> = {
  overlay: true,
  overlayOptions: { width: "70%", minWidth: 52, maxHeight: "100%", anchor: "center" },
}

/**
 * The no-overlay notice carries at most this many rows, and at most this many characters in total: the
 * title and the body together. A viewer can hold far more than a notification is for, so past either
 * limit the notice says how many rows it left out.
 */
export const PLAIN_VIEWER_ROWS = 20
export const PLAIN_VIEWER_CHARS = 4096

/** The most of the title the notice keeps; a file path can be longer than the notice is for. */
const TITLE_CHARS = 512

/** Room kept back for the omission line, so the body always fits the budget it was given. */
const OMISSION_RESERVE = 64

/**
 * The body text a host without the overlay seam is shown in place of the viewer, within `budget`
 * characters. Each row is cut before it is sanitized, so a huge row costs a bounded amount of work, and
 * the omission line names what was left out.
 */
export function plainViewerText(rows: readonly PanelRow[], budget: number = PLAIN_VIEWER_CHARS): string {
  const lines: string[] = []
  let used = 0
  const limit = Math.max(0, budget - OMISSION_RESERVE)
  for (const row of rows.slice(0, PLAIN_VIEWER_ROWS)) {
    const line = sanitizeTerminalText(row.text.slice(0, limit))
    if (used + line.length + 1 > limit) break
    lines.push(line)
    used += line.length + 1
  }
  const omitted = rows.length - lines.length
  if (omitted > 0) lines.push(`… ${formatCount(omitted)} more row${omitted === 1 ? "" : "s"} not shown`)
  return lines.join("\n")
}

/**
 * Open the shared framed viewer. One function for every entry point, so a click and a command
 * cannot drift apart on borders, scrolling or close keys. Wheel and keys reach the viewer through
 * the host's overlay dispatch, so nothing is registered here that could outlive it.
 */
export async function openPanelViewer(ui: PanelOverlayUi, title: string, rows: readonly PanelRow[]): Promise<void> {
  if (ui.custom === undefined) {
    // The title is bounded before it is sanitized, and the body gets whatever budget the title leaves,
    // so the whole notification stays within PLAIN_VIEWER_CHARS.
    const shownTitle = sanitizeTerminalText(title.slice(0, TITLE_CHARS))
    const body = plainViewerText(rows, PLAIN_VIEWER_CHARS - shownTitle.length - 1)
    ui.notify(`${shownTitle}\n${body}`, "info")
    return
  }
  await ui.custom(
    (tui, theme, _keybindings, done) => createTextPopup(tui, theme, { title, rows: () => rows, close: () => done(undefined) }),
    OVERLAY_OPTIONS,
  )
}
