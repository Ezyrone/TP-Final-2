# Mini application temps réel

Projet réalisé par Jory Grzeszczak – M2 AL -ESGI Grenoble.

## Lancement

Prérequis : Node.js ≥ 18 et Go ≥ 1.21.

```bash
npm install
npm run monitor   # terminal 1 : service Go de monitoring
npm start         # terminal 2 : serveur Express/WebSocket + client web
```

L’interface est accessible sur `http://localhost:3000`. Le service Go expose ses métriques sur `http://localhost:4001`, ce qui permet d’inspecter l’état via un navigateur ou un simple `curl`.

## Architecture

- **Serveur HTTP/WebSocket** (`src/server.js`) : Express diffuse les ressources statiques et l’API `/api/session`, tandis que `ws` assure le canal temps réel (`/ws`) pour la création, l’édition, la suppression d’items et la présence.
- **Persistance locale** : SQLite (`data/app.db` via `better-sqlite3`) conserve utilisateurs, sessions et items. Toutes les écritures sont validées côté serveur avant insertion.
- **Canal temps réel** : une connexion WebSocket unique sécurisée par token. Chaque mutation validée est diffusée à l’ensemble des clients.
- **Monitoring** : un service Go autonome (`monitor/main.go`) centralise connexions, utilisateurs actifs, compteur d’actions et logs, puis expose ces données via HTTP.
- **Client web** (`public/`) : application vanilla JS qui gère l’authentification locale, la reconnexion avec backoff exponentiel, la file d’actions hors-ligne et l’affichage des métriques.

## Choix techniques

- **Express + ws** : pile maîtrisée, légère et adaptée à une exécution hors ligne 
- **better-sqlite3** : accès synchrone à SQLite
- **PBKDF2 (module `crypto`)** : hashing 
- **Vanilla JS** : permet de manipuler directement l’API WebSocket et de garder un front léger
- **Go** : monitoring

## Fonctionnalités livrées

| Exigence du sujet | Implémentation |
| --- | --- |
| Persistance locale | SQLite (`users`, `sessions`, `items`) stocké dans `data/app.db` |
| Canal temps réel | WebSocket `/ws` avec diffusion `item_created`, `item_updated`, `item_deleted` |
| Authentification | Pseudo + secret hashé PBKDF2, token stocké hashé (SHA‑256) |
| Sécurité (3 règles) | Validation serveur, contrôle propriétaire, rate limiting (15 actions / 10 s / utilisateur) |
| Reconnexion automatique | File d’actions locale + backoff exponentiel |
| Monitoring minimal | Service Go exposant connexions, utilisateurs actifs, compteur d’actions, logs |

## Sécurité

1. **Authentification** : pseudos uniques (collation NOCASE), secrets hashés (PBKDF2 + salt) et tokens protégés (SHA‑256). Toute connexion WebSocket sans token valide est rejetée.
2. **Validation/Sanitisation** : `sanitizeContent` impose une longueur comprise entre 1 et 280 caractères et filtre les caractères sensibles avant stockage.
3. **Autorisations** : seul le propriétaire d’un item peut le modifier ou le supprimer

## Gestion des erreurs

- L’API d’authentification renvoie systématiquement un JSON `{ error }`, exploité par l’interface pour afficher le message correspondant.
- Les erreurs WebSocket déclenchent un log, une mise à jour de l’état visuel (“hors ligne”) et une tentative de reconnexion contrôlée par backoff.
- Chaque action validée est également envoyée au service Go afin d’alimenter l’historique partagé.

## Limites et pistes d’évolution

1. Les sessions expirent via une purge périodique (~48 h). Un mécanisme de refresh token améliorerait la rotation.
2. L’édition reste mono-auteur. Implémenter un CRDT permettrait de gérer la co-édition 
3. Le monitoring est local. Un export Prometheus/Grafana apporterait des alertes et une observation plus poussée.
4. L’UI en vanilla répond au besoin, mais une base Vite + librairie de composants faciliterait les évolutions et les tests.

## Livrables

- `answers.md` – réponses à la partie théorique.
- Dossier `public/` – interface utilisateur.
- Dossiers `src/` et `monitor/` – serveur Node.js + service Go.

L’ensemble fonctionne hors ligne, conformément aux exigences 
