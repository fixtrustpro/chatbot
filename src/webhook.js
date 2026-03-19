'use strict';

const crypto = require('crypto');
const { chat } = require('./claude');
const { upsertContact, addNote } = require('./ghl');

/**
 * Verify the X-Hub-Signature-256 header from Meta to confirm the request is authentic.
 */
function verifySignature(req) {
  const signature = req.headers['x-hub-signature-256'];
  if (!signature) return false;

  const expected = `sha256=${crypto
    .createHmac('sha256', process.env.META_APP_SECRET)
    .update(req.rawBody)
    .digest('hex')}`;

  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

/**
 * Send a reply message back to the user via the Meta Graph API.
 */
async function sendMetaMessage(recipientId, text) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(
      `https://graph.facebook.com/v19.0/me/messages?access_token=${process.env.META_ACCESS_TOKEN}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient: { id: recipientId },
          message: { text },
        }),
        signal: controller.signal,
      }
    );
    if (!res.ok) {
      const body = await res.text();
      console.error(`Meta send failed ${res.status}: ${body}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Extract sender ID and text from a Facebook Messenger webhook event.
 * Returns null if not a standard text message.
 */
function extractFbMessage(body) {
  const entry = body.entry?.[0];
  const messaging = entry?.messaging?.[0];
  if (!messaging) return null;

  const senderId = messaging.sender?.id;
  const text = messaging.message?.text;
  if (!senderId || !text) return null;

  return { senderId, text, senderName: null };
}

/**
 * Extract sender ID and text from an Instagram webhook event.
 */
function extractIgMessage(body) {
  const entry = body.entry?.[0];
  const messaging = entry?.messaging?.[0];
  if (!messaging) return null;

  const senderId = messaging.sender?.id;
  const text = messaging.message?.text;
  if (!senderId || !text) return null;

  return { senderId, text, senderName: null };
}

/**
 * Handle GET /webhook — Meta webhook verification challenge.
 */
function handleVerification(req, res) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.META_VERIFY_TOKEN) {
    console.log('Webhook verified');
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
}

/**
 * Handle POST /webhook — incoming messages from Meta.
 */
async function handleMessage(req, res) {
  // Always respond 200 immediately so Meta doesn't retry
  res.sendStatus(200);

  // Verify signature (skip in dev if META_APP_SECRET not set)
  if (process.env.META_APP_SECRET && !verifySignature(req)) {
    console.warn('Invalid webhook signature — ignoring request');
    return;
  }

  const body = req.body;
  if (body.object !== 'page' && body.object !== 'instagram') return;

  const extracted = extractFbMessage(body) ?? extractIgMessage(body);
  if (!extracted) return;

  const { senderId, text } = extracted;
  console.log(`[${senderId}] User: ${text}`);

  try {
    // Get AI response
    const reply = await chat(senderId, text);
    console.log(`[${senderId}] Bot: ${reply}`);

    // Send reply back to user
    await sendMetaMessage(senderId, reply);

    // Sync to GHL (fire-and-forget, don't block the reply)
    upsertContact({ name: null, phone: null, source: `Meta (${body.object})` })
      .then((contactId) =>
        addNote(contactId, `User: ${text}\nBot: ${reply}`)
      )
      .catch((err) => console.error('GHL sync error:', err.message));
  } catch (err) {
    console.error(`Error handling message from ${senderId}:`, err.message);
  }
}

module.exports = { handleVerification, handleMessage };
