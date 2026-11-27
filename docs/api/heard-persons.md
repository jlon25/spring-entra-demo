# API des personnes auditionnées

## Portée et minimisation

Cette tranche permet de créer, consulter et modifier une fiche minimale de personne auditionnée. Le profil `postgres` est requis. Aucun dossier, audition, import, suppression ou état actif/inactif de personne n’est ajouté.

La fiche ne comporte aucun nom, prénom, date de naissance, adresse ou champ de commentaire libre. La référence métier doit être opaque et ne pas contenir ces informations. Elle est distincte de l’UUID technique. Une référence qui permet un rapprochement dans une application externe reste un identifiant pseudonyme ; l’absence d’identité civile ne prouve pas une anonymisation irréversible.

La minorité est une information explicite : `MINOR`, `ADULT` ou `UNKNOWN`. `UNKNOWN` n’est jamais interprété comme majeur. Aucune limite d’âge juridique ou disposition automatique pour mineur n’est déduite.

## Contrat HTTP

| Route | Permission | Résultat |
| --- | --- | --- |
| `GET /api/heard-persons` | `heard-persons.read` | `200`, liste triée par référence puis identifiant |
| `GET /api/heard-persons/{id}` | `heard-persons.read` | `200` ou `404` |
| `POST /api/heard-persons` | `heard-persons.write` | `201`, représentation et en-tête Location |
| `PUT /api/heard-persons/{id}` | `heard-persons.write` | `200`, représentation ; `404` ou `409` selon le conflit |

Création entièrement fictive :

```json
{"reference":"FICTIF-PERSONNE-001","minorityStatus":"UNKNOWN"}
```

Réponse :

```json
{"id":"11111111-1111-4111-8111-111111111111","reference":"FICTIF-PERSONNE-001","minorityStatus":"UNKNOWN","version":0}
```

Pour modifier, envoyer les deux champs éditables et la `version` réellement lue. L’identifiant est généré par le backend. La référence est obligatoire, normalisée par suppression des espaces de bord et limitée à 120 unités UTF-16 ; elle est unique, avec comparaison sensible à la casse. La normalisation ne convertit pas la casse et ne traduit pas la référence. Les rapprochements futurs d’import devront respecter ce contrat ou faire l’objet d’une évolution explicite.

Le statut est obligatoire et doit être exactement `MINOR`, `ADULT` ou `UNKNOWN`. La version de modification est un entier JSON positif ou nul. Les champs inconnus, dont `name`, `firstName` ou `birthDate`, sont refusés. Les coercitions de chaînes, nombres et booléens ne remplacent pas la validation.

## Erreurs et concurrence

- Entrée invalide : `400 application/problem+json`, avec erreurs par champ lorsque possible, sans valeur rejetée.
- Jeton absent/invalide : `401`. Droit manquant : `403`.
- Identifiant inconnu : `404`.
- Référence déjà utilisée : `409`, code `reference_conflict`.
- Version périmée : `409`, code `concurrent_modification`.

Les erreurs de doublon ne retournent ni référence concurrente, ni données d’une autre personne. Les requêtes SQL sont paramétrées. La contrainte unique PostgreSQL protège aussi deux créations concurrentes ; l’édition compare atomiquement l’identifiant et la version avant de l’incrémenter. Un client ne doit pas recharger et réessayer une écriture automatiquement après conflit.

La lecture et l’écriture restent indépendantes. Les scopes `hearing-types.*` et `api.read` ne donnent pas accès aux personnes. Le compte local de développement reçoit explicitement les deux nouveaux scopes ; un JWT émis avant cette mise à jour ne les acquiert pas automatiquement.

## Migration et exploitation

V5 crée la table dédiée et ses contraintes sans modifier V1 à V4 ni les types existants. Le compte applicatif reçoit SELECT, INSERT et UPDATE sur cette table, sans DELETE ni droit DDL. Le compte migrateur conserve la responsabilité de la migration. Les versions Java21, Spring Boot4.0.9, Maven et PostgreSQL18.6 sont conservées ; aucune dépendance ajoutée.

Les contraintes sont fondées sur les mécanismes PostgreSQL18 de [nullabilité, contrôle et unicité](https://www.postgresql.org/docs/18/ddl-constraints.html). Le contrôle de concurrence exploite la [réévaluation du prédicat en Read Committed](https://www.postgresql.org/docs/18/transaction-iso.html#XACT-READ-COMMITTED). Sources consultées le 27 novembre 2026.

Sauvegarder la base avant mise à jour, conserver `.env` et les volumes, puis reconstruire API, identité et frontend. Flyway applique V5 au démarrage. Ne pas modifier l’historique ou supprimer le volume pour appliquer cette migration. Un retour de code ne supprime pas les fiches créées : privilégier un correctif en avant et vérifier les compatibilités avant restauration.

## Import ultérieur et information temporelle

Le processus d’import n’est pas implémenté. Sa règle retenue est de calculer le statut à partir de la date source avant d’enregistrer uniquement le statut. La date de naissance ne doit pas devenir un champ persistant, une valeur de log ou une erreur affichée.

Sans date stockée ni nouvel import, le statut ne change pas automatiquement avec le temps. Le futur import devra préciser la date de référence du calcul, sa règle, la fréquence de mise à jour, le rapprochement par référence et la résolution des modifications concurrentes. Aucune règle d’âge n’est inventée ici.

Les langues parlées, le genre et les besoins particuliers restent des évolutions métier à cadrer ; ils ne se limitent pas aux langues FR/DE/IT de l’interface. Les dossiers et la continuité du défenseur par dossier seront ajoutés séparément.
