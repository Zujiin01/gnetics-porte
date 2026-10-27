// Copyright (c) 2026 Technologies GNETICS Inc. - PolyForm Noncommercial 1.0.0 (non-commercial use only, see LICENSE)
"use strict";
// Smoke test: starts the door in a temporary directory and checks every route.
const fs = require("fs"), os = require("os"), path = require("path"), http = require("http");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "door-"));
const root = path.join(tmp, "work"); fs.mkdirSync(root);
const cfgFile = path.join(tmp, "config.json");
fs.writeFileSync(cfgFile, JSON.stringify({ host: "127.0.0.1", port: 0, root, keysFile: path.join(tmp, "keys.json"),
  auditFile: path.join(tmp, "audit.jsonl"), rateLimitPerMinute: 1000, bashTimeoutMaxSec: 5, requirePlanForRisky: true }));
process.env.DOOR_CONFIG = cfgFile;
const { hash, newKey, saveKeys } = require("../lib/auth");
const mk = (id, scopes) => { const key = newKey(); return { key, row: { id, name: id, scopes, hash: hash(key) } }; };
const ro = mk("ro", ["read"]), rw = mk("rw", ["read", "write", "exec"]), ad = mk("ad", ["admin", "read", "write"]);
saveKeys(path.join(tmp, "keys.json"), { keys: [ro.row, rw.row, ad.row] });
const app = require("../server");
let fails = 0;
const ok = (name, cond, info) => { console.log((cond ? "OK   " : "FAIL ") + " " + name + (cond ? "" : "  " + JSON.stringify(info))); if (!cond) fails++; };

const srv = app.listen(0, "127.0.0.1", async () => {
  const port = srv.address().port;
  const call = (method, p, key, body, headers) => new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({ host: "127.0.0.1", port, method, path: p, headers: { "content-type": "application/json", ...(key ? { authorization: "Bearer " + key } : {}), ...(headers || {}) } }, (res) => {
      let b = ""; res.on("data", (d) => (b += d)); res.on("end", () => resolve({ s: res.statusCode, j: b ? JSON.parse(b) : {} }));
    }); if (data) r.write(data); r.end();
  });
  const C = "/api/v1/code/";
  ok("health public", (await call("GET", "/api/v1/health")).s === 200);
  ok("no key = 401", (await call("POST", C + "list", null, { path: "." })).s === 401);
  ok("wrong key = 401", (await call("POST", C + "list", "door_wrong", { path: "." })).s === 401);
  ok("read-only key cannot write", (await call("POST", C + "write", ro.key, { path: "a.txt", content: "x" })).s === 403);
  ok("read-only key cannot run bash", (await call("POST", C + "bash", ro.key, { command: "ls" })).s === 403);
  ok("write", (await call("POST", C + "write", rw.key, { path: "dir/a.txt", content: "hello\nworld\n" })).s === 200);
  const rd = await call("POST", C + "read", rw.key, { path: "dir/a.txt" });
  ok("read", rd.s === 200 && rd.j.content.includes("hello"), rd);
  ok("list", (await call("POST", C + "list", ro.key, { path: "dir" })).j.entries?.[0]?.name === "a.txt");
  ok("edit", (await call("POST", C + "edit", rw.key, { path: "dir/a.txt", old_string: "world", new_string: "door" })).s === 200);
  ok("grep", (await call("POST", C + "grep", ro.key, { pattern: "door" })).j.count === 1);
  ok("glob", (await call("POST", C + "glob", ro.key, { pattern: "*.txt" })).j.count === 1);
  ok("outside root refused (..)", (await call("POST", C + "read", rw.key, { path: "../../etc/passwd" })).s === 400);
  ok("outside root refused (absolute)", (await call("POST", C + "read", rw.key, { path: "/etc/passwd" })).s === 400);
  fs.symlinkSync("/etc", path.join(root, "link"));
  ok("symlink out of root refused", (await call("POST", C + "read", rw.key, { path: "link/passwd" })).s === 400);
  fs.symlinkSync("/tmp/door-outside-nonexistent", path.join(root, "broken"));
  ok("broken symlink refused on write", (await call("POST", C + "write", rw.key, { path: "broken", content: "x" })).s === 400 && !fs.existsSync("/tmp/door-outside-nonexistent"));
  ok("null byte refused", (await call("POST", C + "read", rw.key, { path: "a\u0000b" })).s === 400);
  ok("grep \\d (PCRE)", (await call("POST", C + "write", rw.key, { path: "n.txt", content: "value 42\n" })).s === 200 && (await call("POST", C + "grep", rw.key, { pattern: "\\d+", glob: "n.txt" })).j.count === 1);
  ok("grep on a single file returns the name", (await call("POST", C + "grep", rw.key, { pattern: "value", path: "n.txt" })).j.matches?.[0]?.file === "n.txt");
  ok("grep invalid regex = 400", (await call("POST", C + "grep", rw.key, { pattern: "(" })).s === 400);
  ok("grep cannot leave the root", (await call("POST", C + "grep", rw.key, { pattern: "root", path: "/etc" })).s === 400);
  const bad = await new Promise((resolve) => { const r = http.request({ host: "127.0.0.1", port, method: "POST", path: C + "list", headers: { "content-type": "application/json", authorization: "Bearer " + rw.key } }, (res) => { let t = ""; res.on("data", (d) => (t += d)); res.on("end", () => resolve({ s: res.statusCode, t })); }); r.write("{pas du json"); r.end(); });
  ok("invalid JSON = clean 400", bad.s === 400 && bad.t.startsWith("{") && !bad.t.includes("at "), bad);
  const b = await call("POST", C + "bash", rw.key, { command: "echo hi && pwd" });
  ok("bash", b.s === 200 && b.j.stdout.includes("hi") && b.j.stdout.includes("work"), b);
  ok("bash blocklist", (await call("POST", C + "bash", rw.key, { command: "rm -rf /" })).s === 403);
  ok("bash blocklist (rm -rf /*)", (await call("POST", C + "bash", rw.key, { command: "rm -rf /*" })).s === 403);
  ok("bash sudo without admin = 403", (await call("POST", C + "bash", rw.key, { command: "sudo ls" })).s === 403);
  const risky = await call("POST", C + "bash", ad.key, { command: "sudo -n true" });
  ok("risky command = 428 plan_required", risky.s === 428, risky);
  const plan = JSON.stringify({ objective: "test", command: "sudo -n true", risk: "low", rollback: "none" });
  ok("accepted with a plan (executes)", (await call("POST", C + "bash", ad.key, { command: "sudo -n true" }, { "x-action-plan": plan })).s === 200);
  ok("timeout", (await call("POST", C + "bash", rw.key, { command: "sleep 10", timeout_sec: 1 })).j.timed_out === true);
  const aud = await call("GET", "/api/v1/code/audit?limit=1000", ad.key);
  ok("401 refusal logged", aud.j.entries.some((e) => e.action === "auth" && e.status === "refused"), aud.j.entries.slice(-3));
  ok("403 (scope) refusal logged", aud.j.entries.some((e) => e.action === "scope" && e.status === "refused"));
  const au = await call("GET", "/api/v1/code/audit", ad.key);
  ok("audit as admin", au.s === 200 && au.j.entries.length > 10, au.s);
  ok("audit refused without admin", (await call("GET", "/api/v1/code/audit", rw.key)).s === 403);
  const aud2 = await call("GET", "/api/v1/code/audit?limit=1000", ad.key);
  ok("refused /audit access is logged", aud2.j.entries.some((e) => e.action === "scope" && e.route === "/audit"), aud2.j.entries.slice(-2));
  const toolsDef = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "tools", "door-tools.json"), "utf8"));
  const serverSrc = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  ok("tool definitions match the server routes", toolsDef.tools.length === 7 && toolsDef.tools.every((x) => serverSrc.includes('api.post("/' + x.path.split("/").pop() + '"')), toolsDef.tools.map((x) => x.path));
  srv.close(); fs.rmSync(tmp, { recursive: true, force: true });
  console.log(fails ? "\n" + fails + " failure(s)" : "\nAll tests pass."); process.exit(fails ? 1 : 0);
});
