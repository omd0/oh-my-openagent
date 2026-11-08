import type { DagBridgeRunSnapshot, DagBridgeSnapshotNode } from "../task/dag-snapshot-payload"
import { sanitizeTerminalText } from "./format/sanitize"

/**
 * One node with its TRUE dependencies. `depth` only positions the node on screen: a node is
 * never gated by a shallower layer it does not depend on.
 */
export interface DagGraphNode {
  readonly id: string
  readonly label: string
  readonly state: string
  readonly deps: readonly string[]
  readonly depth: number
  readonly source: DagBridgeSnapshotNode
}

export interface DagGraph {
  /** Declaration order, as the run recorded it. */
  readonly nodes: readonly DagGraphNode[]
  readonly byId: ReadonlyMap<string, DagGraphNode>
  /** Nodes grouped by depth, shallowest first. Depths are contiguous. */
  readonly layers: readonly (readonly DagGraphNode[])[]
}

export type DagGraphResult =
  | { readonly ok: true; readonly graph: DagGraph }
  | { readonly ok: false; readonly error: string }

/**
 * Builds the dependency graph of one run from its edges and each node's own `dependsOn`, both
 * treated as the same relation. Unknown ids are dropped rather than trusted. A run whose
 * dependencies cannot all be placed contains a cycle and is reported instead of drawn.
 */
export function layoutDagRun(run: DagBridgeRunSnapshot): DagGraphResult {
  const ids = new Set(run.nodes.map((node) => node.id))
  const depsOf = new Map<string, string[]>(run.nodes.map((node) => [node.id, []]))
  const addDep = (to: string, from: string): void => {
    const list = depsOf.get(to)
    if (list === undefined || !ids.has(from) || list.includes(from)) return
    list.push(from)
  }
  for (const edge of run.edges) addDep(edge.to, edge.from)
  for (const node of run.nodes) for (const dep of node.dependsOn) addDep(node.id, dep)

  const depth = new Map<string, number>()
  let progress = true
  while (progress) {
    progress = false
    for (const node of run.nodes) {
      if (depth.has(node.id)) continue
      const deps = depsOf.get(node.id) ?? []
      if (!deps.every((dep) => depth.has(dep))) continue
      depth.set(node.id, deps.reduce((max, dep) => Math.max(max, (depth.get(dep) ?? 0) + 1), 0))
      progress = true
    }
  }
  if (depth.size !== run.nodes.length) return { ok: false, error: "dependency cycle: graph not drawn" }

  const nodes = run.nodes.map(
    (source): DagGraphNode => ({
      id: source.id,
      label: sanitizeTerminalText(source.label ?? source.id),
      state: source.state,
      deps: depsOf.get(source.id) ?? [],
      depth: depth.get(source.id) ?? 0,
      source,
    }),
  )
  const layers: DagGraphNode[][] = []
  for (const node of nodes) (layers[node.depth] ??= []).push(node)
  return { ok: true, graph: { nodes, byId: new Map(nodes.map((node) => [node.id, node])), layers } }
}
