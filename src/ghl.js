'use strict';

const GHL_BASE = 'https://rest.gohighlevel.com/v1';
const HEADERS = {
  Authorization: `Bearer ${process.env.GHL_API_KEY}`,
  'Content-Type': 'application/json',
  Version: '2021-04-15',
};

const TIMEOUT_MS = 8000;

async function ghlFetch(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${GHL_BASE}${path}`, {
      ...options,
      headers: { ...HEADERS, ...options.headers },
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
 * Find a contact by phone number (Meta often gives us the sender's phone via WhatsApp).
 * Falls back to null if not found.
 */
async function findContactByPhone(phone) {
  try {
    const data = await ghlFetch(
      `/contacts/search?locationId=${process.env.GHL_LOCATION_ID}&query=${encodeURIComponent(phone)}`
    );
    return data.contacts?.[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Find a contact by name (used when phone isn't available).
 */
async function findContactByName(name) {
  try {
    const data = await ghlFetch(
      `/contacts/search?locationId=${process.env.GHL_LOCATION_ID}&query=${encodeURIComponent(name)}`
    );
    return data.contacts?.[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Upsert a contact from a Meta message sender.
 * Creates if not found, returns contact ID either way.
 */
async function upsertContact({ name, phone, email, source = 'Meta Chatbot' }) {
  // Try to find existing contact
  let existing = null;
  if (phone) existing = await findContactByPhone(phone);
  if (!existing && name) existing = await findContactByName(name);

  if (existing) return existing.id;

  // Create new contact
  const payload = {
    locationId: process.env.GHL_LOCATION_ID,
    source,
    tags: ['meta chatbot', 'ai off'],
  };
  if (name) {
    const [firstName, ...rest] = name.split(' ');
    payload.firstName = firstName;
    if (rest.length) payload.lastName = rest.join(' ');
  }
  if (phone) payload.phone = phone;
  if (email) payload.email = email;

  const data = await ghlFetch('/contacts/', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return data.contact.id;
}

/**
 * Add a note to a contact's record (logs the chatbot conversation turn).
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

module.exports = { upsertContact, addNote, addTag, findContactByPhone };
