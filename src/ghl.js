'use strict';

const GHL_BASE = 'https://services.leadconnectorhq.com';
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

/**
 * Get conversations that have unread inbound messages.
 * Sorted by most recent message first.
 */
async function getUnreadConversations() {
  const data = await ghlFetch(
    `/conversations/search?locationId=${process.env.GHL_LOCATION_ID}&unreadOnly=true&sort=desc&sortBy=last_message_date&limit=20`
  );
  return data?.conversations ?? [];
}

/**
 * Get messages for a conversation, most recent last.
 */
async function getConversationMessages(conversationId) {
  const data = await ghlFetch(`/conversations/${conversationId}/messages`);
  // v2 API nests messages under data.messages.messages
  return data?.messages?.messages ?? data?.messages ?? [];
}

/**
 * Get next available calendar slots (up to 5, daytime Eastern only).
 */
async function getFreeSlots(calendarId) {
  const now = Date.now();
  const threeDaysOut = now + 3 * 24 * 60 * 60 * 1000;
  const data = await ghlFetch(
    `/calendars/${calendarId}/free-slots?startDate=${now}&endDate=${threeDaysOut}&timezone=America/New_York`
  );

  const slots = [];
  for (const [, dayData] of Object.entries(data)) {
    if (!dayData?.slots) continue;
    for (const slot of dayData.slots) {
      const hour = new Date(slot).getHours();
      // Only daytime slots: 9am–6pm Eastern
      if (hour >= 9 && hour < 18) slots.push(slot);
      if (slots.length >= 5) break;
    }
    if (slots.length >= 5) break;
  }
  return slots;
}

/**
 * Book an appointment on the GHL calendar.
 */
async function bookAppointment({ calendarId, contactId, startTime, title }) {
  const start = new Date(startTime);
  const end = new Date(start.getTime() + 30 * 60 * 1000); // 30 min slot
  return ghlFetch('/calendars/events/appointments', {
    method: 'POST',
    body: JSON.stringify({
      calendarId,
      locationId: process.env.GHL_LOCATION_ID,
      contactId,
      title: title || 'IUL Consultation Call',
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      appointmentStatus: 'confirmed',
      ignoreDateRange: false,
      toNotify: true,
    }),
  });
}

module.exports = {
  sendMessage,
  addNote,
  addTag,
  getContact,
  getLastInboundMessage,
  getUnreadConversations,
  getConversationMessages,
  getFreeSlots,
  bookAppointment,
};
