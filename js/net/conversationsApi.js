const JSON_HEADERS = {
  Accept: 'application/json',
  'Content-Type': 'application/json',
};

async function request(path, options = {}) {
  const config = { ...options };
  const method = (config.method || 'GET').toUpperCase();
  const url = new URL(path, window.location.origin);

  if (method === 'GET') {
    url.searchParams.set('_ts', String(Date.now()));
    config.cache = 'no-store';
  }

  const isFormData = typeof FormData !== 'undefined' && config.body instanceof FormData;
  if (config.body && typeof config.body !== 'string' && !isFormData) {
    config.body = JSON.stringify(config.body);
  }

  if (isFormData) {
    config.headers = { Accept: 'application/json', ...(config.headers || {}) };
  } else if (config.body != null) {
    config.headers = { ...JSON_HEADERS, ...(config.headers || {}) };
  } else {
    config.headers = { Accept: 'application/json', ...(config.headers || {}) };
  }

  const res = await fetch(url.toString(), config);
  let payload = null;
  try {
    payload = await res.json();
  } catch (_) {}

  if (!res.ok) {
    const message = payload && payload.error ? payload.error : `HTTP ${res.status}`;
    throw new Error(message);
  }

  return payload;
}

export function listConversations() {
  return request('/api/conversations');
}

export function getConversation(id) {
  return request(`/api/conversations/${encodeURIComponent(id)}`);
}

export function getConversationMessages(id) {
  return request(`/api/conversations/${encodeURIComponent(id)}/messages`);
}

export function createConversation(payload) {
  return request('/api/conversations', { method: 'POST', body: payload || {} });
}

export function updateConversation(id, payload) {
  return request(`/api/conversations/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: payload || {},
  });
}

export function addConversationMessage(id, payload) {
  return request(`/api/conversations/${encodeURIComponent(id)}/messages`, {
    method: 'POST',
    body: payload || {},
  });
}

export async function uploadConversationAttachments(id, files) {
  const form = new FormData();
  for (const file of (files || [])) {
    form.append('files', file, file.name);
  }
  const payload = await request(`/api/conversations/${encodeURIComponent(id)}/attachments`, {
    method: 'POST',
    body: form,
  });
  return Array.isArray(payload?.attachments) ? payload.attachments : [];
}

export function deleteConversation(id) {
  return request(`/api/conversations/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}
