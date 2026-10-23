// A minimal WebDriver client for WebKitGTK (Safari's engine, WebCore) where Playwright's WebKit cannot be installed (the
// cloud container): `WebKitWebDriver --port=4444` with MiniBrowser, under Xvfb. Enough to load a page, run script and
// send pointer and key actions.
//
//   const wk = await webkit('http://127.0.0.1:4444', { width: 1300, height: 900 })
//   await wk.go(url) · await wk.js(fn, ...args) (an async function's result) · await wk.click(x, y) · await wk.key('Escape')
//   await wk.close()
//
// Setup (Ubuntu): apt-get install webkit2gtk-driver xvfb; Xvfb :99 &; DISPLAY=:99 WebKitWebDriver --port=4444 &
export interface WebKit {
  go(url: string): Promise<void>;
  js<T>(fn: string | ((...a: any[]) => any), ...args: unknown[]): Promise<T>;
  click(x: number, y: number): Promise<void>;
  move(x: number, y: number): Promise<void>;
  key(k: 'Escape' | string): Promise<void>;
  close(): Promise<void>;
}

const KEYS: Record<string, string> = { Escape: '', Enter: '' };

export async function webkit(base = 'http://127.0.0.1:4444', { width = 1300, height = 900 } = {}): Promise<WebKit> {
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body == null ? undefined : JSON.stringify(body) });
    const j = await r.json() as { value: any };
    if (!r.ok) throw new Error(`webdriver ${method} ${path}: ${JSON.stringify(j.value).slice(0, 300)}`);
    return j.value;
  };
  const s = await call('POST', '/session', { capabilities: { alwaysMatch: { browserName: 'MiniBrowser', 'webkitgtk:browserOptions': { binary: '/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/MiniBrowser', args: ['--automation'] } } } });
  const id = s.sessionId as string, P = `/session/${id}`;
  await call('POST', `${P}/window/rect`, { width, height });
  const pointer = (x: number, y: number, press: boolean) => call('POST', `${P}/actions`, { actions: [{ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' },
    actions: [{ type: 'pointerMove', duration: 0, x: Math.round(x), y: Math.round(y), origin: 'viewport' }, ...(press ? [{ type: 'pointerDown', button: 0 }, { type: 'pointerUp', button: 0 }] : [])] }] });
  return {
    go: async (url) => { await call('POST', `${P}/url`, { url }); },
    js: async (fn, ...args) => {
      const src = typeof fn === 'string' ? fn : `return (${fn.toString()})(...arguments)`;
      // an async script: the last argument is the callback
      return call('POST', `${P}/execute/async`, { script: `const done = arguments[arguments.length - 1]; Promise.resolve((function () { ${src} }).apply(null, [...arguments].slice(0, -1))).then(done, (e) => done({ __error: String(e && e.stack || e) }));`, args });
    },
    click: async (x, y) => { await pointer(x, y, true); },
    move: async (x, y) => { await pointer(x, y, false); },
    key: async (k) => { const v = KEYS[k] ?? k; await call('POST', `${P}/actions`, { actions: [{ type: 'key', id: 'kb', actions: [{ type: 'keyDown', value: v }, { type: 'keyUp', value: v }] }] }); },
    close: async () => { await call('DELETE', P).catch(() => {}); },
  };
}

/** The part of a Playwright page the suites' helpers use (evaluate, waits, mouse, keyboard, $), over WebDriver: a suite
 *  written for Playwright then runs in WebKitGTK too (tests/test-zoom-caret.ts --browser webkit-gtk). */
export function asPage(wk: WebKit) {
  const evaluate = async <T>(fn: (a?: any) => any, arg?: unknown): Promise<T> => {
    const r = await wk.js<any>(`return (${fn.toString()})(arguments[0])`, arg ?? null);
    if (r && typeof r === 'object' && '__error' in r) throw new Error(r.__error);
    return r as T;
  };
  const poll = async (cond: () => Promise<boolean>, timeout = 60000) => {
    const t0 = Date.now();
    for (;;) { if (await cond()) return; if (Date.now() - t0 > timeout) throw new Error('webkit: timed out waiting'); await new Promise((r) => setTimeout(r, 50)); }
  };
  return {
    goto: (url: string) => wk.go(url),
    evaluate,
    waitForFunction: (fn: (a?: any) => any, arg?: unknown, o: { timeout?: number } = {}) => poll(async () => !!(await evaluate(fn, arg)), o.timeout),
    waitForSelector: (sel: string, o: { timeout?: number } = {}) => poll(async () => !!(await evaluate((s: string) => !!document.querySelector(s), sel)), o.timeout),
    $: async (sel: string) => ((await evaluate((s: string) => !!document.querySelector(s), sel)) ? {} : null),
    mouse: { move: (x: number, y: number) => wk.move(x, y), click: (x: number, y: number) => wk.click(x, y) },
    keyboard: { press: (k: string) => wk.key(k) },
    setDefaultTimeout: () => {},
  };
}
