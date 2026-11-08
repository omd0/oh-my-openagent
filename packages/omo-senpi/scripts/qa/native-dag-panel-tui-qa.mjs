#!/usr/bin/env node
// allow: SIZE_OK - one auditable live-terminal proof: isolated sandbox, fixture feed publish, real
// Senpi PTY, xterm.js renderer, graph/overlay/resize/switch/teardown checks and isolation evidence in
// one flow. Splitting it would scatter one scenario across files that must agree on timing.
//
// What this proves, and what it does not:
//   fixture mode (default): the REAL built plugin's side panel runs in a REAL fullscreen Senpi TUI,
//     and the graph it draws comes from a fixture published through the product's own
//     `claimDagPanelFeed` port. It proves the panel's live feed binding (publish after the panel
//     subscribed, mutate, notify, repaint), the boxed graph with its dependency rows, the
//     `/side-panel-dag` overlay (edges, selection, details, activity, close), the resize floor, the
//     session-scoped teardown/switch and the real-home isolation. It does NOT prove the DAG
//     scheduler: no run is scheduled, so the node states are the fixture's.
// A real `workflow` run is deliberately NOT started here: on this Senpi build the DAG tool is only
// reachable inside an eval cell (`tool.workflow({...})`), not as a directly callable tool, so a
// scripted tool call answers "Tool workflow not found" and no run exists to render. That is a host
// tool-surface limit, recorded in the evidence, not a panel defect; the scheduler-to-panel binding is
// therefore NOT claimed by this driver.
//
// Every screen assertion reads rendered text from xterm.js (never the raw ANSI stream, never tmux),
// every wait is a rendered-text predicate or a receipt predicate with an explicit deadline, and the
// real Senpi agent dir and ~/.omo are snapshotted before and after to prove isolation. A geometry read
// (the resize section and the diff viewer's own resize) additionally waits for a frame the HOST
// painted at the requested geometry: xterm applies a resize to its own buffer immediately, so the
// snapshot's dimensions alone would accept the previous frame - see `frameBelongsToGeometry`. A run
// that fails records the failure and captures the live viewport (text + png) BEFORE any teardown, so
// its evidence describes the frame the failed predicate read instead of a post-quit screen.
import { EventEmitter } from "node:events"
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, watch, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve, sep } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { createSandbox, seedSandbox } from "./drive.mjs"
import { changedSnapshotPaths, classifyObservedChanges, credentialDigest, protectedSnapshotsUntouched, snapshotDirectory, snapshotProtectedState } from "./isolation-state.mjs"
import {
  ACTIVITY,
  CHANGES_HEADING,
  CHANGES_HUGE_MARK,
  CHANGES_NAME_CUTOFF,
  CHANGES_SHOW_LESS,
  CHANGES_SHOW_MORE,
  CHANGES_TOO_LARGE,
  DEPENDENCIES,
  DRIVER,
  LABELS,
  MIN_COLUMNS,
  NODE_IDS,
  PANEL_DIVIDER_GUTTER,
  PANEL_HEADING,
  NODE_LABELS,
  OVERLAY_CONNECTOR,
  OVERLAY_TITLE_PREFIX,
  PANEL_WIDTH,
  PARENT_ANSWER_PREFIX,
  PROJECT_DIR_NAME,
  hasPanelGutterAt,
  hasPanelHeading,
  hasRightAlignedSuffix,
  overflowNotice,
  panelHeadingLines,
  parentAnswer,
  RUN_HEADER_PREFIX,
  RUN_NAME,
  STATE_WORDS,
  TAILS,
  boxFor,
  changesHeadingLine,
  connectorCount,
  hasNameCutoff,
  hugeMarkLine,
  inspectBox,
  nodeRowTransition,
  panelRegion,
  runningNode,
  selfTest as scenarioSelfTest,
  showLessLine,
  showMoreLine,
  stageRuns,
  stageStates,
  tooLargeLine,
  transcriptAtLatest,
  visibleTails,
} from "./native-dag-panel-scenarios.mjs"
import { openRenderer, resolveChrome } from "./native-dag-panel-tui-renderer.mjs"
import {
  BIGDIFF_FILE,
  CJK_FILE,
  CJK_TOKEN,
  GONE_FILE,
  GREEN_RAMP,
  KNOWN_FILE,
  KNOWN_NEW_FILE,
  KNOWN_NEW_SUFFIX,
  KNOWN_SUFFIX,
  LAST_FILE,
  LONG_FILE,
  LONG_TOKEN,
  RED_RAMP,
  YELLOW_RAMP,
  addedEntryRow,
  appendOversizedFixture,
  cellIsPalette,
  chatCoords,
  ensureChangesFixture,
  findPanelRowCoords,
  panelCoords,
  sgrClickPress,
  sgrClickRelease,
  sgrWheel,
  tokenHasRamp,
  transcriptRegion,
} from "./native-dag-panel-changes-helpers.mjs"
import { isolatedChildEnv } from "./sandbox-child-env.mjs"
import { withTelemetryOptOut } from "./telemetry-opt-out-env.mjs"

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(here, "..", "..")
export const DEFAULT_PLUGIN_ROOT = join(packageRoot, "plugin")
const DEFAULT_SENPI_CLI = join(resolve(packageRoot, "..", ".."), "node_modules", "@code-yeongyu", "senpi", "dist", "cli.js")

export const SECTIONS = ["graph", "changes", "overlay", "resize", "switch", "teardown"]

const READY_TIMEOUT_MS = 120_000
const RENDER_TIMEOUT_MS = 45_000
const RECEIPT_TIMEOUT_MS = 30_000
const EXIT_TIMEOUT_MS = 20_000
const OVERLAY_NAV_LIMIT = 3

/** The column is drawn only above side_panel.min_columns, so the narrow geometry must fall below it. */
export const NARROW_COLUMNS = 104
const MIN_NARROW_COLUMNS = 60

const WARM_PROMPT = "status"
/** The parent lane's answer prefix; the full answer also carries its request ordinal. */
const WARM_ANSWER = PARENT_ANSWER_PREFIX
/**
 * The bytes the host's own jump-to-latest input sends. The transcript indicator advertises
 * `· End`, and the host binding behind it is `tui.altScreen.bottom` (default `end`), so this is the
 * real key a user presses - never a scroll approximation.
 */
const TRANSCRIPT_END_KEY = "\u001b[F"

const checks = []
const signals = []

function record(layer, name, ok, detail) {
  checks.push({ layer, name, ok, detail })
  if (!ok) console.error(`FAIL [${layer}] ${name}: ${detail}`)
  return ok
}

/**
 * The column's integrity at a geometry: the panel is mounted, its run header is not clipped, every node
 * box is closed by its own bottom border, and no transcript token has bled into the panel's columns.
 */
export function columnIntegrity(panelLines, { transcriptTokens = [], requireHeading = true } = {}) {
  const region = panelLines.join("\n")
  const problems = []
  if (requireHeading && !hasPanelHeading(panelLines)) problems.push("no panel heading")
  const header = panelLines.find((line) => line.includes(RUN_HEADER_PREFIX) && line.includes(RUN_NAME))
  if (header === undefined) problems.push("no run header")
  else if (!/\d+\/\d+/.test(header)) problems.push(`run header clipped: ${JSON.stringify(header)}`)
  // A short terminal spends its row budget on the first boxes and counts the rest; that explicit
  // overflow row is the designed outcome, a node that just vanishes is not. The row carries the
  // count the builder computed, so a box that is not drawn is only explained while that count still
  // covers it - and only the node row counts, never the run-count row above it.
  const overflow = overflowNotice(panelLines)
  const credited = overflow?.count ?? 0
  let drawn = 0
  let missing = 0
  for (const id of NODE_IDS) {
    const box = boxFor(panelLines, LABELS[id])
    if (box === undefined) {
      missing += 1
      if (missing > credited) problems.push(`${LABELS[id]} missing`)
      continue
    }
    drawn += 1
    if (!box.boxed) problems.push(`${LABELS[id]} is not a box`)
    else if (!(box.bottom ?? "").includes("╯")) problems.push(`${LABELS[id]} box bottom clipped: ${JSON.stringify(box.bottom)}`)
  }
  if (drawn === 0) problems.push("no node box at all")
  const bleed = transcriptTokens.filter((token) => token.length > 0 && region.includes(token))
  if (bleed.length > 0) problems.push(`transcript text inside the panel columns: ${bleed.join(",")}`)
  return { ok: problems.length === 0, reason: problems.join("; ") || `column integrity holds (drawn=${drawn}${missing > 0 ? `, overflow=${missing}/${credited}` : ""})`, header }
}

/**
 * Does a rendered frame belong to the geometry that was requested, as painted by the host?
 *
 * Three independent conditions, because each alone is satisfiable by a stale frame:
 * 1. the dimensions the snapshot reports, which is all a plain read used to check (insufficient:
 *    xterm applies a resize to its own buffer before the host has painted anything);
 * 2. a parsed PTY write newer than the revision anchored before the resize was requested, i.e. the
 *    host answered the SIGWINCH with bytes the renderer has finished parsing;
 * 3. the caller's own content predicate, which for the column includes the divided rule sitting in
 *    the requested geometry's region cell (`hasPanelGutterAt`), so a frame painted at another width
 *    cannot pass by being trimmed into the right shape.
 */
export function frameBelongsToGeometry(frame, { cols, rows }, revisionFloor) {
  if (!Number.isInteger(frame?.cols) || frame.cols !== cols) return false
  if (!Number.isInteger(frame?.rows) || frame.rows !== rows) return false
  return Number.isInteger(frame?.revision) && frame.revision > revisionFloor
}

/** A bounded look at "nothing happened": the only shape a negative control can take. Never used to synchronize. */
const observationWindow = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms))

async function signal(name, promise) {
  const started = Date.now()
  const value = await promise
  signals.push({ name, ms: Date.now() - started })
  return value
}

// ---- arguments ---------------------------------------------------------------------------------------

export function parseArgs(argv) {
  const options = {
    evidenceDir: undefined,
    pluginRoot: DEFAULT_PLUGIN_ROOT,
    senpiCli: DEFAULT_SENPI_CLI,
    bunBin: process.env.BUN_BIN,
    chromeBin: undefined,
    cols: 150,
    rows: 42,
    narrowCols: NARROW_COLUMNS,
    narrowRows: 32,
    pluginMode: "packaged",
    only: SECTIONS,
    keepSandbox: false,
    selfTest: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    const next = () => {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith("--")) throw new Error(`${flag} needs a value`)
      index += 1
      return value
    }
    if (flag === "--evidence-dir") options.evidenceDir = resolve(next())
    else if (flag === "--plugin-root") options.pluginRoot = resolve(next())
    else if (flag === "--senpi-cli") options.senpiCli = resolve(next())
    else if (flag === "--bun") options.bunBin = next()
    else if (flag === "--chrome-bin") options.chromeBin = next()
    else if (flag === "--cols") options.cols = positiveInt(flag, next())
    else if (flag === "--rows") options.rows = positiveInt(flag, next())
    else if (flag === "--narrow-cols") options.narrowCols = positiveInt(flag, next())
    else if (flag === "--narrow-rows") options.narrowRows = positiveInt(flag, next())
    else if (flag === "--plugin-mode") {
      const mode = next()
      if (mode !== "packaged" && mode !== "source") throw new Error(`--plugin-mode must be packaged or source, got ${mode}`)
      options.pluginMode = mode
    } else if (flag === "--only") {
      const requested = next().split(",").map((entry) => entry.trim()).filter(Boolean)
      const unknown = requested.filter((entry) => !SECTIONS.includes(entry))
      if (unknown.length > 0) throw new Error(`--only names unknown sections: ${unknown.join(", ")}`)
      options.only = SECTIONS.filter((entry) => requested.includes(entry))
    } else if (flag === "--keep-sandbox") options.keepSandbox = true
    else if (flag === "--self-test") options.selfTest = true
    else throw new Error(`unknown argument: ${flag}`)
  }
  if (options.cols <= MIN_COLUMNS) throw new Error(`--cols must exceed side_panel.min_columns (${MIN_COLUMNS}) so the column can be drawn`)
  if (options.narrowCols >= MIN_COLUMNS) throw new Error(`--narrow-cols must fall below side_panel.min_columns (${MIN_COLUMNS})`)
  if (options.narrowCols < MIN_NARROW_COLUMNS) throw new Error(`--narrow-cols must stay at or above ${MIN_NARROW_COLUMNS} to keep the editor usable`)
  if (options.rows < 20) throw new Error("--rows must be at least 20")
  if (!options.selfTest && options.evidenceDir === undefined) throw new Error("--evidence-dir is required")
  return options
}

function positiveInt(flag, value) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${flag} needs a positive integer, got ${value}`)
  return parsed
}

// ---- receipts ----------------------------------------------------------------------------------------

/** Subscribe-first receipt feed: the listener exists before the TUI can append, and every wait is bounded. */
export function createReceiptFeed(file) {
  const bus = new EventEmitter()
  let rows = []
  const readAll = () => {
    if (!existsSync(file)) return []
    return readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .flatMap((line) => {
        try {
          return [JSON.parse(line)]
        } catch {
          return []
        }
      })
  }
  rows = readAll()
  const flush = () => {
    const before = rows.length
    rows = readAll()
    if (rows.length !== before) bus.emit("rows")
  }
  const watcher = watch(file, flush)
  return {
    rows: () => rows,
    wait(predicate, { timeoutMs = RECEIPT_TIMEOUT_MS, description = "receipt" } = {}) {
      const first = predicate(rows)
      if (first !== undefined && first !== false) return Promise.resolve(first)
      return new Promise((resolvePromise, reject) => {
        // fs.watch coalesces rapid appends, so a pending wait also re-reads the file on a short
        // interval. The interval is not the synchronization: the deadline is, and every value comes
        // from the file the TUI writes.
        const poll = setInterval(() => {
          flush()
          check()
        }, 100)
        const timer = setTimeout(() => {
          stop()
          reject(new Error(`${description} timed out after ${timeoutMs}ms; receipts=${JSON.stringify(rows.slice(-4))}`))
        }, timeoutMs)
        function stop() {
          clearTimeout(timer)
          clearInterval(poll)
          bus.off("rows", check)
        }
        function check() {
          const value = predicate(rows)
          if (value === undefined || value === false) return
          stop()
          resolvePromise(value)
        }
        bus.on("rows", check)
        check()
      })
    },
    close() {
      watcher.close()
      bus.removeAllListeners()
    },
  }
}

export const findReceipt = (rows, type, extra = () => true) => rows.filter((row) => row.type === type).find(extra)

// ---- sandbox -----------------------------------------------------------------------------------------

function omoConfig() {
  return `${JSON.stringify(
    {
      $schema: "https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/assets/omo.schema.json",
      categories: { quick: { model: "omo-mock/mock-1" } },
      task: { default_execution_mode: "in-process" },
      side_panel: {
        enabled: true,
        width: PANEL_WIDTH,
        min_columns: MIN_COLUMNS,
        clickable: true,
        sections: { session: true, goal: false, context: true, usage: false, agents: true, tools: false, files: true, memory: false, dag: true },
      },
    },
    null,
    2,
  )}\n`
}

export function prepareSandbox({ pluginMode = "packaged" } = {}) {
  const base = createSandbox()
  // The project lives UNDER the sandbox HOME, so the panel's location row collapses to `~/dagpanel`
  // and the driver has a panel-only anchor that cannot appear in the transcript.
  const cwd = join(base.homeDir, PROJECT_DIR_NAME)
  const sandbox = { ...base, cwd, canonicalCwd: cwd, sessionsDir: join(base.agentDir, "sessions") }
  seedSandbox(sandbox)
  // Source mode loads the components as a QA extension, so the packaged copy must stay off the
  // package list; that is what keeps a stale bundle out of a source run.
  if (pluginMode === "source") {
    writeFileSync(join(sandbox.agentDir, "settings.json"), `${JSON.stringify({ defaultProjectTrust: "ask", packages: [] }, null, 2)}\n`)
  }
  mkdirSync(join(cwd, ".omo"), { recursive: true })
  writeFileSync(join(cwd, ".omo", "omo.jsonc"), omoConfig())
  mkdirSync(sandbox.sessionsDir, { recursive: true })
  mkdirSync(join(sandbox.root, "xdg-state"), { recursive: true })
  mkdirSync(join(sandbox.root, "tmp"), { recursive: true })
  return sandbox
}

/**
 * The Changes fixture is owned by `native-dag-panel-changes-helpers.mjs`: one plan, one materializer,
 * one self-test. A second, synthetic plan used to live here; it described a twelve-entry fixture with
 * an untracked `new.ts` row in the preview, which the real git reporting order can never produce, so it
 * is gone rather than left as a contradicting assumption.
 */

export function sandboxEnv(sandbox, { receiptPath }) {
  const env = {
    ...isolatedChildEnv(process.env, sandbox.agentDir),
    HOME: sandbox.homeDir,
    USERPROFILE: sandbox.homeDir,
    XDG_CONFIG_HOME: sandbox.xdgConfigHome,
    XDG_DATA_HOME: sandbox.xdgDataHome,
    XDG_CACHE_HOME: sandbox.xdgCacheHome,
    XDG_STATE_HOME: join(sandbox.root, "xdg-state"),
    TMPDIR: join(sandbox.root, "tmp"),
    TMP: join(sandbox.root, "tmp"),
    TEMP: join(sandbox.root, "tmp"),
    PI_OFFLINE: "1",
    OMO_SENPI_QA: "1",
    QA_RECEIPT_PATH: receiptPath,
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    LANG: process.env.LANG ?? "en_US.UTF-8",
  }
  // A caller-exported package root re-points the child at the caller's install instead of the
  // sandbox plugin root; scrub every *_PACKAGE_DIR lane the hygiene probe inspects.
  for (const name of Object.keys(env)) {
    if (name.endsWith("_PACKAGE_DIR")) delete env[name]
  }
  return env
}

/** The isolation proof: every agent-dir lane and HOME points into the sandbox, not at the real one. */
export function assertSandboxEnv(sandbox, env) {
  for (const lane of ["OMO_CODING_AGENT_DIR", "SENPI_CODING_AGENT_DIR", "PI_CODING_AGENT_DIR"]) {
    if (env[lane] !== sandbox.agentDir) throw new Error(`${lane} must point at the sandbox agent dir, got ${env[lane]}`)
    if (env[lane] === process.env[lane]) throw new Error(`${lane} inherited the caller's value`)
  }
  for (const [name, expected] of [
    ["HOME", sandbox.homeDir],
    ["XDG_CONFIG_HOME", sandbox.xdgConfigHome],
    ["XDG_DATA_HOME", sandbox.xdgDataHome],
    ["XDG_CACHE_HOME", sandbox.xdgCacheHome],
  ]) {
    if (env[name] !== expected) throw new Error(`${name} must point at ${expected}, got ${env[name]}`)
  }
}

/** Every environment name a plugin or engine resolves a writable root through. */
export const SANDBOX_STATE_ENV = [
  "HOME",
  "USERPROFILE",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "XDG_STATE_HOME",
  "TMPDIR",
  "TMP",
  "TEMP",
  "OMO_CODING_AGENT_DIR",
  "SENPI_CODING_AGENT_DIR",
  "PI_CODING_AGENT_DIR",
  "OMO_MEMORY_HOME",
]

/**
 * Proves the child cannot land on the real home: every state-bearing variable points inside the
 * sandbox, and the roots the shipped resolvers derive from them are computed and checked too. Any
 * remaining environment value that still names the real home is listed, never silently allowed.
 */
export function auditSandboxRoots(sandbox, env, realHome = homedir()) {
  const inside = (value) => typeof value === "string" && (value === sandbox.root || value.startsWith(`${sandbox.root}${sep}`))
  const lanes = Object.fromEntries(SANDBOX_STATE_ENV.map((name) => [name, env[name] ?? null]))
  const outside = SANDBOX_STATE_ENV.filter((name) => lanes[name] === null || !inside(lanes[name]))
  const agentDir = env.OMO_CODING_AGENT_DIR
  const resolvedRoots = {
    agentDir,
    nativeStateDir: typeof agentDir === "string" ? join(agentDir, "omo-senpi", "omo-native") : null,
    gatewayDir: typeof agentDir === "string" ? join(agentDir, "gateway") : null,
    memoryHome: env.OMO_MEMORY_HOME ?? null,
    homeMemoryRoot: typeof env.HOME === "string" ? join(env.HOME, ".omo", "memory") : null,
    sessionsDir: sandbox.sessionsDir ?? null,
  }
  const resolvedOutside = Object.entries(resolvedRoots)
    .filter(([, value]) => typeof value === "string" && !inside(value))
    .map(([name]) => name)
  const homeReferences = Object.entries(env)
    .filter(([, value]) => typeof value === "string" && realHome.length > 0 && value.includes(realHome))
    .map(([name, value]) => ({ name, value: value.split(realHome).join("<real-home>") }))
  return { inside: undefined, lanes, outside, resolvedRoots, resolvedOutside, homeReferences, ok: outside.length === 0 && resolvedOutside.length === 0 }
}

export function tuiCommand(options, sandbox, bunBin) {
  return [
    bunBin,
    options.senpiCli,
    "--tui-mode",
    "fullscreen",
    "--provider",
    "omo-mock",
    "--model",
    "mock-1",
    "--omo-side-panel",
    ...(options.pluginMode === "source" ? ["-e", join(here, "native-dag-panel-source-plugin.mjs")] : []),
    "-e",
    join(here, "native-dag-panel-fixture.mjs"),
    "-e",
    join(here, "native-dag-panel-mock-provider.mjs"),
    "--session-dir",
    sandbox.sessionsDir,
  ]
}

// ---- isolation ---------------------------------------------------------------------------------------

const REAL_ROOTS = () => [join(homedir(), ".senpi", "agent"), join(homedir(), ".omo")]

/**
 * Bounded, complete observation of what a run must not touch: the protected state files, the
 * credential digest, and (as supporting evidence) one bounded directory walk whose truncation is
 * reported rather than hidden.
 */
export function snapshotRealHomes() {
  return REAL_ROOTS().map((root) => {
    const present = existsSync(root)
    let credentials = "absent-root"
    try {
      if (present) credentials = credentialDigest(root)
    } catch (error) {
      credentials = `unreadable:${error instanceof Error ? error.message : String(error)}`
    }
    return { root, present, protected: snapshotProtectedState(root), credentials, directory: snapshotDirectory(root) }
  })
}

/**
 * The omo-native telemetry tree under the agent dir is written by EVERY live omo process on this
 * machine (session-summary heartbeats, owner files), so its churn cannot be attributed to, or held
 * against, one QA run. Those paths are reported with their own attribution and judged separately;
 * everything else non-volatile still fails the verdict.
 */
/**
 * Who wrote a changed real-home path. There is no exclusion list: a path counts as foreign only when
 * the file itself names a writer process that is not in this driver's own process tree. Everything
 * else, including a file with no owner record, is driver-attributed and fails the run.
 */
function readWriterPid(root, path) {
  const name = path.split("/").at(-1) ?? ""
  const ownerFile = /^owners\/(\d+)\.json$/.exec(path)
  if (ownerFile !== null) return Number(ownerFile[1])
  if (!name.endsWith(".json")) return undefined
  try {
    const parsed = JSON.parse(readFileSync(join(root, path), "utf8"))
    const pid = parsed?.owner?.pid ?? parsed?.pid
    return typeof pid === "number" && Number.isInteger(pid) && pid > 0 ? pid : undefined
  } catch {
    return undefined
  }
}

/** This driver's own process tree, read from the kernel while the child is alive. */
export function ownProcessTree(roots = [process.pid]) {
  const seen = new Set(roots.filter((pid) => Number.isInteger(pid) && pid > 0))
  const queue = [...seen]
  while (queue.length > 0) {
    const pid = queue.shift()
    let children = []
    try {
      for (const task of readdirSync(`/proc/${pid}/task`)) {
        const text = readFileSync(`/proc/${pid}/task/${task}/children`, "utf8").trim()
        if (text.length > 0) children = children.concat(text.split(/\s+/).map(Number))
      }
    } catch {
      children = []
    }
    for (const child of children) {
      if (!seen.has(child)) {
        seen.add(child)
        queue.push(child)
      }
    }
  }
  return [...seen]
}

export function isolationSummary(before, after, { ownPids = [process.pid] } = {}) {
  const own = new Set(ownPids)
  const roots = before.map((entry, index) => {
    const later = after[index]
    const changed = changedSnapshotPaths(entry.directory.snapshot, later.directory.snapshot)
    // Every changed path is classified: a volatile session/cache/log path is still reported in full,
    // and a non-volatile path is judged by its writer. Nothing is dropped from the record.
    const volatile = classifyObservedChanges(changed).volatile
    const judged = changed.filter((path) => !volatile.includes(path))
    const paths = judged.map((path) => {
      const writerPid = readWriterPid(entry.root, path)
      const attribute = writerPid === undefined ? "driver" : own.has(writerPid) ? "driver" : `foreign:${writerPid}`
      return { path, writerPid: writerPid ?? null, attribute }
    })
    return {
      root: entry.root,
      present: entry.present,
      protectedUntouched: protectedSnapshotsUntouched(entry.protected, later.protected),
      protectedErrors: [...entry.protected.errors, ...later.protected.errors].slice(0, 5),
      credentialsUnchanged: entry.credentials === later.credentials,
      directory: {
        complete: entry.directory.complete && later.directory.complete,
        files: later.directory.snapshot.size,
        changed: changed.length,
        volatile: volatile.slice(0, 20),
        volatileCount: volatile.length,
        paths,
        driverAttributed: paths.filter((entry) => entry.attribute === "driver").map((entry) => entry.path),
      },
    }
  })
  const driverAttributed = roots.flatMap((entry) => entry.directory.driverAttributed.map((path) => `${entry.root}:${path}`))
  const protectedChanged = roots.some((entry) => !entry.protectedUntouched || !entry.credentialsUnchanged)
  return { roots, ownPids: [...own], driverAttributed, protectedChanged, certified: driverAttributed.length === 0 && !protectedChanged }
}

// ---- process -----------------------------------------------------------------------------------------

function exitedWithin(proc, timeoutMs) {
  if (proc.exitCode !== null || proc.signalCode !== null) return Promise.resolve(true)
  return new Promise((resolvePromise) => {
    const timer = setTimeout(() => resolvePromise(false), timeoutMs)
    proc.exited.then(() => {
      clearTimeout(timer)
      resolvePromise(true)
    })
  })
}

/** `/quit` first, then SIGTERM, then SIGKILL. The receipt names which path was needed. */
export async function quitTui(proc) {
  if (proc === undefined) return "no tui"
  if (proc.exitCode !== null || proc.signalCode !== null) return `pid ${proc.pid} already exited (code=${proc.exitCode} signal=${proc.signalCode})`
  const receipt = await (async () => {
    try {
      proc.terminal.write("/quit\r")
    } catch {
      return "pty already closed"
    }
    if (await exitedWithin(proc, EXIT_TIMEOUT_MS)) return `pid ${proc.pid} exited on /quit`
    proc.kill("SIGTERM")
    if (await exitedWithin(proc, EXIT_TIMEOUT_MS)) return `pid ${proc.pid} exited after SIGTERM`
    proc.kill("SIGKILL")
    await exitedWithin(proc, 5_000)
    return `pid ${proc.pid} required SIGKILL`
  })()
  try {
    proc.terminal.close()
  } catch {
    // already closed
  }
  return receipt
}

function launchTui(command, sandbox, env, options, onData) {
  const decoder = new TextDecoder("utf-8")
  return Bun.spawn(command, {
    cwd: sandbox.cwd,
    env: withTelemetryOptOut(env),
    terminal: {
      cols: options.cols,
      rows: options.rows,
      data(_terminal, chunk) {
        onData(decoder.decode(chunk, { stream: true }))
      },
    },
  })
}

export function createCleanup() {
  const entries = []
  return {
    add(name, run) {
      entries.push({ name, run })
    },
    async run() {
      const results = []
      for (const entry of entries.reverse()) {
        try {
          results.push(`${entry.name}: ${await entry.run()}`)
        } catch (error) {
          results.push(`${entry.name}: FAILED (${error instanceof Error ? error.message : String(error)})`)
        }
      }
      return results
    },
  }
}

/**
 * The frame a failing run must leave behind: the live renderer's viewport and screenshot, read while
 * the PTY and the browser are still up. A snapshot taken after `/quit` is the host's main screen, not
 * the frame the failed assertion read, so it would describe a screen the run never asserted. A capture
 * that throws is NOT swallowed: the caller records it as a harness failure, and the run's own failure
 * is already recorded before this is called.
 */
export async function captureLiveViewport(renderer, { writeText, writePng, label = "terminal-failure-viewport" } = {}) {
  const live = await renderer.snapshot()
  writeText(`${label}.txt`, `${live.viewport}\n`)
  writePng(`${label}.png`, await renderer.screenshot())
  return { label, viewport: live.viewport, viewportY: live.viewportY, cols: live.cols, rows: live.rows, text: `${label}.txt`, png: `${label}.png` }
}

export function resolveBun(explicit) {
  if (typeof explicit === "string" && explicit.length > 0 && existsSync(explicit)) return explicit
  // Running this driver under bun means the driver's own executable IS the bun binary; that is the
  // reliable default on a machine where bun is not on PATH but the driver was launched by path.
  if (typeof Bun !== "undefined" && typeof process.execPath === "string" && existsSync(process.execPath)) return process.execPath
  if (typeof Bun !== "undefined" && typeof Bun.which === "function") {
    const found = Bun.which("bun")
    if (found !== null) return found
  }
  return undefined
}

/**
 * The harness's own contract with the product's rendering: the fixture snapshot is pushed through
 * the REAL column and overlay builders, and the readers must accept exactly what they draw. A change
 * to the rendering that the readers do not follow fails here, before any live run is judged.
 */
export async function renderContract() {
  const dagSection = await import("../../src/components/side-panel/sections/dag.ts")
  const overlayRows = await import("../../src/components/side-panel/dag-overlay-rows.ts")
  const overlayDag = await import("../../src/components/side-panel/dag-overlay.ts")
  const dagGraph = await import("../../src/components/side-panel/dag-graph.ts")
  const now = Date.UTC(2026, 10, 8, 9, 1, 0)

  for (const stage of ["started", "progressed"]) {
    const states = stageStates(stage)
    const markers = ACTIVITY[stage] ?? {}
    const rows = dagSection.buildDagRows(
      { runs: stageRuns(stage), activity: (_runId, nodeId) => markers[nodeId], now, rowCap: 24 },
      PANEL_WIDTH,
    )
    const panelLines = rows.map((row) => row.text)
    for (const id of NODE_IDS) {
      const result = inspectBox(panelLines, LABELS[id], { stateWord: STATE_WORDS[states[id]], dependencies: DEPENDENCIES[id] })
      if (!result.ok) throw new Error(`${stage}: the column check rejects the real builder output for ${id}: ${result.reason}`)
    }
    const integrity = columnIntegrity(panelLines, { transcriptTokens: [TAILS.fetch], requireHeading: false })
    if (!integrity.ok) throw new Error(`${stage}: the column integrity reader rejects the real builder output: ${integrity.reason}`)
    const fetchBox = boxFor(panelLines, LABELS.fetch)
    const clippedIndex = (fetchBox?.labelIndex ?? 0) + 3
    const clipped = panelLines.filter((_line, index) => index !== clippedIndex)
    if (columnIntegrity(clipped, { requireHeading: false }).ok) throw new Error(`${stage}: a clipped box must fail the integrity reader`)
    if (columnIntegrity(panelLines, { transcriptTokens: [RUN_NAME], requireHeading: false }).ok) throw new Error(`${stage}: transcript bleed into the panel columns must fail`)
    const live = runningNode(stage)
    const marker = live === undefined ? undefined : (markers[live] ?? "").split(" ")[0]
    if (marker !== undefined && marker !== "" && !panelLines.join("\n").includes(marker)) {
      throw new Error(`${stage}: the column must print the running node's activity, read ${JSON.stringify(panelLines)}`)
    }
  }

  const run = stageRuns("progressed")[0]
  const content = overlayRows.buildOverlayContent(
    { run, result: dagGraph.layoutDagRun(run), selectedId: "verify", activity: (id) => ACTIVITY.progressed[id], now },
    100,
  )
  const overlayText = content.lines.map((line) => line.map((segment) => segment.text).join("")).join("\n")
  if (!overlayText.includes(RUN_NAME)) throw new Error("overlay: the body header must name the run")
  if (connectorCount(overlayText) < 2) throw new Error(`overlay: expected a connector marker per drawn edge, read ${connectorCount(overlayText)}`)
  if (visibleTails(overlayText).join(",") !== "verify") throw new Error(`overlay: the selected node's prompt tail must be wrapped into the detail block, read ${JSON.stringify(visibleTails(overlayText))}`)
  for (const token of ["id", "verify", "state", "after"]) {
    if (!overlayText.includes(token)) throw new Error(`overlay: detail block lacks ${token}`)
  }

  // The popup frame (title, borders, hint) only exists in the overlay component, so render it too.
  const fakeTui = { terminal: { rows: 40 }, requestRender() {} }
  const binding = {
    runs: () => stageRuns("progressed"),
    activity: (_runId, nodeId) => ACTIVITY.progressed[nodeId],
    isDisposed: () => false,
    onDispose: () => () => {},
  }
  const overlay = overlayDag.createDagOverlay(fakeTui, undefined, { binding, now: () => now, close: () => {} })
  const framed = overlay.render(100).join("\n")
  if (!framed.includes(OVERLAY_TITLE_PREFIX) || !framed.includes(RUN_NAME)) throw new Error("overlay: the rendered frame must carry its title")
  if (connectorCount(framed) < 2) throw new Error("overlay: the rendered frame must draw the edge connectors")
  if (!framed.includes(TAILS.verify)) throw new Error("overlay: the rendered frame must show the selected node's prompt")

  const changesSection = await import("../../src/components/side-panel/sections/files.ts")
  const changesStatus = {
    root: "/tmp/dagpanel",
    files: [
      { xy: " M", path: "short.ts", added: 12, removed: 3 },
      { xy: "??", path: "with-a-very-long-file-name-that-exceeds-the-column-width-entirely.ts", added: 1, removed: 0 },
      { xy: " M", path: "huge.ts", added: 120_000, removed: 4 },
      { xy: " D", path: "gone.ts", added: 0, removed: 9 },
      { xy: "UU", path: "conflict.ts", added: 2, removed: 2 },
    ],
  }
  const collapsed = changesSection.buildChangesRows(changesStatus, PANEL_WIDTH, { preview: 8, expanded: false, expandable: true }).map((row) => row.text)
  if (changesHeadingLine(collapsed) === undefined || !changesHeadingLine(collapsed).includes(CHANGES_HEADING)) throw new Error(`changes: the collapsed heading must carry ${CHANGES_HEADING}`)
  if (showMoreLine(collapsed) !== undefined) throw new Error("changes: five files with preview eight must not show Show more")
  const manyStatus = { root: "/tmp/dagpanel", files: Array.from({ length: 12 }, (_, index) => ({ xy: " M", path: `file-${index}.ts`, added: 1, removed: 0 })) }
  const manyCollapsed = changesSection.buildChangesRows(manyStatus, PANEL_WIDTH, { preview: 8, expanded: false, expandable: true }).map((row) => row.text)
  if (showMoreLine(manyCollapsed) === undefined || !showMoreLine(manyCollapsed).includes(CHANGES_SHOW_MORE)) throw new Error("changes: twelve files with preview eight must end with Show more")
  if (showLessLine(manyCollapsed) !== undefined) throw new Error("changes: a collapsed list must not carry Show less")
  const manyExpanded = changesSection.buildChangesRows(manyStatus, PANEL_WIDTH, { preview: 8, expanded: true, expandable: true }).map((row) => row.text)
  if (showLessLine(manyExpanded) === undefined || !showLessLine(manyExpanded).includes(CHANGES_SHOW_LESS)) throw new Error("changes: an expanded list must start with Show less")
  if (showMoreLine(manyExpanded) !== undefined) throw new Error("changes: an expanded list must not carry Show more")
  const shortLine = collapsed.find((line) => line.includes("short.ts"))
  if (shortLine === undefined || !hasRightAlignedSuffix(shortLine)) throw new Error(`changes: a file row must keep its counts flush right, read ${JSON.stringify(shortLine)}`)
  const longLine = collapsed.find((line) => line.includes("with-a-very-long"))
  if (longLine !== undefined && !hasNameCutoff(longLine)) throw new Error(`changes: a long name must be cut with ${CHANGES_NAME_CUTOFF}, read ${JSON.stringify(longLine)}`)
  if (hugeMarkLine(collapsed) === undefined || !hugeMarkLine(collapsed).includes(CHANGES_HUGE_MARK)) throw new Error("changes: the oversized file must carry the huge marker")
  const oversizedStatus = { root: "/tmp/dagpanel", files: Array.from({ length: 600 }, (_, index) => ({ xy: " M", path: `bulk-${index}.ts`, added: 1, removed: 0 })) }
  const oversized = changesSection.buildChangesRows(oversizedStatus, PANEL_WIDTH, { preview: 8, expanded: false, expandable: true }).map((row) => row.text)
  if (tooLargeLine(oversized) === undefined || !tooLargeLine(oversized).includes(CHANGES_TOO_LARGE)) throw new Error("changes: a capped list must warn instead of claiming every row")

  // The column's own margin is part of the frame, so the heading reader is pinned against the REAL
  // divided body: the fullscreen column paints `│` + a blank cell before every row, while the widget
  // fallback keeps the plain margin. A reader that only accepts the plain heading misses a mounted
  // column (a 45 s mount timeout on a live run); a reader that accepts anything around the words
  // would anchor a column from a transcript line. Both bodies render at the driver's geometry and are
  // read back through the same region slice the live assertions use, so reader, renderer and column
  // coordinates stay pinned to each other.
  const sessionSection = await import("../../src/components/side-panel/sections/session.ts")
  const bodyModule = await import("../../src/components/side-panel/body.ts")
  const driverCols = 150
  const sessionRows = sessionSection.buildSessionRows({ model: "mock-1", startedAt: now - 1_000, now, childSpend: 0 }, PANEL_WIDTH)
  const frameOf = (body) => body.render(PANEL_WIDTH).map((row) => `${"".padEnd(driverCols - PANEL_WIDTH)}${row}`).join("\n")
  const dividedLive = panelRegion(frameOf(bodyModule.createPanelBody({ rows: () => sessionRows }, () => undefined, () => false, { divided: () => true })), { cols: driverCols })
  if (!hasPanelHeading(dividedLive)) throw new Error(`the divided column's heading must anchor the column, read ${JSON.stringify(dividedLive[0])}`)
  if (panelHeadingLines(dividedLive).join(",") !== PANEL_HEADING) throw new Error(`the divided heading must read as exactly ${PANEL_HEADING}, read ${JSON.stringify(panelHeadingLines(dividedLive))}`)
  if (dividedLive[0].indexOf(bodyModule.PANEL_DIVIDER) !== 2) throw new Error(`the column rule must stay two region columns in (region starts at cols-width-2, column at cols-width), read ${JSON.stringify(dividedLive[0])}`)
  if (!hasPanelHeading(panelRegion(frameOf(bodyModule.createPanelBody({ rows: () => sessionRows }, () => undefined, () => false)), { cols: driverCols }))) throw new Error("the widget fallback's plain heading must anchor the column too")
  const transcriptHeaded = `TRACE ${PANEL_HEADING}`.padEnd(driverCols - PANEL_WIDTH) + "│ ".padEnd(PANEL_WIDTH)
  if (hasPanelHeading(panelRegion(transcriptHeaded, { cols: driverCols }))) throw new Error("a transcript mention must not anchor the column")

  return "real column and overlay builders render the fixture snapshot the way the readers expect"
}

// ---- main --------------------------------------------------------------------------------------------

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.selfTest) {
    await runSelfTest(options)
    return
  }
  if (typeof Bun === "undefined") {
    console.error("this driver needs the Bun runtime (Bun.spawn terminal): run it with bun")
    process.exit(2)
  }
  const cleanup = createCleanup()
  let interrupted
  for (const name of ["SIGINT", "SIGTERM"]) process.once(name, () => (interrupted = name))
  const evidence = options.evidenceDir
  mkdirSync(evidence, { recursive: true })

  const facts = {
    driver: DRIVER,
    proof: "panel-ui-against-injected-feed",
    scheduler: false,
    pluginRoot: options.pluginRoot,
    pluginMode: options.pluginMode,
    geometry: { cols: options.cols, rows: options.rows, narrowCols: options.narrowCols, narrowRows: options.narrowRows },
    panelWidth: PANEL_WIDTH,
    sections: options.only,
    warmTurns: [],
  }
  let renderer
  let tui
  let receipts
  let raw = ""
  let screen
  let failureViewport
  let sandbox
  let isolationBefore
  let ownPids = []
  let sessionId
  const write = (name, content) => {
    const path = join(evidence, name)
    writeFileSync(path, content)
    return path
  }
  // In engine mode the states, activity and transitions belong to the scheduler, so the column checks
  // assert structure (boxes, dependency rows) and leave state words to the real run.
  const stateWordFor = (id, stage) => STATE_WORDS[stageStates(stage)[id]]

  try {
    const bunBin = resolveBun(options.bunBin)
    facts.bun = bunBin ?? null
    record("probe", "bun-runtime", bunBin !== undefined, bunBin ?? "no bun binary given or found")
    record("probe", "senpi-cli", existsSync(options.senpiCli), options.senpiCli)
    if (options.pluginMode === "packaged") {
      const mainBundle = join(options.pluginRoot, "extensions", "omo.js")
      const panelBundle = join(options.pluginRoot, "extensions", "omo-side-panel.js")
      record("probe", "plugin-bundle", existsSync(mainBundle), `${mainBundle} (build with: bun run build:senpi-plugin)`)
      record("probe", "panel-bundle", existsSync(panelBundle), `${panelBundle} (build with: bun run build:senpi-plugin)`)
    } else {
      const panelComponent = join(packageRoot, "src", "components", "side-panel", "index.ts")
      const panelRuntime = join(packageRoot, "src", "components", "side-panel", "runtime.ts")
      const taskComponent = join(packageRoot, "src", "components", "task", "index.ts")
      record("probe", "source-panel-component", existsSync(panelComponent), panelComponent)
      record("probe", "source-panel-runtime", existsSync(panelRuntime), `${panelRuntime} (loaded by the component, not the bundle)`)
      record("probe", "source-task-component", existsSync(taskComponent), taskComponent)
    }
    const chrome = resolveChrome(options.chromeBin)
    facts.chrome = chrome ?? null
    record("probe", "chrome", chrome !== undefined, chrome ?? "no Chrome/Chromium found; pass --chrome-bin or set CHROME_BIN")
    try {
      scenarioSelfTest()
      record("probe", "scenario-contract", true, "fixture graphs and screen readers agree")
    } catch (error) {
      record("probe", "scenario-contract", false, error instanceof Error ? error.message : String(error))
    }
    try {
      record("probe", "render-contract", true, await renderContract())
    } catch (error) {
      record("probe", "render-contract", false, error instanceof Error ? error.message : String(error))
    }
    if (checks.some((check) => !check.ok)) return finish()

    isolationBefore = snapshotRealHomes()
    facts.realHomesBefore = isolationBefore.map((entry) => ({ root: entry.root, present: entry.present, credentials: entry.credentials.slice(0, 12), files: entry.directory.snapshot.size }))

    sandbox = prepareSandbox({ pluginMode: options.pluginMode })
    cleanup.add("sandbox", () => {
      if (options.keepSandbox) return `kept at ${sandbox.root}`
      rmSync(sandbox.root, { recursive: true, force: true })
      return `removed ${sandbox.root}`
    })
    facts.sandbox = { root: sandbox.root, cwd: sandbox.cwd, agentDir: sandbox.agentDir, home: sandbox.homeDir, sessions: sandbox.sessionsDir }
    const receiptPath = join(sandbox.root, "qa-receipts.jsonl")
    writeFileSync(receiptPath, "")
    const env = sandboxEnv(sandbox, { receiptPath })
    const pluginLog = join(sandbox.root, "qa-plugin.log")
    writeFileSync(pluginLog, "")
    env.QA_PLUGIN_LOG = pluginLog
    facts.pluginLog = pluginLog
    facts.isolatedAgentDir = sandbox.agentDir
    try {
      assertSandboxEnv(sandbox, env)
      record("isolation", "sandbox-env", true, `agentDir=${sandbox.agentDir} home=${sandbox.homeDir} xdg=${sandbox.xdgConfigHome}`)
    } catch (error) {
      record("isolation", "sandbox-env", false, error instanceof Error ? error.message : String(error))
      return finish()
    }
    const envAudit = auditSandboxRoots(sandbox, env)
    facts.envAudit = envAudit
    record(
      "isolation",
      "sandbox-roots",
      envAudit.ok,
      envAudit.ok
        ? `every state root inside ${sandbox.root}; resolved=${JSON.stringify(Object.values(envAudit.resolvedRoots).filter((value) => typeof value === "string"))}`
        : `outside=${JSON.stringify(envAudit.outside)} resolvedOutside=${JSON.stringify(envAudit.resolvedOutside)} homeReferences=${JSON.stringify(envAudit.homeReferences)}`,
    )
    if (!envAudit.ok) return finish()

    if (options.only.includes("changes")) {
      try {
        const summary = ensureChangesFixture(sandbox.cwd)
        facts.changesFixture = { total: summary.total, entries: summary.entries, known: summary.known, knownNew: summary.knownNew, last: summary.last, untracked: summary.untracked.length }
        record("probe", "changes-fixture", true, `temp git repo at ${sandbox.cwd} with ${summary.total} changed entries`)
      } catch (error) {
        record("probe", "changes-fixture", false, error instanceof Error ? error.message : String(error))
        return finish()
      }
    }

    renderer = await openRenderer({ executablePath: chrome, cols: options.cols, rows: options.rows })
    cleanup.add("browser", () => renderer.close())
    receipts = createReceiptFeed(receiptPath)
    cleanup.add("receipts", () => {
      receipts.close()
      return "watch closed"
    })
    const command = tuiCommand(options, sandbox, bunBin)
    facts.command = command.map((part) => (part.startsWith(sandbox.root) ? part.replace(sandbox.root, "<sandbox>") : part)).join(" ")
    tui = launchTui(command, sandbox, env, options, (text) => {
      raw += text
      void renderer.write(text)
    })
    cleanup.add("tui", () => quitTui(tui))
    facts.pid = tui.pid
    record("probe", "tui-spawned", typeof tui.pid === "number", `pid=${tui.pid}`)

    screen = await signal("tui-ready", renderer.waitForScreen((current) => (current.viewport.includes("mock-1") ? current : undefined), { timeoutMs: READY_TIMEOUT_MS, description: "TUI ready (model footer drawn)" }))
    record("ui", "tui-ready", true, `pid=${tui.pid} rows=${screen.rows} cols=${screen.cols}`)

    const session = await signal("session-start", receipts.wait((rows) => findReceipt(rows, "qa.session"), { description: "qa.session receipt" }))
    sessionId = session.sessionId
    facts.sessionId = sessionId
    record("ui", "session-identified", typeof sessionId === "string" && sessionId.length > 0, `sessionId=${sessionId}`)

    screen = await signal(
      "panel-mounted",
      renderer.waitForScreen(
        (current) => (hasPanelHeading(panelRegion(current.viewport, { cols: current.cols, width: PANEL_WIDTH })) ? current : undefined),
        { timeoutMs: RENDER_TIMEOUT_MS, description: `side panel column (its own ${PANEL_HEADING} heading inside the panel columns)` },
      ),
    )
    record("ui", "panel-mounted", hasPanelHeading(panelRegion(screen.viewport, { cols: options.cols, width: PANEL_WIDTH })), `viewportY=${screen.viewportY} heading=${JSON.stringify(panelHeadingLines(panelRegion(screen.viewport, { cols: options.cols, width: PANEL_WIDTH })))}`)
    // The regular-mode notice marker is the product's own receipt that the no-layout-seam fallback
    // was taken; this driver proves the fullscreen column, so the marker must be absent.
    const fallbackMarker = join(sandbox.agentDir, "omo-senpi", "omo-native", "side-panel-regular-mode-notice")
    record("ui", "panel-surface-fullscreen", !existsSync(fallbackMarker), existsSync(fallbackMarker) ? `regular-mode fallback marker exists at ${fallbackMarker}` : "no regular-mode fallback marker")

    const viewport = async () => (await renderer.snapshot()).viewport
    const panelTextOf = (screenText) => panelRegion(screenText, { cols: options.cols, width: PANEL_WIDTH }).join("\n")
    const panelLines = async () => panelRegion(await viewport(), { cols: options.cols, width: PANEL_WIDTH })
    // The footer also prints the project path, so "the column is mounted" keys on the panel's own
    // section heading inside the panel's columns, never on the path alone.
    const columnPresent = (screenText) => panelRegion(screenText, { cols: options.cols, width: PANEL_WIDTH })
    const consumeScreen = (description, predicate, timeoutMs = RENDER_TIMEOUT_MS) => signal(description, renderer.waitForScreen(predicate, { timeoutMs, description }))
    const type = (text) => tui.terminal.write(text)
    /**
     * A geometry read is only trustworthy once the HOST has painted that geometry. xterm applies a
     * resize to its own buffer immediately, so `snapshot().cols` matching says nothing about what is
     * on screen: the previous frame is still there, right-aligned at its own width, until the host
     * answers the SIGWINCH.
     *
     * Order is part of the contract. xterm adopts the geometry FIRST, so every byte that arrives from
     * then on is parsed at the requested width; only then is the host told, and its repaint is the
     * frame we wait for. The returned revision is the floor a repaint must pass: a frame at or below
     * it is the previous geometry (or a buffer-only resize), never evidence of the new one.
     */
    const requestGeometry = async (cols, rows) => {
      const before = await renderer.snapshot()
      const applied = await renderer.resize(cols, rows)
      tui.terminal.resize(cols, rows)
      return { revision: applied.revision, cols: applied.cols, rows: applied.rows, previous: { cols: before.cols, rows: before.rows } }
    }
    const awaitGeometryFrame = (geometry, anchor, accept, description) =>
      signal(
        description,
        renderer.waitForScreen((current) => (frameBelongsToGeometry(current, geometry, anchor.revision) && accept(current) ? current : undefined), {
          timeoutMs: RENDER_TIMEOUT_MS,
          description: `${description}: a frame the host painted at ${geometry.cols}x${geometry.rows} after the resize (the screen before it was ${anchor.previous.cols}x${anchor.previous.rows}, parsed-write revision ${anchor.revision})`,
        }),
      )
    const providerRequests = () => receipts.rows().filter((row) => row.type === "qa.provider" && row.lane === "parent").length
    /**
     * A rendered-answer predicate can only read the transcript while it is pinned to its newest
     * message: the chat-wheel isolation proof scrolls history away on purpose and the host keeps that
     * position, so a later answer lands below the fold. The host's own End binding is the real input,
     * and its jump indicator is the state that says history is away from the bottom, so the wait is on
     * the rendered state - never a timer, and never "some viewport is good enough".
     */
    const returnTranscriptToLatest = async (label) => {
      const current = await renderer.snapshot()
      if (transcriptAtLatest(current.viewport)) return { jumped: false }
      type(TRANSCRIPT_END_KEY)
      await consumeScreen(`${label} transcript returned to latest`, (candidate) => (transcriptAtLatest(candidate.viewport) ? candidate : undefined))
      return { jumped: true }
    }
    /**
     * The panel learns its session id from a session event, so one real turn is what binds it to the
     * feed. That is also the user-shaped path: a panel with no turn yet has no graph to draw. The turn
     * is proven twice: the provider request receipt, and the answer stamped with THAT request's
     * ordinal, so an identical older answer on screen cannot satisfy the wait.
     */
    const warmTurn = async (label) => {
      const jump = await returnTranscriptToLatest(label)
      const before = providerRequests()
      type(`${WARM_PROMPT}\r`)
      const request = await signal(
        `${label}-provider-request`,
        receipts.wait(
          (rows) => {
            const parents = rows.filter((row) => row.type === "qa.provider" && row.lane === "parent")
            return parents.length > before ? parents.at(-1) : undefined
          },
          { description: `${label}: parent provider request` },
        ),
      )
      const answer = parentAnswer(request.parentRequests)
      await consumeScreen(`${label} answer rendered`, (current) => (current.viewport.includes(answer) ? current : undefined))
      return { requests: providerRequests() - before, answer, transcriptJumpedToLatest: jump.jumped }
    }
    const publishStage = async (stage, session = sessionId) => {
      type(`/qa-dag-feed ${stage}\r`)
      return signal(`publish-${stage}`, receipts.wait((rows) => findReceipt(rows, "qa.feed", (row) => row.stage === stage && row.sessionId === session), { description: `qa.feed ${stage}` }))
    }

    const warm = await warmTurn("warm")
    record("ui", "panel-bound-by-turn", warm.requests >= 1, `a real turn ran (${warm.requests} parent request, answer ${JSON.stringify(warm.answer)}) so the panel learned its session id`)
    facts.warmTurns.push(warm)

    // ---- graph --------------------------------------------------------------------------------------
    if (options.only.includes("graph")) {
      type("/qa-dag-feed-check pre-publish\r")
      const prePublish = await signal("feed-port-before-publish", receipts.wait((rows) => findReceipt(rows, "qa.feed-check", (row) => row.label === "pre-publish"), { description: "pre-publish feed check" }))
      record("ui", "feed-port-product-claim", prePublish.hasFeed === true && prePublish.sessionId === sessionId, `hasFeed=${prePublish.hasFeed} runs=${prePublish.runs.length} sessionId=${prePublish.sessionId}`)
      record("ui", "graph-empty-before-publish", !(await viewport()).includes(LABELS.fetch) && !(await viewport()).includes(RUN_NAME), "no fixture node or run name on screen before the fixture publishes")

      await publishStage("started")
      await consumeScreen("graph stage started", (current) => (NODE_LABELS.every((label) => current.viewport.includes(label)) && current.viewport.includes(RUN_NAME) ? current : undefined))
      const startedPanel = await panelLines()
      const header = startedPanel.find((line) => line.includes(RUN_HEADER_PREFIX) && line.includes(RUN_NAME))
      record("ui", "graph-run-header", header !== undefined, `header=${JSON.stringify(header)}`)
      const boxFailures = NODE_IDS.map((id) => inspectBox(startedPanel, LABELS[id], { stateWord: stateWordFor(id, "started"), dependencies: DEPENDENCIES[id] }))
      record("ui", "graph-node-boxes", boxFailures.every((entry) => entry.ok), boxFailures.map((entry, index) => (entry.ok ? `${NODE_IDS[index]}:ok` : `${NODE_IDS[index]}:${entry.reason}`)).join("; "))
      const startedMarker = (ACTIVITY.started.build ?? "").split(" ")[0]
      record("ui", "graph-live-activity", startedPanel.join("\n").includes(startedMarker), `column prints the running node's activity ${startedMarker}`)
      facts.graph = { started: { panel: startedPanel, header } }
      write("graph-stage-started.txt", `${startedPanel.join("\n")}\n`)
      writeFileSync(join(evidence, "graph-stage-started.png"), await renderer.screenshot())

      {
        type("/qa-dag-feed-check started\r")
        const published = await signal("feed-snapshot", receipts.wait((rows) => findReceipt(rows, "qa.feed-check", (row) => row.label === "started"), { description: "feed check receipt" }))
        const expected = stageRuns("started")[0].nodes.map((node) => `${node.id}:${node.state}`).join(",")
        const actual = (published.runs[0]?.nodes ?? []).map((node) => `${node.id}:${node.state}`).join(",")
        record("ui", "feed-snapshot-agrees", published.hasFeed === true && published.runs.length === 1 && actual === expected, `expected=${expected} actual=${actual} hasFeed=${published.hasFeed}`)

        const beforeStage = await viewport()
        const requestsBefore = providerRequests()
        await publishStage("progressed")
        await consumeScreen("graph stage progressed", (current) => (nodeRowTransition(panelTextOf(beforeStage), panelTextOf(current.viewport), LABELS.verify).changed ? current : undefined))
        const progressed = await viewport()
        const transition = nodeRowTransition(panelTextOf(beforeStage), panelTextOf(progressed), LABELS.verify)
        record("ui", "graph-no-turn-between-stages", providerRequests() === requestsBefore, `providerRequests=${requestsBefore}->${providerRequests()} (the repaint came from the feed subscription, not a prompt)`)
        record("ui", "graph-node-state-repaint", transition.changed, `VERIFY box top before=${JSON.stringify(transition.before)} after=${JSON.stringify(transition.after)}`)
        const progressedPanel = await panelLines()
        const progressedMarker = (ACTIVITY.progressed.verify ?? "").split(" ")[0]
        const startedGone = !progressedPanel.join("\n").includes(startedMarker)
        record("ui", "graph-live-activity-updated", progressedPanel.join("\n").includes(progressedMarker) && startedGone, `running activity now ${progressedMarker}; previous ${startedMarker} gone=${startedGone}`)
        facts.graph.progressed = { before: transition.before, after: transition.after, progressedMarker }
        write("graph-stage-progressed.txt", `${progressedPanel.join("\n")}\n`)
        writeFileSync(join(evidence, "graph-stage-progressed.png"), await renderer.screenshot())
      }
    }

    // ---- changes: temp git repo, mandatory collapsed/expanded/wheel/diff/oversized ----
    if (options.only.includes("changes")) {
      const WHEEL_STEP_MS = 10_000
      // Seed transcript scrollback first: the chat-wheel isolation proof needs a transcript taller
      // than the viewport, so a wheel over the chat has visible history to move. Real turn, mock
      // lane, and the newest message must be on screen before its answer can be read.
      {
        await returnTranscriptToLatest("changes-seed")
        const before = providerRequests()
        type("seed-transcript\r")
        await signal("changes-seed-request", receipts.wait((rows) => rows.filter((row) => row.type === "qa.provider" && row.lane === "parent").length > before, { description: "changes seed parent provider request" }))
        await consumeScreen("seed answer rendered", (current) => (current.viewport.includes("seed line 99") ? current : undefined))
        record("ui", "changes-transcript-seeded", true, "100-line seed answer renders, transcript is scrollable")
      }
      // Collapsed preview is mandatory: git reports the tracked section first, so the mandatory
      // fixtures are its leading rows - which is also why the untracked tail can never appear here.
      await consumeScreen("changes heading", (current) => {
        const region = panelRegion(current.viewport, { cols: current.cols, width: PANEL_WIDTH })
        return changesHeadingLine(region) !== undefined ? current : undefined
      })
      let changesPanel = await panelLines()
      const heading = changesHeadingLine(changesPanel)
      record("ui", "changes-heading", heading !== undefined && heading.includes(CHANGES_HEADING) && /\d/.test(heading), `heading carries count: ${JSON.stringify(heading)}`)
      const more = showMoreLine(changesPanel)
      record("ui", "changes-show-more", more !== undefined && more.includes(CHANGES_SHOW_MORE) && /\+/.test(more), `a long changed list with preview 8 must end with Show more +N more: ${JSON.stringify(more)}`)
      record("ui", "changes-show-less-absent-while-collapsed", showLessLine(changesPanel) === undefined, "a collapsed preview must not carry Show less")
      const knownRow = changesPanel.find((line) => line.includes(KNOWN_FILE))
      record("ui", "changes-known-delta", knownRow !== undefined && knownRow.includes(KNOWN_SUFFIX) && hasRightAlignedSuffix(knownRow), `known file keeps its exact delta flush right: ${JSON.stringify(knownRow)} (want ${KNOWN_SUFFIX})`)
      const longRow = changesPanel.find((line) => line.includes(LONG_FILE.slice(0, 20)))
      record("ui", "changes-name-cutoff", longRow !== undefined && hasNameCutoff(longRow) && !longRow.includes(LONG_FILE), `long name cut with .., full name absent: ${JSON.stringify(longRow)}`)
      const cjkRow = changesPanel.find((line) => line.includes("日本語") || line.includes(CJK_FILE.slice(0, 8)))
      record("ui", "changes-cjk-row", cjkRow !== undefined, `wide-char name renders a row: ${JSON.stringify(cjkRow)}`)
      const goneRow = changesPanel.find((line) => line.includes(GONE_FILE))
      record("ui", "changes-deleted-row", goneRow !== undefined, `deleted file renders a row: ${JSON.stringify(goneRow)}`)
      write("changes-collapsed.txt", `${changesPanel.join("\n")}\n`)
      writeFileSync(join(evidence, "changes-collapsed.png"), await renderer.screenshot())

      // Colors: xterm cell attributes must carry the published palette ramps — green added,
      // red removed, yellow modified name — per the pinned BufferCell API (isFgPalette/getFgColor).
      // A row without palette cells, or any index outside its ramp, fails. No numeric mode checks.
      const cells = await renderer.snapshotCells()
      const left = Math.max(0, options.cols - PANEL_WIDTH - 2)
      const cellsSnapshot = await renderer.snapshot()
      const cellsLines = cellsSnapshot.viewport.split("\n")
      const anyPalette = cells.rows.some((row) => row.some(cellIsPalette))
      record("ui", "changes-cells-preflight", anyPalette, "xterm cell API reports palette cells in this viewport (else the API seam is broken)")
      const cellLineFor = (token) => {
        const index = cellsLines.findIndex((line) => line.slice(left).includes(token))
        return index < 0 ? undefined : { index, text: cellsLines[index].slice(left) }
      }
      const knownCell = cellLineFor(KNOWN_FILE)
      record("ui", "changes-colors-modified", knownCell !== undefined && tokenHasRamp(cells.rows[knownCell.index] ?? [], left, knownCell.text, KNOWN_FILE, YELLOW_RAMP) && tokenHasRamp(cells.rows[knownCell.index] ?? [], left, knownCell.text, "+5", GREEN_RAMP) && tokenHasRamp(cells.rows[knownCell.index] ?? [], left, knownCell.text, "-0", RED_RAMP), `modified name yellow, +5 green, -0 red: ${JSON.stringify(knownCell?.text)}`)
      const goneCell = cellLineFor(GONE_FILE)
      record("ui", "changes-colors-deleted", goneCell !== undefined && tokenHasRamp(cells.rows[goneCell.index] ?? [], left, goneCell.text, GONE_FILE, RED_RAMP), `deleted name red: ${JSON.stringify(goneCell?.text)}`)
      // New-file hue. The row must be the git-ADDED entry (`A `), which is the only new-file status
      // git reports inside the tracked section - and therefore the only one the collapsed preview can
      // show at all, because every untracked row sorts after every tracked change. The precondition
      // and the palette read come from the SAME live cell frame, so a row that is not painted cannot
      // pass either assertion. No other green row is substituted for it.
      const newCell = cellLineFor(KNOWN_NEW_FILE)
      record(
        "ui",
        "changes-new-file-row",
        newCell !== undefined && addedEntryRow(newCell.text, KNOWN_NEW_FILE, KNOWN_NEW_SUFFIX) && hasRightAlignedSuffix(newCell.text),
        `the added new file paints inside the collapsed preview with its status and delta: ${JSON.stringify(newCell?.text)} (want A  ${KNOWN_NEW_FILE} ${KNOWN_NEW_SUFFIX})`,
      )
      record(
        "ui",
        "changes-colors-new",
        newCell !== undefined && tokenHasRamp(cells.rows[newCell.index] ?? [], left, newCell.text, KNOWN_NEW_FILE, GREEN_RAMP),
        `new name green over its own live cells: ${JSON.stringify(newCell?.text)}`,
      )

      // Expansion: click Show more -> full column hides session/context, last file offscreen.
      const moreCoords = findPanelRowCoords(await viewport(), options.cols, PANEL_WIDTH, CHANGES_SHOW_MORE)
      type(sgrClickPress(moreCoords.x, moreCoords.y))
      type(sgrClickRelease(moreCoords.x, moreCoords.y))
      await consumeScreen("changes expanded", (current) => {
        const region = panelRegion(current.viewport, { cols: current.cols, width: PANEL_WIDTH })
        return showLessLine(region) !== undefined ? current : undefined
      })
      changesPanel = await panelLines()
      record("ui", "changes-expanded-fullcolumn", showLessLine(changesPanel) !== undefined && showMoreLine(changesPanel) === undefined && !hasPanelHeading(changesPanel), `expanded list starts with Show less and hides SESSION/CONTEXT (read ${JSON.stringify(panelHeadingLines(changesPanel))})`)
      record("ui", "changes-lastfile-offscreen", !changesPanel.join("\n").includes(LAST_FILE), `${LAST_FILE} starts offscreen in the full column`)
      write("changes-expanded.txt", `${changesPanel.join("\n")}\n`)
      writeFileSync(join(evidence, "changes-expanded.png"), await renderer.screenshot())

      // Panel-hover wheel scrolls the panel to the last file: every notch must visibly move the
      // panel region (a truthy screen is not a signal). A notch with no repaint fails honestly.
      const panelAt = panelCoords(options.cols, PANEL_WIDTH, Math.floor(options.rows / 2))
      let panelText = panelRegion(await viewport(), { cols: options.cols, width: PANEL_WIDTH }).join("\n")
      let lastVisible = panelText.includes(LAST_FILE)
      for (let i = 0; i < 24 && !lastVisible; i += 1) {
        type(sgrWheel(false, panelAt.x, panelAt.y))
        const next = await consumeScreen(`changes wheel down ${i + 1}`, (current) => {
          const region = panelRegion(current.viewport, { cols: current.cols, width: PANEL_WIDTH }).join("\n")
          return region !== panelText ? current : undefined
        }, WHEEL_STEP_MS)
        panelText = panelRegion(next.viewport, { cols: next.cols, width: PANEL_WIDTH }).join("\n")
        lastVisible = panelText.includes(LAST_FILE)
      }
      record("ui", "changes-wheel-scrolls-panel", lastVisible, `wheel down over the panel reaches ${LAST_FILE}`)
      writeFileSync(join(evidence, "changes-wheel-panel.png"), await renderer.screenshot())
      // Chat wheel must MOVE the transcript (seeded 100-line scrollback proves the input landed)
      // while the panel stays exactly in place. A noop input passes neither side.
      const panelBeforeChat = (await panelLines()).join("\n")
      const transcriptBefore = transcriptRegion(await viewport(), options.cols, PANEL_WIDTH)
      const chatAt = chatCoords(options.cols, PANEL_WIDTH, Math.floor(options.rows / 2))
      for (let i = 0; i < 6; i += 1) type(sgrWheel(true, chatAt.x, chatAt.y))
      await consumeScreen("chat wheel moved transcript", (current) => {
        const transcript = transcriptRegion(current.viewport, current.cols, PANEL_WIDTH)
        const panelNow = panelRegion(current.viewport, { cols: current.cols, width: PANEL_WIDTH }).join("\n")
        return transcript !== transcriptBefore && panelNow === panelBeforeChat ? current : undefined
      })
      record("ui", "changes-chat-wheel-moves-transcript", true, "wheel over the chat scrolls transcript history")
      record("ui", "changes-chat-wheel-isolated", (await panelLines()).join("\n") === panelBeforeChat, "the same wheel leaves the panel exactly in place")
      writeFileSync(join(evidence, "changes-wheel-chat.png"), await renderer.screenshot())

      // Reset: scroll back UP until Show less is on screen (it scrolled off with the list),
      // then click it. Looking it up while offscreen would throw or click blindly.
      let resetText = panelRegion(await viewport(), { cols: options.cols, width: PANEL_WIDTH }).join("\n")
      let lessVisible = resetText.includes(CHANGES_SHOW_LESS)
      for (let i = 0; i < 24 && !lessVisible; i += 1) {
        type(sgrWheel(true, panelAt.x, panelAt.y))
        const next = await consumeScreen(`changes wheel up ${i + 1}`, (current) => {
          const region = panelRegion(current.viewport, { cols: current.cols, width: PANEL_WIDTH }).join("\n")
          return region !== resetText ? current : undefined
        }, WHEEL_STEP_MS)
        resetText = panelRegion(next.viewport, { cols: next.cols, width: PANEL_WIDTH }).join("\n")
        lessVisible = resetText.includes(CHANGES_SHOW_LESS)
      }
      record("ui", "changes-wheel-up-to-show-less", lessVisible, "wheel up over the panel brings Show less back on screen")

      // Reset: click Show less -> normal sections return.
      const lessCoords = findPanelRowCoords(await viewport(), options.cols, PANEL_WIDTH, CHANGES_SHOW_LESS)
      type(sgrClickPress(lessCoords.x, lessCoords.y))
      type(sgrClickRelease(lessCoords.x, lessCoords.y))
      await consumeScreen("changes reset", (current) => {
        const region = panelRegion(current.viewport, { cols: current.cols, width: PANEL_WIDTH })
        return showMoreLine(region) !== undefined && hasPanelHeading(region) ? current : undefined
      })
      changesPanel = await panelLines()
      record("ui", "changes-show-less-reset", showLessLine(changesPanel) === undefined && showMoreLine(changesPanel) !== undefined && hasPanelHeading(changesPanel), "Show less restores collapsed preview + SESSION")
      write("changes-reset.txt", `${changesPanel.join("\n")}\n`)

      // Diff overlay via click on the big-diff row: wheel/Home/End/close/resize, all mandatory.
      const bigCoords = findPanelRowCoords(await viewport(), options.cols, PANEL_WIDTH, BIGDIFF_FILE)
      type(sgrClickPress(bigCoords.x, bigCoords.y))
      type(sgrClickRelease(bigCoords.x, bigCoords.y))
      screen = await consumeScreen("diff overlay opened", (current) => (current.viewport.includes("(diff, read-only)") && current.viewport.includes(BIGDIFF_FILE) ? current : undefined))
      record("ui", "changes-diff-opened", screen.viewport.includes(BIGDIFF_FILE) && screen.viewport.includes("diff --git"), `click opens ${BIGDIFF_FILE} diff viewer at its first hunk`)
      write("changes-diff-opened.txt", `${screen.viewport}\n`)
      writeFileSync(join(evidence, "changes-diff-opened.png"), await renderer.screenshot())
      const diffBefore = screen.viewport
      const viewerAt = { x: Math.floor(options.cols / 2), y: Math.floor(options.rows / 2) }
      for (let i = 0; i < 4; i += 1) type(sgrWheel(false, viewerAt.x, viewerAt.y))
      screen = await consumeScreen("diff wheel scrolled", (current) => (current.viewport !== diffBefore ? current : undefined))
      record("ui", "changes-diff-wheel", screen.viewport !== diffBefore && screen.viewport.includes(BIGDIFF_FILE), "wheel over the viewer scrolls the diff, viewer stays open")
      type("\x1b[F")
      screen = await consumeScreen("diff End", (current) => (current.viewport.includes("line 149") ? current : undefined))
      record("ui", "changes-diff-end", screen.viewport.includes("line 149") && screen.viewport.includes("esc close"), "End reaches the last added line (line 149), frame intact")
      const endViewport = screen.viewport
      type("\x1b[H")
      screen = await consumeScreen("diff Home", (current) => (current.viewport.includes("diff --git") && current.viewport !== endViewport ? current : undefined))
      record("ui", "changes-diff-home", screen.viewport.includes("diff --git") && screen.viewport !== endViewport, "Home returns to the first hunk (diff --git), moved from the End screen")
      const diffWideAnchor = await requestGeometry(160, 44)
      screen = await awaitGeometryFrame(
        { name: "diff-resized", cols: 160, rows: 44 },
        diffWideAnchor,
        (current) => current.viewport.includes(BIGDIFF_FILE) && current.viewport.includes("esc close"),
        "diff resized",
      )
      record("ui", "changes-diff-resize", screen.viewport.includes("(diff, read-only)"), `viewer survives a resize with title + hint (frame ${screen.cols}x${screen.rows} at parsed-write revision ${screen.revision})`)
      writeFileSync(join(evidence, "changes-diff-resized.png"), await renderer.screenshot())
      const diffRestoreAnchor = await requestGeometry(options.cols, options.rows)
      await awaitGeometryFrame(
        { name: "diff-restored", cols: options.cols, rows: options.rows },
        diffRestoreAnchor,
        (current) => current.viewport.includes("(diff, read-only)"),
        "diff geometry restored",
      )
      type("\x1b")
      screen = await consumeScreen("diff closed", (current) => (!current.viewport.includes("(diff, read-only)") && hasPanelHeading(panelRegion(current.viewport, { cols: current.cols, width: PANEL_WIDTH })) ? current : undefined))
      record("ui", "changes-diff-close", !screen.viewport.includes("(diff, read-only)"), "Esc closes the viewer, column returns")
      facts.changes = { heading, expanded: true, wheel: lastVisible, diff: true, newFileRow: newCell?.text ?? null, knownRow: knownRow ?? null }

      // Oversized: 600 more root files, then a real turn to refresh; the warning is mandatory. The
      // turn is the panel's repaint trigger, so it must be a real request/answer pair even though the
      // warning itself is read from the panel columns.
      appendOversizedFixture(sandbox.cwd)
      const refresh = await warmTurn("changes-oversized-refresh")
      facts.warmTurns.push(refresh)
      await consumeScreen("changes too large", (current) => {
        const region = panelRegion(current.viewport, { cols: current.cols, width: PANEL_WIDTH })
        return tooLargeLine(region) !== undefined ? current : undefined
      })
      changesPanel = await panelLines()
      const warning = tooLargeLine(changesPanel)
      record("ui", "changes-oversized-warning", warning !== undefined && warning.includes(CHANGES_TOO_LARGE), `capped list must warn, never silently truncate: ${JSON.stringify(warning)}`)
      facts.changes.oversized = { refresh, warning: warning ?? null }
      write("changes-oversized.txt", `${changesPanel.join("\n")}\n`)
      writeFileSync(join(evidence, "changes-oversized.png"), await renderer.screenshot())
    }

    // ---- overlay ------------------------------------------------------------------------------------
    if (options.only.includes("overlay")) {
      type("/side-panel-dag\r")
      screen = await consumeScreen("dag overlay opened", (current) => (current.viewport.includes(OVERLAY_TITLE_PREFIX) && visibleTails(current.viewport).length > 0 ? current : undefined))
      const opened = visibleTails(screen.viewport)
      record("ui", "overlay-opened", opened.length > 0 && screen.viewport.includes(RUN_NAME), `title+DAG, tails=${opened.join(",")}`)
      const connectors = connectorCount(screen.viewport)
      record("ui", "overlay-edges", connectors >= 2, `connector markers=${connectors} (one per edge between neighbouring layers)`)
      const detailTails = visibleTails(screen.viewport)
      record("ui", "overlay-details", detailTails.includes("verify") && screen.viewport.includes("id") && screen.viewport.includes("verify"), `selected running node's id and prompt tail are in the detail block`)
      const overlayMarker = (ACTIVITY.progressed.verify ?? "").split(" ")[0]
      record("ui", "overlay-live-activity", screen.viewport.includes(overlayMarker), `detail state line carries ${overlayMarker}`)
      write("overlay-opened.txt", `${screen.viewport}\n`)
      writeFileSync(join(evidence, "overlay-opened.png"), await renderer.screenshot())

      let tails = opened
      let moved = false
      for (let step = 0; step < OVERLAY_NAV_LIMIT; step += 1) {
        const before = await viewport()
        type("\t")
        const after = await consumeScreen(`overlay selection ${step + 1}`, (current) => (current.viewport !== before ? current : undefined))
        const next = visibleTails(after.viewport)
        if (next.join(",") !== tails.join(",")) {
          tails = next
          moved = true
          break
        }
      }
      record("ui", "overlay-selection-move", moved, `Tab moved the selection; tails now=${tails.join(",")} (was ${opened.join(",")})`)

      // Negative control: while the overlay is open it owns the keyboard, so a submitted prompt must
      // NOT start a turn. This is a bounded observation window, not synchronization: the same prompt
      // is required to start a turn immediately after the overlay closes. The typed text avoids the
      // overlay's own keys (q closes it), which is why it is a bare word and not a slash command.
      const requestsWhileOpen = providerRequests()
      type(`${WARM_PROMPT}\r`)
      await observationWindow(3_000)
      const stillOpen = (await viewport()).includes(OVERLAY_TITLE_PREFIX)
      const requestsAfterTyping = providerRequests()
      record("ui", "overlay-owns-input-while-open", stillOpen && requestsAfterTyping === requestsWhileOpen, `overlay open=${stillOpen}; parent requests ${requestsWhileOpen}->${requestsAfterTyping} (a submitted prompt would have started a turn)`)

      type("\x1b")
      screen = await consumeScreen("dag overlay closed", (current) => (!current.viewport.includes(OVERLAY_TITLE_PREFIX) && visibleTails(current.viewport).length === 0 && current.viewport.includes(`~/${PROJECT_DIR_NAME}`) ? current : undefined))
      record("ui", "overlay-closed", !screen.viewport.includes(OVERLAY_TITLE_PREFIX), "Esc closed the overlay and the column came back")

      type("/side-panel-dag\r")
      screen = await consumeScreen("dag overlay reopened", (current) => (current.viewport.includes(OVERLAY_TITLE_PREFIX) ? current : undefined))
      type("q")
      await consumeScreen("dag overlay closed with q", (current) => (!current.viewport.includes(OVERLAY_TITLE_PREFIX) && current.viewport.includes(`~/${PROJECT_DIR_NAME}`) ? current : undefined))
      record("ui", "overlay-reopen-and-q-close", true, "reopened with /side-panel-dag and closed with q, so both close paths and the re-registered input hook work")

      // After the overlay disposed its input hook the editor must act on the same prompt it
      // swallowed above: a turn starts now. That is the observable proof the input was released.
      const requestsAfterClose = providerRequests()
      type(`${WARM_PROMPT}\r`)
      await signal("overlay-dispose-input", receipts.wait((rows) => rows.filter((row) => row.type === "qa.provider" && row.lane === "parent").length > requestsAfterClose, { description: "post-close parent provider request" }))
      record("ui", "overlay-dispose-releases-input", providerRequests() > requestsAfterClose, `the same prompt that produced no turn while the overlay was open started one after close (requests ${requestsAfterClose}->${providerRequests()})`)
      facts.overlay = { opened, visited: tails, moved, connectors }
    }

    // ---- geometry ------------------------------------------------------------------------------------
    // The column has to stay legible at the shipped width and at the min_columns boundary, survive a
    // short terminal without clipping, and disappear below the boundary. Every step re-reads the
    // panel's own columns, so a boundary that overpaints the transcript or clips a box fails here.
    if (options.only.includes("resize")) {
      const transcriptTokens = [WARM_ANSWER]
      const geometries = [
        { name: "wide-160", cols: 160, rows: 44, expectColumn: true },
        { name: "boundary-120", cols: MIN_COLUMNS, rows: 40, expectColumn: true },
        { name: "short-24", cols: 150, rows: 24, expectColumn: true },
        { name: "below-minimum-104", cols: options.narrowCols, rows: options.narrowRows, expectColumn: false },
        { name: "restored", cols: options.cols, rows: options.rows, expectColumn: true },
      ]
      facts.geometrySweep = []
      const regionOf = (frame) => panelRegion(frame.viewport, { cols: frame.cols, width: PANEL_WIDTH })
      // The column is the DIVIDED fullscreen column: its rule must sit in this geometry's region
      // cell, which is what rejects a frame the host painted at another width.
      const columnDrawn = (frame) => {
        const region = regionOf(frame)
        return hasPanelHeading(region) && hasPanelGutterAt(region) && frame.viewport.includes(LABELS.fetch)
      }
      const columnHidden = (frame) => {
        const region = regionOf(frame)
        return !frame.viewport.includes(PANEL_HEADING) && !hasPanelHeading(region) && !frame.viewport.includes(LABELS.fetch) && frame.viewport.includes("mock-1")
      }
      let restoredLines
      for (const geometry of geometries) {
        const anchor = await requestGeometry(geometry.cols, geometry.rows)
        let frame
        try {
          frame = await awaitGeometryFrame(
            geometry,
            anchor,
            geometry.expectColumn ? columnDrawn : columnHidden,
            `${geometry.expectColumn ? "column drawn" : "column hidden"} at ${geometry.name}`,
          )
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          record("ui", `geometry-${geometry.name}`, false, `requested ${geometry.cols}x${geometry.rows}; ${message}`)
          facts.geometrySweep.push({ ...geometry, observed: null, revision: anchor.revision, integrity: message })
          const last = renderer.latest()
          write(`geometry-${geometry.name}.txt`, `${panelRegion(last.viewport, { cols: last.cols ?? geometry.cols, width: PANEL_WIDTH }).join("\n")}\n`)
          try {
            writeFileSync(join(evidence, `geometry-${geometry.name}.png`), await renderer.screenshot())
          } catch (captureError) {
            record("runtime", `geometry-${geometry.name}-capture`, false, captureError instanceof Error ? captureError.message : String(captureError))
          }
          continue
        }
        if (geometry.expectColumn) {
          const lines = regionOf(frame)
          const integrity = columnIntegrity(lines, { transcriptTokens })
          record(
            "ui",
            `geometry-${geometry.name}`,
            integrity.ok,
            `requested=${geometry.cols}x${geometry.rows} frame=${frame.cols}x${frame.rows} parsedWrites=${frame.revision}; ${integrity.reason}; header=${JSON.stringify(integrity.header)}`,
          )
          facts.geometrySweep.push({ ...geometry, observed: { cols: frame.cols, rows: frame.rows }, revision: frame.revision, integrity: integrity.reason })
          write(`geometry-${geometry.name}.txt`, `${lines.join("\n")}\n`)
          writeFileSync(join(evidence, `geometry-${geometry.name}.png`), await renderer.screenshot())
          if (geometry.name === "restored") restoredLines = lines
        } else {
          const region = regionOf(frame)
          const dropped = !hasPanelHeading(region) && !frame.viewport.includes(PANEL_HEADING) && !frame.viewport.includes(LABELS.fetch)
          const editorAlive = frame.viewport.includes("mock-1")
          record(
            "ui",
            `geometry-${geometry.name}`,
            dropped && editorAlive,
            `requested=${geometry.cols}x${geometry.rows} frame=${frame.cols}x${frame.rows} parsedWrites=${frame.revision} (min_columns=${MIN_COLUMNS}); column dropped=${dropped} editor alive=${editorAlive}`,
          )
          facts.geometrySweep.push({ ...geometry, observed: { cols: frame.cols, rows: frame.rows }, revision: frame.revision, integrity: `dropped=${dropped} editorAlive=${editorAlive}` })
          writeFileSync(join(evidence, `geometry-${geometry.name}.png`), await renderer.screenshot())
        }
      }
      // The restore check reads the SWEEP'S OWN restored frame: a second snapshot after the sweep
      // would be a different frame, which is the read this repair exists to remove.
      if (restoredLines === undefined) {
        record("ui", "resize-restores-column", false, `the restored geometry (${options.cols}x${options.rows}) never produced a frame the host painted`)
      } else {
        const restoredFailures = NODE_IDS.map((id) => inspectBox(restoredLines, LABELS[id], { stateWord: stateWordFor(id, "progressed"), dependencies: DEPENDENCIES[id] }))
        record(
          "ui",
          "resize-restores-column",
          restoredFailures.every((entry) => entry.ok),
          `cols=${options.cols} rows=${options.rows}; read from the sweep's restored frame; ${restoredFailures.map((entry, index) => (entry.ok ? `${NODE_IDS[index]}:ok` : `${NODE_IDS[index]}:${entry.reason}`)).join("; ")}`,
        )
        write("resize-restored.txt", `${restoredLines.join("\n")}\n`)
        writeFileSync(join(evidence, "resize-restored.png"), await renderer.screenshot())
      }
    }

    // ---- switch ------------------------------------------------------------------------------------
    if (options.only.includes("switch")) {
      const previousSession = sessionId
      const sessionsBefore = receipts.rows().filter((row) => row.type === "qa.session").length
      type("/new\r")
      const shutdown = await signal("switch-shutdown", receipts.wait((rows) => findReceipt(rows, "qa.shutdown", (row) => row.reason === "new" && row.sessionId === previousSession), { description: "qa.shutdown reason=new" }))
      record("ui", "switch-shutdown-recorded", shutdown.sessionId === previousSession, `reason=${shutdown.reason} sessionId=${shutdown.sessionId}`)
      const nextSession = await signal(
        "switch-new-session",
        receipts.wait(
          (rows) => {
            const sessions = rows.filter((row) => row.type === "qa.session")
            if (sessions.length <= sessionsBefore) return undefined
            const latest = sessions.at(-1)
            return latest.sessionId !== previousSession ? latest : undefined
          },
          { description: "qa.session for the new session" },
        ),
      )
      sessionId = nextSession.sessionId
      facts.switchedSessionId = sessionId
      record("ui", "switch-new-session", typeof sessionId === "string" && sessionId.length > 0 && sessionId !== previousSession, `previous=${previousSession} next=${sessionId}`)
      await consumeScreen("new session column", (current) => (hasPanelHeading(columnPresent(current.viewport)) ? current : undefined))
      const switchWarm = await warmTurn("switch-warm")
      facts.warmTurns.push(switchWarm)
      type(`/qa-dag-feed-check old ${previousSession}\r`)
      const oldFeed = await signal("old-feed-state", receipts.wait((rows) => findReceipt(rows, "qa.feed-check", (row) => row.label === "old"), { description: "old feed check receipt" }))
      record("ui", "switch-old-feed-released", oldFeed.hasFeed === false, `previous sessionId=${previousSession} hasFeed=${oldFeed.hasFeed}`)
      const fresh = await viewport()
      record("ui", "switch-feed-isolated", !fresh.includes(LABELS.fetch) && !fresh.includes(RUN_NAME), `new sessionId=${sessionId} shows no graph from the previous session`)

      {
        await publishStage("started")
        screen = await consumeScreen("graph in the new session", (current) => (current.viewport.includes(LABELS.fetch) ? current : undefined))
        const newPanel = await panelLines()
        record("ui", "switch-remount", inspectBox(newPanel, LABELS.fetch, { stateWord: STATE_WORDS.completed, dependencies: DEPENDENCIES.fetch }).ok && newPanel.some((line) => line.includes(RUN_NAME)), `run ${RUN_NAME} renders in the new session`)
        writeFileSync(join(evidence, "switch-remounted.png"), await renderer.screenshot())
      }
    }

    // ---- teardown ----------------------------------------------------------------------------------
    // Captured while the child is alive: the isolation verdict needs this driver's whole tree, so a
    // real-home write naming one of our own pids can never be read as somebody else's.
    ownPids = ownProcessTree([process.pid, typeof tui.pid === "number" ? tui.pid : process.pid])
    facts.ownPids = ownPids
    screen = await renderer.snapshot()
    write("terminal-buffer.txt", `${screen.buffer}\n`)
    if (options.only.includes("teardown")) {
      type("/qa-dag-feed-check final\r")
      const finalFeed = await signal("final-feed-state", receipts.wait((rows) => findReceipt(rows, "qa.feed-check", (row) => row.label === "final"), { description: "final feed check receipt" }))
      record("ui", "teardown-feed-present-before-quit", finalFeed.hasFeed === true, `hasFeed=${finalFeed.hasFeed} runs=${finalFeed.runs.length}`)
      const shutdownWait = receipts.wait((rows) => findReceipt(rows, "qa.shutdown", (row) => row.reason === "quit"), { description: "qa.shutdown reason=quit", timeoutMs: EXIT_TIMEOUT_MS })
      const exitReceipt = await signal("quit", quitTui(tui))
      const shutdown = await signal("quit-shutdown", shutdownWait)
      record("ui", "teardown-exit", exitReceipt.includes("exited on /quit") && (tui.exitCode === 0 || tui.exitCode === null), `${exitReceipt} exitCode=${tui.exitCode}`)
      record("ui", "teardown-session-shutdown", shutdown.sessionId === sessionId, `reason=${shutdown.reason} sessionId=${shutdown.sessionId} fixtureClaimed=${shutdown.fixtureClaimed}`)
      facts.teardown = { exit: exitReceipt, exitCode: tui.exitCode, shutdown }
    }
  } catch (error) {
    record("runtime", "uncaught", false, error instanceof Error ? (error.stack ?? error.message) : String(error))
    // Captured HERE, while the PTY and the browser are alive: the finally below quits the TUI and
    // finish() closes the browser, so a snapshot taken after either is a different screen.
    failureViewport = await captureFailureViewport()
  } finally {
    if (tui !== undefined && tui.exitCode === null && tui.signalCode === null) {
      try {
        await quitTui(tui)
      } catch {
        // the receipt already carries whatever happened
      }
    }
  }
  return finish()

  async function captureFailureViewport() {
    if (renderer === undefined) return undefined
    const tuiAlive = tui !== undefined && tui.exitCode === null && tui.signalCode === null
    try {
      const captured = await captureLiveViewport(renderer, {
        writeText: write,
        writePng: (name, bytes) => writeFileSync(join(evidence, name), bytes),
      })
      facts.failureViewport = {
        capturedLive: true,
        at: tuiAlive ? "before-teardown" : "after-tui-exit",
        tuiAlive,
        viewportY: captured.viewportY,
        cols: captured.cols,
        rows: captured.rows,
        text: captured.text,
        png: captured.png,
        headings: panelHeadingLines(panelRegion(captured.viewport, { cols: captured.cols, width: PANEL_WIDTH })),
      }
      return { ...captured, tuiAlive }
    } catch (captureError) {
      facts.failureViewport = { capturedLive: false, at: tuiAlive ? "before-teardown" : "after-tui-exit", tuiAlive, error: captureError instanceof Error ? captureError.message : String(captureError) }
      record("runtime", "failure-viewport", false, `could not capture the live viewport at failure time: ${facts.failureViewport.error}`)
      return undefined
    }
  }

  async function finish() {
    if (raw.length > 0) write("terminal-ansi.txt", raw)
    // The primary text artifact is the frame the live session ended on. A failed run's captured frame
    // wins over `screen`, which may be an earlier frame the failed predicate never matched; a capture
    // taken after the TUI already exited is kept under its own name and never presented as the
    // asserted viewport.
    if (failureViewport !== undefined && failureViewport.tuiAlive) write("terminal.txt", `${failureViewport.viewport}\n`)
    else if (screen !== undefined) write("terminal.txt", `${screen.viewport}\n`)
    if (sandbox !== undefined && existsSync(join(sandbox.root, "qa-receipts.jsonl"))) copyFileSync(join(sandbox.root, "qa-receipts.jsonl"), join(evidence, "qa-receipts.jsonl"))
    if (facts.pluginLog !== undefined && existsSync(facts.pluginLog)) copyFileSync(facts.pluginLog, join(evidence, "qa-plugin.log"))
    if (sandbox !== undefined && existsSync(sandbox.sessionsDir)) {
      for (const name of readSessionFiles(sandbox.sessionsDir)) copyFileSync(join(sandbox.sessionsDir, name), join(evidence, `session-${name}`))
    }
    const cleanupReceipt = await cleanup.run()
    if (isolationBefore !== undefined) {
      const summary = isolationSummary(isolationBefore, snapshotRealHomes(), { ownPids: [process.pid, ...ownPids] })
      facts.isolation = summary
      record(
        "isolation",
        "real-home-untouched",
        summary.certified,
        summary.certified
          ? `no driver-attributed write under ${summary.roots.map((entry) => entry.root).join(", ")}; protected files and credential digests unchanged (own tree=${summary.ownPids.length} pids)`
          : `driverAttributed=${JSON.stringify(summary.driverAttributed)} protectedChanged=${summary.protectedChanged} ownPids=${JSON.stringify(summary.ownPids)}`,
      )
      write("isolation.json", `${JSON.stringify(summary, null, 2)}\n`)
    }
    const failures = checks.filter((check) => !check.ok)
    const summary = {
      ok: failures.length === 0 && checks.length > 0 && interrupted === undefined,
      driver: DRIVER,
      ...(interrupted === undefined ? {} : { interrupted }),
      pluginMode: facts.pluginMode,
      proof: facts.proof,
      scheduler: facts.scheduler,
      command: facts.command ?? null,
      pid: facts.pid ?? null,
      sessionId: facts.sessionId ?? null,
      switchedSessionId: facts.switchedSessionId ?? null,
      geometry: facts.geometry,
      panelWidth: facts.panelWidth,
      sections: facts.sections,
      failureViewport: facts.failureViewport ?? null,
      sandbox: facts.sandbox ?? null,
      isolatedAgentDir: facts.isolatedAgentDir ?? null,
      realHomes: facts.isolation ?? null,
      timings: signals,
      checks: checks.length,
      passed: checks.filter((check) => check.ok).length,
      failures: failures.map((check) => ({ layer: check.layer, name: check.name, detail: check.detail })),
      failureLayers: [...new Set(failures.map((check) => check.layer))],
      cleanup: cleanupReceipt,
      files: {
        png: join(evidence, "graph-stage-progressed.png"),
        text: join(evidence, "terminal.txt"),
        buffer: join(evidence, "terminal-buffer.txt"),
        ansi: join(evidence, "terminal-ansi.txt"),
        receipts: join(evidence, "qa-receipts.jsonl"),
        metadata: join(evidence, "metadata.json"),
        summary: join(evidence, `${DRIVER}.json`),
      },
    }
    const metadata = {
      title: "Native DAG panel (fullscreen side column)",
      driver: DRIVER,
      connector: "xterm.js in headless Chrome fed by a Bun.spawn terminal (real PTY)",
      colorPath: "xterm.js (true color; no tmux)",
      pluginMode: facts.pluginMode,
      proof: {
        kind: facts.proof,
        scheduler: facts.scheduler,
        note: facts.scheduler
          ? "the panel reads the feed the real DAG runtime publishes for a run the parent model started through the workflow tool"
          : "the panel reads a fixture published through the product's claimDagPanelFeed port; no run is scheduled, so node states are the fixture's",
      },
      source: { command: facts.command ?? null, pid: facts.pid ?? null, sessionId: facts.sessionId ?? null, pluginRoot: facts.pluginRoot },
      interaction: [WARM_PROMPT, "seed-transcript", "{wheel}", "{End}", "{Show more}", "{Show less}", "{diff click}", "{Esc}", "/qa-dag-feed started", "/qa-dag-feed progressed", "/side-panel-dag", "{Tab}", "{Esc}", "/side-panel-dag", "q", "resize < min_columns", "resize > min_columns", "/new", "/quit"],
      warmTurns: facts.warmTurns,
      dimensions: facts.geometry,
      graph: facts.graph ?? null,
      overlay: facts.overlay ?? null,
      teardown: facts.teardown ?? null,
      failureViewport: facts.failureViewport ?? null,
      isolation: facts.isolation ?? null,
      sandbox: { root: facts.sandbox?.root ?? null, agentDir: facts.isolatedAgentDir ?? null, kept: options.keepSandbox },
      timings: signals,
      cleanup: cleanupReceipt,
      ok: summary.ok,
    }
    writeFileSync(join(evidence, "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`)
    summary.metadata = join(evidence, "metadata.json")
    summary.evidence = write(`${DRIVER}.json`, `${JSON.stringify({ ...summary, checks }, null, 2)}\n`)
    console.log(`cleanup: ${cleanupReceipt.join(", ") || "nothing to clean"}`)
    console.log(`evidence: ${summary.evidence}`)
    console.log(
      JSON.stringify({
        ok: summary.ok,
        driver: DRIVER,
        proof: summary.proof,
        checks: summary.checks,
        passed: summary.passed,
        failures: summary.failures,
        isolatedAgentDir: summary.isolatedAgentDir,
        realHomes: summary.realHomes === null ? null : { certified: summary.realHomes.certified, roots: summary.realHomes.roots.map((entry) => ({ root: entry.root, protectedUntouched: entry.protectedUntouched, credentialsUnchanged: entry.credentialsUnchanged, changed: entry.directory.changed })) },
      }),
    )
    process.exit(interrupted !== undefined ? 130 : summary.ok ? 0 : 1)
  }
}

function readSessionFiles(dir) {
  try {
    return readdirSync(dir).filter((name) => name.endsWith(".jsonl"))
  } catch {
    return []
  }
}

async function runSelfTest(options) {
  const parsed = parseArgs(["--evidence-dir", "/tmp/x", "--cols", "140", "--rows", "30", "--only", "graph,teardown"])
  if (parsed.cols !== 140 || parsed.rows !== 30) throw new Error("self-test: numeric arguments")
  if (parsed.only.join(",") !== "graph,teardown") throw new Error(`self-test: --only keeps canonical order, got ${parsed.only.join(",")}`)
  if (parsed.pluginMode !== "packaged") throw new Error("self-test: packaged is the default plugin surface")
  for (const bad of [
    [],
    ["--evidence-dir", "/tmp/x", "--cols", "0"],
    ["--evidence-dir", "/tmp/x", "--cols", String(MIN_COLUMNS)],
    ["--evidence-dir", "/tmp/x", "--narrow-cols", String(MIN_COLUMNS)],
    ["--evidence-dir", "/tmp/x", "--only", "graph,bogus"],
    ["--evidence-dir", "/tmp/x", "--feed-mode", "other"],
    ["--evidence-dir", "/tmp/x", "--bogus"],
  ]) {
    let rejected = false
    try {
      parseArgs(bad)
    } catch {
      rejected = true
    }
    if (!rejected) throw new Error(`self-test: ${bad.join(" ") || "(no arguments)"} must be rejected`)
  }

  const scenario = scenarioSelfTest()
  if (!scenario.ok || scenario.checks < 57) throw new Error("self-test: scenario contract")
  const helpers = (await import("./native-dag-panel-changes-helpers.mjs")).selfTest()
  if (!helpers.ok || helpers.checks < 27) throw new Error("self-test: changes helpers contract")

  // The seed answer is keyed on the request's OWN newest user message. Keying it on the whole
  // serialized history is what made every request after the seed turn replay the 100-line answer,
  // which the host's repetition guard interrupts - so the answer a later turn waits for never paints.
  const provider = await import("./native-dag-panel-mock-provider.mjs")
  const history = [
    { role: "user", content: [{ type: "text", text: "seed-transcript" }] },
    { role: "assistant", content: [{ type: "text", text: "seed line 0" }] },
    { role: "user", content: [{ type: "text", text: WARM_PROMPT }] },
  ]
  if (provider.lastUserPrompt({ messages: history }) !== WARM_PROMPT) throw new Error("self-test: the request's own prompt is the newest user message, not the history")
  if (provider.lastUserPrompt({ messages: [{ role: "user", content: "seed-transcript" }] }) !== "seed-transcript") throw new Error("self-test: a string-content user message reads as its prompt")
  if (provider.lastUserPrompt({}) !== "") throw new Error("self-test: a context with no messages has no prompt")
  const changesOnly = parseArgs(["--evidence-dir", "/tmp/x", "--only", "changes"])
  if (changesOnly.only.join(",") !== "changes") throw new Error("self-test: --only changes selects the Changes lane")
  const rendered = await renderContract()
  if (typeof rendered !== "string" || rendered.length === 0) throw new Error("self-test: render contract")

  // A geometry read: dimensions alone must not pass, and a frame painted at another width must not
  // pass either even though the heading reader alone accepts it.
  const requested = { cols: MIN_COLUMNS, rows: 40 }
  if (frameBelongsToGeometry({ viewport: "", cols: 160, rows: 44, revision: 9 }, requested, 8)) throw new Error("self-test: a frame the host painted at 160x44 must not satisfy a 120x40 read")
  if (!frameBelongsToGeometry({ viewport: "", cols: MIN_COLUMNS, rows: 40, revision: 9 }, requested, 8)) throw new Error("self-test: a frame at the requested geometry with a newer parsed write satisfies the read")
  if (frameBelongsToGeometry({ viewport: "", cols: MIN_COLUMNS, rows: 40, revision: 8 }, requested, 8)) throw new Error("self-test: a frame parsed before the resize was requested must not satisfy a geometry read")
  if (frameBelongsToGeometry({ viewport: "", cols: MIN_COLUMNS, rows: 41, revision: 9 }, requested, 8)) throw new Error("self-test: the row count is part of the geometry")
  const wideAsBoundary = panelRegion(`${"".padEnd(160 - PANEL_WIDTH - 2)}${`  ${PANEL_DIVIDER_GUTTER}${PANEL_HEADING}`}`, { cols: MIN_COLUMNS })
  if (!hasPanelHeading(wideAsBoundary) || hasPanelGutterAt(wideAsBoundary)) throw new Error("self-test: the heading reader accepts the stale wide frame, the geometry check rejects it")

  // The short-terminal overflow row, rendered by the REAL column builder at a row budget that leaves
  // two nodes over: the divided column must pass, a count that does not cover the hidden boxes must
  // not, and the run-count row must never excuse a missing node box.
  const dagSection = await import("../../src/components/side-panel/sections/dag.ts")
  const shortNow = Date.UTC(2026, 10, 8, 9, 1, 0)
  const shortRows = dagSection.buildDagRows({ runs: stageRuns("progressed"), activity: () => undefined, now: shortNow, rowCap: 8 }, PANEL_WIDTH).map((row) => row.text)
  const dividedShort = shortRows.map((text) => `  ${PANEL_DIVIDER_GUTTER}${text}`)
  const shortIntegrity = columnIntegrity(dividedShort, { requireHeading: false })
  if (!shortIntegrity.ok) throw new Error(`self-test: the real builder's short-terminal overflow row must pass the column check: ${shortIntegrity.reason}`)
  if (!columnIntegrity(shortRows, { requireHeading: false }).ok) throw new Error("self-test: the fallback's plain overflow row is accepted too")
  const underCounted = columnIntegrity(dividedShort.map((line) => line.replace(/\+\d+ more nodes/, "+1 more nodes")), { requireHeading: false })
  if (underCounted.ok || !/missing/.test(underCounted.reason)) throw new Error(`self-test: an overflow count that does not cover every hidden box must fail on the uncovered one: ${underCounted.reason}`)
  const runCount = columnIntegrity(dividedShort.map((line) => line.replace("more nodes", "more runs")), { requireHeading: false })
  if (runCount.ok || !runCount.reason.includes("BUILD missing")) throw new Error(`self-test: a run-count row must not excuse a missing node box: ${runCount.reason}`)

  // The failure evidence must come from the live renderer, before anything tears it down, and a
  // capture that fails must reject so the driver records it instead of losing the frame silently.
  const captured = []
  const liveFrame = await captureLiveViewport(
    {
      snapshot: async () => ({ viewport: `${"".padEnd(108)}  │ SESSION`, viewportY: 0, cols: 150, rows: 42 }),
      screenshot: async () => new Uint8Array([1, 2, 3]),
    },
    { writeText: (name, content) => captured.push({ name, content }), writePng: (name, bytes) => captured.push({ name, bytes: bytes.length }) },
  )
  if (captured[0]?.name !== "terminal-failure-viewport.txt" || !captured[0].content.includes("│ SESSION")) throw new Error("self-test: the failure capture writes the live viewport text")
  if (!hasPanelHeading(panelRegion(liveFrame.viewport, { cols: liveFrame.cols }))) throw new Error("self-test: the captured failure frame is the one the heading reader asserts on")
  if (captured[1]?.name !== "terminal-failure-viewport.png" || captured[1].bytes !== 3) throw new Error("self-test: the failure capture writes the live screenshot")
  let captureRejected = false
  try {
    await captureLiveViewport({ snapshot: async () => ({ viewport: "x", viewportY: 0, cols: 1, rows: 1 }), screenshot: async () => Promise.reject(new Error("no screenshot")) }, { writeText: () => {}, writePng: () => {} })
  } catch {
    captureRejected = true
  }
  if (!captureRejected) throw new Error("self-test: a failed capture must reject instead of leaving a half-written receipt")

  if (resolveChrome(process.execPath, {}, "none") !== process.execPath) throw new Error("self-test: an explicit chrome path wins")
  if (resolveChrome(undefined, { CHROME_BIN: "/definitely/missing" }, "none") !== undefined) throw new Error("self-test: a missing chrome candidate is skipped")

  // The isolation verdict: every changed non-volatile path needs a writer outside our own tree.
  const snap = (entries) => ({ snapshot: new Map(entries), complete: true, errors: [] })
  const stateFiles = (entries) => ({ snapshot: new Map(entries), complete: true, errors: [] })
  const home = (files, credentials, protectedFiles = [["auth.json", "h"], ["settings.json", "h"]]) => ({
    root: "/real/agent",
    present: true,
    credentials,
    protected: stateFiles(protectedFiles),
    directory: snap(files),
  })
  const owned = { ownPids: [4242] }
  if (!isolationSummary([home([["settings.json", "a"]], "cred-1")], [home([["settings.json", "a"]], "cred-1")], owned).certified) {
    throw new Error("self-test: an unchanged home must certify")
  }
  const foreignWrite = isolationSummary([home([], "cred-1")], [home([["agent/summary/x.json", "x"]], "cred-1")], owned)
  if (foreignWrite.certified || foreignWrite.driverAttributed.length !== 1) {
    throw new Error("self-test: a non-volatile write with no owner record is driver-attributed")
  }
  if (isolationSummary([home([["settings.json", "a"]], "cred-1")], [home([["settings.json", "a"], ["logs/qa.log", "b"]], "cred-1")], owned).certified !== true) {
    throw new Error("self-test: session/cache/log churn is reported as volatile")
  }
  if (isolationSummary([home([["settings.json", "a"]], "cred-1")], [home([["settings.json", "a"]], "cred-2")], owned).certified) {
    throw new Error("self-test: a credential digest change must fail the verdict")
  }
  const protectedChanged = isolationSummary([home([["settings.json", "a"]], "cred-1", [["settings.json", "a"]])], [home([["settings.json", "b"]], "cred-1", [["settings.json", "b"]])], owned)
  if (protectedChanged.certified) throw new Error("self-test: a protected state file change must fail the verdict")
  if (protectedChanged.protectedChanged !== true) throw new Error("self-test: the protected-file change must be reported")

  // The driver's own tree cannot own a real-home write; a proof token is what makes one foreign.
  if (!isolationSummary([home([], "cred-1")], [home([["owners/4242.json", "mine"]], "cred-1")], { ownPids: [9999] }).certified) {
    throw new Error("self-test: an owner record naming a foreign pid must not certify a write by that pid")
  }
  const mine = isolationSummary([home([], "cred-1")], [home([[`agent/omo-senpi/omo-native/session-summary/owners/4242.json`, "mine"]], "cred-1")], { ownPids: [4242] })
  if (mine.certified || mine.driverAttributed.length !== 1) throw new Error("self-test: an owner record naming OUR pid is driver-attributed")
  if (ownProcessTree([process.pid]).includes(process.pid) === false) throw new Error("self-test: the driver must always be in its own tree")

  const command = tuiCommand({ ...options, senpiCli: "/senpi/cli.js", pluginMode: "packaged" }, { sessionsDir: "/tmp/sessions" }, "/bun").join(" ")
  for (const required of ["--tui-mode fullscreen", "--omo-side-panel", "native-dag-panel-fixture.mjs", "native-dag-panel-mock-provider.mjs", "--session-dir"]) {
    if (!command.includes(required)) throw new Error(`self-test: tui command is missing ${required}`)
  }
  if (command.includes("native-dag-panel-source-plugin.mjs")) throw new Error("self-test: packaged mode must not load the source component extension")
  const sourceCommand = tuiCommand({ ...options, senpiCli: "/senpi/cli.js", pluginMode: "source" }, { sessionsDir: "/tmp/sessions" }, "/bun").join(" ")
  if (!sourceCommand.includes("native-dag-panel-source-plugin.mjs")) throw new Error("self-test: source mode must load the source component extension")
  const env = sandboxEnv({ agentDir: "/tmp/a", homeDir: "/tmp/h", xdgConfigHome: "/tmp/c", xdgDataHome: "/tmp/d", xdgCacheHome: "/tmp/e", root: "/tmp/root" }, { receiptPath: "/tmp/r.jsonl" })
  if (env.SENPI_CODING_AGENT_DIR !== "/tmp/a" || env.PI_CODING_AGENT_DIR !== "/tmp/a" || env.HOME !== "/tmp/h") throw new Error("self-test: sandbox env lanes")
  if (env.QA_RECEIPT_PATH !== "/tmp/r.jsonl") throw new Error("self-test: sandbox env QA channels")
  if (env.OMO_PACKAGE_DIR !== undefined || env.SENPI_PACKAGE_DIR !== undefined || env.PI_PACKAGE_DIR !== undefined) throw new Error("self-test: sandbox env scrubs package-dir lanes")
  let envRejected = false
  try {
    assertSandboxEnv({ agentDir: "/tmp/a", homeDir: "/tmp/h", xdgConfigHome: "/tmp/c", xdgDataHome: "/tmp/d", xdgCacheHome: "/tmp/e", root: "/tmp/root" }, { ...env, HOME: "/tmp/other" })
  } catch {
    envRejected = true
  }
  if (!envRejected) throw new Error("self-test: a wrong HOME must be rejected")
  const auditSandbox = { root: "/tmp/sbx", agentDir: "/tmp/sbx/agent", homeDir: "/tmp/sbx/home", sessionsDir: "/tmp/sbx/agent/sessions" }
  const auditEnv = sandboxEnv({ agentDir: "/tmp/sbx/agent", homeDir: "/tmp/sbx/home", xdgConfigHome: "/tmp/sbx/xdg", xdgDataHome: "/tmp/sbx/xdg-data", xdgCacheHome: "/tmp/sbx/xdg-cache", root: "/tmp/sbx" }, { receiptPath: "/tmp/sbx/r.jsonl" })
  const cleanAudit = auditSandboxRoots(auditSandbox, auditEnv, "/real-home")
  if (!cleanAudit.ok) throw new Error(`self-test: a sandbox env must pass the root audit: ${JSON.stringify(cleanAudit.outside)} ${JSON.stringify(cleanAudit.resolvedOutside)}`)
  const leakyAudit = auditSandboxRoots(auditSandbox, { ...auditEnv, XDG_DATA_HOME: "/real-home/.local/share" }, "/real-home")
  if (leakyAudit.ok || !leakyAudit.outside.includes("XDG_DATA_HOME")) throw new Error("self-test: a state root outside the sandbox must fail the audit")
  if (leakyAudit.homeReferences.length === 0) throw new Error("self-test: a remaining real-home reference must be reported")

  console.log(JSON.stringify({ ok: true, driver: DRIVER, selfTest: true, checks: 53 }))
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
