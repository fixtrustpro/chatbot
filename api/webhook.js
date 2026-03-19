'use strict';

const crypto = require('crypto');
const { chat } = require('../src/claude');
const { upsertContact, addNote } = require('../src/ghl');

// Disable Vercel's auto body parsing so we can read the raw body for
// Meta signature verification
module.exports.config = {
  api: { bodyParser: false },
};

/** Read the full raw request body as a Buffer. */
function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** Verify the X-Hub-Signature-256 header sent by Meta. */
function verifySignature(rawBody, signature) {
  if (!process.env.META_APP_SECRET) return true; // skip in dev
  if (!signature) return false;
  const expected = `sha256=${crypto
    .createHmac('sha256', process.env.META_APP_SECRET)
    .update(rawBody)
    .digest('hex')}`;
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

/** Send a text message back to the user via Meta Graph API. */
async function sendMetaReply(recipientId, text) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(
      `https://graph.facebook.com/v19.0/me/messages?access_token=${process.env.META_ACCESS_TOKEN}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient: { id: recipientId }, message: { text } }),
        signal: controller.signal,
      }
    );
    if (!res.ok) console.error(`Meta send failed ${res.status}: ${await res.text()}`);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = async (req, res) => {
  // --- Webhook verification (GET) ---
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === process.env.META_VERIFY_TOKEN) {
      console.log('Webhook verified');
      return res.status(200).send(challenge);
    }
    return res.status(403).end();
  }

  if (req.method !== 'POST') return res.status(405).end();

  // --- Incoming message (POST) ---
  const rawBody = await getRawBody(req);

  if (!verifySignature(rawBody, req.headers['x-hub-signature-256'])) {
    console.warn('Invalid webhook signature');
    return res.status(403).end();
  }

  // Must respond 200 to Meta before timing out
  res.status(200).end();

  let body;
  try {
    body = JSON.parse(rawBody.toString());
  } catch {
    return;
  }

  if (body.object !== 'page' && body.object !== 'instagram') return;

  const messaging = body.entry?.[0]?.messaging?.[0];
  if (!messaging) return;

  const senderId = messaging.sender?.id;
  const text = messaging.message?.text;
  if (!senderId || !text) return;

  console.log(`[${senderId}] User: ${text}`);

  try {
    const reply = await chat(senderId, text);
    console.log(`[${senderId}] Bot: ${reply}`);

    await sendMetaReply(senderId, reply);

    // GHL sync (non-blocking error handling)
    upsertContact({ source: `Meta (${body.object})` })
      .then((contactId) => addNote(contactId, `User: ${text}\nBot: ${reply}`))
      .catch((err) => console.error('GHL sync error:', err.message));
  } catch (err) {
    console.error(`Error handling ${senderId}:`, err.message);
  }
};
