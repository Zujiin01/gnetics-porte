# La porte

Une petite API HTTPS qui laisse ton agent IA (Claude, Grok, GrokBot, ou tout agent qui sait faire des requêtes web) **travailler sur ton serveur depuis ton téléphone**, sans SSH, sans ordinateur.

> **Trilogie "Travailler avec son agent depuis son téléphone".** Ceci est la **partie 1 sur 3**.
> 1. **La porte** (ce dépôt) : connecter ton agent à ton serveur.
> 2. **Le pont** (à venir) : faire parler deux agents entre eux, avec des watchers qui les réveillent.
> 3. **La mémoire OPS** (à venir) : une mémoire d'incidents et de leçons, avec le skill *memory first*, pour que ton agent ne refasse pas deux fois la même erreur.
>
> Chaque partie fonctionne seule. Ensemble, elles forment un poste de travail complet que tu pilotes du bout des doigts.

Pour qui : les gens qui veulent utiliser leur agent **depuis un téléphone**. Sur un ordinateur, tu as déjà SSH et tes clés, tu n'as pas besoin de ça.

## Avertissement, à lire avant tout

**Cette porte donne à un agent IA le pouvoir d'agir sur ton serveur : lire, écrire, lancer des commandes.** Ce n'est pas une démo en lecture seule.

- Un agent peut se tromper, mal comprendre une dictée vocale, ou être manipulé par un texte piégé trouvé dans un fichier ou une page web (injection de prompt).
- Une clé volée donne à son porteur les mêmes pouvoirs que l'agent. Traite-la comme un mot de passe root.
- La liste de commandes bloquées est un **garde-fou contre les erreurs**, pas une protection contre un attaquant. La vraie protection, c'est l'**utilisateur Unix dédié** sans droits particuliers que le script d'installation crée.
- Fais des sauvegardes. Ne branche pas cette porte sur un serveur dont tu ne peux pas te permettre de perdre le contenu.
- Commence avec la clé en lecture (`read`), puis ajoute `write` et `exec` quand tu as confiance. Garde `admin` (sudo) pour la fin, ou jamais.

Lis aussi [SECURITY.md](SECURITY.md).

## Ce que ça fait

| Route (POST, JSON) | Scope | Rôle |
|---|---|---|
| `/api/v1/code/read` | read | lire un fichier |
| `/api/v1/code/list` | read | lister un dossier |
| `/api/v1/code/glob` | read | trouver des fichiers par motif |
| `/api/v1/code/grep` | read | chercher du texte |
| `/api/v1/code/write` | write | créer ou remplacer un fichier |
| `/api/v1/code/edit` | write | remplacer un texte dans un fichier |
| `/api/v1/code/bash` | exec | lancer une commande |
| `GET /api/v1/code/audit` | admin | journal de toutes les actions |
| `GET /api/v1/health` | aucune | savoir si la porte répond |

Les scopes d'une clé : `read` (lire), `write` (écrire), `exec` (commandes), `admin` (commandes avec sudo et lecture de l'audit). Chaque scope se donne explicitement : `admin` ne donne pas `read` ni `write`. Le scope `admin` ne sert à rien tant que tu n'as pas donné de droits sudo à l'utilisateur de la porte (voir [SECURITY.md](SECURITY.md) et `install/sudoers.example`).

Les garde-fous :

- **Racine de travail** : l'agent ne sort pas du dossier que tu choisis (les liens symboliques sont suivis et refusés s'ils sortent).
- **Clés avec scopes** : `read`, `write`, `exec`, `admin`. Seul un hash est stocké sur le serveur.
- **Audit** : chaque action, et chaque refus, est écrite dans un journal. Rien n'est silencieux. Le journal est en ajout seulement, avec une copie dans journald.
- **Droits** : le programme, la config et les clés appartiennent à root. L'agent peut les lire, pas les modifier.
- **Plan obligatoire pour les commandes risquées** (`sudo`, redémarrage de service, `rm -r`, `kill`...) : l'API répond `428 plan_required`, et l'agent doit renvoyer la commande avec un en-tête `X-Action-Plan` (objectif, commande, risque, retour arrière). Tu vois le plan dans l'audit.
- **Limite de débit** par clé, délai maximum par commande.
- Le service n'écoute que sur `127.0.0.1`. Seul nginx, en HTTPS, est exposé.

## Mise en ligne, pas à pas

Il te faut : un serveur Linux (Ubuntu), Node 18 ou plus (installation système), nginx, `grep` avec `-P`, un nom de domaine, et le droit d'ajouter un enregistrement DNS.

1. **DNS.** Chez ton registraire, crée un enregistrement `A` qui pointe `agent.ton-domaine.com` vers l'adresse IP de ton serveur. Attends qu'il soit actif : `dig +short agent.ton-domaine.com`.
2. **Pare-feu.** N'ouvre que les ports 22, 80 et 443 (`sudo ufw allow OpenSSH && sudo ufw allow 'Nginx Full' && sudo ufw enable`).
3. **Installer la porte.**
   ```bash
   git clone https://github.com/Zujiin01/gnetics-porte.git && cd gnetics-porte
   sudo bash install/install.sh          # utilisateur "porte-agent", racine /home/porte-agent/travail
   curl -s http://127.0.0.1:3400/api/v1/health
   ```
   La racine de travail est le seul dossier que l'agent voit. Pour travailler sur un projet existant, copie-le dans cette racine et donne les droits à `porte-agent`. Les liens symboliques qui sortent de la racine sont refusés.
4. **nginx.** Copie `nginx/porte.conf.example` dans `/etc/nginx/sites-available/porte`, remplace `agent.example.com` par ton domaine, active-le (`sudo ln -s /etc/nginx/sites-available/porte /etc/nginx/sites-enabled/`). Au premier essai le certificat n'existe pas encore : mets d'abord seulement le bloc du port 80, puis lance `sudo certbot --nginx -d agent.ton-domaine.com` (certbot ajoute le HTTPS et le renouvellement automatique), ou remets le fichier complet une fois le certificat obtenu. Termine par `sudo nginx -t && sudo systemctl reload nginx`.
5. **Vérifier de l'extérieur** (depuis ton téléphone ou un autre réseau) : `https://agent.ton-domaine.com/api/v1/health` doit répondre `{"ok":true,...}`.
6. **Créer une clé.** Commence en lecture seule :
   ```bash
   sudo PORTE_CONFIG=/opt/porte/config.json node /opt/porte/bin/newkey.js --name mon-telephone --scopes read
   ```
   La clé s'affiche **une seule fois**. Garde-la dans un gestionnaire de mots de passe. Passe à `--scopes read,write,exec` quand tu as vu l'agent travailler correctement.
7. **Brancher l'agent** (section suivante), puis fais un premier essai simple : « liste la racine de travail ».
8. **Surveiller.** Lis de temps en temps `/var/lib/porte/audit.jsonl` (ou `journalctl -u porte | grep AUDIT`). Les refus (clé invalide, scope manquant) y sont aussi. Retire une clé avec `--revoke <id>` (la liste : `--list`), toujours en root.

**N'ouvre jamais le port 3400 directement** : seul nginx, en HTTPS, doit être joignable.

## Brancher ton agent

La méthode est la même pour Claude, Grok, GrokBot ou tout agent capable d'envoyer des requêtes HTTPS avec un en-tête `Authorization` :

1. Crée un **projet** dans ton agent.
2. Colle le texte de [AGENT-INSTRUCTIONS.md](AGENT-INSTRUCTIONS.md) dans les **instructions du projet**.
3. Remplace l'adresse et mets **ta propre clé** à la place de `<TA_CLE>`.
4. Garde le projet **privé**. Quiconque peut lire les instructions du projet possède ta clé.

Les instructions contiennent le rôle de l'agent, la liste des routes, les règles du bac à sable, le déroulement d'une tâche (investiguer, planifier, sauvegarder, appliquer, valider, rapporter) et les interdits. Elles sont celles d'un vrai poste de travail en usage quotidien : adapte-les à ton serveur.

Ce dépôt ne contient aucune clé. Chaque personne crée la sienne sur son propre serveur. Une clé par agent, pour pouvoir en révoquer une seule.

Si ton agent travaille dans un bac à sable sans accès libre au réseau, il faut autoriser ton domaine dans ses réglages.

## Limites connues

- La liste de blocage et la détection des commandes risquées se contournent (un shell est trop expressif). La frontière réelle, c'est l'utilisateur Unix.
- Une commande lancée par l'agent peut créer un lien symbolique ou une tâche en arrière-plan : le contrôle de la racine vaut pour les routes de fichiers, pas pour ce que fait un programme lancé avec `bash`.
- Le journal d'audit garde le début des commandes (200 caractères) : si l'agent y écrit un secret, il se retrouve dans le journal.
- Pas de rotation du journal : voir SECURITY.md.
- L'agent et le service tournent sous le même utilisateur Unix. L'agent ne peut pas modifier la config ni les clés, mais il peut arrêter le service (systemd le relance) ou lancer sa propre copie du programme avec sa propre config, qui ne touche que ce que cet utilisateur peut déjà toucher. Pour séparer davantage, utilise deux utilisateurs.
- Une seule instance, sans haute disponibilité.

## Tester

```bash
npm install
npm test        # démarre la porte dans un dossier temporaire et vérifie chaque route
```

## Licence : usage non commercial seulement

[PolyForm Noncommercial 1.0.0](LICENSE), droit d'auteur Technologies GNETICS Inc.

- **Permis** : utiliser, étudier, modifier et partager ce code pour un usage **non commercial** : usage personnel, apprentissage, recherche, passe-temps, organismes sans but lucratif, établissements d'enseignement.
- **Interdit sans autorisation écrite** : l'utiliser dans une entreprise, un produit ou un service payant, le revendre, l'héberger pour des clients, ou l'intégrer à une offre commerciale.
- Si tu partages une copie ou une version modifiée, tu dois y joindre la licence et l'avis de droit d'auteur.
- Ce n'est pas une licence « open source » au sens strict (elle interdit l'usage commercial) : c'est du code **à source disponible**.

Pour un usage commercial, écris à Technologies GNETICS Inc. : didierjean@gnetics.ca.

Ce logiciel est fourni tel quel, sans garantie. Tu es responsable de ce que ton agent fait sur ton serveur.
