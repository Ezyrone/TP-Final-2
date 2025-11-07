const authPanel = document.querySelector('#auth-panel');
const appPanel = document.querySelector('#app-panel');
const loginForm = document.querySelector('#login-form');
const loginError = document.querySelector('#login-error');
const userLabel = document.querySelector('#user-label');
const connectionStatus = document.querySelector('#connection-status');
const logoutBtn = document.querySelector('#logout-btn');
const itemForm = document.querySelector('#item-form');
const itemInput = document.querySelector('#item-input');
const itemsList = document.querySelector('#items-list');
const itemTemplate = document.querySelector('#item-template');
const itemCount = document.querySelector('#item-count');
const usersList = document.querySelector('#users-list');
const logsList = document.querySelector('#logs-list');
const connectionsCount = document.querySelector('#connections-count');
const usersCount = document.querySelector('#users-count');
const latencyValue = document.querySelector('#latency-value');
const metricsCount = document.querySelector('#metrics-count');
const MONITORING_URL = `${window.location.protocol}//${window.location.hostname}:4001`;

const SESSION_KEY = 'tp-realtime-session';
const MAX_LOGS = 40;
const MAX_BACKOFF = 15_000;

const state = {
  session: loadSession(),
  items: new Map(),
  users: [],
  logs: [],
  connections: 0,
  latency: null,
  metrics: { totalMessagesProcessed: 0 },
};

let socket;
let reconnectDelay = 1000;
let reconnectTimer;
let pingTimer;
const pendingMessages = [];

init();

function init() {
  loginForm.addEventListener('submit', handleLogin);
  logoutBtn.addEventListener('click', handleLogout);
  itemForm.addEventListener('submit', handleCreateItem);
  itemsList.addEventListener('click', handleListActions);

  if (state.session) {
    togglePanels(true);
    connectSocket(true);
  } else {
    togglePanels(false);
  }
}

async function handleLogin(event) {
  event.preventDefault();
  setLoginError('');
  const formData = new FormData(loginForm);
  const payload = {
    pseudo: formData.get('pseudo')?.trim(),
    secret: formData.get('secret')?.trim(),
  };

  try {
    const response = await fetch('/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Connexion impossible.');
    }
    state.session = data;
    saveSession(data);
    togglePanels(true);
    connectSocket(true);
    loginForm.reset();
  } catch (err) {
    setLoginError(err.message);
  }
}

function handleLogout() {
  clearSession();
  state.session = null;
  state.items.clear();
  state.users = [];
  state.logs = [];
  stopPing();
  if (socket) {
    socket.close(1000, 'logout');
    socket = null;
  }
  togglePanels(false);
  updateMonitoring();
  renderItems();
  renderUsers();
  renderLogs();
}

function handleCreateItem(event) {
  event.preventDefault();
  const content = itemInput.value.trim();
  if (!content || content.length > 280) {
    return;
  }
  sendMessage('create_item', { content });
  itemInput.value = '';
}

function handleListActions(event) {
  const listItem = event.target.closest('.item');
  if (!listItem) return;
  const itemId = listItem.dataset.id;
  if (!itemId) return;

  if (event.target.closest('.edit-btn')) {
    const current = state.items.get(itemId);
    if (!current) return;
    const nextValue = prompt('Modifier le contenu', current.content);
    if (nextValue && nextValue.trim().length > 0 && nextValue.trim().length <= 280) {
      sendMessage('update_item', { id: itemId, content: nextValue.trim() });
    }
  }

  if (event.target.closest('.delete-btn')) {
    if (confirm('Supprimer cet item ?')) {
      sendMessage('delete_item', { id: itemId });
    }
  }
}

function connectSocket(initial = false) {
  if (!state.session) return;
  clearTimeout(reconnectTimer);
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const wsUrl = `${protocol}://${window.location.host}/ws?token=${state.session.token}`;

  socket = new WebSocket(wsUrl);

  socket.addEventListener('open', () => {
    setConnectionStatus(true);
    reconnectDelay = 1000;
    flushPendingMessages();
    startPing();
    if (!initial) {
      fetchInitialSnapshot();
    }
  });

  socket.addEventListener('message', (event) => {
    try {
      const data = JSON.parse(event.data);
      handleSocketMessage(data);
    } catch (err) {
      console.error('Message invalide', err);
    }
  });

  socket.addEventListener('close', (event) => {
    setConnectionStatus(false, event.reason);
    stopPing();
    scheduleReconnect();
  });

  socket.addEventListener('error', () => {
    socket.close();
  });
}

async function fetchInitialSnapshot() {
  const data = await requestMonitoringSnapshot();
  if (!data) {
    return;
  }
  state.connections = data.connections ?? state.connections;
  state.users = data.users || [];
  state.logs = data.logs || [];
  state.metrics = data.metrics || state.metrics;
  updateMonitoring();
  renderUsers();
  renderLogs();
}

async function requestMonitoringSnapshot() {
  try {
    const res = await fetch(`${MONITORING_URL}/metrics`);
    if (!res.ok) {
      throw new Error(`status ${res.status}`);
    }
    return await res.json();
  } catch (err) {
    console.warn('Service de monitoring Go indisponible, fallback Node.', err);
    try {
      const fallback = await fetch('/api/metrics');
      if (!fallback.ok) {
        throw new Error(`status ${fallback.status}`);
      }
      return await fallback.json();
    } catch (fallbackErr) {
      console.error('Impossible de récupérer les métriques', fallbackErr);
      return null;
    }
  }
}

function scheduleReconnect() {
  if (!state.session) return;
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => connectSocket(), reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 1.5, MAX_BACKOFF);
}

function startPing() {
  stopPing();
  pingTimer = setInterval(() => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      const timestamp = Date.now();
      sendMessage('ping', { timestamp });
    }
  }, 5000);
}

function stopPing() {
  clearInterval(pingTimer);
}

function sendMessage(type, payload) {
  if (!state.session) return;
  const message = JSON.stringify({ type, payload });
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(message);
  } else {
    pendingMessages.push(message);
  }
}

function flushPendingMessages() {
  while (pendingMessages.length && socket && socket.readyState === WebSocket.OPEN) {
    socket.send(pendingMessages.shift());
  }
}

function handleSocketMessage(message) {
  switch (message.type) {
    case 'initial_state':
      applyInitialState(message.payload);
      break;
    case 'item_created':
    case 'item_updated':
      updateItem(message.payload);
      break;
    case 'item_deleted':
      removeItem(message.payload.id);
      break;
    case 'presence':
      state.connections = message.payload.connections;
      state.users = message.payload.users || [];
      updateMonitoring();
      renderUsers();
      break;
    case 'metrics':
      state.metrics = message.payload || state.metrics;
      updateMonitoring();
      break;
    case 'sync_log':
      pushLog(message.payload);
      break;
    case 'pong':
      if (message.payload?.echoTimestamp) {
        state.latency = Date.now() - message.payload.echoTimestamp;
        updateMonitoring();
      }
      break;
    case 'error':
      if (message.payload?.message) {
        notify(message.payload.message);
      }
      break;
    default:
      console.warn('Type non géré', message);
  }
}

function applyInitialState(payload = {}) {
  const items = Array.isArray(payload.items) ? payload.items : [];
  state.items = new Map(items.map((item) => [item.id, item]));
  state.users = payload.users || [];
  state.logs = payload.logs || [];
  state.connections = payload.connections ?? state.connections;
  state.metrics = payload.metrics || state.metrics;
  updateMonitoring();
  renderItems();
  renderUsers();
  renderLogs();
}

function updateItem(item) {
  if (!item?.id) return;
  state.items.set(item.id, item);
  renderItems();
}

function removeItem(id) {
  if (!id) return;
  state.items.delete(id);
  renderItems();
}

function pushLog(entry) {
  if (!entry) return;
  state.logs.push(entry);
  if (state.logs.length > MAX_LOGS) {
    state.logs.shift();
  }
  renderLogs();
}

function renderItems() {
  const fragment = document.createDocumentFragment();
  const sorted = Array.from(state.items.values()).sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt)
  );
  sorted.forEach((item) => {
    const clone = itemTemplate.content.firstElementChild.cloneNode(true);
    clone.dataset.id = item.id;
    clone.querySelector('.item-text').textContent = item.content;
    clone.querySelector('.item-meta').textContent = `par ${item.ownerPseudo} · ${
      formatDate(item.updatedAt || item.createdAt)
    }`;

    const actions = clone.querySelector('.item-actions');
    const isOwner = state.session?.userId === item.ownerId;
    actions.classList.toggle('hidden', !isOwner);

    fragment.appendChild(clone);
  });

  itemsList.innerHTML = '';
  itemsList.appendChild(fragment);
  itemCount.textContent = `${sorted.length} élément${sorted.length > 1 ? 's' : ''}`;
}

function renderUsers() {
  const fragment = document.createDocumentFragment();
  (state.users || []).forEach((user) => {
    const li = document.createElement('li');
    li.textContent = `${user.pseudo} (${user.connections})`;
    if (state.session?.userId === user.userId) {
      li.style.color = '#38bdf8';
    }
    fragment.appendChild(li);
  });
  usersList.innerHTML = '';
  usersList.appendChild(fragment);
  usersCount.textContent = state.users.length;
}

function renderLogs() {
  const fragment = document.createDocumentFragment();
  state.logs.slice(-MAX_LOGS).forEach((log) => {
    const li = document.createElement('li');
    li.textContent = `[${formatTime(log.timestamp)}] ${log.message}`;
    fragment.appendChild(li);
  });
  logsList.innerHTML = '';
  logsList.appendChild(fragment);
}

function updateMonitoring() {
  connectionsCount.textContent = state.connections;
  usersCount.textContent = state.users.length;
  latencyValue.textContent = state.latency ? `${state.latency} ms` : 'n/d';
  metricsCount.textContent = state.metrics.totalMessagesProcessed ?? 0;
}

function togglePanels(isAuthenticated) {
  if (isAuthenticated) {
    authPanel.classList.add('hidden');
    appPanel.classList.remove('hidden');
    userLabel.textContent = state.session?.pseudo ?? '';
    setConnectionStatus(false, 'initialisation');
  } else {
    authPanel.classList.remove('hidden');
    appPanel.classList.add('hidden');
    userLabel.textContent = '';
    setConnectionStatus(false);
  }
}

function setConnectionStatus(isOnline, detail = '') {
  connectionStatus.textContent = isOnline ? 'en ligne' : 'hors ligne';
  if (detail) {
    connectionStatus.textContent += ` · ${detail}`;
  }
  connectionStatus.classList.toggle('online', isOnline);
  connectionStatus.classList.toggle('offline', !isOnline);
}

function notify(message) {
  pushLog({ message: `⚠ ${message}`, timestamp: new Date().toISOString() });
}

function formatDate(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  return date.toLocaleString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: 'short',
  });
}

function formatTime(isoString) {
  if (!isoString) return '';
  return new Date(isoString).toLocaleTimeString();
}

function setLoginError(message) {
  if (!message) {
    loginError.textContent = '';
    loginError.classList.add('hidden');
    return;
  }
  loginError.textContent = message;
  loginError.classList.remove('hidden');
}

function saveSession(session) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    return null;
  }
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}
