'use strict';

const { chat } = require('../src/claude');
const {
  getUnreadConversations,
  getConversationMessages,
  sendMessage,
  addNote,
  addTag,
  getContact,
  getContactNotes,
  getFreeSlots,
  bookAppointment,
} = require('../src/ghl');

const CALENDAR_ID = '4E4MT9Vg4PZidNL6KFd4';

const CHANNEL_TYPE_MAP = {
  TYPE_FB_MSG: 'FB',
  TYPE_INSTAGRAM: 'IG',
  TYPE_SMS: 'SMS',
  TYPE_WHATSAPP: 'WhatsApp',
  TYPE_EMAIL: 'Email',
};

// Only process messages received in the last 10 minutes
const MAX_AGE_MS = 10 * 60 * 1000;

async function isAiOff(contactId) {
  try {
    const data = await getContact(contactId);
    const tags = data?.contact?.tags ?? [];
    return tags.includes('ai off');
  } catch {
    return false;
  }
}

/**
 * Format a slot ISO string into readable Eastern time.
 * e.g. "2026-03-21T14:00:00-04:00" → "Saturday Mar 21 at 2:00 PM ET"
 */
function formatSlot(isoString) {
  const d = new Date(isoString);
  return d.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }) + ' ET';
}

/**
 * Detect if the user's message is selecting one of the offered slots.
 * Returns the matching slot ISO string or null.
 */
function detectSlotSelection(messageBody, offeredSlots) {
  if (!offeredSlots || !offeredSlots.length) return null;
  const text = messageBody.toLowerCase().trim();

  // Check for slot number (1, 2, 3) or partial time match
  for (let i = 0; i < offeredSlots.length; i++) {
    const num = String(i + 1);
    if (text === num || text.startsWith(num + '.') || text.startsWith(num + ')')) {
      return offeredSlots[i];
    }
  }

  // Check for time match (e.g. "2pm", "2:00", "monday")
  for (const slot of offeredSlots) {
    const formatted = formatSlot(slot).toLowerCase();
    const d = new Date(slot);
    const hour12 = d.toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: true }).toLowerCase();
    const weekday = d.toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'long' }).toLowerCase();

    if (text.includes(hour12) || text.includes(weekday) || formatted.split(' ').some(w => text.includes(w) && w.length > 3)) {
      return slot;
    }
  }

  return null;
}

/**
 * Check contact notes for pending slot offers saved by Ava.
 */
async function extractOfferedSlotsFromNotes(contactId) {
  try {
    const data = await getContactNotes(contactId);
    const notes = data?.notes ?? [];
    // Find the most recent AVA_SLOTS note
    const sorted = [...notes].sort((a, b) => new Date(b.dateAdded || 0) - new Date(a.dateAdded || 0));
    for (const note of sorted) {
      const match = (note.body || '').match(/^AVA_SLOTS:(.*)/);
      if (match) {
        try { return JSON.parse(match[1]); } catch { return null; }
      }
    }
  } catch { /* ignore */ }
  return null;
}

module.exports = async (req, res) => {
  let processed = 0;
  const errors = [];

  try {
    const conversations = await getUnreadConversations();
    console.log(`Cron: checking ${conversations.length} unread conversations`);

    for (const conv of conversations) {
      const conversationId = conv.id;
      const contactId = conv.contactId;
      if (!conversationId || !contactId) continue;

      try {
        const messages = await getConversationMessages(conversationId);
        if (!messages.length) continue;

        const sorted = [...messages].sort(
          (a, b) => new Date(a.dateAdded || a.createdAt || 0) - new Date(b.dateAdded || b.createdAt || 0)
        );
        const lastMsg = sorted[sorted.length - 1];

        if (lastMsg.direction !== 'inbound') continue;

        const msgDate = new Date(lastMsg.dateAdded || lastMsg.createdAt || 0);
        if (Date.now() - msgDate.getTime() > MAX_AGE_MS) continue;

        const messageBody = lastMsg.body || lastMsg.message || lastMsg.text;
        if (!messageBody) continue;

        if (await isAiOff(contactId)) {
          console.log(`[${contactId}] Skipping — "ai off" tag`);
          continue;
        }

        const channelType =
          CHANNEL_TYPE_MAP[lastMsg.messageType] ??
          CHANNEL_TYPE_MAP[conv.type] ??
          'FB';

        console.log(`[${contactId}] (${channelType}): ${messageBody}`);

        // --- Check if lead is selecting a previously offered slot ---
        const offeredSlots = await extractOfferedSlotsFromNotes(contactId);
        const selectedSlot = detectSlotSelection(messageBody, offeredSlots);

        if (selectedSlot) {
          console.log(`[${contactId}] Booking slot: ${selectedSlot}`);
          try {
            await bookAppointment({
              calendarId: CALENDAR_ID,
              contactId,
              startTime: selectedSlot,
              title: 'IUL Consultation Call',
            });

            const confirmMsg = `You're booked! ✅ Your consultation call is confirmed for ${formatSlot(selectedSlot)}. A licensed field underwriter will call you at that time. Looking forward to speaking with you!`;
            await sendMessage({ conversationId, contactId, message: confirmMsg, type: channelType });

            // Auto-tag ai off so Ava stops and you take over
            await addTag(contactId, 'ai off');
            await addTag(contactId, 'appointment booked');
            addNote(contactId, `Appointment booked via Ava: ${formatSlot(selectedSlot)}`).catch(() => {});

            console.log(`[${contactId}] Booked & tagged ai off`);
            processed++;
          } catch (err) {
            console.error(`[${contactId}] Booking failed:`, err.message);
            // Fall through to normal chat if booking fails
            const reply = await chat(contactId, messageBody);
            await sendMessage({ conversationId, contactId, message: reply, type: channelType });
            processed++;
          }
          continue;
        }

        // --- Normal chat flow ---
        const reply = await chat(contactId, messageBody);
        console.log(`[${contactId}] Bot: ${reply}`);

        // --- Check if Ava's reply is offering to book (slot injection) ---
        const bookingKeywords = ['quick call', 'book', 'schedule', 'calendar', 'appointment', 'morning or afternoon', 'mornings, afternoons', 'time slot', 'get you on', 'grab you a', '15-minute', '15 minute', 'this week'];
        const isOfferingBooking = bookingKeywords.some(k => reply.toLowerCase().includes(k));

        let finalReply = reply;
        let slots = [];

        if (isOfferingBooking) {
          try {
            slots = await getFreeSlots(CALENDAR_ID);
            if (slots.length >= 2) {
              const slotList = slots.slice(0, 3).map((s, i) => `${i + 1}. ${formatSlot(s)}`).join('\n');
              const slotTag = `[SLOTS:${JSON.stringify(slots.slice(0, 3))}]`;
              // Strip any existing [SLOTS:...] from Ava's reply, then append clean version
              const cleanReply = reply.replace(/\[SLOTS:.*?\]/g, '').trimEnd();
              finalReply = `${cleanReply}\n\nHere are a few available times:\n${slotList}\n\nJust reply with 1, 2, or 3 to confirm your spot.${slotTag}`;
            }
          } catch (err) {
            console.error(`[${contactId}] Slot fetch failed:`, err.message);
          }
        }

        // Send clean message to user (no internal tags)
        // Store slots in note so we can detect selection on next message
        const visibleReply = finalReply.replace(/\[SLOTS:.*?\]/g, '').trimEnd();
        const slotMatch = finalReply.match(/\[SLOTS:(.*?)\]/);
        await sendMessage({ conversationId, contactId, message: visibleReply, type: channelType });
        if (slotMatch) {
          addNote(contactId, `AVA_SLOTS:${slotMatch[1]}`).catch(() => {});
        }

        addNote(contactId, `User: ${messageBody}\nBot: ${reply}`).catch(() => {});

        processed++;
      } catch (err) {
        console.error(`Error processing conversation ${conversationId}:`, err.message);
        errors.push(err.message);
      }
    }
  } catch (err) {
    console.error('Cron fatal error:', err.message);
    return res.status(500).json({ error: err.message });
  }

  console.log(`Cron done: ${processed} replies sent`);
  res.status(200).json({ processed, errors });
};
