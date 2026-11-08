// Keyless scripted provider for the native DAG panel TUI QA.
//
// The TUI needs a model to boot and the panel's own session-driven refresh needs one real turn, so
// this extension answers every parent request. It also records each request's lane and whether the
// request declares the plugin's `workflow` tool, which is how the driver proves the task component
// (the DAG owner) is loaded beside the panel.
import { appendFileSync } from "node:fs"

import { streamMockStep } from "./mock-provider/index.ts"
import { parentAnswer } from "./native-dag-panel-scenarios.mjs"

const MODEL = {
  id: "mock-1",
  name: "Mock 1",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 200_000,
  maxTokens: 4096,
}

const TITLE_TRIGGER = "Generate a concise title"
const TITLE_ANSWER = "QA native DAG panel"
/** Long scrollable answer that seeds transcript scrollback for the chat-wheel isolation proof. */
const SEED_TRIGGER = "seed-transcript"
const SEED_ANSWER = Array.from({ length: 100 }, (_, index) => `seed line ${index}`).join("\n")

function receipt(type, data = {}) {
  const path = process.env.QA_RECEIPT_PATH
  if (path === undefined || path === "") return
  appendFileSync(path, `${JSON.stringify({ type, at: Date.now(), ...data })}\n`)
}

function requestText(context) {
  try {
    return JSON.stringify(context?.messages ?? [])
  } catch {
    return ""
  }
}

/**
 * The prompt THIS request answers: the newest user message's own text, never the whole serialized
 * history. The history keeps every earlier prompt, so keying the seed answer off it made each later
 * request replay the 100-line seed text - which the host's own repetition guard then interrupts - and
 * no later turn could ever render the answer a driver waits for.
 */
export function lastUserPrompt(context) {
  const messages = Array.isArray(context?.messages) ? context.messages : []
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role !== "user") continue
    const content = message.content
    if (typeof content === "string") return content
    if (!Array.isArray(content)) return ""
    return content.map((part) => (typeof part?.text === "string" ? part.text : "")).join("\n")
  }
  return ""
}

export default function registerNativeDagPanelProvider(pi) {
  let callCount = 0
  let parentRequests = 0
  pi.registerProvider("omo-mock", {
    name: "native dag panel mock provider",
    baseUrl: "file://mock-provider",
    apiKey: "mock",
    api: "openai-completions",
    models: [MODEL],
    streamSimple(model, context, options) {
      const text = requestText(context)
      const title = text.includes(TITLE_TRIGGER)
      const seed = !title && lastUserPrompt(context).includes(SEED_TRIGGER)
      callCount += 1
      if (!title) parentRequests += 1
      receipt("qa.provider", { lane: title ? "title" : "parent", parentRequests, seed, declaresWorkflow: text.includes("workflow") })
      // A parent answer names its own request ordinal, so the driver can prove the frame it reads is
      // this turn's answer rather than an identical older one still on screen.
      const answer = seed ? SEED_ANSWER : parentAnswer(parentRequests)
      return streamMockStep({ type: "text", text: title ? TITLE_ANSWER : answer }, callCount, model.id, options)
    },
  })
}
