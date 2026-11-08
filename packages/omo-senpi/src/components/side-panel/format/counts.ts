/**
 * Line counts for the Changes rows. Small counts print exactly; a large one is compacted to a short
 * suffix (`+12.4k`, `-2.1M`) so the counts keep their width however big the change is.
 *
 * Malformed input is made safe before anything else: NaN, negatives and missing values count as 0, and
 * an infinite or beyond-safe count saturates at the largest integer JavaScript represents exactly. That
 * bound also keeps every printed value short of the range where `toFixed` writes scientific notation.
 */

/** The largest count the panel formats. Larger counts are shown and shaded as this value. */
export const MAX_COUNT = Number.MAX_SAFE_INTEGER

/** Units from the thousands up, in order. The last one is the ceiling; nothing above it is needed. */
const UNITS: readonly (readonly [string, number])[] = [
  ["k", 1_000],
  ["M", 1_000_000],
  ["B", 1_000_000_000],
  ["T", 1_000_000_000_000],
]

/** A change at or above this many lines in total is shown with a warning, not as an ordinary number. */
export const OVERSIZED_LINES = 100_000

/**
 * Whether a file's line counts are too large to show as ordinary numbers. An unknown count (a binary
 * file git does not measure) is not oversized, since its absence says nothing about size. A count that
 * is present but not a finite non-negative number can only come from a malformed or runaway source, so
 * it is oversized and never displayed as if it were an ordinary value.
 */
export function isOversizedChange(added: number | undefined, removed: number | undefined): boolean {
  let total = 0
  for (const value of [added, removed]) {
    if (value === undefined) continue
    if (!Number.isFinite(value) || value < 0) return true
    total += value
  }
  return total >= OVERSIZED_LINES
}

/** A count the panel can trust: a non-negative integer no larger than `MAX_COUNT`. */
export function safeCount(value: number | undefined): number {
  if (value === undefined || Number.isNaN(value) || value <= 0) return 0
  return Math.min(Math.floor(value), MAX_COUNT)
}

/**
 * `1234` -> `1.2k`, `12400` -> `12.4k`, `123456` -> `123k`, `2100000` -> `2.1M`. One decimal below a
 * hundred of a unit, whole numbers above it. A value that rounds up to a thousand of its unit moves to
 * the next unit, so `999950` reads `1M`, never `1000k`.
 */
export function formatCount(value: number): string {
  const count = safeCount(value)
  if (count < 1_000) return String(count)
  let chosen = 0
  for (let index = 1; index < UNITS.length; index++) {
    if (count >= (UNITS[index]?.[1] ?? Number.POSITIVE_INFINITY)) chosen = index
  }
  let text = scaled(count, chosen)
  if (Number(text.number) >= 1_000 && chosen + 1 < UNITS.length) {
    chosen += 1
    text = scaled(count, chosen)
  }
  return `${text.number}${UNITS[chosen]?.[0] ?? ""}`
}

function scaled(count: number, index: number): { readonly number: string } {
  const size = UNITS[index]?.[1] ?? 1
  const value = count / size
  const fixed = value < 100 ? value.toFixed(1) : Math.round(value).toFixed(0)
  // A whole value keeps no decimal point: `12.0k` is written `12k`.
  return { number: fixed.endsWith(".0") ? fixed.slice(0, -2) : fixed }
}
