import { describe, expect, test } from "bun:test"

import {
  type FilePickerActionRequest,
  type FilePickerItem,
  type FilePickerMode,
  type FilePickerProvider,
  type FilePickerSuggestions,
  wrapFilePickerAutocomplete,
} from "./autocomplete"

const signal = new AbortController().signal

class BaseProvider implements FilePickerProvider {
  readonly applied: string[] = []

  async getSuggestions(): Promise<FilePickerSuggestions> {
    return {
      prefix: "@se",
      items: [{ value: "@se-visible.ts", label: "visible.ts" }],
    }
  }

  applyCompletion(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    item: FilePickerItem,
  ): { readonly lines: string[]; readonly cursorLine: number; readonly cursorCol: number } {
    this.applied.push(item.value)
    const nextLines = [...lines]
    nextLines[cursorLine] = `${nextLines[cursorLine] ?? ""}${item.value}`
    return { lines: nextLines, cursorLine, cursorCol: cursorCol + item.value.length }
  }
}

function wrap(
  current: FilePickerProvider,
  mode: FilePickerMode,
  requests: FilePickerActionRequest[],
): FilePickerProvider {
  return wrapFilePickerAutocomplete(current, {
    getMode: () => mode,
    searchFiles: async () => [{ value: "@se-secret.env", label: "secret.env" }],
    openIgnoredFiles: (request) => requests.push(request),
  })
}

describe("native file-picker autocomplete", () => {
  test("#given filtered file suggestions #when the user chooses Show ignored files #then the modal receives the search without editing the draft", async () => {
    // given
    const base = new BaseProvider()
    const requests: FilePickerActionRequest[] = []
    const wrapped = wrap(base, "ignore", requests)

    // when
    const initial = await wrapped.getSuggestions(["@se"], 0, 3, { signal })
    const action = initial?.items.find((item) => item.label === "Show ignored files")
    const applied = action === undefined ? undefined : wrapped.applyCompletion(["@se"], 0, 3, action, "@se")
    await Promise.resolve()

    // then
    expect(initial?.items.map((item) => item.label)).toEqual(["visible.ts", "Show ignored files"])
    expect(applied).toEqual({ lines: ["@se"], cursorLine: 0, cursorCol: 3 })
    expect(requests).toHaveLength(1)
    expect(requests[0]?.visibleItems.map((item) => item.value)).toEqual(["@se-visible.ts"])
    expect(base.applied).toEqual([])
  })

  test("#given text before and after the @ search #when Show ignored files is chosen #then its modal retains the original surrounding draft", async () => {
    // given
    const base = new BaseProvider()
    const requests: FilePickerActionRequest[] = []
    const wrapped = wrap(base, "ask", requests)
    const line = "before @se after"
    const cursorCol = line.indexOf("@se") + 3
    const initial = await wrapped.getSuggestions([line], 0, cursorCol, { signal })

    // when
    const action = initial?.items.find((item) => item.label === "Show ignored files")
    if (action !== undefined) wrapped.applyCompletion([line], 0, cursorCol, action, "@se")
    await Promise.resolve()

    // then
    expect(requests[0]).toMatchObject({
      lines: [line],
      cursorLine: 0,
      cursorCol,
      prefix: "@se",
    })
    expect(requests[0]?.visibleItems.map((item) => item.value)).toEqual(["@se-visible.ts"])
  })

  test("#given the persistent policy includes ignored paths #when the picker opens #then ignored results follow native ranking without a reveal action", async () => {
    // given
    const base = new BaseProvider()
    const requests: FilePickerActionRequest[] = []
    const wrapped = wrap(base, "include", requests)

    // when
    const suggestions = await wrapped.getSuggestions(["@se"], 0, 3, { signal })

    // then
    expect(suggestions?.items.map((item) => item.value)).toEqual(["@se-visible.ts", "@se-secret.env"])
    expect(suggestions?.items.map((item) => item.label)).not.toContain("Show ignored files")
  })
})
