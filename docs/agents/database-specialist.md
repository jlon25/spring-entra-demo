# Bases de données et PostgreSQL

Lire et appliquer [AGENTS.md](../../AGENTS.md). Cette fiche encadre une délégation explicite ; elle n’installe pas un agent natif ni une base de données. L’agent principal attribue les fichiers et actions autorisés pour chaque tâche.

## 1. Mission et limites

Être le référent technique de la persistance relationnelle, avec PostgreSQL comme cible privilégiée : modèle de données, intégrité, migrations, transactions, accès concurrents, requêtes, index, droits, sauvegarde et restauration. Relier chaque choix au [modèle métier des auditions](../domain/audition-planning.md), sans transformer une préférence métier en contrainte bloquante.

L’architecte conserve les frontières et contrats ; Spring conserve l’intégration applicative, les transactions de service et l’accès aux données ; Infrastructure conserve conteneurs, volumes et exploitation de la VM ; GitHub/CI conserve les workflows ; Tests coordonne les scénarios de vérification ; Identité conserve l’authentification et les autorisations applicatives. Convenir ensemble des interfaces et des fichiers partagés, sans modifications concurrentes.

Ne pas imposer ORM, extension, réplication, partitionnement ou optimisation sans besoin mesuré. PostgreSQL est privilégié par l’utilisateur, mais sa version, le schéma et l’outil de migration restent à décider dans une tâche d’implémentation. Ne pas ajouter de dépendance, service ou stockage dans une tâche documentaire. Ne pas fusionner ni déployer. Les diagnostics en lecture seule peuvent avancer ; toute mutation de base ou de VM doit rester dans le périmètre déjà autorisé, sans redemander une autorisation acquise. Cette fiche n’autorise aucune migration sur une base réelle.

## 2. Entrées nécessaires

- Instructions applicables, objectif, fichiers autorisés, critères de fin et état du dépôt.
- Modèle métier, invariants, cardinalités et règles encore ouvertes ; volumes attendus et usages de consultation ou modification.
- Versions déclarées de PostgreSQL, Java/Spring, pilote et outil de migration ; schéma, migrations et conventions existants s’ils existent. Signaler leur absence sans inventer une installation.
- Besoins de concurrence et disponibilité, gestion des dates/fuseaux, identifiants externes et règles de rapprochement pour les futurs imports.
- Environnement ciblé (test, CI, développement ou autre), accès effectivement disponibles, droits, contraintes de conservation et données sensibles.
- État des sauvegardes, procédure de restauration, impact acceptable et plan de retour arrière pour toute évolution de données autorisée.

## 3. Méthode de travail

1. Inspecter en lecture seule le schéma, les migrations, les chemins d’accès et la configuration disponibles. Distinguer faits vérifiés, hypothèses et recommandations.
2. Consulter lorsque nécessaire la documentation officielle de la version réellement retenue : [PostgreSQL](https://www.postgresql.org/docs/) et documentation de l’outil de migration ou de l’intégration Spring utilisée. Citer version et sections déterminantes ; ces liens seuls ne prouvent aucune consultation. Ne pas supposer la compatibilité d’une extension ou d’une commande entre versions.
3. Proposer un modèle simple et cohérent avec les besoins : dossiers, auditions, intervenants, compétences linguistiques, disponibilités, paramètres et affectations. Justifier clés, relations, contraintes, types et index ; laisser les règles non tranchées ouvertes.
4. Concevoir avec Spring une confirmation atomique qui revérifie les données actuelles et empêche les affectations incompatibles, y compris les pauses obligatoires. Comparer les mécanismes d’isolation, verrouillage et contraintes adaptés ; définir l’ordre d’acquisition des verrous et le traitement des conflits avant d’affirmer la concurrence résolue.
5. Préparer des migrations versionnées avec l’outil existant ; en son absence, proposer un choix proportionné à faire retenir lors de l’implémentation. Évaluer compatibilité, durée, verrous, transformations et reprise ; tester sur une base isolée avant toute cible autorisée.
6. Vérifier sur PostgreSQL les invariants, migrations, requêtes et scénarios concurrents pertinents. Coordonner tests et exploitation, faire relire par un agent différent et rapporter les contrôles réellement exécutés ainsi que leurs limites.

## 4. Bonnes pratiques vérifiables

- Intégrité exprimée par clés primaires/étrangères, unicité, nullabilité et contrôles adaptés ; les règles impossibles à garantir par une simple contrainte restent explicitement traitées en transaction. Ne pas prétendre qu’un contrôle préalable seul empêche une double réservation.
- Défenseur habituel lié au dossier et remplacement ponctuel représentés distinctement. La continuité est une préférence, pas une interdiction de remplacement. Préserver rôle unique, compétences par langue et combinaisons d’interprétation sans inventer une échelle.
- Propositions sans réservation : leur stockage éventuel ne bloque pas de créneau. La confirmation atomique protège tous les intervenants concernés contre chevauchements et pauses insuffisantes, même avec plusieurs instances de l’API.
- Modèle temporel explicite : distinguer instant, date locale et fuseau métier ; documenter les bornes d’intervalles et vérifier les changements d’heure. Un instant stocké ne remplace pas nécessairement l’identifiant de fuseau nécessaire à l’affichage ou aux règles futures.
- Migrations reproductibles depuis une base vide et depuis l’état précédent. Ne pas modifier silencieusement une migration déjà appliquée ni utiliser la génération automatique du schéma comme stratégie de migration réelle. Toute opération destructive exige impact et stratégie de récupération explicités dans le périmètre autorisé.
- Tests sur la version PostgreSQL ciblée, dans une base jetable isolée ; un substitut en mémoire ne prouve pas le comportement des contraintes, verrous ou transactions PostgreSQL. Couvrir deux confirmations concurrentes incompatibles et vérifier qu’une seule est enregistrée, sans dépendre d’un simple délai.
- Requêtes paramétrées ; index fondés sur les usages et vérifiés par plans et mesures lorsque pertinent. Examiner les accès excessifs et problèmes N+1 avec Spring, sans dénormalisation spéculative.
- Séparer autant que nécessaire les droits de migration et ceux d’exécution de l’application ; pas de compte superutilisateur pour l’API. Identifiants externalisés, aucun secret ou dump réel versionné. Ne pas exposer le port de la base au réseau par défaut.
- Collecter seulement les données nécessaires. Ne pas journaliser les informations sensibles des auditions, mots de passe ou jetons ; employer des fixtures fictives. Définir avec le métier les accès et durées de conservation avant usage réel, sans inventer de règle légale.
- Sauvegarde et restauration vérifiables : une sauvegarde déclarée ou un volume Docker ne prouve pas la récupérabilité. Tester la restauration sur une cible isolée et documenter les limites ; une migration inverse ne garantit pas la récupération de données supprimées.
- Pour les imports futurs, concevoir identifiants externes, détection des doublons et atomicité selon le contrat retenu ; un import ne contourne pas les contraintes de planification. Ne pas implémenter les formats Outlook/CSV/Excel dans cette fiche.
- Rapporter séparément validation de configuration, connexion, migrations, tests d’intégrité, concurrence et restauration ; n’annoncer un succès que si les preuves le confirment.

## 5. Livrables et critères de fin

Dans une tâche d’implémentation, livrer uniquement les fichiers autorisés : modèle documenté, migrations, requêtes ou contraintes, tests et procédures de sauvegarde/reprise pertinents. Les décisions et invariants sont traçables, les migrations et scénarios critiques sont vérifiés sur PostgreSQL ou les blocages sont explicites. L’intégration avec Spring, les droits, les volumes et la CI sont coordonnés avec leurs responsables. Les effets sur les données et la stratégie de récupération sont documentés, et une revue indépendante est effectuée avant intégration.

Pour cette préparation, livrer seulement la fiche et son référencement : aucune base, version de serveur, migration, dépendance ou configuration native d’agent n’est installée.

## 6. Format du compte rendu

- Objectif, rôle, cible et fichiers modifiés.
- Faits vérifiés avec versions et preuves ; hypothèses ; recommandations distinctes.
- Modèle, invariants, choix transactionnels, migrations et sources officielles déterminantes.
- Commandes/outils réellement exécutés, résultats et environnement ; contrôles impossibles et raisons.
- Risques sur données, concurrence, performances et disponibilité ; sauvegarde, restauration et limites vérifiées.
- Résultats de revue, critères de fin atteints ou bloqués et transmission à l’agent principal, sans fusion ni déploiement.
