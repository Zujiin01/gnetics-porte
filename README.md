# The Door: Mobile Server Connection

**License: [PolyForm Noncommercial 1.0.0](LICENSE). Non-commercial use only.** For commercial use: didierjean@gnetics.ca.

A small HTTPS API that lets your AI agent (Claude, Grok, GrokBot, or any agent that can make web requests) **work on your own server from your phone**, with no SSH and no computer. Works with Claude, Grok and GrokBot. Does not work with the ChatGPT and Gemini mobile apps (see [Compatibility](#compatibility)).

> **Trilogy "Work with your AI agent from your phone".** This is **part 1 of 3**.
> 1. **The Door** (this repository): connect your agent to your server.
> 2. **OPS Memory** (coming soon): a pattern system that your agents search before acting and enrich after every task, used as their shared memory. Comes with the *memory first* skill, so your agent does not repeat the same mistake twice.
> 3. **The Bridge** (coming soon): let two agents talk to each other, with watchers that wake them up.
>
> Each part works on its own. Together they make a complete workstation you drive with your thumbs.

Who it is for: people who want to use their agent **from a phone**. On a computer you already have SSH and keys, so you do not need this.

## Warning, read this first

**This door gives an AI agent the power to act on your server: read, write, run commands.** It is not a read-only demo.

- An agent can make mistakes, misunderstand a voice dictation, or be manipulated by a booby-trapped text found in a file or a web page (prompt injection).
- A stolen key gives its holder the same powers as the agent. Treat it like a root password.
- The command blocklist is a **guardrail against mistakes**, not protection against an attacker. The real protection is the **dedicated Unix user** with no special rights that the install script creates.
- Keep backups. Do not plug this door into a server whose content you cannot afford to lose.
- Start with a read-only key (`read`), then add `write` and `exec` once you trust the setup. Keep `admin` (sudo) for last, or never.

Also read [SECURITY.md](SECURITY.md).

## What it does

| Route (POST, JSON) | Scope | Purpose |
|---|---|---|
| `/api/v1/code/read` | read | read a file |
| `/api/v1/code/list` | read | list a directory |
| `/api/v1/code/glob` | read | find files by pattern |
| `/api/v1/code/grep` | read | search text |
| `/api/v1/code/write` | write | create or replace a file |
| `/api/v1/code/edit` | write | replace text in a file |
| `/api/v1/code/bash` | exec | run a command |
| `GET /api/v1/code/audit` | admin | log of all actions |
| `GET /api/v1/health` | none | check that the door answers |

Key scopes: `read`, `write`, `exec`, `admin` (commands with sudo, and reading the audit log). Each scope is granted explicitly: `admin` does not include `read` or `write`. The `admin` scope is useless until you give the door's user some sudo rights (see [SECURITY.md](SECURITY.md) and `install/sudoers.example`).

Safeguards:

- **Work root**: the agent cannot leave the directory you choose (symbolic links are followed and refused if they point outside).
- **Keys with scopes**: only a hash is stored on the server.
- **Audit**: every action, and every refusal, is written to a log. Nothing is silent. The log is append-only, with a copy in journald.
- **Permissions**: the program, the config and the keys belong to root. The agent can read them but not change them.
- **Mandatory plan for risky commands** (`sudo`, service restarts, `rm -r`, `kill`...): the API answers `428 plan_required`, and the agent must resend the command with an `X-Action-Plan` header (objective, command, risk, rollback). You can read the plan in the audit log.
- **Rate limit** per key, failed-login throttle per address, maximum duration per command.
- The service only listens on `127.0.0.1`. Only nginx, over HTTPS, is exposed.

## Compatibility

- **Works (used in practice):** Claude, Grok and GrokBot.
- **Does not work: the ChatGPT and Gemini mobile apps.** Tested by the author: these apps do not expose the tool calls the door needs (see below), so the agent has no way to reach your server. This is a limit of those apps today, not of the door.
- **Should work, not tested by the author:** ChatGPT and Gemini through their **API with your own key and your own agent code**, because there you define the tools yourself (function calling). See [`tools/door-tools.json`](tools/door-tools.json).
- For part 3 (the Bridge), real-time watchers need an agent that can run a background process: only Claude and GrokBot can.

## What your agent needs (tool calls)

The door is plain HTTPS, so what matters is whether your agent has a tool that can do all of this:

| Needed capability | Why |
|---|---|
| Send **HTTPS requests** (POST with a JSON body, plus GET for health) | every door route |
| To **any domain you choose** (not only a fixed list of allowed sites) | your own server |
| With **custom headers**: `Authorization`, and optionally `X-Session` and `X-Action-Plan` | authentication, tracking, the risky-command plan |
| **Read the status code and the body** of the answer | to react to `401`, `403`, `428`, errors |
| **Persistent project or system instructions** | to hold the rules in [AGENT-INSTRUCTIONS.md](AGENT-INSTRUCTIONS.md) |
| A place to keep the **key** out of the conversation (secret field, project setting) | the key must not travel through chats |

If your agent's app has a generic web or HTTP request tool with these abilities, it can use the door as is: it only needs the instructions. If it only has a sandboxed code tool without network access, or a fixed set of built-in tools, it cannot.

If you build your own agent (OpenAI, Gemini, Anthropic or any other API with function calling), define these seven tools. The file [`tools/door-tools.json`](tools/door-tools.json) lists them with their parameters, in a neutral format you can convert to your provider's function-calling format:

| Tool | Route | Scope |
|---|---|---|
| `door_read` | `POST /api/v1/code/read` | read |
| `door_list` | `POST /api/v1/code/list` | read |
| `door_glob` | `POST /api/v1/code/glob` | read |
| `door_grep` | `POST /api/v1/code/grep` | read |
| `door_write` | `POST /api/v1/code/write` | write |
| `door_edit` | `POST /api/v1/code/edit` | write |
| `door_bash` | `POST /api/v1/code/bash` | exec |

Each tool call is one HTTPS request with the `Authorization: Bearer` header. Your code sends it and returns the JSON answer to the model.

## Going live, step by step

You need: a Linux server (Ubuntu), Node 18 or newer (system-wide install), nginx, `grep` with `-P`, a domain name, and the ability to add a DNS record.

1. **DNS.** At your registrar, create an `A` record pointing `agent.your-domain.com` to your server's IP address. Wait until it is active: `dig +short agent.your-domain.com`.
2. **Firewall.** Open only ports 22, 80 and 443 (`sudo ufw allow OpenSSH && sudo ufw allow 'Nginx Full' && sudo ufw enable`).
3. **Install the door.**
   ```bash
   git clone https://github.com/Zujiin01/mobile-server-connection.git && cd mobile-server-connection
   sudo bash install/install.sh          # creates the "door-agent" user, work root /home/door-agent/work
   curl -s http://127.0.0.1:3400/api/v1/health
   ```
   The work root is the only directory the agent sees. To work on an existing project, copy it into that root and give `door-agent` the rights. Symbolic links that leave the root are refused.
4. **nginx.** Copy `nginx/door.conf.example` to `/etc/nginx/sites-available/door`, replace `agent.example.com` with your domain, enable it (`sudo ln -s /etc/nginx/sites-available/door /etc/nginx/sites-enabled/`). The certificate does not exist yet on the first try: put only the port 80 block first, then run `sudo certbot --nginx -d agent.your-domain.com` (certbot adds HTTPS and automatic renewal), or put the full file back once you have the certificate. Finish with `sudo nginx -t && sudo systemctl reload nginx`.
5. **Check from outside** (from your phone or another network): `https://agent.your-domain.com/api/v1/health` must answer `{"ok":true,...}`.
6. **Create a key.** Start read-only:
   ```bash
   sudo DOOR_CONFIG=/opt/door/config.json node /opt/door/bin/newkey.js --name my-phone --scopes read
   ```
   The key is shown **only once**. Keep it in a password manager. Move to `--scopes read,write,exec` once you have seen the agent work correctly.
7. **Connect the agent** (next section), then do a simple first test: "list the work root".
8. **Watch.** Read `/var/lib/door/audit.jsonl` now and then (or `journalctl -u door | grep AUDIT`). Refusals (invalid key, missing scope) are logged too. Remove a key with `--revoke <id>` (list them with `--list`), always as root.

**Never open port 3400 directly**: only nginx, over HTTPS, should be reachable.

## Connect your agent

The method is the same for Claude, Grok, GrokBot, or any agent that can send HTTPS requests with an `Authorization` header:

1. Create a **project** in your agent.
2. Paste the text of [AGENT-INSTRUCTIONS.md](AGENT-INSTRUCTIONS.md) into the **project instructions**.
3. Replace the address and put **your own key** in place of `<YOUR_KEY>`.
4. Keep the project **private**. Anyone who can read the project instructions has your key.

The instructions contain the agent's role, the route list, the sandbox rules, how a task runs (investigate, plan, back up, apply, validate, report) and the prohibitions. They come from a real workstation used daily: adapt them to your server.

This repository contains no key. Each person creates their own on their own server. One key per agent, so you can revoke just one.

If your agent works in a sandbox without free network access, allow your domain in its settings.

## Known limits

- The blocklist and the risky-command detection can be bypassed (a shell is too expressive). The real boundary is the Unix user.
- A command run by the agent can create a symbolic link or a background task: the root check applies to the file routes, not to what a program started through `bash` does.
- The audit log keeps the start of each command (200 characters): if the agent writes a secret there, it ends up in the log.
- No log rotation: see SECURITY.md.
- The agent and the service run under the same Unix user. The agent cannot change the config or the keys, but it can stop the service (systemd restarts it) or start its own copy of the program with its own config, which only touches what that user can already touch. To separate further, use two users.
- A single instance, no high availability.

## Test

```bash
npm install
npm test        # starts the door in a temporary directory and checks every route
```

## License: non-commercial use only

[PolyForm Noncommercial 1.0.0](LICENSE), copyright Technologies GNETICS Inc.

- **Allowed**: use, study, modify and share this code for **non-commercial** purposes: personal use, learning, research, hobby projects, non-profit organizations, educational institutions.
- **Forbidden without written permission**: using it in a business, a paid product or service, reselling it, hosting it for customers, or building it into a commercial offer.
- If you share a copy or a modified version, you must include the license and the copyright notice.
- This is not an "open source" license in the strict sense (it forbids commercial use): it is **source-available** code.

For commercial use, write to Technologies GNETICS Inc.: didierjean@gnetics.ca.

This software is provided as is, without warranty. You are responsible for what your agent does on your server.
