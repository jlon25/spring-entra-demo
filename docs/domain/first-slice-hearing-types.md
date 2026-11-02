# Première tranche : types d’audition et paramètres

## Statut et objectif

Ce cadrage prépare une première fonctionnalité complète, du stockage PostgreSQL à l’écran Angular : consulter, créer et modifier les types d’audition et la pause minimale. Il complète le [modèle métier](audition-planning.md), sans modifier les règles déjà retenues. Les choix proposés et les décisions encore ouvertes sont distingués ci-dessous ; aucun comportement décrit ici n’est encore implémenté.

La livraison se fera par petites PR, chacune avec un périmètre, des vérifications et une stratégie de reprise. La fusion d’une PR documentaire ne signifie pas que la fonctionnalité est disponible.

## Règles déjà retenues

- Chaque type d’audition détermine une durée ; les valeurs sont configurables par une zone d’administration.
- Le type porte une règle de défenseur à deux valeurs : « requis » ou « non requis » ; la continuité du défenseur reste une préférence par dossier, avec remplacement possible.
- Une pause minimale positive entre deux auditions est obligatoire pour tous les intervenants ; sa valeur est propre à chaque type d’audition.
- Les droits applicatifs sont distincts des rôles métier des intervenants.
- Les futures propositions ne réservent rien ; seul le backend peut confirmer une audition après une vérification atomique.
- PostgreSQL est la cible privilégiée pour les données durables ; Angular est retenu pour le frontend séparé.

## Périmètre fonctionnel proposé

Pour cette première tranche, proposer un référentiel simple de types avec :

| Champ | Proposition à implémenter après revue |
| --- | --- |
| Identifiant | Référence stable attribuée par le backend, indépendante du libellé |
| Libellé | Texte obligatoire après suppression des espaces de bord ; longueur maximale à fixer dans le contrat API |
| Durée | Nombre entier strictement positif exprimé en minutes ; aucune valeur métier par défaut inventée |
| Règle de défenseur | Deux valeurs explicites : « requis » ou « non requis », sans troisième valeur facultative |
| Pause minimale | Nombre entier strictement positif en minutes, propre à ce type et applicable à tous les intervenants |
| Version de modification | Permettre de détecter une mise à jour concurrente au lieu d’écraser silencieusement une modification |

La pause est administrable par type, conformément à la décision métier. Aucune valeur chiffrée de durée ou de pause ne sera ajoutée comme donnée réelle sans décision métier. Les exemples et fixtures seront explicitement fictifs.

Premiers parcours proposés : liste des types, création, édition, consultation et modification de la pause du type. La suppression, l’archivage et l’historisation détaillée restent hors de cette première tranche ; ils seront cadrés avant d’introduire des auditions qui référencent ces types. Aucune donnée de personne auditionnée n’est nécessaire ici.

## Décisions restantes et échéance

1. **Transition entre types** : la pause propre à chaque type est validée, mais la règle entre deux types différents reste à préciser. Recommandation à confirmer : appliquer la pause du type qui vient de se terminer, pour chaque intervenant (exemple fictif : fin à 10 h et pause du type précédent de 15 minutes → prochain début au plus tôt à 10 h 15). Cette règle devra être vérifiée des deux côtés d’un créneau. Elle doit être arrêtée avant le moteur de planification, mais ne bloque pas la création du référentiel des types. Le choix alternatif du maximum des deux pauses ne doit pas être introduit implicitement.
2. **Permissions** : identifier qui peut lire et qui peut modifier la configuration. Proposition technique : séparer les permissions de consultation et d’administration, les faire vérifier par Spring et adapter le compte simulé explicitement. Les noms de scopes et leur attribution restent à confirmer ; le scope actuel `api.read` ne prouve aucun droit d’administration.
3. **Contrat précis** : arrêter les limites de champs, les statuts et le format d’erreur, ainsi que la sémantique d’une modification concurrente. Les routes et DTO seront décrits dans la PR backend avant leur consommation par Angular.

Les permissions et le contrat précis sont à arrêter avant la PR de l’API métier ; la transition des pauses est à décider avant le moteur. Ces questions n’empêchent pas de préparer une PR technique PostgreSQL indépendante.

## Contrat de comportement attendu

- Le backend valide les champs, indépendamment des contrôles Angular. Une donnée invalide n’est pas enregistrée et produit une erreur exploitable par champ lorsque pertinent.
- Une requête sans jeton valide est refusée ; une identité valide sans droit d’administration ne peut pas modifier le référentiel.
- La liste vide est un état normal avant configuration ; aucun type ou durée légale ne doit être inventé pour la remplir.
- Deux utilisateurs modifiant la même version ne doivent pas provoquer un écrasement silencieux : le second enregistrement incompatible est refusé et l’écran permet de recharger les données.
- Une durée ou pause modifiée ne déplace pas silencieusement les auditions futures déjà confirmées. Avant la PR du moteur de planification, préciser la politique de capture et de revalidation des paramètres ; cette première tranche ne prétend pas résoudre ce point.

## Découpage des PR et preuves attendues

| Ordre | Périmètre borné | Vérification principale | Reprise |
| --- | --- | --- | --- |
| 1 — ce cadrage | Parcours, décisions ouvertes et découpage | Revue métier et documentaire | Revert documentaire, sans effet sur les données |
| 2 — socle PostgreSQL | Version supportée justifiée, service Compose isolé, volume et identifiants externes ; procédures de sauvegarde/restauration | Serveur prêt, données conservées après recréation du conteneur, restauration dans une base isolée ; API existante toujours fonctionnelle | Conserver le volume et le `.env`, revenir à la configuration précédente sans suppression globale |
| 3 — migrations et API des types | Choix d’accès aux données et migrations, schéma minimal, endpoints et autorisations de cette tranche | Migrations depuis une base vide et l’état précédent, validation, droits et modifications concurrentes sur PostgreSQL | Documenter la compatibilité de l’ancien code avec le schéma ; sauvegarde/stratégie corrective si une migration transforme des données |
| 4 — socle Angular et connexion | Initialisation Angular/TypeScript compatible, navigation et connexion simulée avec appel API | Build, connexion acceptée/refusée, traitement expiration et absence de fuite du Bearer vers des tiers | Revenir à la version du frontend précédente sans changer le backend |
| 5 — écran de configuration | Liste et formulaires de types/pause, erreurs et droits d’affichage | Parcours réel Angular → API → PostgreSQL, refus serveur et conflit de modification affichés | Revenir au frontend précédent ; conserver les données et contrats backend compatibles |

Le découpage pourra être affiné si une PR devient difficile à relire. Construire chaque PR sur la base fusionnée et vérifiée de la précédente ; ne pas regrouper tous les travaux dans une branche de livraison unique. Le frontend peut utiliser des contrats simulés pour développer ses composants, mais son intégration n’est validée qu’avec le vrai backend.

Le choix du serveur PostgreSQL, de l’outil de migration, des versions Angular/Node et des bibliothèques sera justifié avec les documentations officielles correspondant aux versions retenues lors de chaque PR. Aucune nouvelle version ou dépendance n’est fixée par ce cadrage.

## Scénarios d’acceptation futurs

Ces scénarios sont à implémenter et ne constituent pas des tests exécutés :

- **Création valide** : un utilisateur autorisé renseigne un libellé, une durée positive et une règle de défenseur ; le type est enregistré et reste disponible après redémarrage.
- **Validation** : une durée nulle, négative ou non entière, ou un libellé vide, est refusée sans enregistrement partiel.
- **Pause obligatoire** : une pause nulle ou négative est refusée ; deux types peuvent avoir des pauses différentes et la transition suit la règle explicitement retenue.
- **Droits** : sans authentification, l’accès protégé est refusé ; avec un droit de consultation seulement, une modification reste refusée côté backend.
- **Modification concurrente** : deux éditions partent de la même version ; après le premier enregistrement, le second ne l’écrase pas silencieusement et peut recharger les données.
- **Restauration** : une sauvegarde de test est restaurée dans une cible isolée et les données attendues sont effectivement relues.
- **Interface** : chargement, liste vide, erreurs de champs, refus d’accès et conflit sont accessibles au clavier et compréhensibles sans se fier uniquement à une couleur.

## Coordination et limites

L’architecte prépare les contrats ; Bases de données conçoit stockage et migrations avec Spring ; Identité précise les permissions ; Angular est garant du frontend ; Infrastructure prend en charge les services/volumes ; GitHub/CI et Tests apportent les preuves adaptées. Les périmètres de fichiers sont attribués par l’agent principal et chaque contribution reçoit une revue indépendante.

Le moteur de propositions, les dossiers/personnes, les compétences linguistiques, les disponibilités, les imports/exports et Entra restent des étapes ultérieures. Aucun nouveau serveur, code applicatif ou accès à la VM n’est ajouté par cette PR. Une petite PR facilite la revue et le revert du code, mais ne rend pas automatiquement réversible une transformation de données : vérifier ce point à chaque migration.
