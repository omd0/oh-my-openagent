import type { DagBridgeRunSnapshot } from "./dag-snapshot-payload"

export interface DagPanelFeed {
  runs(): readonly DagBridgeRunSnapshot[]
  activity(runId: string, nodeId: string): string | undefined
}

interface FeedEntry {
  owner?: object
  feed?: DagPanelFeed
  readonly listeners: Set<() => void>
}

interface FeedRegistry {
  readonly sessions: Map<string, FeedEntry>
}

const REGISTRY_KEY = Symbol.for("omo.senpi.dagPanelFeed")

function registry(): FeedRegistry {
  const globalRegistry = globalThis as unknown as { [key: symbol]: FeedRegistry | undefined }
  let value = globalRegistry[REGISTRY_KEY]
  if (value === undefined) {
    value = { sessions: new Map() }
    globalRegistry[REGISTRY_KEY] = value
  }
  return value
}

function entryFor(sessionId: string): FeedEntry {
  const sessions = registry().sessions
  let entry = sessions.get(sessionId)
  if (entry === undefined) {
    entry = { listeners: new Set() }
    sessions.set(sessionId, entry)
  }
  return entry
}

export function readDagPanelFeed(sessionId: string): DagPanelFeed | undefined {
  return registry().sessions.get(sessionId)?.feed
}

export function subscribeDagPanelFeed(sessionId: string, listener: () => void): () => void {
  const entry = entryFor(sessionId)
  entry.listeners.add(listener)
  return () => {
    entry.listeners.delete(listener)
    if (entry.listeners.size === 0 && entry.feed === undefined) {
      registry().sessions.delete(sessionId)
    }
  }
}

/** Claims a session slot. The returned closures act only while this ownership token is current. */
export function claimDagPanelFeed(
  sessionId: string,
  owner: object,
  feed: DagPanelFeed,
): { notify(): void; dispose(): void } {
  const entry = entryFor(sessionId)
  entry.owner = owner
  entry.feed = feed
  notify(entry)
  return {
    notify() {
      if (registry().sessions.get(sessionId) === entry && entry.owner === owner) notify(entry)
    },
    dispose() {
      if (registry().sessions.get(sessionId) !== entry || entry.owner !== owner) return
      entry.feed = undefined
      entry.owner = undefined
      notify(entry)
      if (entry.listeners.size === 0) registry().sessions.delete(sessionId)
    },
  }
}

function notify(entry: FeedEntry): void {
  for (const listener of [...entry.listeners]) {
    try {
      listener()
    } catch {
      // Consumer faults must not escape into the task scheduler's event fan-out.
    }
  }
}
