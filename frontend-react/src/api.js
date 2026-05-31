const BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

function getToken() {
  return localStorage.getItem('yuno_token');
}

function authHeaders() {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function req(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...opts.headers,
    },
    ...opts,
  });

  // Token expired or invalid → clear and redirect to login
  if (res.status === 401) {
    localStorage.removeItem('yuno_token');
    window.dispatchEvent(new Event('yuno:logout'));
    throw new Error('Session expired — please log in again');
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

export const api = {
  // Auth
  auth: {
    login: (username, password) =>
      req('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
    register: (username, email, password) =>
      req('/api/auth/register', { method: 'POST', body: JSON.stringify({ username, email, password }) }),
    me: () => req('/api/auth/me'),
  },

  // Agents
  agents: {
    list: () => req('/api/agents'),
    get: (id) => req(`/api/agents/${id}`),
    create: (body) => req('/api/agents', { method: 'POST', body: JSON.stringify(body) }),
    update: (id, body) => req(`/api/agents/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    delete: (id) => req(`/api/agents/${id}`, { method: 'DELETE' }),
    chat: (id, message, session_id = 'default') =>
      req(`/api/agents/${id}/chat`, { method: 'POST', body: JSON.stringify({ message, session_id }) }),
    memory: (id, session_id = 'default') => req(`/api/agents/${id}/memory?session_id=${session_id}`),
    clearMemory: (id, session_id = 'default') =>
      req(`/api/agents/${id}/memory?session_id=${session_id}`, { method: 'DELETE' }),
  },

  tools: {
    list: () => req('/api/tools'),
  },

  workflows: {
    list: () => req('/api/workflows'),
    templates: () => req('/api/workflows/templates'),
    create: (body) => req('/api/workflows', { method: 'POST', body: JSON.stringify(body) }),
    update: (id, body) => req(`/api/workflows/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    delete: (id) => req(`/api/workflows/${id}`, { method: 'DELETE' }),
    run: (id, input) => req(`/api/workflows/${id}/run`, { method: 'POST', body: JSON.stringify({ input }) }),
    runs: (id) => req(`/api/workflows/${id}/runs`),
  },

  messages: {
    list: (params = {}) => {
      const qs = new URLSearchParams(params).toString();
      return req(`/api/messages?${qs}`);
    },
  },

  logs: {
    list: (params = {}) => {
      const qs = new URLSearchParams(params).toString();
      return req(`/api/logs?${qs}`);
    },
  },

  channels: {
    list: () => req('/api/channels'),
    create: (body) => req('/api/channels', { method: 'POST', body: JSON.stringify(body) }),
    delete: (id) => req(`/api/channels/${id}`, { method: 'DELETE' }),
    restart: (id) => req(`/api/channels/${id}/restart`, { method: 'POST' }),
  },

  provider: () => req('/api/provider'),

  validate: {
    file: async (file) => {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`${BASE}/api/validate`, {
        method: 'POST',
        body: form,
        headers: authHeaders(),
      });
      if (res.status === 401) {
        localStorage.removeItem('yuno_token');
        window.dispatchEvent(new Event('yuno:logout'));
        throw new Error('Session expired');
      }
      if (!res.ok) throw new Error((await res.json()).detail || res.statusText);
      return res.json();
    },
    text: (filename, content) => req('/api/validate/text', {
      method: 'POST', body: JSON.stringify({ filename, content })
    }),
  },

  stats: () => req('/api/stats'),
};

// WebSocket — attach token as query param
export function createWS(onMessage) {
  const wsBase = (import.meta.env.VITE_API_URL || 'http://localhost:8000').replace(/^http/, 'ws');
  const token = getToken();
  const url = token ? `${wsBase}/ws?token=${encodeURIComponent(token)}` : `${wsBase}/ws`;
  const ws = new WebSocket(url);
  ws.onmessage = (e) => {
    try { onMessage(JSON.parse(e.data)); } catch {}
  };
  ws.onerror = () => {};
  return ws;
}
