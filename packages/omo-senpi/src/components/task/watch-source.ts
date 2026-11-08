import type { WatchTranscript } from "./watch-transcript"

// One line of the tree screen. `indent` carries dependency depth, so a node that waits on another
// sits under it the way the agents tree nests a branch.
export interface WatchRow {
  readonly id: string
  readonly identity: string
  readonly state: string
  readonly summary: string
  readonly meta: string
  readonly indent: number
}

// What the watch screen shows about the watched item right now. `terminal` means no further change
// is expected, so the viewer stops reading its transcript after one final read.
export interface WatchTarget {
  readonly identity: string
  readonly state: string
  readonly summary: string
  readonly meta: string
  readonly terminal: boolean
}

export interface SteerReport {
  readonly accepted: boolean
  readonly text: string
}

export interface WatchLabels {
  readonly title: string
  readonly unit: string
  readonly empty: string
}

// The one seam between the shared watch surface and whatever it watches. A source is bound to one
// owner (one parent session, one run) when it is built, and every method re-reads through that owner,
// so a stale id cannot reach another owner's data.
export interface WatchSource {
  labels(): WatchLabels
  // Undefined when the owner or its data is no longer available to this session; the viewer closes.
  rows(): readonly WatchRow[] | undefined
  // Undefined when the id is no longer part of the owner's data.
  target(id: string): WatchTarget | undefined
  read(id: string): WatchTranscript
  send(id: string, message: string): Promise<SteerReport>
  // Whether the tree still changes on its own. A finished owner stops the tree from polling.
  live(): boolean
}
