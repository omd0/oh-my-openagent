# Web components

## OVERVIEW
Page-specific React surfaces share primitives while keeping home, docs, download, and graph behavior separate.

Score: 11; distinct domain: rendering composition across eight component families.

## STRUCTURE
| Directory | Ownership |
|-----------|-----------|
| `home/` | Current landing page, its sections, theme, and local styles |
| `landing/` | Install widgets, DAG playback, and Three.js graph experiment |
| `docs/` | Interactive shell, sidebar, hash navigation, table wrapper |
| `download/` | Visitor detection, installer list, verification instructions |
| `ledger/` | Reusable editorial frames, cells, rows, and reel |
| `manifesto/` | Reading layout and manifesto sections |
| `support/` | Support report interaction |
| `ui/` | Shared shadcn-style primitives |

## WHERE TO LOOK
| Task | Location | Detail |
|------|----------|--------|
| Home composition | `home/home-page.tsx` | Server translations, metadata, stats, section ordering |
| Theme bootstrap | `home/theme-init.ts`, `home/theme-switch.tsx` | Theme state before/after hydration |
| Reveal lifecycle | `home/reveal-observer.tsx` | One observer, one reveal per element, disconnect on cleanup |
| DAG simulation | `landing/dag/` | Scenario data, layout, playback, camera, status |
| Graph rendering | `landing/graph/graph-scene.tsx` | Focus/camera transitions and mobile node subset |
| Docs scrolling | `docs/docs-shell.tsx`, `docs/use-docs-navigation.ts` | Scroll owner and section/hash synchronization |
| Download state | `download/download-experience.tsx`, `download/use-desktop-visitor.ts` | Platform choice and visitor hints |

## CONVENTIONS
- There is no components barrel; imports name the owning surface/module.
- `home/home-page.tsx` fetches stats before rendering sections and logs fallback use.
- Interactive islands carry `"use client"`; home assembly remains server-rendered.
- Docs shell renders a labelled region because its parent already owns the document main.
- On desktop the docs content column owns scrolling; below lg the sidebar becomes a disclosure.
- Home styling is split into tokens, base, chrome, components, hero, motion, and sections.
- Graph resources such as halo textures are disposed during effect cleanup.

## ANTI-PATTERNS
- Do not treat `docs/` components as generated HTML; the generated payload belongs in `lib/`.
- Do not add a second document `<main>` inside the docs shell.
- Do not render the full desktop graph node set on the mobile graph branch.
