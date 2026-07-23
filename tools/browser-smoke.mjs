import { spawn } from "node:child_process";
import { access, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

if (typeof globalThis.WebSocket === "undefined") {
  try {
    const { WebSocket } = await import("ws");
    globalThis.WebSocket = WebSocket;
  } catch {
    throw new Error("browser QA requires Node 22+ or the optional 'ws' package");
  }
}

const baseUrl = process.env.QA_URL || "http://127.0.0.1:4173/";
const chromeCandidates = [
  process.env.CHROME_BIN,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);

async function firstExisting(paths) {
  for (const candidate of paths) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // keep looking
    }
  }
  return null;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class CdpClient {
  constructor(url) {
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.ws = new WebSocket(url);
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener("open", resolve, { once: true });
      this.ws.addEventListener("error", reject, { once: true });
    });
    this.ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(`${message.error.message} (${message.error.code})`));
        else resolve(message.result || {});
        return;
      }
      for (const listener of this.listeners.get(message.method) || []) listener(message.params || {});
    });
  }

  async send(method, params = {}) {
    await this.ready;
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, listener) {
    const current = this.listeners.get(method) || [];
    current.push(listener);
    this.listeners.set(method, current);
    return () => this.listeners.set(method, (this.listeners.get(method) || []).filter((item) => item !== listener));
  }

  once(method, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        off();
        reject(new Error(`timed out waiting for ${method}`));
      }, timeoutMs);
      const off = this.on(method, (params) => {
        clearTimeout(timer);
        off();
        resolve(params);
      });
    });
  }

  close() {
    this.ws.close();
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const chromePath = await firstExisting(chromeCandidates);
if (!chromePath) throw new Error("Chrome/Chromium not found; set CHROME_BIN to run browser QA");

const profile = await mkdtemp(path.join(os.tmpdir(), "ptcg-chrome-"));
const chrome = spawn(chromePath, [
  "--headless=new",
  "--disable-gpu",
  "--disable-background-networking",
  "--disable-component-update",
  "--disable-default-apps",
  "--disable-extensions",
  "--disable-sync",
  "--no-first-run",
  "--no-default-browser-check",
  "--remote-debugging-port=0",
  `--user-data-dir=${profile}`,
  "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] });

let browserWs;
try {
  browserWs = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Chrome DevTools endpoint did not start")), 10000);
    chrome.stderr.setEncoding("utf8");
    chrome.stderr.on("data", (chunk) => {
      const match = chunk.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (!match) return;
      clearTimeout(timer);
      resolve(match[1]);
    });
    chrome.once("exit", (code) => reject(new Error(`Chrome exited before startup (${code})`)));
  });

  const port = new URL(browserWs).port;
  const target = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" }).then((response) => response.json());
  const cdp = new CdpClient(target.webSocketDebuggerUrl);
  await cdp.ready;
  await Promise.all([cdp.send("Page.enable"), cdp.send("Runtime.enable"), cdp.send("Log.enable")]);

  const runtimeErrors = [];
  cdp.on("Runtime.exceptionThrown", (event) => runtimeErrors.push(event.exceptionDetails?.text || "runtime exception"));
  cdp.on("Log.entryAdded", ({ entry }) => {
    if (entry?.level === "error" && !entry.url?.includes("limitlesstcg")) runtimeErrors.push(entry.text);
  });

  async function evaluate(expression) {
    const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "browser evaluation failed");
    return result.result?.value;
  }

  async function waitFor(expression, label, timeoutMs = 10000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (await evaluate(expression)) return;
      await delay(100);
    }
    throw new Error(`timed out waiting for ${label}`);
  }

  async function viewport(width, height, mobile = false) {
    await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: mobile, maxTouchPoints: mobile ? 5 : 1 });
  }

  async function navigate(url) {
    const loaded = cdp.once("Page.loadEventFired");
    await cdp.send("Page.navigate", { url });
    await loaded;
    await waitFor("document.querySelectorAll('.deck-card').length > 0", "rendered deck cards");
  }

  async function screenshot(file) {
    const { data } = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
    await writeFile(file, Buffer.from(data, "base64"));
  }

  await viewport(1440, 1000, false);
  await navigate(baseUrl);
  const expectedCounts = await evaluate(`fetch('./data/aggregates.json').then((response) => response.json()).then((data) => ({main: data.views.main.rows.length, high: data.views.high.rows.length, elite: data.views.elite.rows.length}))`);
  assert(await evaluate(`document.querySelectorAll('.deck-card').length === ${expectedCounts.main}`), `desktop should render all ${expectedCounts.main} main variants`);
  assert(await evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"), "desktop has horizontal overflow");
  assert(await evaluate("document.querySelectorAll('h1').length === 1"), "page must expose one h1");
  await screenshot("/tmp/ptcg-qa-desktop.png");

  await evaluate("document.querySelector('#stats').scrollIntoView({block:'start'})");
  await delay(150);
  await screenshot("/tmp/ptcg-qa-overview.png");

  await evaluate("document.querySelector('#tiers').scrollIntoView({block:'start'})");
  await delay(150);
  await screenshot("/tmp/ptcg-qa-tiers.png");
  await evaluate(`(() => { const input = document.querySelector('#deck-search'); input.value = 'Clefairy'; input.dispatchEvent(new Event('input', {bubbles:true})); return true; })()`);
  await waitFor(`document.querySelectorAll('.deck-card').length > 0 && document.querySelectorAll('.deck-card').length < ${expectedCounts.main}`, "search-filtered cards");
  await evaluate(`(() => { const input = document.querySelector('#deck-search'); input.value = ''; input.dispatchEvent(new Event('input', {bubbles:true})); const view = document.querySelector('#view-select'); view.value='high'; view.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`);
  await waitFor(`document.querySelectorAll('.deck-card').length === ${expectedCounts.high}`, "high (1000+) view cards");
  await evaluate(`(() => { const view = document.querySelector('#view-select'); view.value='elite'; view.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`);
  await waitFor(`document.querySelectorAll('.deck-card').length === ${expectedCounts.elite}`, "elite view cards");

  await evaluate(`(() => { const view = document.querySelector('#view-select'); view.value='main'; view.dispatchEvent(new Event('change',{bubbles:true})); document.querySelector('#matchup').scrollIntoView({block:'start'}); return true; })()`);
  await waitFor("Boolean(document.querySelector('.matchup-scoreboard'))", "matchup scoreboard", 15000);
  await screenshot("/tmp/ptcg-qa-matchup.png");

  await evaluate("document.querySelector('.deck-card-button').click()");
  await waitFor("document.querySelector('#deck-dialog').open === true", "deck dialog");
  assert(await evaluate("Boolean(document.querySelector('#dialog-title').textContent.trim())"), "deck dialog title missing");
  await screenshot("/tmp/ptcg-qa-dialog.png");
  await evaluate("document.querySelector('#deck-dialog').close()");

  await viewport(390, 844, true);
  await navigate(baseUrl);
  const mobileOverflow = await evaluate(`(() => ({
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    offenders: [...document.querySelectorAll('body *')]
      .map((element) => { const box = element.getBoundingClientRect(); return {tag: element.tagName, cls: element.className?.toString?.() || '', left: Math.round(box.left), right: Math.round(box.right), width: Math.round(box.width)}; })
      .filter((item) => item.right > window.innerWidth + 1 || item.left < -1)
      .slice(0, 12)
  }))()`);
  assert(mobileOverflow.scrollWidth <= mobileOverflow.innerWidth + 1, `mobile has horizontal overflow: ${JSON.stringify(mobileOverflow)}`);
  assert(await evaluate("document.querySelector('.primary-nav').getBoundingClientRect().width === 0"), "mobile navigation should collapse");
  await screenshot("/tmp/ptcg-qa-mobile.png");
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
  assert(await evaluate("document.activeElement.classList.contains('skip-link')"), "first keyboard focus must reach skip link");
  await evaluate("document.activeElement.blur()");

  await evaluate("document.querySelector('#matchup').scrollIntoView({block:'start'})");
  await waitFor("Boolean(document.querySelector('.matchup-scoreboard'))", "mobile matchup scoreboard", 15000);
  const matchupOverflow = await evaluate(`(() => ({
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    offenders: [...document.querySelectorAll('#matchup *')]
      .map((element) => { const box = element.getBoundingClientRect(); return {tag: element.tagName, cls: element.className?.toString?.() || '', left: Math.round(box.left), right: Math.round(box.right), width: Math.round(box.width)}; })
      .filter((item) => item.right > window.innerWidth + 1 || item.left < -1)
      .slice(0, 12)
  }))()`);
  assert(matchupOverflow.scrollWidth <= matchupOverflow.innerWidth + 1, `mobile matchup causes horizontal overflow: ${JSON.stringify(matchupOverflow)}`);
  await screenshot("/tmp/ptcg-qa-mobile-matchup.png");

  if (runtimeErrors.length) throw new Error(`browser console errors: ${runtimeErrors.join(" | ")}`);
  cdp.close();
  console.log("browser smoke passed: desktop + 390px mobile, search, elite toggle, matchup, dialog, keyboard focus");
  console.log("screenshots: /tmp/ptcg-qa-{desktop,overview,tiers,matchup,dialog,mobile,mobile-matchup}.png");
} finally {
  chrome.kill("SIGTERM");
}
