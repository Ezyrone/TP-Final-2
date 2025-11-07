# Partie A – Théorie

## Question 1 – Services cloud temps réel
**a)** Firebase Realtime Database et Ably Realtime.

**b)**
- *Modèle de données* : Firebase expose un arbre JSON hiérarchique avec synchronisation par chemin, Ably fournit des canaux (pub/sub) qui transportent des messages arbitraires ; pas de schéma persistant côté Ably.
- *Persistance* : Firebase persiste automatiquement chaque nœud (données durables et consultables ensuite). Ably ne conserve que des messages transitoires, avec une rétention limitée configurée (History) mais sans stockage longue durée natif.
- *Mode d’écoute* : Firebase offre des listeners continus par chemin (`onValue`, `onChild*`) avec delta diff automatique. Ably est orienté pub/sub : les clients s’abonnent à un canal et reçoivent les messages émis, sans état global fourni par défaut.
- *Scalabilité* : Firebase scale horizontalement mais impose des limites par base (writes/s, connexions simultanées) et nécessite un partitionnement logique des chemins. Ably répartit les canaux sur un cluster global et gère l’élasticité automatiquement, ce qui facilite les pics de trafic événementiel.

**c)** Firebase convient mieux aux applications CRUD collaboratives (todo partagé, présence) nécessitant un état structuré persistant. Ably est adapté aux flux événementiels faible-latence (trading, IoT, notifications) où l’état complet est géré côté application.

## Question 2 – Sécurité temps réel
**a)**
1. Saturation DDoS via connexions persistantes : limiter le nombre de sockets par IP et activer un proxy (Nginx, Cloudflare) pour absorber les pics.
2. Usurpation d’identité (token volé) : utiliser TLS, tokens signés à courte durée et régénération périodique.
3. Injection de payload (XSS/commandes) via messages : valider/sanitariser tout contenu et appliquer des listes d’autorisation côté serveur.

**b)** La gestion des identités garantit qu’un canal temps réel reste isolé : authentification forte évite que des utilisateurs écoutent ou publient sur des canaux non prévus, tandis que l’autorisation par message permet d’appliquer des règles (limites d’actions, rôles). Sans identité fiable il est impossible d’auditer, révoquer ou tracer les changements.

## Question 3 – WebSockets vs Webhooks
**a)** WebSocket établit une connexion bidirectionnelle persistante sur TCP permettant l’échange full-duplex. Un Webhook est un appel HTTP sortant effectué par un service lorsqu’un événement se produit afin de notifier une autre application.

**b)**
- WebSocket avantages : latence très faible et bi-directionnalité native. Limites : nécessite des connexions persistantes (impact sur scaling) et traverse plus difficilement certains proxies/firewalls.
- Webhook avantages : simple à intégrer (HTTP POST) et découple l’émetteur du récepteur (pas de connexion ouverte). Limites : unidirectionnel (push seulement) et dépend de l’accessibilité réseau publique du récepteur.

**c)** Un Webhook est préférable quand les événements sont rares/modérés et que le destinataire peut exposer un endpoint accessible (ex : notifier un CRM lorsqu’un paiement est confirmé). Cela évite de maintenir des connexions persistantes inutiles.

## Question 4 – CRDT & Collaboration
**a)** Un CRDT (Conflict-free Replicated Data Type) est une structure de données distribuée dont les opérations sont conçues pour converger vers le même état final sur tous les réplicas sans coordination forte.

**b)** Exemple : éditeur de texte collaboratif hors-ligne (prise de notes). Chaque client applique des insertions/suppressions locales et synchronise via CRDT (ex : RGA ou LSEQ) pour garantir la convergence.

**c)** Les CRDT définissent des opérations commutatives/idempotentes avec un ordre partiel (par horodatage logique ou version vectorielle). Même si les mises à jour arrivent dans un ordre différent, les règles de fusion assurent la même résolution, supprimant les conflits manuels.

## Question 5 – Monitoring temps réel
**a)** Latence end-to-end, nombre de connexions actives, débit de messages (messages/s ou bytes/s).

**b)** Prometheus collecte métriques (scraping HTTP) et les stocke en time-series ; Grafana visualise ces métriques (dashboards, alertes) pour détecter anomalies (pente de latence, saturation).

**c)** Les logs détaillent des événements discrets (texte). Les traces suivent un flux distribué (span) pour analyser un parcours request/global. Les métriques sont des valeurs agrégées/numériques dans le temps, adaptées aux alertes.

## Question 6 – Déploiement & Connexions persistantes
**a)** Les connexions WebSocket collent une session à un pod/instance : le load balancer doit respecter l’affinité (sticky sessions) ou utiliser un bus partagé. Leur nombre élevé consomme des file descriptors/mémoire, limitant la scalabilité ; il faut multiplier les réplicas et partager l’état (Redis, DB) pour broadcast.

**b)** Kubernetes facilite ce contexte via l’auto-scaling horizontal, les probes de santé, la gestion des ConfigMaps/Secrets, et l’abstraction Service/Ingress pour conserver les sessions tout en redirigeant automatiquement quand des pods meurent.

## Question 7 – Stratégies de résilience client
**a)**
1. Reconnexion automatique avec backoff. 2. Mise en file locale des actions pour les rejouer quand la connexion revient. 3. Détection de heartbeat/ping pour basculer en mode dégradé (lecture seule, bannière d’état).

**b)** L’exponential backoff augmente progressivement l’intervalle entre les tentatives (ex : 1s, 2s, 4s…) jusqu’à une limite, ce qui réduit la charge sur le serveur lors des pannes et évite que tous les clients reconnectent simultanément.
