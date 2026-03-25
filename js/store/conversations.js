import { qs } from '../core/dom.js';
import { renderMsg, clearChat } from '../chat/render.js';
import {
  addConversationMessage,
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
  updateConversation,
} from '../net/conversationsApi.js';

const K_CUR = 'mpai.current.v1';
let cache = [];
let activeMenu = null;
let menuEventsBound = false;

function sortCache() {
  cache.sort((a, b) => (b.updatedAt - a.updatedAt) || (b.createdAt - a.createdAt));
}

function normalizeAttachment(raw) {
  if (!raw) return null;
  return {
    id: raw.id ?? null,
    conversationId: raw.conversationId ?? raw.conversation_id ?? null,
    messageId: raw.messageId ?? raw.message_id ?? null,
    filename: String(raw.filename ?? 'fichier'),
    mimeType: String(raw.mimeType ?? raw.mime_type ?? 'application/octet-stream'),
    sizeBytes: Number(raw.sizeBytes ?? raw.size_bytes ?? 0),
    url: raw.url ?? null,
    previewUrl: raw.previewUrl ?? raw.preview_url ?? raw.url ?? null,
    isImage: Boolean(raw.isImage ?? raw.is_image ?? String(raw.mimeType ?? raw.mime_type ?? '').startsWith('image/')),
    status: String(raw.status ?? 'stored'),
  };
}

function normalizeMessage(raw) {
  if (!raw) return null;
  return {
    id: raw.id ?? null,
    conversationId: raw.conversationId ?? raw.conversation_id ?? null,
    role: (raw.role || '').toLowerCase(),
    content: String(raw.content ?? raw.text ?? ''),
    reasoningText: raw.reasoningText == null && raw.reasoning_text == null
      ? null
      : String(raw.reasoningText ?? raw.reasoning_text ?? ''),
    model: raw.model == null ? null : String(raw.model),
    reasoningDurationMs: Number(raw.reasoningDurationMs ?? raw.reasoning_duration_ms ?? 0) || null,
    createdAt: Number(raw.createdAt ?? raw.created_at ?? Date.now()),
    position: Number(raw.position ?? 0),
    attachments: Array.isArray(raw.attachments) ? raw.attachments.map(normalizeAttachment).filter(Boolean) : [],
  };
}

function normalizeConversation(raw) {
  const messages = Array.isArray(raw?.messages)
    ? raw.messages.map(normalizeMessage).filter(Boolean)
    : [];

  return {
    id: raw?.id ?? null,
    title: String(raw?.title ?? 'Nouvelle conversation'),
    createdAt: Number(raw?.createdAt ?? raw?.created_at ?? Date.now()),
    updatedAt: Number(raw?.updatedAt ?? raw?.updated_at ?? Date.now()),
    archived: Number(raw?.archived ?? 0),
    messageCount: Number(raw?.messageCount ?? raw?.message_count ?? messages.length ?? 0),
    messages,
    messagesLoaded: Array.isArray(raw?.messages) || Boolean(raw?.messagesLoaded),
  };
}

function upsertConversation(raw) {
  const normalized = normalizeConversation(raw);
  if (!normalized.id) return null;

  const idx = cache.findIndex((item) => item.id === normalized.id);
  if (idx >= 0) {
    const existing = cache[idx];
    const merged = {
      ...existing,
      ...normalized,
      messages: normalized.messagesLoaded ? normalized.messages : (existing.messages || []),
      messagesLoaded: normalized.messagesLoaded || existing.messagesLoaded,
    };
    merged.messageCount = Math.max(
      Number(merged.messageCount || 0),
      Array.isArray(merged.messages) ? merged.messages.length : 0,
    );
    cache[idx] = merged;
    sortCache();
    return merged;
  }

  normalized.messageCount = Math.max(
    Number(normalized.messageCount || 0),
    Array.isArray(normalized.messages) ? normalized.messages.length : 0,
  );
  cache.push(normalized);
  sortCache();
  return normalized;
}

function replaceCacheFromList(list) {
  const byId = new Map(cache.map((item) => [item.id, item]));
  cache = (list || []).map((item) => {
    const normalized = normalizeConversation(item);
    const existing = byId.get(normalized.id);
    if (existing?.messagesLoaded) {
      normalized.messages = existing.messages;
      normalized.messagesLoaded = true;
      normalized.messageCount = Math.max(normalized.messageCount, existing.messages.length);
    }
    return normalized;
  });
  sortCache();
  return cache;
}

function closeActiveMenu() {
  if (!activeMenu) return;
  activeMenu.row.classList.remove('menu-open');
  activeMenu.button.setAttribute('aria-expanded', 'false');
  activeMenu.menu.classList.remove('open');
  activeMenu = null;
}

function openMenu(row, button, menu) {
  if (
    activeMenu
    && activeMenu.row === row
    && activeMenu.button === button
    && activeMenu.menu === menu
  ) {
    closeActiveMenu();
    return;
  }

  closeActiveMenu();
  row.classList.add('menu-open');
  button.setAttribute('aria-expanded', 'true');
  menu.classList.add('open');
  activeMenu = { row, button, menu };
}

function ensureMenuEvents() {
  if (menuEventsBound) return;
  menuEventsBound = true;

  document.addEventListener('click', (event) => {
    if (!activeMenu) return;
    const target = event.target;
    if (!target) return;
    if (activeMenu.row.contains(target)) return;
    closeActiveMenu();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeActiveMenu();
  });
}

async function openConversation(id) {
  if (!id) return;
  Store.setCurrent(id);
  const fullConversation = await Store.fetch(id);
  clearChat();
  for (const message of (fullConversation?.messages || [])) {
    renderMsg(message.role, message.content, {
      attachments: message.attachments || [],
      reasoningText: message.reasoningText,
      model: message.model,
      reasoningDurationMs: message.reasoningDurationMs,
    });
  }
}

export const Store = {
  load() {
    return cache.slice();
  },

  currentId() {
    try {
      return localStorage.getItem(K_CUR);
    } catch (_) {
      return null;
    }
  },

  setCurrent(id) {
    try {
      localStorage.setItem(K_CUR, id);
    } catch (_) {}
  },

  clearCurrent() {
    try {
      localStorage.removeItem(K_CUR);
    } catch (_) {}
  },

  async refresh() {
    const list = await listConversations();
    replaceCacheFromList(list);
    return this.load();
  },

  get(id) {
    return cache.find((item) => item.id === id) || null;
  },

  async fetch(id) {
    if (!id) return null;
    const payload = await getConversation(id);
    return upsertConversation({
      ...payload.conversation,
      messages: payload.messages,
      message_count: Array.isArray(payload.messages) ? payload.messages.length : 0,
    });
  },

  async ensureLoaded(id) {
    if (!id) return null;
    const existing = this.get(id);
    if (existing?.messagesLoaded) return existing;
    return this.fetch(id);
  },

  async create(input) {
    const payload = typeof input === 'string' ? { title: input } : (input || {});
    const created = normalizeConversation(await createConversation(payload));
    created.messages = [];
    created.messagesLoaded = true;
    upsertConversation(created);
    this.setCurrent(created.id);
    return created;
  },

  async addMsg(id, role, content, options = {}) {
    const message = normalizeMessage(await addConversationMessage(id, {
      role,
      content,
      attachment_ids: options.attachmentIds || [],
      reasoning_text: options.reasoningText || null,
      model: options.model || null,
      reasoning_duration_ms: options.reasoningDurationMs || null,
    }));
    let conversation = this.get(id);
    if (!conversation) {
      conversation = await this.fetch(id);
    }
    if (!conversation) return null;

    if (!Array.isArray(conversation.messages)) conversation.messages = [];
    if (!conversation.messages.find((item) => item.id === message.id)) {
      conversation.messages.push(message);
    }
    conversation.messagesLoaded = true;
    conversation.updatedAt = message.createdAt;
    conversation.messageCount = Math.max(Number(conversation.messageCount || 0), conversation.messages.length);
    upsertConversation(conversation);
    return message;
  },

  async renameIfDefault(id, title) {
    let conversation = this.get(id);
    if (!conversation) {
      conversation = await this.fetch(id);
    }
    if (!conversation) return null;

    if (!conversation.title || /^Nouvelle conversation/i.test(conversation.title)) {
      const updated = normalizeConversation(await updateConversation(id, { title }));
      updated.messages = conversation.messages || [];
      updated.messagesLoaded = conversation.messagesLoaded;
      return upsertConversation(updated);
    }
    return conversation;
  },

  async update(id, payload) {
    const conversation = this.get(id);
    const updated = normalizeConversation(await updateConversation(id, payload));
    updated.messages = conversation?.messages || [];
    updated.messagesLoaded = conversation?.messagesLoaded || false;
    return upsertConversation(updated);
  },

  async remove(id) {
    await deleteConversation(id);
    cache = cache.filter((item) => item.id !== id);
    if (this.currentId() === id) this.clearCurrent();
  },
};

function groupLabel(ts) {
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startYesterday = startToday - 86400000;
  if (ts >= startToday) return "Aujourd'hui";
  if (ts >= startYesterday) return 'Hier';
  return 'Jours precedents';
}

export function fmtTitle(s) {
  s = (s || '').replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, 64) : 'Nouvelle conversation';
}

export async function mountHistory() {
  const cont = qs('#history');
  if (!cont) return;
  ensureMenuEvents();

  const render = async () => {
    try {
      await Store.refresh();
    } catch (err) {
      console.warn('[mountHistory] refresh failed', err);
    }

    closeActiveMenu();
    cont.innerHTML = '';
    const convs = Store.load()
      .filter((c) => !c.archived && Math.max(Number(c.messageCount || 0), (c.messages || []).length) > 0)
      .sort((a, b) => b.updatedAt - a.updatedAt);

    const groups = { "Aujourd'hui": [], Hier: [], 'Jours precedents': [] };
    for (const conversation of convs) {
      groups[groupLabel(conversation.updatedAt)].push(conversation);
    }

    for (const label of ["Aujourd'hui", 'Hier', 'Jours precedents']) {
      const arr = groups[label];
      if (arr.length === 0) continue;

      const head = document.createElement('div');
      head.className = 'side-title';
      head.textContent = label;
      cont.appendChild(head);

      for (const conversation of arr) {
        const titleLabel = conversation.title || 'Nouvelle conversation';
        const row = document.createElement('div');
        row.className = 'conv-row';

        const link = document.createElement('a');
        link.className = 'conv conv-link';
        link.href = '#';
        link.dataset.id = conversation.id;
        link.title = titleLabel;
        if (Store.currentId() === conversation.id) link.classList.add('selected');

        const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        icon.setAttribute('class', 'ico');
        icon.setAttribute('viewBox', '0 0 24 24');
        icon.setAttribute('fill', 'none');
        icon.innerHTML = '<path d="M5 12h14M5 6h14M5 18h8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>';

        const title = document.createElement('span');
        title.className = 'conv-title';
        title.textContent = titleLabel;

        link.append(icon, title);
        link.addEventListener('click', async (event) => {
          event.preventDefault();
          try {
            closeActiveMenu();
            await openConversation(conversation.id);
            await render();
          } catch (err) {
            console.warn('[history] open conversation failed', err);
          }
        });

        const actions = document.createElement('button');
        actions.type = 'button';
        actions.className = 'conv-actions-btn';
        actions.setAttribute('aria-label', `Actions pour ${titleLabel}`);
        actions.setAttribute('aria-haspopup', 'menu');
        actions.setAttribute('aria-expanded', 'false');
        actions.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="6" cy="12" r="1.7"></circle><circle cx="12" cy="12" r="1.7"></circle><circle cx="18" cy="12" r="1.7"></circle></svg>';
        actions.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          openMenu(row, actions, menu);
        });

        const menu = document.createElement('div');
        menu.className = 'conv-menu';
        menu.setAttribute('role', 'menu');

        const renameBtn = document.createElement('button');
        renameBtn.type = 'button';
        renameBtn.className = 'conv-menu-btn';
        renameBtn.setAttribute('role', 'menuitem');
        renameBtn.textContent = 'Modifier';
        renameBtn.addEventListener('click', async (event) => {
          event.preventDefault();
          event.stopPropagation();
          closeActiveMenu();

          const nextTitle = window.prompt('Modifier le nom de la conversation', titleLabel);
          if (nextTitle == null) return;

          const formatted = fmtTitle(nextTitle);
          if (!formatted) return;

          try {
            await Store.update(conversation.id, { title: formatted });
            await render();
          } catch (err) {
            console.warn('[history] rename conversation failed', err);
          }
        });

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'conv-menu-btn danger';
        deleteBtn.setAttribute('role', 'menuitem');
        deleteBtn.textContent = 'Supprimer';
        deleteBtn.addEventListener('click', async (event) => {
          event.preventDefault();
          event.stopPropagation();
          closeActiveMenu();

          const ok = window.confirm(`Supprimer la conversation "${titleLabel}" ?`);
          if (!ok) return;

          const wasCurrent = Store.currentId() === conversation.id;
          try {
            await Store.remove(conversation.id);
            if (wasCurrent) clearChat();
            await render();
          } catch (err) {
            console.warn('[history] delete conversation failed', err);
          }
        });

        menu.append(renameBtn, deleteBtn);
        row.append(link, actions, menu);
        cont.appendChild(row);
      }
    }

    if (convs.length === 0) {
      const head = document.createElement('div');
      head.className = 'side-title';
      head.textContent = "Aujourd'hui";
      cont.appendChild(head);

      const empty = document.createElement('div');
      empty.style.color = 'var(--muted)';
      empty.style.padding = '6px 12px';
      empty.style.fontSize = '.9rem';
      empty.textContent = 'Aucune conversation';
      cont.appendChild(empty);
    }
  };

  await render();
}
