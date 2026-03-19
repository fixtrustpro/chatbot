'use strict';

require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { handleVerification, handleMessage } = require('./webhook');

// --- Startup validation ---
const required = ['ANTHROPIC_API_KEY', 'META_VERIFY_TOKEN', 'META_ACCESS_TOKEN', 'GHL_API_KEY', 'GHL_LOCATION_ID'];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Missing required env vars: ${missing.join(', ')}`);
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3000;

// --- Security middleware ---
app.use(helmet());

app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

// Capture raw body for Meta signature verification before JSON parsing
app.use((req, res, next) => {
  let data = '';
  req.on('data', (chunk) => { data += chunk; });
  req.on('end', () => {
    req.rawBody = data;
    next();
  });
});

app.use(express.json({ limit: '1mb' }));

// --- Routes ---

// Meta webhook verification (GET) and message handling (POST)
app.get('/webhook', handleVerification);
app.post('/webhook', handleMessage);

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// --- Start server ---
const server = app.listen(PORT, () => {
  console.log(`GHL Meta Chatbot running on port ${PORT}`);
});

// --- Graceful shutdown ---
function shutdown(signal) {
  console.log(`\n${signal} received — shutting down`);
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
