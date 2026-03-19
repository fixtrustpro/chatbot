'use strict';

const { chat } = require('./claude');
const { sendMessage, addNote } = require('./ghl');

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
 * Set GHL_WEBHOOK_SECRET in your env and append it to the webhook URL
 * in your GHL workflow to prevent unauthorized calls.
 */
function verifySecret(req) {
  const secret = process.env.GHL_WEBHOOK_SECRET;
  if (!secret) return true; // not configured — skip check
  return req.query.secret === secret;
}

/**
 * Handle POST /webhook — incoming message event from GHL workflow.
 *
 * Expected GHL webhook payload:
 * {
 *   type: "InboundMessage",
 *   locationId: "...",
 *   contactId: "...",
 *   conversationId: "...",
 *   body: "message text",
 *   messageType: "TYPE_FB_MSG" | "TYPE_INSTAGRAM" | "TYPE_SMS" | ...
 * }
 */
async function handleMessage(req, res) {
  // Respond 200 immediately so GHL doesn't retry
  res.sendStatus(200);

  if (!verifySecret(req)) {
    console.warn('Invalid webhook secret — ignoring');
    return;
  }

  const { type, contactId, conversationId, body: messageBody, messageType } = req.body;

  // Only process inbound messages
  if (type !== 'InboundMessage') return;
  if (!contactId || !conversationId || !messageBody) return;

  // Determine reply channel type (default to FB)
  const channelType = CHANNEL_TYPE_MAP[messageType] ?? 'FB';

  console.log(`[${contactId}] User (${channelType}): ${messageBody}`);

  try {
    const reply = await chat(contactId, messageBody);
    console.log(`[${contactId}] Bot: ${reply}`);

    // Send reply back through GHL (routes to FB/IG/SMS automatically)
    await sendMessage({ conversationId, contactId, message: reply, type: channelType });

    // Log the exchange as a note (fire-and-forget)
    addNote(contactId, `User: ${messageBody}\nBot: ${reply}`)
      .catch((err) => console.error('Note error:', err.message));
  } catch (err) {
    console.error(`Error handling ${contactId}:`, err.message);
  }
}

module.exports = { handleMessage };
