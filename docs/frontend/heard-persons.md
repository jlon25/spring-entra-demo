# Personnes auditionnées : fiche minimale

## Données et parcours

Le menu **Personnes** apparaît avec le droit `heard-persons.read`. La page permet la consultation, et les comptes ayant `heard-persons.write` disposent de la création et de la modification.

La fiche contient une **référence opaque**, un **statut de minorité** et des identifiants techniques. Aucun nom, prénom ou date de naissance n’est demandé ou conservé. Ne pas placer d’information nominative dans la référence. Celle-ci ne change pas lorsque la langue de l’interface change.

Le statut propose **Mineur**, **Majeur**, **Non renseigné**. La création commence à **Non renseigné**, jamais à Majeur. Le statut n’entraîne pas automatiquement de dispositions juridiques ou de choix d’intervenants.

1. Ouvrir **Personnes**, puis **Nouvelle personne**.
2. Saisir une référence fictive unique et choisir un statut.
3. Enregistrer ; vérifier la liste et recharger la page.
4. Modifier le statut ou la référence, puis enregistrer.
5. Une référence déjà utilisée produit une erreur explicite sans effacer la saisie.
6. En cas de modification concurrente, le brouillon reste conservé. Recharger explicitement les données avant de reprendre l’édition ; aucun écrasement silencieux.

Les formulaires sont présentés en modales, avec gestion du focus, du clavier, d’Échap et des envois en cours. L’interface et ses messages sont disponibles en français, allemand et italien. Les boutons associent icône et texte sur grand écran ; les actions compactes gardent des noms accessibles et des dimensions adaptées au mobile.

Aucune suppression, désactivation ou import n’est proposé dans cette tranche. Les dossiers seront une étape distincte.

## Mise à jour sur la VM

Sauvegarder la base, récupérer la branche de la PR, conserver `.env` et les volumes, puis :

```sh
docker compose -f compose.yaml -f compose.postgres.yaml -f compose.frontend.yaml up --build --wait --wait-timeout 240
```

L’API doit démarrer avec PostgreSQL ; Flyway applique V5. Le simulateur est reconstruit pour émettre les nouveaux droits. Après redémarrage du simulateur, l’API doit utiliser sa nouvelle clé : si nécessaire, recréer explicitement l’API pour vider le cache JWKS :

```sh
docker compose -f compose.yaml -f compose.postgres.yaml -f compose.frontend.yaml up -d --force-recreate --wait --wait-timeout 240 api
```

Se déconnecter puis se reconnecter pour obtenir un nouveau jeton contenant les droits des personnes. Une session précédente ne reçoit pas de nouveaux scopes automatiquement. Le compte de développement ne devient pas une personne auditionnée : comptes de connexion et fiches métier sont séparés.

## Essais et limites

Utiliser uniquement des références fictives pour les essais. Vérifier refus des données invalides, doublons, statuts, rechargement, conflit entre deux onglets, traductions et affichage mobile. Un compte en lecture seule doit être refusé côté API s’il tente une écriture.

Le [contrat API](../api/heard-persons.md) décrit les champs, droits, migrations et conflits. Les résultats réellement exécutés sont rapportés dans la PR/CI, avec distinction entre tests Angular simulant HTTP et parcours avec les vrais services.

Le statut sera calculé par un futur import à partir de sa date source, sans stockage de cette date. En attendant, il est renseigné explicitement et ne se recalcule pas au fil du temps. **Non renseigné** ne signifie pas **Majeur**. Date de référence du calcul, règles de mise à jour et rapprochement restent à définir avant l’import.
