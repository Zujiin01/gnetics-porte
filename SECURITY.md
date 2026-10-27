# Sécurité

## Ce que cette porte protège, et ce qu'elle ne protège pas

La porte donne à un agent IA un accès réel à une machine. Elle réduit les risques, elle ne les supprime pas.

**Frontière réelle : l'utilisateur Unix.** L'installation crée un utilisateur dédié, sans mot de passe sudo. Même si l'agent est trompé, il ne peut rien faire que cet utilisateur ne puisse pas faire. Ne fais jamais tourner la porte en root. Ne donne pas à cet utilisateur de sudo sans mot de passe sauf si tu l'acceptes en connaissance de cause (c'est le scope `admin`).

**Garde-fous (utiles, contournables) :** la liste de commandes bloquées attrape les gaffes courantes (`rm -rf /`, `mkfs`, `useradd`...). Un shell est très expressif : elle ne résiste pas à quelqu'un qui cherche à la contourner. Le plan obligatoire pour les commandes risquées sert à te laisser une trace et à forcer l'agent à réfléchir, pas à t'empêcher quoi que ce soit.

## Qui peut modifier quoi

Le programme (`/opt/porte`), la config et le fichier de clés appartiennent à **root**. L'utilisateur de l'agent peut les lire, pas les écrire : il ne peut donc pas se donner de scopes, désactiver le plan obligatoire ou fabriquer une clé. Les clés se créent et se révoquent en root (`sudo`). Le journal d'audit est en ajout seulement (`chattr +a`) et chaque ligne est aussi envoyée à journald. L'agent peut quand même *ajouter* des lignes au fichier (y compris de fausses lignes) : la copie dans journald (`journalctl -u porte | grep AUDIT`) fait foi. Si `chattr` n'est pas disponible sur ton système de fichiers, l'installation te prévient : fie-toi alors à journald.

## Activer le scope admin (sudo)

Par défaut l'utilisateur de la porte n'a **aucun** droit sudo, et le service est lancé avec `NoNewPrivileges` (sudo ne peut pas fonctionner). Pour autoriser quelques commandes précises :
1. retire `NoNewPrivileges=true` de `/etc/systemd/system/porte.service`, puis `systemctl daemon-reload && systemctl restart porte` ;
2. installe un fichier sudoers limité à une liste courte de commandes (modèle : `install/sudoers.example`), et valide-le avec `visudo -cf` ;
3. crée une clé avec `--scopes read,write,exec,admin`.
Les commandes du fichier sudoers doivent correspondre **exactement** (mêmes arguments) : `sudo systemctl status nginx` passe, `sudo systemctl status nginx --no-pager` est refusé. C'est voulu.
N'autorise jamais `ALL`, ni un shell (`bash`, `sh`, `su`), ni un éditeur.

## Bonnes pratiques

- Une clé par agent et par appareil, avec le minimum de scopes. Révoque sans hésiter.
- Ne transmets jamais une clé dans une conversation d'agent, un courriel ou une capture. Si ça arrive : révoque et recrée.
- Garde le service sur `127.0.0.1`, derrière nginx et HTTPS.
- Lis le journal d'audit (`/var/lib/porte/audit.jsonl`) de temps en temps. Il grossit sans limite : ajoute une rotation (logrotate) sur ce fichier. Il contient le début des commandes lancées.
- Mets un pare-feu (ufw) : seuls 22, 80 et 443 doivent répondre.
- Sauvegarde ce qui compte. Un agent peut effacer ou écraser des fichiers par erreur.
- Ne mets pas la racine de travail sur un dossier contenant des secrets (clés SSH, fichiers `.env` de production).

## Signaler un problème

Utilise le signalement privé de GitHub (onglet *Security*, puis *Report a vulnerability*) plutôt qu'un ticket public, ou écris à didierjean@gnetics.ca, et laisse un délai raisonnable avant de publier une faille.
