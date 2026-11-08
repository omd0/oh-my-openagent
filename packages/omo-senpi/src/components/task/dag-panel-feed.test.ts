import { describe, expect, test } from "bun:test"

import {
  claimDagPanelFeed,
  readDagPanelFeed,
  subscribeDagPanelFeed,
  type DagPanelFeed,
} from "./dag-panel-feed"

// The registry is process-wide (one slot per session id), so every case uses its own session id and
// releases it before returning: a leaked slot would let one case observe another case's listener.
let sequence = 0
function sessionId(label: string): string {
  sequence += 1
  return `session-dag-panel-feed-${label}-${sequence}`
}

function feedOf(): DagPanelFeed {
  return { runs: () => [], activity: () => undefined }
}

describe("dag panel feed registry", () => {
  test("#given a listener subscribed before any owner published #when an owner claims the session #then the pending subscriber is notified and the feed is readable", () => {
    // given
    const session = sessionId("pending")
    const feed = feedOf()
    let notifications = 0
    const unsubscribe = subscribeDagPanelFeed(session, () => {
      notifications += 1
    })
    expect(readDagPanelFeed(session)).toBeUndefined()

    // when
    const claimed = claimDagPanelFeed(session, {}, feed)

    // then
    expect(notifications).toBe(1)
    expect(readDagPanelFeed(session)).toBe(feed)

    claimed.dispose()
    unsubscribe()
  })

  test("#given two listeners on one session #when one unsubscribes and the owner notifies twice #then only the remaining listener runs", () => {
    // given
    const session = sessionId("unsubscribe")
    let kept = 0
    let dropped = 0
    const keep = subscribeDagPanelFeed(session, () => {
      kept += 1
    })
    const drop = subscribeDagPanelFeed(session, () => {
      dropped += 1
    })
    const claimed = claimDagPanelFeed(session, {}, feedOf())
    const afterClaim = { kept, dropped }

    // when
    drop()
    claimed.notify()
    claimed.notify()

    // then
    expect(dropped).toBe(afterClaim.dropped)
    expect(kept).toBe(afterClaim.kept + 2)

    claimed.dispose()
    keep()
  })

  test("#given two sessions claimed by different owners #when one notifies and releases #then the other session's feed and listeners are untouched", () => {
    // given
    const sessionA = sessionId("isolation-a")
    const sessionB = sessionId("isolation-b")
    const feedA = feedOf()
    const feedB = feedOf()
    let notifiedA = 0
    let notifiedB = 0
    const unsubscribeA = subscribeDagPanelFeed(sessionA, () => {
      notifiedA += 1
    })
    const unsubscribeB = subscribeDagPanelFeed(sessionB, () => {
      notifiedB += 1
    })
    const claimedA = claimDagPanelFeed(sessionA, {}, feedA)
    const claimedB = claimDagPanelFeed(sessionB, {}, feedB)
    const notificationsAfterClaim = { a: notifiedA, b: notifiedB }

    // when
    claimedA.notify()
    const afterNotify = notifiedA
    claimedA.dispose()

    // then - the notify and the release both reach A's listener, and neither reaches B's
    expect(afterNotify).toBe(notificationsAfterClaim.a + 1)
    expect(notifiedA).toBe(notificationsAfterClaim.a + 2)
    expect(notifiedB).toBe(notificationsAfterClaim.b)
    expect(readDagPanelFeed(sessionA)).toBeUndefined()
    expect(readDagPanelFeed(sessionB)).toBe(feedB)

    claimedB.dispose()
    unsubscribeA()
    unsubscribeB()
  })

  test("#given a listener that throws #when the owner publishes and releases #then the fault never reaches the caller and the healthy listener still runs", () => {
    // given
    const session = sessionId("throwing")
    let healthy = 0
    const unsubscribeThrowing = subscribeDagPanelFeed(session, () => {
      throw new Error("consumer render failed")
    })
    const unsubscribeHealthy = subscribeDagPanelFeed(session, () => {
      healthy += 1
    })

    // when
    let claimed: ReturnType<typeof claimDagPanelFeed> | undefined
    expect(() => {
      claimed = claimDagPanelFeed(session, {}, feedOf())
    }).not.toThrow()

    // then
    expect(healthy).toBe(1)
    expect(() => claimed?.notify()).not.toThrow()
    expect(healthy).toBe(2)
    expect(() => claimed?.dispose()).not.toThrow()
    expect(healthy).toBe(3)

    unsubscribeThrowing()
    unsubscribeHealthy()
  })

  test("#given a session whose owner was replaced #when the stale owner notifies and releases #then the current feed survives and only the replacement drives listeners", () => {
    // given
    const session = sessionId("replacement")
    const staleFeed = feedOf()
    const currentFeed = feedOf()
    let notifications = 0
    const unsubscribe = subscribeDagPanelFeed(session, () => {
      notifications += 1
    })
    const stale = claimDagPanelFeed(session, {}, staleFeed)
    const current = claimDagPanelFeed(session, {}, currentFeed)
    const afterReplacement = notifications

    // when
    stale.notify()
    const afterStaleNotify = notifications
    stale.dispose()

    // then
    expect(afterStaleNotify).toBe(afterReplacement)
    expect(readDagPanelFeed(session)).toBe(currentFeed)
    current.notify()
    expect(notifications).toBe(afterStaleNotify + 1)

    // when - the replacement owner itself releases
    current.dispose()

    // then
    expect(readDagPanelFeed(session)).toBeUndefined()
    expect(notifications).toBe(afterStaleNotify + 2)

    unsubscribe()
  })

  test("#given a pending subscriber #when a replacement owner claims the session #then listeners are notified again and the readable feed is the newest", () => {
    // given
    const session = sessionId("owner-update")
    const staleFeed = feedOf()
    const currentFeed = feedOf()
    let notifications = 0
    const unsubscribe = subscribeDagPanelFeed(session, () => {
      notifications += 1
    })
    const stale = claimDagPanelFeed(session, {}, staleFeed)
    const afterFirstClaim = notifications
    expect(readDagPanelFeed(session)).toBe(staleFeed)

    // when
    const current = claimDagPanelFeed(session, {}, currentFeed)

    // then
    expect(notifications).toBeGreaterThan(afterFirstClaim)
    expect(readDagPanelFeed(session)).toBe(currentFeed)
    current.notify()
    expect(notifications).toBeGreaterThan(afterFirstClaim + 1)

    stale.dispose()
    expect(readDagPanelFeed(session)).toBe(currentFeed)
    current.dispose()
    unsubscribe()
  })

  test("#given the last listener unsubscribed and the owner disposed #when a new listener subscribes #then no stale notification fires and the session starts clean", () => {
    // given
    const session = sessionId("entry-cleanup")
    let firstRound = 0
    const dropFirst = subscribeDagPanelFeed(session, () => {
      firstRound += 1
    })
    const claimed = claimDagPanelFeed(session, {}, feedOf())
    expect(firstRound).toBeGreaterThan(0)
    const afterClaim = firstRound

    // when
    dropFirst()
    claimed.dispose()
    expect(readDagPanelFeed(session)).toBeUndefined()
    let secondRound = 0
    const dropSecond = subscribeDagPanelFeed(session, () => {
      secondRound += 1
    })

    // then
    expect(firstRound).toBe(afterClaim)
    expect(secondRound).toBe(0)
    expect(readDagPanelFeed(session)).toBeUndefined()

    // when a fresh owner claims the cleaned session, only the current listener runs
    const fresh = claimDagPanelFeed(session, {}, feedOf())
    expect(secondRound).toBe(1)
    expect(firstRound).toBe(afterClaim)

    fresh.dispose()
    dropSecond()
  })
})
