// Drive a headless Edge over the DevTools protocol: load a page, run steps,
// take screenshots, and print the page's console and errors.
//
// Start Edge first (tools/edge.ps1 does it with the right flags), then:
//   node tools/shot.js --url=<url> [--w=1280 --h=720] [--port=9333] \
//        --wait=2000 --eval="TB3D.start(0)" --wait=1500 --shot=Work/a.png ...
// Steps run in the order given. --mobile emulates a phone (touch, dpr 3).
"use strict";
const fs = require("fs");
const path = require("path");

const steps = [];
const opt = { w: 1280, h: 720, port: 9333, url: null, mobile: false };
process.argv.slice(2).forEach(function (a) {
  const m = /^--([a-z]+)(?:=(.*))?$/s.exec(a);
  if (!m) return;
  const k = m[1];
  const v = m[2];
  if (k === "evalfile") steps.push({ k: "eval", v: fs.readFileSync(v, "utf8") });
  else if (k === "wait" || k === "eval" || k === "shot" || k === "key" || k === "hold") steps.push({ k: k, v: v });
  else if (k === "mobile") opt.mobile = true;
  else opt[k] = /^\d+$/.test(v) ? parseInt(v, 10) : v;
});

async function main() {
  const list = await (await fetch("http://127.0.0.1:" + opt.port + "/json/list")).json();
  let target = list.find(function (t) { return t.type === "page"; });
  if (!target) {
    target = await (await fetch("http://127.0.0.1:" + opt.port + "/json/new?about:blank", { method: "PUT" })).json();
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(function (r, j) { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = function (ev) {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    } else if (msg.method === "Runtime.consoleAPICalled") {
      const text = msg.params.args.map(function (x) { return x.value !== undefined ? x.value : (x.description || x.type); }).join(" ");
      console.log("[console." + msg.params.type + "] " + text);
    } else if (msg.method === "Runtime.exceptionThrown") {
      const d = msg.params.exceptionDetails;
      console.log("[exception] " + (d.exception && d.exception.description || d.text) + " @" + d.url + ":" + d.lineNumber);
    } else if (msg.method === "Log.entryAdded") {
      console.log("[log." + msg.params.entry.level + "] " + msg.params.entry.text);
    }
  };
  function send(method, params) {
    return new Promise(function (r) {
      const i = ++id;
      pending.set(i, r);
      ws.send(JSON.stringify({ id: i, method: method, params: params || {} }));
    });
  }
  await send("Runtime.enable");
  await send("Log.enable");
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width: opt.w, height: opt.h, deviceScaleFactor: opt.dpr || (opt.mobile ? 3 : 1), mobile: opt.mobile
  });
  if (opt.mobile) await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await send("Page.navigate", { url: opt.url });
  for (const s of steps) {
    if (s.k === "wait") await new Promise(function (r) { setTimeout(r, parseInt(s.v, 10)); });
    else if (s.k === "eval") {
      const res = await send("Runtime.evaluate", { expression: s.v, awaitPromise: true, returnByValue: true });
      const r = res.result;
      if (r && r.exceptionDetails) console.log("[eval error] " + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
      else if (r && r.result && r.result.value !== undefined) console.log("[eval] " + JSON.stringify(r.result.value));
    } else if (s.k === "key" || s.k === "hold") {
      // --key=ArrowUp taps; --hold=ArrowUp:800 holds for ms.
      const parts = s.v.split(":");
      const key = parts[0];
      const code = key.length === 1 ? "Key" + key.toUpperCase() : key;
      const text = key === "Space" ? " " : (key.length === 1 ? key : undefined);
      const k = key === "Space" ? " " : key;
      await send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code: key === "Space" ? "Space" : code, text: text });
      if (s.k === "hold") await new Promise(function (r) { setTimeout(r, parseInt(parts[1] || "300", 10)); });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code: key === "Space" ? "Space" : code });
    } else if (s.k === "shot") {
      const res = await send("Page.captureScreenshot", { format: "png" });
      const out = path.resolve(s.v);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, Buffer.from(res.result.data, "base64"));
      console.log("[shot] " + out);
    }
  }
  ws.close();
}
main().catch(function (e) { console.error(e); process.exit(1); });
