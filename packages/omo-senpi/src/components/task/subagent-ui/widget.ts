// Vendored from pi-subagent-manager 1.7.0 src/ui/ui.ts (MIT, see ./LICENSE and ./PROVENANCE.md):
// the inline agent widget (renderAgentTree) and its row helpers, copied verbatim. Only the imports
// point at this package's local modules, and the badge theme type is declared here.
import type { Theme } from "@code-yeongyu/senpi";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import { agentProgressIcon } from "./agent-loader";
import { buildStatusTree, lastStarted, type StatusRow } from "./thread-tree";
import type { LoaderStyle, ThreadView } from "./types";
import { agentPath, agentTypeBadge, sanitizeText, threadMetrics } from "./ui-helpers";

type AgentBadgeTheme = Pick<Theme, "fg" | "colors" | "style">;
type AgentStatusRow = StatusRow & { thread: ThreadView };
type AgentCandidate = { row: AgentStatusRow; index: number };

/** Keep the right-hand counters intact; truncate the left side to the remaining columns. */
function fitLine(left: string, right: string, width: number): string {
  if (width <= 0) return "";
  const rightWidth = visibleWidth(right);
  if (rightWidth >= width) return truncateToWidth(right, width, "");
  const fitted = truncateToWidth(left, width - rightWidth - 1);
  const pad = width - visibleWidth(fitted) - rightWidth;
  return fitted + " ".repeat(Math.max(0, pad)) + right;
}

const WIDGET_ROOT = "/root";
const MAX_WIDGET_LINES = 12;
const AGENT_WIDGET_PLACEMENT = { placement: "aboveEditor" as const };
const AGENT_BROWSER_HINT = "Press ← to open subagent browser";

interface AgentWidgetRenderOptions {
  /** RPC widgets cannot open a terminal browser. */
  showBrowserHint?: boolean;
  nerdFontIcons?: boolean;
  loaderStyle?: LoaderStyle;
  /** RPC snapshots use a static running frame and never start an animation. */
  animate?: boolean;
  /** Minimal line is a session collapse of full: Left steps back to full, not the browser. */
  expandHint?: boolean;
  /** Additive (see PROVENANCE.md): applied to each thread row after its width is fitted. */
  decorate?: (thread: ThreadView, line: string, width: number) => string;
}

function agentWidgetStatus(
  running: number,
  omitted: number,
  width: number,
  theme: Pick<Theme, "fg">,
  showBrowserHint: boolean,
): string {
  const details = [
    omitted > 0 ? `+${omitted} more agents` : "",
    showBrowserHint && running > 0 ? AGENT_BROWSER_HINT : "",
    showBrowserHint ? "→ collapse" : "",
  ].filter(Boolean);
  return truncateToWidth(
    theme.fg("accent", `${running} running`) +
      (details.length ? theme.fg("muted", ` · ${details.join(" · ")}`) : ""),
    width,
    "",
  );
}

function statePriority(state: ThreadView["state"] | undefined): number {
  if (state === "starting" || state === "running") return 0;
  if (state === "paused") return 1;
  return 2;
}

function agentStateColor(state: ThreadView["state"]): "error" | "warning" | "accent" {
  return state === "failed" ? "error" : state === "paused" ? "warning" : "accent";
}

function agentLine(
  row: AgentStatusRow,
  width: number,
  theme: AgentBadgeTheme,
  nerdFontIcons: boolean,
  animate: boolean,
  loaderStyle: LoaderStyle,
): string {
  const thread = row.thread;
  const badge = agentTypeBadge(
    thread.type,
    thread.color,
    theme,
    thread.icon,
    nerdFontIcons,
    agentProgressIcon(thread, nerdFontIcons, Date.now(), animate, loaderStyle),
  );
  // Identity always paints; the live verb/tool, the routing target and the measured facts follow it
  // as optional segments. The right column keeps the clock and spend, so the left side truncates first.
  const head = `${row.prefix}${badge} ${agentPath(thread.path, thread.color, theme)} ${theme.fg(agentStateColor(thread.state), `[${sanitizeText(thread.state)}]`)} ${sanitizeText(thread.task)}`;
  const live = thread.state === "starting" || thread.state === "running";
  const segments = [
    head,
    ...(live && thread.summary ? [sanitizeText(thread.summary)] : []),
    ...(thread.target ? [sanitizeText(thread.target)] : []),
    ...(thread.facts ?? []).map(sanitizeText),
  ];
  return fitLine(segments.join(" · "), theme.fg("muted", threadMetrics(thread)), width);
}

function placeholderLine(row: StatusRow, width: number, theme: AgentBadgeTheme): string {
  return truncateToWidth(
    `${row.prefix}${theme.fg("muted", `${sanitizeText(row.path)}  missing parent`)}`,
    width,
    "",
  );
}

function takeWidgetRows(rows: StatusRow[], budget: number): StatusRow[] {
  const parents = new Map<number, number[]>();
  const stack: number[] = [];
  for (const [index, row] of rows.entries()) {
    while (stack.length && rows[stack[stack.length - 1]].prefix.length >= row.prefix.length)
      stack.pop();
    parents.set(index, [...stack]);
    stack.push(index);
  }
  const rowCost = (row: StatusRow) => (row.path === WIDGET_ROOT ? 0 : 1);
  const candidates = rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row.thread && row.path !== WIDGET_ROOT)
    .sort(
      (a, b) =>
        statePriority((a.row as AgentStatusRow).thread.state) -
          statePriority((b.row as AgentStatusRow).thread.state) ||
        lastStarted(b.row.thread) - lastStarted(a.row.thread) ||
        a.index - b.index,
    ) as AgentCandidate[];
  const chosen = new Set<number>();
  let used = 0;
  for (const { index } of candidates) {
    const needed = [...(parents.get(index) as number[]), index].filter(
      (ancestor) => !chosen.has(ancestor),
    );
    const cost = needed.reduce((total, ancestor) => total + rowCost(rows[ancestor]), 0);
    if (used + cost > budget) continue;
    for (const ancestor of needed) chosen.add(ancestor);
    used += cost;
  }
  // If a missing-parent chain cannot fit its agent, retain a useful tree prefix.
  if (!chosen.size) {
    for (const [index, row] of rows.entries()) {
      const cost = rowCost(row);
      if (used + cost > budget) break;
      chosen.add(index);
      used += cost;
    }
  }
  return rows.filter((row, index) => row.path !== WIDGET_ROOT && chosen.has(index));
}

/** Themed agent tree above the editor. Synthetic /root is the main conversation and is omitted. */
export function renderAgentTree(
  threads: ThreadView[],
  width: number,
  theme: AgentBadgeTheme,
  {
    showBrowserHint = true,
    nerdFontIcons = false,
    animate = true,
    loaderStyle = "circle",
    decorate,
  }: AgentWidgetRenderOptions = {},
): string[] {
  const columns = Math.max(0, width);
  const rows = buildStatusTree(threads, new Set());
  const agents = rows.filter(
    (row) => row.thread && row.path !== WIDGET_ROOT,
  ) as AgentStatusRow[];
  if (!agents.length) return [];
  const live = agents.filter(
    (row) => row.thread.state === "starting" || row.thread.state === "running",
  ).length;
  const paused = agents.filter((row) => row.thread.state === "paused").length;
  const heading = fitLine(
    theme.fg("accent", "Agents"),
    theme.fg("muted", `${live} live · ${paused} paused`),
    columns,
  );
  // Reserve the last line for status and browser entry, even with no omissions.
  const visible = takeWidgetRows(rows, MAX_WIDGET_LINES - 2);
  const omitted = agents.length - visible.filter((row) => row.thread).length;
  const lines = [heading];
  for (const row of visible) {
    if (!row.thread) {
      lines.push(placeholderLine(row, columns, theme));
      continue;
    }
    const line = agentLine(row as AgentStatusRow, columns, theme, nerdFontIcons, animate, loaderStyle);
    lines.push(decorate ? decorate(row.thread, line, columns) : line);
  }
  lines.push(agentWidgetStatus(live, omitted, columns, theme, showBrowserHint));
  return lines;
}

// The paths of the thread rows renderAgentTree paints, in paint order. Same budget, so a keyboard or
// click target always matches a row the user can see.
export function visibleAgentPaths(threads: ThreadView[]): string[] {
  const rows = buildStatusTree(threads, new Set());
  return takeWidgetRows(rows, MAX_WIDGET_LINES - 2)
    .filter((row) => row.thread !== undefined)
    .map((row) => row.path);
}
