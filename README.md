# Mini application temps réel

Projet réalisé par Jory Grzeszczak – M2 AL v-ESGI Grenoble

## Comment lancer l’appli ?

Je suis parti sur un duo Node.js/Go, donc il faut avoir Node 18+ (pour `fetch` natif côté serveur) et Go 1.21+.

```bash
npm install
npm run monitor   # service Go de monitoring (à garder dans un terminal dédié)
npm start         # serveur Express/WebSocket + front
```

Ensuite, rendez‑vous sur `http://localhost:3000` avec deux onglets pour voir la synchro, et gardez en tête que le service Go répond sur `http://localhost:4001` (les métriques/logs viennent de là).

## Ce qu’il y a sous le capot

- **Serveur HTTP/WebSocket** (`src/server.js`) : Express sert les fichiers statiques et l’API `/api/session`, `ws` gère les sockets (création/édition/suppression, présence, ping/pong).
- **Stockage local** : SQLite (`data/app.db`, géré via `better-sqlite3`) mémorise utilisateurs, sessions et items. Tout est validé côté serveur avant insertion.
- **Canal temps réel** : un seul endpoint WebSocket `/ws` sécurisé par token de session. Chaque message est vérifié avant d’être broadcasté.
- **Service de monitoring** : petit service Go (`monitor/main.go`) qui reçoit les événements (présence, logs, compteur d’actions) et expose tout en HTTP pour le front ou un `curl`.
- **Client web** (`public/`) : front vanilla JS, stockage local du token, file d’attente hors-ligne, reconnexion automatique avec backoff, affichage des métriques/latences.

## Pourquoi ces technos ?

- **Express + ws** : pile légère, facile à faire tourner hors ligne pour un TP sans dépendre d’un PaaS.
- **better-sqlite3** : API synchrone, pas besoin d’un ORM lourd et on garde des performances correctes pour quelques dizaines d’items.
- **PBKDF2 (lib `crypto`)** : permet de hasher les secrets sans embarquer de lib externe, ce qui reste cohérent pour une authentification “simple mais sérieuse”.
- **Vanilla JS** : suffit largement pour ce prototype et m’oblige à manipuler directement le WebSocket/DOM, ce qui est pédagogique.
- **Go pour le monitoring** : je voulais séparer l’observabilité du serveur Node et manipuler un peu la stack Go (handlers, mutex, slices). 

## Fonctionnalités livrées

| Besoin du sujet | Ce qui est implémenté |
| --- | --- |
| Persistance locale | SQLite (`items`, `users`, `sessions`) dans `data/app.db` |
| Canal temps réel | WebSocket `ws` + diffusion `item_created/updated/deleted` |
| Authentification | Pseudo + secret hashé PBKDF2 (+ token stocké hashé) |
| Sécurité | 1) Validation/assainissement serveur, 2) contrôle propriétaire, 3) rate limiting 15 actions / 10 s / user |
| Reconnexion client | Backoff exponentiel + file d’actions en mémoire |
| Monitoring | Service Go : connexions, utilisateurs actifs, compteur d’actions, logs synchronisés |

## Sécurité (version courte)

1. **Identité** : pseudo unique (NOCASE) + secret hashé (PBKDF2 + salt) + token SHA‑256. Toute socket sans token valide est coupée.
2. **Validation** : `sanitizeContent` impose 1‑280 caractères et retire les caractères spéciaux basiques. Rien n’est écrit tel quel depuis le client.
3. **Autorisations** : un item n’est éditable/supprimable que par son auteur, et chaque utilisateur est bridé par le rate limit pour éviter les abus/DDoS applicatifs.

## Gestion des erreurs

- API (auth) → JSON `{ error }` réutilisé côté formulaire.
- WebSocket → messages `error` logués côté client + ajoutés au flux de logs Go.
- Scripts côté client → reconnexion automatique et bannière d’état dès que le socket ferme, pour rester transparent vis‑à‑vis de l’utilisateur.

## Limites actuelles / pistes d’amélioration

1. Les sessions expirent via une purge à 48h, pas de refresh/rotation plus fine.
2. L’édition reste mono-auteur : un CRDT (bonus) permettrait de jouer sur de la coédition.
3. Monitoring purement local : pas d’export Prometheus/Grafana, pas d’alerting.
4. UI craftée à la main : une stack type Vite + composants aiderait pour des écrans plus élaborés/tests unitaires.

## Livrables

- `answers.md` → réponses à la partie théorique.
- `public/` → interface utilisateur.
- `src/server.js` + `monitor/main.go` → back-end Node + service Go.

L’ensemble tourne hors ligne, ce qui respecte la consigne “pas de cloud / pas de backend distant”.
