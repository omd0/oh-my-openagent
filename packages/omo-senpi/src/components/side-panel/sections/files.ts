import { sanitizeTerminalText } from "../format/sanitize"
import { formatCount, isOversizedChange } from "../format/counts"
import { truncateVisible, visibleWidth } from "../format/truncate"
import type { PanelGitEntry } from "../git/parse"
import type { PanelRow, PanelStyle, PanelStyleSpan } from "../types"
import { changeStyles } from "./change-color"
import { heading } from "./layout"

export interface PanelGitStatus {
  readonly root: string
  readonly files: readonly PanelGitEntry[]
  /**
   * The acquisition refused or capped the list, so `files` holds only what was retained and the total
   * is unknown. Set by the bounded reader; a list that is merely long and fully known is not tooLarge.
   */
  readonly tooLarge?: boolean
}

/** How the Changes block is shown: a bounded preview, or every file once expanded. */
export interface ChangesMode {
  /** Files the collapsed block shows before it counts the rest. */
  readonly preview: number
  readonly expanded: boolean
  /** Only a clickable column can expand; a widget block shows the preview and the count, nothing to click. */
  readonly expandable: boolean
}

/**
 * The most file rows the Changes block ever builds, in either view. A change with more files than this
 * is shown as the first rows and a warning that says how many were left out, so an enormous diff can
 * never turn into an enormous column.
 */
export const MAX_CHANGE_ROWS = 500

/**
 * Characters read from a path before it is sanitized. The column shows what fits its width, so a longer
 * name only costs work: it is cut here first, and the sanitize and width passes see a bounded string.
 */
const NAME_SCAN_LIMIT = 1024

/** The marker a shortened file name ends with. Two dots, so a cut name is visibly cut. */
const NAME_MARK = ".."

/**
 * A file name fitted to `room` visible cells. A name that fits is kept whole. A longer one keeps as much of
 * its start as fits in front of the two-dot marker. The marker never takes more cells than the room: with
 * one cell the name is a single dot, with two cells it is the two dots, and with none the name is gone.
 * Cells are counted as the terminal draws them, so a wide character is kept or dropped whole. Only the name
 * is shortened here; the action still carries the real path.
 */
function fitName(name: string, room: number): string {
  if (room <= 0) return ""
  if (visibleWidth(name) <= room) return name
  if (room === 1) return "."
  if (room === 2) return NAME_MARK
  let kept = ""
  let used = 0
  for (const character of name) {
    const cells = visibleWidth(character)
    if (used + cells > room - NAME_MARK.length) break
    kept += character
    used += cells
  }
  return `${kept}${NAME_MARK}`
}

/** The least space kept between a file's name and its counts, so the two never run together. */
const MIN_GAP = 2

/** One piece of a row, with the style it paints in when it has one. */
interface RowPart {
  readonly text: string
  readonly style?: PanelStyle
}

/**
 * Files as git sees them. The two status columns are shown verbatim, because `M ` (staged)
 * and ` M` (unstaged) are genuinely different states and collapsing them would lose that.
 */
export function buildFileRows(status: PanelGitStatus | undefined, width: number, cap: number): readonly PanelRow[] {
  if (width <= 0 || status === undefined || status.files.length === 0 || cap <= 0) return []
  const total = status.files.length
  // The slice is the only allocation over the files, and it is bounded by the cap and the row limit.
  const shown = status.files.slice(0, Math.min(cap, MAX_CHANGE_ROWS))
  const hidden = total - shown.length
  const summary = hidden > 0 ? `${formatCount(total)} changed · +${formatCount(hidden)} more` : `${formatCount(total)} changed`
  return [heading("FILES", summary), ...shown.map((file) => fileRow(file, width))]
}

/**
 * The Changes block. Collapsed: a bounded preview with the exact hidden count and a Show more row.
 * Expanded: a Show less row at the top, then every changed file up to the row limit. Each file row keeps
 * its diff action, so expansion never changes what a click on a file does. A status the reader refused
 * or capped is shown as too large with no exact total: what was retained is the only number claimed.
 */
export function buildChangesRows(status: PanelGitStatus | undefined, width: number, mode: ChangesMode): readonly PanelRow[] {
  if (width <= 0) return []
  const files = status?.files ?? []
  const total = files.length
  const tooLarge = status?.tooLarge === true
  // Nothing to show stays out of the column, unless the reader refused the list: then the warning is the
  // content, and an empty refused list must not read as "0 changed".
  if (total === 0 && !mode.expanded && !tooLarge) return []
  // The slice allocates at most `limit` entries, so a huge status never builds a row for every file.
  const limit = mode.expanded ? MAX_CHANGE_ROWS : clampPreview(mode.preview)
  const shown = files.slice(0, limit)
  const hidden = total - shown.length
  const summary = tooLarge ? (total > 0 ? `${formatCount(total)}+ changed` : undefined) : `${formatCount(total)} changed`
  const rows: PanelRow[] = [heading("FILES", summary)]
  if (mode.expanded && mode.expandable) {
    rows.push({ text: truncateVisible("Show less", width), color: "accent", action: { kind: "files-less" } })
  }
  if (tooLarge) {
    rows.push({ text: truncateVisible(unknownTotalText(total), width), color: "warning" })
  } else if (total > MAX_CHANGE_ROWS) {
    rows.push({ text: truncateVisible(tooLargeText(mode.expanded, shown.length, total, hidden), width), color: "warning" })
  }
  for (const file of shown) rows.push(fileRow(file, width))
  if (hidden > 0 && !mode.expanded) {
    const remainder = tooLarge ? `${formatCount(hidden)} retained` : `+${formatCount(hidden)} more`
    rows.push(
      mode.expandable
        ? { text: truncateVisible(`Show more · ${remainder}`, width), color: "accent", action: { kind: "files-more" } }
        : { text: truncateVisible(remainder, width), color: "muted" },
    )
  }
  return rows
}

/**
 * The warning for a fully known list past the row limit. It names the shown count, the total and the
 * omitted count, so a reader knows how much is not on screen. Collapsed, it only reports the total.
 */
function tooLargeText(expanded: boolean, shown: number, total: number, hidden: number): string {
  if (!expanded) return `Changes too large · ${formatCount(total)} files`
  return `Changes too large · showing ${formatCount(shown)} of ${formatCount(total)}, ${formatCount(hidden)} omitted`
}

/**
 * The warning for a refused or capped list. Only the retained count is a fact here, so no total or
 * omitted count is claimed; an empty refused list says there is no list to show.
 */
function unknownTotalText(retained: number): string {
  if (retained === 0) return "Changes too large · no file list"
  return `Changes too large · ${formatCount(retained)} files retained, total unknown`
}

/** The preview is a count of rows: finite, never negative, and never past the row limit. */
function clampPreview(preview: number): number {
  if (!Number.isFinite(preview)) return 0
  return Math.min(MAX_CHANGE_ROWS, Math.max(0, Math.floor(preview)))
}

/**
 * One changed file: the status and name on the left, the line counts flush right in the row's width.
 * The padding between them is measured from the name as it is actually shown, so a short name and a
 * long or wide one both end their counts on the same right edge. When the row is too narrow, the parts
 * go in a fixed order: the huge marker first, then the name, then the status; the counts go last, and are
 * only cut when the viewport cannot hold them. Spans are read off the parts that are actually emitted.
 */
function fileRow(file: PanelGitEntry, width: number): PanelRow {
  const styles = changeStyles(file)
  // Only a bounded prefix of the name is sanitized and measured; the action keeps the full real path.
  const name = sanitizeTerminalText(basename(file.path).slice(0, NAME_SCAN_LIMIT))
  const head: RowPart[] = [{ text: file.xy, style: styles.status }, { text: " " }]
  if (file.added === undefined && file.removed === undefined) {
    return rowOf(file, [...head, { text: fitName(name, width - partsWidth(head)), style: styles.name }], width)
  }
  // The numeric counts always come last. The huge marker sits before them, so no label trails the counts.
  const numeric: RowPart[] = [
    { text: `+${formatCount(file.added ?? 0)}`, style: styles.added },
    { text: "/" },
    { text: `-${formatCount(file.removed ?? 0)}`, style: styles.removed },
  ]
  const marked: RowPart[] = isOversizedChange(file.added, file.removed)
    ? [{ text: "huge", style: "warning" }, { text: "  " }, ...numeric]
    : numeric
  const headWidth = partsWidth(head)
  const markedWidth = partsWidth(marked)
  const numericWidth = partsWidth(numeric)
  if (headWidth + MIN_GAP + markedWidth <= width) return alignedRow(file, head, name, styles.name, marked, width)
  if (headWidth + MIN_GAP + numericWidth <= width) return alignedRow(file, head, name, styles.name, numeric, width)
  if (headWidth + numericWidth <= width) return rowOf(file, [...head, fill(width - headWidth - numericWidth), ...numeric], width)
  if (numericWidth <= width) return rowOf(file, [fill(width - numericWidth), ...numeric], width)
  return rowOf(file, numeric, width)
}

/**
 * The status and the name on the left, the suffix flush right. The name is cut to the room the suffix and
 * the minimum gap leave, and the padding is the width that remains after the name as shown.
 */
function alignedRow(
  file: PanelGitEntry,
  head: readonly RowPart[],
  name: string,
  nameStyle: PanelStyle,
  suffix: readonly RowPart[],
  width: number,
): PanelRow {
  const headWidth = partsWidth(head)
  const suffixWidth = partsWidth(suffix)
  const shown = fitName(name, width - headWidth - suffixWidth - MIN_GAP)
  const padding = width - headWidth - visibleWidth(shown) - suffixWidth
  return rowOf(file, [...head, { text: shown, style: nameStyle }, fill(padding), ...suffix], width)
}

/** Plain spaces that move the next part to the right; never styled, never more than the row can hold. */
function fill(cells: number): RowPart {
  return { text: " ".repeat(Math.max(0, cells)) }
}

/** A row built from its parts, with each style span placed against the text that was emitted. */
function rowOf(file: PanelGitEntry, parts: readonly RowPart[], width: number): PanelRow {
  const composed = compose(parts, width)
  // The click carries the real path; the row shows the basename because the column is narrow.
  return {
    text: composed.text,
    color: colorFor(file.xy),
    styles: composed.spans,
    action: { kind: "file", path: file.path },
  }
}

/**
 * Joins the parts and records each style span at the columns it lands on. Only when the joined text is
 * wider than the viewport is it cut, and then the spans are clipped to what remains.
 */
function compose(parts: readonly RowPart[], width: number): { readonly text: string; readonly spans: readonly PanelStyleSpan[] } {
  let text = ""
  let column = 0
  const spans: PanelStyleSpan[] = []
  for (const part of parts) {
    if (part.text === "") continue
    const start = column
    text += part.text
    column += visibleWidth(part.text)
    if (part.style !== undefined) spans.push({ start, end: column, style: part.style })
  }
  if (column <= width) return { text, spans }
  const cut = truncateVisible(text, width)
  const visible = visibleWidth(cut)
  return {
    text: cut,
    spans: spans.filter((span) => span.start < visible).map((span) => ({ ...span, end: Math.min(span.end, visible) })),
  }
}

function partsWidth(parts: readonly RowPart[]): number {
  return parts.reduce((sum, part) => sum + visibleWidth(part.text), 0)
}

/** Untracked is dim, a conflict is loud, staged reads as done, unstaged as in-flight. */
function colorFor(xy: string): PanelRow["color"] {
  if (xy === "??") return "dim"
  if (xy.includes("U") || xy === "AA" || xy === "DD") return "error"
  if (xy[1] === " ") return "success"
  return "text"
}

/**
 * git reports an untracked DIRECTORY with a trailing slash (`?? build/`), and taking the
 * basename of that yields an empty string - the column showed a status with no name at all.
 * The slash is kept, because "build/" and "build" are different things to a reader.
 */
function basename(path: string): string {
  const directory = path.endsWith("/")
  const trimmed = directory ? path.slice(0, -1) : path
  const slash = trimmed.lastIndexOf("/")
  const name = slash === -1 ? trimmed : trimmed.slice(slash + 1)
  return directory ? `${name}/` : name
}
