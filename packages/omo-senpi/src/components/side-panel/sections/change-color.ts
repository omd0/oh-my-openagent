import type { PanelGitEntry } from "../git/parse"
import { safeCount } from "../format/counts"
import type { PanelStyle } from "../types"

/**
 * The colour of a changed file, by what happened to it and by how much.
 *
 * Status sets the hue: deleted files red, new files green, modified files yellow. The count sets the
 * depth: each change size has its own shade of that hue, so a two-line edit reads quieter than a
 * rewrite. Green is always the added count (`+N`) and red always the removed count (`-N`), so a mixed
 * edit keeps its additions and deletions apart. Shades are 256-colour palette indices, because the
 * host theme has named colours only and no gradient.
 *
 * Impact bins, by the count they colour:
 *   0 | 1-9 | 10-49 | 50-199 | 200 and more
 * An unknown count (a binary file git does not measure) counts as 0, so it stays at the quietest shade
 * rather than reading as the largest change.
 */

/** Quietest to strongest, one entry per impact bin. */
const RED: readonly number[] = [131, 167, 196, 203, 210]
const GREEN: readonly number[] = [65, 71, 34, 40, 46]
const YELLOW: readonly number[] = [136, 142, 178, 184, 220]

/** The shade for the middle bin, used for the status column so it reads in the hue without shouting. */
const MIDDLE = 2

/** One shade from a ramp, bounded to the ramp's own bins. */
function shade(ramp: readonly number[], level: number): number {
  return ramp[Math.min(Math.max(0, level), ramp.length - 1)] ?? 0
}

export type ChangeKind = "deleted" | "new" | "modified" | "conflict"

export interface ChangeStyles {
  /** The two status characters. */
  readonly status: PanelStyle
  /** The file's name, by status and total impact. */
  readonly name: PanelStyle
  /** The `+N` count. */
  readonly added: PanelStyle
  /** The `-N` count. */
  readonly removed: PanelStyle
}

/**
 * The impact bin of a count. A count past the top bin, including an infinite one, saturates at the
 * strongest shade: only the palette index is chosen here, so no colour value can overflow.
 */
export function impactLevel(lines: number | undefined): number {
  const count = safeCount(lines)
  if (count === 0) return 0
  if (count < 10) return 1
  if (count < 50) return 2
  if (count < 200) return 3
  return 4
}

/**
 * Status priority, mixed XY first: a conflict is loudest; a deletion in either column wins over an
 * addition or a modification (`AD` and `MD` are deletions); an addition or untracked file is new.
 */
export function changeKind(xy: string): ChangeKind {
  if (xy.includes("U") || xy === "AA" || xy === "DD") return "conflict"
  if (xy.includes("D")) return "deleted"
  if (xy === "??" || xy.includes("A")) return "new"
  return "modified"
}

export function changeStyles(entry: Pick<PanelGitEntry, "xy" | "added" | "removed">): ChangeStyles {
  const kind = changeKind(entry.xy)
  const level = impactLevel(safeCount(entry.added) + safeCount(entry.removed))
  const ramp = kind === "deleted" ? RED : kind === "new" ? GREEN : YELLOW
  const conflict: PanelStyle = "error"
  return {
    status: kind === "conflict" ? conflict : { ansi256: shade(ramp, MIDDLE) },
    name: kind === "conflict" ? conflict : { ansi256: shade(ramp, level) },
    added: { ansi256: shade(GREEN, impactLevel(entry.added)) },
    removed: { ansi256: shade(RED, impactLevel(entry.removed)) },
  }
}
