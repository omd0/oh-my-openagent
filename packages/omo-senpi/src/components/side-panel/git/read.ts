import { GIT_TIMEOUT_MS } from "../constants"
import type { PanelGitStatus } from "../sections/files"
import { mergeGitDeltas, parseNumstatZ, parsePorcelainZ } from "./parse"

/** Output ceiling also applied to injected exec implementations before parsing. */
export const PANEL_GIT_OUTPUT_MAX_BYTES = 1024 * 1024
/** Retained status entries, after parsing the bounded NUL-delimited payload. */
export const PANEL_GIT_FILE_CAP = 2_000

export interface PanelExecResult {
  readonly stdout: string
  readonly code: number
  readonly tooLarge?: boolean
  readonly failed?: boolean
}

/** The host's `exec`, narrowed to what the git reads need. */
export type PanelExec = (
  command: string,
  args: string[],
  options?: { cwd?: string; timeout?: number },
) => Promise<PanelExecResult>

/**
 * Working-copy status, straight from git. Three machine-readable reads in parallel: the
 * states, and the line counts on each side of the index. Everything is `-z`, so a path
 * with a space or a quote arrives intact.
 */
export async function readGitStatus(exec: PanelExec, root: string): Promise<PanelGitStatus | undefined> {
  const run = (args: string[]): Promise<PanelExecResult | undefined> =>
    exec("git", args, { cwd: root, timeout: GIT_TIMEOUT_MS }).catch(() => undefined)
  const [status, unstaged, staged] = await Promise.all([
    run(["status", "--porcelain=v1", "-z", "--untracked-files=normal"]),
    run(["diff", "--numstat", "-z"]),
    run(["diff", "--cached", "--numstat", "-z"]),
  ])
  // No status means no section: a partial answer would misreport a clean tree.
  if (status === undefined || status.failed === true) return undefined
  if (isTooLarge(status)) return { root, files: [], tooLarge: true }
  if (status.code !== 0) return undefined
  if (
    isTooLarge(unstaged) ||
    isTooLarge(staged) ||
    hasNonzeroResult(unstaged) ||
    hasNonzeroResult(staged)
  ) {
    return { root, files: [], tooLarge: true }
  }
  const entries = parsePorcelainZ(status.stdout)
  const tooLarge = entries.length > PANEL_GIT_FILE_CAP
  return {
    root,
    files: mergeGitDeltas(
      entries.slice(0, PANEL_GIT_FILE_CAP),
      parseNumstatZ(unstaged?.stdout ?? ""),
      parseNumstatZ(staged?.stdout ?? ""),
    ),
    ...(tooLarge ? { tooLarge: true } : {}),
  }
}

function isTooLarge(result: PanelExecResult | undefined): boolean {
  return result?.tooLarge === true || result?.failed === true || (result !== undefined && Buffer.byteLength(result.stdout, "utf8") > PANEL_GIT_OUTPUT_MAX_BYTES)
}

function hasNonzeroResult(result: PanelExecResult | undefined): boolean {
  return result !== undefined && result.code !== 0
}
