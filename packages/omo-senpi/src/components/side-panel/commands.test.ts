import { describe, expect, test } from "bun:test"

import { openFileDiff, runDiffCommand, type PanelCommandContext } from "./commands"
import { DIFF_VIEWER_ROW_CAP } from "./constants"
import type { PanelExec } from "./git/read"
import type { PanelGitStatus } from "./sections/files"
import type { PanelPopupFactory } from "./types"

const DIFF = "diff --git a/tracked.txt b/tracked.txt\n@@ -1 +1 @@\n-old\n+new"

const status = (): PanelGitStatus => ({
  root: "/repo",
  files: [
    { xy: " M", path: "tracked.txt", added: 2, removed: 1 },
    { xy: "??", path: "brand-new.txt" },
  ],
})

interface Harness {
  readonly notices: Array<{ message: string; type: string | undefined }>
  readonly selected: string[]
  readonly popupRows: string[][]
  readonly closes: number[]
  run(): Promise<void>
}

function harness(options: {
  status?: () => PanelGitStatus | undefined
  exec?: PanelExec
  choose?: (options: string[]) => string | undefined
  withCustom?: boolean
  noExec?: boolean
  mounted?: boolean
} = {}): Harness {
  const notices: Array<{ message: string; type: string | undefined }> = []
  const selected: string[] = []
  const popupRows: string[][] = []
  const closes: number[] = []
  const exec: PanelExec = options.exec ?? (async () => ({ stdout: DIFF, code: 0 }))
  const deps = {
    status: options.status ?? status,
    exec: options.noExec === true ? undefined : exec,
    mounted: () => options.mounted ?? true,
  }
  const ui = {
    notify(message: string, type?: string) {
      notices.push({ message, type })
    },
    async select(_title: string, choices: string[]) {
      selected.push(...choices)
      return options.choose === undefined ? choices[0] : options.choose(choices)
    },
    ...(options.withCustom === false
      ? {}
      : {
          async custom(factory: PanelPopupFactory) {
            const tui = { terminal: { rows: 50 }, requestRender: () => {} }
            const component = factory(tui, undefined, undefined, () => closes.push(1)) as {
              render(width: number): string[]
              handleInput(data: string): void
            }
            popupRows.push(component.render(60))
            component.handleInput("\x1b")
            return undefined
          },
        }),
  }
  return {
    notices,
    selected,
    popupRows,
    closes,
    run: async () => {
      const handler = (_args: string, ctx: PanelCommandContext): Promise<void> => runDiffCommand(deps, ctx)
      await handler("", { mode: "tui", ui })
    },
  }
}

describe("side panel diff command", () => {
  test("#given changed files #when run #then the selector lists them with their columns and deltas", async () => {
    // given
    const test = harness()

    // when
    await test.run()

    // then
    expect(test.selected).toEqual([" M tracked.txt  +2/-1", "?? brand-new.txt"])
  })

  test("#given a chosen file #when run #then its diff is shown in a framed popup", async () => {
    // given
    const test = harness()

    // when
    await test.run()

    // then
    const painted = test.popupRows[0] ?? []
    expect(painted[0]?.startsWith("┌")).toBe(true)
    expect(painted.some((line) => line.includes("tracked.txt  (diff, read-only)"))).toBe(true)
    expect(painted.some((line) => line.includes("+new"))).toBe(true)
    expect(painted[painted.length - 1]?.startsWith("└")).toBe(true)
  })

  test("#given the popup is open #when escape is pressed #then it closes", async () => {
    // given
    const test = harness()

    // when
    await test.run()

    // then
    expect(test.closes).toEqual([1])
  })

  test("#given a clean working copy #when run #then it says so instead of opening an empty popup", async () => {
    // given
    const test = harness({ status: () => ({ root: "/repo", files: [] }) })

    // when
    await test.run()

    // then
    expect(test.notices).toEqual([{ message: "No changes in the working copy.", type: "info" }])
    expect(test.popupRows).toEqual([])
  })

  test("#given the panel is not mounted in this session #when run #then it says the panel is off", async () => {
    // given
    const test = harness({ mounted: false })

    // when
    await test.run()

    // then
    expect(test.notices).toEqual([{ message: "The side panel is off in this session.", type: "info" }])
    expect(test.popupRows).toEqual([])
  })

  test("#given the selector is dismissed #when run #then nothing is opened", async () => {
    // given
    const test = harness({ choose: () => undefined })

    // when
    await test.run()

    // then
    expect(test.popupRows).toEqual([])
    expect(test.notices).toEqual([])
  })

  test("#given a host without the overlay seam #when run #then the diff is still delivered", async () => {
    // given
    const test = harness({ withCustom: false })

    // when
    await test.run()

    // then
    expect(test.notices[0]?.message).toContain("+new")
  })

  test("#given a host without exec #when run #then it says git cannot be run", async () => {
    // given
    const test = harness({ noExec: true })

    // when
    await test.run()

    // then
    expect(test.notices).toEqual([{ message: "This host exposes no exec, so git cannot be run.", type: "warning" }])
    expect(test.selected).toEqual([])
  })
})

describe("side panel diff command hardening", () => {
  test("#given a file name carrying terminal controls #when the picker lists it #then the label carries none of them", async () => {
    // given: the host's select list folds newlines only
    const test = harness({ status: () => ({ root: "/repo", files: [{ xy: "??", path: "evil\x1b]8;;x\x07\u202ename.txt" }] }) })

    // when
    await test.run()

    // then
    expect(test.selected).toEqual(["?? evil]8;;xname.txt"])
  })

  test("#given a diff longer than the viewer holds #when opened #then it is refused as too large", async () => {
    // given: the viewer no longer truncates; the diff layer refuses before any split
    const diff = Array.from({ length: DIFF_VIEWER_ROW_CAP + 3 }, (_, index) => "+line " + index).join("\n")
    const test = harness({ withCustom: false, exec: async () => ({ stdout: diff, code: 0 }) })

    // when
    await test.run()

    // then
    expect(test.notices).toHaveLength(1)
    expect(test.notices[0]?.message).toContain("Changes too large")
    expect(test.notices[0]?.type).toBe("info")
  })

  test("#given more changed files than the selector holds #when run #then only the first 500 are listed with the rest counted", async () => {
    // given
    const files = Array.from({ length: 502 }, (_, index) => ({ xy: " M", path: `f${index}.txt` }))
    const test = harness({ status: () => ({ root: "/repo", files }) })

    // when
    await test.run()

    // then
    expect(test.selected).toHaveLength(500)
    expect(test.notices).toEqual([{ message: "Showing 500 of 502 changed files.", type: "info" }])
    expect(test.popupRows[0]?.some((line) => line.includes("f0.txt"))).toBe(true)
  })

  test("#given a path longer than the label budget #when the picker lists it #then the label is bounded and deltas stay compact", async () => {
    // given: one label that must be cut, one short label carrying a large count
    const test = harness({
      status: () => ({
        root: "/repo",
        files: [
          { xy: " M", path: `${"b".repeat(600)}.txt` },
          { xy: " M", path: "src/big.ts", added: 12_345, removed: 678 },
        ],
      }),
      choose: () => undefined,
    })

    // when
    await test.run()

    // then
    expect(test.selected).toHaveLength(2)
    expect(test.selected[0]?.length).toBeLessThanOrEqual(512)
    expect(test.selected[1]).toContain("+12.3k")
  })

  test("#given a status the reader refused #when run #then it says too large without touching git", async () => {
    // given
    let spawns = 0
    const test = harness({
      status: () => ({ root: "/repo", files: [], tooLarge: true }),
      exec: async () => {
        spawns += 1
        return { stdout: "", code: 0 }
      },
    })

    // when
    await test.run()

    // then
    expect(test.notices).toEqual([{ message: "Changes too large", type: "warning" }])
    expect(spawns).toBe(0)
    expect(test.popupRows).toEqual([])
    expect(test.selected).toEqual([])
  })

  test("#given a very long path with terminal controls #when its diff is opened #then git gets the full path while the title stays bounded", async () => {
    // given: the click path carries the real path; only the shown title is cut
    const full = `${"a".repeat(590)}\x1b]8;;x\x07`
    const seen: string[][] = []
    const exec: PanelExec = async (_command, args) => {
      seen.push([...args])
      return { stdout: "+hello", code: 1 }
    }
    const messages: string[] = []
    const ui = {
      notify(message: string) {
        messages.push(message)
      },
    }

    // when
    await openFileDiff(ui, exec, { root: "/repo", files: [] }, { xy: "??", path: full })

    // then
    expect(seen[0]?.at(-1)).toBe(full)
    const title = messages[0]?.split("\n")[0] ?? ""
    expect(title.length).toBeLessThanOrEqual(512)
    expect(title).not.toContain("\x1b")
  })

  test("#given two files whose labels collide at the bound #when the second is chosen #then git diffs the second file", async () => {
    // given: INPUT precondition on the fixtures — paths identical through the
    // whole 512-char label budget, differing only after it. Asserted here, so a
    // fix that disambiguates the labels keeps this test valid.
    const first = `${"p".repeat(600)}-first.txt`
    const second = `${"p".repeat(600)}-second.txt`
    expect(first.slice(0, 512)).toBe(second.slice(0, 512))
    const seen: string[][] = []
    const test = harness({
      status: () => ({
        root: "/repo",
        files: [
          { xy: " M", path: first },
          { xy: " M", path: second },
        ],
      }),
      exec: async (_command, args) => {
        seen.push([...args])
        return { stdout: "+x\n", code: 0 }
      },
      // a reachable entry, never a synthetic string: the second option itself
      choose: (options) => options[1],
    })

    // when
    await test.run()

    // then: options must stay usable as select-string identity — distinct and bounded
    expect(test.selected).toHaveLength(2)
    expect(test.selected.every((label) => label.length <= 512)).toBe(true)
    expect(test.selected[0]).not.toBe(test.selected[1])
    // the chosen entry must open the second file in full, not the first
    expect(seen[0]?.at(-1)).toContain(second)
    expect(seen[0]?.at(-1)).not.toContain(first)
  })
})
