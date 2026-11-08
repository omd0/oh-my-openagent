import { sanitizeTerminalText } from "./format/sanitize"
import { padVisible, truncateVisible, visibleWidth } from "./format/truncate"
import { withActionLink } from "./links"
import type { PanelComponent, PanelRow, PanelRowSource, PanelStyle, PanelStyleSpan, PanelTheme } from "./types"

/**
 * Breathing room inside the column. One blank cell on the left keeps the text off the transcript's
 * last column. The last cell stays blank too: a row written to the final column can be clipped or
 * wrapped by the host's line writer, so sections only ever see the inner width.
 */
export const PANEL_GUTTER_LEFT = 1
export const PANEL_GUTTER_RIGHT = 1

/**
 * The fullscreen column draws a thin vertical rule in its left cell, between the transcript and the
 * column, and keeps one blank cell after it before the content. Counted inside the column's width:
 * the content gets the width that is left after the rule, the blank cell and the right blank cell.
 */
export const PANEL_DIVIDER = "│"
export const PANEL_DIVIDED_GUTTER_LEFT = 2

export interface PanelBodyOptions {
  /** Read per paint: the column draws a rule; the widget fallback keeps its plain margin. */
  readonly divided?: () => boolean
}

/**
 * The structural scroll state the host's layout engine drives for the column. It mirrors the
 * installed `ScrollLayoutState` contract: the engine reads `scrollTop`, `primary`, `overscroll`
 * and `getContentWidth`, reports the content and viewport heights through `updateLayout`, and
 * routes wheel moves to `scrollBy`, which returns the part of the request it could not apply.
 */
export interface PanelScrollState {
  readonly scrollTop: number
  readonly primary: false
  readonly overscroll: "contain"
  readonly viewportHeight: number
  getContentWidth(width: number): number
  updateLayout(contentHeight: number, viewportHeight: number, requestRender: () => void): void
  scrollBy(lines: number): number
  /** Returns the column to its top. Used when the view changes, so its heading is on screen. */
  reset(): void
}

/**
 * The column's scroll position. It lives with the surface that owns the column, so a new session
 * builds a new state at the top and a dispose discards the old one. The offset is clamped against
 * the content on every layout pass, so a resize or a shrinking section never leaves it past the end.
 */
export function createPanelScrollState(): PanelScrollState {
  let scrollTop = 0
  let contentHeight = 0
  let viewportHeight = 0
  let repaint: (() => void) | undefined
  const maxScrollTop = (): number => Math.max(0, contentHeight - viewportHeight)
  return {
    get scrollTop() {
      return scrollTop
    },
    primary: false,
    overscroll: "contain",
    get viewportHeight() {
      return viewportHeight
    },
    getContentWidth: (width) => width,
    updateLayout(content, height, requestRender) {
      contentHeight = Math.max(0, Math.floor(content))
      viewportHeight = Math.max(0, Math.floor(height))
      repaint = requestRender
      scrollTop = Math.max(0, Math.min(scrollTop, maxScrollTop()))
    },
    reset() {
      scrollTop = 0
    },
    scrollBy(lines) {
      const requested = Number.isFinite(lines) ? Math.trunc(lines) : 0
      if (requested === 0) return 0
      const next = Math.max(0, Math.min(maxScrollTop(), scrollTop + requested))
      const moved = next - scrollTop
      scrollTop = next
      if (moved !== 0) repaint?.()
      return requested - moved
    },
  }
}

/**
 * The panel column's content painter. It paints every row the source reports, for the width the
 * scroll node hands it: the layout engine owns the viewport, the slicing and the wheel, so this
 * never windows its own rows. Rows are cut to the column and padded back out to it, and the theme
 * arrives with the host renderer, so it is read through a getter rather than captured.
 */
export function createPanelBody(
  source: PanelRowSource,
  theme: () => PanelTheme | undefined,
  clickable: () => boolean,
  options: PanelBodyOptions = {},
): PanelComponent {
  return {
    render(width: number): string[] {
      const dividing = options.divided?.() ?? false
      const left = dividing ? PANEL_DIVIDED_GUTTER_LEFT : PANEL_GUTTER_LEFT
      const inner = Math.max(0, width - left - PANEL_GUTTER_RIGHT)
      if (inner === 0) return []
      const paint = theme()
      const links = clickable()
      const rule = paint !== undefined ? paint.fg("dim", PANEL_DIVIDER) : PANEL_DIVIDER
      const margin = dividing ? rule + " ".repeat(left - 1) : " ".repeat(left)
      const tail = " ".repeat(PANEL_GUTTER_RIGHT)
      return source.rows(inner).map((row) => margin + paintRow(row, inner, paint, links) + tail)
    },
    invalidate(): void {
      // Rows are recomputed per frame, so there is no cached state to drop.
    },
  }
}

function paintRow(row: PanelRow, inner: number, paint: PanelTheme | undefined, links: boolean): string {
  if (row.styles !== undefined && row.styles.length > 0) return paintStyled(row, inner, paint, links)
  // Row text carries strings the panel does not author; this is the column's one paint point.
  const truncated = truncateVisible(sanitizeTerminalText(row.text), inner)
  const colour = (text: string): string => (paint !== undefined && row.color !== undefined ? paint.fg(row.color, text) : text)
  if (!links || row.action === undefined) return padVisible(colour(truncated), inner)
  // The link goes on last, over the padding too, so a click anywhere on the row counts.
  if (row.linkSpan === undefined) return withActionLink(padVisible(colour(truncated), inner), row.action)
  // A partial link covers only its own cells, so borders and padding stay plain. The terminal
  // underlines what a link covers, and a whole-row link underlines every cell of a bordered box.
  const [head, middle, rest] = splitVisible(padVisible(truncated, inner), row.linkSpan.start, row.linkSpan.end)
  const painted = (text: string): string => (paint !== undefined && row.color !== undefined ? paint.fg(row.color, text) : text)
  return painted(head) + withActionLink(painted(middle), row.action) + painted(rest)
}

/**
 * A row with style spans. Each character takes the style of the span it falls in, or the row's own
 * colour outside them; consecutive characters with the same style and link state form one run. A
 * linked run carries the row's click, so a link covers exactly the cells it names.
 */
function paintStyled(row: PanelRow, inner: number, paint: PanelTheme | undefined, links: boolean): string {
  const plain = padVisible(truncateVisible(sanitizeTerminalText(row.text), inner), inner)
  const runs: { text: string; style: PanelStyle | undefined; linked: boolean }[] = []
  let column = 0
  for (const character of plain) {
    const style = styleAt(row.styles ?? [], column)
    const linked =
      row.action !== undefined &&
      links &&
      (row.linkSpan === undefined || (column >= row.linkSpan.start && column < row.linkSpan.end))
    const last = runs[runs.length - 1]
    if (last !== undefined && last.style === style && last.linked === linked) last.text += character
    else runs.push({ text: character, style, linked })
    column += visibleWidth(character)
  }
  return runs
    .map((run) => {
      const painted = paintWith(run.style ?? row.color, run.text, paint)
      return run.linked && row.action !== undefined ? withActionLink(painted, row.action) : painted
    })
    .join("")
}

/** The span covering a column. Where spans overlap, the later one wins. */
function styleAt(spans: readonly PanelStyleSpan[], column: number): PanelStyle | undefined {
  let found: PanelStyle | undefined
  for (const span of spans) if (column >= span.start && column < span.end) found = span.style
  return found
}

/**
 * Paints one run. A named colour goes through the theme; a palette shade is written as its authored
 * 256-colour sequence. The text inside is the row's own, already sanitized, so no escape comes from it.
 */
function paintWith(style: PanelStyle | undefined, text: string, paint: PanelTheme | undefined): string {
  if (style === undefined || paint === undefined) return text
  if (typeof style === "string") return paint.fg(style, text)
  return `\x1b[38;5;${style.ansi256}m${text}\x1b[39m`
}

/** Splits plain text at visible columns: `[before start, start to end, from end]`. */
function splitVisible(text: string, start: number, end: number): readonly [string, string, string] {
  let head = ""
  let middle = ""
  let rest = ""
  let column = 0
  for (const character of text) {
    if (column < start) head += character
    else if (column < end) middle += character
    else rest += character
    column += visibleWidth(character)
  }
  return [head, middle, rest]
}
