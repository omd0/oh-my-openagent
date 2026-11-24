import type { ComponentContext, SenpiExtensionAPI } from "../../extension/types"
import { loadSenpiOmoConfig } from "../config-resolution"
import {
  ignoredFileSearchArgs,
  type FilePickerActionRequest,
  type FilePickerItem,
  type FilePickerMode,
  type FilePickerProvider,
  type RunFileSearch,
  wrapFilePickerAutocomplete,
} from "./autocomplete"

type ScopedFuzzyQuery = { readonly baseDir: string; readonly query: string; readonly displayBase: string }
type FileSearchRuntime = {
  readonly fdPath: string
  readonly basePath: string
  readonly resolveScopedFuzzyQuery: (query: string) => unknown
  readonly scopedPathForDisplay: (displayBase: string, relativePath: string) => string
}
export type FilePickerUi = {
  readonly addAutocompleteProvider: (factory: (current: FilePickerProvider) => FilePickerProvider) => void
  readonly confirm: (title: string, message: string) => Promise<boolean>
  readonly select: (title: string, options: string[]) => Promise<string | undefined>
  readonly setEditorText: (text: string) => void
  readonly notify?: (message: string, type?: "info" | "warning" | "error") => void
}

export function registerFilePickerAutocomplete(
  pi: SenpiExtensionAPI,
  eventContext: unknown,
): void {
  const ui = readPickerUi(eventContext)
  if (ui === undefined || pi.exec === undefined) return
  const setting = loadSenpiOmoConfig({ cwd: pi.cwd ?? process.cwd() }).config.file_picker?.ignore_gitignore
  const mode: FilePickerMode = setting === false ? "include" : setting === "ask" ? "ask" : "ignore"
  const exec = pi.exec.bind(pi)
  ui.addAutocompleteProvider((current) => {
    const runtime = readFileSearchRuntime(current)
    if (runtime === undefined) return current
    const searchFiles = createFileSearch(exec, runtime)
    return wrapFilePickerAutocomplete(current, {
      getMode: () => mode,
      searchFiles,
      openIgnoredFiles: (request) => {
        void openIgnoredFilesPicker({ current, mode, request, searchFiles, ui }).catch((error: unknown) => {
          if (error instanceof Error) ui.notify?.(`File picker: ${error.message}`, "error")
          else throw error
        })
      },
    })
  })
}

function readPickerUi(value: unknown): FilePickerUi | undefined {
  if (typeof value !== "object" || value === null) return undefined
  const ui: unknown = Reflect.get(value, "ui")
  if (typeof ui !== "object" || ui === null) return undefined
  const addAutocompleteProvider: unknown = Reflect.get(ui, "addAutocompleteProvider")
  const confirm: unknown = Reflect.get(ui, "confirm")
  const select: unknown = Reflect.get(ui, "select")
  const setEditorText: unknown = Reflect.get(ui, "setEditorText")
  const notify: unknown = Reflect.get(ui, "notify")
  if (
    typeof addAutocompleteProvider !== "function" ||
    typeof confirm !== "function" ||
    typeof select !== "function" ||
    typeof setEditorText !== "function"
  )
    return undefined
  return {
    addAutocompleteProvider: (factory) => {
      Reflect.apply(addAutocompleteProvider, ui, [factory])
    },
    confirm: async (title, message) => (await Reflect.apply(confirm, ui, [title, message])) === true,
    select: async (title, options) => {
      const result: unknown = await Reflect.apply(select, ui, [title, options])
      return typeof result === "string" ? result : undefined
    },
    setEditorText: (text) => {
      Reflect.apply(setEditorText, ui, [text])
    },
    ...(typeof notify === "function" && {
      notify: (message, type) => {
        Reflect.apply(notify, ui, [message, type])
      },
    }),
  }
}

function readFileSearchRuntime(current: FilePickerProvider): FileSearchRuntime | undefined {
  // The pinned Senpi provider stores its managed fd executable, cwd, and scoped-path helpers on its instance.
  const fdPath: unknown = Reflect.get(current, "fdPath")
  const basePath: unknown = Reflect.get(current, "basePath")
  const resolveScopedFuzzyQuery: unknown = Reflect.get(current, "resolveScopedFuzzyQuery")
  const scopedPathForDisplay: unknown = Reflect.get(current, "scopedPathForDisplay")
  return typeof fdPath === "string" &&
    typeof basePath === "string" &&
    typeof resolveScopedFuzzyQuery === "function" &&
    typeof scopedPathForDisplay === "function"
    ? {
        fdPath,
        basePath,
        resolveScopedFuzzyQuery: (query) => Reflect.apply(resolveScopedFuzzyQuery, current, [query]),
        scopedPathForDisplay: (displayBase, relativePath) => {
          const result: unknown = Reflect.apply(scopedPathForDisplay, current, [displayBase, relativePath])
          if (typeof result !== "string") throw new TypeError("Senpi returned an invalid scoped file path")
          return result
        },
      }
    : undefined
}

function createFileSearch(
  exec: NonNullable<SenpiExtensionAPI["exec"]>,
  runtime: FileSearchRuntime,
): RunFileSearch {
  return async (prefix, signal) => {
    if (signal.aborted) return []
    const isQuotedPrefix = prefix.startsWith('@"')
    const rawQuery = isQuotedPrefix ? prefix.slice(2) : prefix.slice(1)
    const scoped = readScopedFuzzyQuery(runtime.resolveScopedFuzzyQuery(rawQuery))
    const result = await exec(runtime.fdPath, ignoredFileSearchArgs(scoped?.query ?? rawQuery), {
      cwd: scoped?.baseDir ?? runtime.basePath,
      timeout: 3000,
    })
    if (signal.aborted || result.code !== 0) return []
    return result.stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .map((path) => path.replaceAll("\\", "/"))
      .filter((path) => !/(^|\/)\.git(?:\/|$)/.test(path.replace(/\/$/, "")))
      .slice(0, 20)
      .map((path) => {
        const isDirectory = path.endsWith("/")
        const pathWithoutSlash = isDirectory ? path.slice(0, -1) : path
        const displayPath =
          scoped === null
            ? pathWithoutSlash
            : runtime.scopedPathForDisplay(scoped.displayBase, pathWithoutSlash)
        const basename = displayPath.replace(/\/$/, "").split("/").at(-1) ?? displayPath
        const completionPath = `${displayPath}${isDirectory ? "/" : ""}`
        const quoted =
          isQuotedPrefix || /[\s\p{Punctuation}，．：；！？（）［］｛｝“”‘’…—]/u.test(completionPath)
        return {
          value: quoted ? `@"${completionPath}"` : `@${completionPath}`,
          label: `${basename}${isDirectory ? "/" : ""}`,
          description: completionPath,
        }
      })
  }
}

function readScopedFuzzyQuery(value: unknown): ScopedFuzzyQuery | null {
  if (value === null) return null
  if (typeof value !== "object" || Array.isArray(value))
    throw new TypeError("Senpi returned an invalid scoped file search")
  const baseDir: unknown = Reflect.get(value, "baseDir")
  const query: unknown = Reflect.get(value, "query")
  const displayBase: unknown = Reflect.get(value, "displayBase")
  if (typeof baseDir !== "string" || typeof query !== "string" || typeof displayBase !== "string")
    throw new TypeError("Senpi returned an invalid scoped file search")
  return { baseDir, query, displayBase }
}

export async function openIgnoredFilesPicker(options: {
  readonly current: FilePickerProvider
  readonly mode: FilePickerMode
  readonly request: FilePickerActionRequest
  readonly searchFiles: RunFileSearch
  readonly ui: FilePickerUi
}): Promise<void> {
  if (
    options.mode === "ask" &&
    !(await options.ui.confirm(
      "Show ignored files?",
      "This one-time picker will list paths excluded by Git. Choosing a file adds it to your draft but does not send it.",
    ))
  )
    return

  const results = await options.searchFiles(options.request.prefix, new AbortController().signal)
  const visible = new Set(options.request.visibleItems.map((item) => item.value))
  const ignored = results.filter((item) => !visible.has(item.value))
  if (ignored.length === 0) {
    options.ui.notify?.("No ignored files matched this @ search.", "info")
    return
  }

  const labels = ignored.map((item, index) => `${index + 1}. ${item.description ?? item.label}`)
  const selected = await options.ui.select("Ignored files", labels)
  if (selected === undefined) return
  const selectedIndex = labels.indexOf(selected)
  if (selectedIndex === -1) throw new TypeError("Senpi returned an unknown ignored-file selection")
  const item = ignored[selectedIndex]
  if (item === undefined) throw new TypeError("Senpi selected an ignored-file row that does not exist")

  const completion = options.current.applyCompletion(
    [...options.request.lines],
    options.request.cursorLine,
    options.request.cursorCol,
    item,
    options.request.prefix,
  )
  options.ui.setEditorText(completion.lines.join("\n"))
  options.ui.notify?.("File reference added to the draft. It has not been sent.", "info")
}
