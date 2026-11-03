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
test -f .env || cp .env.example .env  # conserve un fichier existant
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

## Récupérer automatiquement l’IP Hyper-V et ouvrir le tunnel

Cette procédure documente le dépannage effectué avec succès sur la VM Ubuntu 26.04 : le démon KVP était absent ; après installation et réapplication de la règle udev au périphérique existant, Hyper-V a de nouveau affiché l’IP. Elle ne constitue pas un correctif universel : exécuter les étapes de dépannage seulement si le symptôme correspondant est présent. Elle ne modifie pas Docker ni la configuration réseau de la VM.

### 1. Identifier la VM et vérifier les droits depuis Windows

Dans **PowerShell sur l’hôte Windows**, commencer sans élévation :

```powershell
Get-VM | Select-Object Name, State
Get-VMNetworkAdapter -VMName 'Ubuntu-26.04' |
    Select-Object -ExpandProperty IPAddresses
```

Le nom Hyper-V constaté est `Ubuntu-26.04` ; `ubuntu2604` est le nom Ubuntu, pas le nom de VM à passer à `-VMName`. Adapter le nom à la liste réelle. Ces commandes interrogent l’hôte local ; si la VM est hébergée ailleurs, vérifier l’hôte sélectionné dans le Gestionnaire Hyper-V.

L’exécution sans administrateur Windows a fonctionné avec le compte utilisé pour nos essais, car il dispose de l’accès Hyper-V nécessaire. Cela ne garantit pas les permissions d’un autre compte : en cas d’accès refusé ou module absent, demander l’accès approprié à l’administrateur ou employer la [procédure IP manuelle du README](../../README.md). Il n’est pas nécessaire de réclamer systématiquement une élévation si les commandes sont déjà autorisées.

Si l’IP est affichée, passer directement à l’étape 5. Si la commande ne retourne rien, inspecter les services d’intégration :

```powershell
Get-VMIntegrationService -VMName 'Ubuntu-26.04' |
    Format-Table Name, Enabled, PrimaryStatusDescription
```

L’« Échange de paires clé-valeur » doit être activé et communiquer avec Ubuntu. Le résultat `True / Aucun contact` observé indiquait que l’hôte attendait des informations sans les recevoir. L’« Interface de services d’invité » désactivée ne doit pas être activée pour ce seul besoin. Si l’échange KVP est désactivé côté hôte, faire intervenir une personne disposant des droits requis ; les étapes Ubuntu ne l’activent pas côté Windows.

### 2. Vérifier et installer les outils dans Ubuntu

Utiliser la **console Ubuntu Hyper-V**, ou une session SSH vers une IP déjà connue. Les commandes `sudo` utilisent les droits Ubuntu, distincts des droits Windows :

```sh
systemctl status hv-kvp-daemon.service --no-pager
```

Si le service est absent, vérifier les composants avant installation :

```sh
systemctl list-unit-files --no-pager | grep -Ei 'hyperv|hv.*kvp'
command -v hv_kvp_daemon
dpkg -l | grep -E 'hyperv|linux-cloud-tools'
```

Sur l’installation Ubuntu 26.04 testée, ces sorties étaient vides. Le paquet `linux-cloud-tools-common` fournit le service et ses règles udev ; installer aussi les outils du noyau en cours :

```sh
sudo apt update
sudo apt install linux-cloud-tools-common "linux-cloud-tools-$(uname -r)"
sudo systemctl daemon-reload
sudo systemctl start hv-kvp-daemon.service
systemctl status hv-kvp-daemon.service --no-pager
```

Si APT ne trouve pas le paquet correspondant au noyau, relever `uname -r` et vérifier les dépôts/paquets adaptés ; ne pas remplacer le noyau au hasard. Si le service est `active (running)`, passer à l’étape 5. Vérifier aussi `systemctl is-enabled hv-kvp-daemon.service` ; s’il est désactivé et que l’unité installée prévoit son activation au boot, utiliser `sudo systemctl enable hv-kvp-daemon.service`. Dans nos essais, il était déjà activé par le paquet.

### 3. Diagnostiquer une dépendance KVP en échec

Si le démarrage retourne `A dependency job ... failed`, lire :

```sh
systemctl cat hv-kvp-daemon.service
systemctl list-dependencies --all hv-kvp-daemon.service --no-pager
sudo journalctl -b -u hv-kvp-daemon.service --no-pager -n 30
lsmod | grep hv_utils
ls -l /dev/vmbus/
```

Dans le cas observé, `hv_utils` était chargé et `/dev/vmbus/hv_kvp` existait, mais l’unité dépendait du périphérique systemd `sys-devices-virtual-misc-vmbus\x21hv_kvp.device` non reconnu. Le problème n’était donc pas une absence du module ou de Docker.

Si `hv_utils` n’est pas chargé, essayer `sudo modprobe hv_utils`, vérifier à nouveau les périphériques puis retenter le service. Si le module est introuvable ou le périphérique absent, examiner `sudo journalctl -k -b --no-pager` pour Hyper-V avant de continuer. Ne pas appliquer l’étape suivante à un périphérique inexistant.

Comparer les chemins et propriétés :

```sh
readlink -f /sys/class/misc/hv_kvp
readlink -f '/sys/class/misc/vmbus!hv_kvp'
udevadm info --query=property --name=/dev/vmbus/hv_kvp
```

La première commande peut afficher son argument même si le lien attendu n’existe pas ; ce résultat seul ne prouve pas un périphérique. Dans le diagnostic réussi, la deuxième résolvait `/sys/devices/virtual/misc/vmbus!hv_kvp` et udev indiquait `DEVPATH=/devices/virtual/misc/vmbus!hv_kvp`, sans tag systemd. Le chemin correspondait donc au service, mais les règles nouvellement installées n’avaient vraisemblablement pas encore été appliquées au périphérique déjà présent.

### 4. Réappliquer les règles udev au seul périphérique KVP

Pour **ce cas précis**, avec le périphérique et le chemin précédents présents :

```sh
sudo udevadm control --reload-rules
sudo udevadm trigger --action=add '/sys/devices/virtual/misc/vmbus!hv_kvp'
sudo udevadm settle
sudo systemctl reset-failed hv-kvp-daemon.service
sudo systemctl start hv-kvp-daemon.service
systemctl status hv-kvp-daemon.service --no-pager
```

Attendu : `active (running)`. Cela ne supprime pas la dépendance du service et ne modifie pas son fichier fourni par Ubuntu. Aucun redémarrage de Docker ou de la VM n’a été nécessaire dans le cas observé.

En cas d’échec persistant, conserver les sorties et vérifier la règle installée :

```sh
cat /usr/lib/udev/rules.d/60-hv-kvp-daemon.rules
udevadm info --query=property --name=/dev/vmbus/hv_kvp
```

Ne pas supprimer `BindsTo`, rendre le périphérique accessible à tous ou déclencher globalement tous les périphériques pour contourner l’erreur.

### 5. Confirmer la remontée et ouvrir le tunnel automatique

Attendre quelques secondes puis, dans **PowerShell Windows** :

```powershell
Get-VMNetworkAdapter -VMName 'Ubuntu-26.04' |
    Select-Object -ExpandProperty IPAddresses
```

Dans nos essais, le résultat affichait une IPv4 `192.168.1.46` et une IPv6 locale au lien `fe80::…`. L’IPv4 n’est pas figée : le bloc suivant la récupère à chaque lancement et refuse une sélection ambiguë.

```powershell
& {
    $VmName = 'Ubuntu-26.04' # nom exact affiché par Get-VM
    $VmUser = 'jerome'
    $VmIps = @(
        Get-VMNetworkAdapter -VMName $VmName -ErrorAction Stop |
            Select-Object -ExpandProperty IPAddresses |
            Where-Object { $_ -match '^192\.168\.1\.\d{1,3}$' } |
            Sort-Object -Unique
    )

    if ($VmIps.Count -ne 1) {
        throw "Impossible de choisir une IP unique pour la VM : vérifier KVP, les interfaces et le filtre réseau."
    }

    Write-Host "Ouverture du tunnel vers $($VmIps[0])"
    ssh -N -o ExitOnForwardFailure=yes `
        -L 127.0.0.1:8080:127.0.0.1:8080 `
        -L 127.0.0.1:9000:127.0.0.1:9000 `
        "$VmUser@$($VmIps[0])"
}
```

Adapter le nom de VM, le compte Ubuntu et le filtre `192.168.1.x` si le réseau change. Le script ne prend pas arbitrairement la première adresse et n’utilise pas l’IPv6 `fe80::…`. Si aucune ou plusieurs IPv4 correspondent, inspecter les interfaces ou revenir à la vérification manuelle ; ne pas supprimer le contrôle d’unicité sans choisir le réseau attendu.

Saisir le mot de passe **SSH Ubuntu**, vérifier la clé hôte lors d’une nouvelle connexion et garder la fenêtre ouverte. Si un tunnel occupe déjà ces ports, le conserver ou le fermer avant d’en lancer un autre. Dans une **seconde fenêtre PowerShell**, vérifier :

```powershell
curl.exe --noproxy "*" -i http://127.0.0.1:8080/public/ping
curl.exe --noproxy "*" -i http://127.0.0.1:8080/api/message
```

Attendus : `200` et `401`. Le navigateur peut alors ouvrir `http://127.0.0.1:8080/public/ping`. Cette adresse désigne Windows ; le tunnel est nécessaire pour rejoindre la boucle locale de la VM. La connexion simulée et son mot de passe distinct de SSH sont décrits dans le README. Les commandes supposent les ports par défaut ; adapter les destinations du tunnel si les ports publiés ont changé.

## Accès réseau direct optionnel depuis Windows

Le tunnel SSH documenté ci-dessus conserve les ports de la VM privés. L’alternative suivante est réservée à un LAN de développement de confiance.

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

- [Paquet Ubuntu 26.04 linux-cloud-tools-common](https://packages.ubuntu.com/resolute/all/linux-cloud-tools-common/filelist) : service KVP, binaire et règle udev.
- [Get-VMNetworkAdapter](https://learn.microsoft.com/en-us/powershell/module/hyper-v/get-vmnetworkadapter?view=windowsserver2025-ps) : interrogation des interfaces de la VM sur l’hôte Hyper-V.
