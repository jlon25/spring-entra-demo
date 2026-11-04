# API des types d’audition

## Portée et décisions

Première fonctionnalité métier : consulter, créer et modifier des types d’audition. Le profil `postgres` est requis ; le démarrage sans ce profil conserve le socle JWT sans persistance. Aucun écran Angular, suppression, dossier, audition planifiée ou donnée de personne n’est ajouté.

JDBC paramétré suffit à ce référentiel simple ; aucun ORM ou service intermédiaire sans responsabilité supplémentaire. Flyway applique les migrations versionnées dans le schéma `auditions`. V1 crée la table ; V2 assouplit la contrainte de pause pour accepter zéro sans modifier V1 ni les données. Java 21, Spring Boot 4.0.9 et Maven sont conservés ; les nouvelles dépendances restent gérées par Boot (Flyway 11.14.1, pilote PostgreSQL 42.7.14). PostgreSQL reste en version 18.6.

Les permissions `hearing-types.read` et `hearing-types.write` ont été validées par le métier. Le compte local simulé reçoit explicitement les deux, plus `api.read`. Un droit d’écriture n’implique pas la lecture ; `api.read` seul n’accorde aucun accès au référentiel. Les rôles métier des intervenants ne déterminent pas ces permissions. L’attribution réelle des droits Entra reste à définir.

## Routes et données

| Méthode et route | Droit | Résultat |
| --- | --- | --- |
| `GET /api/hearing-types` | `hearing-types.read` | `200`, tableau, vide au départ, trié par libellé puis identifiant |
| `GET /api/hearing-types/{id}` | `hearing-types.read` | `200`, ou `404` si absent |
| `POST /api/hearing-types` | `hearing-types.write` | `201`, représentation créée et en-tête `Location` relatif |
| `PUT /api/hearing-types/{id}` | `hearing-types.write` | `200`, représentation mise à jour ; `404` si absent, `409` si version périmée |

Création, exemple entièrement fictif :

```json
{"label":"Type de test","durationMinutes":60,"pauseMinutes":15,"defenderRequired":true}
```

Le libellé est obligatoire, normalisé par suppression des espaces de bord (`String.strip`), au maximum 120 unités UTF-16 après normalisation. Pas d’unicité imposée au libellé. Durée et pause sont des nombres JSON entiers représentables par un entier Java 32 bits : durée strictement positive, pause positive ou nulle. Une pause de zéro minute signifie qu’aucun temps de pause supplémentaire n’est imposé par ce type. Aucune durée ou pause métier par défaut n’est inventée. `defenderRequired` est un booléen obligatoire ; `false` signifie non requis. Les champs inconnus sont refusés ; les nombres décimaux ne sont pas tronqués et les chaînes ne remplacent pas des nombres/booléens.

La réponse contient ces champs, `id` (UUID généré par le backend) et `version` (entier 64 bits, initialement zéro). Une modification remplace tous les champs éditables et exige la version précédemment lue, obligatoire et positive ou nulle. Le backend incrémente la version. Une mise à jour SQL unique conditionnée par l’identifiant et la version empêche l’écrasement concurrent ; le perdant reçoit `409` et doit recharger. Cela ne résout pas les futures réservations d’auditions.

Entrée ou UUID invalide : `400`, format `application/problem+json`. Les erreurs de validation de champs comportent `errors`, liste d’objets `field`/`message`, sans valeur rejetée. Les erreurs de syntaxe JSON peuvent être globales. Les erreurs métier utilisent aussi `ProblemDetail`. La sécurité conserve ses réponses Bearer : `401` sans jeton valide, `403` sans droit. Toute autre méthode/route est refusée par défaut.

La pause est propre au type et destinée à tous les intervenants. La règle de transition entre deux types reste ouverte jusqu’au moteur de planification. Aucune audition existante n’est déplacée par ce référentiel.

## Installation et vérifications

Suivre le [guide PostgreSQL](../deployment/postgresql.md) : ajouter les deux mots de passe dédiés au `.env`, sauvegarder la base existante, démarrer PostgreSQL, exécuter `bash dev/postgres_prepare.sh`, puis reconstruire les trois services. La préparation s’applique au volume existant ; les migrations sont exécutées au démarrage de l’API.

Le compte SQL `auditions_app` dispose seulement de SELECT/INSERT/UPDATE sur la table métier. `auditions_migrator` possède le schéma et applique Flyway ; aucun des deux n’est superutilisateur. La table ne contient aucune donnée initiale.

En lancement natif, fournir `APP_DB_URL` (URL JDBC avec `currentSchema=auditions`), `APP_DB_PASSWORD`, `DB_MIGRATION_PASSWORD`, puis utiliser `-Dspring-boot.run.profiles=local,postgres` pour le laboratoire local. La base doit être préparée et accessible depuis ce processus ; Compose ne publie pas son port. Ne pas publier le port de la base pour contourner les tests.

## Test depuis Windows

Ce parcours **crée une ligne fictive persistante**, puis la modifie. À réaliser uniquement dans la base de développement. Garder le tunnel SSH habituel ouvert ; aucun port supplémentaire n’est nécessaire. La connexion du simulateur reste distincte de SSH et PostgreSQL.

Dans une deuxième fenêtre PowerShell, exécuter d’abord cette commande seule, puis terminer la saisie :

```powershell
$credential = Get-Credential -UserName 'local-user' -Message 'Compte du simulateur local'
```

Adapter le nom si nécessaire. Refaire cette saisie avant chaque essai : le bloc supprime `$credential` dans son `finally`. Le script transmet directement le JSON avec le charset UTF-8, sans appel à `Encoding.GetBytes`, bloqué sur le poste Windows testé en mode `ConstrainedLanguage`. La vérification des identifiants via `GetNetworkCredential()` a fonctionné sur ce poste ; cela ne garantit pas la compatibilité avec toutes les politiques PowerShell. Coller ensuite ce bloc complet :

```powershell
& {
    try {
        $body = @{
            username = $credential.UserName
            password = $credential.GetNetworkCredential().Password
        } | ConvertTo-Json
        $login = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:9000/token' `
            -ContentType 'application/json; charset=utf-8' `
            -Body $body -ErrorAction Stop
        $headers = @{ Authorization = "Bearer $($login.access_token)" }
        $uri = 'http://127.0.0.1:8080/api/hearing-types'
        Invoke-RestMethod -Uri $uri -Headers $headers -ErrorAction Stop

        $sample = @{
            label = 'Type fictif - ' + (Get-Date -Format 'yyyyMMdd-HHmmss')
            durationMinutes = 60
            pauseMinutes = 0
            defenderRequired = $true
        }
        $created = Invoke-RestMethod -Method Post -Uri $uri -Headers $headers `
            -ContentType 'application/json; charset=utf-8' `
            -Body ($sample | ConvertTo-Json) -ErrorAction Stop
        $created

        $sample.durationMinutes = 75
        $sample.version = $created.version
        Invoke-RestMethod -Method Put -Uri "$uri/$($created.id)" -Headers $headers `
            -ContentType 'application/json; charset=utf-8' `
            -Body ($sample | ConvertTo-Json) -ErrorAction Stop
        Invoke-RestMethod -Uri "$uri/$($created.id)" -Headers $headers -ErrorAction Stop
    }
    catch {
        if ($null -ne $_.Exception.Response) {
            Write-Host "Requête refusée : HTTP $([int]$_.Exception.Response.StatusCode)"
        }
        else {
            Write-Host 'Erreur initiale :'
            Write-Host $_.Exception.Message
            Write-Host $_.FullyQualifiedErrorId
            Write-Host $_.InvocationInfo.PositionMessage
        }
    }
    finally {
        Remove-Variable body, login, headers, sample, created -ErrorAction SilentlyContinue
        Remove-Variable credential -Scope 1 -ErrorAction SilentlyContinue
    }
}
```

Attendu : consultation, type créé avec une pause de zéro minute en version 0, puis durée fictive 75, pause toujours nulle et version 1. La consultation initiale peut afficher les types fictifs créés lors d’essais précédents. Ne pas afficher `$body`, `$login` ou `$headers`, ni activer les traces HTTP. La création n’est pas annulée si une étape suivante échoue ; la suppression n’est pas disponible dans cette tranche.

Le navigateur seul ne fournit pas de Bearer : l’écran Angular de connexion et de configuration sera une étape suivante.

## Preuves et reprise

Les tests `HearingTypeApiIT` exécutés par le profil Maven `postgres-it` nécessitent une base de test dédiée PostgreSQL 18.6, préparée avec les mêmes rôles. Ils utilisent le vrai serveur HTTP Spring et de vrais JWT RS256 signés avec un JWKS local, sans Microsoft ni authentification simulée par mock. Ils contrôlent validation, permissions, contraintes SQL, droits des comptes, migration rejouée sans effet et deux modifications concurrentes synchronisées. Les commandes et résultats réellement observés figurent dans la PR/CI ; la présence de ces tests ne prouve pas leur réussite.

V1 ajoute une table et des droits, sans transformer les données précédentes. Un revert applicatif conserve la base ; ne pas supprimer la table, le volume ou l’historique Flyway. Toute correction du schéma après application passe par une migration supplémentaire. Voir le guide PostgreSQL pour les limites de restauration et la séparation des comptes locale.

## Sources déterminantes

- [Boot 4.0.9 : dépendances gérées](https://docs.spring.io/spring-boot/4.0/appendix/dependency-versions/coordinates.html), JDBC/Flyway/validation sans versions supplémentaires.
- [Boot 4.0.9 : DataSourceAutoConfiguration](https://docs.spring.io/spring-boot/4.0/api/java/org/springframework/boot/jdbc/autoconfigure/DataSourceAutoConfiguration.html) et [FlywayAutoConfiguration](https://docs.spring.io/spring-boot/4.0/api/java/org/springframework/boot/flyway/autoconfigure/FlywayAutoConfiguration.html), opt-in via le profil `postgres`.
- [Boot v4.0.9 : propriétés Jackson](https://github.com/spring-projects/spring-boot/blob/v4.0.9/module/spring-boot-jackson/src/main/java/org/springframework/boot/jackson/autoconfigure/JacksonProperties.java), configuration des coercitions numériques.
- [Flyway PostgreSQL](https://documentation.red-gate.com/fd/postgresql-database-277579325.html), module PostgreSQL distinct.
- [PostgreSQL 18 : Read Committed](https://www.postgresql.org/docs/18/transaction-iso.html#XACT-READ-COMMITTED), réévaluation du prédicat après attente sur une mise à jour concurrente.
- [PostgreSQL 18 : privilèges](https://www.postgresql.org/docs/18/ddl-priv.html), séparation du propriétaire de schéma et de l’accès applicatif.
- [Security 7.0 : autorisation HTTP](https://docs.spring.io/spring-security/reference/7.0/servlet/authorization/authorize-http-requests.html) et [Resource Server JWT](https://docs.spring.io/spring-security/reference/7.0/servlet/oauth2/resource-server/jwt.html), droits explicites et validation conservée.
