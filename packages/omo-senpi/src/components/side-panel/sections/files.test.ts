import { describe, expect, test } from "bun:test"

import { visibleWidth } from "../format/truncate"
import { mergeGitDeltas, parseNumstatZ, parsePorcelainZ } from "../git/parse"
import { createPanelBody } from "../body"
import { MAX_CHANGE_ROWS, buildChangesRows, buildFileRows } from "./files"

const SGR = "\x1b\\[[0-9;]*m"
const stripSgr = (line: string): string => line.replace(new RegExp(SGR, "g"), "")
const stripLinks = (line: string): string => line.replace(/\x1b\]8;;[^\x07]*\x07/g, "")
const linkUrls = (line: string): string[] =>
  [...line.matchAll(/\x1b\]8;;([^\x07]*)\x07/g)].map((match) => match[1] ?? "").filter((url) => url !== "")

const STATUS =
  " D gone.txt\u0000R  renamed-new.txt\u0000renamed.txt\u0000 M tracked.txt\u0000M  with space.txt\u0000?? brand-new.txt\u0000"
const UNSTAGED = "0\t1\tgone.txt\u00002\t1\ttracked.txt\u0000"
const STAGED = "0\t0\t\u0000renamed.txt\u0000renamed-new.txt\u00001\t0\twith space.txt\u0000"

const status = () => ({
  root: "/repo",
  files: mergeGitDeltas(parsePorcelainZ(STATUS), parseNumstatZ(UNSTAGED), parseNumstatZ(STAGED)),
})

const texts = (rows: readonly { text: string }[]): string[] => rows.map((row) => row.text)

describe("buildFileRows", () => {
  test("#given a real working copy #when built #then every state renders with its columns and deltas", () => {
    // given
    const git = status()

    // when
    const rows = texts(buildFileRows(git, 40, 8))

    // then: counts sit flush right in the row width
    expect(rows).toEqual([
      "FILES  5 changed",
      " D gone.txt                        +0/-1",
      "R  renamed-new.txt                 +0/-0",
      " M tracked.txt                     +2/-1",
      "M  with space.txt                  +1/-0",
      "?? brand-new.txt",
    ])
  })

  test("#given rows with counts #when built #then every delta ends on the same right edge", () => {
    // given
    const git = status()

    // when
    const rows = buildFileRows(git, 40, 8).slice(1, 5)

    // then
    for (const row of rows) expect(visibleWidth(row.text)).toBe(40)
    expect(rows[0]?.text.endsWith("+0/-1")).toBe(true)
    expect(rows[1]?.text.endsWith("+0/-0")).toBe(true)
    expect(rows[2]?.text.endsWith("+2/-1")).toBe(true)
    expect(rows[3]?.text.endsWith("+1/-0")).toBe(true)
  })

  test("#given per-part colours #when built #then each span covers its own cells with its own style", () => {
    // given one unstaged edit with known counts; the row is ASCII so span columns are string indices
    const git = { root: "/repo", files: [{ xy: " M", path: "tracked.ts", added: 5, removed: 7 }] }

    // when
    const [row] = buildFileRows(git, 40, 8).slice(1)

    // then: status, name, additions and removals each own their cells — no span borrows another's
    const text = row?.text ?? ""
    const covered = (start: number, end: number): string => text.slice(start, end)
    expect(covered(0, 2)).toBe(" M")
    expect(covered(3, 13)).toBe("tracked.ts")
    expect(covered(text.indexOf("+5"), text.indexOf("+5") + 2)).toBe("+5")
    expect(covered(text.indexOf("-7"), text.indexOf("-7") + 2)).toBe("-7")
    const styleAt = (start: number): unknown => row?.styles?.find((span) => span.start === start)?.style
    expect(styleAt(0)).toMatchObject({ ansi256: expect.any(Number) })
    expect(styleAt(3)).toMatchObject({ ansi256: expect.any(Number) })
    // Additions and removals split: two distinct palette styles, never the same cell colour
    expect(styleAt(text.indexOf("+5"))).toMatchObject({ ansi256: expect.any(Number) })
    expect(styleAt(text.indexOf("-7"))).toMatchObject({ ansi256: expect.any(Number) })
    expect(styleAt(text.indexOf("+5"))).not.toEqual(styleAt(text.indexOf("-7")))
  })

  test("#given file rows #when painted by the column #then additions wrap green and removals red at their cells", () => {
    // given one unstaged edit; the SGR bytes below are the terminal-observable contract —
    // yellow status/name, green additions, red removals — while the bin table stays owned elsewhere
    const git = { root: "/repo", files: [{ xy: " M", path: "tracked.ts", added: 5, removed: 7 }] }
    const [row] = buildFileRows(git, 40, 8).slice(1)
    const width = visibleWidth(row?.text ?? "") + 2
    const body = createPanelBody(
      { rows: () => (row === undefined ? [] : [row]) },
      () => ({ fg: (_color: string, text: string) => text }),
      () => true,
    )

    // when
    const [line = ""] = body.render(width)

    // then: each SGR run wraps exactly its own cells, and the click still carries the real path
    expect(line).toContain("\x1b[38;5;178m M\x1b[39m")
    expect(line).toContain("\x1b[38;5;71m+5\x1b[39m")
    expect(line).toContain("\x1b[38;5;167m-7\x1b[39m")
    expect(stripSgr(stripLinks(line))).toBe(` ${row?.text ?? ""} `)
    // Every painted run links separately, but all of them resolve to the file's own action.
    const urls = linkUrls(line)
    expect(urls.length).toBeGreaterThan(0)
    expect([...new Set(urls)]).toEqual(["omo-panel:file/tracked.ts"])
  })

  test("#given a huge change #when built #then the warning marker sits before the compacted counts", () => {
    // given a file at 110k lines: over the ordinary-number range
    const git = { root: "/repo", files: [{ xy: " M", path: "big.ts", added: 60000, removed: 50000 }] }

    // when
    const rows = buildFileRows(git, 40, 8)

    // then
    expect(rows[1]?.text).toBe(" M big.ts                huge  +60k/-50k")
    expect(visibleWidth(rows[1]?.text ?? "")).toBe(40)
  })

  test("#given a name wider than its room #when built #then it ends with two dots and keeps the click", () => {
    // given the column is too narrow for the full basename
    const git = { root: "/repo", files: [{ xy: " M", path: "packages/omo-senpi/src/very-long-file-name.ts", added: 1, removed: 1 }] }

    // when
    const rows = buildFileRows(git, 24, 8)

    // then
    expect(rows[1]?.text).toContain("..")
    expect(rows[1]?.text.endsWith("+1/-1")).toBe(true)
    expect(visibleWidth(rows[1]?.text ?? "")).toBe(24)
    expect(rows[1]?.action).toEqual({ kind: "file", path: "packages/omo-senpi/src/very-long-file-name.ts" })
  })

  test("#given a wide-character name #when built #then cells hold and the row keeps its width", () => {
    // given CJK cells draw two columns each and must be kept or dropped whole
    const git = { root: "/repo", files: [{ xy: " M", path: "あいうえおfile.ts", added: 1, removed: 1 }] }

    // when
    const rows = buildFileRows(git, 24, 8)

    // then
    expect(visibleWidth(rows[1]?.text ?? "")).toBe(24)
    expect(rows[1]?.text.endsWith("+1/-1")).toBe(true)
  })

  test("#given almost no room #when built #then the counts survive and spans are clipped to them", () => {
    // given a viewport that cannot hold status, name and counts together
    const git = { root: "/repo", files: [{ xy: " M", path: "longfilename.ts", added: 5, removed: 7 }] }

    // when
    const narrow = buildFileRows(git, 6, 8)[1]

    // then: the numeric counts come last and are cut only when the viewport cannot hold them
    expect(narrow?.text).toBe(" +5/-7")
    expect(visibleWidth(narrow?.text ?? "")).toBeLessThanOrEqual(6)
    for (const span of narrow?.styles ?? []) expect(span.end).toBeLessThanOrEqual(visibleWidth(narrow?.text ?? ""))
    expect(narrow?.action).toEqual({ kind: "file", path: "longfilename.ts" })
  })

  test("#given more files than the row limit #when built #then only the first rows are kept", () => {
    // given a diff past the column's safety cap
    const many = Array.from({ length: MAX_CHANGE_ROWS + 100 }, (_, index) => ({ xy: " M", path: `f${index}.ts`, added: 1, removed: 1 }))
    const git = { root: "/repo", files: many }

    // when
    const rows = buildFileRows(git, 40, many.length)

    // then
    expect(rows).toHaveLength(MAX_CHANGE_ROWS + 1)
    expect(rows[0]?.text).toBe(`FILES  ${MAX_CHANGE_ROWS + 100} changed · +100 more`)
  })

  test("#given more files than the cap #when built #then the rest is counted in the heading", () => {
    // given
    const git = status()

    // when
    const rows = texts(buildFileRows(git, 40, 2))

    // then
    expect(rows[0]).toBe("FILES  5 changed · +3 more")
    expect(rows).toHaveLength(3)
  })

  test("#given each state #when built #then untracked is dim, staged reads done, unstaged in flight", () => {
    // given
    const git = status()

    // when
    const rows = buildFileRows(git, 40, 8).slice(1)

    // then
    expect(rows.find((row) => row.text.startsWith("??"))?.color).toBe("dim")
    expect(rows.find((row) => row.text.startsWith("M "))?.color).toBe("success")
    expect(rows.find((row) => row.text.startsWith(" M"))?.color).toBe("text")
  })

  test("#given a merge conflict #when built #then the row is loud", () => {
    // given
    const git = { root: "/repo", files: [{ xy: "UU", path: "conflict.ts" }] }

    // when
    const rows = buildFileRows(git, 40, 8)

    // then
    expect(rows[1]?.color).toBe("error")
  })

  test("#given a clean working copy #when built #then the section stays empty", () => {
    // given
    const git = { root: "/repo", files: [] }

    // when
    const rows = buildFileRows(git, 40, 8)

    // then
    expect(rows).toEqual([])
  })

  test("#given a deep path #when built #then only the file name is shown", () => {
    // given
    const git = { root: "/repo", files: [{ xy: " M", path: "packages/omo-senpi/src/index.ts" }] }

    // when
    const rows = texts(buildFileRows(git, 40, 8))

    // then
    expect(rows[1]).toBe(" M index.ts")
  })

  test("#given an untracked directory #when built #then its trailing slash remains visible", () => {
    // given
    const git = { root: "/repo", files: [{ xy: "??", path: "build/" }] }

    // when
    const rows = texts(buildFileRows(git, 40, 8))

    // then
    expect(rows[1]).toBe("?? build/")
  })
})

describe("buildChangesRows", () => {
  test("#given a fully known large list #when collapsed #then the warning names the exact total", () => {
    // given
    const many = Array.from({ length: MAX_CHANGE_ROWS + 100 }, (_, index) => ({ xy: " M", path: `f${index}.ts`, added: 1, removed: 1 }))
    const git = { root: "/repo", files: many }

    // when
    const rows = texts(buildChangesRows(git, 80, { preview: 5, expanded: false, expandable: true }))

    // then
    expect(rows[1]).toBe(`Changes too large · ${MAX_CHANGE_ROWS + 100} files`)
    expect(rows).toContain("Show more · +595 more")
  })

  test("#given a fully known large list #when expanded #then the warning names shown, total and omitted", () => {
    // given
    const many = Array.from({ length: MAX_CHANGE_ROWS + 100 }, (_, index) => ({ xy: " M", path: `f${index}.ts`, added: 1, removed: 1 }))
    const git = { root: "/repo", files: many }

    // when
    const built = buildChangesRows(git, 80, { preview: 5, expanded: true, expandable: true })
    const rows = texts(built)

    // then
    expect(rows[1]).toBe("Show less")
    expect(rows[2]).toBe(`Changes too large · showing 500 of ${MAX_CHANGE_ROWS + 100}, 100 omitted`)
    // The cap bounds real file actions — not just the warning text — and nothing is silently dropped
    expect(built).toHaveLength(MAX_CHANGE_ROWS + 3)
    expect(built.filter((row) => row.action?.kind === "file")).toHaveLength(MAX_CHANGE_ROWS)
    expect(rows[0]).toBe(`FILES  ${MAX_CHANGE_ROWS + 100} changed`)
  })

  test("#given a refused list with retained files #when built #then only the retained count is claimed", () => {
    // given the reader refused or capped the list, so no total exists
    const git = {
      root: "/repo",
      files: [
        { xy: " M", path: "a.ts", added: 1, removed: 2 },
        { xy: " M", path: "b.ts", added: 3, removed: 4 },
      ],
      tooLarge: true,
    }

    // when
    const rows = texts(buildChangesRows(git, 80, { preview: 1, expanded: false, expandable: true }))

    // then: no exact total, no omitted count — the retained count is the only fact
    expect(rows[0]).toBe("FILES  2+ changed")
    expect(rows[1]).toBe("Changes too large · 2 files retained, total unknown")
    expect(rows.join("\n")).not.toContain("omitted")
    expect(rows).toContain("Show more · 1 retained")
  })

  test("#given a refused list with nothing retained #when built #then the warning says there is no list", () => {
    // given
    const git = { root: "/repo", files: [], tooLarge: true }

    // when
    const rows = texts(buildChangesRows(git, 80, { preview: 3, expanded: false, expandable: true }))

    // then: an empty refused list must not read as "0 changed"
    expect(rows).toEqual(["FILES", "Changes too large · no file list"])
  })

  test("#given expandable changes #when built #then Show more and Show less carry panel actions", () => {
    // given
    const git = { root: "/repo", files: [{ xy: " M", path: "a.ts", added: 1, removed: 1 }, { xy: " M", path: "b.ts", added: 1, removed: 1 }] }

    // when
    const collapsed = buildChangesRows(git, 80, { preview: 1, expanded: false, expandable: true })
    const expanded = buildChangesRows(git, 80, { preview: 1, expanded: true, expandable: true })

    // then
    expect(collapsed.find((row) => row.text.startsWith("Show more"))?.action).toEqual({ kind: "files-more" })
    expect(expanded.find((row) => row.text === "Show less")?.action).toEqual({ kind: "files-less" })
    // File rows keep their diff action in both views.
    expect(expanded.filter((row) => row.action?.kind === "file")).toHaveLength(2)
  })
})

describe("buildFileRows clicks", () => {
  test("#given a nested path #when built #then the row shows the basename and the click carries the path", () => {
    // given the column is narrow, so the row cannot show what the action needs
    const status = { root: "/repo", files: [{ xy: " M", path: "packages/omo-senpi/src/a.ts" }] }

    // when
    const rows = buildFileRows(status, 40, 8)

    // then
    expect(rows[1]?.text).toContain("a.ts")
    expect(rows[1]?.text).not.toContain("packages/")
    expect(rows[1]?.action).toEqual({ kind: "file", path: "packages/omo-senpi/src/a.ts" })
  })

  test("#given the section heading #when built #then it is not clickable", () => {
    // given
    const status = { root: "/repo", files: [{ xy: "??", path: "new.txt" }] }

    // when
    const rows = buildFileRows(status, 40, 8)

    // then
    expect(rows[0]?.action).toBeUndefined()
  })
})
