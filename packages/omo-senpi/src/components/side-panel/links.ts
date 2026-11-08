/**
 * Clickable rows.
 *
 * The host already captures the mouse: pi-tui's alt-screen renderer turns SGR tracking on
 * unless a caller opts out, and senpi does not. What it does NOT offer is a per-component
 * mouse hook - it dispatches a click to the application exactly once, through OSC 8 hyperlink
 * activation: on a press and release inside one cell with no drag, it resolves a hyperlink
 * from its own rendered screen buffer and hands that URL to its `openUrl` callback.
 *
 * So a row becomes clickable by being painted as a hyperlink whose URL names the action, and
 * the panel recognises its own URLs by this private scheme. Because the hit test runs against
 * the host's buffer rather than the terminal's, a click works even where the terminal itself
 * does not implement OSC 8.
 *
 * Nothing here touches the host: the scheme is a string contract, which keeps it testable.
 */

const SCHEME = "omo-panel:"

/** What a click on a row opens. */
export type PanelAction =
  | { readonly kind: "file"; readonly path: string }
  | { readonly kind: "agent"; readonly id: string }
  // A session carries at most one goal, so this action needs no identity of its own; the literal
  // only keeps the scheme's kind/value shape.
  | { readonly kind: "goal" }
  // Likewise: one session is bound to exactly one memory identity.
  | { readonly kind: "memory" }
  /** Expands Changes to every file in the column. Handled by the panel, not a viewer. */
  | { readonly kind: "files-more" }
  /** Collapses Changes back to the bounded preview, restoring the other sections. */
  | { readonly kind: "files-less" }
  /** A DAG run, opened in the graph overlay focused on that run. */
  | { readonly kind: "dag-run"; readonly runId: string }
  /** One node of a DAG run, opened in the graph overlay with that node selected. */
  | { readonly kind: "dag-node"; readonly runId: string; readonly nodeId: string }

/**
 * Percent-encoding is not cosmetic here: a value carrying BEL or ESC would terminate the
 * escape sequence early and paint the rest of the row as garbage.
 */
export function panelActionUrl(action: PanelAction): string {
  return `${SCHEME}${action.kind}/${encodeURIComponent(actionValue(action))}`
}

function actionValue(action: PanelAction): string {
  if (action.kind === "file") return action.path
  if (action.kind === "agent") return action.id
  // DAG ids are arbitrary strings, so they travel as a JSON array: a quote or a separator in an id
  // can never be mistaken for the boundary between run and node.
  if (action.kind === "dag-run") return JSON.stringify([action.runId])
  if (action.kind === "dag-node") return JSON.stringify([action.runId, action.nodeId])
  return "current"
}

/** The DAG actions carry a JSON array of non-empty strings; anything else is not ours to act on. */
function parseDagAction(kind: "dag-run" | "dag-node", value: string): PanelAction | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return undefined
  }
  if (!Array.isArray(parsed)) return undefined
  const strings = parsed.filter((part): part is string => typeof part === "string" && part !== "")
  if (strings.length !== parsed.length) return undefined
  const [runId, nodeId] = strings
  if (runId === undefined) return undefined
  if (kind === "dag-run") return strings.length === 1 ? { kind, runId } : undefined
  return nodeId !== undefined && strings.length === 2 ? { kind, runId, nodeId } : undefined
}

/** The inverse, and the panel's test for "is this URL mine". Anything else belongs to the host. */
export function parsePanelActionUrl(url: string): PanelAction | undefined {
  if (!url.startsWith(SCHEME)) return undefined
  const rest = url.slice(SCHEME.length)
  const slash = rest.indexOf("/")
  if (slash <= 0) return undefined
  const kind = rest.slice(0, slash)
  const encoded = rest.slice(slash + 1)
  if (encoded === "") return undefined
  let value: string
  try {
    value = decodeURIComponent(encoded)
  } catch {
    // A malformed escape is somebody else's URL, not a broken action.
    return undefined
  }
  if (value === "") return undefined
  if (kind === "file") return { kind, path: value }
  if (kind === "agent") return { kind, id: value }
  if (kind === "goal" && value === "current") return { kind }
  if (kind === "memory" && value === "current") return { kind }
  if (kind === "files-more") return value === "current" ? { kind: "files-more" } : undefined
  if (kind === "files-less") return value === "current" ? { kind: "files-less" } : undefined
  if (kind === "dag-run" || kind === "dag-node") return parseDagAction(kind, value)
  return undefined
}

/**
 * Wrap painted text in an OSC 8 hyperlink. This must run AFTER the column's width math: the
 * width helpers measure SGR only, and would count these bytes as printable characters.
 */
export function withActionLink(text: string, action: PanelAction): string {
  return `\u001b]8;;${panelActionUrl(action)}\u0007${text}\u001b]8;;\u0007`
}
