// A real xterm.js terminal in headless Chrome, fed the bytes of the real Senpi TUI's PTY.
//
// Same approach as kibitzer-sidecar-tui-qa.mjs (Bun.spawn terminal + xterm.js in Chrome), kept in its
// own module because this driver resizes the terminal mid-run: the column has to be proven to drop
// below side_panel.min_columns and come back. Every assertion reads the rendered screen, never the
// raw ANSI stream.
import { existsSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)

export function resolveChrome(explicit, env = process.env, platform = process.platform) {
  const candidates = [explicit, env.CHROME_BIN, env.GOOGLE_CHROME_BIN]
  if (platform === "darwin") candidates.push("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium")
  if (platform === "linux") candidates.push("/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser")
  return candidates.find((candidate) => typeof candidate === "string" && candidate.length > 0 && existsSync(candidate))
}

export function buildPageHtml({ xtermJs, xtermCss, unicodeJs, cols, rows, fontSize }) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
${xtermCss}
html,body{margin:0;padding:0;background:#0b0e14}
#t{padding:8px}
</style></head><body><div id="t"></div>
<script>${xtermJs}</script>
<script>${unicodeJs}</script>
<script>
  window.__term = new Terminal({
    cols: ${cols}, rows: ${rows}, fontSize: ${fontSize},
    fontFamily: 'Menlo, "DejaVu Sans Mono", "Noto Sans Mono CJK KR", monospace',
    allowProposedApi: true, convertEol: false, scrollback: 4000,
    theme: { background: '#0b0e14', foreground: '#d7dae0' },
  });
  try { const u = new Unicode11Addon.Unicode11Addon(); window.__term.loadAddon(u); window.__term.unicode.activeVersion = '11'; } catch (e) {}
  window.__term.open(document.getElementById('t'));
  window.__write = (d) => new Promise((done) => window.__term.write(d, done));
  window.__resize = (c, r) => { window.__term.resize(c, r); };
  window.__snapshot = () => {
    const term = window.__term, b = term.buffer.active, lines = [];
    for (let i = 0; i < b.length; i++) { const ln = b.getLine(i); lines.push(ln ? ln.translateToString(true) : ''); }
    const viewport = lines.slice(b.viewportY, b.viewportY + term.rows);
    const trim = (arr) => { const copy = arr.slice(); while (copy.length > 0 && copy[copy.length - 1] === '') copy.pop(); return copy.join('\\n'); };
    return { viewport: trim(viewport), buffer: trim(lines), viewportY: b.viewportY, rows: term.rows, cols: term.cols };
  };
  window.__cells = () => {
    const term = window.__term, b = term.buffer.active, rows = [];
    let nullCell = null;
    try { nullCell = b.getNullCell ? b.getNullCell() : null; } catch (e) { nullCell = null; }
    for (let vy = 0; vy < term.rows; vy++) {
      const ln = b.getLine(b.viewportY + vy);
      const row = [];
      if (!ln) { rows.push(row); continue; }
      for (let x = 0; x < term.cols; x++) {
        try {
          if (nullCell && ln.getCell) {
            ln.getCell(x, nullCell);
            const palette = nullCell.isFgPalette ? nullCell.isFgPalette() : false;
            row.push({ ch: nullCell.getChars ? nullCell.getChars() : '', fgPalette: palette, fg: (palette && nullCell.getFgColor) ? nullCell.getFgColor() : -1 });
          } else { row.push({ ch: '', fgPalette: false, fg: -1 }); }
        } catch (e) { row.push({ ch: '', fgPalette: false, fg: -1 }); }
      }
      rows.push(row);
    }
    return { rows, cols: term.cols, rowsCount: term.rows, viewportY: b.viewportY };
  };
  window.__settled = () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
  window.__term.focus();
</script></body></html>`
}

/**
 * A real xterm.js screen. `write` feeds PTY bytes in order and re-evaluates every pending screen
 * waiter once xterm.js has parsed them, so a waiter registered BEFORE a keystroke cannot miss the
 * frame that keystroke produced. `resize` keeps the renderer's geometry equal to the PTY's.
 *
 * Every snapshot also carries `revision`, the number of PTY chunks parsed so far. Resizing xterm
 * changes `cols`/`rows` synchronously, so dimensions alone cannot prove the HOST has painted the new
 * geometry; a caller that must read a resized screen anchors on this revision first (see the driver's
 * `frameBelongsToGeometry`).
 */
export async function openRenderer({ executablePath, cols, rows, fontSize = 14 }) {
  const puppeteer = (await import("puppeteer-core")).default
  const asset = (spec) => readFileSync(require.resolve(spec), "utf8")
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ["--no-sandbox", "--disable-gpu", "--hide-scrollbars", "--force-color-profile=srgb"],
    defaultViewport: { width: cols * 10 + 40, height: rows * 20 + 40, deviceScaleFactor: 2 },
    // Teardown order belongs to the driver (TUI first, then the browser), so puppeteer's own signal
    // handlers must not close Chrome under a still-running TUI.
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
  })
  const page = await browser.newPage()
  await page.setContent(
    buildPageHtml({
      xtermJs: asset("@xterm/xterm/lib/xterm.js"),
      xtermCss: asset("@xterm/xterm/css/xterm.css"),
      unicodeJs: asset("@xterm/addon-unicode11/lib/addon-unicode11.js"),
      cols,
      rows,
      fontSize,
    }),
    { waitUntil: "load" },
  )
  await page.evaluate(() => document.fonts && document.fonts.ready)

  const waiters = []
  let chain = Promise.resolve()
  let latest = { viewport: "", buffer: "", viewportY: 0, rows, cols, revision: 0 }
  let closed = false
  let rendererError
  /**
   * Parsed PTY writes: incremented once xterm.js has finished parsing a chunk. xterm's own `resize`
   * moves `term.cols`/`term.rows` synchronously, before a single byte of the host's repaint can
   * arrive, so a snapshot's dimensions are NOT evidence that the screen belongs to that geometry.
   * This counter is: a frame read at a revision past the caller's anchor was parsed after the caller
   * asked for the resize, i.e. it came from the host's own repaint.
   */
  let writeRevision = 0

  const readPage = async () => {
    latest = { ...(await page.evaluate(() => window.__snapshot())), revision: writeRevision }
    return latest
  }
  /** Chain-safe: a caller never reads a frame while a chunk it just fed is still being parsed. */
  const snapshot = async () => {
    await chain
    return readPage()
  }
  const settleWaiters = () => {
    for (const waiter of [...waiters]) {
      let value
      try {
        value = waiter.predicate(latest)
      } catch (error) {
        value = undefined
        waiter.fail(error)
        continue
      }
      if (value === undefined || value === false) continue
      waiter.fulfil(value)
    }
  }

  return {
    write(text) {
      chain = chain
        .then(async () => {
          if (closed) return
          await page.evaluate((chunk) => window.__write(chunk), text)
          writeRevision += 1
          if (waiters.length === 0) return
          await readPage()
          settleWaiters()
        })
        .catch((error) => {
          rendererError = error
        })
      return chain
    },
    async waitForScreen(predicate, { timeoutMs, description }) {
      await chain
      if (rendererError !== undefined) throw rendererError
      const first = predicate(await snapshot())
      if (first !== undefined && first !== false) return first
      return new Promise((resolvePromise, reject) => {
        const waiter = { predicate, fulfil: undefined, fail: undefined, timer: undefined }
        const remove = () => {
          clearTimeout(waiter.timer)
          const index = waiters.indexOf(waiter)
          if (index >= 0) waiters.splice(index, 1)
        }
        waiter.fulfil = (value) => {
          remove()
          resolvePromise(value)
        }
        waiter.fail = (error) => {
          remove()
          reject(error)
        }
        waiter.timer = setTimeout(
          () =>
            waiter.fail(
              new Error(
                `${description} timed out after ${timeoutMs}ms; last frame ${latest.cols}x${latest.rows} at parsed-write revision ${latest.revision}; screen tail=${JSON.stringify(latest.viewport.split("\n").slice(-10).join("\n"))}`,
              ),
            ),
          timeoutMs,
        )
        waiters.push(waiter)
      })
    },
    snapshot,
    latest: () => latest,
    async snapshotCells() {
      await chain
      return page.evaluate(() => window.__cells())
    },
    async resize(nextCols, nextRows) {
      await chain
      await page.evaluate(({ c, r }) => window.__resize(c, r), { c: nextCols, r: nextRows })
      await page.setViewport({ width: nextCols * 10 + 40, height: nextRows * 20 + 40, deviceScaleFactor: 2 })
      return readPage()
    },
    async screenshot() {
      await chain
      await page.evaluate(() => window.__settled())
      const element = await page.$(".xterm")
      if (element === null) throw new Error("xterm.js did not mount")
      return element.screenshot({ type: "png" })
    },
    async close() {
      closed = true
      for (const waiter of [...waiters]) waiter.fail(new Error("renderer closed"))
      await browser.close()
      return "browser closed"
    },
  }
}
