// Vendored from pi-subagent-manager 1.7.0 (MIT, see ./LICENSE and ./PROVENANCE.md).
import type { Theme } from "@code-yeongyu/senpi";
import { getKeybindings, Key, matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { dialogHeight, dialogText, frameDialog, type DialogHost } from "./dialog";
import type { LoaderStyle, ThreadService } from "./types";
import { buildStatusTree, threadActivity, type StatusRow } from "./thread-tree";
import {
  AGENT_PROGRESS_INTERVAL,
  agentProgressIcon,
  agentTypeBadge,
  agentTypeLabel,
  threadMetrics,
} from "./ui-helpers";

export { buildStatusTree, type StatusRow };

const ROOT = "/root";
const INACTIVE_STATES = new Set(["paused", "stopped", "failed", "completed"]);
const TITLE = "Agents status";
const TREE_TITLE = "Agents tree";
const FOOTER =
  "Esc close · ↑↓ select · ←→ fold · PgUp/PgDn · Enter inspect · r refresh";

function agentCount(threads: readonly { path?: string }[]): number {
  const paths = new Set<string>();
  for (const thread of threads) {
    if (thread?.path && thread.path !== ROOT) paths.add(thread.path);
  }
  return paths.size;
}

function lexicalParent(path: string): string | null {
  const index = path.lastIndexOf("/");
  return index > 0 ? path.slice(0, index) : null;
}

function treeParent(rows: StatusRow[], index: number): StatusRow | undefined {
  const depth = rows[index]?.prefix.length ?? 0;
  for (let cursor = index - 1; cursor >= 0; cursor--) {
    if (rows[cursor].prefix.length < depth) return rows[cursor];
  }
  return undefined;
}

function firstChild(rows: StatusRow[], index: number): StatusRow | undefined {
  const next = rows[index + 1];
  return next && next.prefix.length > (rows[index]?.prefix.length ?? 0) ? next : undefined;
}

function label(row: StatusRow): string {
  if (!row.thread)
    return row.path === ROOT
      ? `${dialogText(row.path)}  main  running  main`
      : `${dialogText(row.path)}  missing parent`;
  return [row.path, row.thread.type, row.thread.state, row.thread.status]
    .map((part) => dialogText(part))
    .join("  ");
}

export interface AgentTreeState {
  selectedPath: string;
  collapsed: Set<string>;
}

export class StatusDialog {
  private state: AgentTreeState;
  private get selectedPath(): string {
    return this.state.selectedPath;
  }
  private set selectedPath(value: string) {
    this.state.selectedPath = value;
  }
  private get collapsed(): Set<string> {
    return this.state.collapsed;
  }
  private viewport = 1;
  private timer: ReturnType<typeof setInterval> | undefined;
  private refreshDelay = 0;
  private refreshing = false;

  constructor(
    private host: DialogHost,
    private theme: Theme,
    private service: ThreadService,
    private done: (path: string | undefined) => void,
    selected?: string,
    private title = TITLE,
    private navigation?: {
      state: AgentTreeState;
      actions(path: string): void;
      fullscreen?: boolean;
      /** Right on a leaf steps tree → widget; called just before the tree closes. */
      returnToWidget?(): void;
    },
    private nerdFontIcons = false,
    private loaderStyle: LoaderStyle = "circle",
  ) {
    this.state = navigation?.state ?? { selectedPath: selected || ROOT, collapsed: new Set() };
  }

  invalidate(): void {}

  /** Poll retained status, accelerating the existing timer only for animated live agents. */
  startRefresh(): void {
    this.stopRefresh();
    this.refreshing = true;
    this.syncRefresh();
  }

  /** Stop the refresh. Safe to call more than once, including from dispose(). */
  dispose(): void {
    this.refreshing = false;
    this.stopRefresh();
  }

  private syncRefresh(): void {
    if (!this.refreshing) return;
    const delay = this.service
      .list()
      .some(
        (thread) =>
          thread.path !== ROOT && (thread.state === "starting" || thread.state === "running"),
      )
      ? AGENT_PROGRESS_INTERVAL
      : 1000;
    if (this.timer !== undefined && this.refreshDelay === delay) return;
    this.stopRefresh();
    this.refreshDelay = delay;
    this.timer = setInterval(() => {
      this.syncRefresh();
      this.host.requestRender();
    }, delay);
    if (typeof this.timer.unref === "function") this.timer.unref();
  }

  private stopRefresh(): void {
    if (this.timer === undefined) return;
    clearInterval(this.timer);
    this.timer = undefined;
    this.refreshDelay = 0;
  }

  private rows(): StatusRow[] {
    return buildStatusTree(this.service.list(), this.collapsed);
  }

  private locate(rows: StatusRow[]): number {
    const exact = rows.findIndex((row) => row.path === this.selectedPath);
    if (exact >= 0) return exact;
    let parent = lexicalParent(this.selectedPath);
    while (parent) {
      const index = rows.findIndex((row) => row.path === parent);
      if (index >= 0) return index;
      parent = lexicalParent(parent);
    }
    const root = rows.findIndex((row) => row.path === ROOT);
    return root >= 0 ? root : 0;
  }

  handleInput(data: string): void {
    const keys = getKeybindings();
    if (keys.matches(data, "tui.select.cancel")) {
      this.done(undefined);
      return;
    }
    const rows = this.rows();
    const index = this.locate(rows);
    const row = rows[index];
    if (row) this.selectedPath = row.path;
    if (keys.matches(data, "tui.select.confirm")) {
      if (this.navigation && row?.path === ROOT) this.done(undefined);
      else if (row?.thread && row.path !== ROOT) this.done(row.path);
      return;
    }
    if (data === "i" && this.navigation) {
      if (row?.thread && row.path !== ROOT) this.navigation.actions(row.path);
      return;
    }
    if (matchesKey(data, Key.ctrl("q")) && this.navigation) {
      this.done(undefined);
      return;
    }
    if (data === "r") {
      this.host.requestRender();
      return;
    }
    if (matchesKey(data, Key.left)) {
      if (row?.hasChildren && !this.collapsed.has(row.path)) this.collapsed.add(row.path);
      else if (row) {
        const parent = treeParent(rows, index);
        if (parent) this.selectedPath = parent.path;
      }
    } else if (matchesKey(data, Key.right)) {
      if (row?.hasChildren && this.collapsed.has(row.path)) this.collapsed.delete(row.path);
      else {
        const child = row?.hasChildren ? firstChild(rows, index) : undefined;
        if (child) this.selectedPath = child.path;
        else if (this.navigation?.fullscreen) {
          // Nothing left to fold or descend into: the next step right is the widget.
          this.navigation.returnToWidget?.();
          this.done(undefined);
          return;
        }
      }
    } else {
      let next = index;
      if (keys.matches(data, "tui.select.up")) next -= 1;
      else if (keys.matches(data, "tui.select.down")) next += 1;
      else if (matchesKey(data, Key.pageUp)) next -= this.viewport;
      else if (matchesKey(data, Key.pageDown)) next += this.viewport;
      else if (matchesKey(data, Key.home)) next = 0;
      else if (matchesKey(data, Key.end)) next = Math.max(0, rows.length - 1);
      else return;
      this.selectedPath =
        rows[Math.max(0, Math.min(rows.length - 1, next))]?.path ?? this.selectedPath;
    }
    this.host.requestRender();
  }

  private line(row: StatusRow, selected: boolean, width: number): string[] {
    const marker = row.hasChildren ? (this.collapsed.has(row.path) ? "▸ " : "▾ ") : "";
    const head = ` ${row.prefix}${selected ? "›" : " "} ${marker}`;
    const thread = row.thread;
    if (!thread) {
      const text = `${head}${label(row)}`;
      return [selected ? this.theme.fg("accent", text) : text, ""];
    }
    const inactive = INACTIVE_STATES.has(thread.state);
    const base = thread.state === "completed" ? "dim" : "muted";
    const hint =
      thread.state === "completed" ? "success" : thread.state === "failed" ? "error" : base;
    const progress = agentProgressIcon(
      thread,
      this.nerdFontIcons,
      Date.now(),
      true,
      this.loaderStyle,
    );
    const badge = inactive
      ? this.theme.fg(base, agentTypeLabel(thread.type, thread.icon, this.nerdFontIcons, progress))
      : agentTypeBadge(
          thread.type,
          thread.color,
          this.theme,
          thread.icon,
          this.nerdFontIcons,
          progress,
        );
    const identity = [
      thread.path,
      `${thread.model ?? "model pending"}${thread.thinkingLevel ? `:${thread.thinkingLevel}` : ""}`,
    ]
      .map((part) => dialogText(part))
      .join("  ");
    const identityLine = [
      selected ? this.theme.fg("accent", head) : head,
      badge,
      this.theme.fg(inactive ? base : selected ? "accent" : "text", `  ${identity}  `),
      this.theme.fg(inactive ? hint : "muted", dialogText(thread.state)),
    ].join("");
    // Continue the tree's vertical guides without repeating the branch or selection marker.
    const stem = row.prefix.replace("├ ", "│ ").replace("└ ", "  ");
    const activity = ` ${stem}  ${dialogText(threadActivity(thread))}`;
    const metrics = this.theme.fg(base, threadMetrics(thread));
    const metricWidth = visibleWidth(metrics);
    const first =
      metricWidth >= width
        ? truncateToWidth(metrics, width, "")
        : (() => {
            const left = truncateToWidth(identityLine, width - metricWidth - 1);
            return (
              left + " ".repeat(Math.max(1, width - visibleWidth(left) - metricWidth)) + metrics
            );
          })();
    const second = truncateToWidth(
      this.theme.fg(inactive ? base : selected ? "accent" : "muted", activity),
      width,
    );
    return [first, second];
  }

  private detail(row: StatusRow | undefined): string[] {
    if (!row?.thread) {
      return [
        ` ${row?.path === ROOT ? (agentCount(this.service.list()) ? "Main Pi session" : "Main Pi session - No agents yet") : "Missing parent"}`,
        "",
      ];
    }
    return [` task ${dialogText(row.thread.task)}`, ` ${threadMetrics(row.thread)}`];
  }

  render(width: number): string[] {
    this.syncRefresh();
    const rows = this.rows();
    const height = this.navigation?.fullscreen
      ? Math.max(1, this.host.terminal?.rows ?? 24)
      : dialogHeight(this.host);
    const index = this.locate(rows);
    if (rows[index]) this.selectedPath = rows[index].path;
    const budget = Math.max(0, height - 4);
    const detail = budget > 2 ? this.detail(rows[index]) : [];
    const treeCount = Math.max(0, Math.floor((budget - detail.length) / 2));
    this.viewport = Math.max(1, treeCount);
    const start = treeCount
      ? Math.max(0, Math.min(index - treeCount + 1, Math.max(0, rows.length - treeCount)))
      : 0;
    const body = [
      ...rows
        .slice(start, start + treeCount)
        .flatMap((row) => this.line(row, row.path === this.selectedPath, Math.max(0, width - 2))),
      ...detail,
    ];
    return frameDialog(
      this.theme,
      width,
      height,
      this.heading(rows, start, treeCount),
      body,
      this.navigation
        ? "Esc main · ↑↓ select · ←→ fold · → widget · i Actions · Ctrl+C stop all"
        : FOOTER,
    );
  }

  private heading(rows: StatusRow[], start: number, treeCount: number): string {
    if (this.title !== TREE_TITLE) return this.title;
    const agents = agentCount(this.service.list());
    const noun = agents === 1 ? "agent" : "agents";
    const total = rows.length;
    const shown = Math.max(0, Math.min(treeCount, total - start));
    if (shown <= 0) return `${TREE_TITLE}  ${agents} ${noun}`;
    return `${TREE_TITLE}  ${agents} ${noun}  ${start + 1}-${start + shown}/${total}`;
  }
}
