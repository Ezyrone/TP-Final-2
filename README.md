# Mini application temps réel 

GRZESZCZAK Jory - M2 AL v-ESGI Grenoble

## Lancer le projet

Prérequis : Node.js ≥ 18 (inclut `fetch` natif côté serveur) et Go ≥ 1.21.

```bash
npm install
npm run monitor   # lance le service Go de monitoring (dans un autre terminal)
npm start         # démarre le serveur WebSocket/Express
```

Le serveur HTTP écoute sur `http://localhost:3000` et sert l’interface `public/`. Le service Go de monitoring écoute sur `http://localhost:4001` et expose les métriques/logs consommés par le frontend. Ouvrez plusieurs onglets pour voir la synchronisation des items en direct.

## Architecture logique

- **Serveur HTTP/WebSocket** : `src/server.js` (Express + `ws`) sert les fichiers statiques, expose l’API d’authentification `/api/session`, et gère les actions temps réel (création/édition/suppression d’items, présence).
- **Persistance locale** : SQLite (`data/app.db` via `better-sqlite3`) stocke les utilisateurs, sessions et items. Le serveur applique toutes les validations avant d’écrire.
- **Canal temps réel** : WebSocket unique (`/ws`) authentifié via token stocké en base. Chaque message est validé et diffusé aux clients concernés.
- **Monitoring Go** : `monitor/main.go` conserve les métriques (connexions, compteur d’actions, logs) et les expose via HTTP. Le serveur Node y pousse chaque événement de présence ou de synchro.
- **Client Web** : `public/` contient une application front vanilla JS qui gère l’authentification locale (pseudo + secret), se reconnecte automatiquement, maintient une file d’actions hors-ligne et consomme à la fois le flux WS et l’API Go pour l’observabilité.

## Choix technologiques

- **Express + ws** : configuration minimale pour exposer HTTP et WebSocket dans un même processus, sans dépendre d’un service externe (contrainte “local only”).
- **better-sqlite3** : binding synchrone simple qui garantit la persistance locale demandée avec très peu de configuration et de code asynchrone.
- **PBKDF2 (crypto)** : permet de hasher le secret utilisateur sans dépendance additionnelle, conformément à l’exigence d’une authentification simple mais non triviale.
- **Vanilla JS + Web APIs** : léger, suffisant pour prototyper rapidement la synchro et maîtriser précisément les mécanismes de reconnexion/monitoring.

## Fonctionnalités clés

| Exigence | Implémentation |
| --- | --- |
| Persistance locale | SQLite (`items`, `users`, `sessions`) stocké dans `data/app.db`. |
| Canal temps réel | WebSocket (`ws` module) avec diffusion des mutations (`item_created/updated/deleted`). |
| Identités de session | Pseudo + secret → hash PBKDF2. Chaque connexion WS porte un token unique vérifié côté serveur. |
| Sécurité (3 règles) | (1) Validation/assainissement serveur du contenu (longueur, caractères), (2) contrôle d’accès propriétaire (seul l’auteur peut modifier/supprimer), (3) rate limiting basique (15 actions/10 s/utilisateur) pour limiter abus/DDoS applicatif. |
| Reconnexion automatique | Client conserve les actions en file, applique un exponential backoff et relance la connexion jusqu’à succès. |
| Monitoring minimal | Service Go dédié exposant connexions, utilisateurs actifs, compteur d’actions traitées et logs synchronisés, consommés par l’UI et par `/api/metrics`. |

## Plan de sécurité

1. **Authentification stricte** : pseudo unique (collation NOCASE), secret hashé (PBKDF2 + salt) et token de session stocké hashé (SHA‑256). Les sockets non authentifiées sont rejetées immédiatement.
2. **Validation serveur** : toutes les mutations passent par `sanitizeContent`, longueur max 280, et sont refusées côté serveur si le schéma n’est pas respecté.
3. **Contrôle par utilisateur** : seules les personnes ayant créé un item peuvent l’éditer ou le supprimer (`owner_id` vérifié en SQL). Les actions sont limitées dans une fenêtre slide (anti-abus).

## Gestion des erreurs

- **API REST** : réponses JSON structurées (`{ error: message }`) pour l’authentification. Le client affiche l’erreur sous le formulaire.
- **WebSocket** : messages `error` renvoyés au client, également ajoutés aux logs locaux pour traçabilité. En cas de fermeture, un backoff exponentiel relance la connexion.
- **Serveur** : chaque action valide est loggée en mémoire (`syncLogs`) et renvoyée aux clients pour fournir un historique de synchronisation.

## Limites et améliorations

1. Les sessions n’expirent qu’après purge (48h). On pourrait ajouter une politique TTL plus fine ou un refresh token.
2. L’édition collaborative est lockée par propriétaire. Implémenter un CRDT (bonus suggéré) permettrait des items co-édités par plusieurs utilisateurs.
3. Le monitoring reste local. Brancher Prometheus (+ exporter HTTP) et ajouter des alertes Grafana offrirait une véritable observabilité.
4. La UI reste volontairement simple (vanilla). Une couche de composants (React/Vite) offrirait une meilleure ergonomie et des tests unitaires.

## Dossier de livrables

- `answers.md` : réponses à la partie théorie.
- `public/` : interface utilisateur (HTML/CSS/JS).
- `src/server.js` + `data/app.db` : serveur Node.js, WebSocket, SQLite.

Tout fonctionne hors-ligne, conformément aux contraintes.
