# spring-entra-demo

API Spring Boot pour un frontend séparé, authentifiée par Bearer JWT via OAuth2 Resource Server. Aucun frontend, base de données ou login interactif. Microsoft Entra sera intégré ultérieurement.

## Prérequis et vérifications

Java 21, Spring Boot 4.0.9 / Spring Security 7.0.8 (versions gérées par Boot), Maven 3.9.16 via Wrapper 3.3.4.

```sh
./mvnw --batch-mode --no-transfer-progress verify
```

Sous Windows utiliser `mvnw.cmd`. Le premier build nécessite Maven Central. La CI exécute la même commande. Les tests démarrent une API HTTP et un serveur JWKS locaux, génèrent des clés RSA éphémères et envoient de vrais JWT signés au vrai décodeur. Aucun mock d’authentification ni contact Microsoft.

## Développement local

Le simulateur nécessite Python 3 et OpenSSL dans le PATH. Premier terminal :

```sh
python3 dev/identity_provider.py
```

Second terminal :

```sh
./mvnw spring-boot:run -Dspring-boot.run.profiles=local
```

Le simulateur écoute uniquement `127.0.0.1:9000`. `GET /jwks` publie la clé publique ; `GET /token` délivre un jeton de développement de cinq minutes avec `api.read`. Les clés privées restent temporaires. Aucun jeton n’est journalisé par le serveur. Ce service sans authentification est exclusivement local : ne pas l’exposer ni le déployer.

Exemple avec curl et jq, sans traces shell ou HTTP contenant Authorization :

```sh
curl -i http://localhost:8080/public/ping
curl -i http://localhost:8080/api/message
TOKEN=$(curl --fail --silent http://localhost:9000/token | jq -r .access_token)
curl --silent -H "Authorization: Bearer $TOKEN" http://localhost:8080/api/message
unset TOKEN
```

Les deux premières requêtes retournent respectivement `200` et `401`. La requête authentifiée retourne `200` et `{"message":"authenticated"}`. Ne pas partager, versionner ou journaliser le jeton.

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
