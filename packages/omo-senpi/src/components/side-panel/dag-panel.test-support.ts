import type { DagBridgeRunSnapshot, DagBridgeSnapshotNode } from "../task/dag-snapshot-payload"

/**
 * Snapshot builders for the panel's DAG contracts. Every case starts from a complete node/run and
 * overrides only the fields its contract is about, so a new engine field cannot silently make a
 * fixture incomplete.
 */
export function dagNode(overrides: Partial<DagBridgeSnapshotNode> & { readonly id: string }): DagBridgeSnapshotNode {
  return {
    prompt: `${overrides.id} prompt`,
    dependsOn: [],
    state: "pending",
    attempt: 1,
    createdAt: "2026-11-08T00:00:00.000Z",
    ...overrides,
  }
}

export function dagRun(overrides: Partial<DagBridgeRunSnapshot> = {}): DagBridgeRunSnapshot {
  return {
    runId: "run-dag",
    runKey: "key-dag",
    name: "dag run",
    status: "running",
    createdAt: "2026-11-08T00:00:00.000Z",
    updatedAt: "2026-11-08T00:00:01.000Z",
    counts: { total: 1 },
    nodes: [dagNode({ id: "build" })],
    edges: [],
    waves: [],
    ...overrides,
  }
}
