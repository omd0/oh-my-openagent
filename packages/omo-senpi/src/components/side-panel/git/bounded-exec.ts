import { execFile } from "node:child_process"

import { GIT_TIMEOUT_MS } from "../constants"
import type { PanelExec, PanelExecResult } from "./read"

/** Maximum bytes retained on either stream from one git invocation. */
export const GIT_EXEC_MAX_BUFFER_BYTES = 1024 * 1024

/** Default panel-only git runner. Unlike the host exec seam, this enforces a real output cap. */
export const boundedGitExec: PanelExec = (command, args, options) =>
  new Promise<PanelExecResult>((resolve) => {
    execFile(
      command,
      args,
      {
        cwd: options?.cwd,
        timeout: options?.timeout ?? GIT_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: GIT_EXEC_MAX_BUFFER_BYTES,
        encoding: "utf8",
      },
      (error, stdout) => {
        if (isOutputLimitError(error)) {
          resolve({ stdout: "", code: 1, tooLarge: true })
          return
        }
        const cleanExitCode = typeof error?.code === "number"
        const failed = error !== null && !cleanExitCode
        const output = failed ? "" : typeof stdout === "string" ? stdout : ""
        const code = error === null ? 0 : cleanExitCode && typeof error.code === "number" ? error.code : 1
        resolve({ stdout: output, code, ...(failed ? { failed: true } : {}) })
      },
    )
  })

function isOutputLimitError(error: { readonly code?: string | number } | null): boolean {
  return error?.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
}
