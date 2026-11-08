// Vendored from pi-subagent-manager 1.7.0 (MIT, see ./LICENSE and ./PROVENANCE.md).
import { colorToRgb, rgbColor, stripTerminalSequences, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { Theme, ThemeColor } from "@code-yeongyu/senpi";
import type { ThreadView } from "./types";
import { isAgentLoaderGlyph } from "./agent-loader";
export { AGENT_PROGRESS_INTERVAL, agentProgressIcon } from "./agent-loader";

export const AGENT_COLORS = [
  "accent",
  "border",
  "borderAccent",
  "borderMuted",
  "success",
  "error",
  "warning",
  "muted",
  "dim",
  "text",
  "thinkingText",
  "scrollbarTrack",
  "scrollbarThumb",
  "searchMatchText",
  "userMessageText",
  "customMessageText",
  "customMessageLabel",
  "toolTitle",
  "toolOutput",
  "mdHeading",
  "mdLink",
  "mdLinkUrl",
  "mdCode",
  "mdCodeBlock",
  "mdCodeBlockBorder",
  "mdQuote",
  "mdQuoteBorder",
  "mdHr",
  "mdListBullet",
  "toolDiffAdded",
  "toolDiffRemoved",
  "toolDiffContext",
  "syntaxComment",
  "syntaxKeyword",
  "syntaxFunction",
  "syntaxVariable",
  "syntaxString",
  "syntaxNumber",
  "syntaxType",
  "syntaxOperator",
  "syntaxPunctuation",
  "thinkingOff",
  "thinkingMinimal",
  "thinkingLow",
  "thinkingMedium",
  "thinkingHigh",
  "thinkingXhigh",
  "thinkingMax",
  "bashMode",
] as const;

/** Plain terminal-safe text: never pass agent-supplied terminal commands through. */
export function sanitizeText(text: string): string {
  return stripTerminalSequences(text).replace(/[\x00-\x1f\x7f-\x9f]/g, " ");
}

type AgentBadgeTheme = Pick<Theme, "fg" | "colors" | "style">;

/** Selected type token, or accent when unset or unknown. Shared by the pill and path. */
function agentColorToken(color: string | undefined): ThemeColor {
  return AGENT_COLORS.includes(color as (typeof AGENT_COLORS)[number])
    ? (color as ThemeColor)
    : "accent";
}

/** Background pill with bold contrasting text and padding. Label is sanitized. */
function contrastPill(label: string, color: string | undefined, theme: AgentBadgeTheme): string {
  const background = theme.colors[agentColorToken(color)];
  const { r, g, b } = colorToRgb(background);
  const linear = (channel: number) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
  // Pick whichever of black/white has the higher WCAG contrast ratio.
  const foreground = luminance > Math.sqrt(0.0525) - 0.05 ? 0 : 255;
  return theme.style(` ${sanitizeText(label)} `, {
    bg: background,
    fg: rgbColor(foreground, foreground, foreground),
    bold: true,
  });
}

/** Invalid/untrusted saved icons never reach the terminal. Names remain readable. */
export function agentTypeLabel(
  type: string,
  icon?: string,
  nerdFontIcons = false,
  loaderIcon?: string,
): string {
  const role =
    nerdFontIcons && typeof icon === "string" && /^\p{Co}$/u.test(icon) ? `${icon} ` : "";
  const progress =
    loaderIcon && isAgentLoaderGlyph(loaderIcon, nerdFontIcons) ? `${loaderIcon} ` : "";
  return `${progress}${role}${sanitizeText(type)}`;
}

export function agentTypeBadge(
  type: string,
  color: string | undefined,
  theme: AgentBadgeTheme,
  icon?: string,
  nerdFontIcons = false,
  loaderIcon?: string,
): string {
  return contrastPill(agentTypeLabel(type, icon, nerdFontIcons, loaderIcon), color, theme);
}

export function agentPath(path: string, color: string | undefined, theme: AgentBadgeTheme): string {
  return theme.fg(agentColorToken(color), sanitizeText(path));
}

function metricCount(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

/** Settled active time plus the current live run, only while starting or running. */
function elapsedTotal(thread: ThreadView, now = Date.now()): number {
  const live =
    typeof thread.startedAt === "number" &&
    Number.isFinite(thread.startedAt) &&
    (thread.state === "starting" || thread.state === "running")
      ? now - thread.startedAt
      : 0;
  const total = metricCount(thread.elapsedMs) + live;
  return Number.isFinite(total) ? total : 0;
}

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600) % 24;
  const days = Math.floor(total / 86400);
  if (days > 0) return `${days}d${hours}h`;
  if (hours > 0) return `${hours}h${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

const compactCount = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function formatCount(value: number | undefined): string {
  // Intl emits uppercase units (`1.2K`); the widget uses lowercase.
  return compactCount.format(metricCount(value)).toLowerCase();
}

export function threadMetrics(thread: ThreadView, now = Date.now()): string {
  const cost = thread.costUsd === undefined ? "" : ` $${thread.costUsd.toFixed(4)}`;
  // Token counters appear only when the host measured them. An unmeasured row shows no counter rather
  // than a zero that would read as a real measurement (omo: DAG and inline rows may lack token stats).
  const tokens =
    thread.inputTokens === undefined && thread.outputTokens === undefined
      ? ""
      : ` ↑${formatCount(thread.inputTokens)} ↓${formatCount(thread.outputTokens)}`;
  return `${formatDuration(elapsedTotal(thread, now))}${tokens}${cost}`;
}
