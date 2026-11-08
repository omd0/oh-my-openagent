// Deterministic temp-git fixture + real-input builders for the native DAG panel Changes live QA.
//
// Pure helpers (plan, SGR, coords, color predicates) are covered by `selfTest()` below so the
// live driver can rely on them. Git materialization (`ensureChangesFixture`,
// `appendOversizedFixture`) runs in the live driver only, inside the sandbox cwd, with no network.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

/** Collapsed preview rows before `Show more`; mirrors `FILE_VISIBLE_ROWS` + scenario preview. */
export const FIXTURE_PREVIEW = 8
/** Normal-phase tracked changes: more than a viewport, fewer than the 500-row cap. */
export const FIXTURE_TOTAL = 60
/** Oversized-phase root files: pushes the total past `MAX_CHANGE_ROWS` (500). */
export const OVERSIZED_COUNT = 600
/** Exact delta the live panel must show for the known file. */
export const KNOWN_FILE = "00-known-delta.ts"
export const KNOWN_SUFFIX = "+5/-0"
/**
 * The new-file row, and the reason it is a STAGED ADD rather than an untracked entry: git's
 * porcelain reports every tracked change before the untracked section, so an untracked name can
 * never reach the collapsed preview (see `changesStatusOrder`). `A ` is `new` to the panel's own
 * `changeKind`, exactly like `??`, and its numeric prefix keeps it inside the preview window.
 */
export const KNOWN_NEW_FILE = "00-known-new-ts.ts"
export const KNOWN_NEW_SUFFIX = "+1/-0"
/**
 * Numeric prefixes keep the mandatory fixtures inside the collapsed preview: `git status`
 * sorts its porcelain output, so `00`-`06` sort before `alpha`/`file`/`mid`/`untracked`.
 * Basename tokens (`known-delta`, the long name, CJK, `gone`, `bigdiff`) are preserved.
 */
export const LONG_FILE = "02-with-a-very-long-file-name-that-exceeds-the-column-width-entirely-ts.ts"
export const LONG_TOKEN = "with-a-very-long-file-name-that-exceeds"
export const CJK_FILE = "03-日本語-가나다-very-long-mixed-width-file-name-ts.ts"
export const CJK_TOKEN = "日本語"
export const LAST_FILE = "zz-lastfile-omega-ts.ts"
/** File with a ~50-line diff so the diff viewer is scrollable. Sorts second, inside the preview. */
export const BIGDIFF_FILE = "01-bigdiff-lines-ts.ts"
/** Deleted file proving the red hue. Sorts fifth, inside the preview. */
export const GONE_FILE = "04-gone-tracked-ts.ts"
export const STAGED_A_FILE = "05-alpha-00-ts.ts"
export const STAGED_B_FILE = "06-alpha-01-ts.ts"

/** Untracked tail: `git-added` and `??` are both `new` to the panel, and this section sorts last. */
export const UNTRACKED_COUNT = 12
export const UNTRACKED_FIRST = "untracked-00-ts.ts"
export const UNTRACKED_LAST = `untracked-${String(UNTRACKED_COUNT - 1).padStart(2, "0")}-ts.ts`
/**
 * Rows the RUN itself adds ahead of the fixture files. The project's own `.omo/omo.jsonc` is
 * committed by the baseline, then rewritten by the config migration at startup, so git reports it
 * as a tracked change - and `.omo/` sorts before every fixture name. Modelled here because the
 * preview window is shared: one product-side row is the difference between a fixture row being
 * inside the collapsed preview and being the first hidden one.
 */
export const PREVIEW_SIBLING_ROWS = [".omo/omo.jsonc"]

/** Published 256-color ramps from the panel's change-color contract (hardcoded, never computed). */
export const GREEN_RAMP = [65, 71, 34, 40, 46]
export const RED_RAMP = [131, 167, 196, 203, 210]
export const YELLOW_RAMP = [136, 142, 178, 184, 220]

/** SGR mouse button codes the live PTY understands. */
export const SGR_WHEEL_UP = 64
export const SGR_WHEEL_DOWN = 65

/** A wheel notch at 1-based terminal coords. Press form only; wheels emit no release. */
export function sgrWheel(up, x, y) {
  if (!Number.isInteger(x) || x < 1 || !Number.isInteger(y) || y < 1) throw new Error(`sgrWheel needs 1-based coords, got x=${x} y=${y}`)
  return `\u001b[<${up ? SGR_WHEEL_UP : SGR_WHEEL_DOWN};${x};${y}M`
}

/** A click is press + release in the same cell with no drag; the host resolves the hyperlink. */
export function sgrClickPress(x, y) {
  if (!Number.isInteger(x) || x < 1 || !Number.isInteger(y) || y < 1) throw new Error(`sgrClickPress needs 1-based coords, got x=${x} y=${y}`)
  return `\u001b[<0;${x};${y}M`
}

export function sgrClickRelease(x, y) {
  if (!Number.isInteger(x) || x < 1 || !Number.isInteger(y) || y < 1) throw new Error(`sgrClickRelease needs 1-based coords, got x=${x} y=${y}`)
  return `\u001b[<0;${x};${y}m`
}

/**
 * 1-based SGR coords of a panel row holding `token`. `viewport` is the xterm viewport text,
 * `cols` the terminal width, `width` the panel width. Throws when the token is offscreen: the
 * caller scrolls first instead of clicking blindly.
 */
export function findPanelRowCoords(viewport, cols, width, token) {
  if (!Number.isInteger(cols) || cols <= 0) throw new Error("findPanelRowCoords needs a positive cols")
  const left = Math.max(0, cols - width - 2)
  const lines = viewport.split("\n")
  const index = lines.findIndex((line) => line.slice(left).includes(token))
  if (index < 0) throw new Error(`row holding ${JSON.stringify(token)} is not on screen`)
  return { x: left + 1 + 5, y: index + 1 }
}

/** 1-based coords over the transcript (left of the panel) at the same viewport row. */
export function chatCoords(cols, width, y) {
  const left = Math.max(0, cols - width - 2)
  const x = Math.max(1, Math.min(left - 10, 20))
  return { x, y }
}

/** 1-based coords over the panel body at a viewport row. */
export function panelCoords(cols, width, y) {
  const left = Math.max(0, cols - width - 2)
  return { x: left + 1 + 8, y }
}

/**
 * True when a snapshot cell carries palette styling, per the pinned xterm BufferCell API
 * (`AttributeData.isFgPalette`, true for P16/P256 modes). Never a numeric mode assumption.
 */
export function cellIsPalette(cell) {
  return cell?.fgPalette === true
}

/** True when any cell in the column span carries palette styling. */
export function rowHasPalette(cells, startCol, endCol) {
  if (!Array.isArray(cells)) return false
  const from = Math.max(0, startCol)
  const to = Math.min(cells.length, endCol)
  for (let i = from; i < to; i += 1) {
    if (cellIsPalette(cells[i])) return true
  }
  return false
}

export function rowHas256Color(cells, startCol, endCol) {
  return rowHasPalette(cells, startCol, endCol)
}

/**
 * The palette indices painted over a token's columns. Empty when the token is absent or no
 * cell in its span carries palette styling.
 */
export function tokenPaletteIndices(cellsRow, left, lineText, token) {
  if (!Array.isArray(cellsRow) || typeof lineText !== "string" || typeof token !== "string") return []
  const index = lineText.indexOf(token)
  if (index < 0) return []
  const out = []
  for (let i = 0; i < token.length; i += 1) {
    const cell = cellsRow[left + index + i]
    if (cellIsPalette(cell)) out.push(cell.fg)
  }
  return out
}

/**
 * Every palette index over the token's columns must belong to `ramp`. Fails closed: a token
 * with no palette cells, or any index outside the ramp, is not the asserted hue.
 */
export function tokenHasRamp(cellsRow, left, lineText, token, ramp) {
  const indices = tokenPaletteIndices(cellsRow, left, lineText, token)
  return indices.length === token.length && indices.every((index) => ramp.includes(index))
}

/** Transcript region: everything left of the panel slice. */
export function transcriptRegion(viewport, cols, width) {
  const left = Math.max(0, cols - width - 2)
  return viewport.split("\n").map((line) => line.slice(0, left)).join("\n")
}

/** Deterministic file plan: basenames only, all at the repo root so none collapse to a dir row. */
export function changesFixturePlan() {
  const files = [
    KNOWN_FILE,
    BIGDIFF_FILE,
    STAGED_A_FILE,
    STAGED_B_FILE,
    "07-alpha-02-ts.ts",
    GONE_FILE,
    LONG_FILE,
    CJK_FILE,
    "mid-10-ts.ts",
    "mid-11-ts.ts",
    "mid-12-ts.ts",
    "mid-13-ts.ts",
    "mid-14-ts.ts",
    "mid-15-ts.ts",
    "mid-16-ts.ts",
    "mid-17-ts.ts",
    "mid-18-ts.ts",
    "mid-19-ts.ts",
    "mid-20-ts.ts",
    "mid-21-ts.ts",
  ]
  let n = 0
  while (files.length < FIXTURE_TOTAL - 1) {
    files.push(`file-${String(n).padStart(2, "0")}-ts.ts`)
    n += 1
  }
  files.push(LAST_FILE)
  const untracked = Array.from({ length: UNTRACKED_COUNT }, (_, index) => `untracked-${String(index).padStart(2, "0")}-ts.ts`)
  return {
    preview: FIXTURE_PREVIEW,
    total: FIXTURE_TOTAL,
    files,
    added: [KNOWN_NEW_FILE],
    untracked,
    known: KNOWN_FILE,
    knownNew: KNOWN_NEW_FILE,
    long: LONG_FILE,
    cjk: CJK_FILE,
    last: LAST_FILE,
    bigdiff: BIGDIFF_FILE,
    gone: GONE_FILE,
  }
}

/**
 * The order git's `--porcelain=v1` reports this fixture, in the order the panel renders it: one
 * tracked section (staged, unstaged and deleted changes, path order) and then the untracked
 * section (path order). Two live expectations rest on that shape, and both are pinned here so a
 * fixture rename cannot quietly invalidate them:
 *  - only a TRACKED entry can lead the collapsed preview, which is why the leading new-file row is
 *    a staged add (`A `) and never an untracked one;
 *  - every untracked row sorts after every tracked change, so the untracked tail is only reachable
 *    by scrolling the expanded list.
 */
export function changesStatusOrder({ siblings = PREVIEW_SIBLING_ROWS } = {}) {
  const plan = changesFixturePlan()
  const tracked = [...siblings, ...plan.files, ...plan.added].sort()
  const untracked = [...plan.untracked].sort()
  return { tracked, untracked, order: [...tracked, ...untracked], preview: tracked.slice(0, plan.preview) }
}

/**
 * True when a painted row is the given entry's git-ADDED row: the `A` status cell, its empty second
 * status cell, the row's gap column, the name, and then the delta. A modified entry paints
 * `M ` + gap (`M  <name>`), so this cannot pass for one.
 */
export function addedEntryRow(rowText, name, suffix) {
  if (typeof rowText !== "string") return false
  const head = `A  ${name}`
  const index = rowText.indexOf(head)
  if (index < 0) return false
  return rowText.slice(index + head.length).includes(suffix)
}

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 60_000 })
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${(result.stderr ?? "").slice(0, 500)}`)
  return result.stdout
}

/**
 * Materialize the temp git repo inside the sandbox cwd: baseline commit, then staged + unstaged
 * + deleted + added + untracked changes totalling `FIXTURE_TOTAL` tracked entries plus the
 * untracked tail, with known deltas. Returns the plan summary. Live only; throws a clear error when
 * git is unavailable.
 */
export function ensureChangesFixture(cwd) {
  const plan = changesFixturePlan()
  try {
    mkdirSync(cwd, { recursive: true })
    if (!existsSync(join(cwd, ".git"))) git(cwd, ["init", "-q"])
    git(cwd, ["config", "user.email", "qa@example.com"])
    git(cwd, ["config", "user.name", "QA"])
    git(cwd, ["config", "commit.gpgsign", "false"])
  } catch (error) {
    throw new Error(`changes fixture needs git: ${error instanceof Error ? error.message : String(error)}`)
  }
  // Baseline: every plan file tracked, so later edits read as modifications, not noise. The added
  // and untracked entries are deliberately NOT in it: they must read as new to git.
  const baselineLines = Array.from({ length: 10 }, (_, i) => `baseline ${i}`)
  for (const name of plan.files) {
    if (name === GONE_FILE) {
      writeFileSync(join(cwd, name), `${baselineLines.join("\n")}\n`)
      continue
    }
    if (name === KNOWN_FILE) {
      writeFileSync(join(cwd, name), `${baselineLines.join("\n")}\n`)
      continue
    }
    if (name === BIGDIFF_FILE) {
      writeFileSync(join(cwd, name), `${Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n")}\n`)
      continue
    }
    writeFileSync(join(cwd, name), `content of ${name}\n`)
  }
  git(cwd, ["add", "-A"])
  git(cwd, ["commit", "-qm", "qa baseline"])
  // Modifications with known deltas.
  writeFileSync(join(cwd, KNOWN_FILE), `${[...baselineLines, "qa one", "qa two", "qa three", "qa four", "qa five"].join("\n")}\n`)
  writeFileSync(join(cwd, BIGDIFF_FILE), `${Array.from({ length: 150 }, (_, i) => `line ${i}`).join("\n")}\n`)
  rmSync(join(cwd, GONE_FILE), { force: true })
  // Staged hue: modify + stage two files.
  for (const name of [STAGED_A_FILE, STAGED_B_FILE]) {
    writeFileSync(join(cwd, name), `content of ${name}\nqa staged edit\n`)
  }
  git(cwd, ["add", STAGED_A_FILE, STAGED_B_FILE])
  // New-file hue that can actually be on screen: a staged ADD, one line, so git reports `A  <name>`
  // and the panel paints the name green. Its `00-` prefix sorts it right behind KNOWN_FILE.
  for (const name of plan.added) {
    writeFileSync(join(cwd, name), `new file ${name}\n`)
    git(cwd, ["add", name])
  }
  // Touch every other tracked file so the changed total (≈70) exceeds a 42-row viewport:
  // the expanded full column must scroll to the last file. Known/bigdiff/staged/gone keep theirs.
  for (const name of plan.files) {
    if ([KNOWN_FILE, BIGDIFF_FILE, GONE_FILE, STAGED_A_FILE, STAGED_B_FILE].includes(name)) continue
    writeFileSync(join(cwd, name), `${readFileSync(join(cwd, name), "utf8")}qa touch\n`)
  }
  // Untracked tail: fresh names never committed, so they read as new (green) too - and, because
  // git prints the whole untracked section after the tracked one, they are reachable only by
  // scrolling the expanded list.
  for (const name of plan.untracked) writeFileSync(join(cwd, name), `new ${name}\n`)
  return { ...plan, entries: plan.files.length + plan.added.length + plan.untracked.length, oversized: false }
}

/** Append OVERSIZED_COUNT root files so the total passes MAX_CHANGE_ROWS; the panel must warn. */
export function appendOversizedFixture(cwd) {
  for (let i = 0; i < OVERSIZED_COUNT; i += 1) {
    writeFileSync(join(cwd, `bulk-${String(i).padStart(4, "0")}-ts.ts`), `bulk ${i}\n`)
  }
  return { added: OVERSIZED_COUNT }
}

export function selfTest() {
  const plan = changesFixturePlan()
  if (plan.files.length !== FIXTURE_TOTAL) throw new Error(`self-test: plan holds ${plan.files.length} files, want ${FIXTURE_TOTAL}`)
  if (!plan.files.includes(KNOWN_FILE) || !plan.files.includes(LONG_FILE) || !plan.files.includes(CJK_FILE) || !plan.files.includes(LAST_FILE) || !plan.files.includes(BIGDIFF_FILE)) {
    throw new Error("self-test: plan misses a mandatory named file")
  }
  if (plan.files[plan.files.length - 1] !== LAST_FILE) throw new Error("self-test: the last file sorts last")
  if (!plan.added.includes(KNOWN_NEW_FILE)) throw new Error(`self-test: the added new file must be ${KNOWN_NEW_FILE}`)
  if (plan.files.includes(KNOWN_NEW_FILE)) throw new Error("self-test: the added new file must NOT be in the baseline tracked set")
  const everyName = [...plan.files, ...plan.added, ...plan.untracked]
  if (new Set(everyName).size !== everyName.length) throw new Error("self-test: plan basenames collide")
  if (everyName.some((n) => n.includes("/"))) throw new Error("self-test: plan files stay at the root, so the painted basename IS the clicked path")

  // The real reporting order: tracked entries first (path order), then the untracked section. Both
  // live expectations - the collapsed new-file row and the untracked tail being off-screen - are
  // consequences of that shape, so they are pinned here instead of being assumed by the driver.
  const status = changesStatusOrder()
  if (status.tracked[0] !== PREVIEW_SIBLING_ROWS[0]) throw new Error(`self-test: the run's own config row leads the tracked section, got ${status.tracked[0]}`)
  if (status.tracked[1] !== KNOWN_FILE || status.tracked[2] !== KNOWN_NEW_FILE) {
    throw new Error(`self-test: the added row must sort right behind ${KNOWN_FILE}, got ${status.tracked.slice(1, 4).join(",")}`)
  }
  if (status.preview.length !== FIXTURE_PREVIEW) throw new Error(`self-test: the collapsed preview is ${FIXTURE_PREVIEW} rows, got ${status.preview.length}`)
  for (const name of [KNOWN_FILE, KNOWN_NEW_FILE, BIGDIFF_FILE, LONG_FILE, CJK_FILE, GONE_FILE]) {
    if (!status.preview.includes(name)) throw new Error(`self-test: ${name} must be inside the collapsed preview, got ${status.preview.join(",")}`)
  }
  if (status.preview.some((name) => status.untracked.includes(name))) throw new Error("self-test: an untracked row can never reach the collapsed preview")
  const withoutSibling = changesStatusOrder({ siblings: [] })
  if (!withoutSibling.preview.includes(KNOWN_NEW_FILE)) throw new Error("self-test: the added row must survive one fewer product-side row in the preview")
  if (status.tracked.at(-1) !== LAST_FILE) throw new Error(`self-test: ${LAST_FILE} is the last TRACKED row, got ${status.tracked.at(-1)}`)
  if (status.untracked[0] !== UNTRACKED_FIRST || status.untracked.at(-1) !== UNTRACKED_LAST) {
    throw new Error(`self-test: the untracked section runs ${UNTRACKED_FIRST}..${UNTRACKED_LAST}, got ${status.untracked[0]}..${status.untracked.at(-1)}`)
  }
  if (status.order.indexOf(LAST_FILE) >= status.order.length - plan.untracked.length) {
    throw new Error("self-test: the untracked section must sort after every tracked change")
  }

  // The added row is read with its own status, so a modified row can never satisfy the new-file check.
  if (!addedEntryRow(`  │ A  ${KNOWN_NEW_FILE}   ${KNOWN_NEW_SUFFIX}`, KNOWN_NEW_FILE, KNOWN_NEW_SUFFIX)) throw new Error("self-test: a git-added row must read as the new-file row")
  if (addedEntryRow(`  │ M  ${KNOWN_NEW_FILE}   ${KNOWN_NEW_SUFFIX}`, KNOWN_NEW_FILE, KNOWN_NEW_SUFFIX)) throw new Error("self-test: a modified row must not read as the new-file row")
  if (addedEntryRow(`  │ ?? ${UNTRACKED_FIRST}`, UNTRACKED_FIRST, KNOWN_NEW_SUFFIX)) throw new Error("self-test: an untracked row is not a staged add")
  if (addedEntryRow(`  │ A  ${KNOWN_NEW_FILE}   +9/-9`, KNOWN_NEW_FILE, KNOWN_NEW_SUFFIX)) throw new Error("self-test: the new-file row keeps its exact delta")

  const up = sgrWheel(true, 114, 20)
  const down = sgrWheel(false, 20, 20)
  if (up !== "\u001b[<64;114;20M" || down !== "\u001b[<65;20;20M") throw new Error("self-test: wheel SGR codes")
  if (sgrClickPress(114, 9) !== "\u001b[<0;114;9M" || sgrClickRelease(114, 9) !== "\u001b[<0;114;9m") throw new Error("self-test: click SGR codes")
  let rejected = false
  try {
    sgrWheel(true, 0, 20)
  } catch {
    rejected = true
  }
  if (!rejected) throw new Error("self-test: zero x must be rejected")

  const viewport = [["editor line", ""], ["trace", "  SESSION"], ["trace", `  M ${KNOWN_FILE}  +5/-0`], ["trace", `  Show more · +52 more`]].map(([t, p]) => t.padEnd(108) + p).join("\n")
  const coords = findPanelRowCoords(viewport, 150, 40, "Show more")
  if (coords.y !== 4 || coords.x < 109) throw new Error("self-test: Show more coords land in the panel")
  let missing = false
  try {
    findPanelRowCoords(viewport, 150, 40, "nope-missing-token")
  } catch {
    missing = true
  }
  if (!missing) throw new Error("self-test: an offscreen token must throw, not click blindly")
  const chat = chatCoords(150, 40, 20)
  const panel = panelCoords(150, 40, 20)
  if (!(chat.x < 109 && panel.x >= 109)) throw new Error("self-test: chat stays left of the panel")
  if (transcriptRegion(viewport, 150, 40).includes("Show more")) throw new Error("self-test: transcript region excludes the panel slice")

  const cells = [{ fgPalette: false, fg: -1 }, { fgPalette: true, fg: 65 }, { fgPalette: false, fg: -1 }]
  if (!rowHasPalette(cells, 0, 3) || rowHasPalette([{ fgPalette: false, fg: -1 }], 0, 1)) throw new Error("self-test: palette predicate")
  if (!rowHas256Color(cells, 0, 3)) throw new Error("self-test: palette alias")
  const line = ` M ${KNOWN_FILE}  +5/-0`
  const row = Array.from({ length: 40 }, (_, i) => ({ fgPalette: false, fg: -1 }))
  for (let i = 0; i < KNOWN_FILE.length; i += 1) row[3 + i] = { fgPalette: true, fg: YELLOW_RAMP[2] }
  const plusAt = line.indexOf("+5")
  for (let i = 0; i < 2; i += 1) row[plusAt + i] = { fgPalette: true, fg: GREEN_RAMP[1] }
  const minusAt = line.indexOf("-0")
  for (let i = 0; i < 2; i += 1) row[minusAt + i] = { fgPalette: true, fg: RED_RAMP[1] }
  if (!tokenHasRamp(row, 0, line, KNOWN_FILE, YELLOW_RAMP)) throw new Error("self-test: modified name reads yellow")
  if (!tokenHasRamp(row, 0, line, "+5", GREEN_RAMP)) throw new Error("self-test: added count reads green")
  if (!tokenHasRamp(row, 0, line, "-0", RED_RAMP)) throw new Error("self-test: removed count reads red")
  if (tokenHasRamp(row, 0, line, "+5", RED_RAMP)) throw new Error("self-test: a green count must not pass as red")
  return { ok: true, driver: "native-dag-panel-changes-helpers", selfTest: true, checks: 27 }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(selfTest()))
}
