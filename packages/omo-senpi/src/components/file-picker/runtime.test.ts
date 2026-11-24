import { describe, expect, test } from "bun:test"

import type {
  FilePickerActionRequest,
  FilePickerItem,
  FilePickerProvider,
} from "./autocomplete"
import { openIgnoredFilesPicker, type FilePickerUi } from "./runtime"

class CompletionProvider implements FilePickerProvider {
  applied: FilePickerItem | undefined

  async getSuggestions(): Promise<null> {
    return null
  }

  applyCompletion(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    item: FilePickerItem,
    prefix: string,
  ): { readonly lines: string[]; readonly cursorLine: number; readonly cursorCol: number } {
    this.applied = item
    const currentLine = lines[cursorLine] ?? ""
    const tokenStart = cursorCol - prefix.length
    const nextLine = `${currentLine.slice(0, tokenStart)}${item.value} ${currentLine.slice(cursorCol)}`
    const nextLines = [...lines]
    nextLines[cursorLine] = nextLine
    return { lines: nextLines, cursorLine, cursorCol: tokenStart + item.value.length + 1 }
  }
}

function actionRequest(): FilePickerActionRequest {
  const line = "before @-probe after"
  const cursorCol = line.indexOf("@-probe") + "@-probe".length
  return {
    lines: [line],
    cursorLine: 0,
    cursorCol,
    prefix: "@-probe",
    visibleItems: [],
  }
}

function pickerUi(options: {
  readonly confirmation: boolean
  readonly selection?: string
  readonly steps: string[]
  readonly written: string[]
  readonly notices: string[]
}): FilePickerUi {
  return {
    addAutocompleteProvider() {},
    async confirm(title) {
      options.steps.push(`confirm:${title}`)
      return options.confirmation
    },
    async select(title) {
      options.steps.push(`select:${title}`)
      return options.selection
    },
    setEditorText(text) {
      options.steps.push("set-editor-text")
      options.written.push(text)
    },
    notify(message) {
      options.notices.push(message)
    },
  }
}

describe("ignored-file picker modal", () => {
  test("#given Ask mode and a denied confirmation #when Show ignored files opens #then no ignored search or draft update occurs", async () => {
    // given
    const provider = new CompletionProvider()
    const steps: string[] = []
    const written: string[] = []
    const notices: string[] = []
    const request = actionRequest()

    // when
    await openIgnoredFilesPicker({
      current: provider,
      mode: "ask",
      request,
      searchFiles: async () => {
        steps.push("search")
        return [{ value: "@-probe-secret.txt", label: "-probe-secret.txt" }]
      },
      ui: pickerUi({ confirmation: false, steps, written, notices }),
    })

    // then
    expect(steps).toEqual(["confirm:Show ignored files?"])
    expect(written).toEqual([])
    expect(provider.applied).toBeUndefined()
  })

  test("#given the user explicitly reveals files in ignore mode #when a hidden path is selected #then the original draft is completed without being submitted", async () => {
    // given
    const provider = new CompletionProvider()
    const steps: string[] = []
    const written: string[] = []
    const notices: string[] = []
    const request = actionRequest()
    const selected = "1. -probe-secret.txt"

    // when
    await openIgnoredFilesPicker({
      current: provider,
      mode: "ignore",
      request,
      searchFiles: async (query) => {
        steps.push(`search:${query}`)
        return [{ value: '@"-probe-secret.txt"', label: "-probe-secret.txt", description: "-probe-secret.txt" }]
      },
      ui: pickerUi({ confirmation: false, selection: selected, steps, written, notices }),
    })

    // then
    expect(steps).toEqual([
      "search:@-probe",
      "select:Ignored files",
      "set-editor-text",
    ])
    expect(provider.applied?.value).toBe('@"-probe-secret.txt"')
    expect(written).toEqual(['before @"-probe-secret.txt"  after'])
    expect(notices).toEqual(["File reference added to the draft. It has not been sent."])
  })

  test("#given an approved reveal with no matching ignored paths #when the modal picker opens #then it reports the empty result and leaves the draft alone", async () => {
    // given
    const provider = new CompletionProvider()
    const steps: string[] = []
    const written: string[] = []
    const notices: string[] = []

    // when
    await openIgnoredFilesPicker({
      current: provider,
      mode: "ask",
      request: actionRequest(),
      searchFiles: async () => {
        steps.push("search")
        return []
      },
      ui: pickerUi({ confirmation: true, steps, written, notices }),
    })

    // then
    expect(steps).toEqual(["confirm:Show ignored files?", "search"])
    expect(notices).toEqual(["No ignored files matched this @ search."])
    expect(written).toEqual([])
  })

  test("#given the user cancels the ignored-file list #when the modal closes #then the draft remains unchanged", async () => {
    // given
    const provider = new CompletionProvider()
    const steps: string[] = []
    const written: string[] = []
    const notices: string[] = []

    // when
    await openIgnoredFilesPicker({
      current: provider,
      mode: "ignore",
      request: actionRequest(),
      searchFiles: async () => [{ value: '@"-probe-secret.txt"', label: "-probe-secret.txt" }],
      ui: pickerUi({ confirmation: false, steps, written, notices }),
    })

    // then
    expect(steps).toEqual(["select:Ignored files"])
    expect(written).toEqual([])
    expect(provider.applied).toBeUndefined()
  })
})
