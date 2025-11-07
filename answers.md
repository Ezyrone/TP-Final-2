# Partie A – Théorie

## Question 1 – Services cloud temps réel
**a)** Deux services managés que j’utilise volontiers : Firebase Realtime Database et Ably Realtime.

**b)**  
- *Modèle de données* : Firebase propose un arbre JSON hiérarchique où chaque branche est écoutable. Ably, lui, offre des canaux pub/sub qui transportent des messages arbitraires (pas de structure imposée).  
- *Persistance* : dans Firebase, chaque nœud est stocké et retrouvable même après redémarrage. Ably garde surtout des messages éphémères, avec une option “History” mais sans vraie base longue durée.  
- *Mode d’écoute* : Firebase fournit des listeners (`onValue`, `onChildAdded`…) qui renvoient l’état et les diff. Ably pousse les événements sur un canal auquel le client est abonné ; c’est l’appli qui reconstruit l’état.  
- *Scalabilité* : Firebase scale bien mais impose des quotas par base (writes/s, connexions). Ably répartit automatiquement les canaux sur ses clusters et encaisse mieux les pics d’événements.

**c)** J’utiliserais Firebase pour une app collaborative type todo/presence où l’état doit être durable et structuré. Ably est parfait pour du streaming d’événements (trading temps réel, IoT) où l’état se reconstruit côté client.

## Question 2 – Sécurité temps réel
**a)**  
1. DDoS via milliers de sockets ouvertes : on limite les connexions par IP, on place un proxy (Nginx/Cloudflare) et on coupe les sessions inactives.  
2. Vol de token/session hijacking : TLS obligatoire, tokens signés à durée courte, renouvellement forcé.  
3. Payload malveillant (XSS/injection) : validation stricte et sanitisation côté serveur, plus des règles d’autorisation sur chaque message.

**b)** Sans gestion d’identité solide on ne sait pas qui est sur la socket, impossible donc d’appliquer des rôles ou de tracer une action. Auth + autorisation temps réel garantissent qu’un utilisateur n’écoute/publie que ce qui lui est destiné et qu’on peut révoquer sa session en cas d’abus.

## Question 3 – WebSockets vs Webhooks
**a)** WebSocket = connexion TCP persistante full-duplex entre client et serveur. Webhook = simple requête HTTP sortante déclenchée par un événement pour prévenir un autre service.

**b)**  
- WebSocket : + latence ultra faible, communication bidirectionnelle spontanée. – nécessite de garder les connexions ouvertes (coûteux) et peut être bloqué par des proxies stricts.  
- Webhook : + super facile à intégrer (un endpoint HTTP suffit) et pas besoin de maintenir un socket. – unidirectionnel et il faut que le service destinataire soit publiquement accessible.

**c)** J’opte pour un Webhook quand les événements sont ponctuels (paiement confirmé, création de ticket) et que le consommateur peut exposer un endpoint accessible. Ça évite de monopoliser des connexions persistantes pour peu d’événements.

## Question 4 – CRDT & Collaboration
**a)** Un CRDT (Conflict-free Replicated Data Type) est une structure de données pensée pour que chaque réplique converge automatiquement, même si les mises à jour arrivent dans le désordre.

**b)** Exemple concret : un éditeur de notes collaboratives hors-ligne. Chaque appareil applique ses insertions/suppressions localement et synchronise plus tard ; le CRDT (RGA/LSEQ, etc.) garantit que tout le monde obtient le même texte.

**c)** Les opérations d’un CRDT sont commutatives et idempotentes grâce à des horodatages ou vecteurs de version. Donc, peu importe l’ordre d’arrivée, la règle de fusion aboutit au même résultat sans verrou global.

## Question 5 – Monitoring temps réel
**a)** Les métriques que je surveille en priorité : la latence bout-en-bout, le nombre de connexions actives et le débit de messages (messages/s ou octets/s).

**b)** Prometheus scrape régulièrement les métriques exposées par l’app (HTTP). Grafana permet de construire les dashboards/alertes pour visualiser et déclencher des notifications si la latence grimpe ou si les connexions chutent.

**c)** Les logs sont des événements textuels, utiles pour rejouer un scénario. Les traces suivent un flot complet (span) pour comprendre un parcours distribué. Les métriques sont des valeurs numériques agrégées dans le temps, parfaites pour l’observabilité et les seuils d’alerte.

## Question 6 – Déploiement & connexions persistantes
**a)** Un socket WebSocket reste collé à l’instance qui l’a accepté. Du coup, le load balancer doit faire du sticky session ou partager l’état via un bus (Redis, DB). En masse, ces connexions consomment file descriptors et mémoire, ce qui impose d’ajouter des réplicas et de bien partager les messages.

**b)** Kubernetes aide car il apporte l’auto-scaling horizontal, les probes de santé, la gestion des ConfigMaps/Secrets et l’abstraction Service/Ingress. Quand un pod tombe, un autre prend la main et les connexions se rétablissent automatiquement.

## Question 7 – Stratégies de résilience client
**a)**  
1. Reconnexion automatique avec backoff pour éviter le spam.  
2. File d’attente locale des actions afin de rejouer ce qui a été tapé hors-ligne.  
3. Heartbeat/ping régulier pour détecter une coupure et passer l’UI en mode dégradé (lecture seule, bannière d’information).

**b)** L’exponential backoff augmente progressivement le délai entre les tentatives (1s, 2s, 4s…). Ça laisse au serveur le temps de se remettre et évite l’effet “orage de reconnexions” quand tout le monde réessaie en même temps.
