'use strict';

const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// In-memory conversation history per user (senderId -> messages[])
// For production, swap this for Redis or a DB
const conversations = new Map();

const SYSTEM_PROMPT = `You are a helpful AI assistant for a trucking and transportation insurance business.
You help leads understand their options for IUL (Indexed Universal Life) insurance products tailored for truckers.

Your goals:
- Qualify leads by learning about their CDL status, years driving, age, and interest in life insurance
- Answer questions about IUL policies, how they work, and their benefits for truckers
- Book appointments for deeper consultations
- Be conversational, friendly, and concise — truckers are busy

Keep responses short (2-4 sentences max). Ask one question at a time.
Do not discuss pricing specifics — direct those questions to a human agent.`;

const MAX_HISTORY = 20; // keep last 20 messages per user to manage context

/**
 * Send a user message through Claude and get a response.
 * Maintains per-user conversation history.
 */
async function chat(senderId, userMessage) {
  // Get or init conversation history for this user
  if (!conversations.has(senderId)) {
    conversations.set(senderId, []);
  }
  const history = conversations.get(senderId);

  // Append the new user message
  history.push({ role: 'user', content: userMessage });

  // Trim history to prevent unbounded growth
  if (history.length > MAX_HISTORY) {
    history.splice(0, history.length - MAX_HISTORY);
  }

  const response = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 512,
    system: SYSTEM_PROMPT,
    thinking: { type: 'adaptive' },
    messages: history,
  });

  const assistantText = response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');

  // Append assistant reply to history
  history.push({ role: 'assistant', content: assistantText });

  return assistantText;
}

/**
 * Clear conversation history for a user (e.g., on opt-out or restart).
 */
function clearHistory(senderId) {
  conversations.delete(senderId);
}

module.exports = { chat, clearHistory };
