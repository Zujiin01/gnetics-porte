# Security

## What this door protects, and what it does not

The door gives an AI agent real access to a machine. It reduces the risks, it does not remove them.

**Real boundary: the Unix user.** The install creates a dedicated user with no sudo password. Even if the agent is tricked, it cannot do anything that this user cannot do. Never run the door as root. Do not give that user passwordless sudo unless you accept it knowingly (that is the `admin` scope).

**Guardrails (useful, bypassable):** the command blocklist catches common slips (`rm -rf /`, `mkfs`, `useradd`...). A shell is very expressive: the blocklist will not stop someone determined to get around it. The mandatory plan for risky commands leaves you a trace and forces the agent to think, it does not prevent anything.

## Who can change what

The program (`/opt/door`), the config and the key file belong to **root**. The agent's user can read them but not write them: it cannot grant itself scopes, turn off the mandatory plan or forge a key. Keys are created and revoked as root (`sudo`). The audit log is append-only (`chattr +a`) and every line is also sent to journald. The agent can still *append* lines to the file (including fake ones): the journald copy (`journalctl -u door | grep AUDIT`) is authoritative. If `chattr` is not available on your filesystem, the install warns you: rely on journald then.

## Enabling the admin scope (sudo)

By default the door's user has **no** sudo rights, and the service starts with `NoNewPrivileges` (sudo cannot work). To allow a few precise commands:
1. remove `NoNewPrivileges=true` from `/etc/systemd/system/door.service`, then `systemctl daemon-reload && systemctl restart door`;
2. install a sudoers file limited to a short list of commands (template: `install/sudoers.example`), and validate it with `visudo -cf`;
3. create a key with `--scopes read,write,exec,admin`.

The commands in the sudoers file must match **exactly** (same arguments): `sudo systemctl status nginx` passes, `sudo systemctl status nginx --no-pager` is refused. This is intended. Never allow `ALL`, a shell (`bash`, `sh`, `su`) or an editor.

## Good practices

- One key per agent and per device, with the minimum scopes. Revoke without hesitation.
- Never pass a key through an agent conversation, an email or a screenshot. If it happens: revoke and recreate.
- Keep the service on `127.0.0.1`, behind nginx and HTTPS.
- Read the audit log (`/var/lib/door/audit.jsonl`) now and then. It grows without limit: add rotation (logrotate) to that file. It contains the start of the commands that were run.
- Use a firewall (ufw): only 22, 80 and 443 should answer.
- Back up what matters. An agent can delete or overwrite files by mistake.
- Do not put the work root on a directory containing secrets (SSH keys, production `.env` files).

## Reporting a problem

Use GitHub's private reporting (the *Security* tab, then *Report a vulnerability*) rather than a public issue, or write to didierjean@gnetics.ca, and allow a reasonable delay before publishing a flaw.
