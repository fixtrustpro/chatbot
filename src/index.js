'use strict';

require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { handleMessage } = require('./webhook');

// --- Startup validation ---
const required = ['ANTHROPIC_API_KEY', 'GHL_API_KEY', 'GHL_LOCATION_ID'];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Missing required env vars: ${missing.join(', ')}`);
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3000;

// --- Security middleware ---
app.use(helmet());
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 200 }));
app.use(express.json({ limit: '1mb' }));

// --- Routes ---
app.post('/webhook', handleMessage);
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// --- Start server ---
const server = app.listen(PORT, () => {
  console.log(`GHL Meta Chatbot running on port ${PORT}`);
  if (process.env.GHL_WEBHOOK_SECRET) {
    console.log(`Webhook URL: http://localhost:${PORT}/webhook?secret=${process.env.GHL_WEBHOOK_SECRET}`);
  }
});

// --- Graceful shutdown ---
function shutdown(signal) {
  console.log(`\n${signal} received — shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
