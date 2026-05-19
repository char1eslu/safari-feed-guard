// Minimal CDP client (Node global WebSocket) to self-verify the extension
// in the locally-loaded Chrome. Usage: node scripts/cdp-check.mjs [url]
const BASE = "http://localhost:9222";
const want = process.argv[2];

const targets = await (await fetch(`${BASE}/json/list`)).json();
const page =
  targets.find((t) => t.type === "page" && (!want || t.url.includes(want))) ||
  targets.find((t) => t.type === "page");
if (!page) {
  console.error("no page target");
  process.exit(1);
}
console.log("target:", page.url);

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const send = (method, params = {}) =>
  new Promise((res) => {
    const m = ++id;
    pending.set(m, res);
    ws.send(JSON.stringify({ id: m, method, params }));
  });
ws.addEventListener("message", (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg.result);
    pending.delete(msg.id);
  }
});
await new Promise((r) => ws.addEventListener("open", r));

if (process.env.RELOAD) {
  await send("Page.enable");
  await send("Page.reload", { ignoreCache: true });
  await new Promise((r) => setTimeout(r, 6000));
}

const diag = `(() => {
  const host = document.querySelector('xss-bubble');
  const sr = host && host.shadowRoot;
  const bubble = sr && sr.querySelector('.xss-bubble');
  const pill = sr && sr.querySelector('.pill');
  const cs = bubble ? getComputedStyle(bubble) : null;
  const badges = document.querySelectorAll('[data-testid="User-Name"] span[style*="inline-flex"]').length;
  return JSON.stringify({
    contentScriptMounted: !!host,
    bubblePresent: !!bubble,
    pillText: pill ? pill.innerText.trim() : null,
    pos: cs ? { position: cs.position, top: cs.top, right: cs.right, bottom: cs.bottom, z: cs.zIndex } : null,
    inlineBadgeHosts: badges,
    articles: document.querySelectorAll('article[data-testid="tweet"]').length,
    colorScheme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  });
})()`;

const { result } = await send("Runtime.evaluate", {
  expression: diag,
  returnByValue: true,
});
console.log("DIAG:", result.value);

const shot = await send("Page.captureScreenshot", { format: "png" });
const fs = await import("node:fs");
fs.writeFileSync("/tmp/xss-shot.png", Buffer.from(shot.data, "base64"));
console.log("screenshot: /tmp/xss-shot.png");
ws.close();
process.exit(0);
