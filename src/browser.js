import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { readClientState, validateState } from './state.js';
import { aimPoint, validateAction } from './actions.js';

export class SlitherBrowser {
  constructor(options = {}) { this.options = options; this.boosting = false; this.lastMessageAt = null; }

  async open() {
    const { headless = false, channel, url = 'https://slither.io', width = 1280, height = 800 } = this.options;
    const selectedChannel = channel ?? (existsSync(chromium.executablePath()) ? undefined : 'chrome');
    try {
      this.browser = await chromium.launch({ headless, channel: selectedChannel });
      this.page = await this.browser.newPage({ viewport: { width, height } });
      this.page.setDefaultTimeout(15000);
      this.page.on('websocket', socket => {
        if (socket.url().endsWith('/slither')) socket.on('framereceived', () => { this.lastMessageAt = Date.now(); });
      });
      await this.load(url);
    } catch (error) { await this.close(); throw error; }
  }

  async load(url = this.options.url ?? 'https://slither.io') {
    this.lastMessageAt = null;
    this.boosting = false;
    await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await this.page.waitForFunction(() => Array.isArray(window.slithers) && typeof window.connect === 'function');
    await this.page.mouse.up();
  }

  async observe() {
    const state = validateState(await this.page.evaluate(readClientState));
    state.client.lastMessageAt = this.lastMessageAt;
    return state;
  }

  async start(nickname) {
    await this.release();
    await this.page.waitForFunction(() => window.dead_mtm === -1 && !window.playing && !window.connecting && !window.nick?.disabled);
    await this.page.locator('#nick').fill(nickname);
    await this.page.locator('#playh').click();
  }

  async act(action) {
    const normalized = validateAction(action);
    const viewport = this.page.viewportSize();
    const point = aimPoint(normalized.heading, viewport.width, viewport.height);
    await this.page.mouse.move(point.x, point.y);
    if (normalized.boost !== this.boosting) {
      if (normalized.boost) await this.page.mouse.down();
      else await this.page.mouse.up();
      this.boosting = normalized.boost;
    }
    return normalized;
  }

  async release() {
    if (this.page && !this.page.isClosed()) await this.page.mouse.up();
    this.boosting = false;
  }

  async close() {
    try { await this.release(); } finally { await this.browser?.close(); }
  }
}
