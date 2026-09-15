// POST /api/score-exam
// Body: { examSessionId, answers: [{ questionId, selectedIndex? , textAnswer? }] }
// Returns: { score, total, breakdown: [{topic, correct, total}], mistakes: [{question, yourAnswer, correctAnswer, topic}] }

const { admin } = require('../lib/supabaseAdmin');
const { requireUser } = require('../lib/verifyAuth');
const { computeExamResult } = require('../lib/examScoring');
const { withMetrics } = require('../lib/withMetrics');
const { callGemini } = require('../lib/gemini');
const { callAndValidate } = require('../lib/validateAI');
const { FAST_MODEL } = require('../lib/models');
const { MAX_ANSWER_LEN, MAX_EXAM_ANSWERS } = require('../lib/limits');
const logger = require('../lib/logger');

const JUDGE_SYSTEM_PROMPT = `أنت مصحّح إجابات قصيرة. هتاخد سؤال، الإجابة النموذجية، وإجابة الطالب.
حدد لو إجابة الطالب صح بمعنى مقبول، حتى لو مش نفس الصياغة بالظبط — يعني لو نفس المعنى العلمي صح، اعتبرها صح.
أرجع JSON فقط: { "correct": true أو false }`;

async function judgeShortAnswer(questionText, correctAnswer, studentAnswer) {
  const userPrompt = `السؤال: ${questionText}\nالإجابة النموذجية: ${correctAnswer}\nإجابة الطالب: ${studentAnswer}`;
  const result = await callAndValidate(
    () => callGemini(JUDGE_SYSTEM_PROMPT, [{ text: userPrompt }], { model: FAST_MODEL }),
    (obj) => obj && typeof obj.correct === 'boolean',
    1
  );
  // Safe default on failure: never silently mark a real attempt wrong due
  // to an infra hiccup — but also never silently mark it right. Falling
  // back to false is the more honest choice; the student can see the
  // model answer either way and re-attempt if they disagree.
  return result.ok ? result.data.correct : false;
}

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const { examSessionId, answers } = req.body || {};
  if (!examSessionId || !Array.isArray(answers)) {
    return res.status(400).json({ error: 'missing_fields', message: 'examSessionId و answers مطلوبين' });
  }
  if (answers.length > MAX_EXAM_ANSWERS || answers.some(a => !a || typeof a.questionId !== 'string')) {
    return res.status(400).json({ error: 'invalid_answers', message: 'إجابات الاختبار غير صالحة.' });
  }

  let userId;
  try { userId = await requireUser(req); }
  catch { return res.status(401).json({ error: 'unauthenticated', message: 'محتاج تسجّل دخول (حتى لو مجهول) الأول.' }); }

  const db = admin();

  const { data: examSessionRow } = await db.from('exam_sessions').select('id, user_id, finished_at').eq('id', examSessionId).maybeSingle();
  if (!examSessionRow || examSessionRow.user_id !== userId) {
    return res.status(403).json({ error: 'forbidden', message: 'الاختبار ده مش بتاعك.' });
  }

  if (examSessionRow.finished_at) {
    return res.status(409).json({ error: 'exam_already_scored', message: 'الاختبار ده اتصحح قبل كده.' });
  }

  const { data: questions, error: qErr } = await db.from('exam_questions')
    .select('*').eq('exam_session_id', examSessionId);
  if (qErr || !questions || !questions.length) {
    return res.status(404).json({ error: 'exam_not_found', message: 'الاختبار ده مش موجود.' });
  }

  // short_answer questions can't be scored by comparing an index — judge
  // each submitted one with a cheap model call BEFORE handing everything
  // to the pure scoring function. mcq answers need no judging at all.
  const questionsById = Object.fromEntries(questions.map(q => [q.id, q]));
  const uniqueIds = new Set();
  for (const a of answers) {
    if (uniqueIds.has(a.questionId) || !questionsById[a.questionId]) {
      return res.status(400).json({ error: 'invalid_answers', message: 'في إجابة غير مرتبطة بأسئلة الاختبار.' });
    }
    uniqueIds.add(a.questionId);
    if (a.textAnswer !== undefined && (typeof a.textAnswer !== 'string' || a.textAnswer.length > MAX_ANSWER_LEN)) {
      return res.status(400).json({ error: 'answer_too_long', message: 'إجابة قصيرة طويلة أوي.' });
    }
    if (a.selectedIndex !== undefined && (!Number.isInteger(a.selectedIndex) || a.selectedIndex < 0 || a.selectedIndex > 3)) {
      return res.status(400).json({ error: 'invalid_selection', message: 'اختيار غير صالح.' });
    }
  }
  await Promise.all(answers.map(async (a) => {
    const q = questionsById[a.questionId];
    if (q && q.type === 'short_answer' && a.textAnswer) {
      try {
        a.judgedCorrect = await judgeShortAnswer(q.text, q.correct_answer, a.textAnswer);
      } catch (err) {
        logger.error('score-exam', 'short-answer judging failed', { error: err.message, userId });
        a.judgedCorrect = false;
      }
    }
  }));

  // Pure scoring logic lives in lib/examScoring.js and is unit tested there —
  // this endpoint only does I/O (read questions, judge free-text answers, write results).
  const { score, total, breakdown, mistakes, answerRows } = computeExamResult(questions, answers);

  const fullAnswerRows = answerRows.map(r => ({ ...r, exam_session_id: examSessionId, user_id: userId }));
  await db.from('exam_answers').insert(fullAnswerRows);
  await db.from('exam_sessions').update({
    score, total, finished_at: new Date().toISOString()
  }).eq('id', examSessionId);

  return res.status(200).json({ score, total, breakdown, mistakes });
}

module.exports = withMetrics('score-exam', handler);
