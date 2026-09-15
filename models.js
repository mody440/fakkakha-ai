// lib/models.js
// Not every Gemini call needs the same model. Classifying "is this question
// about math or physics" is a trivial task; running a Socratic teaching
// dialogue or writing exam questions is not. Routing by task keeps quality
// where it matters and cost down where it doesn't.
//
// Override either tier via env vars without touching code — useful once
// you check which exact model names are current in Google AI Studio
// (these move faster than most docs, so verify before relying on the
// defaults below).

const FAST_MODEL = process.env.GEMINI_MODEL_FAST || 'gemini-3.1-flash-lite';
const SMART_MODEL = process.env.GEMINI_MODEL_SMART || process.env.GEMINI_MODEL || 'gemini-3.5-flash';

module.exports = { FAST_MODEL, SMART_MODEL };
