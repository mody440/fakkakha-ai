# فكّكها AI | Fakkakha AI — دليل النشر

مشروع حقيقي جاهز للـ deploy: باك إند Vercel serverless بيكلم Gemini من السيرفر بس،
قاعدة بيانات Supabase، وفرونت إند PWA-ready.

## 1) هات مفتاح Gemini
1. روح https://aistudio.google.com/app/apikey
2. اعمل مفتاح API جديد (فيه رصيد مجاني للتجربة).
3. خبيه — هتحطه في Vercel مش في أي كود.

## 2) جهّز Supabase (قاعدة البيانات)
1. اعمل حساب على https://supabase.com وأنشئ مشروع جديد (مجاني).
2. من SQL Editor، شغّل محتوى `supabase/schema.sql` بالكامل مرة واحدة.
3. **مهم جدًا**: من Authentication → Providers → فعّل **Anonymous Sign-ins**. من غيرها التطبيق مش هيقدر يسجّل أي طالب، لأن التسجيل بيحصل تلقائيًا وبدون فورم (مفيش تسجيل دخول ظاهر للطالب، بس فيه هوية حقيقية شغالة من وراه بتحمي بياناته).
4. من Settings → API، هتلاقي:
   - `Project URL` → ده الـ `SUPABASE_URL`
   - `anon public key` → ده الـ `SUPABASE_ANON_KEY`
   - `service_role` (سري) → هتحطه في Vercel بس، خطوة 5.
   (الـ anon key آمن يتحط في الفرونت إند — الحماية الحقيقية دلوقتي شغالة بـ Row Level Security + auth.uid()، مش بإخفاء المفتاح.)

## 3) اربط الفرونت إند
افتح `public/app.js` وحط القيم في أول الملف:
```js
const SUPABASE_URL = "https://xxxxx.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOi...";
```

## 4) ادفع المشروع على GitHub
```bash
git init
git add .
git commit -m "Fakkakha AI initial"
git branch -M main
git remote add origin <رابط الريبو بتاعك>
git push -u origin main
```

## 5) اعمل Deploy على Vercel
1. https://vercel.com → New Project → استورد الريبو.
2. Vercel هيكتشف تلقائيًا إن `/api` فولدر بيه serverless functions و `/public` هو الـ static site.
3. في Settings → Environment Variables ضيف:
   - `GEMINI_API_KEY` = المفتاح اللي جبته من خطوة 1
   - `GEMINI_MODEL` = `gemini-3.5-flash` (أو موديل أحدث متاح في حسابك) (أو أي موديل تاني عايزه لاحقًا)
   - `SUPABASE_URL` = نفس الرابط من خطوة 2
   - `SUPABASE_SERVICE_ROLE_KEY` = من Supabase → Settings → API → **service_role** (سري، مختلف عن الـ anon key)
4. اضغط Deploy. هتاخد رابط زي `https://fakkakha-ai.vercel.app`.

## 7) Exam Mode
شغال بالكامل: الأسئلة بتتولّد بـ Gemini، بتتخزن في Supabase عن طريق مفتاح الـ service role بس
(مش الـ anon key)، عشان الإجابات الصحيحة متكونش قابلة للقراءة من المتصفح قبل ما الطالب يسلّم.
التصحيح بيحصل على السيرفر في `/api/score-exam`، وبيرجّع تقرير فيه الدرجة + تحليل حسب الموضوع
+ الأسئلة الغلط مع الإجابة الصح.

## 8) تطبيقات Android / iOS حقيقية (Capacitor)
الفرونت إند اتصمم عشان يتغلف كـ تطبيق حقيقي من غير ما تعيد كتابة أي منطق:

```bash
npm install
npx cap init   # لو أول مرة، هيسألك عن الاسم والـ appId — استخدم اللي في capacitor.config.json
npx cap add android
npx cap add ios
npx cap sync
```

بعد كده:
- **أندرويد**: `npx cap open android` هيفتح Android Studio — من هناك تقدر تعمل Run على جهاز/إيميوليتور، أو تبني APK/AAB للنشر على Google Play.
- **آيفون**: `npx cap open ios` هيفتح Xcode (محتاج Mac) — من هناك Run على جهاز، أو Archive للنشر على App Store.

مهم: التطبيق هيكلم نفس الـ backend على Vercel أونلاين (مش هيشتغل offline بالكامل)، فلازم يكون فيه اتصال إنترنت — بالظبط زي أي تطبيق تعليمي حقيقي.

## 6) جرّبه محليًا قبل النشر (اختياري)
```bash
npm i -g vercel
vercel dev
```
ده بيشغل الـ `/api` functions والـ `/public` مع بعض على `localhost:3000`.

---

## معمول إيه فعليًا، ومعمول إيه لسه لأ

**شغال فعليًا:**
- كل استدعاءات AI بتعدي من الفرونت إند → `/api/*` على السيرفر → Gemini. مفيش مفتاح في المتصفح خالص.
- التحليل، الجلسة السقراطية، كشف الأخطاء، وتحليل الصور كلهم بيستخدموا Gemini حقيقي مش أي rule-based mock.
- البيانات (بروفايلات، مهارات، جلسات، رسائل) بتتحفظ في Supabase فعليًا.
- التحقق من شكل رد الـ AI (JSON schema) + إعادة محاولة مرة واحدة + fallback آمن لو فشل — الموديل مش بيوقف التطبيق أبدًا.

- **عزل بيانات حقيقي بين المستخدمين**: كل طالب بيتسجّل تلقائيًا بهوية حقيقية (Supabase Anonymous Auth)، وكل جدول محمي بـ `auth.uid() = user_id`.
- **تحقق حقيقي من الهوية على كل استدعاء AI**: كل endpoint بيتحقق من توكن Supabase الحقيقي (`lib/verifyAuth.js`) قبل ما يصرف أي مكالمة Gemini — مش بس بيصدّق كلام الفرونت إند.
- **حدود حجم صارمة على كل إدخال** (`lib/limits.js`): سؤال، إجابة، محاولة حل، مواضيع الاختبار، وطول سجل المحادثة — كل واحد له حد أقصى معلن، فمفيش طلب واحد يقدر يستهلك رصيد ضخم لوحده حتى لو الـ rate limiting سمحله يتنفذ.
- **اختبارات آلية حقيقية** (`tests/unit.test.js`، 8 اختبارات) لكل المنطق الحسابي الحساس (تصحيح الاختبارات، التحقق من ردود الـ AI)، مع **GitHub Actions** (`.github/workflows/ci.yml`) بيشغّلها تلقائيًا مع كل push.
- **Security headers حقيقية** (`vercel.json`): CSP، X-Frame-Options، X-Content-Type-Options، Referrer-Policy، Permissions-Policy.
- **صفحة مراقبة صحة السيرفر** (`/api/health`) — تقدر تحط عليها أي أداة مراقبة مجانية (UptimeRobot مثلاً) عشان تعرف فورًا لو Supabase أو إعدادات Gemini وقعوا.
- **تسجيل أخطاء موحّد** (`lib/logger.js`) بدل `console.log` عشوائي — كل خطأ بيتسجل بشكل JSON منظم تقدر تفلتر عليه في Vercel logs.
- Exam Mode: توليد أسئلة، تايمر حقيقي، تصحيح آمن على السيرفر (منطق نقي مفصول وقابل للاختبار في `lib/examScoring.js`)، تقرير بالدرجة وتحليل حسب الموضوع.
- PWA كاملة: قابلة للتثبيت على الشاشة الرئيسية بأندرويد وآيفون.
- تغليف Capacitor جاهز لتطبيق Android/iOS حقيقي قابل للنشر على المتاجر.

**لسه محتاج شغل، وده بالظبط اللي مينفعش حد غيرك يعمله (محتاج حساباتك الشخصية):**
1. **تعمل حساب Google AI Studio، Supabase، Vercel، GitHub** (لو مش موجودين عندك) وتاخد المفاتيح.
2. **تفعّل Anonymous Sign-ins** في Supabase (خطوة 2.3 فوق) — من غيرها محدش هيقدر يعمل بروفايل.
3. **تحط المفاتيح** في مكانين: أول `public/app.js` (الـ Supabase URL/anon key)، وSettings الخاصة بمشروعك على Vercel (الـ Gemini key والـ service role key).
4. **تضغط Deploy على Vercel** — أنا مش أقدر أعمل حساب أو أنشر نيابة عنك.
5. **(اختياري لتطبيق موبايل حقيقي)** تنزّل Android Studio و/أو Xcode على جهازك وتشغّل أوامر Capacitor فوق، ده شغل محلي على جهازك مش حاجة أقدر أعملها من هنا.

**تحديث: التلاتة دول اتعملوا فعليًا، مش بس متأجلين:**
- **Rate limiting**: بيشتغل بـ Supabase تلقائيًا من غير أي إعداد إضافي. لو حطيت `UPSTASH_REDIS_REST_URL` و `UPSTASH_REDIS_REST_TOKEN` (مجانيين من https://upstash.com)، بينتقل لـ Upstash Redis تلقائيًا — نفس الكود شغال دلوقتي مش وعد مستقبلي.
- **تسجيل دخول اختياري بالإيميل**: من شاشة "الحساب" (👤) جنب زرار تبديل البروفايل، الطالب يقدر يربط تقدمه الحالي بإيميل وباسورد، ويسترجعه من أي جهاز تاني بتسجيل الدخول بنفس البيانات. التسجيل المجهول لسه هو الافتراضي (من غير أي إجبار)، لكن الخيار بقى موجود وشغال.
- **فصل الفرونت إند لملفات مستقلة**: `index.html` بقى مجرد هيكل صغير (22 سطر)، والمنطق كله في `app.js`، والتنسيق كله في `style.css`. ده خلّى الصيانة أسهل، وخلّى قفل الـ CSP بالكامل ممكن (الفقرة الجاية).

## بنية الملفات
```
fakkakha-project/
├── api/
│   ├── analyze-question.js   ← تحليل السؤال (مادة/موضوع/قصد)
│   ├── session-turn.js       ← محرك الجلسة السقراطية (القلب الحقيقي)
│   ├── detect-mistake.js     ← Mistake Detective
│   ├── analyze-image.js      ← تحليل صور الأسئلة (Gemini vision)
│   ├── generate-exam.js      ← توليد أسئلة اختبار (الإجابات بتتخزن admin-only)
│   └── score-exam.js         ← تصحيح آمن على السيرفر + تقرير حسب الموضوع
├── lib/
│   ├── gemini.js              ← المكان الوحيد اللي بيكلم Gemini
│   ├── validateAI.js          ← تحقق من شكل رد الـ AI + إعادة محاولة
│   ├── supabaseAdmin.js       ← عميل Supabase بصلاحيات كاملة (سيرفر بس)
│   ├── rateLimit.js           ← حد أقصى لعدد المكالمات لكل مستخدم
│   ├── verifyAuth.js          ← تحقق حقيقي من هوية المستخدم
│   ├── limits.js              ← حدود حجم الإدخال (سؤال/إجابة/مواضيع)
│   ├── util.js                ← دوال مشتركة صغيرة (clamp) — مختبرة
│   ├── examScoring.js         ← منطق تصحيح الاختبار النقي — مختبر
│   └── logger.js              ← تسجيل أخطاء موحّد بصيغة JSON
├── tests/
│   └── unit.test.js            ← اختبارات آلية حقيقية (npm test)
├── .github/workflows/ci.yml    ← تشغيل الاختبارات تلقائيًا مع كل push
├── supabase/
│   └── schema.sql              ← جداول قاعدة البيانات + RLS
├── public/
│   ├── index.html                ← هيكل الصفحة فقط (يشتغل كـ PWA)
│   ├── app.js                     ← منطق التطبيق كامل
│   ├── style.css                  ← التنسيق كامل
│   ├── privacy.html               ← سياسة الخصوصية (نموذج أولي)
│   ├── terms.html                 ← شروط الاستخدام (نموذج أولي)
│   ├── policy.css                 ← تنسيق صفحتي الخصوصية والشروط
│   ├── manifest.json
│   ├── sw.js
│   ├── icon-192.png
│   └── icon-512.png
├── capacitor.config.json       ← تغليف Android/iOS
├── vercel.json                  ← security headers
├── CHECKLIST.md                 ← كل خطوة لازم تعملها بنفسك، بالترتيب
├── .env.example
└── package.json
```

## من MVP لمنتج جاهز للحجم الكبير

الإضافات دي مش تجميل — كل واحدة فيها معمولة بكود حقيقي شغال، ومعظمها ليها اختبار يثبتها:

1. **كاش (`lib/cache.js`)**: سؤال متكرر بيرجع من قاعدة البيانات مش من Gemini تاني. مثبت باختبار حقيقي في `tests/endpoints.test.js`.
2. **توزيع موديلات (`lib/models.js`)**: تصنيف بسيط (تحديد المادة) بيستخدم موديل رخيص، والتدريس/التقييم المعقد بيستخدم موديل أقوى. قابل للتعديل بـ `GEMINI_MODEL_FAST` / `GEMINI_MODEL_SMART`.
3. **مراقبة أداء (`lib/withMetrics.js` + `lib/logger.js` + `/api/metrics`)**: كل استدعاء API بيتسجل (endpoint، زمن الاستجابة، حالة، هل جه من الكاش). `/api/metrics?key=...` بيديك ملخص 24 ساعة حقيقي.
4. **اختبارات endpoints حقيقية (`tests/fakeSupabase.js` + `tests/endpoints.test.js`)**: مش بس اختبار منطق رياضي — اختبارات فعلية على الـ handlers نفسها (رفض بدون توكن، رفض بروفايل مش بتاعك، إثبات الكاش).
5. **طبقة أمان مضاعفة**: `safetySettings` صريحة على كل مكالمة Gemini (`lib/gemini.js`)، + زرار "🚩 بلّغ" حقيقي شغال على كل رد AI (`/api/report-content`).
6. **بنية ترجمة (`public/lib/i18n.js`)**: كل نص واجهة ثابت بيمر بـ `t('key')`. إضافة لغة جديدة = ملف قاموس جديد، مش إعادة كتابة كود.
7. **تحليلات أول-طرف (`/api/track-event`)**: بدون أي تتبع خارجي — أحداث حقيقية (بروفايل جديد، بداية/نهاية جلسة، امتحان) مربوطة بلحظات الاستخدام الفعلية.
8. **جاهزية الحجم**: فهارس على كل foreign key، حدود صريحة على كل استعلام قائمة (`.limit()`)، وتسجيل push notifications حقيقي (`public/push.js`) — التسجيل والتخزين شغالين بالكامل، الإرسال الفعلي محتاج مشروع Firebase (خطوة حساب، مش كود).

## إضافات لاحقة: تحليل الأخطاء، وضع تجربة، أسئلة نصية

- **تحليل الأخطاء المتكررة (`mistake_log`)**: كل خطأ مصنّف من الجلسة السقراطية أو Mistake Detective بيتسجل، وشاشة "أنماط أخطائك" (جوه "اتعلم حاجة") بتلخّص أكتر نوع غلط وأكتر موضوع بيتكرر فيهم الخطأ — مختلف عن نسبة الإتقان اللي بتقول "قد إيه فاهم" بس مش "بيغلط إزاي بالتحديد".
- **وضع تجربة سريعة**: زرار "🎓 تجربة سريعة" في شاشة البروفايلات بيعمل بروفايل فورًا ببيانات واقعية جاهزة (مهارات، أخطاء متكررة) من غير أي كتابة أو استدعاء Gemini — مفيد لمحكّم أو مراجع عايز يشوف الشاشات ممتلئة بسرعة.
- **أسئلة نصية جوه Exam Mode**: توليد الاختبار بقى بيخلط MCQ مع أسئلة إجابتها نص قصير، والتصحيح بيحكم على الإجابة النصية بمكالمة Gemini خفيفة (مش مجرد مقارنة نص حرفي) قبل ما يحسب الدرجة.

## نقاط ضعف إضافية اتظبطت

- **أمان تحديث قاعدة البيانات (`supabase/schema.sql`)**: لو حد شغّل نسخة قديمة من الـ schema قبل ما دعم الأسئلة النصية يتضاف، وبعدين شغّل النسخة الجديدة، `create table if not exists` كان مش هيضيف الأعمدة الجديدة للجدول الموجود بالفعل — يعني توليد الامتحانات كان هيفشل بصمت. دلوقتي فيه `DO` block بيتأكد من وجود كل عمود ويضيفه لو ناقص، بغض النظر عن الحالة اللي القاعدة كانت عليها.
- **الـ CI بقى بيفحص الفرونت إند كمان**: كان بيفحص `api/` و`lib/` بس. لقينا باگين حقيقيين في `app.js` يدويًا أثناء التطوير (كانوا يعدّوا من غير ما CI يلاحظهم). دلوقتي `app.js` و`lib/i18n.js` و`push.js` و`sw.js` بيتفحصوا تلقائيًا مع كل push.
- **اختبارات حقيقية على المحرك السقراطي نفسه**: كان `session-turn.js` (أهم endpoint في المشروع) من غير أي اختبار endpoint. دلوقتي فيه اختبارات بتثبت رفض التوكن الغلط، المسار الناجح، وإن الـ clamp الدفاعي على نسبة الإتقان شغال فعليًا حتى لو Gemini رجّع رقم برة النطاق.

## الـ CSP مقفولة بالكامل

الـ Content-Security-Policy في `vercel.json` ما فيهاش `'unsafe-inline'` خالص، لا للـ scripts ولا للـ styles. ده كان ممكن بعد فصل الفرونت إند لملفات مستقلة (`app.js`, `style.css`) وإزالة كل الـ `style="..."` من الكود واستبدالها بكلاسات CSS، مع استخدام `element.style.width` (CSSOM) بدل inline attribute في الحالات الديناميكية زي أشرطة التقدم — ده مش محكوم بالـ CSP أصلاً. يعني لو حد حاول يحقن `<script>` عن طريق ثغرة XSS، المتصفح هيرفضه ينفذ.


## Production hardening — تمت إضافته في النسخة الحالية
- حماية أفضل لمدخلات الصور لتبقى تحت حد Vercel العملي، مع قبول JPG/PNG/WebP فقط.
- منع إعادة تصحيح نفس الاختبار بعد إغلاقه، ومنع إدخال أسئلة لا تنتمي للاختبار.
- تقوية RLS بحيث لا يمكن إنشاء سجلات مرتبطة ببروفايل/جلسة تخص مستخدمًا آخر.
- `Service Worker` أصبح network-first للكود بدل cache-first حتى لا يظل إصدار قديم عالقًا بعد الـ deploy.
- كلمات المرور أصبحت حقول password فعلية في الواجهة.
- `/api/metrics` يقبل السر عبر `X-Admin-Key` فقط بدل وضعه في URL.
- `.gitignore` يمنع تسريب ملفات `.env` وملفات البناء.
- Health endpoint لا يكشف تفاصيل أخطاء البنية التحتية.
- الاختبارات + syntax checks ما زالت تمر بالكامل.

**ملاحظة:** تفعيل CAPTCHA/Turnstile للتسجيل المجهول في Supabase خطوة إنتاجية مهمة قبل فتح التطبيق للعامة؛ Supabase توصي بها صراحة للحماية من إساءة الاستخدام.

## Competition Edition

The repository now includes a judge-ready presentation layer and a reproducible learning-evidence plan:

- `/competition.html` — polished English judge landing page and 90-second demo flow.
- `docs/PITCH.md` — concise competition pitch and differentiation.
- `docs/JUDGE_DEMO_SCRIPT.md` — exact judge walkthrough.
- `docs/ARCHITECTURE.md` — trust boundaries and system architecture.
- `benchmarks/README.md` — benchmark protocol focused on learning gain and transfer.
- `benchmarks/questions.json` — starter evaluation set.
- `benchmarks/SCORECARD.md` — human scoring rubric.

**Important:** the benchmark intentionally contains no invented performance numbers. Run the experiment first, then publish the measured results with sample size and methodology.
