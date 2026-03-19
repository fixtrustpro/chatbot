'use strict';

const { chat } = require('./claude');
const { sendMessage, addNote, getContact } = require('./ghl');

// Map GHL messageType values to the GHL send API channel type
const CHANNEL_TYPE_MAP = {
  TYPE_FB_MSG: 'FB',
  TYPE_INSTAGRAM: 'IG',
  TYPE_SMS: 'SMS',
  TYPE_WHATSAPP: 'WhatsApp',
  TYPE_EMAIL: 'Email',
};

/**
 * Verify the optional webhook secret passed as ?secret=... in the URL.
 */
function verifySecret(req) {
  const secret = (process.env.GHL_WEBHOOK_SECRET || '').trim();
  if (!secret) return true;
  return req.query.secret === secret;
}

/**
 * Check if a contact has the "ai off" tag in GHL.
 * Returns true if the bot should skip this contact.
 */
async function isAiOff(contactId) {
  try {
    const data = await getContact(contactId);
    const tags = data?.contact?.tags ?? [];
    return tags.includes('ai off');
  } catch (err) {
    // If we can't fetch the contact, log but don't block
    console.error(`Could not fetch tags for ${contactId}:`, err.message);
    return false;
  }
}

/**
 * Handle POST /webhook — incoming message event from GHL workflow.
 */
async function handleMessage(req, res) {
  // Respond 200 immediately so GHL doesn't retry
  res.sendStatus(200);

  if (!verifySecret(req)) {
    console.warn('Invalid webhook secret — ignoring');
    return;
  }

  const { type, contactId, conversationId, body: messageBody, messageType } = req.body ?? {};

  if (type !== 'InboundMessage') return;
  if (!contactId || !conversationId || !messageBody) return;

  // Skip contacts with "ai off" tag
  if (await isAiOff(contactId)) {
    console.log(`[${contactId}] Skipping — "ai off" tag is set`);
    return;
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
}

module.exports = { handleMessage };
