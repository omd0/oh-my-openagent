import { existsSync } from "node:fs"
import { join } from "node:path"

import { withTaskRecordLock } from "../../../store/record-lock"
import { registerStoreIndex, taskStoreIndexPath } from "../store-index"

// Child entrypoint for the rpc-directory permission contract: it owns the umask (the test runner's umask is
// process-global and must not be mutated), then lets the real creator make a directory that does not exist
// yet. Usage: <agentDir> <store-index|sync-lock> [storeDir].
const [agentDir, creator, storeDir = "/p1/.omo/senpi-task"] = process.argv.slice(2)
if (agentDir === undefined || creator === undefined) throw new Error("usage: rpc-dir-child.ts <agentDir> <store-index|sync-lock> [storeDir]")
if (existsSync(join(agentDir, "rpc"))) throw new Error(`refusing to run: ${join(agentDir, "rpc")} already exists`)

process.umask(0o002)
switch (creator) {
  case "store-index":
    await registerStoreIndex({ indexPath: taskStoreIndexPath(agentDir), storeDir, now: Date.now })
    break
  case "sync-lock":
    withTaskRecordLock(join(agentDir, "rpc", "record.json"), () => undefined)
    break
  default:
    throw new Error(`unknown creator: ${creator}`)
}
process.stdout.write("created\n")
