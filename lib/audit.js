// Copyright (c) 2026 Technologies GNETICS Inc. - PolyForm Noncommercial 1.0.0 (usage non commercial seulement, voir LICENSE)
"use strict";
// Journal d'audit : une ligne JSON par action. Rien n'est silencieux.
const fs = require("fs");

function makeAudit(file) {
  return function audit(entry) {
    const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n";
    // Deux copies : le fichier, et la sortie standard (journald sous systemd), que l'agent ne peut pas effacer.
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
