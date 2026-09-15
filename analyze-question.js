// POST /api/analyze-question
// Body: { question: string, gradeLabel?: string }
// Returns: { subject, subjectLabel, topic, intent, difficulty }

const { callGemini } = require('../lib/gemini');
const { callAndValidate } = require('../lib/validateAI');
const { checkRateLimit } = require('../lib/rateLimit');
const { requireUser } = require('../lib/verifyAuth');
const { withMetrics } = require('../lib/withMetrics');
const { getCached, setCached, makeCacheKey } = require('../lib/cache');
const { FAST_MODEL } = require('../lib/models');
const logger = require('../lib/logger');
const { MAX_QUESTION_LEN, MAX_GRADE_LABEL_LEN } = require('../lib/limits');

const SYSTEM_PROMPT = `أنت محرك تحليل أسئلة تعليمية اسمه Fakkakha AI.
مهمتك الوحيدة: تحليل سؤال الطالب وإرجاع تصنيف له.
لا تشرح، لا تحل، لا تضف أي نص خارج الـ JSON.

أرجع كائن JSON بالشكل ده بالظبط:
{
  "subject": "math | physics | chemistry | biology | arabic_lang | english_lang | general",
  "subjectLabel": "اسم المادة بالعربي، مثلاً: رياضيات",
  "topic": "اسم الموضوع المحدد، مثلاً: معادلات من الدرجة الأولى",
  "intent": "explain | solve | understand",
  "difficulty": "easy | medium | hard"
}

خد بالك: الطالب ممكن يكتب بالعربي أو الإنجليزي أو مخلوط، وممكن يكتب بالعامية المصرية. افهم القصد مش بس الكلمات.`;

function isValidShape(obj) {
  return obj && typeof obj.subject === 'string' && typeof obj.topic === 'string' && typeof obj.intent === 'string';
}

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const { question, gradeLabel } = req.body || {};
  if (!question || typeof question !== 'string' || !question.trim()) {
    return res.status(400).json({ error: 'empty_question', message: 'السؤال فاضي' });
  }
  if (question.length > MAX_QUESTION_LEN) {
    return res.status(400).json({ error: 'question_too_long', message: `السؤال طويل أوي (أقصى حد ${MAX_QUESTION_LEN} حرف).` });
  }
  const safeGradeLabel = typeof gradeLabel === 'string' ? gradeLabel.slice(0, MAX_GRADE_LABEL_LEN) : '';

  let userId;
  try { userId = await requireUser(req); }
  catch { return res.status(401).json({ error: 'unauthenticated', message: 'محتاج تسجّل دخول (حتى لو مجهول) الأول.' }); }

  const limitKey = 'analyze-question:' + userId;
  const limit = await checkRateLimit(limitKey, 40, 600); // 40 calls / 10 min
  if (!limit.allowed) {
    return res.status(429).json({ error: 'rate_limited', message: `استنى ${limit.retryAfterSeconds} ثانية وجرب تاني.` });
  }

  // Thousands of students ask overlapping questions — reuse the answer
  // instead of paying Gemini again for the same classification.
  const cacheKey = makeCacheKey('analyze-question', { q: question.trim().toLowerCase(), g: safeGradeLabel });
  const cached = await getCached(cacheKey);
  if (cached) {
    res._cached = true;
    return res.status(200).json({ ...cached, cached: true });
  }

  const userPrompt = `السؤال: ${question}\nمرحلة الطالب: ${safeGradeLabel || 'غير محددة'}`;

  // Classification is a simple, low-stakes task — the fast/cheap model tier
  // is the right fit, not the same model used for actual teaching.
  const result = await callAndValidate(
    () => callGemini(SYSTEM_PROMPT, [{ text: userPrompt }], { model: FAST_MODEL }),
    isValidShape,
    1
  );

  if (!result.ok) {
    logger.error('analyze-question', 'falling back to generic classification', { error: result.error, userId });
    // Safe fallback: never crash the app, degrade to a generic session.
    return res.status(200).json({
      subject: 'general',
      subjectLabel: 'عام',
      topic: 'استكشاف السؤال',
      intent: 'understand',
      difficulty: 'medium',
      fallback: true
    });
  }

  await setCached(cacheKey, result.data);
  return res.status(200).json(result.data);
}

module.exports = withMetrics('analyze-question', handler);
