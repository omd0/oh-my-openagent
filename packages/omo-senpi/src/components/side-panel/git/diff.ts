import { DIFF_VIEWER_ROW_CAP, GIT_TIMEOUT_MS } from "../constants"
import { isOversizedChange } from "../format/counts"
import type { PanelRow } from "../types"
import type { PanelGitEntry } from "./parse"
import { PANEL_GIT_OUTPUT_MAX_BYTES, type PanelExec } from "./read"

/** Extended headers git prints above a hunk; they are structure, not content. */
const HEADER_PREFIXES = [
  "diff ",
  "index ",
  "new file mode",
  "deleted file mode",
  "old mode",
  "new mode",
  "similarity index",
  "dissimilarity index",
  "rename from",
  "rename to",
  "copy from",
  "copy to",
  "Binary files",
]

/**
 * Per-pathspec literal magic, in place of the global `--literal-pathspecs` flag.
 * The global flag is incompatible with any other global pathspec switch, so a shell
 * that exports `GIT_GLOB_PATHSPECS=1` or `GIT_ICASE_PATHSPECS=1` makes git exit 128
 * before any diff is produced (#11176), and the pinned host's `exec` has no `env`
 * field, so an env override never reaches git at all. Per-pathspec magic is not a
 * global switch, so it does not trip that conflict, while a `*` or `[` in a file
 * name is still matched literally. It cannot cancel a global `GIT_ICASE_PATHSPECS`
 * (git ORs the global switch into each pathspec), but the panel only ever queries
 * paths exactly as `git status` reported them, so in practice the reported path's
 * diff is still shown; only the extreme case of two same-directory files differing
 * only by case could additionally match a case-variant sibling.
 *
 * The one switch per-pathspec magic cannot coexist with is `GIT_LITERAL_PATHSPECS`:
 * with it exported, git reads `:(literal)` as part of the file name, so both the
 * tracked diff and the untracked listing match nothing and exit 0. The panel runs
 * in the host process, so it sees the same environment the spawned git inherits;
 * when that switch is truthy, literal matching is already on and the paths stay bare.
 */
function literalPathspecsEnabled(): boolean {
  const value = process.env.GIT_LITERAL_PATHSPECS?.trim().toLowerCase()
  return value !== undefined && value !== "" && value !== "0" && value !== "false" && value !== "no" && value !== "off"
}

const literalPathspec = (path: string): string => (literalPathspecsEnabled() ? path : `:(literal)${path}`)

/**
 * The diff git itself would print, coloured by line kind.
 *
 * A rename needs BOTH paths in the pathspec: given only the destination, git sees an
 * unrelated new file and prints the whole content as additions. An untracked file has no
 * index side at all, so it is diffed against /dev/null, which exits 1 by design.
 */
export function gitDiffArgs(file: PanelGitEntry): string[] {
  // `--no-index` operands are plain filesystem paths, not pathspecs: no magic
  // prefix, and no global flag to conflict with an exported pathspec switch.
  if (file.xy === "??") return ["diff", "--no-index", "--", "/dev/null", file.path]
  const paths = file.from === undefined ? [file.path] : [file.from, file.path]
  return ["diff", "HEAD", "-M", "--", ...paths.map(literalPathspec)]
}

/** Files of one untracked directory the viewer diffs; the rest are counted in a closing row. */
export const UNTRACKED_DIRECTORY_FILE_CAP = 50
/** A single terminal row is not allowed to retain an arbitrarily long git line. */
export const DIFF_VIEWER_LINE_MAX_CHARS = 4_096

const TOO_LARGE_ROWS: readonly PanelRow[] = [{ text: "Changes too large", color: "warning" }]

export async function readGitDiff(exec: PanelExec, root: string, file: PanelGitEntry): Promise<readonly PanelRow[]> {
  if (isOversizedChange(file.added, file.removed)) return TOO_LARGE_ROWS
  const options = { cwd: root, timeout: GIT_TIMEOUT_MS }
  if (file.xy === "??" && file.path.endsWith("/")) {
    const listed = await exec(
      "git",
      ["ls-files", "--others", "--exclude-standard", "-z", "--", literalPathspec(file.path)],
      options,
    ).catch(() => undefined)
    if (listed !== undefined && outputTooLarge(listed)) return TOO_LARGE_ROWS
    if (listed === undefined || listed.failed === true || listed.code !== 0) return [{ text: "git diff could not be run", color: "error" }]
    const listedPaths = listed.stdout.split("\0").filter((path) => path !== "")
    // One process per file: an untracked build directory must not become thousands of spawns.
    const paths = listedPaths.slice(0, UNTRACKED_DIRECTORY_FILE_CAP)
    const rows: PanelRow[] = []
    let retainedBytes = 0
    for (const path of paths) {
      const result = await exec("git", gitDiffArgs({ xy: "??", path }), options).catch(() => undefined)
      if (result === undefined) return [{ text: "git diff could not be run", color: "error" }]
      if (tooLarge(result)) return TOO_LARGE_ROWS
      retainedBytes += Buffer.byteLength(result.stdout, "utf8")
      if (retainedBytes > PANEL_GIT_OUTPUT_MAX_BYTES) return TOO_LARGE_ROWS
      const next = colorizeDiff(result.stdout)
      if (isTooLargeRows(next) || rows.length + next.length > DIFF_VIEWER_ROW_CAP) return TOO_LARGE_ROWS
      rows.push(...next)
    }
    const omitted = listedPaths.length - paths.length
    if (omitted > 0) {
      if (rows.length >= DIFF_VIEWER_ROW_CAP) return TOO_LARGE_ROWS
      rows.push({ text: `... ${omitted} more files in ${file.path.slice(0, 512)}`, color: "muted" })
    }
    return rows.length > 0 ? rows : [{ text: "no textual change", color: "muted" }]
  }
  let result = await exec("git", gitDiffArgs(file), options).catch(() => undefined)
  if (result?.code === 128 && result.stdout === "" && file.xy[0] !== " ") {
    result = await exec("git", ["diff", "--no-index", "--", "/dev/null", file.path], options).catch(
      () => undefined,
    )
  }
  if (result === undefined || result.failed === true) return [{ text: "git diff could not be run", color: "error" }]
  if (tooLarge(result)) return TOO_LARGE_ROWS
  // `--no-index` exits 1 whenever the files differ, which is the normal case here.
  if (result.stdout === "" && result.code !== 0 && result.code !== 1) {
    return [{ text: `git diff failed (exit ${result.code})`, color: "error" }]
  }
  const rows = colorizeDiff(result.stdout)
  if (isTooLargeRows(rows)) return TOO_LARGE_ROWS
  return rows.length > 0 ? rows : [{ text: "no textual change", color: "muted" }]
}

/** Pure: turn diff text into coloured rows. */
export function colorizeDiff(output: string): readonly PanelRow[] {
  if (Buffer.byteLength(output, "utf8") > PANEL_GIT_OUTPUT_MAX_BYTES) return TOO_LARGE_ROWS
  let lineLength = 0
  let nonEmptyLines = 0
  let lineBreaks = 0
  for (let index = 0; index < output.length; index += 1) {
    if (output.charCodeAt(index) === 10) {
      lineBreaks += 1
      if (lineBreaks > DIFF_VIEWER_ROW_CAP) return TOO_LARGE_ROWS
      if (lineLength > 0) nonEmptyLines += 1
      if (nonEmptyLines > DIFF_VIEWER_ROW_CAP) return TOO_LARGE_ROWS
      lineLength = 0
      continue
    }
    lineLength += 1
    if (lineLength > DIFF_VIEWER_LINE_MAX_CHARS) return TOO_LARGE_ROWS
  }
  if (lineLength > 0 && nonEmptyLines + 1 > DIFF_VIEWER_ROW_CAP) return TOO_LARGE_ROWS
  const rows: PanelRow[] = []
  for (const line of output.split("\n")) {
    if (line === "") continue
    rows.push({ text: line, color: colorFor(line) })
  }
  return rows
}

function tooLarge(result: { readonly stdout: string; readonly tooLarge?: boolean; readonly failed?: boolean }): boolean {
  return result.failed === true || outputTooLarge(result)
}

function outputTooLarge(result: { readonly stdout: string; readonly tooLarge?: boolean }): boolean {
  return result.tooLarge === true || Buffer.byteLength(result.stdout, "utf8") > PANEL_GIT_OUTPUT_MAX_BYTES
}

function isTooLargeRows(rows: readonly PanelRow[]): boolean {
  return rows.length === 1 && rows[0]?.text === "Changes too large"
}

function colorFor(line: string): PanelRow["color"] {
  if (line.startsWith("+++") || line.startsWith("---")) return "muted"
  if (HEADER_PREFIXES.some((prefix) => line.startsWith(prefix))) return "muted"
  if (line.startsWith("@@")) return "accent"
  if (line.startsWith("+")) return "success"
  if (line.startsWith("-")) return "error"
  return "text"
}
