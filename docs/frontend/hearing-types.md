# Gérer les types d’audition dans Angular

## Portée et prérequis

Cette tranche ajoute le référentiel des types : consultation, création et modification du libellé, de la durée, de la pause minimale et de la règle de défenseur. Pas de suppression, dossiers, auditions, disponibilités ou moteur de planification. Le [contrat HTTP](../api/hearing-types.md) et les migrations V1/V2 existants sont conservés ; aucune nouvelle dépendance.

Le backend doit fonctionner avec le profil `postgres` et ses comptes déjà préparés. Une base PostgreSQL simplement démarrée sans API raccordée ne suffit pas. Suivre le [guide PostgreSQL](../deployment/postgresql.md) pour une première installation et le [guide frontend](../deployment/frontend.md) pour le tunnel SSH4200 et la connexion locale.

Depuis le projet sur la VM, après récupération de la branche/PR à tester :

```sh
docker compose -f compose.yaml -f compose.postgres.yaml -f compose.frontend.yaml config --quiet
docker compose -f compose.yaml -f compose.postgres.yaml -f compose.frontend.yaml up --build --wait --wait-timeout 240
docker compose -f compose.yaml -f compose.postgres.yaml -f compose.frontend.yaml ps
```

Conserver `.env`, les comptes, les données et les volumes. Aucun nouveau paramètre d’environnement. Ouvrir http://127.0.0.1:4200 avec le tunnel, puis se connecter au compte du simulateur.

## Parcours de vérification

1. Ouvrir « Types d’audition » dans la navigation, ou `/types-audition`. La liste est vide tant qu’aucun type n’a été enregistré ; elle peut déjà contenir les données fictives des essais PowerShell.
2. Cliquer sur « Nouveau type ». Renseigner un libellé fictif, une durée entière strictement positive, une pause entière positive ou nulle, et cocher ou non « Défenseur requis ». Cliquer sur « Enregistrer ».
3. Vérifier le type dans la liste, puis le modifier. Une pause de zéro doit être acceptée. Durée nulle, pause négative ou valeur décimale doivent être refusées.
4. Recharger le navigateur, se reconnecter puis rouvrir la liste : les données doivent être retrouvées dans PostgreSQL.
5. Pour un conflit, ouvrir la même fiche dans deux onglets, avec une connexion dans chaque onglet (session en mémoire seulement). Enregistrer une première modification, puis essayer d’enregistrer l’autre ancienne version. Le second enregistrement doit être refusé sans écraser la première modification.
6. Vérifier que le brouillon reste visible après ce refus. « Recharger la version serveur » remplace explicitement la saisie par la version actuelle ; réappliquer ensuite les changements souhaités et enregistrer.

Ces essais créent et modifient des données fictives persistantes. La suppression n’existe pas dans cette tranche.

## Validation, erreurs et droits

Le libellé est normalisé par suppression des espaces de bord et limité à 120 unités UTF-16, selon le backend Java. Durée en minutes : entier 1..2147483647. Pause en minutes : entier 0..2147483647. Le champ booléen indique défenseur requis ou non requis. Aucun catalogue, durée ou pause réelle n’est inventé.

Les contrôles Angular améliorent le formulaire ; Spring reste l’autorité et valide indépendamment chaque requête. Les erreurs 400 par champ du backend sont présentées sans afficher de valeur rejetée sensible. Indisponibilité réseau, refus 403, ressource absente 404 et conflit 409 reçoivent des messages distincts. Un 401 suit le comportement de session existant et invite à se reconnecter.

Les boutons de modification utilisent les permissions de la réponse de connexion comme **indications d’affichage** : `hearing-types.read` pour consulter, `hearing-types.write` pour écrire. L’écriture n’implique pas une lecture. Le compte simulé possède actuellement les deux. Ces indications ne valident pas le JWT et ne remplacent pas les scopes vérifiés par l’API ; aucun rôle métier d’intervenant n’est assimilé à un droit d’administration.

Le formulaire capture la version lue. Le PUT envoie cette version ; un conflit ne provoque jamais une tentative automatique avec une version plus récente. L’utilisateur choisit de recharger avant de réappliquer ses modifications.

## Vérifications automatisées et limites

Les tests Angular simulent les réponses HTTP pour les états de liste, validations, droits d’affichage, erreurs et rechargement de conflit. Ils ne démontrent pas la validation JWT ni la persistance réelle.

Le job `frontend-browser` prépare une base jetable, démarre les quatre services et exécute Chromium contre l’API et PostgreSQL. Il vérifie connexion, CRUD autorisé avec pause nulle, relecture après rechargement et conflit entre deux éditions. Les tests existants de réaction UI aux 401/403 restent explicitement simulés. Aucun appel Microsoft, aucune trace contenant les identifiants ou les jetons. Les résultats effectivement observés sont rapportés dans la PR/CI.

La réussite CI ne vaut pas une validation sur la VM personnelle. Aucun changement n’est automatiquement déployé sur celle-ci. Un retour à l’ancienne interface conserve les types enregistrés et le schéma ; ne pas supprimer le volume.
