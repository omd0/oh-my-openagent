// QA-only control surface over the REAL native DAG panel feed, loaded into an isolated Senpi run
// with `-e`.
//
// It publishes a fixture graph through the product's own `claimDagPanelFeed` port, so the side panel
// (which subscribes with `subscribeDagPanelFeed` and reads with `readDagPanelFeed`) is exercised as
// shipped. Every stage change republishes and notifies; nothing here renders or knows about the
// screen. In engine mode this extension never claims, so the graph the panel reads is the one the
// real DAG runtime published.
import { appendFileSync } from "node:fs"

import { claimDagPanelFeed, readDagPanelFeed } from "../../src/components/task/dag-panel-feed.ts"
import { STAGES, stageFeed, stageRuns } from "./native-dag-panel-scenarios.mjs"

export default async function register(pi) {
  const receipt = (type, data = {}) => {
    const path = process.env.QA_RECEIPT_PATH
    if (path === undefined || path === "") return
    appendFileSync(path, `${JSON.stringify({ type, at: Date.now(), ...data })}\n`)
  }
  let sessionId
  let disposal
  let owner

  const release = () => {
    disposal?.()
    disposal = undefined
    owner = undefined
  }

  pi.on("session_start", (_payload, ctx) => {
    const next = ctx.sessionManager.getSessionId()
    release()
    sessionId = next
    receipt("qa.session", { sessionId, pid: process.pid })
  })

  pi.registerCommand("qa-dag-feed", {
    description: "QA: publish a native DAG panel feed stage for this session.",
    handler: (args) => {
      const stage = String(args ?? "").trim()
      if (sessionId === undefined) {
        receipt("qa.feed-rejected", { reason: "no-session", stage })
        return
      }
      if (!STAGES.includes(stage)) {
        receipt("qa.feed-rejected", { reason: "unknown-stage", stage })
        return
      }
      // Claim AFTER the panel mounted: the driver types this only once the column is on screen, so
      // the notify below is what makes the graph appear, not the panel's first read.
      release()
      owner = {}
      const claimed = claimDagPanelFeed(sessionId, owner, stageFeed(stage))
      disposal = claimed.dispose
      claimed.notify()
      receipt("qa.feed", { sessionId, stage, runs: stageRuns(stage).length })
    },
  })

  pi.registerCommand("qa-dag-feed-release", {
    description: "QA: release the fixture feed and notify, leaving the session with no graph.",
    handler: () => {
      release()
      receipt("qa.feed-released", { sessionId })
    },
  })

  pi.registerCommand("qa-dag-feed-check", {
    description: "QA: record what the panel's own data port answers. Args: <label> [sessionId].",
    handler: (args) => {
      const [label = "", explicitSession] = String(args ?? "").trim().split(/\s+/)
      const target = explicitSession === undefined || explicitSession === "" ? sessionId : explicitSession
      const feed = target === undefined ? undefined : readDagPanelFeed(target)
      const runs = feed === undefined ? [] : feed.runs()
      receipt("qa.feed-check", {
        label,
        sessionId: target ?? null,
        fixtureClaimed: disposal !== undefined && target === sessionId,
        hasFeed: feed !== undefined,
        runs: runs.map((run) => ({
          runId: run.runId,
          name: run.name,
          status: run.status,
          nodes: run.nodes.map((node) => ({ id: node.id, state: node.state, dependsOn: node.dependsOn })),
          edges: run.edges.map((edge) => `${edge.from}->${edge.to}`),
          activity: Object.fromEntries(run.nodes.map((node) => [node.id, feed.activity(run.runId, node.id) ?? null])),
        })),
      })
    },
  })

  pi.on("session_shutdown", (event) => {
    const reason = typeof event === "object" && event !== null ? Reflect.get(event, "reason") : undefined
    const endedSession = sessionId
    const productFeedVisible = endedSession === undefined ? undefined : readDagPanelFeed(endedSession) !== undefined
    const fixtureClaimed = disposal !== undefined
    release()
    sessionId = undefined
    receipt("qa.shutdown", { reason: reason ?? null, sessionId: endedSession ?? null, productFeedVisible, fixtureClaimed })
  })
}
