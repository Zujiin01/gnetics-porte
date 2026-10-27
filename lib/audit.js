// Copyright (c) 2026 Technologies GNETICS Inc. - PolyForm Noncommercial 1.0.0 (non-commercial use only, see LICENSE)
"use strict";
// Audit log: one JSON line per action. Nothing is silent.
const fs = require("fs");

function makeAudit(file) {
  return function audit(entry) {
    const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n";
    // Two copies: the file, and standard output (journald under systemd), which the agent cannot erase.
    process.stdout.write("AUDIT " + line);
    try { fs.appendFileSync(file, line, { mode: 0o644 }); } catch (e) { console.error("audit: " + e.message); }
  };
}

function readAudit(file, limit) {
  try {
    const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
    return lines.slice(-limit).map((l) => { try { return JSON.parse(l); } catch { return { raw: l }; } });
  } catch { return []; }
}

module.exports = { makeAudit, readAudit };
