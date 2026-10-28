# Planification des auditions — premier cadrage métier

## Statut et portée

Ce document formalise le premier cadrage accepté dans les échanges de projet. Il décrit le fonctionnement cible ; il ne constitue pas une preuve d’implémentation. Il ne crée ni API métier, application Angular, base de données, intégration de calendrier ou règle juridique.

Les règles **retenues** ci-dessous proviennent des besoins exprimés. Les **recommandations** proposent une façon de les rendre vérifiables. Les **points ouverts** doivent être tranchés avant l’implémentation concernée. Un besoin d’enregistrement durable des dossiers, auditions et affectations est désormais identifié ; le choix de stockage et son introduction restent une décision d’implémentation distincte.

## Objet central et vocabulaire

L’audition est le besoin à organiser. Pour un lieu d’audition renseigné, sa planification recherche un créneau et une affectation des intervenants compatibles avec ses besoins ; ce lieu sert notamment à comparer la proximité des interprètes.

| Objet conceptuel | Responsabilité et liens |
| --- | --- |
| Personne auditionnée | Référence interne et informations strictement utiles : langue(s), genre lorsque pertinent pour le besoin exprimé, statut mineur/majeur. Peut être concernée par plusieurs dossiers. |
| Dossier | Regroupe les auditions d’une personne et porte son défenseur habituel éventuel. La continuité du défenseur est limitée à ce dossier. |
| Audition | Appartient à un dossier ; référence un type, une langue de base DE/FR/IT, un lieu, une période de recherche et des besoins explicites. La définition précise des champs de recherche reste à concevoir. |
| Type d’audition | Configuration administrable, dont la durée et la règle de recours au défenseur. Le catalogue initial et les cas exacts de présence du défenseur restent à définir. |
| Besoin particulier | Contrainte explicite d’une audition, avec sa portée : par exemple environnement de même genre ou dispositions liées à la minorité. Le détail des dispositions et les personnes auxquelles elles s’appliquent restent à préciser. |
| Intervenant | Personne affectable avec un rôle unique à ce stade : défenseur juridique externe, chargé d’audition, procès-verbaliste ou interprète. |
| Compétence d’interprétation | Langue et niveau de maîtrise par interprète, complétés par les combinaisons de traduction qu’il peut assurer vers la langue de base. Parler deux langues ne prouve pas à lui seul la compétence de traduction. |
| Disponibilité | Intervalle fourni par un intervenant ; à confronter aux auditions déjà confirmées et à la pause minimale. La collecte et le fuseau des disponibilités restent à préciser. |
| Lieu | Localisation de l’audition permettant la comparaison géographique des interprètes. Aucune réservation de salle n’est présumée. |
| Paramètres de planification | Durées par type et pause minimale obligatoire pour chaque intervenant, administrables. |
| Proposition | Créneau et affectations possibles, avec critères appliqués, avertissements et alternatives. Elle ne réserve rien. |
| Audition confirmée et affectations | Résultat de la validation finale du backend, avec un intervenant pour chaque rôle requis et les paramètres utilisés. |

Les comptes de connexion, permissions applicatives et rôles métier sont des notions distinctes : être « interprète » dans le métier ne donne pas automatiquement le droit de consulter ou modifier des dossiers.

## Règles retenues

### Contraintes à satisfaire

| Référence | Règle | Vérification attendue |
| --- | --- | --- |
| C1 | Un intervenant possède un seul rôle à ce stade. | Aucun cumul de rôles par la même personne dans le référentiel de cette version. |
| C2 | Les rôles requis dépendent de l’audition. Le chargé d’audition et le procès-verbaliste doivent être affectés ; le recours au défenseur dépend du type. | Tous les rôles requis sont pourvus par des intervenants éligibles avant confirmation. La configuration du type doit expliciter la règle de défenseur. |
| C3 | Un interprète peut être omis si la personne peut participer dans la langue de base DE, FR ou IT. | Le besoin d’interprète est déterminé explicitement ; une simple langue déclarée ne dispense pas d’une décision métier sur sa maîtrise. |
| C4 | Si un interprète est requis, sa combinaison linguistique doit couvrir la langue de la personne et la langue de base de l’audition. | Combinaison compatible et, lorsqu’un seuil est défini pour le besoin, niveaux par langue suffisants. Aucun seuil ou équivalence ne doit être inventé. |
| C5 | Les besoins particuliers applicables doivent être respectés. | Besoin explicite et portée identifiée ; si une disposition indispensable n’est pas définie, signaler l’information manquante au lieu d’annoncer une proposition conforme. |
| C6 | Chaque intervenant doit être disponible pendant l’audition, sans chevauchement avec une audition confirmée. | Contrôle des disponibilités et affectations actuelles pour chacun. |
| C7 | Une pause minimale obligatoire sépare deux auditions pour chaque intervenant. | Pour deux auditions successives d’un même intervenant, début suivant ≥ fin précédente + pause applicable ; vérifier les deux côtés du créneau proposé. |
| C8 | La durée dépend du type et les durées/pauses sont configurables dans l’administration. | Durée et pause minimale positives, selon les règles de configuration à préciser ; aucun changement administratif ne déplace silencieusement une audition planifiée. |
| C9 | Une proposition n’effectue aucune réservation provisoire. | Plusieurs propositions peuvent concerner les mêmes ressources ; leur affichage ne garantit pas leur disponibilité future. |
| C10 | La confirmation est décidée par le backend sur les données actuelles. | Vérifications et enregistrement empêchent atomiquement deux confirmations incompatibles ; le contrôle Angular seul ne suffit jamais. |

Le genre ou le statut de mineur ne déclenchent pas automatiquement des restrictions inventées. Ils alimentent l’identification de besoins à expliciter. Aucune disposition légale n’est déduite de ce cadrage.

### Préférences et départage

| Référence | Préférence | Conséquence |
| --- | --- | --- |
| P1 | Proposer en priorité le défenseur habituel du dossier lorsqu’un défenseur est requis et qu’il est éligible/disponible. | Cette continuité n’est jamais un blocage absolu. Son indisponibilité est signalée et un autre défenseur éligible peut être sélectionné. |
| P2 | Un remplacement du défenseur est ponctuel par défaut. | Il ne modifie pas le défenseur habituel du dossier. Une action explicite permet de changer aussi cette référence durable. Le premier rattachement durable doit être explicite. |
| P3 | Favoriser les interprètes les plus proches du lieu de l’audition parmi ceux qui satisfont les contraintes. | Réduire potentiellement temps d’engagement, transport et nuitées. La proximité ne permet pas d’écarter une exigence linguistique ou une pause obligatoire. |
| P4 | Utiliser le tirage aléatoire entre candidats ou combinaisons admissibles de même priorité. | Chercher une affectation complète réalisable avant le départage ; ne pas choisir isolément une personne qui rendrait les autres rôles impossibles. Le hasard ne constitue pas une garantie d’équité de charge. |

La méthode exacte de proximité, les niveaux de priorité et l’ordre de comparaison entre deux propositions ayant des créneaux différents restent à définir. Le coût réel n’est pas assimilé à une distance : tarifs, durée de trajet et nécessité de nuitée ne sont pas encore modélisés. Si un déplacement rend un créneau irréalisable, il devra devenir une contrainte explicite une fois ses règles définies.

## Recherche, proposition et confirmation

1. Renseigner le dossier, la personne concernée, le type, la langue de base, le lieu et les besoins de l’audition. Vérifier les informations manquantes avant de lancer la recherche.
2. Déterminer les rôles nécessaires et filtrer les intervenants éligibles, notamment les combinaisons linguistiques et niveaux requis lorsqu’ils sont définis.
3. Rechercher des créneaux et des combinaisons complètes respectant disponibilités, durées et pauses de tous les intervenants.
4. Appliquer les préférences de continuité du défenseur et de proximité des interprètes, puis départager aléatoirement à priorité égale selon une politique à préciser.
5. Afficher une proposition expliquée : créneau, lieu, rôles, personnes, critères retenus, éventuelle indisponibilité du défenseur habituel et alternatives. Signaler clairement « non réservé ».
6. Permettre la sélection d’une autre personne éligible et la distinction entre remplacement ponctuel du défenseur et changement durable pour le dossier. Toute modification exige une nouvelle vérification de la combinaison.
7. À la confirmation depuis Angular, le backend relit les disponibilités, affectations et besoins applicables puis valide la durée, les pauses et l’éligibilité. Vérification et écriture forment une opération empêchant les doubles réservations concurrentes.
8. Si une contrainte n’est plus satisfaite, refuser la confirmation avec une explication exploitable : ressource devenue occupée, pause insuffisante, compétence incompatible ou besoin incomplet. Permettre une nouvelle proposition ; ne pas remplacer silencieusement un intervenant pour confirmer.

**Recommandation de traçabilité** : conserver les valeurs de durée/pause et critères qui ont servi à construire la proposition et à confirmer l’audition. Conserver les affectations réellement choisies et la portée ponctuelle/durable d’un remplacement. Modifier les paramètres admin ne replanifie pas les auditions confirmées. La politique de réévaluation des propositions anciennes et des auditions confirmées après modification d’une règle reste ouverte ; tout écart doit être explicite avant confirmation.

Le mécanisme transactionnel ou de verrouillage, les codes HTTP et la représentation d’un conflit restent à concevoir avec le backend et les tests. Ce document ne fige pas une technologie de stockage ou un contrat d’API.

## Exemples d’acceptation pour l’implémentation future

Ces scénarios sont des critères à implémenter, pas des tests déjà exécutés.

- **Continuité préférée** : étant donné un dossier ayant un défenseur habituel disponible et éligible, quand une audition nécessitant ce rôle est proposée, alors ce défenseur est priorisé.
- **Remplacement possible** : étant donné ce défenseur indisponible et un autre défenseur éligible disponible, quand l’organisateur recherche une audition, alors l’indisponibilité est visible et le remplacement est possible ; confirmer ce remplacement ponctuel ne change pas le défenseur habituel.
- **Changement durable explicite** : étant donné un remplacement choisi, quand l’organisateur demande explicitement le changement du défenseur habituel, alors la nouvelle référence concerne ce dossier uniquement, sans réaffectation silencieuse de ses autres auditions.
- **Interprète non nécessaire** : étant donné que la participation dans la langue de base est explicitement possible, quand les rôles sont déterminés, alors l’absence d’interprète n’empêche pas une proposition conforme.
- **Compétence avant proximité** : étant donné un besoin de niveau minimal défini et deux interprètes proches/éloignés, quand seul le plus éloigné satisfait le niveau et la combinaison linguistique, alors le plus proche n’est pas admissible.
- **Proximité avant hasard** : étant donné deux interprètes éligibles dans des priorités géographiques différentes, quand une combinaison réalisable existe avec le plus proche, alors le hasard ne doit pas supprimer la préférence géographique. À priorité égale, plusieurs choix restent possibles.
- **Pause obligatoire** : étant donné une audition précédente finissant à 10 h et une pause de 15 minutes applicable à un intervenant, quand une autre audition est recherchée, alors 10 h 10 est refusé et 10 h 15 peut être retenu si toutes les autres contraintes sont satisfaites. Appliquer aussi le contrôle à l’audition suivante.
- **Aucune réservation à l’affichage** : étant donné une proposition affichée, quand elle n’est pas confirmée, alors elle ne bloque pas le créneau pour un autre utilisateur.
- **Confirmation concurrente** : étant donné deux propositions incompatibles partageant un intervenant, quand deux utilisateurs les confirment simultanément, alors une seule confirmation peut être enregistrée ; l’autre reçoit un conflit expliqué et peut rechercher une alternative.
- **Besoin incomplet** : étant donné une audition de mineur dont les dispositions nécessaires ne sont pas encore définies, quand une conformité complète ne peut pas être établie, alors l’application signale le besoin de complément au lieu d’inventer les dispositions.
- **Paramètres modifiés** : étant donné une proposition calculée avec une ancienne durée ou pause, quand l’administration les modifie, alors aucune audition ne se déplace automatiquement et la confirmation suit la politique explicite retenue, avec les écarts présentés à l’utilisateur.

## Parcours Angular cible

Les écrans envisagés, à détailler dans une tâche frontend, sont : dossiers/personnes et leurs auditions ; types et paramètres admin ; intervenants, langues et compétences ; saisie des disponibilités ; recherche et comparaison des propositions ; sélection/remplacement ; confirmation ou affichage d’un conflit ; planning confirmé.

Le frontend doit expliquer les refus et distinguer proposition de confirmation. Il ne calcule pas seul l’éligibilité ni la disponibilité faisant autorité. Les protections de navigation ou boutons masqués ne remplacent pas les autorisations backend. L’échelle des compétences, le calendrier visuel, les droits admin et les technologies de composants ne sont pas arrêtés ici.

## Imports et exports ultérieurs

Le besoin exprimé comprend les échanges avec Outlook, CSV et Excel, ainsi que l’export des résultats vers une application externe. Aucun connecteur, format, sens de synchronisation ou fichier de référence n’est encore défini.

**Recommandations à confirmer** : traiter ces échanges séparément du moteur ; prévisualiser les données et erreurs avant import ; identifier doublons et identifiants externes ; définir les mises à jour, annulations et fuseaux ; conserver un résultat d’import compréhensible. Un import ne doit pas confirmer une affectation en contournant les mêmes règles backend. Les formats d’export et les données nécessaires seront établis à partir d’exemples réels anonymisés.

## Questions ouvertes et limites

- Catalogue des types et règle précise du défenseur selon chaque type ; durée initiale et pause minimale.
- Échelle de compétences linguistiques, seuils requis par besoin et gestion d’une compétence non renseignée.
- Dispositions pour mineurs et portée exacte des besoins liés au genre, sans déduction juridique automatique.
- Forme des disponibilités et fuseaux horaires ; modalités de prise en compte de la personne auditionnée et du lieu.
- Calcul de proximité : zones, distances ou trajets ; frais, temps d’engagement, nuitées et éventuelles contraintes de déplacement.
- Priorités entre propositions et règles de départage ; éventuel objectif d’équité à distinguer du tirage aléatoire.
- Politique de modification des paramètres et revalidation ; modification/annulation d’une audition déjà confirmée.
- Droits de consultation, organisation, validation et administration ; statut des intervenants externes dans l’application.
- Choix de stockage, contrats HTTP et stratégie contre les confirmations concurrentes.
- Formats et rapprochement des imports/exports Outlook, CSV et Excel.

Collecter et afficher uniquement les données nécessaires à la planification. Ne pas journaliser les informations personnelles de l’audition, les motifs sensibles ou les jetons ; utiliser des exemples fictifs dans les tests et la documentation. Les permissions, durées de conservation et règles d’accès aux données doivent être définies avant utilisation réelle.

## Prochaine tranche fonctionnelle recommandée

Commencer par une tranche limitée : configurer un type et sa pause, renseigner des intervenants/disponibilités et un dossier avec une audition, produire une proposition sans réservation puis la confirmer avec contrôle backend des conflits et de la pause. Définir auparavant les valeurs minimales nécessaires parmi les questions ouvertes et le contrat HTTP correspondant.

Cette tranche peut être présentée par Angular avec une interface simple avant un calendrier avancé. Les règles de défenseur, d’interprétation et les besoins particuliers nécessaires au cas d’usage doivent rester explicites ; ne pas annoncer une planification exhaustive tant qu’ils ne sont pas vérifiables. Les imports/exports, récurrences, optimisation financière complète et intégration Entra demeurent des tâches distinctes.
