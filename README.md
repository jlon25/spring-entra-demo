# spring-entra-demo

Backend Java pour un frontend séparé. Ce premier socle expose uniquement un ping public ; l’authentification OAuth2 Resource Server et la simulation JWT/JWKS seront ajoutées dans une étape suivante. Ne pas considérer cette version comme une API sécurisée prête à exposer des données métier.

## Prérequis et choix

- Java 21 (LTS).
- Spring Boot 4.0.9, version stable confirmée dans la [documentation officielle 4.0](https://docs.spring.io/spring-boot/4.0/system-requirements.html), compatible avec Java 21.
- Maven via le wrapper versionné : aucune installation globale de Maven nécessaire. Le premier lancement nécessite l’accès aux dépôts de distribution et de dépendances.

Maven est retenu pour ce nouveau socle ; aucun build antérieur n’est remplacé. Le parent Spring Boot gère les versions des dépendances. Aucune base de données, ORM ou application frontend n’est introduite.

## Vérifier et démarrer

```sh
./mvnw --batch-mode --no-transfer-progress verify
./mvnw spring-boot:run
```

Sous Windows, utiliser `mvnw.cmd` avec les mêmes arguments.

```sh
curl -i http://localhost:8080/public/ping
```

Contrat : `GET /public/ping` sans authentification retourne `200 OK`, un contenu `application/json` et `{"message":"pong"}`. Un test d’intégration démarre l’application sur un port aléatoire et exerce réellement HTTP ; il vérifie aussi une route inexistante. Aucun mock de JWT ne constitue ici une preuve de sécurité : aucune validation JWT n’est encore implémentée.

Le port peut être externalisé avec `SERVER_PORT`. Le workflow GitHub Actions utilise Java 21 et la même commande `verify`. Sa présence seule ne prouve pas son succès : consulter les résultats de la PR.

## Étape suivante

Ajouter Resource Server JWT avec une route protégée, issuer/audience externalisés et fournisseur local JWKS. Tester des JWT réellement signés, les signatures invalides, issuer/audience incorrects, expiration et scopes insuffisants, sans service Microsoft. L’intégration Entra viendra ensuite.

Lire [AGENTS.md](AGENTS.md) et les fiches de rôle avant toute contribution. Ne pas fusionner ni déployer automatiquement.
