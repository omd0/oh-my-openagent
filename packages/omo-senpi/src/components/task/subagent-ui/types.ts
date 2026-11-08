// Subset of pi-subagent-manager 1.7.0 src/types.ts (MIT, see ./LICENSE and ./PROVENANCE.md).
// Only the view, transcript and service shapes the vendored tree and watch screens read are kept.
// The agent engine types (drivers, managers, spawn options) are not vendored.

export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const
export type ThinkingLevel = (typeof THINKING_LEVELS)[number]

export const LOADER_STYLES = ["circle", "braille", "hourglass", "ascii", "ascii-star", "ascii-pulse"] as const
export type LoaderStyle = (typeof LOADER_STYLES)[number]

export type ThreadState = "starting" | "running" | "paused" | "completed" | "failed" | "stopped"

export interface ChildDiagnostic {
  level: "info" | "warning" | "error"
  message: string
  source?: string
}

export interface ThreadView {
  diagnostics?: ChildDiagnostic[]
  path: string
  parent: string | null
  owner: string
  type: string
  color?: string
  icon?: string
  model?: string
  /** Routing target with resolved model and fallback count (task rows). Absent when unknown. */
  target?: string
  /** Measured run facts such as turn, failed-attempt and throughput tokens. Absent when unmeasured. */
  facts?: readonly string[]
  thinkingLevel?: ThinkingLevel
  state: ThreadState
  task: string
  status: string
  summary?: string
  output?: string
  error?: string
  createdAt: number
  updatedAt: number
  sessionFile?: string
  elapsedMs?: number
  startedAt?: number
  lastStartedAt?: number
  inputTokens?: number
  outputTokens?: number
  costUsd?: number
  costId?: string
}

// Structural stand-in for pi-agent-core's AgentMessage. The renderers read role, content and the
// tool-result fields by name; nothing here depends on the engine package.
export type AgentMessage = { readonly role: string } & Readonly<Record<string, unknown>>

export interface TranscriptToolState {
  toolCallId: string
  toolName: string
  parentToolCallId?: string
  args: unknown
  result?: unknown
  isError?: boolean
  state: "running" | "completed"
}

export interface TranscriptSnapshot {
  revision: number
  generation: number
  messages: readonly AgentMessage[]
  assistant: AgentMessage | null
  tools: readonly TranscriptToolState[]
  inheritedCount: number
  thread?: ThreadView
  error?: string
}

export interface TranscriptObservation {
  snapshot: TranscriptSnapshot
  unsubscribe(): void
}

export type TranscriptListener = (snapshot: TranscriptSnapshot) => void

// The read and steer seam the vendored screens consume. The DAG adapter implements it over the
// owned DAG runtime; no spawn, stop or model/tool editing is offered.
export interface ThreadService {
  list(): ThreadView[]
  observeTranscript(path: string, listener: TranscriptListener): Promise<TranscriptObservation>
  steer(path: string, message?: string, timeoutMs?: number): Promise<ThreadView>
}
