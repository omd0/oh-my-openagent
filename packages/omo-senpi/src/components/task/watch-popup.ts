import { sanitizeTerminalText } from "../side-panel/format/sanitize"
import type { WatchPiTui, WatchTheme, WatchTui } from "./watch-types"
import type { WatchRow } from "./watch-source"
import type { WatchView, WatchViewer } from "./watch-viewer"
import { fitLines, paintText, renderWatchTree, type WatchPaint } from "./watch-tree"

export interface WatchComponent {
  render(width: number): string[]
  handleInput(data: string): void
  invalidate(): void
  dispose(): void
}

// The fullscreen watch surface: the tree of one owner's items, then the live watch screen for one of
// them. Both screens share this one overlay, so opening an item never stacks a second overlay.
export function createWatchPopup(pi: WatchPiTui, tui: WatchTui, theme: WatchTheme | undefined, viewer: WatchViewer): WatchComponent {
  const input = new pi.Input({ prompt: "Steer > " })
  input.focused = true
  let pasting = false
  input.onSubmit = (value: string) => {
    viewer
      .submit(value)
      .then((submission) => {
        // Only an accepted send for the item still on screen clears the draft; a refusal keeps it, and
        // a send that settled after the user moved on never touches the draft for another item.
        if (submission?.current === true && submission.report.accepted && input.getValue() === value) input.setValue("")
        tui.requestRender()
      })
      .catch(() => tui.requestRender())
  }

  const paint = (): WatchPaint => ({
    theme,
    truncate: (line, width) => pi.truncateToWidth(line, width, ""),
    visible: (line) => pi.visibleWidth(line),
  })
  const pageRows = (): number => Math.max(1, (tui.terminal?.rows ?? 24) - 4)

  const handleTree = (data: string, view: WatchView): void => {
    if (pi.matchesKey(data, pi.Key.escape) || pi.matchesKey(data, pi.Key.ctrl("q"))) return viewer.close()
    if (pi.matchesKey(data, pi.Key.up)) return viewer.moveSelection(-1)
    if (pi.matchesKey(data, pi.Key.down)) return viewer.moveSelection(1)
    if (pi.matchesKey(data, pi.Key.pageUp)) return viewer.moveSelection(-pageRows())
    if (pi.matchesKey(data, pi.Key.pageDown)) return viewer.moveSelection(pageRows())
    if (pi.matchesKey(data, pi.Key.enter) && view.selectedId !== undefined) return viewer.openSelected()
  }

  const handleWatch = (data: string, view: WatchView): void => {
    // Pasted text keeps Esc, Tab and Enter inside the draft instead of reading them as keys.
    if (view.editing && (pasting || data.includes("\x1b[200~"))) {
      if (data.includes("\x1b[200~")) pasting = true
      if (data.includes("\x1b[201~")) pasting = false
      input.handleInput(data)
      return
    }
    if (pi.matchesKey(data, pi.Key.escape)) return viewer.backToTree()
    if (pi.matchesKey(data, pi.Key.ctrl("q"))) return viewer.close()
    if (pi.matchesKey(data, pi.Key.tab)) return viewer.toggleEditing()
    if (view.transcript?.kind === "error" && pi.matchesKey(data, pi.Key.ctrl("r"))) return viewer.retry()
    if (view.editing) {
      if (pi.matchesKey(data, pi.Key.up)) return viewer.scrollWatch(-1)
      if (pi.matchesKey(data, pi.Key.down)) return viewer.scrollWatch(1)
      if (pi.matchesKey(data, pi.Key.pageUp)) return viewer.scrollWatch(-pageRows())
      if (pi.matchesKey(data, pi.Key.pageDown)) return viewer.scrollWatch(pageRows())
      input.handleInput(data)
      return
    }
    if (pi.matchesKey(data, pi.Key.up)) return viewer.scrollWatch(-1)
    if (pi.matchesKey(data, pi.Key.down)) return viewer.scrollWatch(1)
    if (pi.matchesKey(data, pi.Key.pageUp)) return viewer.scrollWatch(-pageRows())
    if (pi.matchesKey(data, pi.Key.pageDown)) return viewer.scrollWatch(pageRows())
    if (pi.matchesKey(data, pi.Key.home)) return viewer.scrollToStart()
    if (pi.matchesKey(data, pi.Key.end) || data === "l") return viewer.scrollToEnd()
  }

  const renderWatch = (view: WatchView, width: number, height: number): string[] => {
    const columns = Math.max(1, width)
    const bodyRows = Math.max(0, height - 4)
    const row = view.rows.find((entry) => entry.id === view.watchId)
    const wrapped = transcriptRows(pi, paint(), view, columns - 2)
    viewer.setLayout(wrapped.length, bodyRows)
    const start = viewer.effectiveScroll()
    const visible = wrapped.slice(start, start + bodyRows)
    while (visible.length < bodyRows) visible.push("")
    const lines = [
      paintText(paint(), "accent", headingLine(view, row)),
      ` ${statusLine(paint(), view, row)}`,
      ...visible.map((line) => ` ${line}`),
      paintText(paint(), "dim", footerLine(view)),
      ` ${input.render(Math.max(1, columns - 2))[0] ?? ""}`,
    ]
    return fitLines(paint(), lines, columns, height)
  }

  return {
    render(width: number): string[] {
      const height = Math.max(1, tui.terminal?.rows ?? 24)
      const view = viewer.view()
      if (view.screen === "tree") {
        return renderWatchTree(paint(), { labels: view.labels, rows: view.rows, selectedId: view.selectedId }, width, height)
      }
      return renderWatch(view, width, height)
    },
    handleInput(data: string): void {
      const view = viewer.view()
      input.focused = view.editing
      if (view.screen === "tree") handleTree(data, view)
      else handleWatch(data, view)
      tui.requestRender()
    },
    invalidate(): void {
      input.invalidate()
    },
    dispose(): void {
      input.dispose()
    },
  }
}

// Plain separators only: the heading is copy the user reads, so it carries no dashes.
function headingLine(view: WatchView, row: WatchRow | undefined): string {
  if (view.watchId === undefined) return view.labels.title
  if (view.gone || row === undefined) return `${view.watchId} · no longer part of this view`
  return `${row.identity} · ${row.state} · watching, the main session continues`
}

function statusLine(paint: WatchPaint, view: WatchView, row: WatchRow | undefined): string {
  if (view.failure !== undefined) return paintText(paint, "error", `Refresh failed: ${view.failure}`)
  if (view.sending) return paintText(paint, "muted", "Sending…")
  if (view.steerStatus !== undefined) return paintText(paint, view.steerStatus.accepted ? "success" : "error", view.steerStatus.text)
  if (view.transcript?.kind === "error") return paintText(paint, "error", `Transcript unavailable: ${view.transcript.message}`)
  if (row === undefined) return paintText(paint, "muted", "Not part of this view any more. Esc returns to the list.")
  return paintText(paint, "muted", `${row.summary} · ${row.meta}`)
}

function footerLine(view: WatchView): string {
  const follow = view.follow ? "following" : "scrolled"
  if (view.transcript?.kind === "error") return " Ctrl+R Retry · Tab steer/browse · Esc list · Ctrl+Q main"
  if (view.editing) return ` Enter steer · Tab browse · Esc list · Ctrl+Q main · ${follow}`
  return ` Tab steer · ↑↓ PgUp PgDn scroll · Home/End · Esc list · Ctrl+Q main · ${follow}`
}

// Transcript lines wrapped to the body width, sanitized and tinted by kind. The transcript is plain
// text from the renderer, so colour is chosen here and never taken from the child.
function transcriptRows(pi: WatchPiTui, paint: WatchPaint, view: WatchView, width: number): string[] {
  if (view.gone) return [paintText(paint, "warning", "This item is no longer part of the watched data.")]
  if (view.transcript === undefined) return [paintText(paint, "muted", "Attaching to the transcript…")]
  if (view.transcript.kind === "error") return [paintText(paint, "error", "Ctrl+R retries the read. Esc goes back to the list.")]
  const out: string[] = []
  if (view.transcript.note !== undefined) out.push(paintText(paint, "muted", view.transcript.note), "")
  if (view.transcript.truncated) out.push(paintText(paint, "dim", "(older output elided)"))
  if (!view.transcript.recorded && view.transcript.note === undefined) out.push(paintText(paint, "muted", "No transcript recorded yet."))
  for (const line of view.transcript.lines) {
    const safe = sanitizeTerminalText(line)
    const color = safe.startsWith("error:") ? "error" : safe.startsWith("tool") ? "dim" : "text"
    for (const piece of pi.wrapTextWithAnsi(safe, Math.max(1, width))) out.push(paintText(paint, color, piece))
  }
  return out
}
