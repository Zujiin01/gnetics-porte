#!/usr/bin/env bash
# Copyright (c) 2026 Technologies GNETICS Inc. - PolyForm Noncommercial 1.0.0 (non-commercial use only, see LICENSE)
# Installs the door with a DEDICATED Unix user that has no special rights.
# That user, not the blocklist, is what limits the damage.
# Run as root:  sudo bash install/install.sh [user] [work-root]
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Run this script with sudo."; exit 1; }
command -v node >/dev/null && command -v npm >/dev/null || { echo "Node.js and npm are required (system-wide install, version 18 or newer)."; exit 1; }
[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 18 ] || { echo "Node 18 or newer is required."; exit 1; }
command -v grep >/dev/null && echo x | grep -qP 'x' 2>/dev/null || { echo "grep with -P (PCRE) is required for /grep."; exit 1; }
USER_NAME="${1:-door-agent}"
WORK_ROOT="${2:-/home/$USER_NAME/work}"
APP_DIR="/opt/door"
STATE_DIR="/var/lib/door"

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

# Permissions: the program, the config, the keys and the log belong to ROOT.
# The agent's user can READ them but not change them: it cannot grant itself rights,
# remove the plan requirement or erase its own log.
(cd "$APP_DIR" && npm install --omit=dev)
chown -R root:root "$APP_DIR"
chmod -R go-w "$APP_DIR"
chown root:root "$STATE_DIR" && chmod 755 "$STATE_DIR"
[ -f "$STATE_DIR/keys.json" ] || printf '{"keys":[]}\n' > "$STATE_DIR/keys.json"
chown root:"$USER_NAME" "$STATE_DIR/keys.json" && chmod 640 "$STATE_DIR/keys.json"
# Log: owned by the door's user (so it can write) but APPEND-ONLY (chattr +a):
# it can neither empty nor delete it, and the directory belongs to root.
touch "$STATE_DIR/audit.jsonl"
chown "$USER_NAME:$USER_NAME" "$STATE_DIR/audit.jsonl" && chmod 644 "$STATE_DIR/audit.jsonl"
if chattr +a "$STATE_DIR/audit.jsonl" 2>/dev/null; then
  echo "Log is append-only (chattr +a): OK"
else
  echo "WARNING: chattr +a is not possible on this filesystem. The agent could empty the log."
  echo "         A copy of every line still goes to journald: journalctl -u door | grep AUDIT"
fi
chown -R "$USER_NAME:$USER_NAME" "$WORK_ROOT"

cat > /etc/systemd/system/door.service <<UNIT
[Unit]
Description=The door (API for AI agents)
After=network.target

[Service]
User=$USER_NAME
WorkingDirectory=$APP_DIR
Environment=DOOR_CONFIG=$APP_DIR/config.json
ExecStart=$(command -v node) $APP_DIR/server.js
Restart=on-failure
# NoNewPrivileges prevents sudo. Remove this line ONLY if you grant the admin scope (see SECURITY.md).
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now door

echo
echo "Door installed. User: $USER_NAME  Work root: $WORK_ROOT"
echo "Check:      curl -s http://127.0.0.1:3400/api/v1/health"
echo "Create key (as root): sudo DOOR_CONFIG=$APP_DIR/config.json node $APP_DIR/bin/newkey.js --name my-phone --scopes read"
echo "Then make it reachable over HTTPS with nginx (nginx/door.conf.example). NEVER expose port 3400 directly."
