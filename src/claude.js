'use strict';

const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// --- Conversation storage (Vercel KV in production, in-memory fallback for local dev) ---
let kvClient = null;
if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
  try {
    const { kv } = require('@vercel/kv');
    kvClient = kv;
    console.log('Using Vercel KV for conversation history');
  } catch {
    console.warn('KV env vars set but @vercel/kv failed to load — using in-memory fallback');
  }
}

const localMap = new Map(); // fallback for local dev

async function getHistory(senderId) {
  if (kvClient) {
    try {
      return (await kvClient.get(`chat:${senderId}`)) ?? [];
    } catch (err) {
      console.error('KV get error:', err.message);
      return localMap.get(senderId) ?? [];
    }
  }
  return localMap.get(senderId) ?? [];
}

async function setHistory(senderId, history) {
  if (kvClient) {
    try {
      // 7-day TTL — old conversations expire automatically
      await kvClient.set(`chat:${senderId}`, history, { ex: 60 * 60 * 24 * 7 });
      return;
    } catch (err) {
      console.error('KV set error:', err.message);
    }
  }
  localMap.set(senderId, history);
}

// --- System prompt ---
const SYSTEM_PROMPT = `You are Ava, an AI lead qualifier for a life insurance agency that specializes in IUL (Indexed Universal Life) policies for CDL truck drivers and owner-operators.

Your job is to have a short, friendly qualifying conversation — not to sell or quote prices. You gather key info so a licensed agent can have a productive consultation call.

QUALIFICATION SEQUENCE — ask in this order, one question at a time:
1. Confirm they drive a truck / have a CDL (if not obvious from context)
2. Ask if they are an owner-operator or company driver
3. Ask their age range: "Are you in your 20s, 30s, 40s, or 50s?"
4. Ask if they currently have any life insurance coverage
5. Ask what their main goal is: protecting their family, building tax-free savings for retirement, or both
6. Ask if they have 15 minutes this week for a quick call with one of our advisors

RULES:
- Keep every response to 2–4 sentences max
- Ask only ONE question per message
- Never quote premiums, rates, or policy numbers — say "your advisor will go over exact numbers on the call"
- If they ask about cost, say: "Great question — rates depend on a few personal factors. Your advisor will walk you through exact numbers on the call, it only takes about 15 minutes."
- If they're clearly not interested, say: "No problem at all — feel free to reach out any time. Take care out there on the road." Then stop.
- If they confirm they want a call, say: "Perfect! I'll flag your file right now and an advisor will reach out shortly to schedule. Is morning or afternoon better for you?"
- Do not discuss anything unrelated to trucking, CDL driving, or life/IUL insurance

TONE: Warm, direct, and respectful of their time. Truckers appreciate straight talk — no fluff, no pressure.`;

const MAX_HISTORY = 20;

/**
 * Send a user message through Claude and get a response.
 * Maintains per-user conversation history via KV (or in-memory fallback).
 */
async function chat(senderId, userMessage) {
  let history = await getHistory(senderId);

  history.push({ role: 'user', content: userMessage });

  if (history.length > MAX_HISTORY) {
    history.splice(0, history.length - MAX_HISTORY);
  }

  const response = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 512,
    thinking: { type: 'adaptive' },
    system: SYSTEM_PROMPT,
    messages: history,
  });

  const assistantText = response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');

  history.push({ role: 'assistant', content: assistantText });
  await setHistory(senderId, history);

  return assistantText;
}

/**
 * Clear conversation history for a user (e.g. on opt-out).
 */
async function clearHistory(senderId) {
  if (kvClient) {
    try {
      await kvClient.del(`chat:${senderId}`);
      return;
    } catch (err) {
      console.error('KV del error:', err.message);
    }
  }
  localMap.delete(senderId);
}

module.exports = { chat, clearHistory };
