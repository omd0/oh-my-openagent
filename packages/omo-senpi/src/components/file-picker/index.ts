import type { ComponentContext, OmoSenpiComponent, SenpiExtensionAPI } from "../../extension/types"

export function createFilePickerComponent(): OmoSenpiComponent {
  return {
    name: "file-picker",
    register(pi: SenpiExtensionAPI, _ctx: ComponentContext): void {
      if (pi.sessionKind === "worker") return

      pi.on("session_start", async (_payload: unknown, eventContext: unknown) => {
        const { registerFilePickerAutocomplete } = await import("#omo-file-picker-runtime")
        registerFilePickerAutocomplete(pi, eventContext)
      })
    },
  }
}
