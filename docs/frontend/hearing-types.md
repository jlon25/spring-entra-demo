# Gérer les types d’audition dans Angular

## Portée et prérequis

Cette tranche ajoute le référentiel des types : consultation, création et modification du libellé, de la durée, de la pause minimale et de la règle de défenseur. Suppression explicite incluse ; pas de dossiers, auditions, disponibilités ou moteur de planification. Le [contrat HTTP](../api/hearing-types.md) et les migrations V1/V2 existants sont conservés ; V3 accorde le droit SQL de suppression ; V4 ajoute l’état actif, initialement vrai pour tous les types déjà présents. Aucune nouvelle dépendance.

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
4. Recharger le navigateur sans se reconnecter : tant que la session est valide, la liste est rechargée à la même adresse : les données doivent être retrouvées dans PostgreSQL.
5. Pour un conflit, ouvrir la même fiche dans deux onglets, avec une session valide dans chaque onglet (stockage de session séparé). Enregistrer une première modification, puis essayer d’enregistrer l’autre ancienne version. Le second enregistrement doit être refusé sans écraser la première modification.
6. Vérifier que le brouillon reste visible après ce refus. « Recharger la version serveur » remplace explicitement la saisie par la version actuelle ; réappliquer ensuite les changements souhaités et enregistrer.

Ces essais créent et modifient des données fictives persistantes. Pour retirer une donnée fictive, utiliser le bouton « Supprimer » et confirmer explicitement.

## Validation, erreurs et droits

Le libellé est normalisé par suppression des espaces de bord et limité à 120 unités UTF-16, selon le backend Java. Durée en minutes : entier 1..2147483647. Pause en minutes : entier 0..2147483647. Le champ booléen indique défenseur requis ou non requis. Aucun catalogue, durée ou pause réelle n’est inventé.

Les contrôles Angular améliorent le formulaire ; Spring reste l’autorité et valide indépendamment chaque requête. Les erreurs 400 par champ du backend sont présentées sans afficher de valeur rejetée sensible. Indisponibilité réseau, refus 403, ressource absente 404 et conflit 409 reçoivent des messages distincts. Un 401 suit le comportement de session existant et invite à se reconnecter.

Les boutons de modification utilisent les permissions de la réponse de connexion comme **indications d’affichage** : `hearing-types.read` pour consulter, `hearing-types.write` pour écrire. L’écriture n’implique pas une lecture. Le compte simulé possède actuellement les deux. Ces indications ne valident pas le JWT et ne remplacent pas les scopes vérifiés par l’API ; aucun rôle métier d’intervenant n’est assimilé à un droit d’administration.

Le formulaire capture la version lue. Le PUT envoie cette version ; un conflit ne provoque jamais une tentative automatique avec une version plus récente. L’utilisateur choisit de recharger avant de réappliquer ses modifications.

## Vérifications automatisées et limites

Les tests Angular simulent les réponses HTTP pour les états de liste, validations, droits d’affichage, erreurs et rechargement de conflit. Ils ne démontrent pas la validation JWT ni la persistance réelle.

Le job `frontend-browser` prépare une base jetable, démarre les quatre services et exécute Chromium contre l’API et PostgreSQL. Il vérifie connexion, CRUD autorisé avec pause nulle, relecture après rechargement et conflit entre deux éditions. Les tests existants de réaction UI aux 401/403 restent explicitement simulés. Aucun appel Microsoft, aucune trace contenant les identifiants ou les jetons. Les résultats effectivement observés sont rapportés dans la PR/CI.

La réussite CI ne vaut pas une validation sur la VM personnelle. Aucun changement n’est automatiquement déployé sur celle-ci. Un retour à l’ancienne interface conserve les types enregistrés et le schéma ; ne pas supprimer le volume.

## Filtrer, désactiver et réactiver

À chaque ouverture de l’écran, le filtre **État des types** affiche **Actifs** par défaut. **Inactifs** est l’autre choix ; aucune vue « Tous » n’est proposée. Le serveur filtre les lignes. Les réponses d’une ancienne demande de liste ne doivent pas remplacer une sélection plus récente.

1. Créer un type fictif : il est actif. Une création depuis la vue des inactifs revient à la vue des actifs pour montrer le nouveau type.
2. Dans **Actifs**, choisir **Désactiver** puis lire et confirmer les conséquences dans la modale. Annuler ou Échap n’écrit rien.
3. Après succès, la ligne quitte la liste des actifs. Ses données restent en base.
4. Sélectionner **Inactifs**, retrouver la ligne et, si nécessaire, modifier ses paramètres : enregistrer une modification ne la réactive pas.
5. Choisir **Activer** et confirmer. La ligne quitte les inactifs ; sélectionner **Actifs** pour la retrouver.
6. Recharger la page : le filtre repart sur **Actifs** et les états sont relus depuis PostgreSQL.

Le changement d’état nécessite `hearing-types.write`. Les comptes en lecture seule peuvent utiliser les deux filtres sans bouton de mutation. La modale capture la version affichée ; un `409` conserve l’information du refus et impose le rechargement de la liste puis une nouvelle vérification/confirmation. Aucun changement n’est renvoyé automatiquement avec une version plus récente. Les commandes sont bloquées durant la requête pour éviter les doubles envois.

### Ce que signifie une désactivation

Un type inactif est conservé et réactivable. Pour la future planification, il ne sera plus proposé pour créer de nouvelles auditions. Désactiver ne devra pas annuler, déplacer ou modifier les auditions existantes ; réactiver ne devra pas les modifier non plus. La création et la planification d’auditions ne sont pas encore implémentées : ces conséquences constituent la règle à respecter dans ces futurs écrans et API.

Désactiver ne remplace pas la suppression : cette dernière reste définitive. Avant de relier des auditions aux types, la protection des références contre la suppression devra être ajoutée. Aucun historique détaillé des changements d’état n’est introduit.

Les filtres, actions, confirmations, conséquences et erreurs sont traduits en français, allemand et italien. Sur mobile, le libellé et les actions restent visibles ; les boutons à icône gardent leur nom accessible et leur cible de 44 pixels.

## Supprimer un type

Cliquer sur « Supprimer » dans la ligne concernée. L’écran affiche son libellé et précise que la suppression est définitive. « Annuler la suppression » ne fait aucune requête DELETE ; « Confirmer la suppression » supprime uniquement la version affichée. Le bouton est réservé au droit d’écriture et ne permet pas plusieurs envois pendant la requête.

Après un 409 (modification concurrente) ou 404 (type déjà absent), aucune nouvelle suppression n’est envoyée automatiquement. Utiliser « Recharger les types », vérifier la ligne actuelle, puis redemander et confirmer la suppression si elle est toujours souhaitée. Un refus 403 conserve la confirmation et explique le manque de droits. La saisie d’un autre type reste conservée ; si le type supprimé était en cours d’édition, son formulaire est fermé.

Pour cette mise à jour, reconstruire les quatre services avec les commandes ci-dessus : Flyway applique les migrations jusqu’à V4 au démarrage de l’API sur le volume existant. Sauvegarder la base avant des essais de suppression importants. Aucun effacement de volume, reset de base ou changement de .env n’est nécessaire.

## Rafraîchissement et disposition du tableau

Une session valide est restaurée depuis le stockage de l’onglet au rechargement, sans prolonger sa date d’expiration. Les types sont relus depuis PostgreSQL ; les brouillons non enregistrés et les confirmations de suppression ne sont pas persistés. Après expiration, déconnexion ou refus401 de l’API, une nouvelle connexion reste nécessaire.

Sur écran de plus de 40 rem (640 pixels CSS avec la taille de police par défaut), le tableau affiche toutes les colonnes et les boutons avec icône et texte, afin d’associer chaque symbole à son action. À 40 rem ou moins, la liste affiche uniquement le libellé et les actions autorisées : crayon pour modifier, poubelle pour supprimer, et action d’activation ou désactivation. Ces actions restent nommées pour les lecteurs d’écran et peuvent se répartir sur plusieurs lignes. Les colonnes Durée, Pause et Défenseur sont masquées dans cette présentation mobile, sans suppression de données. Les boutons gardent des noms accessibles complets (« Modifier [libellé] », « Supprimer [libellé] »), des cibles d’au moins 44 × 44 pixels CSS et un espacement de 8 pixels ; les icônes sont décoratives pour les lecteurs d’écran.

Les valeurs restent dans le formulaire modal d’édition pour les comptes ayant le droit d’écriture. Un compte en lecture seule conserve uniquement le libellé dans la liste mobile ; agrandir la fenêtre permet de consulter les autres colonnes, sans lui accorder de droit d’édition. Aucun sélecteur de colonnes ni nouvelle permission n’est ajouté. Les contrôles clavier, la confirmation explicite de suppression et le contrôle des modifications concurrentes sont conservés.

Vérifier à 320 et 390 pixels CSS : libellés longs lisibles, deux icônes identifiables sans défilement horizontal de la liste, ouverture des modales et retour du focus après annulation. Vérifier aussi à 768 pixels et sur bureau le retour de toutes les colonnes et des textes des actions. Les tests unitaires ne démontrent pas la visibilité CSS ; les dimensions et états responsive doivent être contrôlés dans un navigateur.

## Formulaires en fenêtres modales

« Nouveau type », « Modifier » et « Supprimer » ouvrent une fenêtre modale centrée au-dessus de la liste, sans devoir atteindre le bas du tableau. Le navigateur rend l’arrière-plan inactif. Un contrôle explicite de Tab/Maj+Tab boucle entre les contrôles actifs du dialogue pour empêcher le focus de rejoindre la barre d’adresse en fin de parcours, y compris après le focus sur un message d’erreur ou pendant une requête. Le formulaire reçoit le focus sur « Libellé » ; la confirmation de suppression place le focus sur « Annuler la suppression ».

« Annuler » ou Échap ferme le dialogue sans écriture et rend le focus au bouton déclencheur ; si celui-ci a disparu ou est désactivé, le titre de la liste sert de repli. Cliquer sur le fond ne ferme pas la fenêtre. Pendant un enregistrement, un rechargement de version ou une suppression en cours, la fermeture est bloquée jusqu’à la réponse afin d’éviter un résultat ambigu.

Les erreurs et le rechargement explicite après conflit restent dans la fenêtre. Le numéro de version technique n’est plus affiché ; il est toujours transmis au backend pour empêcher l’écrasement d’une modification concurrente. Sur petit écran, la fenêtre possède une hauteur maximale et un défilement interne ; les actions restent accessibles au clavier.

Vérification manuelle : ouvrir une ligne éloignée dans une longue liste, annuler et retrouver le déclencheur ; naviguer avec Tab/Maj+Tab et Échap ; essayer le formulaire sur petit écran ; provoquer un 409 dans deux onglets et vérifier que la saisie reste visible sans renvoi automatique. Les tests unitaires simulent l’API et les méthodes de dialogue manquantes dans jsdom ; ils vérifient les limites de tabulation du composant, mais le parcours clavier complet doit aussi être vérifié en navigateur.
