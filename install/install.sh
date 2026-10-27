#!/usr/bin/env bash
# Copyright (c) 2026 Technologies GNETICS Inc. - PolyForm Noncommercial 1.0.0 (usage non commercial seulement, voir LICENSE)
# Installe la porte avec un utilisateur Unix DEDIE, sans droits particuliers.
# C'est cet utilisateur, et non la liste de blocage, qui limite les degats.
# A lancer en root :  sudo bash install/install.sh [utilisateur] [racine]
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Lance ce script avec sudo."; exit 1; }
command -v node >/dev/null && command -v npm >/dev/null || { echo "Node.js et npm sont requis (installation systeme, version 18 ou plus)."; exit 1; }
[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 18 ] || { echo "Node 18 ou plus requis."; exit 1; }
command -v grep >/dev/null && echo x | grep -qP 'x' 2>/dev/null || { echo "grep avec -P (PCRE) requis pour /grep."; exit 1; }
USER_NAME="${1:-porte-agent}"
WORK_ROOT="${2:-/home/$USER_NAME/travail}"
APP_DIR="/opt/porte"
STATE_DIR="/var/lib/porte"

id "$USER_NAME" >/dev/null 2>&1 || useradd --create-home --shell /bin/bash "$USER_NAME"
mkdir -p "$WORK_ROOT" "$STATE_DIR" "$APP_DIR"
cp -a "$(cd "$(dirname "$0")/.." && pwd)/." "$APP_DIR/"

if [ ! -f "$APP_DIR/config.json" ]; then
cat > "$APP_DIR/config.json" <<CFG
{
  "host": "127.0.0.1",
  "port": 3400,
  "root": "$WORK_ROOT",
  "keysFile": "$STATE_DIR/keys.json",
  "keysGroup": "$USER_NAME",
  "auditFile": "$STATE_DIR/audit.jsonl",
  "rateLimitPerMinute": 60,
  "bashTimeoutMaxSec": 120,
  "requirePlanForRisky": true
}
CFG
fi

# Droits : le programme, la config, les cles et le journal appartiennent a ROOT.
# L'utilisateur de l'agent peut les LIRE mais pas les modifier : il ne peut donc pas se donner de
# droits, retirer l'obligation de plan ni effacer son journal.
(cd "$APP_DIR" && npm install --omit=dev)
chown -R root:root "$APP_DIR"
chmod -R go-w "$APP_DIR"
chown root:root "$STATE_DIR" && chmod 755 "$STATE_DIR"
[ -f "$STATE_DIR/keys.json" ] || printf '{"keys":[]}\n' > "$STATE_DIR/keys.json"
chown root:"$USER_NAME" "$STATE_DIR/keys.json" && chmod 640 "$STATE_DIR/keys.json"
# Journal : appartient a l'utilisateur de la porte (pour ecrire) mais en AJOUT SEULEMENT (chattr +a) :
# il ne peut ni le vider ni le supprimer, et le dossier appartient a root.
touch "$STATE_DIR/audit.jsonl"
chown "$USER_NAME:$USER_NAME" "$STATE_DIR/audit.jsonl" && chmod 644 "$STATE_DIR/audit.jsonl"
if chattr +a "$STATE_DIR/audit.jsonl" 2>/dev/null; then
  echo "Journal en ajout seulement (chattr +a) : OK"
else
  echo "ATTENTION : chattr +a impossible sur ce systeme de fichiers. Le journal peut etre vide par l'agent."
  echo "            Une copie de chaque ligne va quand meme dans journald : journalctl -u porte | grep AUDIT"
fi
chown -R "$USER_NAME:$USER_NAME" "$WORK_ROOT"

cat > /etc/systemd/system/porte.service <<UNIT
[Unit]
Description=La porte (API pour agents IA)
After=network.target

[Service]
User=$USER_NAME
WorkingDirectory=$APP_DIR
Environment=PORTE_CONFIG=$APP_DIR/config.json
ExecStart=$(command -v node) $APP_DIR/server.js
Restart=on-failure
# NoNewPrivileges empeche sudo. Retire cette ligne SEULEMENT si tu donnes le scope admin (voir SECURITY.md).
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now porte

echo
echo "Porte installee. Utilisateur : $USER_NAME  Racine de travail : $WORK_ROOT"
echo "Verifier : curl -s http://127.0.0.1:3400/api/v1/health"
echo "Creer une cle (en root) : sudo PORTE_CONFIG=$APP_DIR/config.json node $APP_DIR/bin/newkey.js --name mon-telephone --scopes read"
echo "Rends-la ensuite joignable en HTTPS avec nginx (nginx/porte.conf.example). N'expose JAMAIS le port 3400 directement."
