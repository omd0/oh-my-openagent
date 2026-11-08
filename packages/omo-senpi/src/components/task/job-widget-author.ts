import type { OmoConfig } from "@oh-my-opencode/omo-config-core"
import { resolveCategory, type SenpiModelPort, type SenpiModelRegistryPort } from "@oh-my-opencode/senpi-task"

import type { JobWidgetAuthorContext, JobWidgetHostApi } from "./job-widget-host"

const JOB_WIDGET_AUTHOR_CATEGORY = "quick"

export function resolveJobWidgetAuthorModel(
  omoConfig: OmoConfig,
  registry: SenpiModelRegistryPort<SenpiModelPort>,
): SenpiModelPort | undefined {
  const resolution = resolveCategory(JOB_WIDGET_AUTHOR_CATEGORY, omoConfig, registry)
  return resolution.kind === "resolved" ? resolution.spec.model : undefined
}

type AuthorConfig = {
  readonly cwd: string
  readonly resolveSessionId: () => string | undefined
  omoConfig: OmoConfig
}

type AuthorRoute = { readonly configs: AuthorConfig[]; withdraw: (() => void) | undefined }

export interface JobWidgetAuthorRouteRelease {
  (): void
  update(omoConfig: OmoConfig): void
}

// senpi keeps ONE author route per host while a shared daemon runs many sessions. Match by session
// identity because two sessions in one project can select different routing profiles; cwd is only
// the legacy fallback when the host supplies no session id. The route is withdrawn when the last
// session on that host releases it.
const routes = new WeakMap<JobWidgetHostApi, AuthorRoute>()

function routeAuthor(configs: readonly AuthorConfig[], ctx: JobWidgetAuthorContext): SenpiModelPort | undefined {
  const sessionId = ctx.sessionManager?.getSessionId()
  const config = sessionId === undefined
    ? configs.findLast((entry) => entry.cwd === ctx.cwd)
    : configs.findLast((entry) => entry.resolveSessionId() === sessionId)
  return config === undefined ? undefined : resolveJobWidgetAuthorModel(config.omoConfig, ctx.modelRegistry)
}

export function installJobWidgetAuthor(
  host: JobWidgetHostApi,
  cwd: string,
  omoConfig: OmoConfig,
  resolveSessionId: () => string | undefined = () => undefined,
): JobWidgetAuthorRouteRelease {
  const setAuthorResolver = host.setAuthorResolver
  if (setAuthorResolver === undefined) {
    return Object.assign(() => {}, { update: (_nextConfig: OmoConfig) => {} })
  }
  let route = routes.get(host)
  if (route === undefined) {
    route = { configs: [], withdraw: undefined }
    routes.set(host, route)
  }
  const config: AuthorConfig = { cwd, omoConfig, resolveSessionId }
  route.configs.push(config)
  const configs = route.configs
  route.withdraw ??= setAuthorResolver((ctx) => routeAuthor(configs, ctx))
  let released = false
  const owned = route
  return Object.assign(() => {
    if (released) return
    released = true
    owned.configs.splice(owned.configs.indexOf(config), 1)
    if (owned.configs.length > 0) return
    owned.withdraw?.()
    owned.withdraw = undefined
  }, {
    update: (nextConfig: OmoConfig) => {
      if (!released) config.omoConfig = nextConfig
    },
  })
}
