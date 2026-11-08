import { defaultTranscriptReader, renderTranscript } from "@oh-my-opencode/senpi-task"

// A child's transcript, read through the same reader and renderer `task_output` uses. Both readers
// bound their source, and renderTranscript caps the joined text, so one refresh cannot grow without
// limit. An unreadable or absent transcript is a state the viewer shows, never a throw into the timer.
// `note` explains what is shown instead of a live transcript (pending node, saved output preview).
export type WatchTranscript =
  | {
      readonly kind: "ok"
      readonly lines: readonly string[]
      readonly truncated: boolean
      readonly recorded: boolean
      readonly note?: string
    }
  | { readonly kind: "error"; readonly message: string }

export function readWatchTranscript(stateDir: string, taskId: string): WatchTranscript {
  try {
    const result = defaultTranscriptReader({ taskId, stateDir })
    const rendered = renderTranscript(result.entries, { mode: "full", tailLines: 0 })
    return { kind: "ok", lines: rendered.text.split("\n"), truncated: rendered.truncated, recorded: result.entries.length > 0 }
  } catch (error) {
    return { kind: "error", message: error instanceof Error ? error.message : String(error) }
  }
}

// The last lines of a transcript, for the read-only fallback where no viewer can open.
export function transcriptTail(transcript: WatchTranscript, count: number): readonly string[] {
  if (transcript.kind !== "ok") return []
  return transcript.lines.slice(Math.max(0, transcript.lines.length - count))
}
