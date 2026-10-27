// Copyright (c) 2026 Technologies GNETICS Inc. - PolyForm Noncommercial 1.0.0 (non-commercial use only, see LICENSE)
"use strict";
// API keys: "door_<32 chars>". Only the SHA-256 hash is stored (keys.json). The plain key is
// shown once, at creation.
const crypto = require("crypto");
const fs = require("fs");

const SCOPES = ["read", "write", "exec", "admin"];
// read  : read, list, search
// write : create and modify files
// exec  : run commands (bash) without sudo
// admin : exec + sudo (if the system allows it) + audit log

const hash = (k) => crypto.createHash("sha256").update(k).digest("hex");
const newKey = () => "door_" + crypto.randomBytes(24).toString("base64url").slice(0, 32);

function loadKeys(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return { keys: [] }; }
}
// Keys belong to root and are readable (not writable) by the group of the user running the door.
function saveKeys(file, data, group) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), { mode: 0o640 });
  if (group && process.getuid && process.getuid() === 0) {
    const out = require("child_process").execFileSync("getent", ["group", group]).toString().trim().split(":");
    fs.chownSync(file, 0, parseInt(out[2], 10));
    fs.chmodSync(file, 0o640);
  }
}

// Refusals log (injected by server.js): 401, 403 and 429 are also written to the audit.
let auditFn = () => {};
const setAudit = (fn) => { auditFn = fn; };
const ipOf = (req) => req.get("x-real-ip") || req.ip;

// Too many authentication failures from one address: slow down (30 per minute).
const fails = new Map();
const tooManyFails = (ip) => (fails.get(ip) || []).filter((t) => Date.now() - t < 60000).length >= 30;
const noteFail = (ip) => fails.set(ip, [...(fails.get(ip) || []).filter((t) => Date.now() - t < 60000), Date.now()]);

function authMiddleware(keysFile) {
  return (req, res, next) => {
    const ip = ipOf(req);
    if (tooManyFails(ip)) { auditFn({ action: "auth", status: "throttled", ip }); return res.status(429).json({ error: "Too many failures, try again in a minute" }); }
    const m = String(req.headers.authorization || "").match(/^Bearer\s+(.+)$/i);
    if (!m) { noteFail(ip); auditFn({ action: "auth", status: "refused", error: "missing key", route: req.path, ip }); return res.status(401).json({ error: "Key required (Authorization: Bearer <key>)" }); }
    const h = hash(m[1].trim());
    const row = loadKeys(keysFile).keys.find((k) => k.hash === h && !k.revoked);
    if (!row) { noteFail(ip); auditFn({ action: "auth", status: "refused", error: "invalid or revoked key", route: req.path, ip }); return res.status(401).json({ error: "Invalid or revoked key" }); }
    req.key = { id: row.id, name: row.name, scopes: row.scopes };
    next();
  };
}

const need = (scope) => (req, res, next) => {
  const s = req.key.scopes;
  // admin covers exec; read and write must be granted explicitly
  if (s.includes(scope) || (scope === "exec" && s.includes("admin"))) return next();
  auditFn({ key: req.key.id, action: "scope", status: "refused", error: "scope required: " + scope, route: req.path, ip: ipOf(req) });
  return res.status(403).json({ error: "Scope required: " + scope });
};

// In-memory rate limit: N requests per minute per key.
function rateLimit(perMinute) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const arr = (hits.get(req.key.id) || []).filter((t) => now - t < 60000);
    if (arr.length >= perMinute) { auditFn({ key: req.key.id, action: "rate", status: "refused", ip: ipOf(req) }); return res.status(429).json({ error: "Too many requests (limit " + perMinute + "/min)" }); }
    arr.push(now);
    hits.set(req.key.id, arr);
    next();
  };
}

module.exports = { setAudit, SCOPES, hash, newKey, loadKeys, saveKeys, authMiddleware, need, rateLimit };
