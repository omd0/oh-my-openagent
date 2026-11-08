import type { OmoConfig } from "@oh-my-opencode/omo-config-core"
import type { SenpiOmoConfigResult } from "../config-resolution"

export const TASK_ROUTING_PROFILE_ENTRY = "omo-senpi.task-routing-profile"

export type TaskRoutingProfileOverride =
  | { readonly found: false }
  | { readonly found: true; readonly profile: string | undefined }

export function listTaskRoutingProfiles(loaded: SenpiOmoConfigResult): readonly string[] {
  const names = new Set<string>()
  for (const layer of loaded.layers) {
    const profiles = layer.config["profiles"]
    if (typeof profiles !== "object" || profiles === null || Array.isArray(profiles)) continue
    for (const name of Object.keys(profiles)) names.add(name)
  }
  return [...names].sort()
}

export function projectTaskRoutingConfig(base: OmoConfig, routed: OmoConfig): OmoConfig {
  return {
    ...base,
    ...(routed.categories === undefined ? {} : { categories: routed.categories }),
    ...(routed.agents === undefined ? {} : { agents: routed.agents }),
  }
}

export function readTaskRoutingProfileOverride(context: unknown): TaskRoutingProfileOverride {
  if (typeof context !== "object" || context === null || !("sessionManager" in context)) return { found: false }
  const sessionManager = context.sessionManager
  if (typeof sessionManager !== "object" || sessionManager === null || !("getBranch" in sessionManager)) return { found: false }
  const getBranch = sessionManager.getBranch
  if (typeof getBranch !== "function") return { found: false }
  const branch: unknown = getBranch.call(sessionManager)
  if (!Array.isArray(branch)) return { found: false }
  const entries: readonly unknown[] = branch
  let override: TaskRoutingProfileOverride = { found: false }
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null || !("customType" in entry) ||
      entry.customType !== TASK_ROUTING_PROFILE_ENTRY || !("data" in entry)) continue
    const data = entry.data
    if (typeof data !== "object" || data === null || !("profile" in data)) continue
    const profile = data.profile
    if (typeof profile === "string") override = { found: true, profile }
    else if (profile === null) override = { found: true, profile: undefined }
  }
  return override
}
