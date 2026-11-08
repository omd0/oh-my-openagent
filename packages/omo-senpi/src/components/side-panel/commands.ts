import { sanitizeTerminalText } from "./format/sanitize"
import { formatCount } from "./format/counts"
import { readGitDiff } from "./git/diff"
import type { PanelGitEntry } from "./git/parse"
import type { PanelExec } from "./git/read"
import { openPanelViewer } from "./popups/open"
import type { PanelGitStatus } from "./sections/files"
import type { PanelOverlayUi } from "./types"

const SELECTOR_FILE_CAP = 500
const SELECTOR_LABEL_MAX_CHARS = 512
const VIEWER_TITLE_MAX_CHARS = 512

/**
 * The named route to the panel's viewers.
 *
 * Rows are clickable in their own right (`links.ts`), and this is the same destination reached
 * by name - for keyboards, and for a host that hands out no URL hook. No default chord is
 * registered: picking a global key in someone else's editor invites a collision with the
 * user's own bindings.
 */

/** Structural slice of senpi's ExtensionCommandContext these commands read. */
export interface PanelCommandContext {
  readonly mode?: string
  readonly ui?: PanelCommandUi
}

interface PanelCommandUi extends PanelOverlayUi {
  select(title: string, options: string[]): Promise<string | undefined>
}

export interface PanelCommandDeps {
  readonly status: () => PanelGitStatus | undefined
  readonly exec: PanelExec | undefined
  /** Whether the column is mounted in this session; the command is registered before that is known. */
  readonly mounted: () => boolean
}

function fileOptionLabel(file: PanelGitEntry): string {
  const delta = file.added === undefined && file.removed === undefined
    ? ""
    : `  +${formatCount(file.added ?? 0)}/-${formatCount(file.removed ?? 0)}`
  // Bound the source before sanitizing; the host's select list folds newlines only.
  return sanitizeTerminalText(`${file.xy} ${file.path}${delta}`.slice(0, SELECTOR_LABEL_MAX_CHARS))
}

/** `/side-panel-diff`: pick a changed file, then show its diff. Registered by `index.ts`. */
export async function runDiffCommand(deps: PanelCommandDeps, ctx: PanelCommandContext): Promise<void> {
  const ui = ctx.ui
  if (ui === undefined) return
  if (!deps.mounted()) {
    ui.notify("The side panel is off in this session.", "info")
    return
  }
  const status = deps.status()
  if (status?.tooLarge === true) {
    ui.notify("Changes too large", "warning")
    return
  }
  if (status === undefined || status.files.length === 0) {
    ui.notify("No changes in the working copy.", "info")
    return
  }
  if (deps.exec === undefined) {
    ui.notify("This host exposes no exec, so git cannot be run.", "warning")
    return
  }
  const files = status.files.slice(0, SELECTOR_FILE_CAP)
  const omitted = status.files.length - files.length
  if (omitted > 0) ui.notify(`Showing ${SELECTOR_FILE_CAP} of ${formatCount(status.files.length)} changed files.`, "info")
  const labels = files.map(fileOptionLabel)
  const options = new Set(labels).size === labels.length
    ? labels
    : labels.map((label, index) => `${index + 1}. ${label}`.slice(0, SELECTOR_LABEL_MAX_CHARS))
  const choice = await ui.select("Show the diff of", options)
  if (choice === undefined) return
  const file = files[options.indexOf(choice)]
  if (file === undefined) return
  await openFileDiff(ui, deps.exec, status, file)
}

/** One file's diff in the shared viewer. Both the command and a clicked row land here. */
export async function openFileDiff(
  ui: PanelOverlayUi,
  exec: PanelExec,
  status: PanelGitStatus,
  file: PanelGitEntry,
): Promise<void> {
  const rows = await readGitDiff(exec, status.root, file)
  await openPanelViewer(ui, `${file.path.slice(0, VIEWER_TITLE_MAX_CHARS)}  (diff, read-only)`, rows)
}
