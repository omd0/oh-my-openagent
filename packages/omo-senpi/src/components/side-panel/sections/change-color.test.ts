import { describe, expect, test } from "bun:test"

import { changeKind, changeStyles, impactLevel } from "./change-color"

describe("impactLevel", () => {
  test("#given line counts #when binned #then each impact bin picks its own shade level", () => {
    // given the documented bins: 0 | 1-9 | 10-49 | 50-199 | 200+
    // when / then
    expect(impactLevel(undefined)).toBe(0)
    expect(impactLevel(0)).toBe(0)
    expect(impactLevel(1)).toBe(1)
    expect(impactLevel(9)).toBe(1)
    expect(impactLevel(10)).toBe(2)
    expect(impactLevel(49)).toBe(2)
    expect(impactLevel(50)).toBe(3)
    expect(impactLevel(199)).toBe(3)
    expect(impactLevel(200)).toBe(4)
  })

  test("#given an unbounded count #when binned #then it saturates at the strongest shade", () => {
    // given only the palette index is chosen here, so no colour value can overflow
    // when / then
    expect(impactLevel(1000000)).toBe(4)
    expect(impactLevel(Number.POSITIVE_INFINITY)).toBe(4)
  })
})

describe("changeKind", () => {
  test("#given conflict markers #when classified #then conflict wins over every other state", () => {
    // given / when / then
    expect(changeKind("UU")).toBe("conflict")
    expect(changeKind("AA")).toBe("conflict")
    expect(changeKind("DD")).toBe("conflict")
    expect(changeKind("UD")).toBe("conflict")
  })

  test("#given a deletion in either column #when classified #then deletion wins over addition", () => {
    // given AD and MD stage a deletion against another state
    // when / then
    expect(changeKind(" D")).toBe("deleted")
    expect(changeKind("D ")).toBe("deleted")
    expect(changeKind("AD")).toBe("deleted")
    expect(changeKind("MD")).toBe("deleted")
  })

  test("#given an addition or untracked file #when classified #then it reads as new", () => {
    // given / when / then
    expect(changeKind("??")).toBe("new")
    expect(changeKind("A ")).toBe("new")
    expect(changeKind("AM")).toBe("new")
  })

  test("#given anything else #when classified #then it reads as modified", () => {
    // given renames and plain edits keep their yellow hue
    // when / then
    expect(changeKind(" M")).toBe("modified")
    expect(changeKind("M ")).toBe("modified")
    expect(changeKind("R ")).toBe("modified")
  })
})

describe("changeStyles", () => {
  test("#given a modified file #when styled #then the name is yellow and counts split green over red", () => {
    // given a mid-size unstaged edit: total 12 lands in the 10-49 bin
    // when
    const styles = changeStyles({ xy: " M", added: 5, removed: 7 })

    // then: status and name share the yellow ramp, additions green, deletions red
    expect(styles.status).toEqual({ ansi256: 178 })
    expect(styles.name).toEqual({ ansi256: 178 })
    expect(styles.added).toEqual({ ansi256: 71 })
    expect(styles.removed).toEqual({ ansi256: 167 })
  })

  test("#given a new file #when styled #then the file reads green at its own impact", () => {
    // given / when
    const styles = changeStyles({ xy: "??", added: undefined, removed: undefined })

    // then: an unknown count counts as 0, so the quietest green
    expect(styles.name).toEqual({ ansi256: 65 })
    expect(styles.added).toEqual({ ansi256: 65 })
    expect(styles.removed).toEqual({ ansi256: 131 })
  })

  test("#given a deleted file #when styled #then the file reads red", () => {
    // given / when
    const styles = changeStyles({ xy: " D", added: undefined, removed: undefined })

    // then
    expect(styles.name).toEqual({ ansi256: 131 })
    expect(styles.status).toEqual({ ansi256: 196 })
  })

  test("#given a conflict #when styled #then status and name are loud while counts keep their split", () => {
    // given / when
    const styles = changeStyles({ xy: "UU", added: 10, removed: 10 })

    // then: the row shouts, but +N stays green and -N stays red
    expect(styles.status).toBe("error")
    expect(styles.name).toBe("error")
    expect(styles.added).toEqual({ ansi256: 34 })
    expect(styles.removed).toEqual({ ansi256: 196 })
  })

  test("#given an unknown binary count #when styled #then it stays at the quietest shade", () => {
    // given git measures no lines for a binary file: it must never read as the largest change
    // when
    const styles = changeStyles({ xy: " M", added: undefined, removed: undefined })

    // then
    expect(styles.name).toEqual({ ansi256: 136 })
    expect(styles.added).toEqual({ ansi256: 65 })
    expect(styles.removed).toEqual({ ansi256: 131 })
  })
})
