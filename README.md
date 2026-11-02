# spring-entra-demo

API Spring Boot pour un frontend séparé, authentifiée par Bearer JWT via OAuth2 Resource Server. Aucun frontend ni base de données ; la connexion locale simulée se fait via HTTP. Microsoft Entra sera intégré ultérieurement.

## Prérequis et vérifications

Java 21, Spring Boot 4.0.9 / Spring Security 7.0.8 (versions gérées par Boot), Maven 3.9.16 via Wrapper 3.3.4.

```sh
./mvnw --batch-mode --no-transfer-progress verify
```

Sous Windows utiliser `mvnw.cmd`. Le premier build nécessite Maven Central. La CI exécute la même commande. Les tests démarrent une API HTTP et un serveur JWKS locaux, génèrent des clés RSA éphémères et envoient de vrais JWT signés au vrai décodeur. Aucun mock d’authentification ni contact Microsoft.

## Développement local

Le simulateur nécessite Python 3 et OpenSSL dans le PATH. Premier terminal :

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

Le script utilise les ports par défaut et `local-user`. Pour un autre compte, exporter `DEV_IDENTITY_USERNAME`. En CI seulement, le mot de passe est fourni par variable d’environnement éphémère ; en terminal il est demandé si cette variable n’est pas définie.

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

Deux services sont fournis : l’API et le simulateur local JWKS. Cible : VM Ubuntu 26.04 LTS sous Hyper-V Windows, Docker 29.6.0 et Compose 5.1.4 :

```sh
cp .env.example .env  # première installation seulement
chmod 600 .env
nano .env  # renseigner DEV_IDENTITY_PASSWORD avant le démarrage
docker compose up --build --wait --wait-timeout 180
```

Si `.env` existe déjà, le conserver et y ajouter `DEV_IDENTITY_PASSWORD` (12 caractères minimum), ainsi que `DEV_IDENTITY_USERNAME` si le compte doit différer de `local-user`. Entourer la valeur du mot de passe de quotes simples dans `.env` pour éviter l’interpolation de `$`. Ne pas afficher ou versionner ce fichier. Compose échoue si le mot de passe n’est pas renseigné.

Consulter le [guide Docker/Hyper-V](docs/deployment/docker-hyperv.md) pour les prérequis, l’accès depuis Windows, les ports et les vérifications. Aucun déploiement distant automatique ; ce Compose conserve une identité simulée de développement.

### Tests rapides sur la VM Ubuntu

Depuis le dossier du projet sur la VM, vérifier les conteneurs et l’API :

```sh
docker compose ps
curl -i http://127.0.0.1:8080/public/ping
curl -i http://127.0.0.1:8080/api/message
python3 dev/compose_smoke.py
```

Résultats attendus : conteneurs `healthy`, ping `200` avec `{"message":"pong"}`, route protégée sans jeton `401`, puis :

```text
Compose smoke check passed: public ping, Bearer rejection, public JWKS, local login and signed-token access
```

Le script demande le mot de passe local sans l’afficher et vérifie aussi l’accès protégé avec un vrai JWT signé sans afficher le jeton. Il nécessite Python 3 sur la VM ; les ports ci-dessus correspondent aux valeurs par défaut de Compose.

### Tunnel SSH depuis Windows

Dans **PowerShell sur Windows**, ouvrir le tunnel vers la VM :

```powershell
ssh -N -o ExitOnForwardFailure=yes -L 127.0.0.1:8080:127.0.0.1:8080 -L 127.0.0.1:9000:127.0.0.1:9000 jerome@192.168.1.127
```

`jerome@192.168.1.127` correspond à la VM utilisée lors des essais ; adapter le compte et l’adresse si nécessaire. Le nom Hyper-V `ubuntu2604` n’est pas forcément résolu par le DNS Windows. Pour retrouver l’IP dans Ubuntu, utiliser `hostname -I` et identifier l’adresse de la carte réseau de la VM, pas celle d’un réseau Docker.

Saisir le mot de passe SSH lorsqu’il est demandé : aucun caractère ne s’affiche pendant la saisie. Lors d’une première connexion, vérifier l’empreinte de la clé hôte avant de l’accepter. **Garder la fenêtre ouverte** ; l’absence de terminal après authentification est normale avec `-N`. Fermer la fenêtre ou faire `Ctrl+C` coupe le tunnel.

Dans une **seconde fenêtre PowerShell**, tester l’accès sans passer par un proxy :

```powershell
curl.exe --noproxy "*" -i http://127.0.0.1:8080/public/ping
curl.exe --noproxy "*" -i http://127.0.0.1:8080/api/message
```

Attendus : `200` pour le ping et `401` pour la route protégée sans jeton. Dans le navigateur, ouvrir explicitement :

```text
http://127.0.0.1:8080/public/ping
```

En cas d’échec, vérifier d’abord le ping depuis Ubuntu, puis relancer la commande SSH avec `-v` pour diagnostiquer le tunnel. Ne pas ajouter de trace HTTP contenant un jeton.

### Connexion simulée depuis PowerShell

Après ouverture du tunnel SSH, dans une seconde fenêtre PowerShell :

```powershell
$credential = Get-Credential -UserName 'local-user' -Message 'Compte du simulateur local'
try {
    $body = @{ username = $credential.UserName; password = $credential.GetNetworkCredential().Password } | ConvertTo-Json
    $login = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:9000/token' -ContentType 'application/json' -Body $body
    Invoke-RestMethod -Uri 'http://127.0.0.1:8080/api/message' -Headers @{ Authorization = "Bearer $($login.access_token)" }
} finally {
    Remove-Variable credential, body, login -ErrorAction SilentlyContinue
}
```

Saisir le mot de passe du simulateur défini dans `.env`, pas celui de SSH. La réponse attendue contient `message: authenticated`. Ne pas afficher `$body` ou `$login`, ni activer de traces HTTP/transcription : ils contiennent des données sensibles. Le navigateur seul ne fournit pas de Bearer à `/api/message` ; une connexion par formulaire nécessiterait une interface cliente, hors périmètre actuel. Garder les échanges dans le tunnel SSH ou utiliser HTTPS au-delà du laboratoire.

## Application de planification des auditions — cadrage

Le [modèle métier initial](docs/domain/audition-planning.md) décrit les dossiers, auditions, intervenants, disponibilités, préférences et règles de confirmation. Il distingue les règles validées des décisions encore ouvertes et propose les premiers scénarios d’acceptation.

Le futur frontend sera réalisé avec Angular sous la responsabilité du [spécialiste Angular](docs/agents/angular-developer.md). Ce cadrage ne crée pas encore l’application frontend, les API métier ou la persistance ; le socle d’authentification existant reste disponible.
