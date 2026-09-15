// POST /api/session-turn
// Drives ONE turn of the Socratic session. The frontend keeps the running
// history and sends it back each call (server itself is stateless, as any
// serverless function must be) — see conversation_management pattern.
//
// Body: {
//   subject, subjectLabel, topic, gradeLabel,
//   history: [{ role: 'ai'|'student', text }],
//   action: 'start' | 'answer' | 'hint' | 'simplify',
//   studentAnswer?: string
// }
//
// Returns: {
//   aiMessage: string,
//   verdict: 'correct' | 'partial' | 'incorrect' | null,
//   mistakeCategory: string | null,
//   sessionComplete: boolean,
//   masteryDelta: number   // -0.1..0.2, how much to nudge the skill mastery score
// }

const { callGemini } = require('../lib/gemini');
const { callAndValidate } = require('../lib/validateAI');
const { checkRateLimit } = require('../lib/rateLimit');
const { requireUser } = require('../lib/verifyAuth');
const { MAX_ANSWER_LEN, MAX_HISTORY_MESSAGES, MAX_GRADE_LABEL_LEN, MAX_SUBJECT_LABEL_LEN, MAX_TOPIC_LEN } = require('../lib/limits');
const { clamp } = require('../lib/util');
const { withMetrics } = require('../lib/withMetrics');
const { SMART_MODEL } = require('../lib/models');
const logger = require('../lib/logger');

const MISTAKE_CATEGORIES = [
  'CONCEPT_MISUNDERSTANDING', 'WRONG_FORMULA', 'WRONG_RULE', 'CALCULATION_ERROR',
  'SIGN_ERROR', 'UNIT_ERROR', 'READING_ERROR', 'LOGIC_ERROR',
  'INCOMPLETE_REASONING', 'CARELESS_ERROR'
];

const SYSTEM_PROMPT = `أنت "فكّكها AI"، معلّم خصوصي بيستخدم أسلوب سقراطي (Socratic method).
قاعدتك الأساسية: متديش الإجابة النهائية أبدًا من غير ما الطالب يحاول ويفكر الأول.

المنهجية:
1. افهم مستوى الطالب من الرسائل اللي فاتت.
2. اسأله سؤال واحد بس، يوجهه لخطوة التفكير الجاية.
3. لو رد عليك، قيّم إجابته (صح / صح جزئيًا / غلط) وابني على كلامه.
4. لو غلط، اشرح ليه من غير ما تكون قاسي، وحدد نوع الخطأ لو ينفع.
5. لو صح، اثبت الفكرة وانتقل لخطوة تانية أو اقفل الجلسة لو الموضوع اتغطى كفاية (بعد حوالي 2-4 خطوات).
6. لو الطالب طلب تلميح (action=hint)، اديله تلميح صغير من غير ما تحل المسألة.
7. لو طلب تبسيط (action=simplify)، أعد صياغة آخر خطوة بكلام أبسط وأمثلة أوضح.

اتكلم بنفس لغة الطالب (عربي مصري / إنجليزي / مخلوط) وخليك طبيعي مش رسمي زيادة.

أرجع JSON فقط بالشكل ده بالظبط:
{
  "aiMessage": "الرسالة اللي هتتقال للطالب",
  "verdict": "correct" | "partial" | "incorrect" | null,
  "mistakeCategory": ${JSON.stringify(MISTAKE_CATEGORIES)} أو null,
  "sessionComplete": true أو false,
  "masteryDelta": رقم بين -0.1 و 0.2
}`;

function isValidShape(obj) {
  return obj &&
    typeof obj.aiMessage === 'string' &&
    (obj.verdict === null || ['correct', 'partial', 'incorrect'].includes(obj.verdict)) &&
    typeof obj.sessionComplete === 'boolean' &&
    typeof obj.masteryDelta === 'number';
}

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const { subject, subjectLabel, topic, gradeLabel, history, action, studentAnswer } = req.body || {};
  const ALLOWED_ACTIONS = new Set(['start', 'answer', 'hint', 'simplify']);
  if (!subjectLabel || !topic || !action) {
    return res.status(400).json({ error: 'missing_fields', message: 'subjectLabel, topic, action مطلوبين' });
  }
  if (typeof subjectLabel !== 'string' || subjectLabel.length > MAX_SUBJECT_LABEL_LEN || typeof topic !== 'string' || topic.length > MAX_TOPIC_LEN || !ALLOWED_ACTIONS.has(action)) {
    return res.status(400).json({ error: 'invalid_fields', message: 'بيانات الجلسة غير صالحة.' });
  }
  if (studentAnswer !== undefined && studentAnswer !== null && typeof studentAnswer !== 'string') {
    return res.status(400).json({ error: 'invalid_answer', message: 'الإجابة لازم تكون نص.' });
  }
  if (Array.isArray(history) && history.some(m => !m || !['ai','student'].includes(m.role) || typeof m.text !== 'string')) {
    return res.status(400).json({ error: 'invalid_history', message: 'سجل المحادثة غير صالح.' });
  }
  if (studentAnswer && studentAnswer.length > MAX_ANSWER_LEN) {
    return res.status(400).json({ error: 'answer_too_long', message: `إجابتك طويلة أوي (أقصى حد ${MAX_ANSWER_LEN} حرف).` });
  }
  const safeGradeLabel = typeof gradeLabel === 'string' ? gradeLabel.slice(0, MAX_GRADE_LABEL_LEN) : '';
  // Only the most recent N turns matter for Socratic context — an old
  // session that's been going for hours shouldn't keep growing the prompt
  // (and therefore the cost) on every single turn.
  const trimmedHistory = Array.isArray(history) ? history.slice(-MAX_HISTORY_MESSAGES) : [];

  let userId;
  try { userId = await requireUser(req); }
  catch { return res.status(401).json({ error: 'unauthenticated', message: 'محتاج تسجّل دخول (حتى لو مجهول) الأول.' }); }

  const limitKey = 'session-turn:' + userId;
  const limit = await checkRateLimit(limitKey, 80, 600); // 80 turns / 10 min — a real study session, not a script
  if (!limit.allowed) {
    return res.status(429).json({ error: 'rate_limited', message: `مستخدم التطبيق كتير أوي دلوقتي. استنى ${limit.retryAfterSeconds} ثانية وكمل.` });
  }

  const historyText = trimmedHistory
    .map(m => `${m.role === 'ai' ? 'المعلم' : 'الطالب'}: ${m.text}`)
    .join('\n');

  const userPrompt = `المادة: ${subjectLabel}
الموضوع: ${topic}
مرحلة الطالب: ${safeGradeLabel || 'غير محددة'}
الحدث الحالي: ${action}
${studentAnswer ? `آخر رد من الطالب: ${studentAnswer}` : ''}

سجل المحادثة لحد دلوقتي:
${historyText || '(بداية الجلسة)'}`;

  const result = await callAndValidate(
    () => callGemini(SYSTEM_PROMPT, [{ text: userPrompt }], { model: SMART_MODEL }),
    isValidShape,
    1
  );

  if (!result.ok) {
    logger.error('session-turn', 'gemini call failed, returning graceful fallback', { error: result.error, userId });
    return res.status(200).json({
      aiMessage: 'حصل عطل بسيط في التحليل. تقدر تعيد كتابة إجابتك أو تكمل، وهحاول تاني.',
      verdict: null,
      mistakeCategory: null,
      sessionComplete: false,
      masteryDelta: 0,
      fallback: true
    });
  }

  // Defense in depth: never trust the raw number even though the schema
  // check passed — clamp to the range described in the prompt.
  result.data.masteryDelta = clamp(result.data.masteryDelta, -0.1, 0.2);

  return res.status(200).json(result.data);
}

module.exports = withMetrics('session-turn', handler);
