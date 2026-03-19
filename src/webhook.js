'use strict';

const { chat } = require('./claude');
const { sendMessage, addNote, getContact } = require('./ghl');

const CHANNEL_TYPE_MAP = {
  TYPE_FB_MSG: 'FB',
  TYPE_INSTAGRAM: 'IG',
  TYPE_SMS: 'SMS',
  TYPE_WHATSAPP: 'WhatsApp',
  TYPE_EMAIL: 'Email',
};

function verifySecret(req) {
  const secret = (process.env.GHL_WEBHOOK_SECRET || '').trim();
  if (!secret) return true;
  return req.query.secret === secret;
}

async function isAiOff(contactId) {
  try {
    const data = await getContact(contactId);
    const tags = data?.contact?.tags ?? [];
    return tags.includes('ai off');
  } catch (err) {
    console.error(`Could not fetch tags for ${contactId}:`, err.message);
    return false;
  }
}

/**
 * Handle POST /webhook — works in both Express (local) and Vercel serverless.
 * All async work is completed before sending the 200 response so Vercel
 * doesn't terminate the function early.
 */
async function handleMessage(req, res) {
  if (!verifySecret(req)) {
    console.warn('Invalid webhook secret');
    return res.status(403).end();
  }

  const { type, contactId, conversationId, body: messageBody, messageType } = req.body ?? {};

  if (type !== 'InboundMessage' || !contactId || !conversationId || !messageBody) {
    return res.status(200).end();
  }

  if (await isAiOff(contactId)) {
    console.log(`[${contactId}] Skipping — "ai off" tag is set`);
    return res.status(200).end();
  }

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

  res.status(200).end();
}

module.exports = { handleMessage };
