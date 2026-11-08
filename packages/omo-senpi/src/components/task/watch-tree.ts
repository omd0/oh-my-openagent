import { sanitizeTerminalText } from "../side-panel/format/sanitize"
import type { WatchColor, WatchTheme } from "./watch-types"
import type { WatchLabels, WatchRow } from "./watch-source"

// Paint helpers the screens share. `truncate` and `visible` are pi-tui's ANSI-aware measures, passed in
// so this module stays free of the lazy pi-tui load and can be exercised with plain strings.
export interface WatchPaint {
  readonly theme: WatchTheme | undefined
  truncate(line: string, width: number): string
  visible(line: string): number
}

export function paintText(paint: WatchPaint, color: WatchColor, text: string): string {
  const safe = sanitizeTerminalText(text)
  return paint.theme === undefined ? safe : paint.theme.fg(color, safe)
}

// Every screen line is clipped to the terminal width and the screen is padded to its full height.
// The host draws over whatever a short frame leaves behind, so a missing row would show stale text.
export function fitLines(paint: WatchPaint, lines: readonly string[], width: number, height: number): string[] {
  const columns = Math.max(1, Math.floor(width))
  const rows = Math.max(1, Math.floor(height))
  const fitted = lines.slice(0, rows).map((line) => {
    const clipped = paint.truncate(line, columns)
    return clipped + " ".repeat(Math.max(0, columns - paint.visible(clipped)))
  })
  while (fitted.length < rows) fitted.push(" ".repeat(columns))
  return fitted
}

export interface WatchTreeInput {
  readonly labels: WatchLabels
  readonly rows: readonly WatchRow[]
  readonly selectedId: string | undefined
}

// Two lines per row, the agents tree's layout: identity and state with the meta column, then the
// row's own summary underneath. Dependency depth is an indent, so a waiting node sits under its
// predecessor. The detail line below the list describes the selected row.
export function renderWatchTree(paint: WatchPaint, input: WatchTreeInput, width: number, height: number): string[] {
  const total = input.rows.length
  const selectedIndex = Math.max(0, input.rows.findIndex((row) => row.id === input.selectedId))
  const selected = input.rows[selectedIndex]
  const bodyBudget = Math.max(0, height - 4)
  const perPage = Math.max(1, Math.floor(bodyBudget / 2))
  const start = total === 0 ? 0 : Math.min(Math.max(0, selectedIndex - perPage + 1), Math.max(0, total - perPage))
  const shown = input.rows.slice(start, start + perPage)
  const lines: string[] = [paintText(paint, "accent", headingText(input.labels, total, start, shown.length))]
  if (total === 0) lines.push(` ${paintText(paint, "muted", input.labels.empty)}`)
  for (const row of shown) {
    const marker = row.id === input.selectedId ? "›" : " "
    const indent = "  ".repeat(row.indent)
    const head = ` ${marker} ${indent}${row.identity}  ${row.state}  ${row.meta}`
    lines.push(row.id === input.selectedId ? paintText(paint, "accent", head) : paintText(paint, "text", head))
    lines.push(`     ${indent}${paintText(paint, "muted", row.summary)}`)
  }
  while (lines.length < 1 + bodyBudget) lines.push("")
  lines.push(selected === undefined ? "" : ` ${paintText(paint, "dim", selected.summary)}`)
  lines.push(selected === undefined ? "" : ` ${paintText(paint, "dim", `${selected.meta} · ${selected.state}`)}`)
  lines.push(paintText(paint, "dim", " Esc main · ↑↓ select · Enter watch · PgUp/PgDn page"))
  return fitLines(paint, lines, width, height)
}

function headingText(labels: WatchLabels, total: number, start: number, shown: number): string {
  if (total === 0) return `${labels.title}  0 ${labels.unit}`
  return `${labels.title}  ${total} ${labels.unit}  ${start + 1}-${start + shown}/${total}`
}
