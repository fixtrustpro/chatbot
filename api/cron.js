'use strict';

const { chat } = require('../src/claude');
const {
  getUnreadConversations,
  getConversationMessages,
  sendMessage,
  addNote,
  getContact,
} = require('../src/ghl');

const CHANNEL_TYPE_MAP = {
  TYPE_FB_MSG: 'FB',
  TYPE_INSTAGRAM: 'IG',
  TYPE_SMS: 'SMS',
  TYPE_WHATSAPP: 'WhatsApp',
  TYPE_EMAIL: 'Email',
};

// Only process messages received in the last 10 minutes to avoid replying to old messages
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

module.exports = async (req, res) => {
  // Vercel automatically sends CRON_SECRET as a Bearer token for cron requests
  const cronSecret = (process.env.CRON_SECRET || '').trim();
  if (cronSecret && req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).end();
  }

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
        // Get messages and find the last inbound one
        const messages = await getConversationMessages(conversationId);
        if (!messages.length) continue;

        // Messages may be sorted oldest-first or newest-first — handle both
        const sorted = [...messages].sort(
          (a, b) => new Date(a.dateAdded || a.createdAt || 0) - new Date(b.dateAdded || b.createdAt || 0)
        );
        const lastMsg = sorted[sorted.length - 1];

        // Skip if the last message was sent by us (outbound)
        if (lastMsg.direction !== 'inbound') continue;

        // Skip if the message is older than MAX_AGE_MS
        const msgDate = new Date(lastMsg.dateAdded || lastMsg.createdAt || 0);
        if (Date.now() - msgDate.getTime() > MAX_AGE_MS) continue;

        const messageBody = lastMsg.body || lastMsg.message || lastMsg.text;
        if (!messageBody) continue;

        // Skip if "ai off" tag is set
        if (await isAiOff(contactId)) {
          console.log(`[${contactId}] Skipping — "ai off" tag`);
          continue;
        }

        // Determine channel type
        const channelType =
          CHANNEL_TYPE_MAP[lastMsg.messageType] ??
          CHANNEL_TYPE_MAP[conv.type] ??
          'FB';

        console.log(`[${contactId}] (${channelType}): ${messageBody}`);

        const reply = await chat(contactId, messageBody);
        console.log(`[${contactId}] Bot: ${reply}`);

        await sendMessage({ conversationId, contactId, message: reply, type: channelType });

        addNote(contactId, `User: ${messageBody}\nBot: ${reply}`)
          .catch((err) => console.error('Note error:', err.message));

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
