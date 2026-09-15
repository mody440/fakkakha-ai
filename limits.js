// lib/limits.js
// Rate limiting caps how OFTEN someone can call an endpoint. It does nothing
// to stop a single call from being huge (a 50,000-character "question" costs
// far more tokens than a normal one, even as a single request). These caps
// close that gap — every endpoint that takes free-text input checks against
// them before spending a Gemini call.

module.exports = {
  MAX_QUESTION_LEN: 3000,     // a real student question, generously sized
  MAX_ANSWER_LEN: 2000,       // a Socratic session answer
  MAX_ATTEMPT_LEN: 4000,      // a full worked solution for Mistake Detective
  MAX_TOPIC_LEN: 200,
  MAX_TOPICS_COUNT: 5,
  MAX_HISTORY_MESSAGES: 60,   // caps both cost and prompt size for long sessions
  MAX_GRADE_LABEL_LEN: 100,
  MAX_SUBJECT_LABEL_LEN: 120,
  MAX_PROFILE_NAME_LEN: 80,
  MAX_EXAM_ANSWERS: 50,
};
