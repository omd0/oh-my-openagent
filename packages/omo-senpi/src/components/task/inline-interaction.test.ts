import { describe, expect, it } from "bun:test"

import {
  createInlineInteraction,
  isPrivateWorkerUrl,
  parseWorkerUrl,
  workerKey,
  workerUrl,
  type InlineInteraction,
  type InlineWorker,
  type InputHandler,
} from "./inline-interaction"

const ALT_DOWN = "[1;3B"
const ALT_UP = "[1;3A"
const DOWN = "[B"
const ENTER = "\r"
const ESC = ""

const TASK: InlineWorker = { kind: "task", taskId: "st_a" }
const DAG: InlineWorker = { kind: "dag", runId: "dag_r", nodeId: "n1" }

interface InteractionHarness {
  readonly interaction: InlineInteraction
  readonly opened: InlineWorker[]
  readonly prevUrls: string[]
  readonly candidate: { requestRender: () => void; openUrl: (url: string) => void }
  setBusy(next: boolean): void
  setSession(next: string | undefined): void
  subscribe(): { handle: InputHandler; unsubscribed: () => number }
}

function harness(): InteractionHarness {
  const opened: InlineWorker[] = []
  const prevUrls: string[] = []
  let busy = false
  let session: string | undefined = "session-a"
  const interaction = createInlineInteraction({
    open: (worker) => opened.push(worker),
    busy: () => busy,
    sessionId: () => session,
  })
  const candidate = {
    requestRender: () => undefined,
    openUrl: (url: string) => {
      prevUrls.push(url)
    },
  }
  interaction.attach(candidate)
  return {
    interaction,
    opened,
    prevUrls,
    candidate,
    setBusy: (next) => {
      busy = next
    },
    setSession: (next) => {
      session = next
    },
    subscribe: () => {
      let current: InputHandler | undefined
      let unsubscribed = 0
      interaction.bindInput((handler) => {
        current = handler
        return () => {
          current = undefined
          unsubscribed += 1
        }
      })
      if (current === undefined) throw new Error("input was not subscribed")
      const handle: InputHandler = (data) => current?.(data)
      return { handle, unsubscribed: () => unsubscribed }
    },
  }
}

describe("createInlineInteraction", () => {
  it("#given worker rows #when Alt+Down arrives #then focus is claimed and an unrelated key releases it to the editor", () => {
    // given visible rows of the owning session
    const testHarness = harness()
    testHarness.interaction.setGroup("task", "session-a", [TASK])
    const { handle } = testHarness.subscribe()

    // when Alt+Down arrives
    const claimed = handle(ALT_DOWN)

    // then the chord is consumed and the first row shows focus
    expect(claimed).toEqual({ consume: true })
    expect(testHarness.interaction.decorate(TASK, "row", 80)).toContain("›")

    // when an unrelated key arrives while focused
    const released = handle("x")

    // then focus leaves and the key reaches the editor
    expect(released).toBeUndefined()
    expect(testHarness.interaction.decorate(TASK, "row", 80)).not.toContain("›")
    expect(testHarness.opened).toHaveLength(0)
  })

  it("#given focus on the second row #when Enter arrives #then that worker opens in paint order", () => {
    // given task rows then DAG rows, focused
    const testHarness = harness()
    testHarness.interaction.setGroup("task", "session-a", [TASK])
    testHarness.interaction.setGroup("dag", "session-a", [DAG])
    const { handle } = testHarness.subscribe()
    handle(ALT_DOWN)

    // when moving down once and confirming
    expect(handle(DOWN)).toEqual({ consume: true })
    const confirmed = handle(ENTER)

    // then the DAG worker (second in paint order) opened and focus left
    expect(confirmed).toEqual({ consume: true })
    expect(testHarness.opened).toEqual([DAG])
    expect(testHarness.interaction.decorate(DAG, "row", 80)).not.toContain("›")
  })

  it("#given an active focus #when Escape or Alt+Up arrives #then focus leaves without opening", () => {
    for (const cancel of [ESC, ALT_UP]) {
      // given
      const testHarness = harness()
      testHarness.interaction.setGroup("task", "session-a", [TASK])
      const { handle } = testHarness.subscribe()
      handle(ALT_DOWN)

      // when
      const result = handle(cancel)

      // then
      expect(result).toEqual({ consume: true })
      expect(testHarness.opened).toHaveLength(0)
      expect(testHarness.interaction.decorate(TASK, "row", 80)).not.toContain("›")
    }
  })

  it("#given a watch is open #when input arrives #then the menu yields it", () => {
    // given rows but a busy surface (an open watch owns the keyboard)
    const testHarness = harness()
    testHarness.interaction.setGroup("task", "session-a", [TASK])
    const { handle } = testHarness.subscribe()
    testHarness.setBusy(true)

    // when
    expect(handle(ALT_DOWN)).toBeUndefined()

    // and when the watch closes the same chord claims again
    testHarness.setBusy(false)
    expect(handle(ALT_DOWN)).toEqual({ consume: true })
  })

  it("#given rows of another session #when input arrives #then nothing is claimed", () => {
    // given rows painted for session-a while session-b is live
    const testHarness = harness()
    testHarness.interaction.setGroup("task", "session-a", [TASK])
    const { handle } = testHarness.subscribe()
    testHarness.setSession("session-b")

    // when
    expect(handle(ALT_DOWN)).toBeUndefined()
    expect(testHarness.opened).toHaveLength(0)
  })

  it("#given cleared rows #when input arrives #then the claim is released and the editor keeps the key", () => {
    // given a subscribed menu
    const testHarness = harness()
    testHarness.interaction.setGroup("task", "session-a", [TASK])
    const { handle, unsubscribed } = testHarness.subscribe()

    // when every group clears (session switch, shutdown)
    testHarness.interaction.setGroup("task", "session-a", [])
    testHarness.interaction.setGroup("dag", "session-a", [])

    // then the subscription is released and Alt+Down no longer claims
    expect(unsubscribed()).toBe(1)
    expect(handle(ALT_DOWN)).toBeUndefined()
  })

  it("#given a link click #when the URL is a visible worker #then it opens; otherwise it never reaches a browser", () => {
    // given a visible owned worker
    const testHarness = harness()
    testHarness.interaction.setGroup("task", "session-a", [TASK])

    // when its private link is clicked
    testHarness.candidate.openUrl(workerUrl(TASK))

    // then it opens through the same callback as the keyboard
    expect(testHarness.opened).toEqual([TASK])

    // when a private link for an invisible worker arrives, or a malformed one
    testHarness.candidate.openUrl(workerUrl(DAG))
    testHarness.candidate.openUrl("omo-subagent:task/")
    testHarness.candidate.openUrl("omo-subagent:nope/a/b")

    // then all of them are swallowed: no open, no browser handoff
    expect(testHarness.opened).toEqual([TASK])
    expect(testHarness.prevUrls).toHaveLength(0)

    // when an ordinary URL arrives
    testHarness.candidate.openUrl("https://example.com/docs")

    // then it still reaches the host's previous callback
    expect(testHarness.prevUrls).toEqual(["https://example.com/docs"])
  })

  it("#given dispose #when input or links arrive #then nothing is claimed or opened", () => {
    // given a subscribed menu that is then disposed
    const testHarness = harness()
    testHarness.interaction.setGroup("task", "session-a", [TASK])
    const { handle } = testHarness.subscribe()
    testHarness.interaction.dispose()

    // when
    expect(handle(ALT_DOWN)).toBeUndefined()
    testHarness.candidate.openUrl(workerUrl(TASK))

    // then
    expect(testHarness.opened).toHaveLength(0)
    expect(testHarness.prevUrls).toHaveLength(0)
  })

  it("#given rows painted before attach #when a row decorates #then no link is painted until the callback is claimed", () => {
    // given an interaction that never attached a renderer
    const opened: InlineWorker[] = []
    const bare = createInlineInteraction({ open: (worker) => opened.push(worker), busy: () => false, sessionId: () => "session-a" })
    bare.setGroup("task", "session-a", [TASK])

    // when
    const plain = bare.decorate(TASK, "row", 80)

    // then no private link is painted that no host would deliver
    expect(isPrivateWorkerUrl(plain)).toBe(false)
    expect(parseWorkerUrl(plain)).toBeUndefined()
    expect(workerKey(TASK)).toBe(`task/${encodeURIComponent("st_a")}`)
    bare.dispose()
  })
})
