// Copyright (c) 2026 Technologies GNETICS Inc. - PolyForm Noncommercial 1.0.0 (non-commercial use only, see LICENSE)
"use strict";
const express = require("express");
const fs = require("fs");
const path = require("path");
const { authMiddleware, need, rateLimit, setAudit } = require("./lib/auth");
const { makeAudit, readAudit } = require("./lib/audit");
const { resolveSafe, validateBash, parsePlan, runBash, runFile, PLAN_FIELDS } = require("./lib/sandbox");

const cfgPath = process.env.DOOR_CONFIG || path.join(__dirname, "config.json");
const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
const ROOT = fs.realpathSync(cfg.root);
const audit = makeAudit(cfg.auditFile);
setAudit(audit);

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "8mb" }));

// Public: lets you check that the door answers. Reveals nothing else.
app.get("/api/v1/health", (req, res) => res.json({ ok: true, service: "door" }));

const api = express.Router();
api.use(authMiddleware(cfg.keysFile), rateLimit(cfg.rateLimitPerMinute || 60));

// Common wrapper: timing, audit, clean errors.
function handler(action, scope, fn) {
  return [need(scope), async (req, res) => {
    const t0 = Date.now();
    let target = null;
    try {
      const out = await fn(req, (t) => { target = t; });
      audit({ key: req.key.id, action, target, status: "ok", ...(out && out.exit_code !== undefined ? { exit_code: out.exit_code, timed_out: out.timed_out } : {}), ms: Date.now() - t0, session: req.get("x-session") || null, ip: req.get("x-real-ip") || req.ip });
      res.json(out);
    } catch (e) {
      const code = e.httpCode || 400;
      audit({ key: req.key.id, action, target, status: "error", error: e.message, ms: Date.now() - t0, ip: req.get("x-real-ip") || req.ip });
      res.status(code).json({ error: e.message, ...(e.extra || {}) });
    }
  }];
}
const fail = (code, msg, extra) => Object.assign(new Error(msg), { httpCode: code, extra });
const rel = (abs) => path.relative(ROOT, abs) || ".";

api.post("/read", ...handler("read", "read", (req, seen) => {
  const abs = resolveSafe(ROOT, req.body.path); seen(rel(abs));
  if (fs.statSync(abs).isDirectory()) throw new Error("This is a directory (use /list)");
  if (fs.statSync(abs).size > 8 * 1024 * 1024) throw new Error("File larger than 8 MB");
  const lines = fs.readFileSync(abs, "utf8").split("\n");
  const offset = Math.max(0, parseInt(req.body.offset, 10) || 0);
  const limit = Math.min(parseInt(req.body.limit, 10) || lines.length, 5000);
  const slice = lines.slice(offset, offset + limit);
  return { path: rel(abs), total_lines: lines.length, offset, returned_lines: slice.length,
           content: slice.map((l, i) => String(offset + i + 1).padStart(6) + "\t" + l).join("\n") };
}));

api.post("/list", ...handler("list", "read", (req, seen) => {
  const abs = resolveSafe(ROOT, req.body.path || "."); seen(rel(abs));
  if (!fs.statSync(abs).isDirectory()) throw new Error("Not a directory");
  const entries = fs.readdirSync(abs, { withFileTypes: true }).map((e) => ({
    name: e.name, type: e.isDirectory() ? "dir" : e.isFile() ? "file" : "other",
    ...(e.isFile() ? { size: fs.statSync(path.join(abs, e.name)).size } : {}) }))
    .sort((a, b) => (a.type === "dir" ? 0 : 1) - (b.type === "dir" ? 0 : 1) || a.name.localeCompare(b.name));
  return { path: rel(abs), entries };
}));

function walk(dir, out, max) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (out.length >= max) return;
    if (e.name === "node_modules" || e.name === ".git") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out, max); else if (e.isFile()) out.push(p);
  }
}
const globToRe = (g) => new RegExp("^" + g.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\u0000/g, ".*").replace(/\?/g, "[^/]") + "$");

api.post("/glob", ...handler("glob", "read", (req, seen) => {
  const pattern = String(req.body.pattern || ""); if (!pattern) throw new Error("pattern is required");
  if (pattern.length > 200) throw new Error("pattern too long (200 chars max)");
  const base = resolveSafe(ROOT, req.body.cwd || "."); seen(pattern);
  const all = []; walk(base, all, 20000);
  const re = globToRe(pattern);
  const files = all.map((f) => path.relative(base, f)).filter((f) => re.test(f) || re.test(path.basename(f))).slice(0, 200);
  return { pattern, count: files.length, files };
}));

api.post("/grep", ...handler("grep", "read", async (req, seen) => {
  const pattern = String(req.body.pattern || ""); if (!pattern) throw new Error("pattern is required");
  if (pattern.length > 500) throw new Error("pattern too long (500 chars max)");
  const base = resolveSafe(ROOT, req.body.path || "."); seen(pattern);
  // grep runs in a separate process with a timeout: a pathological regex cannot block the door.
  const args = ["-rHInP", "--exclude-dir=node_modules", "--exclude-dir=.git", "--max-count=50"];
  if (req.body.ignore_case) args.push("-i");
  if (req.body.glob) { const g = String(req.body.glob); if (g.startsWith("-")) throw new Error("invalid glob"); args.push("--include=" + g); }
  args.push("-e", pattern, "--", base);
  const r = await runFile("grep", args, { cwd: ROOT, timeoutMs: 15000 });
  if (r.timed_out) throw new Error("grep took too long (15 s): narrow the pattern or the directory");
  if (r.exit_code > 1) throw new Error("Invalid expression or grep error: " + r.stderr.split("\n")[0]);
  const matches = [];
  for (const line of r.stdout.split("\n")) {
    const m = line.match(/^(.*?):(\d+):(.*)$/);
    if (m && matches.length < 200) matches.push({ file: rel(m[1]), line: +m[2], text: m[3].slice(0, 300) });
  }
  return { pattern, count: matches.length, matches };
}));

api.post("/write", ...handler("write", "write", (req, seen) => {
  if (typeof req.body.content !== "string") throw new Error("content is required (text)");
  const abs = resolveSafe(ROOT, req.body.path); seen(rel(abs));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, req.body.content);
  return { path: rel(abs), bytes: Buffer.byteLength(req.body.content) };
}));

api.post("/edit", ...handler("edit", "write", (req, seen) => {
  const { old_string: o, new_string: n, replace_all: all } = req.body;
  if (typeof o !== "string" || typeof n !== "string" || !o) throw new Error("old_string and new_string are required");
  const abs = resolveSafe(ROOT, req.body.path); seen(rel(abs));
  const txt = fs.readFileSync(abs, "utf8");
  const count = txt.split(o).length - 1;
  if (count === 0) throw new Error("old_string not found");
  if (count > 1 && !all) throw new Error(count + " occurrences: be more specific or use replace_all");
  fs.writeFileSync(abs, all ? txt.split(o).join(n) : txt.replace(o, () => n));
  return { path: rel(abs), replaced: all ? count : 1 };
}));

api.post("/bash", ...handler("bash", "exec", async (req, seen) => {
  const command = req.body.command; seen(String(command || "").slice(0, 200));
  const v = validateBash(command, req.key.scopes);
  if (!v.ok) throw fail(v.code, v.error);
  let plan = null;
  if (v.risky && cfg.requirePlanForRisky !== false) {
    plan = parsePlan(req.get("x-action-plan"));
    if (!plan) throw fail(428, "plan_required: risky command. Resend it with an X-Action-Plan header (JSON: " + PLAN_FIELDS.join(", ") + ")", { plan_required: true, fields: PLAN_FIELDS });
    audit({ key: req.key.id, action: "plan", target: plan.objective, plan });
  }
  const sec = Math.min(Math.max(parseInt(req.body.timeout_sec, 10) || 30, 1), cfg.bashTimeoutMaxSec || 120);
  return runBash(command, { cwd: ROOT, timeoutMs: sec * 1000 });
}));

api.get("/audit", (req, res) => {
  if (!req.key.scopes.includes("admin")) {
    audit({ key: req.key.id, action: "scope", status: "refused", error: "scope required: admin", route: req.path, ip: req.get("x-real-ip") || req.ip });
    return res.status(403).json({ error: "Scope required: admin" });
  }
  res.json({ entries: readAudit(cfg.auditFile, Math.min(parseInt(req.query.limit, 10) || 100, 1000)) });
});

app.use("/api/v1/code", api);
app.use((req, res) => res.status(404).json({ error: "Unknown route" }));
// Errors (malformed JSON, body too large): always a clean JSON answer, no stack trace.
app.use((err, req, res, next) => res.status(err.status || 400).json({ error: err.type === "entity.too.large" ? "Body too large" : "Invalid request" }));

if (require.main === module) {
  app.listen(cfg.port, cfg.host || "127.0.0.1", () => console.log("door listening on " + (cfg.host || "127.0.0.1") + ":" + cfg.port + ", root " + ROOT));
}
module.exports = app;
