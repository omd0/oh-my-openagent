import { describe, expect, test } from "bun:test"

import { layoutDagRun } from "./dag-graph"
import { dagNode, dagRun } from "./dag-panel.test-support"

describe("layoutDagRun", () => {
  test("#given two nodes with nothing between them #when laid out #then both are independent roots in the first layer", () => {
    // given
    const run = dagRun({ nodes: [dagNode({ id: "plan" }), dagNode({ id: "review" })] })

    // when
    const result = layoutDagRun(run)

    // then
    if (!result.ok) throw new Error(`expected a layout, got ${result.error}`)
    expect(result.graph.nodes.map((node) => node.id)).toEqual(["plan", "review"])
    expect(result.graph.layers.map((layer) => layer.map((node) => node.id))).toEqual([["plan", "review"]])
    expect(result.graph.byId.get("plan")?.deps).toEqual([])
  })

  test("#given a dependent declared before the node it waits on #when laid out #then depth follows the real dependency, not declaration order", () => {
    // given: the engine may record a run in any insertion order
    const run = dagRun({
      nodes: [dagNode({ id: "deploy", dependsOn: ["build"] }), dagNode({ id: "build" })],
    })

    // when
    const result = layoutDagRun(run)

    // then
    if (!result.ok) throw new Error(`expected a layout, got ${result.error}`)
    expect(result.graph.byId.get("build")?.depth).toBe(0)
    expect(result.graph.byId.get("deploy")?.depth).toBe(1)
    expect(result.graph.layers.map((layer) => layer.map((node) => node.id))).toEqual([["build"], ["deploy"]])
  })

  test("#given edges and dependsOn describing the same relation #when laid out #then a dependency is counted once and unknown ids are dropped", () => {
    // given
    const run = dagRun({
      nodes: [dagNode({ id: "a" }), dagNode({ id: "b", dependsOn: ["a", "ghost"] })],
      edges: [
        { from: "a", to: "b" },
        { from: "ghost", to: "b" },
        { from: "a", to: "ghost" },
      ],
    })

    // when
    const result = layoutDagRun(run)

    // then
    if (!result.ok) throw new Error(`expected a layout, got ${result.error}`)
    expect(result.graph.byId.get("b")?.deps).toEqual(["a"])
    expect(result.graph.nodes.map((node) => node.id)).toEqual(["a", "b"])
  })

  test("#given a diamond #when laid out #then the merge node sits below both branches", () => {
    // given
    const run = dagRun({
      nodes: [
        dagNode({ id: "root" }),
        dagNode({ id: "left", dependsOn: ["root"] }),
        dagNode({ id: "right", dependsOn: ["root"] }),
        dagNode({ id: "merge", dependsOn: ["left", "right"] }),
      ],
    })

    // when
    const result = layoutDagRun(run)

    // then
    if (!result.ok) throw new Error(`expected a layout, got ${result.error}`)
    expect(result.graph.byId.get("merge")?.depth).toBe(2)
    expect(result.graph.layers.map((layer) => layer.length)).toEqual([1, 2, 1])
  })

  test("#given an edge that skips a layer #when laid out #then the target hangs off its true dependency", () => {
    // given: c waits on a, never on b; the shallower b must not gate it
    const run = dagRun({
      nodes: [
        dagNode({ id: "a" }),
        dagNode({ id: "b", dependsOn: ["a"] }),
        dagNode({ id: "c", dependsOn: ["a"] }),
      ],
    })

    // when
    const result = layoutDagRun(run)

    // then
    if (!result.ok) throw new Error(`expected a layout, got ${result.error}`)
    expect(result.graph.byId.get("c")?.deps).toEqual(["a"])
    expect(result.graph.byId.get("c")?.depth).toBe(1)
    expect(result.graph.layers.map((layer) => layer.map((node) => node.id))).toEqual([["a"], ["b", "c"]])
  })

  test("#given a dependency cycle #when laid out #then the graph is refused instead of drawn", () => {
    // given
    const run = dagRun({
      nodes: [dagNode({ id: "ping", dependsOn: ["pong"] }), dagNode({ id: "pong", dependsOn: ["ping"] })],
    })

    // when
    const result = layoutDagRun(run)

    // then
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.length).toBeGreaterThan(0)
  })

  test("#given labels carrying terminal control bytes #when laid out #then the exposed label cannot escape the row", () => {
    // given
    const run = dagRun({
      nodes: [
        dagNode({ id: "safe", label: "plan \u001b[31mred\u0007 done" }),
        dagNode({ id: "unlabelled" }),
      ],
    })

    // when
    const result = layoutDagRun(run)

    // then
    if (!result.ok) throw new Error(`expected a layout, got ${result.error}`)
    const label = result.graph.byId.get("safe")?.label ?? ""
    expect(label.includes("\u001b")).toBe(false)
    expect(label.includes("\u0007")).toBe(false)
    expect(label).toContain("plan")
    expect(result.graph.byId.get("unlabelled")?.label).toBe("unlabelled")
  })
})
