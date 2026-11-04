# Frontend Angular et connexion locale

## Portée

Première tranche frontend : connexion locale, accueil protégé, appel à `GET /api/message`, expiration et déconnexion. L’écran de gestion des types d’audition sera livré ensuite. Angular est séparé du backend Maven ; aucun schéma ou contrat API existant n’est modifié.

Versions : Angular et CLI 21.2.26, TypeScript 5.9.3, RxJS 7.8.2 et Node 24.22.2 pour le build. Les dépendances directes sont explicites et le lockfile npm est versionné. Angular 21 est zoneless par défaut ; les états asynchrones utilisent des signals. Pas de Zone.js, store global ou bibliothèque graphique supplémentaire.

## Lancement sur Ubuntu avec Docker

Conserver le `.env` et les volumes existants. `FRONTEND_PORT=4200` est optionnel : c’est la valeur par défaut. Aucun identifiant n’est intégré au build frontend.

Avec PostgreSQL déjà préparé et l’API fonctionnelle, depuis le dossier du projet :

```sh
docker compose -f compose.yaml -f compose.postgres.yaml -f compose.frontend.yaml config --quiet
docker compose -f compose.yaml -f compose.postgres.yaml -f compose.frontend.yaml up --build --wait --wait-timeout 240
docker compose -f compose.yaml -f compose.postgres.yaml -f compose.frontend.yaml ps
curl --noproxy "*" --max-time 10 -i http://127.0.0.1:4200/healthz
```

Quatre services sont attendus : PostgreSQL, identité, API et frontend. `/healthz` doit répondre 200 ; ce test vérifie Nginx, pas l’authentification complète. Pour une première installation de la base, suivre d’abord le [guide PostgreSQL](postgresql.md), notamment les comptes dédiés et `bash dev/postgres_prepare.sh`. Ne pas supprimer le volume.

Le frontend peut aussi vérifier l’API/JWT sans PostgreSQL :

```sh
docker compose -f compose.yaml -f compose.frontend.yaml up --build --wait --wait-timeout 240
```

Ce mode démarre trois services ; les routes métier des types ne sont pas disponibles. Le Compose de base sans override frontend conserve ses deux services habituels.

## Accès depuis Windows

Le port frontend reste lié à la boucle locale de la VM. Fermer l’ancien tunnel avec Ctrl+C avant de le remplacer : cette commande conserve 8080/9000 et ajoute 4200.

Dans PowerShell sur l’hôte Hyper-V :

```powershell
& {
    $VmName = 'Ubuntu-26.04'
    $VmUser = 'jerome'
    $VmIps = @(
        Get-VMNetworkAdapter -VMName $VmName -ErrorAction Stop |
            Select-Object -ExpandProperty IPAddresses |
            Where-Object { $_ -match '^192\.168\.1\.\d{1,3}$' } |
            Sort-Object -Unique
    )
    if ($VmIps.Count -ne 1) {
        throw "Impossible de choisir une IP unique : vérifier KVP et le filtre réseau."
    }
    ssh -N -o ExitOnForwardFailure=yes `
        -L 127.0.0.1:8080:127.0.0.1:8080 `
        -L 127.0.0.1:9000:127.0.0.1:9000 `
        -L 127.0.0.1:4200:127.0.0.1:4200 `
        "$VmUser@$($VmIps[0])"
}
```

Adapter nom Hyper-V, compte et filtre au réseau actuel. En cas d’IP vide, suivre le [diagnostic KVP et le repli manuel](docker-hyperv.md#récupérer-automatiquement-lip-hyper-v-et-ouvrir-le-tunnel). Si les ports hôtes du `.env` changent, adapter les ports de destination des tunnels. Vérifier la clé hôte, saisir le mot de passe **SSH** et garder cette fenêtre ouverte.

Ouvrir **http://127.0.0.1:4200** dans le navigateur Windows :

1. Saisir le compte du **simulateur** (`local-user` par défaut) et `DEV_IDENTITY_PASSWORD`, distincts de SSH et PostgreSQL.
2. Un mauvais mot de passe affiche un refus et efface le champ du mot de passe.
3. Avec les bons identifiants, l’accueil s’affiche. Cliquer sur « Vérifier l’accès à l’API » : `authenticated` doit apparaître.
4. Se déconnecter : retour au formulaire. Recharger après connexion déconnecte également, car le jeton reste en mémoire.
5. Après cinq minutes, la session locale expire et invite à se reconnecter.

Ce parcours évite la manipulation d’identifiants dans PowerShell. Ne pas enregistrer de traces réseau ou exporter de HAR contenant mot de passe ou Bearer.

## Architecture et sécurité

| Chemin du navigateur | Acheminement |
| --- | --- |
| `/identity/token` | Proxy fixe vers `identity:9000/token`, sans Authorization ni cookie transmis par Nginx |
| `/api/…` | Proxy fixe vers `api:8080/api/…`, avec Bearer |
| `/login`, `/accueil` | Navigation de la SPA |

Les appels utilisent la même origine : aucun CORS global ni modification de la validation JWT Spring. Le proxy d’identité n’expose pas ses autres routes. Nginx fonctionne sans root, sans capacités supplémentaires, avec système de fichiers en lecture seule et répertoire temporaire en mémoire.

Le jeton est conservé uniquement en mémoire, sans localStorage, sessionStorage ou cookie. L’interceptor n’ajoute le Bearer qu’à la même origine et au préfixe `/api/`, jamais aux tiers ou à l’identité. Les chemins ambigus sont exclus. Les guards facilitent la navigation ; le backend reste l’autorité d’autorisation.

Le client utilise `expires_in` pour la durée de session, sans prétendre valider cryptographiquement le JWT. Un `401` API efface la session ; un `403` conserve la session et explique le manque de droits. Pas de refresh automatique, pas de mot de passe conservé dans un service, aucun jeton affiché ou journalisé.

Ce simulateur est réservé au développement. HTTPS et la connexion Entra devront être définis avant une exposition hors du laboratoire.

## Développement natif

Avec Node 24.22.2 et l’API/simulateur lancés selon le README, depuis la racine du dépôt :

```sh
cd frontend
npm ci
npm start
```

Ouvrir http://127.0.0.1:4200 sur cette machine. Le proxy CLI utilise les ports natifs 8080/9000 de cette même machine ; adapter `proxy.conf.cjs` si nécessaire. Il n’est pas utilisé par Nginx. Ne pas lancer le serveur natif et le conteneur sur le même port.

Dans le dossier `frontend`, les vérifications sont :

```sh
npm run build
npm test
```

## Tests et limites

`frontend-verify` exécute `npm ci`, le build strict et les tests Angular/Vitest/jsdom. HttpTestingController simule les réponses pour vérifier formulaire, session, expiration, guards et limites du Bearer ; cela ne prouve pas la validation cryptographique.

`frontend-browser` construit API, identité et frontend puis utilise Chromium/Playwright contre la vraie connexion locale et le vrai décodeur Spring. Les réponses 401/403 des tests de réaction UI sont explicitement simulées ; les connexions réussies utilisent le vrai émetteur. L’expiration par minuterie est couverte dans Angular. Traces, vidéos et captures sont désactivées afin de ne pas enregistrer les identifiants. La configuration définit aussi `PLAYWRIGHT_NO_COPY_PROMPT=1` pour empêcher la capture DOM automatique `error-context.md` de Playwright 1.58.2.

Les résultats réellement exécutés figurent dans la PR/CI. Une réussite en CI ne vaut pas un test sur le navigateur Windows personnel. L’intégration graphique des types et l’attribution de droits Entra restent des étapes futures.

## Reprise

Arrêter le seul service frontend si nécessaire, puis retirer `compose.frontend.yaml` des commandes pour revenir au socle précédent. Conserver base, comptes, volumes et sauvegardes. Aucun changement de schéma.

## Sources officielles consultées

- [Compatibilité Angular 21](https://github.com/angular/angular/blob/21.2.x/adev/src/content/reference/versions.md) et [release 21.2.26](https://github.com/angular/angular/releases/tag/v21.2.26).
- [Zoneless](https://github.com/angular/angular/blob/21.2.x/adev/src/content/guide/zoneless.md), [interceptors](https://github.com/angular/angular/blob/21.2.x/adev/src/content/guide/http/interceptors.md), [guards](https://github.com/angular/angular/blob/21.2.x/adev/src/content/guide/routing/route-guards.md) et [formulaires typés](https://github.com/angular/angular/blob/21.2.x/adev/src/content/guide/forms/typed-forms.md).
- [Builder de tests CLI 21.2.26](https://github.com/angular/angular-cli/blob/v21.2.26/packages/angular/build/src/builders/unit-test/schema.json), Vitest/jsdom.
- [Node 24.22.2](https://github.com/nodejs/node/releases/tag/v24.22.2) et [image Nginx sans root](https://github.com/nginx/docker-nginx-unprivileged).
