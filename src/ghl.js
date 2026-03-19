'use strict';

const GHL_BASE = 'https://rest.gohighlevel.com/v1';
const TIMEOUT_MS = 8000;

function getHeaders() {
  return {
    Authorization: `Bearer ${process.env.GHL_API_KEY}`,
    'Content-Type': 'application/json',
    Version: '2021-04-15',
  };
}

async function ghlFetch(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${GHL_BASE}${path}`, {
      ...options,
      headers: { ...getHeaders(), ...options.headers },
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`GHL ${res.status}: ${body}`);
    }
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Reply to a GHL conversation. The type must match the channel
 * (FB, IG, SMS, WhatsApp, etc.) so the message routes back correctly.
 */
async function sendMessage({ conversationId, contactId, message, type = 'FB' }) {
  return ghlFetch('/conversations/messages', {
    method: 'POST',
    body: JSON.stringify({ conversationId, contactId, message, type }),
  });
}

/**
 * Add a note to a contact's record.
 */
async function addNote(contactId, body) {
  return ghlFetch(`/contacts/${contactId}/notes/`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  });
}

/**
 * Add a tag to a contact.
 */
async function addTag(contactId, tag) {
  return ghlFetch(`/contacts/${contactId}/tags/`, {
    method: 'POST',
    body: JSON.stringify({ tags: [tag] }),
  });
}

/**
 * Get a contact by ID.
 */
async function getContact(contactId) {
  return ghlFetch(`/contacts/${contactId}`);
}

/**
 * Get the latest inbound message from a conversation.
 * Returns the message text, or null if not found.
 */
async function getLastInboundMessage(conversationId) {
  const data = await ghlFetch(`/conversations/${conversationId}/messages`);
  const messages = data?.messages ?? data?.lastMessageBody ?? [];
  if (typeof messages === 'string') return messages;
  // Find the most recent inbound message
  const inbound = [...messages]
    .reverse()
    .find((m) => m.direction === 'inbound' || m.messageType === 'TYPE_INCOMING');
  return inbound?.body ?? inbound?.message ?? null;
}

module.exports = { sendMessage, addNote, addTag, getContact, getLastInboundMessage };
