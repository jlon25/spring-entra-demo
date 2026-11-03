# Socle PostgreSQL de développement

## Portée

Ce socle ajoute un serveur PostgreSQL **18.6** (`postgres:18.6-bookworm`, image officielle) avec stockage persistant et vérifications de sauvegarde/restauration. La version18 est supportée ; le tag de patch est explicite mais n’est pas un digest immuable. Ne pas changer de version majeure en réutilisant le volume sans procédure de migration.

Le profil Spring `postgres` raccorde maintenant l’API à la base avec JDBC et Flyway. La migration V1 crée le référentiel `auditions.hearing_type`, sans données initiales. Le compte `POSTGRES_USER` reste l’administrateur d’initialisation ; l’API utilise exclusivement `auditions_app`, les migrations `auditions_migrator`. Aucun ORM ni génération automatique du schéma.

PostgreSQL est opt-in via `compose.postgres.yaml`. Le fichier `compose.yaml` et son lancement habituel restent inchangés. Aucun port5432 n’est publié sur la VM ou Windows ; les outils PostgreSQL sont disponibles dans le conteneur.

## Premier lancement sur la VM

Depuis le dossier du projet à jour, conserver le `.env` existant et ajouter les variables de la section PostgreSQL de `.env.example` :

```dotenv
POSTGRES_DB=auditions
POSTGRES_USER=postgres
POSTGRES_PASSWORD=
APP_DB_PASSWORD=
DB_MIGRATION_PASSWORD=
```

Renseigner trois mots de passe PostgreSQL locaux distincts, différents du mot de passe du simulateur, SSH ou Microsoft. La valeur vide ci-dessus est un emplacement à remplir, pas un mot de passe utilisable. Entourer la vraie valeur de quotes simples dans `.env` pour éviter l’interpolation de `$`. Ne pas versionner ni afficher `.env`. Conserver également `DEV_IDENTITY_PASSWORD`, nécessaire à la configuration Compose de base.

```sh
chmod 600 .env
docker compose -f compose.yaml -f compose.postgres.yaml config --quiet
docker compose -f compose.yaml -f compose.postgres.yaml up -d --wait --wait-timeout 120 postgres
docker compose -f compose.yaml -f compose.postgres.yaml ps
```

Avant de raccorder l’API, sauvegarder une base existante puis préparer les rôles et le schéma, y compris sur un volume déjà initialisé :

```sh
bash dev/postgres_backup.sh "backups/auditions-$(date -u +%Y-%m-%d_%H-%M-%SZ).dump"
bash dev/postgres_prepare.sh
```

La préparation nécessite le compte administrateur local. Elle crée les deux rôles sans privilèges administratifs et le schéma dédié ; elle réapplique explicitement les mots de passe des deux rôles depuis les variables du conteneur, mais ne change pas celui de `POSTGRES_USER`. Après modification de ces variables dans `.env`, recréer le service avec `up -d --wait ... postgres` avant de relancer la préparation. Aucun script d’initialisation de volume vide n’est utilisé pour contourner les volumes existants.

Le script refuse un propriétaire de schéma inattendu ou des rôles privilégiés préexistants. En cas de refus, examiner la situation ; ne pas supprimer le volume ou appliquer automatiquement un baseline Flyway. La préparation n’installe pas de tables métier et ne les efface pas.

Pour démarrer aussi l’API et le simulateur (Flyway crée la table au démarrage) :

```sh
docker compose -f compose.yaml -f compose.postgres.yaml up --build --wait --wait-timeout 180
python3 dev/compose_smoke.py
```

Le test JWT vérifie toujours l’authentification HTTP et demande le mot de passe du simulateur. Les tests du référentiel sont décrits dans le [contrat API](../api/hearing-types.md). Vérifier une requête SQL séparément :

```sh
docker compose -f compose.yaml -f compose.postgres.yaml exec -T postgres sh -c 'psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT current_database(), version();"'
```

L’authentification réseau est configurée en SCRAM. Les commandes administratives ci-dessus utilisent la socket locale du conteneur ; elles ne prouvent pas à elles seules l’authentification réseau. La CI teste également une connexion TCP avec le bon et un mauvais mot de passe.

## Persistance et identifiants

Le volume Compose `postgres_data` est monté sur `/var/lib/postgresql`, conformément au layout de l’image PostgreSQL18 (données sous `/var/lib/postgresql/18/docker`). L’entrypoint officiel prépare les permissions à la première initialisation puis exécute le serveur comme utilisateur `postgres`.

Les données survivent au redémarrage et à la recréation du conteneur. Pour l’arrêter sans supprimer les données :

```sh
docker compose -f compose.yaml -f compose.postgres.yaml stop postgres
```

Relancer avec la commande `up -d --wait ... postgres` du premier lancement. Conserver le même dossier/projet Compose et le même nom de volume ; changer de nom de projet peut donner l’impression d’une base vide parce qu’un autre volume est créé.

**Ne pas utiliser `down --volumes`, `docker volume prune` ou supprimer le volume sur la VM pour effectuer une mise à jour.** Le nettoyage des volumes dans la CI concerne uniquement ses projets de test jetables.

`POSTGRES_DB`, `POSTGRES_USER` et `POSTGRES_PASSWORD` initialisent uniquement un volume vide. Modifier `.env` après initialisation ne change pas le mot de passe, le nom du rôle ou celui de la base existante. Ne pas effacer le volume pour contourner ce point ; une rotation de mot de passe ou migration doit être effectuée explicitement dans une tâche adaptée.

## Sauvegarde locale

Depuis la VM, sans installer de client PostgreSQL sur Ubuntu :

```sh
bash dev/postgres_backup.sh backups/auditions-2026-11-02.dump
```

Choisir un nouveau nom à chaque sauvegarde. Le script utilise `pg_dump` au format custom, crée un fichier privé et refuse d’écraser un fichier existant. Les archives du répertoire `backups/` sont exclues de Git et du contexte de build Docker. Une archive peut contenir les données personnelles futures : la conserver dans un emplacement protégé et en copier une version sur un autre support selon le besoin.

Cette sauvegarde concerne une base, pas les rôles globaux, mots de passe ou la configuration complète du cluster. Le `.env` reste à préserver séparément et de manière privée. Un volume n’est pas une sauvegarde ; la simple création d’un fichier dump ne démontre pas sa restaurabilité.

## Vérifier une restauration sans écraser la base utilisée

Utiliser une archive de confiance. Créer une **nouvelle base de contrôle**, dont le nom est encore libre :

```sh
docker compose -f compose.yaml -f compose.postgres.yaml exec -T postgres sh -c 'createdb -U "$POSTGRES_USER" --template=template0 auditions_restore_check'
docker compose -f compose.yaml -f compose.postgres.yaml exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" --dbname=auditions_restore_check --exit-on-error --no-owner --no-privileges' < backups/auditions-2026-11-02.dump
docker compose -f compose.yaml -f compose.postgres.yaml exec -T postgres sh -c 'psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d auditions_restore_check -c "SELECT current_database();" -c "\\dt"'
```

Si `auditions_restore_check` existe déjà, choisir un autre nom ; ne pas supprimer une base inconnue ni restaurer par-dessus `auditions`. Vérifier les tables et données attendues avant de conclure. Pour le test de socle, la CI crée un témoin fictif et prouve sa relecture après restauration ; une future sauvegarde réelle devra être contrôlée avec ses propres données de référence.

Les options `--no-owner --no-privileges` facilitent cette restauration de contrôle sous un administrateur local ; elles ne reproduisent pas les droits de production. La procédure de restauration réelle devra aussi rétablir et vérifier les droits appropriés.

## Test technique automatisé

Le job CI `postgres-smoke` crée un projet isolé `pg-smoke-…`, initialise deux bases fictives, vérifie un accès TCP autorisé/refusé, écrit une donnée témoin, recrée le conteneur sans effacer le volume, relit la donnée, exporte et restaure dans l’autre base, puis contrôle le résultat. Son nettoyage ne vise que ses ressources jetables.

Le script `dev/postgres_smoke.py --allow-test-databases` refuse une exécution hors d’un projet de test au préfixe `pg-smoke-`. **Ce script recrée le conteneur PostgreSQL : ne pas le lancer sur le projet utilisé par l’application.** Sur la VM habituelle, employer les vérifications SQL et la procédure de restauration dans une nouvelle base décrites ci-dessus.

Le job `hearing-types-integration` prépare une base PostgreSQL 18.6 isolée puis exécute `./mvnw --batch-mode --no-transfer-progress -Ppostgres-it verify` : vrais JWT signés, migrations, contraintes, droits et mises à jour concurrentes. Ce profil exige `TEST_DB_URL`, `TEST_DB_APP_PASSWORD` et `TEST_DB_MIGRATION_PASSWORD` et ne doit viser qu’une base de test préparée : il ajoute des lignes fictives. Le `verify` standard conserve les tests sans base ; il ne constitue pas une preuve du fonctionnement PostgreSQL.

Une réussite sur le runner CI ne démontre pas encore l’exécution sur la VM personnelle. Les futures réservations d’auditions nécessiteront leurs propres contraintes de concurrence.

## Retour à la configuration précédente

La migration V1 est additive : l’ancien code sans persistance peut démarrer en ignorant le schéma. Pour revenir au mode API/JWT sans DB, recréer l’API avec le seul `compose.yaml` ; les routes métier ne sont alors pas disponibles. Conserver le volume, les rôles et les sauvegardes. Ne pas retirer la table ni modifier V1 après application ; toute correction ultérieure passe par une nouvelle migration.

L’application locale détient les deux identifiants pour exécuter les migrations au démarrage. Les comptes SQL sont distincts, mais cela ne constitue pas une séparation de secrets entre processus : pour une production future, exécuter les migrations dans un processus dédié avant le lancement de l’API avec son seul compte DML. Le compte applicatif dispose seulement de SELECT/INSERT/UPDATE sur la table métier, pas de DELETE, DDL ou écriture dans l’historique Flyway.

Le dump n’inclut pas les rôles globaux. La restauration de contrôle avec `--no-owner --no-privileges` vérifie les données, mais ne suffit pas pour redémarrer l’API : une reprise réelle doit rétablir les propriétaires et droits du schéma, de la table et de l’historique, puis vérifier Flyway et les accès sous chaque compte. Ne pas prendre une restauration administrative pour une validation des droits applicatifs.

## Sources officielles consultées

- [Politique de versions PostgreSQL](https://www.postgresql.org/support/versioning/).
- [Image officielle PostgreSQL](https://hub.docker.com/_/postgres) : tag, layout18, variables d’initialisation et persistance.
- [pg_dump PostgreSQL18](https://www.postgresql.org/docs/18/app-pgdump.html) : archive custom et périmètre d’une base.
- [pg_restore PostgreSQL18](https://www.postgresql.org/docs/18/app-pgrestore.html) : restauration et droits.

