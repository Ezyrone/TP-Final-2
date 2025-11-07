# Partie A – Théorie

## Question 1 – Services cloud temps réel
**a)** Firebase Realtime Database et Ably Realtime.

**b)**  
- *Modèle de données* : Firebase, c’est un gros arbre JSON où chaque branche peut être écoutée. Ably ne stocke rien pour toi, il te donne des canaux pub/sub et tu balances les messages que tu veux.  
- *Persistance* : Firebase garde tout (c’est une vraie base). Ably joue plutôt le rôle de bus d’événements, avec un historique limité si on veut, mais pas une base longue durée.  
- *Mode d’écoute* : Firebase expose des listeners (`onValue`, `onChildAdded`…) qui renvoient l’état ou les deltas. Ably pousse juste les messages sur ton canal, à toi de reconstruire l’état.  
- *Scalabilité* : Firebase a des quotas par base, donc il faut parfois découper ses chemins. Ably répartit les canaux sur ses clusters, ça encaisse bien les pics événementiels.

**c)** Pour un petit Trello collaboratif/presence, je prends Firebase (structure + persistance). Pour un flux de signaux type trading ou IoT, Ably est plus adapté : faible latence, messages éphémères, clients qui gèrent l’état.

## Question 2 – Sécurité temps réel
**a)**  
1. DDoS via plein de sockets : limite par IP, proxy devant (Nginx/Cloudflare) et fermeture des sessions fantômes.  
2. Vol de token : tout en HTTPS, tokens signés de courte durée, régénération fréquente.  
3. Injections/payload chelou : validation/sanitisation systématique et règles d’autorisation par message.

**b)** Si on ne sait pas qui parle sur la socket, impossible d’appliquer des droits ou de tracer une action. L’auth + l’autorisation temps réel isolent les flux et permettent de couper un utilisateur s’il dérape.

## Question 3 – WebSockets vs Webhooks
**a)** WebSocket = connexion TCP full-duplex qui reste ouverte. Webhook = un POST envoyé par un service quand un événement se produit.

**b)**  
- WebSocket : ultra réactif, bi-directionnel. Mais il faut maintenir des connexions vivantes (ça coûte) et certains firewalls n’aiment pas.  
- Webhook : hyper simple (un endpoint et c’est bon) et pas de connexion ouverte. Mais c’est à sens unique et il faut un endpoint accessible publiquement.

**c)** Je privilégie le Webhook quand les événements sont occasionnels (paiement, ticket créé) et que le récepteur peut exposer une URL. Inutile de garder une connexion WebSocket pour si peu.

## Question 4 – CRDT & Collaboration
**a)** Un CRDT (Conflict-free Replicated Data Type) est une structure pensée pour que chaque copie converge vers le même état, même si les messages arrivent dans le désordre.

**b)** Exemple : application de notes collaboratives qui fonctionne hors ligne. Chaque client applique ses modifications localement, puis synchronise. Grâce au CRDT (type RGA/LSEQ), tout le monde se retrouve avec le même texte sans merge manuel.

**c)** Les opérations d’un CRDT sont commutatives/idempotentes et s’appuient sur des horodatages logiques. L’ordre n’a donc pas d’importance : la règle de fusion donne toujours le même résultat, pas besoin de verrou global.

## Question 5 – Monitoring temps réel
**a)** Les KPI que je regarde d’abord : latence end-to-end, nombre de connexions actives et débit de messages.

**b)** Prometheus scrape les métriques exposées par l’app et les garde sous forme de séries temporelles. Grafana vient se brancher dessus pour afficher des dashboards et déclencher des alertes si quelque chose déraille.

**c)** Logs = événements textuels, pratiques pour remettre l’histoire dans l’ordre. Traces = suivi d’un parcours complet (span) dans un système distribué. Métriques = valeurs numériques agrégées dans le temps, parfaites pour repérer les tendances et alerter.

## Question 6 – Déploiement & connexions persistantes
**a)** Une connexion WebSocket reste sur l’instance qui l’a acceptée. Donc soit on a du sticky session au niveau du load balancer, soit on partage l’état via un bus (Redis, DB). Et ça consomme des ressources (FD, mémoire), donc il faut scaler en conséquence.

**b)** Kubernetes aide car il gère l’auto-scaling, les probes de santé, les ConfigMaps/Secrets et les Services/Ingress. Quand un pod tombe, un autre prend le relais et les sockets peuvent se reconnecter automatiquement.

## Question 7 – Stratégies de résilience client
**a)**  
1. Reconnexion auto avec backoff pour ne pas spammer le serveur.  
2. Stockage temporaire des actions pour les rejouer quand la connexion revient.  
3. Heartbeat/ping pour détecter la déconnexion et prévenir l’utilisateur (mode dégradé).

**b)** L’exponential backoff augmente le délai (1 s, 2 s, 4 s…) entre les tentatives. Ça laisse le temps au serveur de revenir et évite que tout le monde reconnecte simultanément.
