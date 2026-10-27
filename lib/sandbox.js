// Copyright (c) 2026 Technologies GNETICS Inc. - PolyForm Noncommercial 1.0.0 (usage non commercial seulement, voir LICENSE)
"use strict";
// Bac a sable applicatif.
// ATTENTION : ceci est un GARDE-FOU, pas une frontiere de securite. La vraie frontiere, c'est
// l'utilisateur Unix dedie qui fait tourner la porte (voir install/install.sh et SECURITY.md).
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

// Liste de commandes refusees. Elle attrape les erreurs courantes, pas un adversaire determine.
const BLOCKLIST = [
  /\brm\s+(-[a-zA-Z]*\s+)*-[a-zA-Z]*[rf][a-zA-Z]*\s+(--no-preserve-root\s+)?\/(\*|\s|$)/,
  /\brm\s+(-[a-zA-Z]*\s+)*-[a-zA-Z]*[rf][a-zA-Z]*\s+~\/?(\s|$)/,
  /:\(\)\s*\{\s*:\|:&\s*\};:/,
  /\bmkfs(\.\w+)?\b/,
  /\bdd\s+[^|;&]*\b(if|of)=\/dev\//,
  />\s*\/dev\/(sd|nvme|vd|xvd)/,
  /\/etc\/shadow|\/etc\/sudoers/,
  /\b(useradd|userdel|usermod|passwd|chpasswd|visudo)\b/,
  /\b(shutdown|reboot|halt|poweroff)\b/,
  /\bchmod\s+(-R\s+)?[0-7]*777\s+\/(\s|$)/,
];

// Commandes "risquees" : acceptees seulement avec un plan (en-tete X-Action-Plan).
const RISKY = [
  /\bsudo\b/,
  /\bsystemctl\s+(restart|stop|reload|disable|enable)\b/,
  /\bservice\s+\S+\s+(restart|stop|reload)\b/,
  /\brm\s+-[a-zA-Z]*r/,
  /\bgit\s+push\b.*(--force|-f\b)/,
  /\bnpm\s+(rebuild|uninstall)\b/,
  /\b(kill|pkill|killall)\b/,
  /\bdocker\s+(rm|stop|kill|system\s+prune)\b/,
];

const PLAN_FIELDS = ["objective", "command", "risk", "rollback"];

function resolveSafe(root, target) {
  const base = fs.realpathSync(root);
  const raw = String(target || ".");
  if (raw.includes("\0")) throw new Error("Chemin invalide");
  const abs = path.resolve(base, raw);
  // Remonte jusqu'au plus proche element existant (lstat voit aussi les liens brises),
  // puis suit les liens symboliques de cet element.
  let probe = abs;
  for (;;) {
    try { fs.lstatSync(probe); break; } catch (e) {
      if (e.code !== "ENOENT" && e.code !== "ENOTDIR") throw new Error("Chemin invalide");
    }
    const up = path.dirname(probe);
    if (up === probe) throw new Error("Chemin invalide");
    probe = up;
  }
  let realProbe;
  try { realProbe = fs.realpathSync(probe); } catch { throw new Error("Lien symbolique brise refuse"); }
  const real = path.join(realProbe, path.relative(probe, abs));
  if (real !== base && !real.startsWith(base + path.sep)) throw new Error("Chemin hors de la racine autorisee");
  return real;
}

function validateBash(command, scopes) {
  if (typeof command !== "string" || !command.trim()) return { ok: false, code: 400, error: "command requis" };
  if (command.length > 8000) return { ok: false, code: 400, error: "Commande trop longue (8000 car. max)" };
  for (const re of BLOCKLIST) if (re.test(command)) return { ok: false, code: 403, error: "Commande refusee par la liste de blocage" };
  if (/\bsudo\b/.test(command) && !scopes.includes("admin")) return { ok: false, code: 403, error: "sudo exige le scope admin" };
  return { ok: true, risky: RISKY.some((re) => re.test(command)) };
}

function parsePlan(header) {
  try {
    const p = JSON.parse(header || "");
    return PLAN_FIELDS.every((f) => typeof p[f] === "string" && p[f].trim()) ? p : null;
  } catch { return null; }
}

function runBash(command, { cwd, timeoutMs, extraEnv }) {
  return new Promise((resolve) => {
    const env = { PATH: process.env.PATH, HOME: process.env.HOME || cwd, LANG: "C.UTF-8", ...(extraEnv || {}) };
    const child = spawn("/bin/bash", ["-c", command], { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    const MAX = 4 * 1024 * 1024;
    let out = "", err = "", killed = false;
    const timer = setTimeout(() => { killed = true; child.kill("SIGKILL"); }, timeoutMs);
    child.stdout.on("data", (d) => { if (out.length < MAX) out += d; });
    child.stderr.on("data", (d) => { if (err.length < MAX) err += d; });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ exit_code: code, timed_out: killed, stdout: out, stderr: err });
    });
    child.on("error", (e) => { clearTimeout(timer); resolve({ exit_code: -1, timed_out: false, stdout: out, stderr: String(e.message) }); });
  });
}

// Lance un programme sans shell (arguments en tableau), avec delai.
function runFile(file, args, { cwd, timeoutMs }) {
  return new Promise((resolve) => {
    const child = spawn(file, args, { cwd, env: { PATH: process.env.PATH, LANG: "C.UTF-8" }, stdio: ["ignore", "pipe", "pipe"] });
    const MAX = 4 * 1024 * 1024;
    let out = "", err = "", killed = false;
    const timer = setTimeout(() => { killed = true; child.kill("SIGKILL"); }, timeoutMs);
    child.stdout.on("data", (d) => { if (out.length < MAX) out += d; });
    child.stderr.on("data", (d) => { if (err.length < MAX) err += d; });
    child.on("close", (code) => { clearTimeout(timer); resolve({ exit_code: code, timed_out: killed, stdout: out, stderr: err }); });
    child.on("error", (e) => { clearTimeout(timer); resolve({ exit_code: 2, timed_out: false, stdout: out, stderr: String(e.message) }); });
  });
}

module.exports = { resolveSafe, validateBash, parsePlan, runBash, runFile, PLAN_FIELDS };
