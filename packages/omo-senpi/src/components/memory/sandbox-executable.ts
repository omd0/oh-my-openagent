import { realpathSync, statSync } from "@oh-my-opencode/memory-core/fs"
import { isAbsolute, relative, sep } from "node:path"

const PRIVATE_TMP = "/tmp"

/** Exact read-only file mounts needed when bwrap's private /tmp hides the child executable. */
export function executableVisibilityMounts(
  executable: string,
  writableDirs: readonly string[],
): readonly string[] {
  if (!isAbsolute(executable)) return []

  try {
    const canonical = realpathSync(executable)
    if (!statSync(canonical).isFile()) return []

    const targets = new Set<string>()
    if (isUnderPrivateTmp(executable)) targets.add(executable)
    if (isUnderPrivateTmp(canonical)) targets.add(canonical)

    return [...targets]
      .filter((target) => !writableDirs.some((dir) => containsPath(dir, target)))
      .flatMap((target) => ["--ro-bind", canonical, target])
  } catch {
    return []
  }
}

function isUnderPrivateTmp(path: string): boolean {
  return path === PRIVATE_TMP || path.startsWith(`${PRIVATE_TMP}${sep}`)
}

function containsPath(parent: string, target: string): boolean {
  const path = relative(parent, target)
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path))
}
