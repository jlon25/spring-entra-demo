# Instructions communes de l’équipe

## Contexte et état vérifié

Le backend prévu est une API Spring Boot consommée par un frontend séparé. L’API utilise des jetons d’accès Bearer JWT et Spring Security OAuth2 Resource Server. Un fournisseur d’identité simulé sert au développement et aux tests ; Microsoft Entra sera intégré ensuite. Aucun besoin de persistance n’est établi : ne pas ajouter de base, ORM ou couche repository sans besoin concret.

Inspection du 13 octobre 2026 : la branche distante par défaut est `master`, avec `README.md` et `docs/github-access-test.md`. Aucun code, AGENTS.md antérieur, fichier Maven/Gradle, wrapper ou version Java/Spring déclarée. Java 21.0.12.1 est installé dans l’environnement, sans constituer un choix de version pour le projet. Maven et Gradle ne sont pas présents dans le PATH. Le checkout local initial est sur `work`, sans commit ni modification ; sa référence distante est ancienne. Le connecteur GitHub permet de lire l’état distant actuel ; `git fetch origin` a échoué à joindre le proxy. Refaire cette inspection à chaque nouvelle tâche : ce constat n’est pas une convention définitive.

## Règles communes

- Lire les instructions applicables avant toute action : instructions de session, présent fichier, éventuels AGENTS.md plus proches des fichiers concernés et fiche de rôle confiée. Respecter les conventions existantes et préserver les modifications de l’utilisateur ; ne jamais les réinitialiser pour simplifier le travail.
- Inspecter branche, état Git, build, wrappers, versions déclarées et conventions de tests. Conserver Maven ou Gradle s’il existe. Si aucun build n’est établi, proposer un choix motivé dans une tâche d’implémentation, sans en introduire dans une tâche documentaire.
- Consulter lorsque nécessaire la documentation officielle correspondant aux versions effectivement déclarées. Citer les liens déterminants, la version ou section consultée et l’effet sur la décision. Si la version ou l’accès manque, le signaler ; une page « current » ne prouve pas la compatibilité d’une version donnée.
- Distinguer dans décisions et comptes rendus : faits vérifiés (avec preuve), hypothèses à confirmer, recommandations motivées.
- Appliquer simplicité, cohésion et faible couplage. Justifier chaque pattern par un besoin concret ; éviter abstractions spéculatives, interfaces systématiques et couches sans responsabilité réelle.
- Ne pas mettre à niveau les dépendances sans rapport avec la tâche. Respecter la gestion de versions Spring Boot et vérifier la compatibilité avant tout ajout justifié.
- Ne jamais versionner de secrets réels, clés privées réelles ou jetons utilisables ; ne jamais journaliser de jetons ni l’en-tête Authorization. Les fixtures cryptographiques sont éphémères ou explicitement réservées aux tests.
- Ne jamais désactiver la sécurité pour réussir un test. Les raccourcis de simulation sont réservés aux tests ciblés et leur portée doit être explicite ; ils ne démontrent pas la validation cryptographique d’un JWT.
- Rapporter uniquement les commandes et outils réellement exécutés, résultats, codes de sortie utiles et vérifications impossibles. Ne pas annoncer un build, une revue ou une délégation qui n’a pas eu lieu.
- Ne pas fusionner ni déployer. Préparer une branche et une PR dédiées, avec périmètre et preuves de validation.

## Rôles et périmètres

| Rôle | Fiche à transmettre | Périmètre habituel, à préciser pour chaque tâche |
| --- | --- | --- |
| Architecte | [architect](docs/agents/architect.md) | contrats HTTP, structure et décisions courtes |
| Développement Spring | [spring-developer](docs/agents/spring-developer.md) | code applicatif et configuration autorisés |
| Identité | [identity-specialist](docs/agents/identity-specialist.md) | sécurité JWT, simulation, préparation Entra |
| Tests | [test-engineer](docs/agents/test-engineer.md) | tests et fixtures autorisés |
| GitHub/CI | [github-ci](docs/agents/github-ci.md) | build et workflows autorisés |
| Infrastructure | [infrastructure](docs/agents/infrastructure.md) | conteneurs, Compose, exploitation Ubuntu et réseau Hyper-V |

Une fiche ne crée pas un agent et n’est pas un périmètre d’écriture implicite.

L’infrastructure prépare les images, la configuration d’exécution et les procédures VM ; GitHub/CI conserve les workflows et le build reproductible, et Identité conserve les règles JWT et la confiance envers le fournisseur. Pour une tâche commune, préciser les fichiers de chaque rôle et séquencer les changements partagés. Le rôle infrastructure n’est pas requis pour un changement Java sans effet sur l’exécution.

## Orchestration par l’agent principal

1. Inspecter le dépôt, établir les faits, objectif, critères de fin et dépendances. Vérifier les outils de délégation réellement disponibles dans la session.
2. Pour chaque sous-agent, transmettre explicitement le chemin et le contenu de la fiche pertinente (ou lui imposer sa lecture), les règles communes, entrées, résultat attendu et liste exacte des fichiers modifiables. Désigner aussi les fichiers interdits, notamment ceux appartenant à un autre agent.
3. Déléguer en parallèle uniquement des travaux indépendants. Sur un workspace partagé, attribuer des fichiers disjoints ; si deux tâches touchent le même fichier, les séquencer et transférer sa propriété après réception du premier résultat. Utiliser des worktrees séparés si nécessaire, sans écraser le travail existant.
4. Attendre les résultats nécessaires avant intégration. Vérifier les hypothèses, écarts et changements hors périmètre. L’agent principal porte la cohérence globale et l’intégration.
5. Faire relire les changements par un agent différent de leur auteur, avec périmètre et fiche de rôle explicites. Un auteur peut revoir les fichiers d’un autre agent, pas valider seul les siens. Intégrer les corrections puis refaire les vérifications touchées.
6. Préparer la PR : problème, comportement ou documentation obtenue, fichiers modifiés, vérifications réelles et limites. Aucune fusion ou livraison automatique.

Message de délégation : `Rôle et fiche ; objectif ; faits et hypothèses ; entrées ; fichiers autorisés/interdits ; dépendances ; livrables ; critères de fin ; commandes permises ; format de compte rendu`.

## Capacités de cette session et agents personnalisés

La session de préparation expose réellement `collaboration.spawn_agent`, `send_message`, `followup_task` et `wait_agent`, avec workspace partagé. Utiliser ces outils avec une fiche transmise explicitement. Leur disponibilité n’est pas garantie dans une session ultérieure : la revérifier.

Le CLI installé est `codex-cli 0.159.2` : `codex agents --help` décrit un navigateur de sessions ; `codex features list` indique `multi_agent=true` et `multi_agent_v2=false`. Ces constats ne prouvent pas le chargement de nos rôles personnalisés. Les outils de collaboration de cette session n’exposent pas de sélection d’un rôle natif nommé ni de commande de reconnaissance de configuration.

La [documentation officielle des sous-agents](https://learn.chatgpt.com/docs/agent-configuration/subagents), consultée le 13 octobre 2026, décrit des fichiers TOML sous `.codex/agents/`, avec `name`, `description` et `developer_instructions`. Proposition pour un runtime compatible, à confirmer contre sa version :

```toml
# .codex/agents/architect.toml — exemple proposé, non installé
name = "architect"
description = "Structure, contrats HTTP et décisions d’architecture courtes"
developer_instructions = """
Lire AGENTS.md et docs/agents/architect.md avant toute action.
Respecter le périmètre de fichiers confié par l’agent principal.
Ne pas fusionner ni déployer. Rapporter les preuves et limites.
"""
```

Décliner le même format pour les autres fiches seulement après vérification du chargement par le runtime cible. Aucune configuration native n’est ajoutée ou annoncée reconnue ici : la compatibilité de ce format avec le CLI installé et son chargement effectif n’ont pas été vérifiés. Les six fiches restent des fiches utilisées par délégation explicite, qui fonctionne dans cette session. Une validation syntaxique TOML seule ne prouverait ni reconnaissance ni exécution d’un agent.

Si la délégation est absente, appliquer les fiches successivement et annoncer l’exécution par un seul agent ; indiquer que la revue indépendante reste impossible, sans l’inventer.

## Format commun du compte rendu

- Objectif et périmètre réalisé ; rôle appliqué et identité de l’agent si disponible.
- Faits vérifiés et preuves ; hypothèses restantes ; recommandations distinctes.
- Fichiers modifiés et décisions motivées ; sources officielles déterminantes.
- Commandes/outils réellement exécutés et résultats ; contrôles non exécutés et raisons.
- Risques, dépendances et points de revue ; critères de fin atteints ou bloqués.
- Transmission à l’agent principal, sans fusion ni déploiement.
