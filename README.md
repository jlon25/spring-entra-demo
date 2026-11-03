# spring-entra-demo

API Spring Boot pour un frontend séparé, authentifiée par Bearer JWT via OAuth2 Resource Server. Aucun frontend ; la connexion locale simulée se fait via HTTP. Un socle PostgreSQL optionnel est disponible, mais l’API n’y est pas encore raccordée. Microsoft Entra sera intégré ultérieurement.

## Prérequis et vérifications

Java 21, Spring Boot 4.0.9 / Spring Security 7.0.8 (versions gérées par Boot), Maven 3.9.16 via Wrapper 3.3.4.

```sh
./mvnw --batch-mode --no-transfer-progress verify
```

Sous Windows utiliser `mvnw.cmd`. Le premier build nécessite Maven Central. La CI exécute la même commande. Les tests démarrent une API HTTP et un serveur JWKS locaux, génèrent des clés RSA éphémères et envoient de vrais JWT signés au vrai décodeur. Aucun mock d’authentification ni contact Microsoft.

## Développement local sans Docker

Cette section lance les processus directement sur la machine. Ne pas les lancer en même temps que Compose sur les mêmes ports. Depuis le dossier du projet, le simulateur nécessite Python 3 et OpenSSL dans le PATH. Premier terminal :

```sh
export DEV_IDENTITY_USERNAME=local-user
read -r -s -p "Mot de passe local (12 caractères minimum) : " DEV_IDENTITY_PASSWORD; printf '\n'
export DEV_IDENTITY_PASSWORD
python3 dev/identity_provider.py
```

Second terminal :

```sh
./mvnw spring-boot:run -Dspring-boot.run.profiles=local
```

Le simulateur écoute uniquement `127.0.0.1:9000`. `GET /jwks` publie la clé publique. **`POST /token`** vérifie les identifiants avant d’émettre un JWT de cinq minutes avec `api.read` ; `GET /token` ne délivre plus de jeton (`405`). Les clés privées restent temporaires et aucun jeton ni mot de passe n’est journalisé.

Il s’agit d’un compte de développement unique configuré par `DEV_IDENTITY_USERNAME` (défaut `local-user`) et `DEV_IDENTITY_PASSWORD` (obligatoire, 12 caractères minimum, sans valeur par défaut). Ce compte ne correspond ni à un utilisateur Ubuntu ni à un compte Microsoft. Aucun mot de passe n’est stocké en base ; il reste dans la configuration locale et la mémoire du simulateur. Ne pas réutiliser un vrai mot de passe personnel. Ce mécanisme n’est pas un serveur OAuth ni une authentification de production ; pas de création de compte, MFA, renouvellement ou révocation.

Depuis un autre terminal, le test interactif demande le mot de passe sans l’afficher, puis vérifie connexion et accès protégé sans afficher le JWT :

```sh
python3 dev/compose_smoke.py
```

Le script utilise les ports par défaut et `local-user`. Pour un autre compte, exporter `DEV_IDENTITY_USERNAME`. La CI fournit un mot de passe éphémère par variable d’environnement ; en terminal il est demandé si cette variable n’est pas définie. Le script ne charge pas `.env` : pour un utilisateur autre que `local-user`, exporter `DEV_IDENTITY_USERNAME` dans le terminal de test.

Contrat de connexion : `POST http://127.0.0.1:9000/token`, `Content-Type: application/json`, objet avec uniquement les champs texte `username` et `password`. Réponse valide : `200` avec `access_token`, `token_type: Bearer`, `expires_in: 300` et `scope: api.read`. Mauvais identifiants : `401` générique sans jeton. Les entrées mal formées sont rejetées. Le client ne peut choisir ni sujet, audience ni scope.


## Contrat de sécurité

| Route | Accès |
| --- | --- |
| `GET /public/ping` | Public, JSON `{"message":"pong"}` |
| `GET /api/message` | JWT valide et autorité `SCOPE_api.read` |
| Toute autre route | Refusée par défaut |

Jeton absent/invalide : `401`. JWT valide sans scope requis : `403`. Seul RS256 est accepté avec une clé du JWKS configuré. Signature, issuer exact, audience et expiration obligatoire sont vérifiés ; `nbf` est vérifié s’il est présent. Tolérance d’horloge : 60 secondes. Les scopes `scope` ou `scp` deviennent des autorités `SCOPE_…`. L’identité n’accorde pas de permission sans règle explicite.

Hors profil `local`, ces variables sont obligatoires :

| Variable | Propriété |
| --- | --- |
| `JWT_ISSUER_URI` | `app.security.jwt.issuer` |
| `JWT_JWK_SET_URI` | `app.security.jwt.jwk-set-uri` |
| `JWT_AUDIENCE` | `app.security.jwt.audience` |

Le profil `local` utilise issuer `http://localhost:9000`, JWKS `http://localhost:9000/jwks`, audience `spring-entra-demo`. Ces défauts ne sont pas activés hors de ce profil. Ne jamais activer `local` en production. Le port API est externalisable par `SERVER_PORT`.

L’API est sans session, formulaire de login, Basic ou authentification par cookie. CSRF est désactivé pour ce contrat Bearer explicite ; revoir ce choix si des cookies d’authentification sont introduits. Aucun CORS permissif n’est ajouté avant de connaître l’origine du frontend. Ne jamais journaliser Authorization ou les JWT.

## Préparer Entra

Configurer l’issuer du tenant et de la version de jeton retenus, son JWKS et l’audience de l’API ; vérifier les scopes exposés. Utiliser des jetons d’accès, pas des ID tokens. Le simulateur ne prouve pas la compatibilité Entra : tenant, audience, scopes/rôles et validation réelle feront l’objet d’une tâche distincte.

Références : [Resource Server JWT Security 7.0](https://docs.spring.io/spring-security/reference/7.0/servlet/oauth2/resource-server/jwt.html), [Boot 4.0](https://docs.spring.io/spring-boot/4.0/system-requirements.html), [jetons d’accès Entra](https://learn.microsoft.com/en-us/entra/identity-platform/access-tokens).

Lire [AGENTS.md](AGENTS.md) et les fiches avant contribution. Ne pas fusionner ni déployer automatiquement.

## Docker Compose et VM Hyper-V

Le Compose de base démarre deux services : l’API et le simulateur local JWKS. PostgreSQL est optionnel via un second fichier, voir la section dédiée. Aucun frontend Angular n’est encore disponible. Cible : VM Ubuntu 26.04 LTS sous Hyper-V Windows, Docker 29.6.0 et Compose 5.1.4 :

```sh
test -f .env || cp .env.example .env  # conserve le fichier existant
chmod 600 .env
nano .env  # renseigner DEV_IDENTITY_PASSWORD avant le démarrage
docker compose config --quiet
docker compose up --build --wait --wait-timeout 180
```

Si `.env` existe déjà, le conserver et y ajouter `DEV_IDENTITY_PASSWORD` (12 caractères minimum), ainsi que `DEV_IDENTITY_USERNAME` si le compte doit différer de `local-user`. Entourer la valeur du mot de passe de quotes simples dans `.env` pour éviter l’interpolation de `$`. Ne pas afficher ou versionner ce fichier. Compose échoue si le mot de passe n’est pas renseigné.

Consulter le [guide Docker/Hyper-V](docs/deployment/docker-hyperv.md) pour les prérequis, l’accès depuis Windows, les ports et les vérifications. Aucun déploiement distant automatique ; ce Compose conserve une identité simulée de développement.

### Tests rapides sur la VM Ubuntu

Depuis le dossier du projet sur la VM, vérifier les conteneurs et l’API :

```sh
docker compose ps
curl --noproxy "*" -i http://127.0.0.1:8080/public/ping
curl --noproxy "*" -i http://127.0.0.1:8080/api/message
python3 dev/compose_smoke.py
```

Résultats attendus : conteneurs `healthy`, ping `200` avec `{"message":"pong"}`, route protégée sans jeton `401`, puis :

```text
Compose smoke check passed: public ping, Bearer rejection, public JWKS, local login and signed-token access
```

Le script demande le mot de passe local sans l’afficher et vérifie aussi l’accès protégé avec un vrai JWT signé sans afficher le jeton. Il nécessite Python 3 sur la VM ; les ports ci-dessus correspondent aux valeurs par défaut de Compose.

### Tunnel automatique via Hyper-V

La [procédure d’installation et de dépannage KVP](docs/deployment/docker-hyperv.md#récupérer-automatiquement-lip-hyper-v-et-ouvrir-le-tunnel) explique comment installer les outils Ubuntu et rétablir la remontée des IP si Hyper-V ne les affiche pas. Après cette préparation, dans PowerShell sur l’hôte Windows :

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

Ce bloc réutilisable utilise le nom **Hyper-V** `Ubuntu-26.04`, différent du nom Ubuntu `ubuntu2604`. Il fonctionne sans élévation avec un compte autorisé à interroger Hyper-V, comme dans nos essais. Adapter `192.168.1.x` si le réseau change. Saisir le mot de passe SSH et garder la fenêtre ouverte ; les tests Windows ci-dessous se font dans une seconde fenêtre. En cas d’accès Hyper-V impossible, utiliser la procédure manuelle suivante.

### Vérifier l’IP de la VM puis ouvrir le tunnel depuis Windows

**1. Dans Ubuntu**, depuis la console Hyper-V (ou une session SSH encore valide), relever les adresses IPv4 :

```sh
ip -4 -br address show scope global
ip route get 1.1.1.1
```

La seconde commande consulte la table de routage sans envoyer de requête à `1.1.1.1`. Repérer l’adresse après `src` et l’interface après `dev`, puis les comparer à la carte réseau de la VM affichée par la première commande. Ne pas choisir l’adresse de `docker0` ou d’un bridge `br-…`. Si la VM n’a pas de route par défaut, choisir dans la première commande l’adresse de sa carte reliée au commutateur Hyper-V accessible depuis Windows. `hostname -I` peut aussi lister les adresses, mais inclut parfois celles de Docker.

**2. Dans PowerShell sur Windows**, mettre à jour la variable avec l’IP constatée dans Ubuntu :

```powershell
$VmIp = '192.168.1.46' # dernière IP communiquée ; remplacer si différente dans Ubuntu
$VmUser = 'jerome'    # adapter le compte Ubuntu si nécessaire
Test-NetConnection -ComputerName $VmIp -Port 22
```

`TcpTestSucceeded` doit être `True`. Cela vérifie que le port SSH répond à cette IP, pas l’identité de la machine : vérifier ensuite la clé hôte SSH. Si le test échoue, contrôler l’IP, l’accès réseau Hyper-V et le serveur SSH avant de chercher un problème Docker. Le nom Ubuntu `ubuntu2604` n’est pas nécessairement résolu par le DNS Windows. Une adresse attribuée par DHCP peut changer ; refaire cette vérification après un changement réseau ou un redémarrage.

**3. Dans la même fenêtre PowerShell**, ouvrir le tunnel en réutilisant ces variables :

```powershell
ssh -N -o ExitOnForwardFailure=yes -L 127.0.0.1:8080:127.0.0.1:8080 -L 127.0.0.1:9000:127.0.0.1:9000 "$VmUser@$VmIp"
```

Saisir le mot de passe **SSH Ubuntu** lorsqu’il est demandé : aucun caractère ne s’affiche pendant la saisie. Lors d’une première connexion à cette adresse, vérifier l’empreinte de la clé hôte avant de l’accepter. **Garder la fenêtre ouverte après authentification** ; l’absence de terminal est normale avec `-N`. Fermer la fenêtre ou faire `Ctrl+C` coupe le tunnel. Si un tunnel fonctionne déjà sur ces ports, le conserver au lieu d’en ouvrir un second.

**4. Dans une seconde fenêtre PowerShell sur Windows**, tester l’accès sans passer par un proxy :

```powershell
curl.exe --noproxy "*" -i http://127.0.0.1:8080/public/ping
curl.exe --noproxy "*" -i http://127.0.0.1:8080/api/message
```

Attendus : `200` pour le ping et `401` pour la route protégée sans jeton. Dans le navigateur, ouvrir explicitement :

```text
http://127.0.0.1:8080/public/ping
```

L’adresse `127.0.0.1` du navigateur désigne Windows : avec les ports liés à la boucle locale de la VM, le tunnel doit être ouvert pour que cette URL fonctionne. Le ping affiche du JSON, pas une application graphique. En cas d’échec, vérifier d’abord le ping depuis Ubuntu, puis ajouter `-v` avant `-N` dans la commande SSH pour diagnostiquer le tunnel. Les ports indiqués supposent les valeurs par défaut de `.env` ; si `API_PORT` ou `IDENTITY_PORT` changent, adapter les ports de destination du tunnel et les tests sur Ubuntu. Ne pas ajouter de trace HTTP contenant un jeton.

### Connexion simulée depuis PowerShell

Après ouverture du tunnel SSH, procéder en **deux étapes séparées** dans la seconde fenêtre PowerShell. D’abord exécuter cette commande seule et terminer la saisie :

```powershell
$credential = Get-Credential -UserName 'local-user' -Message 'Compte du simulateur local'
```

Adapter `local-user` si `DEV_IDENTITY_USERNAME` a été changé. Ensuite coller le bloc complet, y compris l’enveloppe `& { ... }`, pour empêcher l’exécution prématurée de `try/catch` avant son `finally` :

```powershell
& {
    try {
        $body = @{
            username = $credential.UserName
            password = $credential.GetNetworkCredential().Password
        } | ConvertTo-Json

        $login = Invoke-RestMethod `
            -Method Post `
            -Uri 'http://127.0.0.1:9000/token' `
            -ContentType 'application/json; charset=utf-8' `
            -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) `
            -ErrorAction Stop

        Invoke-RestMethod `
            -Uri 'http://127.0.0.1:8080/api/message' `
            -Headers @{ Authorization = "Bearer $($login.access_token)" } `
            -ErrorAction Stop
    }
    catch {
        if ($null -ne $_.Exception.Response) {
            Write-Host "Requête refusée : HTTP $([int]$_.Exception.Response.StatusCode)"
        }
        else {
            Write-Host "Échec de la requête sans réponse HTTP : vérifier le tunnel et les services."
        }
    }
    finally {
        Remove-Variable body, login -ErrorAction SilentlyContinue
        Remove-Variable credential -Scope 1 -ErrorAction SilentlyContinue
    }
}
```

Avec un mauvais mot de passe, la réponse attendue est `Requête refusée : HTTP 401`, sans appel à la route protégée. Recommencer depuis `Get-Credential` pour un nouvel essai.

Saisir le mot de passe du simulateur défini dans `.env`, pas celui de SSH. La réponse attendue contient `message: authenticated`. Ne pas afficher `$body` ou `$login`, ni activer de traces HTTP/transcription : ils contiennent des données sensibles. Le navigateur seul ne fournit pas de Bearer à `/api/message` ; une connexion par formulaire nécessiterait une interface cliente, hors périmètre actuel. Garder les échanges dans le tunnel SSH ou utiliser HTTPS au-delà du laboratoire.

## Application de planification des auditions — cadrage

Le [modèle métier initial](docs/domain/audition-planning.md) décrit les dossiers, auditions, intervenants, disponibilités, préférences et règles de confirmation. Il distingue les règles validées des décisions encore ouvertes et propose les premiers scénarios d’acceptation.

Le futur frontend sera réalisé avec Angular sous la responsabilité du [spécialiste Angular](docs/agents/angular-developer.md). Ce cadrage ne crée pas encore l’application frontend, les API métier ou la persistance ; le socle d’authentification existant reste disponible.

Le [découpage de la première tranche](docs/domain/first-slice-hearing-types.md) précise les petites PR prévues pour les types d’audition, PostgreSQL et l’interface Angular, ainsi que les décisions métier encore à confirmer.

## Socle PostgreSQL optionnel

PostgreSQL est disponible séparément pour préparer la persistance. L’API n’y est pas encore raccordée. Le lancement Compose actuel reste inchangé.

Pour activer seulement PostgreSQL, ajouter `POSTGRES_PASSWORD` dans le `.env` existant (voir `.env.example`), en conservant les paramètres du simulateur :

```sh
docker compose -f compose.yaml -f compose.postgres.yaml config --quiet
docker compose -f compose.yaml -f compose.postgres.yaml up -d --wait --wait-timeout 120 postgres
```

Pour reconstruire et démarrer **les trois services**, puis les vérifier depuis Ubuntu :

```sh
docker compose -f compose.yaml -f compose.postgres.yaml up --build --wait --wait-timeout 180
docker compose -f compose.yaml -f compose.postgres.yaml ps
python3 dev/compose_smoke.py
docker compose -f compose.yaml -f compose.postgres.yaml exec -T postgres sh -c 'psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT current_database(), version();"'
```

Les trois services doivent être `healthy`. Le smoke test demande le mot de passe du **simulateur** et vérifie l’authentification HTTP ; la dernière commande vérifie PostgreSQL séparément. Elle doit afficher la base configurée (`auditions` par défaut) et PostgreSQL 18.6. L’API n’utilise pas encore cette base et aucune table métier n’est attendue. Utiliser les deux fichiers Compose pour afficher les trois services ; `docker compose ps` seul concerne la configuration de base.

Le [guide PostgreSQL](docs/deployment/postgresql.md) explique le volume persistant, les vérifications SQL, les sauvegardes et la restauration dans une base de contrôle. Ne pas supprimer les volumes lors des mises à jour ; modifier le mot de passe dans `.env` ne le change pas dans une base déjà initialisée.

### Sauvegarde manuelle horodatée

Depuis le dossier du projet sur la VM Ubuntu, avec PostgreSQL démarré :

```sh
bash dev/postgres_backup.sh "backups/auditions-$(date -u +%Y-%m-%d_%H-%M-%SZ).dump"
```

La date et l’heure **UTC** sont calculées au moment de l’exécution, à la seconde près. Le suffixe `Z` indique UTC ; le nom suit par exemple la forme `auditions-2026-11-03_14-30-05Z.dump`. Deux lancements dans la même seconde peuvent produire le même nom : le script refuse alors d’écraser l’archive existante.

Cette commande crée une sauvegarde à la demande ; aucune sauvegarde n’est déclenchée automatiquement à l’arrêt de la VM ou au redémarrage de Docker. Le script crée le dossier `backups/` si nécessaire. Les archives sont privées et ignorées par Git ; conserver une copie importante hors de la VM, dans un emplacement protégé. Consulter le [guide PostgreSQL](docs/deployment/postgresql.md) pour les limites de la sauvegarde et la vérification d’une restauration.
