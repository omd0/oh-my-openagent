import { closeSync, fstatSync, openSync, readSync, readdirSync } from "node:fs"
import { join } from "node:path"

import { childSessionDir, defaultTranscriptReader } from "@oh-my-opencode/senpi-task"

import type { AgentMessage } from "./subagent-ui/types"

// Structured transcript of one DAG child, for the vendored watch screen. The child's own senpi session
// file keeps messages with their tool calls and tool results, so the upstream renderers get the real
// arguments and results. The read is READ-ONLY and bounded: the same file selection task_output uses
// (the first and last session file), a per-file byte cap, and a tail read for oversized files.
const CHILD_TRANSCRIPT_BYTE_CAP = 4 * 1024 * 1024

export interface ChildTranscript {
  readonly messages: readonly AgentMessage[]
  readonly truncated: boolean
}

export function readChildTranscript(stateDir: string, taskId: string): ChildTranscript {
  const dir = childSessionDir(stateDir, taskId)
  const files = listSessionFiles(dir)
  if (files.length > 0) {
    const selected = files.length <= 2 ? files : [files[0], files.at(-1)].filter((file) => file !== undefined)
    const budget = Math.floor(CHILD_TRANSCRIPT_BYTE_CAP / selected.length)
    const messages: AgentMessage[] = []
    let truncated = selected.length < files.length
    for (const file of selected) {
      const read = readBounded(join(dir, file), budget)
      if (read === undefined) continue
      messages.push(...parseMessages(read.text))
      truncated ||= read.truncated
    }
    if (messages.length > 0) return { messages, truncated }
  }
  // No senpi session file: an in-process child keeps only its event log. Show those rows as text
  // lines, which is the most the event log records; the renderer labels them as plain text.
  const fallback = defaultTranscriptReader({ taskId, stateDir })
  return { messages: fallback.entries.map(entryAsMessage), truncated: fallback.truncated === true }
}

function listSessionFiles(dir: string): readonly string[] {
  try {
    return readdirSync(dir)
      .filter((file) => file.endsWith(".jsonl"))
      .toSorted()
  } catch {
    return []
  }
}

function readBounded(path: string, budget: number): { readonly text: string; readonly truncated: boolean } | undefined {
  let fd: number | undefined
  try {
    fd = openSync(path, "r")
    const size = fstatSync(fd).size
    const truncated = size > budget
    const length = Math.min(size, budget)
    const buffer = Buffer.alloc(length)
    const start = truncated ? size - length : 0
    let bytesRead = 0
    while (bytesRead < length) {
      const count = readSync(fd, buffer, bytesRead, length - bytesRead, start + bytesRead)
      if (count === 0) break
      bytesRead += count
    }
    const text = buffer.subarray(0, bytesRead).toString("utf8")
    if (!truncated) return { text, truncated: false }
    // Oversized: keep the tail, and drop the first (partial) line so every kept line parses.
    const newline = text.indexOf("\n")
    return { text: newline < 0 ? "" : text.slice(newline + 1), truncated: true }
  } catch {
    return undefined
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

// One session line per entry. Only `message` entries carry transcript content; the header and any
// unknown entry types are skipped, and a malformed line is ignored rather than failing the watch.
function parseMessages(text: string): AgentMessage[] {
  const messages: AgentMessage[] = []
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    let entry: unknown
    try {
      entry = JSON.parse(trimmed)
    } catch {
      continue
    }
    if (!isRecord(entry) || entry.type !== "message" || !isRecord(entry.message)) continue
    const message = entry.message
    if (typeof message.role !== "string") continue
    messages.push({ ...message, role: message.role })
  }
  return messages
}

// Event-log entries from an in-process child. Assistant text stays text; a tool row becomes a
// labelled line, and an error becomes the message error the renderer already shows in red.
function entryAsMessage(entry: { readonly kind: string } & Readonly<Record<string, unknown>>): AgentMessage {
  if (entry.kind === "assistant") return { role: "assistant", content: [{ type: "text", text: String(entry.text ?? "") }] }
  if (entry.kind === "tool") {
    const failed = entry.is_error === true ? " (error)" : ""
    return { role: "assistant", content: [{ type: "text", text: `tool: ${String(entry.tool ?? "")}${failed}` }] }
  }
  return { role: "assistant", content: [], errorMessage: String(entry.message ?? "") }
}

function isRecord(value: unknown): value is Record<string, unknown> & { readonly role?: unknown } {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
