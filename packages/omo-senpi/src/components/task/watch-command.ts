import type { WatchHolder, WatchUi } from "./watch-mount"
import { mountSubagentWatch } from "./watch-mount"
import type { ThreadService } from "./subagent-ui/types"

export interface UnifiedWatchSeam {
  readonly holder: WatchHolder
  createWatch(parentSessionId: string, stillBound: () => boolean): { readonly service: ThreadService }
}

export interface WatchCommandContext {
  readonly ui?: WatchUi
  readonly mode?: string
  readonly sessionManager?: { getSessionId(): string | undefined }
}

export function registerWatchCommand(
  registerCommand: (name: string, options: { description: string; handler: (args: string, ctx: WatchCommandContext) => Promise<void> }) => void,
  seam: UnifiedWatchSeam,
): void {
  registerCommand("watch", {
    description: "Watch tasks and workflow DAGs in this session.",
    handler: async (_args: string, ctx: WatchCommandContext): Promise<void> => {
      const ui = ctx.ui
      if (ui === undefined) return
      const parentId = ctx.sessionManager?.getSessionId()
      if (parentId === undefined) {
        ui.notify("Watch needs this session's identity, so there is nothing to show.", "warning")
        return
      }
      const interactive = ctx.mode === undefined || ctx.mode === "tui"
      if (!interactive || ui.custom === undefined) {
        ui.notify("Live watching needs the interactive terminal UI. Use /tasks to list tasks.", "info")
        return
      }
      if (seam.holder.current !== undefined) {
        ui.notify("A watch is already open.", "info")
        return
      }
      const stillBound = (): boolean => ctx.sessionManager?.getSessionId() === parentId
      const watchSet = seam.createWatch(parentId, stillBound)
      const rows = watchSet.service.list()
      if (rows.length === 0) {
        ui.notify("No tasks or workflows in this session. /tasks --all lists every session's tasks.", "info")
        return
      }
      await mountSubagentWatch(seam.holder, {
        ui,
        service: watchSet.service,
        parentId,
        currentParentId: () => ctx.sessionManager?.getSessionId(),
      })
    },
  })
}
