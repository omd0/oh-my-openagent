/** Opt-in configuration for the engine-owned Claude subscription SDK route. */

import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { randomUUID } from "node:crypto"
import { setJsoncMember } from "./jsonc-edit.js"
import { parseJsonc } from "./jsonc.js"

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value)
const timestamp = () => new Date().toISOString().replace(/[-:]/g, "")
const pathExists = (path) => {
  try {
    lstatSync(path)
    return true
  } catch (error) {
    if (error.code === "ENOENT") return false
    throw error
  }
}

function targetPath(agentDir) {
  const jsonc = join(agentDir, "settings.jsonc")
  return pathExists(jsonc) ? jsonc : pathExists(join(agentDir, "settings.json")) ? join(agentDir, "settings.json") : jsonc
}

function readPlan(agentDir) {
  const path = targetPath(agentDir)
  const exists = pathExists(path)
  const linkStat = exists ? lstatSync(path) : undefined
  let text
  let document = {}
  if (exists) {
    try {
      text = readFileSync(path, "utf8")
      document = parseJsonc(text)
      if (!isObject(document)) throw new Error("not an object")
    } catch {
      return { path, exists, blocked: true }
    }
  }
  if (Object.hasOwn(document, "anthropicSubscriptionProvider") && !isObject(document.anthropicSubscriptionProvider)) {
    return { path, exists, text, linkStat, blocked: true }
  }
  const provider = document.anthropicSubscriptionProvider ?? {}
  const noop = provider.enabled === true && provider.tokenInjection === "ambient"
  return { path, exists, text, linkStat, realPath: exists ? realpathSync(path) : undefined, mode: exists ? statSync(path).mode & 0o7777 : undefined, noop, blocked: false }
}

function sameTarget(plan) {
  if (pathExists(plan.path) !== plan.exists) return false
  if (!plan.exists) return true
  const now = lstatSync(plan.path)
  if (now.dev !== plan.linkStat.dev || now.ino !== plan.linkStat.ino || now.mode !== plan.linkStat.mode) return false
  if (realpathSync(plan.path) !== plan.realPath) return false
  return readFileSync(plan.path, "utf8") === plan.text
}

function writeSettings(plan, nextText) {
  mkdirSync(dirname(plan.path), { recursive: true, mode: 0o700 })
  const destination = plan.exists ? realpathSync(plan.path) : plan.path
  const temporary = `${destination}.tmp-${process.pid}-${randomUUID()}`
  if (plan.exists) copyFileSync(plan.path, `${plan.path}.bak-${timestamp()}`)
  try {
    writeFileSync(temporary, nextText, { encoding: "utf8", mode: plan.mode ?? 0o600, flag: "wx" })
    if (plan.exists) chmodSync(temporary, plan.mode)
    renameSync(temporary, destination)
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary)
  }
}

/**
 * @param {string} agentDir
 * @param {{ dryRun?: boolean, confirm: (question: string) => Promise<boolean> }} options
 */
export async function setupClaude(agentDir, { dryRun = false, confirm } = {}) {
  const plan = readPlan(agentDir)
  if (plan.blocked) {
    process.stdout.write(`Claude setup refused: ${plan.path} is invalid or has a non-object provider setting; no changes were made.\n`)
    return
  }
  if (plan.noop) {
    process.stdout.write(`Claude subscription setup is already enabled in ${plan.path}. No changes were made.\n`)
    return
  }
  process.stdout.write(`Claude subscription setup will enable the engine's anthropicSubscriptionProvider in ${plan.path}.\n`)
  process.stdout.write("If needed, sign in with `claude auth login` before using this provider. Setup does not check sign-in status.\n")
  process.stdout.write("Authentication stays with the Claude SDK; no login state or tokens will be read, copied, or refreshed.\n")
  process.stdout.write("The current model selection will not change. Choose an anthropic-subscription model after starting omo.\n")
  if (dryRun) {
    process.stdout.write("DRY RUN: no files will be written.\n")
    return
  }
  if (!await confirm(`Enable Claude subscription access in ${plan.path}? [y/N] `)) return
  if (!sameTarget(plan)) {
    process.stdout.write("Claude setup stopped because settings changed after the preview. Run setup again.\n")
    return
  }
  try {
    let next = plan.text ?? "{}\n"
    next = setJsoncMember(next, ["anthropicSubscriptionProvider"], "enabled", true)
    next = setJsoncMember(next, ["anthropicSubscriptionProvider"], "tokenInjection", "ambient")
    writeSettings(plan, next)
    process.stdout.write("Claude subscription setup enabled. Start omo and select an anthropic-subscription model with /model.\n")
  } catch {
    process.stdout.write(`Claude setup could not safely update ${plan.path}; no settings contents were displayed.\n`)
  }
}
