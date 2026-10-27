#!/usr/bin/env node
// Copyright (c) 2026 Technologies GNETICS Inc. - PolyForm Noncommercial 1.0.0 (non-commercial use only, see LICENSE)
"use strict";
// Run as root (sudo): keys belong to root.
// Usage: node bin/newkey.js --name "my-phone" --scopes read,write,exec
//        node bin/newkey.js --list
//        node bin/newkey.js --revoke <id>
const fs = require("fs");
const path = require("path");
const { SCOPES, hash, newKey, loadKeys, saveKeys } = require("../lib/auth");
const cfg = JSON.parse(fs.readFileSync(process.env.DOOR_CONFIG || path.join(__dirname, "..", "config.json"), "utf8"));

const arg = (n) => { const i = process.argv.indexOf("--" + n); return i > -1 ? process.argv[i + 1] : null; };
const data = loadKeys(cfg.keysFile);

if (process.argv.includes("--list")) {
  for (const k of data.keys) console.log(k.id, k.name, k.scopes.join(","), k.revoked ? "REVOKED" : "active");
  process.exit(0);
}
if (arg("revoke")) {
  const k = data.keys.find((x) => x.id === arg("revoke"));
  if (!k) { console.error("key not found"); process.exit(1); }
  k.revoked = new Date().toISOString(); saveKeys(cfg.keysFile, data, cfg.keysGroup); console.log("revoked: " + k.id); process.exit(0);
}
const name = arg("name");
const scopes = (arg("scopes") || "read").split(",").map((s) => s.trim()).filter(Boolean);
if (!name) { console.error("--name is required"); process.exit(1); }
for (const s of scopes) if (!SCOPES.includes(s)) { console.error("unknown scope: " + s + " (valid: " + SCOPES.join(", ") + ")"); process.exit(1); }

const key = newKey();
const id = "k" + Date.now().toString(36);
data.keys.push({ id, name, scopes, hash: hash(key), created: new Date().toISOString() });
saveKeys(cfg.keysFile, data, cfg.keysGroup);
console.log("Key created (id " + id + ", scopes " + scopes.join(",") + ")");
console.log("Copy it now, it will never be shown again:\n");
console.log(key + "\n");
if (scopes.some((s) => s !== "read")) console.log("WARNING: this key lets its holder MODIFY your server. Whoever has it acts as the user running the door.");
