'use strict';

const { chat } = require('../src/claude');
const { sendMessage, addNote } = require('../src/ghl');

// Map GHL messageType to GHL send API channel type
const CHANNEL_TYPE_MAP = {
  TYPE_FB_MSG: 'FB',
  TYPE_INSTAGRAM: 'IG',
  TYPE_SMS: 'SMS',
  TYPE_WHATSAPP: 'WhatsApp',
  TYPE_EMAIL: 'Email',
};

module.exports = async (req, res) => {
  // --- Webhook secret check ---
  const secret = process.env.GHL_WEBHOOK_SECRET;
  if (secret && req.query.secret !== secret) {
    console.warn('Invalid webhook secret');
    return res.status(403).end();
  }

  // Health / verification ping
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'ok' });
  }

  if (req.method !== 'POST') return res.status(405).end();

  // Respond 200 immediately so GHL doesn't retry
  res.status(200).end();

  const { type, contactId, conversationId, body: messageBody, messageType } = req.body ?? {};

  if (type !== 'InboundMessage') return;
  if (!contactId || !conversationId || !messageBody) return;

  const channelType = CHANNEL_TYPE_MAP[messageType] ?? 'FB';

  console.log(`[${contactId}] User (${channelType}): ${messageBody}`);

  try {
    const reply = await chat(contactId, messageBody);
    console.log(`[${contactId}] Bot: ${reply}`);

    await sendMessage({ conversationId, contactId, message: reply, type: channelType });

    addNote(contactId, `User: ${messageBody}\nBot: ${reply}`)
      .catch((err) => console.error('Note error:', err.message));
  } catch (err) {
    console.error(`Error handling ${contactId}:`, err.message);
  }
};
