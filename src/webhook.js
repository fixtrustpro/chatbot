'use strict';

const { chat } = require('./claude');
const { sendMessage, addNote, getContact, getLastInboundMessage } = require('./ghl');

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

  if (type !== 'InboundMessage' || !contactId || !conversationId) {
    return res.status(200).end();
  }

  // If GHL merge tag didn't resolve, fetch the message directly from the API
  let resolvedBody = messageBody;
  if (!resolvedBody) {
    console.log(`[${contactId}] message.body blank — fetching from GHL API`);
    resolvedBody = await getLastInboundMessage(conversationId).catch(() => null);
  }

  if (!resolvedBody) {
    console.log(`[${contactId}] Could not resolve message body — skipping`);
    return res.status(200).end();
  }

  if (await isAiOff(contactId)) {
    console.log(`[${contactId}] Skipping — "ai off" tag is set`);
    return res.status(200).end();
  }

  const channelType = CHANNEL_TYPE_MAP[messageType] ?? 'FB';
  console.log(`[${contactId}] User (${channelType}): ${resolvedBody}`);

  try {
    const reply = await chat(contactId, resolvedBody);
    console.log(`[${contactId}] Bot: ${reply}`);

    await sendMessage({ conversationId, contactId, message: reply, type: channelType });

    addNote(contactId, `User: ${resolvedBody}\nBot: ${reply}`)
      .catch((err) => console.error('Note error:', err.message));
  } catch (err) {
    console.error(`Error handling ${contactId}:`, err.message);
  }

  res.status(200).end();
}

module.exports = { handleMessage };
