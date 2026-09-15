// POST /api/analyze-image
// Body: { imageBase64: string, mimeType: string }  (no data: prefix in imageBase64)
// Returns: { readable: boolean, extractedText, subject, subjectLabel, topic, intent }

const { callGemini } = require('../lib/gemini');
const { callAndValidate } = require('../lib/validateAI');
const { checkRateLimit } = require('../lib/rateLimit');
const { requireUser } = require('../lib/verifyAuth');
const { withMetrics } = require('../lib/withMetrics');
const { SMART_MODEL } = require('../lib/models');
const logger = require('../lib/logger');

const SYSTEM_PROMPT = `أنت جزء من فكّكها AI متخصص في قراءة صور الأسئلة التعليمية (مطبوعة أو بخط اليد).
هتشوف صورة، وتحدد:
- لو ممكن تقرأها بوضوح
- نص السؤال المستخرج
- المادة والموضوع والقصد منه

لو الصورة مش واضحة كفاية، رجّع readable=false واشرح إيه اللي ناقص.

أرجع JSON فقط بالشكل ده بالظبط:
{
  "readable": true أو false,
  "extractedText": "النص المستخرج أو سبب عدم الوضوح",
  "subject": "math | physics | chemistry | biology | arabic_lang | english_lang | general",
  "subjectLabel": "اسم المادة بالعربي",
  "topic": "اسم الموضوع",
  "intent": "explain | solve | understand"
}`;

function isValidShape(obj) {
  return obj && typeof obj.readable === 'boolean' && typeof obj.extractedText === 'string';
}

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const { imageBase64, mimeType } = req.body || {};
  if (!imageBase64 || typeof imageBase64 !== 'string' || !mimeType || typeof mimeType !== 'string') {
    return res.status(400).json({ error: 'missing_image', message: 'الصورة مطلوبة' });
  }
  // Basic size guard — keep payloads reasonable, compress on the client first.
  const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    return res.status(415).json({ error: 'unsupported_image_type', message: 'استخدم JPG أو PNG أو WebP فقط.' });
  }
  // Vercel Functions reject request bodies above ~4.5 MB; base64 also adds
  // overhead, so keep a safer ceiling below the platform limit.
  if (imageBase64.length > 3_500_000) {
    return res.status(413).json({ error: 'image_too_large', message: 'الصورة كبيرة جدًا، جرب تضغطها' });
  }

  let userId;
  try { userId = await requireUser(req); }
  catch { return res.status(401).json({ error: 'unauthenticated', message: 'محتاج تسجّل دخول (حتى لو مجهول) الأول.' }); }

  const limitKey = 'analyze-image:' + userId;
  const limit = await checkRateLimit(limitKey, 15, 600); // 15 / 10 min — vision calls cost more
  if (!limit.allowed) {
    return res.status(429).json({ error: 'rate_limited', message: `استنى ${limit.retryAfterSeconds} ثانية وجرب تاني.` });
  }

  const parts = [
    { inlineData: { mimeType, data: imageBase64 } },
    { text: 'حلل الصورة دي.' }
  ];

  const result = await callAndValidate(
    () => callGemini(SYSTEM_PROMPT, parts, { model: SMART_MODEL }),
    isValidShape,
    1
  );

  if (!result.ok) {
    logger.error('analyze-image', 'gemini call failed, returning graceful fallback', { error: result.error, userId });
    return res.status(200).json({
      readable: false,
      extractedText: 'مقدرناش نحلل الصورة دلوقتي — جرب تاني أو اكتب السؤال يدويًا.',
      fallback: true
    });
  }

  return res.status(200).json(result.data);
}

module.exports = withMetrics('analyze-image', handler);
