import { describe, expect, test } from "bun:test"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { registerRoutingProfileCommand } from "./commands"

function notifyRecorder() {
  const notifications: string[] = []
  return {
    notifications,
    ui: {
      notify: (message: string) => notifications.push(message),
    },
  }
}

async function invokeRouting(pi: FakeExtensionAPI, args: string, ctx: unknown): Promise<void> {
  const command = pi.commands.find((entry) => entry.name === "routing")
  if (command === undefined) throw new Error("routing command not registered")
  const handler = command.options["handler"] as (args: string, ctx: unknown) => Promise<void>
  await handler(args, ctx)
}

describe("registerRoutingProfileCommand", () => {
  test("#given no args #when the routing command runs #then it reports the current profile and the available list", async () => {
    // given
    const pi = new FakeExtensionAPI()
    registerRoutingProfileCommand(pi, {
      availableProfiles: ["alpha", "mango"],
      currentProfile: () => "alpha",
      select: () => Promise.resolve(true),
      reset: () => Promise.resolve(),
    })
    const recorder = notifyRecorder()

    // when
    await invokeRouting(pi, "", { ui: recorder.ui })

    // then
    expect(recorder.notifications).toEqual(["Task routing: alpha. Available profiles: alpha, mango."])
  })

  test("#given no current profile and no available profiles #when the routing command runs bare #then it falls back to the default label", async () => {
    // given
    const pi = new FakeExtensionAPI()
    registerRoutingProfileCommand(pi, {
      availableProfiles: [],
      currentProfile: () => undefined,
      select: () => Promise.resolve(true),
      reset: () => Promise.resolve(),
    })
    const recorder = notifyRecorder()

    // when
    await invokeRouting(pi, "   ", { ui: recorder.ui })

    // then
    expect(recorder.notifications).toEqual(["Task routing: default. Available profiles: (none)."])
  })

  test("#given a known profile #when the routing command selects it #then select runs and the confirmation names it", async () => {
    // given
    const pi = new FakeExtensionAPI()
    const selected: string[] = []
    registerRoutingProfileCommand(pi, {
      availableProfiles: ["alpha", "mango"],
      currentProfile: () => "alpha",
      select: (name) => {
        selected.push(name)
        return Promise.resolve(true)
      },
      reset: () => Promise.resolve(),
    })
    const recorder = notifyRecorder()

    // when
    await invokeRouting(pi, "mango", { ui: recorder.ui })

    // then
    expect(selected).toEqual(["mango"])
    expect(recorder.notifications).toEqual(["Task routing set to mango."])
  })

  test("#given an unknown profile #when the routing command runs #then select never runs and a warning names the available list", async () => {
    // given
    const pi = new FakeExtensionAPI()
    let calls = 0
    registerRoutingProfileCommand(pi, {
      availableProfiles: ["alpha"],
      currentProfile: () => "alpha",
      select: () => {
        calls += 1
        return Promise.resolve(true)
      },
      reset: () => Promise.resolve(),
    })
    const recorder = notifyRecorder()

    // when
    await invokeRouting(pi, "nope", { ui: recorder.ui })

    // then
    expect(calls).toBe(0)
    expect(recorder.notifications).toEqual(['Unknown task routing profile "nope". Available profiles: alpha.'])
  })

  test("#given a refused selection #when the routing command runs #then the warning fires instead of the confirmation", async () => {
    // given a profile in the list that select declines
    const pi = new FakeExtensionAPI()
    registerRoutingProfileCommand(pi, {
      availableProfiles: ["alpha"],
      currentProfile: () => undefined,
      select: () => Promise.resolve(false),
      reset: () => Promise.resolve(),
    })
    const recorder = notifyRecorder()

    // when
    await invokeRouting(pi, "alpha", { ui: recorder.ui })

    // then
    expect(recorder.notifications).toEqual(['Unknown task routing profile "alpha". Available profiles: alpha.'])
  })

  test("#given the default keyword #when the routing command runs #then reset runs and the notice names the restored profile", async () => {
    // given
    const pi = new FakeExtensionAPI()
    let resets = 0
    let current: string | undefined = "mango"
    registerRoutingProfileCommand(pi, {
      availableProfiles: ["alpha", "mango"],
      currentProfile: () => current,
      select: () => Promise.resolve(true),
      reset: () => {
        resets += 1
        current = "alpha"
        return Promise.resolve()
      },
    })
    const recorder = notifyRecorder()

    // when
    await invokeRouting(pi, "default", { ui: recorder.ui })

    // then
    expect(resets).toBe(1)
    expect(recorder.notifications).toEqual(["Task routing reset to alpha."])
  })
})
