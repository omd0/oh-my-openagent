import { describe, expect, test } from "bun:test"

import { OmoConfigLayerSchema, OmoConfigSchema, resolveOmoSidePanelSettings } from "../index"

describe("omo config side_panel section", () => {
  test("#given an empty side_panel section #when parsed #then the panel is off and every section but usage is on", () => {
    // given
    const config = { side_panel: {} }

    // when
    const result = OmoConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.side_panel?.enabled).toBe(false)
    expect(result.data.side_panel?.sections).toEqual({
      session: true,
      goal: true,
      context: true,
      usage: false,
      agents: true,
      tools: true,
      files: true,
      memory: true,
      dag: true,
    })
  })

  test("#given explicit overrides #when parsed #then a column width and a disabled section are preserved", () => {
    // given
    const config = {
      side_panel: {
        enabled: true,
        width: 52,
        min_columns: 160,
        sections: { usage: false },
      },
    }

    // when
    const result = OmoConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.side_panel?.enabled).toBe(true)
    expect(result.data.side_panel?.width).toBe(52)
    expect(result.data.side_panel?.min_columns).toBe(160)
    expect(result.data.side_panel?.sections.usage).toBe(false)
  })

  test("#given a [senpi] harness override #when parsed #then the side_panel layer is accepted", () => {
    // given
    const config = { "[senpi]": { side_panel: { enabled: true } } }

    // when
    const result = OmoConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(true)
  })

  test("#given a profile override #when parsed #then the side_panel layer is accepted", () => {
    // given
    const config = { profiles: { work: { side_panel: { width: "30%" } } } }

    // when
    const result = OmoConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(true)
  })

  test("#given a side_panel layer without values #when parsed as a layer #then no defaults are injected", () => {
    // given
    const config = { side_panel: {} }

    // when
    const result = OmoConfigLayerSchema.safeParse(config)

    // then
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.side_panel?.enabled).toBeUndefined()
    expect(result.data.side_panel?.width).toBeUndefined()
    expect(result.data.side_panel?.sections).toBeUndefined()
  })

  test("#given an unknown key inside side_panel #when parsed #then the config is rejected", () => {
    // given
    const config = { side_panel: { enabled: true, colour: "purple" } }

    // when
    const result = OmoConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(false)
  })

  test("#given a width outside the sidebar range #when parsed #then the config is rejected", () => {
    // given
    const tooNarrow = { side_panel: { width: "5%" } }
    const tooWide = { side_panel: { width: "80%" } }
    const tooFewColumns = { side_panel: { width: 8 } }

    // when
    const results = [tooNarrow, tooWide, tooFewColumns].map((config) => OmoConfigSchema.safeParse(config))

    // then
    expect(results.map((result) => result.success)).toEqual([false, false, false])
  })

  test("#given width boundaries #when parsed #then every edge keeps its documented unit semantics", () => {
    // given
    const values = ["10%", "50%", "9%", "51%", 24, 160, 23, 161]

    // when
    const accepted = values.map((width) => OmoConfigSchema.safeParse({ side_panel: { width } }).success)

    // then
    expect(accepted).toEqual([true, true, false, false, true, true, false, false])
  })

  test("#given numeric setting boundaries #when parsed #then inclusive maxima and minima are pinned", () => {
    // given
    const configs = [
      { side_panel: { min_columns: 60 } },
      { side_panel: { min_columns: 400 } },
      { side_panel: { min_columns: 59 } },
      { side_panel: { min_columns: 401 } },
      { side_panel: { usage_poll_seconds: 3600 } },
      { side_panel: { usage_poll_seconds: 3601 } },
    ]

    // when
    const accepted = configs.map((config) => OmoConfigSchema.safeParse(config).success)

    // then
    expect(accepted).toEqual([true, true, false, false, true, false])
  })

  test("#given a usage poll interval below the floor #when parsed #then the config is rejected", () => {
    // given
    const config = { side_panel: { usage_poll_seconds: 30 } }

    // when
    const result = OmoConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(false)
  })

  test("#given a config without a side_panel section #when resolved #then defaults are returned", () => {
    // given
    const config = OmoConfigSchema.parse({})

    // when
    const settings = resolveOmoSidePanelSettings(config)

    // then
    expect(settings.enabled).toBe(false)
    expect(settings.sections.files).toBe(true)
  })

  test("#given a partial side_panel layer #when resolved #then every missing field takes its default", () => {
    // given: the documented opt-in, as a profile or harness layer hands it over before defaults apply
    const config = { side_panel: { enabled: true, sections: { files: false } } }
    const defaults = resolveOmoSidePanelSettings({})

    // when
    const settings = resolveOmoSidePanelSettings(config)

    // then
    expect(settings.enabled).toBe(true)
    expect(settings.width).toBe(defaults.width)
    expect(settings.min_columns).toBe(defaults.min_columns)
    expect(settings.sections.files).toBe(false)
    expect(settings.sections.session).toBe(true)
    expect(settings.sections.usage).toBe(false)
  })

  test("#given sections.dag disabled in omo.json #when the full config is parsed #then dag is off while the other sections keep their defaults", () => {
    // given
    const config = { side_panel: { enabled: true, sections: { dag: false } } }

    // when
    const result = OmoConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.side_panel?.sections.dag).toBe(false)
    expect(result.data.side_panel?.sections.session).toBe(true)
    expect(result.data.side_panel?.sections.usage).toBe(false)
  })

  test("#given sections.dag disabled in a partial settings layer #when resolved #then only dag turns off and every other section keeps its default", () => {
    // given: a profile or harness layer hands over the opt-out before defaults apply
    const config = { side_panel: { enabled: true, sections: { dag: false } } }
    const defaults = resolveOmoSidePanelSettings({})

    // when
    const settings = resolveOmoSidePanelSettings(config)

    // then
    expect(settings.sections.dag).toBe(false)
    expect(settings.sections.session).toBe(defaults.sections.session)
    expect(settings.sections.agents).toBe(defaults.sections.agents)
    expect(settings.sections.usage).toBe(defaults.sections.usage)
  })

  test("#given a sections layer that disables dag #when parsed as a layer #then the value survives and no sibling section gains a default", () => {
    // given
    const config = { side_panel: { sections: { dag: false } } }

    // when
    const result = OmoConfigLayerSchema.safeParse(config)

    // then
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.side_panel?.sections).toEqual({ dag: false })
  })

  test("#given a non-boolean dag switch #when parsed #then the config is rejected", () => {
    // given
    const config = { side_panel: { sections: { dag: "off" } } }

    // when
    const result = OmoConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(false)
  })

  test("#given an empty side_panel section #when parsed #then clickable links default on", () => {
    // given
    const config = { side_panel: {} }

    // when
    const result = OmoConfigSchema.safeParse(config)

    // then
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.side_panel?.clickable).toBe(true)
  })

  test("#given clickable links disabled #when parsed and resolved #then the opt-out survives while every other default holds", () => {
    // given
    const config = { side_panel: { enabled: true, clickable: false } }

    // when
    const parsed = OmoConfigSchema.safeParse(config)

    // then
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    expect(parsed.data.side_panel?.clickable).toBe(false)
    const settings = resolveOmoSidePanelSettings(config)
    expect(settings.clickable).toBe(false)
    expect(settings.enabled).toBe(true)
    expect(settings.sections.dag).toBe(true)
  })
})
