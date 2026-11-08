import { describe, expect, test } from "bun:test"

import { panelActionUrl, parsePanelActionUrl, withActionLink, type PanelAction } from "./links"

const stripLinks = (text: string): string => text.replace(/\u001b\]8;;[^\u0007]*\u0007/g, "")

describe("panel action urls", () => {
  test("#given a file action #when encoded and parsed back #then the path survives verbatim", () => {
    // given
    const action: PanelAction = { kind: "file", path: "packages/omo-senpi/src/a b#c.ts" }

    // when / then
    expect(parsePanelActionUrl(panelActionUrl(action))).toEqual(action)
  })

  test("#given an agent action #when encoded and parsed back #then the id survives verbatim", () => {
    // given
    const action: PanelAction = { kind: "agent", id: "st_01ABC/def" }

    // when / then
    expect(parsePanelActionUrl(panelActionUrl(action))).toEqual(action)
  })

  test("#given goal and memory actions #when round-tripped #then their current-session literal survives", () => {
    // given
    const actions: readonly PanelAction[] = [{ kind: "goal" }, { kind: "memory" }]

    // when
    const parsed = actions.map((action) => parsePanelActionUrl(panelActionUrl(action)))

    // then
    expect(parsed).toEqual([...actions])
  })

  test("#given a value carrying escape bytes #when encoded #then the sequence cannot be ended early", () => {
    // given a raw BEL or ESC would terminate the hyperlink and spill the rest over the row
    const path = "a\u0007b\u001bc"

    // when
    const url = panelActionUrl({ kind: "file", path })

    // then
    expect(url.includes("\u0007")).toBe(false)
    expect(url.includes("\u001b")).toBe(false)
    expect(parsePanelActionUrl(url)).toEqual({ kind: "file", path })
  })

  test("#given a url the host owns #when parsed #then the panel does not claim it", () => {
    // given / when / then
    expect(parsePanelActionUrl("https://example.com/x")).toBeUndefined()
  })

  test("#given an unknown action kind #when parsed #then nothing is claimed", () => {
    // given a future scheme member must not be guessed at
    expect(parsePanelActionUrl("omo-panel:ssh/x")).toBeUndefined()
  })

  test("#given a truncated url #when parsed #then nothing is claimed", () => {
    // given / when / then
    expect(parsePanelActionUrl("omo-panel:file/")).toBeUndefined()
    expect(parsePanelActionUrl("omo-panel:file")).toBeUndefined()
    expect(parsePanelActionUrl("omo-panel:/x")).toBeUndefined()
  })

  test("#given a malformed percent escape #when parsed #then nothing is claimed", () => {
    // given / when / then
    expect(parsePanelActionUrl("omo-panel:file/%zz")).toBeUndefined()
  })

  test("#given painted text #when linked #then the visible text is untouched", () => {
    // when
    const linked = withActionLink("M file.ts", { kind: "file", path: "file.ts" })

    // then
    expect(stripLinks(linked)).toBe("M file.ts")
    expect(linked.startsWith("\u001b]8;;omo-panel:file/file.ts\u0007")).toBe(true)
    expect(linked.endsWith("\u001b]8;;\u0007")).toBe(true)
  })

  test("#given DAG actions whose ids carry separators, control bytes and Unicode #when round-tripped #then every id survives verbatim", () => {
    // given: run and node ids are arbitrary engine strings, not path-safe tokens
    const actions: readonly PanelAction[] = [
      { kind: "dag-run", runId: "run/with:separators" },
      { kind: "dag-node", runId: "run/with:separators", nodeId: "node\u0007\u001b[31m변경/단계" },
      { kind: "dag-node", runId: "run \"quoted\"", nodeId: "node \"quoted\"" },
    ]

    // when
    const urls = actions.map((action) => panelActionUrl(action))

    // then
    for (const url of urls) {
      expect(url.includes("\u0007")).toBe(false)
      expect(url.includes("\u001b")).toBe(false)
    }
    expect(urls.map((url) => parsePanelActionUrl(url))).toEqual([...actions])
  })

  test("#given a DAG url whose payload is not exactly the expected id list #when parsed #then the panel refuses to guess", () => {
    // given / when / then
    expect(parsePanelActionUrl("omo-panel:dag-run/%5B%5D")).toBeUndefined()
    expect(parsePanelActionUrl(`omo-panel:dag-run/${encodeURIComponent(JSON.stringify(["a", "b"]))}`)).toBeUndefined()
    expect(parsePanelActionUrl(`omo-panel:dag-node/${encodeURIComponent(JSON.stringify(["a"]))}`)).toBeUndefined()
    expect(parsePanelActionUrl(`omo-panel:dag-node/${encodeURIComponent(JSON.stringify(["a", "b", "c"]))}`)).toBeUndefined()
    expect(parsePanelActionUrl(`omo-panel:dag-node/${encodeURIComponent(JSON.stringify(["a", ""]))}`)).toBeUndefined()
    expect(parsePanelActionUrl(`omo-panel:dag-node/${encodeURIComponent(JSON.stringify(["a", 2]))}`)).toBeUndefined()
    expect(parsePanelActionUrl(`omo-panel:dag-run/${encodeURIComponent(JSON.stringify("a"))}`)).toBeUndefined()
    expect(parsePanelActionUrl(`omo-panel:dag-run/${encodeURIComponent(JSON.stringify({ runId: "a" }))}`)).toBeUndefined()
    expect(parsePanelActionUrl("omo-panel:dag-run/not-json")).toBeUndefined()
  })

  test("#given the Changes expansion actions #when round-tripped #then only the current literal is accepted", () => {
    // given
    const actions: readonly PanelAction[] = [{ kind: "files-more" }, { kind: "files-less" }]

    // when
    const parsed = actions.map((action) => parsePanelActionUrl(panelActionUrl(action)))

    // then
    expect(parsed).toEqual([...actions])
    expect(parsePanelActionUrl("omo-panel:files-more/other")).toBeUndefined()
    expect(parsePanelActionUrl("omo-panel:files-less/other")).toBeUndefined()
    expect(parsePanelActionUrl("omo-panel:files-more/")).toBeUndefined()
  })

  test("#given an empty value after the kind #when parsed #then nothing is claimed", () => {
    // given / when / then
    expect(parsePanelActionUrl("omo-panel:goal/")).toBeUndefined()
    expect(parsePanelActionUrl("omo-panel:memory/")).toBeUndefined()
    expect(parsePanelActionUrl("omo-panel:agent/")).toBeUndefined()
  })
})
