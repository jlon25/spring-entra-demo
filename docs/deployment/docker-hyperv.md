# Environnement Docker Compose sur une VM Hyper-V

Ce guide prépare un environnement de développement avec fournisseur d’identité simulé. Il ne configure ni Entra, ni TLS, ni un environnement de production. Aucun déploiement sur votre VM n’est déclenché par la PR.

## VM et prérequis

Cible déclarée : VM **Ubuntu 26.04 LTS**, Docker **29.6.0**, Docker Compose **5.1.4**, hébergée par Hyper-V sous Windows. Les versions installées sont fournies par l’utilisateur ; elles ne sont pas déduites de la CI. Les images sont Linux ; Docker en mode conteneurs Windows ne convient pas. Docker Engine fonctionne directement dans la VM Linux, sans Docker Desktop ni virtualisation imbriquée.

Prévoir comme point de départ 2 vCPU, 4 Go de RAM et 30 Go de disque pour le système, les images et le build Maven. Ajuster selon la charge et l’espace disponible ; ce n’est pas une garantie de capacité.

1. Relier la VM à un commutateur Hyper-V adapté : externe pour une adresse sur le LAN, ou réseau interne/NAT pour un accès limité à l’hôte. Conserver un accès SSH et noter l’adresse IP de la VM (`hostname -I`).
2. Docker étant déjà installé sur cette VM, conserver cette installation. Si nécessaire sur une autre VM, installer Docker Engine, Buildx et **Docker Compose moderne** (plugin `docker compose`, v2 ou ultérieur) depuis le dépôt officiel correspondant à la distribution. Sur Ubuntu, suivre la procédure officielle ci-dessous ; ne pas installer simultanément des paquets Docker de provenances différentes.
3. Vérifier sur la VM :

```sh
docker version
docker compose version
docker info
```

Le guide suppose que votre compte peut utiliser Docker. Sinon utiliser `sudo` pour les commandes Docker ou configurer l’accès selon la documentation officielle ; appartenir au groupe docker confère des privilèges élevés. Activer le démarrage du service Docker au boot de la VM selon la distribution. Aucun JDK, Maven, Python ou OpenSSL sur la VM n’est nécessaire pour lancer Compose : ils sont dans les images. Python3 sur la VM est facultatif pour le script de vérification fourni.

Les builds nécessitent Internet vers les registres d’images, les dépôts système et Maven Central. Si votre réseau impose un proxy, le configurer pour Docker et les builds selon votre infrastructure ; ne pas désactiver TLS.

## Architecture et adresses

Compose construit deux images : `api` (JRE Java21) et `identity` (Python/OpenSSL). Les processus sont non-root. La clé privée de simulation est créée dans un répertoire temporaire, sans volume persistant. Le JWKS n’expose que la clé publique.

L’API contacte `http://identity:9000/jwks` via le DNS du réseau Compose. Les jetons portent l’issuer exact `http://identity:9000`, configuré aussi dans l’API. Cet issuer interne n’est pas l’adresse utilisée par le client pour obtenir un jeton : le client appelle le port publié de la VM. Il n’est pas nécessaire que le navigateur résolve le nom `identity` pour envoyer un Bearer à l’API. Les URL issuer et JWKS doivent rester cohérentes ; ne pas remplacer `identity` par `localhost` dans la configuration de l’API conteneurisée.

Le profil Spring `local` n’est pas activé dans Compose : les trois paramètres JWT sont explicitement fournis par Compose. Les valeurs du lancement Java hors Docker restent inchangées.

## Premier lancement sur la VM

Depuis la VM Linux, après fusion de la PR Docker :

```sh
git clone https://github.com/jlon25/spring-entra-demo.git
cd spring-entra-demo
cp .env.example .env  # uniquement si le fichier n’existe pas
chmod 600 .env
nano .env  # renseigner DEV_IDENTITY_PASSWORD, minimum 12 caractères
docker compose config --quiet
docker compose up --build --wait --wait-timeout 180
docker compose ps
```

Pour un dépôt déjà cloné, mettre à jour votre branche en préservant vos modifications locales. Avant fusion, vous pouvez tester explicitement la branche de la PR au lieu de master.

Le fichier `.env` est local et ignoré par Git. Le conserver lors des mises à jour : ajouter `DEV_IDENTITY_PASSWORD` sans valeur par défaut (12 caractères minimum, compte simulé uniquement) et éventuellement `DEV_IDENTITY_USERNAME` (défaut `local-user`). Entourer le mot de passe de quotes simples pour éviter l’interpolation Compose. Ne pas réutiliser le mot de passe SSH ou Microsoft. Le démarrage échoue sans ce paramètre ; ne pas afficher `docker compose config` sans `--quiet`, car le rendu contient le mot de passe. Il permet de modifier les ports hôte et l’adresse d’écoute de l’API. Ne pas y placer de jetons ou clés privées. Par défaut, seuls les ports `127.0.0.1:8080` et `127.0.0.1:9000` de la VM sont publiés. Les healthchecks déterminent quand les services sont prêts ; un conteneur simplement démarré n’est pas une preuve de disponibilité. L’API attend que le JWKS soit sain.

Vérifier depuis la VM :

```sh
curl -i http://127.0.0.1:8080/public/ping
curl -i http://127.0.0.1:8080/api/message
```

Attendus : `200` et JSON `{"message":"pong"}`, puis `401` sans jeton. Si Python3 est disponible sur la VM, exécuter le test complet sans afficher de jeton :

```sh
python3 dev/compose_smoke.py
```

Le test demande le mot de passe du simulateur si `DEV_IDENTITY_PASSWORD` n’est pas exporté dans le terminal ; la saisie ne s’affiche pas. Il vérifie les mauvais identifiants puis une connexion valide via `POST /token`. Le compte est configurable avec `DEV_IDENTITY_USERNAME`. `GET /token` retourne désormais `405`.

Pour des ports personnalisés, le script accepte `API_BASE_URL` et `IDENTITY_BASE_URL` (les variables de `.env` ne sont pas exportées automatiquement dans votre shell).

## Accéder depuis l’hôte Windows

Option recommandée pour ce simulateur : conserver les ports sur la boucle locale de la VM et ouvrir un tunnel depuis PowerShell sur l’hôte. Remplacer UTILISATEUR et IP_VM :

```powershell
ssh -N -L 8080:127.0.0.1:8080 -L 9000:127.0.0.1:9000 UTILISATEUR@IP_VM
```

Garder cette fenêtre ouverte ; l’API devient accessible sur `http://localhost:8080` depuis l’hôte et le simulateur sur `http://localhost:9000`. Choisir d’autres ports locaux si nécessaire. Le serveur SSH doit être accessible sur la VM.

Pour rendre l’API accessible directement sur un LAN de développement de confiance, modifier `.env` :

```dotenv
API_BIND_ADDRESS=0.0.0.0
API_PORT=8080
```

Puis recréer :

```sh
docker compose up -d --wait --wait-timeout 180
```

L’API sera alors accessible sur `http://IP_VM:8080`. **Le port du simulateur reste lié à 127.0.0.1 sur la VM** : utiliser SSH pour obtenir des jetons. Ne pas exposer le simulateur sur le LAN ou Internet. Un JWT envoyé sur HTTP peut être intercepté : conserver le tunnel pour les essais authentifiés ou ajouter un reverse proxy HTTPS avant tout usage au-delà de ce laboratoire.

Vérifier le routage Hyper-V et les règles réseau de l’hôte/VM. Docker peut contourner certaines règles UFW pour ses ports publiés : ne pas considérer une règle UFW comme preuve que le port publié est inaccessible. Tester réellement depuis les machines autorisées et non autorisées.

## Exploitation de développement

```sh
docker compose ps
docker compose logs --tail=100 api identity
docker compose stop
docker compose up -d --wait --wait-timeout 180
docker compose down
```

Ne pas activer les logs de requêtes contenant Authorization. Les clés de simulation sont éphémères : après redémarrage/recréation d’identity, obtenir un nouveau jeton. Redémarrer aussi l’API si son cache JWKS conserve l’ancienne clé ; pour un redémarrage cohérent : `docker compose restart identity api`. Aucun stockage applicatif n’est à sauvegarder à ce stade.

Pour mettre à jour après une nouvelle version, préserver `.env` et y ajouter les nouvelles variables requises (pour la connexion locale : `DEV_IDENTITY_PASSWORD`), récupérer les changements du dépôt puis relancer `docker compose up --build --wait --wait-timeout 180`. Les images de base utilisent des tags maintenus, pas des digests immuables : conserver l’identifiant de commit et les identifiants d’images pour identifier ce qui a été testé. Aucun push de registre ou déploiement distant n’est effectué par CI.

## Sources officielles

Consultées pour cette configuration :

- [Installer Docker Engine sur Ubuntu](https://docs.docker.com/engine/install/ubuntu/) : distribution supportée, dépôt officiel, plugin Compose et limites des règles de pare-feu.
- [Ordre de démarrage Compose](https://docs.docker.com/compose/how-tos/startup-order/) : attente de `service_healthy`.
- [Commutateurs virtuels Hyper-V](https://learn.microsoft.com/en-us/windows-server/virtualization/hyper-v/get-started/create-a-virtual-switch-for-hyper-v-virtual-machines) : choix du réseau de la VM.
