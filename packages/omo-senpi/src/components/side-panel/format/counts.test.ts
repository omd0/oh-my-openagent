import { describe, expect, test } from "bun:test"

import { MAX_COUNT, formatCount, isOversizedChange, safeCount } from "./counts"

describe("safeCount", () => {
  test("#given no measurement #when made safe #then it counts as zero", () => {
    // given binary files carry no line counts
    // when / then
    expect(safeCount(undefined)).toBe(0)
  })

  test("#given malformed counts #when made safe #then they floor to zero", () => {
    // given a runaway or corrupt source
    // when / then
    expect(safeCount(Number.NaN)).toBe(0)
    expect(safeCount(-3)).toBe(0)
    expect(safeCount(Number.NEGATIVE_INFINITY)).toBe(0)
  })

  test("#given a fraction #when made safe #then it floors to whole lines", () => {
    // given / when / then
    expect(safeCount(3.9)).toBe(3)
  })

  test("#given an unbounded count #when made safe #then it saturates at MAX_COUNT", () => {
    // given an infinite or past-exact count must never reach the printer raw
    // when / then
    expect(safeCount(Number.POSITIVE_INFINITY)).toBe(MAX_COUNT)
    expect(safeCount(Number.MAX_SAFE_INTEGER + 100)).toBe(MAX_COUNT)
    expect(safeCount(MAX_COUNT)).toBe(MAX_COUNT)
  })
})

describe("formatCount", () => {
  test("#given small counts #when formatted #then they print exactly", () => {
    // given / when / then
    expect(formatCount(0)).toBe("0")
    expect(formatCount(1)).toBe("1")
    expect(formatCount(999)).toBe("999")
  })

  test("#given thousands #when formatted #then one decimal below a hundred units", () => {
    // given / when / then
    expect(formatCount(1000)).toBe("1k")
    expect(formatCount(1234)).toBe("1.2k")
    expect(formatCount(12400)).toBe("12.4k")
    expect(formatCount(123456)).toBe("123k")
  })

  test("#given a round-up past a unit #when formatted #then it moves to the next unit", () => {
    // given 999950 would read 1000k without the rollover
    // when / then
    expect(formatCount(999950)).toBe("1M")
    expect(formatCount(2100000)).toBe("2.1M")
  })

  test("#given whole units #when formatted #then no decimal point is kept", () => {
    // given 12.0k must read 12k
    // when / then
    expect(formatCount(12000)).toBe("12k")
    expect(formatCount(1000000000)).toBe("1B")
    expect(formatCount(1500000000)).toBe("1.5B")
    expect(formatCount(1234567890123)).toBe("1.2T")
  })

  test("#given unsafe input #when formatted #then the safe value prints", () => {
    // given the printer never sees the raw value
    // when / then
    expect(formatCount(Number.NaN)).toBe("0")
    expect(formatCount(-50)).toBe("0")
  })
})

describe("isOversizedChange", () => {
  test("#given unknown counts #when checked #then absence of size is not oversized", () => {
    // given git measures no lines for a binary file
    // when / then
    expect(isOversizedChange(undefined, undefined)).toBe(false)
    expect(isOversizedChange(1, undefined)).toBe(false)
  })

  test("#given an ordinary change #when checked #then it stays an ordinary number", () => {
    // given / when / then
    expect(isOversizedChange(0, 0)).toBe(false)
  })

  test("#given a total at the line marker #when checked #then it shows the warning", () => {
    // given totals either side of the oversized boundary
    // when / then
    expect(isOversizedChange(59999, 40000)).toBe(false)
    expect(isOversizedChange(60000, 40000)).toBe(true)
    expect(isOversizedChange(100000, undefined)).toBe(true)
  })

  test("#given a malformed count #when checked #then it is oversized and never printed raw", () => {
    // given only a broken source produces these
    // when / then
    expect(isOversizedChange(Number.POSITIVE_INFINITY, 1)).toBe(true)
    expect(isOversizedChange(-1, 1)).toBe(true)
    expect(isOversizedChange(1, Number.NaN)).toBe(true)
  })
})
