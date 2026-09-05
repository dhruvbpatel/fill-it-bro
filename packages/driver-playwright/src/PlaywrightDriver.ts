import { chromium, type Browser, type ElementHandle, type Locator, type Page } from 'playwright';
import { NeverClickError, type BrowserDriver, type LocatorSpec, type Ref } from '@fib/core';

type AriaRole = Parameters<Locator['getByRole']>[0];

const INTERACTIVE_SELECTOR =
  'button, a, input, select, textarea, [role=option], [role=tab], [role=gridcell], [contenteditable]';

const CONNECT_TIMEOUT_MS = 10_000;
const POLL_INTERVAL_MS = 100;

export class StableTimeout extends Error {
  constructor(maxMs: number) {
    super(`waitStable: element did not settle within ${maxMs} ms`);
    this.name = 'StableTimeout';
  }
}

type ElementT = ElementHandle<SVGElement | HTMLElement>;
type Scope = Page | Locator;
type Target = { kind: 'locator'; locator: Locator } | { kind: 'handle'; handle: ElementT };

type Described = { ref: string; role: string; name: string };

function isRef(t: LocatorSpec | Ref): t is Ref {
  return typeof (t as Ref).ref === 'string';
}

function parseRoleName(name: string): string | RegExp {
  const match = /^\/(.*)\/([a-z]*)$/.exec(name);
  return match ? new RegExp(match[1] as string, match[2]) : name;
}

function escapeCssString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function describeElement(el: Element): { role: string; name: string } {
  let role = el.getAttribute('role') ?? '';
  if (!role) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'button') role = 'button';
    else if (tag === 'a') role = 'link';
    else if (tag === 'select') role = 'combobox';
    else if (tag === 'textarea') role = 'textbox';
    else if (tag === 'input') {
      const type = (el as HTMLInputElement).type;
      if (type === 'checkbox') role = 'checkbox';
      else if (type === 'radio') role = 'radio';
      else if (type === 'button' || type === 'submit' || type === 'reset') role = 'button';
      else role = 'textbox';
    } else if ((el as HTMLElement).isContentEditable) {
      role = 'textbox';
    }
  }

  let name = el.getAttribute('aria-label') ?? '';
  if (!name) {
    const labelledby = el.getAttribute('aria-labelledby');
    if (labelledby) {
      name = labelledby
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent ?? '')
        .join(' ')
        .trim();
    }
  }
  if (!name) {
    const label =
      el.closest('label') ?? (el.id ? document.querySelector(`label[for="${el.id}"]`) : null);
    if (label) name = (label.textContent ?? '').trim();
  }
  if (
    !name &&
    (role === 'button' ||
      role === 'link' ||
      role === 'tab' ||
      role === 'option' ||
      role === 'gridcell')
  ) {
    name = (el.textContent ?? '').trim();
  }
  return { role, name };
}

function annotateSnapshot(yaml: string, described: Described[]): string {
  const lines = yaml.split('\n');
  const used = new Set<number>();
  const ordered = [...described].sort((a, b) => (a.name ? 0 : 1) - (b.name ? 0 : 1));
  for (const d of ordered) {
    const namePart = d.name ? ` "${escapeRegExp(d.name)}"` : '';
    const pattern = new RegExp(`^(\\s*- ${escapeRegExp(d.role)}${namePart})(?=\\s|\\[|$)`);
    const index = lines.findIndex((line, i) => !used.has(i) && pattern.test(line));
    if (index >= 0) {
      lines[index] = `${lines[index]} [ref=${d.ref}]`;
      used.add(index);
    }
  }
  return lines.join('\n');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class PlaywrightDriver implements BrowserDriver {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private neverClick: LocatorSpec[] = [];
  private refs = new Map<string, ElementT>();

  async connect(cdpUrl: string, pageUrl: RegExp): Promise<void> {
    if (this.browser) throw new Error('connect: driver is already connected');
    this.browser = await chromium.connectOverCDP(cdpUrl);
    const deadline = Date.now() + CONNECT_TIMEOUT_MS;
    for (;;) {
      const page = this.browser
        .contexts()
        .flatMap((context) => context.pages())
        .find((candidate) => pageUrl.test(candidate.url()));
      if (page) {
        this.page = page;
        return;
      }
      if (Date.now() >= deadline) {
        await this.browser.close();
        this.browser = null;
        throw new Error(`connect: no page matching ${pageUrl.toString()} within 10 s`);
      }
      await sleep(POLL_INTERVAL_MS);
    }
  }

  async close(): Promise<void> {
    this.refs.clear();
    this.page = null;
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  setNeverClick(patterns: LocatorSpec[]): void {
    this.neverClick = patterns;
  }

  async click(t: LocatorSpec | Ref): Promise<void> {
    const target = this.toTarget(t);
    await this.assertNotNeverClick(target);
    if (target.kind === 'handle') await target.handle.click();
    else await target.locator.click();
  }

  async type(t: LocatorSpec | Ref, text: string, opts?: { clear?: boolean }): Promise<void> {
    const target = this.toTarget(t);
    if (target.kind === 'handle') {
      if (opts?.clear) await target.handle.fill('');
      for (const ch of text) await target.handle.press(ch);
    } else {
      if (opts?.clear) await target.locator.fill('');
      await target.locator.pressSequentially(text);
    }
  }

  async fill(t: LocatorSpec | Ref, text: string): Promise<void> {
    const target = this.toTarget(t);
    if (target.kind === 'handle') await target.handle.fill(text);
    else await target.locator.fill(text);
  }

  async selectByLabel(t: LocatorSpec | Ref, label: string): Promise<void> {
    const target = this.toTarget(t);
    if (target.kind === 'handle') await target.handle.selectOption({ label });
    else await target.locator.selectOption({ label });
  }

  async press(t: LocatorSpec | Ref, key: string): Promise<void> {
    const target = this.toTarget(t);
    if (target.kind === 'handle') await target.handle.press(key);
    else await target.locator.press(key);
  }

  async readValue(t: LocatorSpec | Ref): Promise<string | null> {
    const target = this.toTarget(t);
    const tag =
      target.kind === 'handle'
        ? await target.handle.evaluate((el) => el.tagName.toLowerCase())
        : await target.locator.evaluate((el) => el.tagName.toLowerCase());
    if (tag === 'input') {
      const type =
        target.kind === 'handle'
          ? await target.handle.evaluate((el) => (el as HTMLInputElement).type)
          : await target.locator.evaluate((el) => (el as HTMLInputElement).type);
      if (type === 'checkbox') {
        return (await this.isChecked(target)) ? 'true' : 'false';
      }
    }
    if (tag === 'input' || tag === 'select' || tag === 'textarea') {
      return target.kind === 'handle'
        ? await target.handle.inputValue()
        : await target.locator.inputValue();
    }
    return target.kind === 'handle'
      ? await target.handle.innerText()
      : await target.locator.innerText();
  }

  async readText(t: LocatorSpec | Ref): Promise<string> {
    const target = this.toTarget(t);
    return target.kind === 'handle'
      ? await target.handle.innerText()
      : await target.locator.innerText();
  }

  async count(t: LocatorSpec): Promise<number> {
    return this.resolveLocator(t).count();
  }

  async waitFor(
    t: LocatorSpec | Ref,
    state: 'visible' | 'hidden' | 'attached',
    timeoutMs: number,
  ): Promise<void> {
    const target = this.toTarget(t);
    if (target.kind === 'handle') {
      if (state === 'attached') {
        const connected = await target.handle.evaluate((el) => el.isConnected);
        if (connected) return;
        throw new Error('waitFor: ref target is detached from the DOM');
      }
      await target.handle.waitForElementState(state, { timeout: timeoutMs });
    } else {
      await target.locator.waitFor({ state, timeout: timeoutMs });
    }
  }

  async waitStable(t: LocatorSpec, settleMs: number, maxMs: number): Promise<void> {
    const locator = this.resolveLocator(t);
    const deadline = Date.now() + maxMs;
    let lastText: string | null = null;
    let lastChangeAt = Date.now();
    for (;;) {
      let text: string | null;
      const budget = Math.max(1, Math.min(500, deadline - Date.now()));
      try {
        text = await locator.innerText({ timeout: budget });
      } catch {
        text = null;
      }
      if (text === null || text !== lastText) {
        lastText = text;
        lastChangeAt = Date.now();
      }
      if (Date.now() - lastChangeAt >= settleMs) return;
      if (Date.now() >= deadline) throw new StableTimeout(maxMs);
      await sleep(POLL_INTERVAL_MS);
    }
  }

  async ariaSnapshot(scope?: LocatorSpec): Promise<{ yaml: string; refs: string[] }> {
    const page = this.requirePage();
    const scopeLocator = scope ? this.resolveLocator(scope) : page.locator('body');
    const yaml = await scopeLocator.ariaSnapshot();
    const interactive = scopeLocator.locator(INTERACTIVE_SELECTOR);
    const total = await interactive.count();
    this.refs.clear();
    const described: Described[] = [];
    for (let i = 0; i < total; i++) {
      const handle = await interactive.nth(i).elementHandle();
      if (!handle) continue;
      const ref = `e${i + 1}`;
      this.refs.set(ref, handle);
      described.push({ ref, ...(await handle.evaluate(describeElement)) });
    }
    return { yaml: annotateSnapshot(yaml, described), refs: [...this.refs.keys()] };
  }

  private requirePage(): Page {
    if (!this.page) throw new Error('driver is not connected; call connect(cdpUrl, pageUrl) first');
    return this.page;
  }

  private resolveLocator(spec: LocatorSpec): Locator {
    const scope: Scope = spec.within ? this.resolveLocator(spec.within) : this.requirePage();
    let locator: Locator;
    if (spec.formControlName !== undefined) {
      locator = scope.locator(`[formcontrolname="${escapeCssString(spec.formControlName)}" i]`);
    } else if (spec.label !== undefined) {
      locator = scope.getByLabel(spec.label);
    } else if (spec.role !== undefined) {
      locator = scope.getByRole(spec.role.role as AriaRole, {
        name: parseRoleName(spec.role.name),
      });
    } else if (spec.css !== undefined) {
      locator = scope.locator(spec.css);
    } else {
      throw new Error('LocatorSpec must set one of formControlName | label | role | css');
    }
    return spec.nth !== undefined ? locator.nth(spec.nth) : locator;
  }

  private toTarget(t: LocatorSpec | Ref): Target {
    if (isRef(t)) {
      const handle = this.refs.get(t.ref);
      if (!handle) throw new Error(`unknown ref "${t.ref}"; take an ariaSnapshot first`);
      return { kind: 'handle', handle };
    }
    return { kind: 'locator', locator: this.resolveLocator(t) };
  }

  private async isChecked(target: Target): Promise<boolean> {
    return target.kind === 'handle'
      ? await target.handle.isChecked()
      : await target.locator.isChecked();
  }

  private async assertNotNeverClick(target: Target): Promise<void> {
    if (this.neverClick.length === 0) return;
    const page = this.requirePage();
    const targetHandle =
      target.kind === 'handle' ? target.handle : ((await target.locator.elementHandle()) ?? null);
    if (!targetHandle) return;
    for (const pattern of this.neverClick) {
      const locator = this.resolveLocator(pattern);
      const matches = await locator.count();
      for (let i = 0; i < matches; i++) {
        const handle = await locator.nth(i).elementHandle();
        if (!handle) continue;
        const sameElement = await page.evaluate(([a, b]) => a === b, [targetHandle, handle]);
        if (sameElement) {
          throw new NeverClickError(
            `refused to click: target matches neverClick pattern ${JSON.stringify(pattern)}`,
          );
        }
      }
    }
  }
}
