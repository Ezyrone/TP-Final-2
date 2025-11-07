const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const WebSocket = require('ws');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'app.db'));
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pseudo TEXT UNIQUE COLLATE NOCASE,
    secret_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token_hash TEXT UNIQUE NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    owner_id INTEGER NOT NULL,
    owner_pseudo TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

const insertUserStmt = db.prepare(
  'INSERT INTO users (pseudo, secret_hash, salt, created_at) VALUES (?, ?, ?, ?)'
);
const getUserStmt = db.prepare('SELECT * FROM users WHERE pseudo = ?');
const insertSessionStmt = db.prepare(
  'INSERT INTO sessions (user_id, token_hash, created_at) VALUES (?, ?, ?)'
);
const getSessionByTokenStmt = db.prepare(`
  SELECT sessions.id as session_id, sessions.user_id as user_id, users.pseudo as pseudo
  FROM sessions
  JOIN users ON users.id = sessions.user_id
  WHERE sessions.token_hash = ?
`);
const pruneSessionsStmt = db.prepare('DELETE FROM sessions WHERE created_at < ?');

const insertItemStmt = db.prepare(`
  INSERT INTO items (id, content, owner_id, owner_pseudo, created_at, updated_at, deleted)
  VALUES (?, ?, ?, ?, ?, ?, 0)
`);
const listItemsStmt = db.prepare(
  'SELECT * FROM items WHERE deleted = 0 ORDER BY datetime(created_at) ASC'
);
const getItemStmt = db.prepare('SELECT * FROM items WHERE id = ?');
const updateItemStmt = db.prepare(
  'UPDATE items SET content = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND deleted = 0'
);
const softDeleteItemStmt = db.prepare(
  'UPDATE items SET deleted = 1, updated_at = ? WHERE id = ? AND owner_id = ? AND deleted = 0'
);

const metrics = {
  totalMessagesProcessed: 0,
};

const ACTION_WINDOW_MS = 10_000;
const ACTION_LIMIT = 15;
const rateTracker = new Map(); // userId -> timestamps
const activeUsers = new Map(); // userId -> { userId, pseudo, connections }
const syncLogs = [];
const MAX_LOGS = 50;

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.post('/api/session', (req, res) => {
  const { pseudo, secret } = req.body || {};
  if (typeof pseudo !== 'string' || typeof secret !== 'string') {
    return res.status(400).json({ error: 'Pseudo et secret sont requis.' });
  }

  const cleanPseudo = pseudo.trim();
  const cleanSecret = secret.trim();

  if (cleanPseudo.length < 3 || cleanPseudo.length > 20 || !/^[a-zA-Z0-9_-]+$/.test(cleanPseudo)) {
    return res.status(400).json({
      error: 'Le pseudo doit faire 3-20 caractères alphanumériques (plus - ou _).',
    });
  }

  if (cleanSecret.length < 6 || cleanSecret.length > 50) {
    return res.status(400).json({ error: 'Le secret doit faire entre 6 et 50 caractères.' });
  }

  let user = getUserStmt.get(cleanPseudo);
  const now = new Date().toISOString();
  if (!user) {
    const salt = crypto.randomBytes(16).toString('hex');
    const secretHash = hashSecret(cleanSecret, salt);
    const insertResult = insertUserStmt.run(cleanPseudo, secretHash, salt, now);
    user = { id: insertResult.lastInsertRowid, pseudo: cleanPseudo, secret_hash: secretHash, salt };
  } else {
    const computedHash = hashSecret(cleanSecret, user.salt);
    if (computedHash !== user.secret_hash) {
      return res.status(401).json({ error: 'Pseudo ou secret invalide.' });
    }
  }

  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(token);
  insertSessionStmt.run(user.id, tokenHash, now);
  // prune sessions older than 2 days
  const cutoff = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
  pruneSessionsStmt.run(cutoff);

  return res.json({
    token,
    pseudo: user.pseudo,
    userId: user.id,
  });
});

app.get('/api/metrics', (_req, res) => {
  res.json({
    connections: getConnectionCount(),
    users: getActiveUsers(),
    metrics,
    logs: syncLogs,
  });
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
  const params = new URLSearchParams((req.url && req.url.split('?')[1]) || '');
  const token = params.get('token');

  if (!token) {
    ws.send(JSON.stringify({ type: 'error', payload: { message: 'Token manquant.' } }));
    ws.close(4001, 'Token manquant');
    return;
  }

  const session = getSessionByTokenStmt.get(hashToken(token));
  if (!session) {
    ws.send(JSON.stringify({ type: 'error', payload: { message: 'Session invalide.' } }));
    ws.close(4002, 'Session invalide');
    return;
  }

  const client = {
    userId: session.user_id,
    pseudo: session.pseudo,
    sessionId: session.session_id,
  };

  addActiveUser(client);
  sendInitialState(ws);
  broadcastPresence();
  pushLog(`Connexion de ${client.pseudo}`);

  ws.on('message', (raw) => {
    let data;
    try {
      data = JSON.parse(raw.toString());
    } catch (err) {
      ws.send(JSON.stringify({ type: 'error', payload: { message: 'Payload invalide.' } }));
      return;
    }

    if (!data || typeof data.type !== 'string') {
      ws.send(JSON.stringify({ type: 'error', payload: { message: 'Type manquant.' } }));
      return;
    }

    handleClientMessage(ws, client, data);
  });

  ws.on('close', () => {
    removeActiveUser(client);
    broadcastPresence();
    pushLog(`Déconnexion de ${client.pseudo}`);
  });
});

function handleClientMessage(ws, client, message) {
  switch (message.type) {
    case 'create_item':
      return handleCreateItem(ws, client, message.payload);
    case 'update_item':
      return handleUpdateItem(ws, client, message.payload);
    case 'delete_item':
      return handleDeleteItem(ws, client, message.payload);
    case 'ping':
      return handlePing(ws, message.payload);
    default:
      return ws.send(
        JSON.stringify({ type: 'error', payload: { message: `Type inconnu ${message.type}` } })
      );
  }
}

function handleCreateItem(ws, client, payload) {
  if (isRateLimited(client.userId)) {
    return ws.send(
      JSON.stringify({
        type: 'error',
        payload: { message: 'Trop d’actions. Patientez un instant.' },
      })
    );
  }

  const content = sanitizeContent(payload && payload.content);
  if (!content) {
    return ws.send(
      JSON.stringify({ type: 'error', payload: { message: 'Contenu requis (1-280 caractères).' } })
    );
  }

  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  insertItemStmt.run(id, content, client.userId, client.pseudo, now, now);
  const item = formatItem(getItemStmt.get(id));

  metrics.totalMessagesProcessed += 1;
  broadcast('metrics', metrics);
  broadcast('item_created', item);
  pushLog(`${client.pseudo} a ajouté un item`);
}

function handleUpdateItem(ws, client, payload) {
  if (isRateLimited(client.userId)) {
    return ws.send(
      JSON.stringify({
        type: 'error',
        payload: { message: 'Trop d’actions. Patientez un instant.' },
      })
    );
  }

  if (!payload || typeof payload.id !== 'string') {
    return ws.send(
      JSON.stringify({ type: 'error', payload: { message: 'Identifiant manquant.' } })
    );
  }

  const content = sanitizeContent(payload.content);
  if (!content) {
    return ws.send(
      JSON.stringify({ type: 'error', payload: { message: 'Contenu requis (1-280 caractères).' } })
    );
  }

  const now = new Date().toISOString();
  const result = updateItemStmt.run(content, now, payload.id, client.userId);
  if (result.changes === 0) {
    return ws.send(
      JSON.stringify({
        type: 'error',
        payload: { message: 'Item introuvable ou non autorisé.' },
      })
    );
  }

  const item = formatItem(getItemStmt.get(payload.id));
  metrics.totalMessagesProcessed += 1;
  broadcast('metrics', metrics);
  broadcast('item_updated', item);
  pushLog(`${client.pseudo} a modifié un item`);
}

function handleDeleteItem(ws, client, payload) {
  if (isRateLimited(client.userId)) {
    return ws.send(
      JSON.stringify({
        type: 'error',
        payload: { message: 'Trop d’actions. Patientez un instant.' },
      })
    );
  }

  if (!payload || typeof payload.id !== 'string') {
    return ws.send(
      JSON.stringify({ type: 'error', payload: { message: 'Identifiant manquant.' } })
    );
  }

  const now = new Date().toISOString();
  const result = softDeleteItemStmt.run(now, payload.id, client.userId);
  if (result.changes === 0) {
    return ws.send(
      JSON.stringify({
        type: 'error',
        payload: { message: 'Item introuvable ou non autorisé.' },
      })
    );
  }

  metrics.totalMessagesProcessed += 1;
  broadcast('metrics', metrics);
  broadcast('item_deleted', { id: payload.id });
  pushLog(`${client.pseudo} a supprimé un item`);
}

function handlePing(ws, payload) {
  if (!payload || typeof payload.timestamp !== 'number') {
    return;
  }
  ws.send(
    JSON.stringify({
      type: 'pong',
      payload: {
        echoTimestamp: payload.timestamp,
        serverTimestamp: Date.now(),
      },
    })
  );
}

function sendInitialState(ws) {
  const items = listItemsStmt.all().map(formatItem);
  ws.send(
    JSON.stringify({
      type: 'initial_state',
      payload: {
        items,
        connections: getConnectionCount(),
        users: getActiveUsers(),
        logs: syncLogs,
        metrics,
      },
    })
  );
}

function sanitizeContent(content) {
  if (typeof content !== 'string') {
    return '';
  }
  const trimmed = content.trim();
  if (trimmed.length === 0 || trimmed.length > 280) {
    return '';
  }
  return trimmed.replace(/[<>]/g, '');
}

function addActiveUser(client) {
  const current = activeUsers.get(client.userId) || {
    userId: client.userId,
    pseudo: client.pseudo,
    connections: 0,
  };
  current.connections += 1;
  activeUsers.set(client.userId, current);
}

function removeActiveUser(client) {
  const current = activeUsers.get(client.userId);
  if (!current) return;
  current.connections = Math.max(0, current.connections - 1);
  if (current.connections === 0) {
    activeUsers.delete(client.userId);
  } else {
    activeUsers.set(client.userId, current);
  }
}

function broadcastPresence() {
  broadcast('presence', {
    connections: getConnectionCount(),
    users: getActiveUsers(),
  });
}

function pushLog(message) {
  const entry = {
    message,
    timestamp: new Date().toISOString(),
  };
  syncLogs.push(entry);
  if (syncLogs.length > MAX_LOGS) {
    syncLogs.shift();
  }
  broadcast('sync_log', entry);
}

function broadcast(type, payload) {
  const serialized = JSON.stringify({ type, payload });
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(serialized);
    }
  });
}

function getActiveUsers() {
  return Array.from(activeUsers.values()).map((user) => ({
    userId: user.userId,
    pseudo: user.pseudo,
    connections: user.connections,
  }));
}

function getConnectionCount() {
  let count = 0;
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      count += 1;
    }
  });
  return count;
}

function hashSecret(secret, salt) {
  return crypto.pbkdf2Sync(secret, salt, 15000, 64, 'sha512').toString('hex');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function formatItem(row) {
  return {
    id: row.id,
    content: row.content,
    ownerId: row.owner_id,
    ownerPseudo: row.owner_pseudo,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function isRateLimited(userId) {
  const now = Date.now();
  const timestamps = rateTracker.get(userId) || [];
  const recent = timestamps.filter((ts) => now - ts < ACTION_WINDOW_MS);
  recent.push(now);
  rateTracker.set(userId, recent);
  return recent.length > ACTION_LIMIT;
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Serveur temps réel démarré sur http://localhost:${PORT}`);
});
