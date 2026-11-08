import { describe, expect, test } from "bun:test"

import { createPanelBody } from "./body"
import { visibleWidth } from "./format/truncate"
import type { PanelRow, PanelTheme } from "./types"

const noTheme = (): PanelTheme | undefined => undefined

const COLOURS: Record<string, string> = { accent: "\x1b[35m", muted: "\x1b[90m" }

/** Stands in for pi-tui's theme: colour arrives as escapes, which carry no printable width. */
function ansiTheme(): PanelTheme {
  return { fg: (color, text) => `${COLOURS[color] ?? ""}${text}\x1b[39m` }
}

function source(rows: readonly PanelRow[], seen?: number[]) {
  return {
    rows: (width: number) => {
      seen?.push(width)
      return rows
    },
  }
}

const OSC8_OPEN = "\u001b]8;;"
const OSC8_CLOSE = "\u001b]8;;\u0007"

function stripLinks(line: string): string {
  return line.replace(/\x1b\]8;;[^\x07]*\x07/g, "")
}

function linkUrls(line: string): string[] {
  return [...line.matchAll(/\x1b\]8;;([^\x07]*)\x07/g)].map((match) => match[1] ?? "").filter((url) => url !== "")
}

describe("createPanelBody", () => {
  test("#given rows shorter than the column #when rendered #then gutters frame the padded inner row", () => {
    // given
    const body = createPanelBody(source([{ text: "a" }, { text: "bb" }]), noTheme, () => false)

    // when
    const painted = body.render(5)

    // then: one left gutter + inner width 3 + one right gutter
    expect(painted).toEqual([" a   ", " bb  "])
    for (const line of painted) expect(visibleWidth(line)).toBe(5)
  })

  test("#given a coloured row and a theme #when rendered #then the theme paints it and padding still fits", () => {
    // given
    const body = createPanelBody(source([{ text: "USAGE", color: "accent" }]), ansiTheme, () => false)

    // when
    const painted = body.render(8)

    // then: inner width 6 holds the painted word plus one pad cell, framed by gutters
    expect(painted).toEqual([" \x1b[35mUSAGE\x1b[39m  "])
    expect(visibleWidth(painted[0] ?? "")).toBe(8)
  })

  test("#given row text with terminal controls #when rendered #then only the theme's SGR reaches the terminal", () => {
    // given: a git path or tool argument may carry ESC, BEL and newlines
    const hostile = "a\x1b]8;;https://x\x07b\nc\x1b[2J"
    const body = createPanelBody(source([{ text: hostile, color: "accent" }]), ansiTheme, () => false)

    // when
    const [line = ""] = body.render(22)

    // then
    expect(line).toBe(" \x1b[35ma]8;;https://xb c[2J\x1b[39m ")
    expect(visibleWidth(line)).toBe(22)
  })

  test("#given a row without a colour #when rendered #then no escapes are added", () => {
    // given
    const body = createPanelBody(source([{ text: "plain" }]), ansiTheme, () => false)

    // when
    const painted = body.render(6)

    // then: inner width 4 cuts the word with the column marker, gutters frame it
    expect(painted).toEqual([" pla… "])
    expect(visibleWidth(painted[0] ?? "")).toBe(6)
  })

  test("#given a host that hands no theme #when rendered #then coloured rows fall back to plain text", () => {
    // given
    const body = createPanelBody(source([{ text: "USAGE", color: "accent" }]), noTheme, () => false)

    // when
    const painted = body.render(5)

    // then
    expect(painted).toEqual([" US… "])
  })

  test("#given a row wider than the column #when rendered #then it is cut to the inner width", () => {
    // given
    const body = createPanelBody(source([{ text: "abcdefghij" }]), noTheme, () => false)

    // when
    const painted = body.render(5)

    // then
    expect(painted).toEqual([" ab… "])
  })

  test("#given no column width #when rendered #then nothing paints and the source is never asked", () => {
    // given
    const widths: number[] = []
    const body = createPanelBody(source([], widths), noTheme, () => false)

    // when
    const painted = body.render(-4)

    // then: zero inner width returns early, so no rows are built at all
    expect(painted).toEqual([])
    expect(widths).toEqual([])
  })

  test("#given a row with an action #when clicks are on #then the inner row is one hyperlink inside the gutters", () => {
    // given
    const rows = [{ text: "M a.ts", action: { kind: "file", path: "src/a.ts" } } as const]
    const body = createPanelBody(source([...rows]), noTheme, () => true)

    // when
    const [line = ""] = body.render(10)

    // then: gutters stay plain; the link covers exactly the inner cells
    expect(line.startsWith(` ${OSC8_OPEN}omo-panel:file/src%2Fa.ts\u0007`)).toBe(true)
    expect(line.endsWith(`${OSC8_CLOSE} `)).toBe(true)
    // The link is applied after the width math, so the painted text is still exactly the column.
    expect(stripLinks(line)).toBe(" M a.ts   ")
    expect(visibleWidth(stripLinks(line))).toBe(10)
  })

  test("#given clicks are off #when rendered #then the row is painted plain", () => {
    // given
    const body = createPanelBody(
      source([{ text: "M a.ts", action: { kind: "file", path: "src/a.ts" } }]),
      noTheme,
      () => false,
    )

    // when / then
    expect(body.render(10)[0]).toBe(" M a.ts   ")
  })

  test("#given a row carrying no action #when clicks are on #then it stays plain", () => {
    // given a heading is not a link
    const body = createPanelBody(source([{ text: "FILES" }]), noTheme, () => true)

    // when / then
    expect(body.render(10)[0]).toBe(" FILES    ")
  })

  test("#given the divided column #when rendered #then the rule and blank frame the padded row", () => {
    // given the fullscreen column draws its rule inside the column width
    const body = createPanelBody(source([{ text: "ab" }]), noTheme, () => false, { divided: () => true })

    // when
    const [line = ""] = body.render(6)

    // then: rule + blank + inner width 3 + right gutter
    expect(line).toBe("│ ab  ")
    expect(visibleWidth(line)).toBe(6)
  })

  test("#given a styled row #when rendered #then each span paints its own cells and the width holds", () => {
    // given a file row: status span, name span, and row padding outside every span
    const body = createPanelBody(
      source([
        {
          text: "M a.ts",
          color: "text",
          styles: [
            { start: 0, end: 1, style: "error" as const },
            { start: 2, end: 6, style: { ansi256: 46 } },
          ],
        },
      ]),
      ansiTheme,
      () => false,
    )

    // when
    const [line = ""] = body.render(10)

    // then: every run paints exactly its own cells — status, gap, 256-colour name, padding
    expect(line).toBe(" M\x1b[39m \x1b[39m\x1b[38;5;46ma.ts\x1b[39m  \x1b[39m ")
    expect(visibleWidth(stripLinks(line))).toBe(10)
  })

  test("#given a styled row with a partial link #when clicks are on #then only the linked span carries the action", () => {
    // given only the file name is clickable; the status column stays plain
    const rows = [
      {
        text: "M a.ts",
        color: "text" as const,
        styles: [{ start: 0, end: 1, style: "error" as const }],
        action: { kind: "file", path: "src/a.ts" } as const,
        linkSpan: { start: 2, end: 6 },
      },
    ]
    const body = createPanelBody(source(rows), noTheme, () => true)

    // when
    const [line = ""] = body.render(10)

    // then: exactly one linked run, and the status cell sits outside it
    expect(linkUrls(line)).toEqual(["omo-panel:file/src%2Fa.ts"])
    expect(stripLinks(line)).toBe(" M a.ts   ")
    expect(line.startsWith(" M ")).toBe(true)
  })
})
