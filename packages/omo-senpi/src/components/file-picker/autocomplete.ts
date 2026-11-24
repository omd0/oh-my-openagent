export interface FilePickerItem {
  readonly value: string
  readonly label: string
  readonly description?: string
}

export interface FilePickerSuggestions {
  readonly items: readonly FilePickerItem[]
  readonly prefix: string
}

export interface FilePickerProvider {
  getSuggestions(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    options: { readonly signal: AbortSignal; readonly force?: boolean },
  ): Promise<FilePickerSuggestions | null>
  applyCompletion(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    item: FilePickerItem,
    prefix: string,
  ): { readonly lines: string[]; readonly cursorLine: number; readonly cursorCol: number }
  shouldTriggerFileCompletion?(lines: string[], cursorLine: number, cursorCol: number): boolean
  getMentionRanges?(line: string): readonly { readonly start: number; readonly end: number }[]
}

export type FilePickerMode = "ask" | "include" | "ignore"
export type RunFileSearch = (query: string, signal: AbortSignal) => Promise<readonly FilePickerItem[]>
export type FilePickerActionRequest = {
  readonly lines: readonly string[]
  readonly cursorLine: number
  readonly cursorCol: number
  readonly prefix: string
  readonly visibleItems: readonly FilePickerItem[]
}
export type FilePickerBehavior = {
  readonly getMode: () => FilePickerMode
  readonly searchFiles: RunFileSearch
  readonly openIgnoredFiles: (request: FilePickerActionRequest) => void
}

const SHOW_IGNORED = "__ignored"
const SHOW_IGNORED_ITEM = {
  value: SHOW_IGNORED,
  label: "Show ignored files",
  description: "Open a one-time picker for files excluded by .gitignore",
} as const

export function wrapFilePickerAutocomplete(
  current: FilePickerProvider,
  behavior: FilePickerBehavior,
): FilePickerProvider {
  let lastPrefix = ""
  let lastVisibleItems: readonly FilePickerItem[] = []

  return new Proxy(current, {
    get(target, property) {
      if (property === "getSuggestions") {
        return async (
          lines: string[],
          cursorLine: number,
          cursorCol: number,
          options: { readonly signal: AbortSignal; readonly force?: boolean },
        ): Promise<FilePickerSuggestions | null> => {
          const linePrefix = (lines[cursorLine] ?? "").slice(0, cursorCol)
          const atPrefix = lastAtPrefix(linePrefix)
          if (atPrefix === undefined)
            return current.getSuggestions(lines, cursorLine, cursorCol, options)

          const mode = behavior.getMode()
          const base = await current.getSuggestions(lines, cursorLine, cursorCol, options)
          const baseItems = base?.items ?? []
          lastPrefix = base?.prefix ?? atPrefix
          lastVisibleItems = baseItems
          if (mode === "include") {
            const results = await behavior.searchFiles(atPrefix, options.signal)
            const existing = new Set(baseItems.map((item) => item.value))
            return {
              prefix: lastPrefix,
              items: [...baseItems, ...results.filter((item) => !existing.has(item.value))],
            }
          }
          const items = [...baseItems]
          items.splice(Math.min(1, items.length), 0, SHOW_IGNORED_ITEM)
          return { prefix: lastPrefix, items }
        }
      }
      if (property === "applyCompletion") {
        return (
          lines: string[],
          cursorLine: number,
          cursorCol: number,
          item: FilePickerItem,
          prefix: string,
        ) => {
          if (item.value === SHOW_IGNORED) {
            queueMicrotask(() =>
              behavior.openIgnoredFiles({
                lines: [...lines],
                cursorLine,
                cursorCol,
                prefix,
                visibleItems: prefix === lastPrefix ? lastVisibleItems : [],
              }),
            )
            return { lines, cursorLine, cursorCol }
          }
          return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix)
        }
      }
      const value: unknown = Reflect.get(target, property, target)
      return typeof value === "function" ? value.bind(target) : value
    },
  })
}

function lastAtPrefix(text: string): string | undefined {
  const match = /(?:^|[\s("'`])(@(?:"[^"]*|[^\s"'`]*))$/.exec(text)
  return match?.[1]
}

export function ignoredFileSearchArgs(query: string): string[] {
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return [
    "--max-results",
    "100",
    "--type",
    "f",
    "--type",
    "d",
    "--follow",
    "--hidden",
    "--no-ignore-vcs",
    "--exclude",
    ".git",
    "--exclude",
    ".git/*",
    "--exclude",
    ".git/**",
    "--exclude",
    "**/.git",
    "--exclude",
    "**/.git/*",
    "--exclude",
    "**/.git/**",
    "--ignore-case",
    ...(escaped.length === 0 ? [] : ["--", escaped]),
  ]
}
