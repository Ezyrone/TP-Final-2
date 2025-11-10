# Partie A – Théorie

## Question 1 – Services cloud temps réel
**a)** Firebase Realtime Database et Ably Realtime.

**b)**  
- *Modèle de données* : Firebase expose un arbre JSON hiérarchique où chaque nœud peut être écouté. Ably fournit des canaux pub/sub qui transportent des messages arbitraires sans schéma imposé.  
- *Persistance* : Firebase persiste l’intégralité de l’état (lecture différée possible). Ably joue surtout le rôle de bus d’événements ; l’historique optionnel reste limité et n’a pas vocation à servir de base durable.  
- *Mode d’écoute* : Firebase propose des listeners (`onValue`, `onChildAdded`…) qui renvoient l’état et les deltas. Ably pousse simplement les messages aux abonnés ; la reconstruction d’état est laissée au client.  
- *Scalabilité* : Firebase impose des quotas par base (écritures/s, connexions), ce qui oblige à répartir l’arbre. Ably répartit automatiquement les canaux sur ses clusters mondiaux, ce qui absorbe mieux les pics événementiels.

**c)** Firebase convient à une application collaborative type tableau de tâches où l’état doit rester stocké et structuré. Ably correspond davantage à une diffusion de signaux temps réel (trading, IoT) où les clients gèrent l’état.

## Question 2 – Sécurité temps réel
**a)**  
1. DDoS via connexions persistantes : limiter le nombre de sockets par IP, placer un proxy (Nginx/Cloudflare) et fermer les sessions inactives.  
2. Vol de token : HTTPS obligatoire, tokens signés à durée courte, régénérations fréquentes.  
3. Injections/payload malveillant : validation et assainissement systématiques, règles d’autorisation par message.

**b)** Sans gestion d’identité fiable, impossible d’isoler les flux ou d’appliquer des droits. Authentification + autorisation temps réel garantissent que seuls les utilisateurs légitimes publient ou écoutent et qu’une session peut être révoquée à tout moment.

## Question 3 – WebSockets vs Webhooks
**a)** WebSocket : connexion TCP full-duplex maintenue ouverte. Webhook : requête HTTP sortante envoyée lorsqu’un événement se produit.

**b)**  
- WebSocket : latence très faible, échange bidirectionnel. Limites : maintien de connexions coûteux, proxy/firewall parfois réticents.  
- Webhook : intégration simple (un endpoint), aucun socket ouvert. Limites : unidirectionnel et nécessite un endpoint exposé publiquement.

**c)** Le Webhook est préférable lorsque les événements sont ponctuels (confirmation de paiement, création de ticket) et que le destinataire peut exposer un endpoint accessible. Maintenir un WebSocket pour quelques notifications serait inutilement coûteux.

## Question 4 – CRDT & Collaboration
**a)** Un CRDT (Conflict-free Replicated Data Type) est une structure conçue pour que toutes les répliques convergent, même lorsque les mises à jour arrivent dans un ordre différent.

**b)** Exemple : application de prise de notes collaborative hors ligne. Chaque client applique ses modifications localement puis synchronise ; grâce au CRDT (RGA, LSEQ…), l’état converge sans fusion manuelle.

**c)** Les opérations d’un CRDT sont commutatives et idempotentes, souvent basées sur des horodatages logiques. L’ordre n’impacte pas le résultat final : aucune coordination forte n’est nécessaire.

## Question 5 – Monitoring temps réel
**a)** Latence end-to-end, nombre de connexions actives, débit de messages (messages/s ou octets/s).

**b)** Prometheus collecte les métriques exposées par l’application et les stocke sous forme de séries temporelles. Grafana exploite ces séries pour construire des tableaux de bord et déclencher des alertes lorsqu’une métrique dépasse un seuil.

**c)** Les logs décrivent des événements discrets (texte). Les traces suivent un parcours complet (span) dans un système distribué. Les métriques sont des valeurs numériques agrégées dans le temps, adaptées à l’observation continue et aux alertes.

## Question 6 – Déploiement & connexions persistantes
**a)** Une connexion WebSocket reste attachée à l’instance qui l’a acceptée. Le load balancer doit donc maintenir l’affinité (sticky sessions) ou l’application doit partager l’état via un bus (Redis, DB). Le nombre élevé de sockets consomme des descripteurs et de la mémoire, ce qui impose de scaler horizontalement.

**b)** Kubernetes facilite ce contexte grâce à l’auto-scaling, aux probes de santé, à la gestion des ConfigMaps/Secrets et aux objets Service/Ingress. Lorsqu’un pod tombe, les connexions se reconnectent sur un autre pod sans intervention manuelle.

## Question 7 – Stratégies de résilience client
**a)**  
1. Reconnexion automatique avec backoff pour éviter les rafales.  
2. File d’actions locale afin de rejouer les opérations lorsque la connexion revient.  
3. Heartbeat/ping régulier pour détecter la perte de lien et basculer en mode dégradé (lecture seule, bannière d’alerte).

**b)** L’exponential backoff augmente progressivement l’intervalle entre les tentatives (1 s, 2 s, 4 s…). Cela laisse le temps au serveur de revenir et évite que tous les clients se reconnectent simultanément.



