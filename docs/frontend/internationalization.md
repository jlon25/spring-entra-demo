# Interface multilingue : français, allemand et italien

## Utilisation

Le sélecteur de langue dans l’en-tête propose **Français**, **Deutsch** et **Italiano**, avant comme après connexion. Le français est la langue initiale lorsqu’aucune préférence valide n’a été enregistrée. Le choix est mémorisé dans ce navigateur sous `auditions.ui.language`, indépendamment de la session.

Le changement s’effectue sans rechargement : navigation, connexion, accueil, référentiel des types, formulaires, validations, erreurs, confirmations et noms accessibles suivent la langue choisie. Les messages déjà visibles sont traduits à nouveau. Les données saisies (notamment les libellés des types) ne sont ni traduites ni modifiées.

Une boîte modale rend l’arrière-plan inactif : fermer ou annuler le dialogue pour atteindre le sélecteur de l’en-tête. Ce comportement conserve la protection clavier des modales.

## Choix technique

L’application utilise Angular 21.2.26 et une traduction à l’exécution fondée sur ses signaux, des clés typées et trois catalogues locaux. Ce choix permet de changer de langue dans la même application sans rechargement ou déconnexion. Aucun service externe de traduction, dépendance ou build séparé par langue n’est ajouté.

La [documentation Angular 21 sur l’internationalisation](https://v21.angular.dev/guide/i18n) décrit notamment l’extraction et le déploiement par locale. Ici, le besoin de changement immédiat conduit à un service de traduction à l’exécution ; ce service n’est pas présenté comme l’outillage natif Angular Localize. Les [signaux Angular 21](https://v21.angular.dev/guide/signals) permettent de réactualiser les textes consommés par les composants. L’attribut `lang` du document suit la sélection, conformément au besoin décrit par [W3C, Language of Page](https://www.w3.org/WAI/WCAG22/Understanding/language-of-page.html). Sources consultées le 26 novembre 2026.

Les paramètres sont interpolés comme du texte, sans `innerHTML`. Les erreurs de l’API sont associées à des messages d’interface connus ; aucun détail serveur arbitraire n’est traduit ou affiché pour contourner ce mapping. Les autorisations et la validation JWT restent contrôlées par le backend.

## Ajouter ou modifier un texte

1. Définir une clé stable dans le catalogue commun ou celui des types d’audition.
2. Fournir les trois traductions avec les mêmes paramètres nommés. Écrire des phrases complètes, sans concaténation de fragments grammaticaux.
3. Pour un message conservé dans l’état, garder sa clé et ses paramètres afin qu’un changement de langue le retraduise.
4. Vérifier les intitulés visibles et accessibles, les erreurs et les messages vides ou de chargement.
5. Vérifier les textes longs sur mobile et desktop ; compléter les tests de parité et les scénarios pertinents.

La préférence ne contient que `fr`, `de` ou `it`. Une valeur invalide revient au français. Si le stockage est bloqué, le changement reste utilisable en mémoire. Le mécanisme d’authentification, la durée du JWT et le stockage de session ne changent pas.

## Essai sur la VM

Après récupération de la branche de la PR :

```sh
docker compose -f compose.yaml -f compose.postgres.yaml -f compose.frontend.yaml up --build --wait --wait-timeout 240
```

Conserver `.env` et les volumes. Ouvrir le frontend via le tunnel habituel sur le port 4200.

- Changer de langue avant connexion ; vérifier labels, erreur de mot de passe et titre de la page.
- Se connecter, changer de langue et vérifier que la session reste active.
- Consulter, créer et modifier un type fictif ; son libellé doit rester inchangé au changement de langue.
- Vérifier validations et confirmations de suppression dans les trois langues, puis annuler ou supprimer explicitement la donnée fictive.
- Recharger la page puis se déconnecter : la langue choisie doit être conservée.
- Vérifier les vues mobile et desktop, le clavier et les traductions allemandes plus longues.

## Portée et limites

Cette livraison traduit l’interface existante. Elle n’ajoute pas de traduction des données métier en base, de profil de langue utilisateur sur le serveur, ni de négociation de langue pour les réponses API destinées à d’autres clients.

Aucun format de rendez-vous, de date ou de devise n’est introduit. Les futurs écrans devront choisir explicitement la locale de formatage et le fuseau selon leur contrat ; changer la langue ne doit pas changer une date stockée.

Les tests unitaires et navigateur sont décrits avec leurs résultats dans la PR et la CI ; un fichier de test seul ne prouve pas sa réussite. Les listes simulées et les erreurs HTTP simulées sont distinguées des parcours avec le vrai fournisseur local, l’API et PostgreSQL. La vérification humaine de la terminologie métier, des lecteurs d’écran, du zoom réel et des navigateurs non couverts reste nécessaire.
