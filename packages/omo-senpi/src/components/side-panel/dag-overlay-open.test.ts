import { describe, expect, test } from "bun:test"

import { claimDagPanelFeed } from "../task/dag-panel-feed"
import { createDagBinding, type DagBinding } from "./dag-binding"
import { dagNode, dagRun } from "./dag-panel.test-support"
import { openDagOverlay } from "./dag-overlay-open"
import type { PopupComponent } from "./popups/text-popup"
import type { PanelOverlayUi, PanelPopupFactory, PanelTimers } from "./types"

/**
 * The overlay lifetime contract: an open graph belongs to the session that asked for it. When the
 * panel's binding is disposed (session switch or shutdown) the host overlay closes at once, not
 * when the host finally resolves `ui.custom`. Wheels ride the native overlay dispatch, so there
 * is no raw-input listener to hold or release.
 */
interface FakeOverlayUi {
  readonly ui: PanelOverlayUi
  readonly requests: () => number
  readonly notices: () => readonly string[]
  readonly doneCalls: () => number
  readonly renders: () => number
  readonly mount: () => PopupComponent
  readonly resolve: () => void
}

function overlayUi(terminalRows = 40): FakeOverlayUi {
  let pending: (() => void) | undefined
  const custom = new Promise<unknown>((resolve) => {
    pending = () => resolve(undefined)
  })
  let factory: PanelPopupFactory | undefined
  let requests = 0
  let doneCalls = 0
  let renders = 0
  const notices: string[] = []
  const done = (): void => {
    doneCalls += 1
  }
  return {
    ui: {
      notify(message) {
        notices.push(message)
      },
      custom(next) {
        requests += 1
        factory = next
        return custom
      },
    },
    requests: () => requests,
    notices: () => notices,
    doneCalls: () => doneCalls,
    renders: () => renders,
    mount: () => {
      if (factory === undefined) throw new Error("the host never received a factory")
      const built = factory(
        {
          terminal: { rows: terminalRows },
          requestRender: () => {
            renders += 1
          },
        },
        undefined,
        undefined,
        done,
      )
      return built as PopupComponent
    },
    resolve: () => pending?.(),
  }
}

function timers(): PanelTimers {
  return { set: () => 0, clear: () => undefined }
}

function bindingFor(): DagBinding {
  return createDagBinding({ timers: timers(), onChange: () => undefined })
}

/** Drains the queued microtasks without a timer: the implementation closes late overlays on one. */
async function drainMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe("openDagOverlay lifetime", () => {
  test("#given an open overlay whose host has not resolved yet #when the binding is disposed #then the overlay closes before that promise settles", async () => {
    // given
    const binding = bindingFor()
    const host = overlayUi()
    const opening = openDagOverlay(host.ui, binding, () => 1_000, {})
    host.mount()
    expect(host.doneCalls()).toBe(0)

    // when - the session ends while the host is still holding its overlay promise
    binding.dispose()

    // then - the close does not wait on the host
    expect(host.doneCalls()).toBe(1)

    // when - the host finally settles, and a second dispose arrives
    binding.dispose()
    host.resolve()
    await opening

    // then - closing is idempotent
    expect(host.doneCalls()).toBe(1)
  })

  test("#given a binding disposed before the host invokes the factory #when the overlay mounts late #then it closes at once", async () => {
    // given
    const binding = bindingFor()
    const host = overlayUi()
    const opening = openDagOverlay(host.ui, binding, () => 1_000, {})
    binding.dispose()

    // when - the host mounts the overlay after the session is already gone
    host.mount()
    await drainMicrotasks()

    // then
    expect(host.doneCalls()).toBe(1)

    // when - the host settles its overlay promise
    host.resolve()
    await opening

    // then - nothing closes twice
    expect(host.doneCalls()).toBe(1)
  })

  test("#given a binding that is already disposed #when the overlay is opened #then the host is never asked for an overlay", async () => {
    // given
    const binding = bindingFor()
    binding.dispose()
    const host = overlayUi()

    // when
    await openDagOverlay(host.ui, binding, () => 1_000, {})

    // then
    expect(host.requests()).toBe(0)
    expect(host.doneCalls()).toBe(0)
    expect(host.notices()).toEqual([])
  })

  test("#given an overlay the user closed #when the session is disposed later #then the disposed binding cannot close it a second time", async () => {
    // given
    const binding = bindingFor()
    const host = overlayUi()
    const opening = openDagOverlay(host.ui, binding, () => 1_000, {})
    host.mount()

    // when - the host settles the overlay without any dispose
    host.resolve()
    await opening

    // then - the binding no longer owns the overlay
    expect(host.doneCalls()).toBe(0)
    binding.dispose()
    expect(host.doneCalls()).toBe(0)
  })

  test("#given an open overlay #when a native wheel arrives #then the viewport moves, repaints, and invalid input leaves it alone", async () => {
    // given a run tall enough that the viewport has somewhere to go
    const binding = bindingFor()
    let runs = [
      dagRun({
        runId: "run-long",
        name: "long run",
        nodes: Array.from({ length: 12 }, (_unused, index) => dagNode({ id: `node-${index}`, label: `Step ${index}` })),
      }),
    ]
    const claimed = claimDagPanelFeed("session-dag-overlay-open-wheel", {}, { runs: () => runs, activity: () => undefined })
    binding.bind("session-dag-overlay-open-wheel")
    const host = overlayUi(20)
    const opening = openDagOverlay(host.ui, binding, () => 1_000, {})
    const overlay = host.mount()
    const before = overlay.render(60).join("\n")
    const paints = host.renders()

    // when
    const result = overlay.handleMouse({ type: "wheel", wheelDelta: 3 })

    // then the overlay claims the wheel and the viewport moves with a repaint
    expect(result).toEqual({ handled: true })
    expect(host.renders()).toBeGreaterThan(paints)
    expect(overlay.render(60).join("\n")).not.toBe(before)

    // when unusable wheels arrive they are ignored and the view does not move
    const settled = overlay.render(60).join("\n")
    const settledPaints = host.renders()
    expect(overlay.handleMouse({ type: "wheel" })).toBeUndefined()
    expect(overlay.handleMouse({ type: "wheel", wheelDelta: Number.NaN })).toBeUndefined()
    expect(overlay.handleMouse({ type: "click", wheelDelta: 3 })).toBeUndefined()
    expect(overlay.render(60).join("\n")).toBe(settled)
    expect(host.renders()).toBe(settledPaints)

    binding.dispose()
    claimed.dispose()
    host.resolve()
    await opening
    expect(host.doneCalls()).toBe(1)
  })
})
