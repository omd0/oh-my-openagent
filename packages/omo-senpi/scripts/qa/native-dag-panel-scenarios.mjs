// Deterministic half of the native DAG panel TUI QA: the fixture graphs, the screen readers the
// driver asserts with, and the contract check that pins both. Loaded by the driver AND by the
// in-engine fixture extension, so the tokens the fixture publishes and the tokens the driver looks
// for cannot drift apart.
//
// The readers target the panel's real rendering (packages/omo-senpi/src/components/side-panel/
// sections/dag.ts, dag-box.ts, dag-overlay-rows.ts): a run header per run, one four-line node box
// per node, a dependency row naming the parents, and in the overlay a connector row per real edge.
import { pathToFileURL } from "node:url"

export const DRIVER = "native-dag-panel-tui-qa"

/** Project directory inside the sandbox HOME, so the panel's location row reads `~/dagpanel`. */
export const PROJECT_DIR_NAME = "dagpanel"

/** Panel column width pinned by the driver's omo.json; the region reader slices exactly this. */
export const PANEL_WIDTH = 40

/** Terminals narrower than this drop the column (side_panel.min_columns in the driver's omo.json). */
export const MIN_COLUMNS = 120

export const RUN_ID = "run-native-dag-panel-qa"
export const RUN_KEY = "native-dag-panel-qa"
export const RUN_NAME = "QA Native Graph"

// Anchored to the run's own clock: created 15 minutes ago, the live node started three minutes ago,
// the settled ones finished half a minute ago. The graph structure is fixed; only its clock is real,
// so an observer reading the frames sees plausible elapsed times instead of a stale epoch.
const BASE_MS = Date.now() - 15 * 60_000
const at = (seconds) => new Date(BASE_MS + seconds * 1000).toISOString()
const CREATED_AT = 0
const STARTED_AT = 720
const COMPLETED_AT = 870
const UPDATED_AT = 900

export const NODE_IDS = ["fetch", "build", "verify"]

/** Labels are fixture-owned tokens short enough to survive a 40-column node box. */
export const LABELS = { fetch: "FETCH", build: "BUILD", verify: "VERIFY" }
export const NODE_LABELS = Object.values(LABELS)

/** The dependencies each node must render, by label, in the box's own dependency row. */
export const DEPENDENCIES = { fetch: [], build: ["FETCH"], verify: ["FETCH", "BUILD"] }

/** The state words the panel's own builder prints for each fixture state. */
export const STATE_WORDS = { completed: "done", running: "running", scheduled: "scheduled" }

/**
 * Prompt tails are longer than a column row, so their presence on screen can only come from the
 * overlay's detail block, which wraps the prompt. The column truncates it away.
 */
export const TAILS = { fetch: "QA-TAIL-FETCH-7K2", build: "QA-TAIL-BUILD-4M9", verify: "QA-TAIL-VERIFY-1Q6" }
export const ALL_TAILS = Object.values(TAILS)

const PROMPTS = {
  fetch: `Prepare the workspace for the QA graph.\n\n${TAILS.fetch} drains the fixture cache.`,
  build: `Link the artifact set for the QA graph.\n\n${TAILS.build} resolves the fixture links.`,
  verify: `Compare the produced hashes for the QA graph.\n\n${TAILS.verify} checks the fixture output.`,
}

/** Activity is fixture-owned telemetry text, one marker per live node per stage. */
export const ACTIVITY = { started: { build: "KILN compiling widgets" }, progressed: { verify: "BLAZE verifying output" }, settled: {} }

export const STAGES = ["started", "progressed", "settled"]

/** Tokens the real builders emit; the reader looks for these, never for prose. */
export const RUN_HEADER_PREFIX = "DAG"
export const DEPENDENCY_ARROW = "←"
export const OVERLAY_CONNECTOR = "▼"
export const OVERLAY_TITLE_PREFIX = "DAG ·"
export const BOX_TOP_LEFT = "╭"

/** Changes block tokens the real `sections/files.ts` builders emit; readers key on these. */
export const CHANGES_HEADING = "FILES"
export const CHANGES_SHOW_MORE = "Show more"
export const CHANGES_SHOW_LESS = "Show less"
export const CHANGES_TOO_LARGE = "Changes too large"
export const CHANGES_HUGE_MARK = "huge"
export const CHANGES_NAME_CUTOFF = ".."
/** Collapsed preview rows before the `Show more` count; mirrors `FILE_VISIBLE_ROWS`. */
export const CHANGES_PREVIEW_ROWS = 8

/** The panel's own section heading; it exists before any run does, so it anchors the column itself. */
export const PANEL_HEADING = "SESSION"
export const PANEL_HEADING_ALT = "CONTEXT"

/**
 * The host's own "history is scrolled away from the newest message" indicator, painted by the
 * alt-screen renderer (`scrollToEndIndicator`) only while the transcript viewport is not at the
 * bottom. Its jump key is the host binding `tui.altScreen.bottom` (default `end`), which is the real
 * input a reader must send before any rendered-answer predicate can see the newest message.
 */
export const TRANSCRIPT_JUMP_HINT = "Jump to latest message"

/**
 * The parent lane's answer, stamped with the provider request ordinal. The stamp is what lets a
 * driver prove the frame it reads is THIS turn's answer: an identical older answer still on screen
 * would otherwise satisfy a plain text predicate.
 */
export const PARENT_ANSWER_PREFIX = "QA fixture session ready."

export function parentAnswer(turn) {
  if (!Number.isInteger(turn) || turn <= 0) throw new Error(`parentAnswer needs a positive request ordinal, got ${turn}`)
  return `${PARENT_ANSWER_PREFIX} (turn ${turn})`
}

/** Is the transcript viewport pinned to its newest message? */
export function transcriptAtLatest(viewport) {
  return !String(viewport).includes(TRANSCRIPT_JUMP_HINT)
}

/**
 * The fullscreen column paints a vertical rule in its own first cell and one blank cell after it
 * (`PANEL_DIVIDER` + `PANEL_DIVIDED_GUTTER_LEFT` in the panel's `body.ts`); only the widget fallback
 * uses the plain margin. Both forms ARE the column, and no other text may sit around the heading.
 */
export const PANEL_DIVIDER_GUTTER = "│ "

/**
 * Where the divided column's rule sits inside the panel region: `panelRegion` starts two columns
 * before the column's own width, and the pinned contract in the driver's render contract keeps the
 * rule in the region's third cell. A frame painted at ANOTHER width is right-aligned at THAT width,
 * so slicing it with a different geometry puts the rule somewhere else. That is the only content
 * difference between a repaint of the requested geometry and the previous frame, because trimming
 * hides the offset from the heading reader.
 */
export const PANEL_DIVIDER_INDEX = 2

/**
 * Is this frame the divided fullscreen column, at the geometry it was read with? The rule must be in
 * the region's own third cell on some row; a frame painted at a wider or narrower terminal cannot
 * put it there.
 */
export function hasPanelGutterAt(panelLines, index = PANEL_DIVIDER_INDEX) {
  return panelLines.some((line) => String(line).slice(index, index + PANEL_DIVIDER_GUTTER.length) === PANEL_DIVIDER_GUTTER)
}

/**
 * How many nodes the column's own overflow row accounts for, or undefined when the line is not that
 * row. The builder emits `+<remaining> more nodes · open graph` (`sections/dag.ts`), and the
 * fullscreen column paints it behind its `│ ` gutter, which `panelRegion` keeps. The gutter is
 * optional exactly once (the widget fallback paints the same row with a plain margin); a zero count,
 * a missing count, a different noun (`more runs`) or any other text in front of the row is not the
 * designed short-terminal outcome.
 */
export function overflowNodeCount(line) {
  const text = String(line).trim()
  const body = text.startsWith(PANEL_DIVIDER_GUTTER) ? text.slice(PANEL_DIVIDER_GUTTER.length) : text
  const match = /^\+(\d{1,9}) more nodes(?:$|[\s·])/.exec(body)
  if (match === null) return undefined
  const count = Number(match[1])
  return Number.isInteger(count) && count > 0 ? count : undefined
}

/** The column's overflow row and the node count it claims, or undefined when none is on screen. */
export function overflowNotice(panelLines) {
  for (const line of panelLines) {
    const count = overflowNodeCount(line)
    if (count !== undefined) return { line, count }
  }
  return undefined
}

function node(id, state) {
  const startedAt = state === "scheduled" ? undefined : at(STARTED_AT)
  const completedAt = state === "completed" ? at(COMPLETED_AT) : undefined
  return {
    id,
    label: LABELS[id],
    prompt: PROMPTS[id],
    dependsOn: DEPENDENCIES[id].map((label) => label.toLowerCase()),
    state,
    attempt: 1,
    createdAt: at(CREATED_AT),
    ...(startedAt === undefined ? {} : { startedAt }),
    ...(completedAt === undefined ? {} : { completedAt }),
  }
}

const NODE_STATES = {
  started: { fetch: "completed", build: "running", verify: "scheduled" },
  progressed: { fetch: "completed", build: "completed", verify: "running" },
  settled: { fetch: "completed", build: "completed", verify: "completed" },
}

const RUN_STATUS = { started: "running", progressed: "running", settled: "completed" }

/** The state each node carries in a stage, so the driver can assert the rendered word per node. */
export function stageStates(stage) {
  const states = NODE_STATES[stage]
  if (states === undefined) throw new Error(`unknown stage: ${stage}`)
  return states
}

/** The node a stage leaves running, if any: the one that must carry live activity. */
export function runningNode(stage) {
  const states = stageStates(stage)
  return NODE_IDS.find((id) => states[id] === "running")
}

/**
 * The graph a stage publishes. The frontier is real (fetch fans out to build and verify, build gates
 * verify), never a linear decoration.
 */
export function stageRuns(stage) {
  const states = stageStates(stage)
  const nodes = NODE_IDS.map((id) => node(id, states[id]))
  const completed = nodes.filter((entry) => entry.state === "completed").length
  const running = nodes.filter((entry) => entry.state === "running").length
  const counts = { total: nodes.length, completed, running, pending: nodes.length - completed - running, failed: 0 }
  return [
    {
      runId: RUN_ID,
      runKey: RUN_KEY,
      name: RUN_NAME,
      status: RUN_STATUS[stage],
      createdAt: at(CREATED_AT),
      updatedAt: at(UPDATED_AT + STAGES.indexOf(stage)),
      ...(stage === "settled" ? { completedAt: at(UPDATED_AT + 1) } : {}),
      counts,
      nodes,
      edges: [
        { from: "fetch", to: "build" },
        { from: "fetch", to: "verify" },
        { from: "build", to: "verify" },
      ],
      waves: [
        { index: 0, nodeIds: ["fetch"] },
        { index: 1, nodeIds: ["build"] },
        { index: 2, nodeIds: ["verify"] },
      ],
    },
  ]
}

/** The port shape `claimDagPanelFeed` takes: `runs()` plus `activity(runId, nodeId)`. */
export function stageFeed(stage) {
  const runs = stageRuns(stage)
  const markers = ACTIVITY[stage] ?? {}
  return {
    runs: () => runs,
    activity: (runId, nodeId) => (runId === RUN_ID ? markers[nodeId] : undefined),
  }
}

// ---- screen readers ------------------------------------------------------------------------------

/**
 * The panel's own columns. The transcript is drawn to the left of `cols - width`, so slicing at that
 * boundary keeps transcript decorations (and its own box drawing) out of every graph assertion. Two
 * spare columns absorb a separator the host may paint between the transcript and the column.
 */
export function panelRegion(screenText, { cols, width = PANEL_WIDTH }) {
  if (!Number.isInteger(cols) || cols <= 0) throw new Error(`panelRegion needs a positive column count, got ${cols}`)
  const left = Math.max(0, cols - width - 2)
  return screenText.split("\n").map((line) => (line.length > left ? line.slice(left) : ""))
}

export function linesContaining(text, token) {
  return text.split("\n").filter((line) => line.includes(token))
}

export function visibleTails(text) {
  return Object.entries(TAILS)
    .filter(([, tail]) => text.includes(tail))
    .map(([id]) => id)
}

/** Count of overlay edge-connector markers: one per real edge between neighbouring layers. */
export function connectorCount(text) {
  return [...text].filter((char) => char === OVERLAY_CONNECTOR).length
}

/**
 * One node's box, read the way the real builder writes it: a top border carrying the label, then
 * the status row, then the dependency row, then the bottom border. A node rendered as a flat list
 * row (no top border) comes back with `boxed: false`, which is what the column check rejects.
 */
export function boxFor(panelLines, label) {
  const topIndex = panelLines.findIndex((line) => line.includes(BOX_TOP_LEFT) && line.includes(label))
  if (topIndex < 0) {
    const labelIndex = panelLines.findIndex((line) => line.includes(label))
    return labelIndex < 0 ? undefined : { labelIndex, boxed: false, row: panelLines[labelIndex] }
  }
  return {
    labelIndex: topIndex,
    boxed: true,
    top: panelLines[topIndex],
    statusRow: panelLines[topIndex + 1],
    depsRow: panelLines[topIndex + 2],
    bottom: panelLines[topIndex + 3],
  }
}

/**
 * How one region line reads as the column's heading: the exact heading token, else undefined.
 * A single leading `│ ` (the divided column's rule plus its blank cell) is part of the column's own
 * frame; anything else in front of the words means the line is somebody else's text, and a word that
 * merely starts with the heading is not the heading.
 */
export function panelHeadingOf(line) {
  const own = (candidate) => (candidate === PANEL_HEADING || candidate === PANEL_HEADING_ALT ? candidate : undefined)
  const text = String(line).trim()
  const plain = own(text)
  if (plain !== undefined) return plain
  if (!text.startsWith(PANEL_DIVIDER_GUTTER)) return undefined
  return own(text.slice(PANEL_DIVIDER_GUTTER.length))
}

/**
 * Is the column itself on screen? The heading is printed by the panel's session section, and the
 * footer also prints the project path, so the path alone is not a column anchor.
 */
export function hasPanelHeading(panelLines) {
  return panelLines.some((line) => panelHeadingOf(line) !== undefined)
}

/** The heading tokens on screen, for a failure detail. Never used as the membership test itself. */
export function panelHeadingLines(panelLines) {
  return panelLines.map((line) => panelHeadingOf(line)).filter((heading) => heading !== undefined)
}

/** What one node's box says, so a check can name the exact missing piece. */
export function inspectBox(panelLines, label, expected) {
  const box = boxFor(panelLines, label)
  if (box === undefined) return { ok: false, reason: `${label} is not in the panel region` }
  if (!box.boxed) return { ok: false, reason: `${label} is a flat row, not a box`, row: box.row }
  const stateWords = expected.stateWord === undefined ? Object.values(STATE_WORDS) : [expected.stateWord]
  const stateWord = stateWords.join("|")
  const deps = expected.dependencies ?? []
  const missingDeps = deps.filter((dependency) => !(box.depsRow ?? "").includes(dependency))
  const startsFirst = deps.length === 0 && (box.depsRow ?? "").includes("starts first")
  const stateOk = stateWords.some((word) => (box.statusRow ?? "").includes(word))
  return {
    ok: stateOk && missingDeps.length === 0 && (deps.length > 0 || startsFirst),
    reason: [
      stateOk ? undefined : `status row ${JSON.stringify(box.statusRow)} lacks ${stateWord}`,
      missingDeps.length === 0 ? undefined : `dependency row ${JSON.stringify(box.depsRow)} lacks ${missingDeps.join(",")}`,
      deps.length > 0 || startsFirst ? undefined : `dependency row ${JSON.stringify(box.depsRow)} lacks "starts first"`,
    ]
      .filter((part) => part !== undefined)
      .join("; "),
    box,
  }
}

/** The panel line holding `token`, trimmed; undefined when the token is not on screen. */
export function lineFor(text, token) {
  return text.split("\n").find((line) => line.includes(token))?.trimEnd()
}

/** How a node row changed between two screens, so a repaint can be attributed to that node. */
export function nodeRowTransition(before, after, label) {
  const beforeLine = lineFor(before, label)
  const afterLine = lineFor(after, label)
  return { before: beforeLine, after: afterLine, changed: beforeLine !== afterLine, appeared: beforeLine === undefined && afterLine !== undefined }
}

/** Changes-block readers: structural row markers the live xterm text must carry. */
export function changesHeadingLine(panelLines) {
  return panelLines.find((line) => line.includes(CHANGES_HEADING) && /\d/.test(line))
}

export function showMoreLine(panelLines) {
  return panelLines.find((line) => line.includes(CHANGES_SHOW_MORE))
}

export function showLessLine(panelLines) {
  return panelLines.find((line) => line.includes(CHANGES_SHOW_LESS))
}

export function tooLargeLine(panelLines) {
  return panelLines.find((line) => line.includes(CHANGES_TOO_LARGE))
}

export function hugeMarkLine(panelLines) {
  return panelLines.find((line) => line.includes(CHANGES_HUGE_MARK))
}

/** A file row keeps its `+N/-M` suffix flush right: the trimmed row ends with the counts. */
export function hasRightAlignedSuffix(line) {
  return /[+-][\d.,kMBT]+[/][-+][\d.,kMBT]+$/.test(line.trimEnd()) || /[+-][\d.,kMBT]+$/.test(line.trimEnd())
}

/** A name cut to the column width ends with the two-dot marker, never a single ellipsis. */
export function hasNameCutoff(line) {
  return line.includes(CHANGES_NAME_CUTOFF)
}

/**
 * Deterministic contract check for this module. The screen fixtures below are the literal output of
 * the real builders at the driver's geometry, so a reader that no longer matches the rendering fails
 * here before any live run.
 */
export function selfTest() {  const cols = 150
  const left = () => "".padEnd(cols - PANEL_WIDTH)
  const screen = (...rows) => rows.map((row) => `${left()}${row}`).join("\n")

  const column = screen(
    "DAG  QA Native Graph  1/3 running",
    "╭─ ✓ FETCH ────────────────────────────╮",
    "│ done · 25s                           │",
    "│ starts first                         │",
    "╰──────────────────────────────────────╯",
    "  ╭─ ● BUILD ──────────────────────────╮",
    "  │ running · 55s · KILN compiling wi… │",
    "  │ ← FETCH                            │",
    "  ╰────────────────────────────────────╯",
  )
  const region = panelRegion(column, { cols })
  if (region.length !== 9) throw new Error("self-test: one region row per screen row")
  const fetchText = inspectBox(region, "FETCH", { stateWord: STATE_WORDS.completed, dependencies: DEPENDENCIES.fetch })
  if (!fetchText.ok) throw new Error(`self-test: a completed root box must read as done/starts first: ${fetchText.reason}`)
  const buildText = inspectBox(region, "BUILD", { stateWord: STATE_WORDS.running, dependencies: DEPENDENCIES.build })
  if (!buildText.ok) throw new Error(`self-test: a running box must name FETCH: ${buildText.reason}`)
  if (!(buildText.box.statusRow ?? "").includes("KILN")) throw new Error("self-test: live activity rides the status row")

  const withHeading = screen("  SESSION", "  model   mock-1", "  ~/dagpanel")
  if (!hasPanelHeading(panelRegion(withHeading, { cols }))) throw new Error("self-test: the panel heading anchors the column")
  // The live frame is the DIVIDED column: its rule and blank cell sit in the column's own first
  // cells, which the region reader keeps at its existing boundary (two spare columns, never a shift).
  const dividedHeading = screen(`${PANEL_DIVIDER_GUTTER}SESSION`, `${PANEL_DIVIDER_GUTTER}model   mock-1`, `${PANEL_DIVIDER_GUTTER}~/dagpanel`)
  const dividedRegion = panelRegion(dividedHeading, { cols })
  if (!hasPanelHeading(dividedRegion)) throw new Error(`self-test: the divided column's heading anchors the column, read ${JSON.stringify(dividedRegion[0])}`)
  if (dividedRegion[0].indexOf(PANEL_DIVIDER_GUTTER) !== 2) throw new Error(`self-test: the rule stays in the column's first cell two region columns in, read ${JSON.stringify(dividedRegion[0])}`)
  if (panelHeadingLines(dividedRegion).join(",") !== PANEL_HEADING) throw new Error(`self-test: the divided heading reads as exactly one heading token, read ${JSON.stringify(panelHeadingLines(dividedRegion))}`)

  const headingCases = [
    { line: `${PANEL_DIVIDER_GUTTER}${PANEL_HEADING}`, heading: PANEL_HEADING, why: "the divided column's heading" },
    { line: `  ${PANEL_DIVIDER_GUTTER}${PANEL_HEADING_ALT}`, heading: PANEL_HEADING_ALT, why: "the divided column's alternate heading" },
    { line: `  ${PANEL_HEADING}`, heading: PANEL_HEADING, why: "the widget fallback's plain heading" },
    { line: `TRACE ${PANEL_DIVIDER_GUTTER}${PANEL_HEADING}`, heading: undefined, why: "a transcript mention" },
    { line: `${PANEL_DIVIDER_GUTTER}${PANEL_HEADING}X`, heading: undefined, why: "a partial word" },
    { line: `  ${PANEL_DIVIDER_GUTTER}`, heading: undefined, why: "a bare rule" },
    { line: "", heading: undefined, why: "an empty row" },
    { line: `${PANEL_DIVIDER_GUTTER}${PANEL_DIVIDER_GUTTER}${PANEL_HEADING}`, heading: undefined, why: "two gutters" },
  ]
  for (const entry of headingCases) {
    const read = panelHeadingOf(entry.line)
    if (read !== entry.heading) throw new Error(`self-test: ${entry.why} must read as ${entry.heading ?? "no heading"}, got ${read ?? "none"} from ${JSON.stringify(entry.line)}`)
    if (hasPanelHeading([entry.line]) !== (entry.heading !== undefined)) throw new Error(`self-test: ${entry.why} must ${entry.heading === undefined ? "not " : ""}anchor the column`)
  }

  const footerOnly = `${"~/dagpanel · 1/200K · mock-1".padEnd(cols)}\n${"mock-1".padEnd(cols)}`
  if (hasPanelHeading(panelRegion(footerOnly, { cols }))) throw new Error("self-test: a footer-only row must not read as a mounted column")

  const flat = screen("DAG  QA Native Graph  1/3 running", "FETCH · done", "BUILD · running")
  const flatFetch = inspectBox(panelRegion(flat, { cols }), "FETCH", { stateWord: "done", dependencies: [] })
  if (flatFetch.ok || flatFetch.reason === undefined) throw new Error("self-test: a flat list must not pass as a boxed graph")

  const wrongState = inspectBox(region, "BUILD", { stateWord: STATE_WORDS.scheduled, dependencies: DEPENDENCIES.build })
  if (wrongState.ok) throw new Error("self-test: a state word mismatch must fail")
  const wrongDeps = inspectBox(region, "BUILD", { stateWord: STATE_WORDS.running, dependencies: ["VERIFY"] })
  if (wrongDeps.ok) throw new Error("self-test: a dependency mismatch must fail")

  const transcriptRow = "TRACE │ transcript ╭─ FETCH ╮ │ │ │".padEnd(cols - PANEL_WIDTH)
  const mixed = `${transcriptRow}BUILD`
  if (panelRegion(mixed, { cols })[0].includes("transcript")) throw new Error("self-test: transcript columns must not reach the panel region")

  const overlay = screen(
    "DAG · QA Native Graph                                      1/1 runs · tab/n node",
    "                                 ╭─ ✓ FETCH ──────────────────────╮",
    "                                 ╰────────────────────────────────╯",
    "                                                  ▼",
    "                                 ╭─ ● VERIFY ─────────────────────╮",
    "                                 ╰────────────────────────────────╯",
    "                        prompt  Compare the hashes … QA-TAIL-VERIFY-1Q6 checks the output.",
    "                        id      verify",
    "                        state   running · BLAZE verifying output",
  )
  if (connectorCount(overlay) !== 1) throw new Error("self-test: one connector marker per drawn edge")
  if (!overlay.includes(OVERLAY_TITLE_PREFIX)) throw new Error("self-test: the overlay frame carries its title")
  if (visibleTails(overlay).join(",") !== "verify") throw new Error("self-test: the detail block's prompt tail is found")

  const started = stageRuns("started")[0]
  if (started.nodes.find((entry) => entry.id === "build").state !== "running") throw new Error("self-test: stage started has build running")
  if (started.edges.length !== 3) throw new Error("self-test: frontier edges")
  if (started.nodes.find((entry) => entry.id === "verify").dependsOn.length !== 2) throw new Error("self-test: verify depends on both parents")
  if (runningNode("started") !== "build" || runningNode("progressed") !== "verify") throw new Error("self-test: the running node per stage")
  if (stageRuns("settled")[0].status !== "completed") throw new Error("self-test: stage settled completes the run")
  let rejected = false
  try {
    stageRuns("nope")
  } catch {
    rejected = true
  }
  if (!rejected) throw new Error("self-test: an unknown stage must be rejected")

  const feed = stageFeed("started")
  if (feed.activity(RUN_ID, "build") !== ACTIVITY.started.build) throw new Error("self-test: activity is keyed by run and node")
  if (feed.activity(RUN_ID, "verify") !== undefined) throw new Error("self-test: a non-running node carries no activity")
  if (feed.activity("other-run", "build") !== undefined) throw new Error("self-test: activity is scoped to the run")
  if (feed.runs().length !== 1) throw new Error("self-test: one fixture run")

  const transition = nodeRowTransition(column, column.replace("╭─ ● BUILD", "╭─ ✓ BUILD"), "BUILD")
  if (!transition.changed || transition.appeared) throw new Error("self-test: a node row transition is detected")

  const changesCollapsed = screen(
    "FILES  10 changed",
    " M short.ts                  +12/-3",
    "?? with-a-very-long-file-name-tha..  +1/-0",
    " M huge.ts  huge  +120.0k/-4",
    "Show more · +7 more",
  )
  const changesRegion = panelRegion(changesCollapsed, { cols })
  if (changesHeadingLine(changesRegion) === undefined) throw new Error("self-test: the Changes heading carries its count")
  if (showMoreLine(changesRegion) === undefined) throw new Error("self-test: a collapsed preview ends with Show more")
  if (showLessLine(changesRegion) !== undefined) throw new Error("self-test: a collapsed preview carries no Show less")
  const collapsedSuffix = changesRegion.find((line) => line.includes("short.ts"))
  if (collapsedSuffix === undefined || !hasRightAlignedSuffix(collapsedSuffix)) throw new Error("self-test: a file row keeps its counts flush right")
  const cutoffRow = changesRegion.find((line) => line.includes("with-a-very-long"))
  if (cutoffRow === undefined || !hasNameCutoff(cutoffRow)) throw new Error("self-test: a long name is cut with the two-dot marker")
  if (hugeMarkLine(changesRegion) === undefined) throw new Error("self-test: an oversized count carries the huge marker")

  const changesExpanded = screen("FILES  10 changed", "Show less", " M short.ts                  +12/-3")
  const expandedRegion = panelRegion(changesExpanded, { cols })
  if (showLessLine(expandedRegion) === undefined) throw new Error("self-test: an expanded list starts with Show less")
  if (showMoreLine(expandedRegion) !== undefined) throw new Error("self-test: an expanded list carries no Show more")

  const changesTooLarge = screen("FILES  600 changed", "Changes too large · 600 files", " M a.ts  +1/-0")
  if (tooLargeLine(panelRegion(changesTooLarge, { cols })) === undefined) throw new Error("self-test: a capped list warns instead of claiming a total")

  // The jump indicator is the host's own state for "history is scrolled away", and it is the only
  // precondition a rendered-answer wait can rely on. Both shapes below are real renders: the hint
  // row is what the live failure frame carried, and a bottom-pinned transcript carries none.
  const scrolledAway = `${left()}↓ ${TRANSCRIPT_JUMP_HINT} · End`
  if (transcriptAtLatest(scrolledAway)) throw new Error("self-test: a transcript carrying the jump indicator is not at its newest message")
  const atLatest = screen("seed line 99", "QA fixture session ready. (turn 4)")
  if (!transcriptAtLatest(atLatest)) throw new Error("self-test: a transcript without the jump indicator reads as at-latest")
  if (transcriptAtLatest(`${left()}↓ ${TRANSCRIPT_JUMP_HINT}`) !== false) throw new Error("self-test: the indicator reads the same inside the panel columns")

  // The stamped answer: one per request, and the prefix stays readable so the existing bleed token
  // (the bare prefix) still names the rendered answer.
  if (!parentAnswer(4).startsWith(PARENT_ANSWER_PREFIX)) throw new Error("self-test: the stamped answer keeps the answer prefix")
  if (parentAnswer(4) === parentAnswer(5)) throw new Error("self-test: two requests must not paint the same answer")
  let badTurn = false
  try {
    parentAnswer(0)
  } catch {
    badTurn = true
  }
  if (!badTurn) throw new Error("self-test: a non-positive request ordinal must be rejected")

  // The column's designed short-terminal overflow row. The rows below are the two shapes the real
  // builders paint: the divided fullscreen column keeps its `│ ` gutter after `panelRegion` sliced
  // the screen, and the widget fallback carries a plain margin. The count is the point of the row -
  // `+0` or a run-count row cannot explain a node box that is not drawn.
  const overflowCases = [
    { line: `  ${PANEL_DIVIDER_GUTTER}+2 more nodes · open graph`, count: 2, why: "the divided column's overflow row" },
    { line: "+12 more nodes · open graph", count: 12, why: "the fallback's plain overflow row" },
    { line: `  ${PANEL_DIVIDER_GUTTER}+0 more nodes · open graph`, count: undefined, why: "a zero count" },
    { line: `  ${PANEL_DIVIDER_GUTTER}more nodes · open graph`, count: undefined, why: "a count-less mention" },
    { line: `  ${PANEL_DIVIDER_GUTTER}+2 more node · open graph`, count: undefined, why: "a different word shape" },
    { line: `  ${PANEL_DIVIDER_GUTTER}+2 more nodesish`, count: undefined, why: "a glued suffix" },
    { line: `  ${PANEL_DIVIDER_GUTTER}${PANEL_DIVIDER_GUTTER}+2 more nodes`, count: undefined, why: "two gutters" },
    { line: "TRACE  +2 more nodes · open graph", count: undefined, why: "a transcript mention" },
    { line: `  ${PANEL_DIVIDER_GUTTER}+2 more runs · open graph`, count: undefined, why: "the run-count row" },
  ]
  for (const entry of overflowCases) {
    const read = overflowNodeCount(entry.line)
    if (read !== entry.count) throw new Error(`self-test: ${entry.why} must read as ${entry.count ?? "no overflow"}, got ${read ?? "none"} from ${JSON.stringify(entry.line)}`)
  }
  if (overflowNotice(overflowCases.map((entry) => entry.line))?.line !== overflowCases[0].line) {
    throw new Error("self-test: the first line that accounts for a node is the overflow row")
  }

  // A frame painted at another width cannot carry the rule in the requested geometry's third region
  // cell, and that is exactly the live stale read: the heading reader alone accepts it (trimming hides
  // the offset), so the geometry check is what rejects it.
  const framePaintedAt = (width, row) => `${"".padEnd(width - PANEL_WIDTH)}${row}`
  const atWide = panelRegion(framePaintedAt(160, `${PANEL_DIVIDER_GUTTER}${PANEL_HEADING}`), { cols: 160 })
  if (!hasPanelGutterAt(atWide)) throw new Error("self-test: the divided column's rule sits in its own geometry's third cell")
  const wideReadAsBoundary = panelRegion(framePaintedAt(160, `${PANEL_DIVIDER_GUTTER}${PANEL_HEADING}`), { cols: MIN_COLUMNS })
  if (hasPanelGutterAt(wideReadAsBoundary)) throw new Error("self-test: a frame painted at 160 must not carry the 120 column's rule")
  if (!hasPanelHeading(wideReadAsBoundary)) throw new Error("self-test: the heading reader alone accepts the stale wide frame, so the geometry check is the rejection")
  const atBoundary = panelRegion(framePaintedAt(MIN_COLUMNS, `${PANEL_DIVIDER_GUTTER}${PANEL_HEADING}`), { cols: MIN_COLUMNS })
  if (!hasPanelGutterAt(atBoundary) || !hasPanelHeading(atBoundary)) throw new Error("self-test: a frame painted at the requested geometry passes the geometry check and the heading reader")

  return { ok: true, driver: DRIVER, selfTest: true, checks: 33 + headingCases.length + 2 + overflowCases.length + 5 }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(selfTest()))
}
