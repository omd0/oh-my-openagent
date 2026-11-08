// Source-mode composition for the native DAG panel TUI QA.
//
// Loads the REAL changed components straight from source (the side panel and the task component that
// owns the DAG runtime and its panel feed) instead of the packaged `omo.js`, so a full plugin build
// is not on the critical path for this proof. It registers the same components in the same order the
// packaged entry does for this slice, and nothing else: telemetry, memory, and the other components
// carry no part of the panel's graph path.
import { appendFileSync } from "node:fs"

import { createSidePanelComponent } from "../../src/components/side-panel/index.ts"
import { createTaskComponent } from "../../src/components/task/index.ts"

const log = (level, message, details) => {
  const path = process.env.QA_PLUGIN_LOG
  const line = `${JSON.stringify({ level, message, ...(details === undefined ? {} : { details }) })}\n`
  if (path === undefined || path === "") return
  try {
    appendFileSync(path, line)
  } catch {
    // a log write must never hold the extension
  }
}

const logger = {
  debug: (message, details) => log("debug", message, details),
  info: (message, details) => log("info", message, details),
  warn: (message, details) => log("warn", message, details),
  error: (message, details) => log("error", message, details),
}

export default async function registerNativeDagPanelSourcePlugin(pi) {
  const ctx = { logger, config: { getFlag: (name) => pi.getFlag(name) } }
  log("info", "source plugin: registering the side panel")
  createSidePanelComponent().register(pi, ctx)
  log("info", "source plugin: registering the task component")
  await createTaskComponent().register(pi, ctx)
  log("info", "source plugin: registered")
}
