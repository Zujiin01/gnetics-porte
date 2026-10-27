#!/usr/bin/env node
// Copyright (c) 2026 Technologies GNETICS Inc. - PolyForm Noncommercial 1.0.0 (usage non commercial seulement, voir LICENSE)
"use strict";
// A lancer en root (sudo) : les cles appartiennent a root.
// Usage : node bin/newkey.js --name "mon-telephone" --scopes read,write,exec
//         node bin/newkey.js --list
//         node bin/newkey.js --revoke <id>
const fs = require("fs");
const path = require("path");
const { SCOPES, hash, newKey, loadKeys, saveKeys } = require("../lib/auth");
const cfg = JSON.parse(fs.readFileSync(process.env.PORTE_CONFIG || path.join(__dirname, "..", "config.json"), "utf8"));

const arg = (n) => { const i = process.argv.indexOf("--" + n); return i > -1 ? process.argv[i + 1] : null; };
const data = loadKeys(cfg.keysFile);

if (process.argv.includes("--list")) {
  for (const k of data.keys) console.log(k.id, k.name, k.scopes.join(","), k.revoked ? "REVOQUEE" : "active");
  process.exit(0);
}
if (arg("revoke")) {
  const k = data.keys.find((x) => x.id === arg("revoke"));
  if (!k) { console.error("cle introuvable"); process.exit(1); }
  k.revoked = new Date().toISOString(); saveKeys(cfg.keysFile, data, cfg.keysGroup); console.log("revoquee : " + k.id); process.exit(0);
}
const name = arg("name");
const scopes = (arg("scopes") || "read").split(",").map((s) => s.trim()).filter(Boolean);
if (!name) { console.error("--name requis"); process.exit(1); }
for (const s of scopes) if (!SCOPES.includes(s)) { console.error("scope inconnu : " + s + " (valides : " + SCOPES.join(", ") + ")"); process.exit(1); }

const key = newKey();
const id = "k" + Date.now().toString(36);
data.keys.push({ id, name, scopes, hash: hash(key), created: new Date().toISOString() });
saveKeys(cfg.keysFile, data, cfg.keysGroup);
console.log("Cle creee (id " + id + ", scopes " + scopes.join(",") + ")");
console.log("Copie-la maintenant, elle ne sera plus jamais affichee :\n");
console.log(key + "\n");
if (scopes.some((s) => s !== "read")) console.log("ATTENTION : cette cle permet de MODIFIER ton serveur. Qui la possede agit comme l'utilisateur de la porte.");
