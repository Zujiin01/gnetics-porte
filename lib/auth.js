// Copyright (c) 2026 Technologies GNETICS Inc. - PolyForm Noncommercial 1.0.0 (usage non commercial seulement, voir LICENSE)
"use strict";
// Cles API : "porte_<32 car>" ; seul le hash SHA-256 est stocke (keys.json). La cle en clair
// n'est montree qu'une fois, a la creation.
const crypto = require("crypto");
const fs = require("fs");

const SCOPES = ["read", "write", "exec", "admin"];
// read  : lire, lister, chercher
// write : creer et modifier des fichiers
// exec  : lancer des commandes (bash) sans sudo
// admin : exec + sudo (si le systeme l'autorise)

const hash = (k) => crypto.createHash("sha256").update(k).digest("hex");
const newKey = () => "porte_" + crypto.randomBytes(24).toString("base64url").slice(0, 32);

function loadKeys(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return { keys: [] }; }
}
// Les cles appartiennent a root et sont lisibles (pas modifiables) par le groupe de l'utilisateur de la porte.
function saveKeys(file, data, group) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), { mode: 0o640 });
  if (group && process.getuid && process.getuid() === 0) {
    const out = require("child_process").execFileSync("getent", ["group", group]).toString().trim().split(":");
    fs.chownSync(file, 0, parseInt(out[2], 10));
    fs.chmodSync(file, 0o640);
  }
}

// Journal des refus (injecte par server.js) : 401, 403 et 429 sont aussi ecrits dans l'audit.
let auditFn = () => {};
const setAudit = (fn) => { auditFn = fn; };
const ipOf = (req) => req.get("x-real-ip") || req.ip;

// Trop d'echecs d'authentification depuis une meme adresse : on ralentit (30 par minute).
const fails = new Map();
const tooManyFails = (ip) => (fails.get(ip) || []).filter((t) => Date.now() - t < 60000).length >= 30;
const noteFail = (ip) => fails.set(ip, [...(fails.get(ip) || []).filter((t) => Date.now() - t < 60000), Date.now()]);

function authMiddleware(keysFile) {
  return (req, res, next) => {
    const ip = ipOf(req);
    if (tooManyFails(ip)) { auditFn({ action: "auth", status: "throttled", ip }); return res.status(429).json({ error: "Trop d'echecs, reessaie dans une minute" }); }
    const m = String(req.headers.authorization || "").match(/^Bearer\s+(.+)$/i);
    if (!m) { noteFail(ip); auditFn({ action: "auth", status: "refused", error: "cle absente", route: req.path, ip }); return res.status(401).json({ error: "Cle requise (Authorization: Bearer <cle>)" }); }
    const h = hash(m[1].trim());
    const row = loadKeys(keysFile).keys.find((k) => k.hash === h && !k.revoked);
    if (!row) { noteFail(ip); auditFn({ action: "auth", status: "refused", error: "cle invalide ou revoquee", route: req.path, ip }); return res.status(401).json({ error: "Cle invalide ou revoquee" }); }
    req.key = { id: row.id, name: row.name, scopes: row.scopes };
    next();
  };
}

const need = (scope) => (req, res, next) => {
  const s = req.key.scopes;
  // admin couvre exec ; read et write doivent etre donnes explicitement
  if (s.includes(scope) || (scope === "exec" && s.includes("admin"))) return next();
  auditFn({ key: req.key.id, action: "scope", status: "refused", error: "scope requis: " + scope, route: req.path, ip: ipOf(req) });
  return res.status(403).json({ error: "Scope requis: " + scope });
};

// Limite de debit en memoire : N requetes par minute et par cle.
function rateLimit(perMinute) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const arr = (hits.get(req.key.id) || []).filter((t) => now - t < 60000);
    if (arr.length >= perMinute) { auditFn({ key: req.key.id, action: "rate", status: "refused", ip: ipOf(req) }); return res.status(429).json({ error: "Trop de requetes (limite " + perMinute + "/min)" }); }
    arr.push(now);
    hits.set(req.key.id, arr);
    next();
  };
}

module.exports = { setAudit, SCOPES, hash, newKey, loadKeys, saveKeys, authMiddleware, need, rateLimit };
