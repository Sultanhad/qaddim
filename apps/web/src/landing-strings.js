// Both languages live side by side so neither is a translation afterthought.
// The toggle in the navbar swaps them; the page direction follows.

export const CITIES = {
  ar: ['الرياض', 'جدة', 'دبي', 'الدوحة', 'القاهرة', 'عمّان'],
  en: ['Riyadh', 'Jeddah', 'Dubai', 'Doha', 'Cairo', 'Amman']
};

export const COUNTRY = {
  ar: { sa: 'السعودية', ae: 'الإمارات', qa: 'قطر', bh: 'البحرين', kw: 'الكويت', om: 'عُمان', eg: 'مصر', jo: 'الأردن' },
  en: { sa: 'Saudi Arabia', ae: 'United Arab Emirates', qa: 'Qatar', bh: 'Bahrain', kw: 'Kuwait', om: 'Oman', eg: 'Egypt', jo: 'Jordan' }
};

export const S = {
  ar: {
    dir: 'rtl', brand: 'قدّم', howItWorks: 'كيف تعمل', faq: 'أسئلة شائعة', cta: 'ابدأ', signIn: 'الدخول', menu: 'القائمة', light: 'المظهر الفاتح', dark: 'المظهر الداكن',
    heroA: 'وظائف جديدة في', heroB: 'ونقدّم عنك',
    sub: 'كل ١٥ دقيقة نقرأ صفحات التوظيف في الشركات ونرتّب الجديد حسب ملفك. فعّل التقديم التلقائي فيقدّم عنك — وأول ثلاثة تعتمدها بنفسك.',
    meta: ['تُقرأ كل ١٥ دقيقة', 'بالعربي والإنجليزي', 'مجانية'],
    openJobs: 'وظيفة مفتوحة', updated: 'آخر تحديث', loading: 'يُحمّل…',
    sourceH: 'نذهب إلى المصدر',
    sourceP: 'كل ١٥ دقيقة نقرأ تغذية الوظائف في أنظمة التوظيف التي تستخدمها الشركات. لا إعلانات معادة: كل وظيفة تحيلك إلى صاحب العمل نفسه.',
    scoreH: 'كل وظيفة تأخذ درجة',
    scoreP: 'اختر مجالاتك ومدنك ومستواك. كل وظيفة تأخذ درجة مطابقة — والشركات والكلمات التي تستثنيها تختفي.',
    scoreRows: [['محلل منتجات', 92], ['محلل أعمال', 74], ['محلل بيانات', 38]],
    orderH: 'بحثك مرتّب',
    orderP: 'احفظ الوظائف، سجّل ما قدّمت عليه، واكتب ملاحظاتك. وبعد أسبوعين من التقديم نذكّرك بالمتابعة.',
    sample: 'بيانات توضيحية',
    wordEn: 'means: apply.', amongCompanies: 'من الشركات التي نقرؤها',
    standH: 'اعرف أين وصل كل طلب.',
    standP: 'أنظمة التوظيف نادراً ما تخبرك بما حدث بعد أن قدّمت. نحفظ حالاتك وملاحظاتك في قائمة واحدة، ونريك متى تتابع.',
    nav: ['اليوم', 'وظائف لك', 'طلباتي', 'بحث', 'الإعدادات'],
    statuses: { saved: 'محفوظة', applied: 'قدّمت', interview: 'مقابلة', offer: 'عرض', closed: 'مغلقة', all: 'الكل' },
    appsTitle: 'الطلبات', notes: 'ملاحظات', followBy: 'تابع قبل ١٩ نوفمبر',
    autoH1: 'التقديم التلقائي', autoH2: 'يقدّم عنك',
    autoP: 'حتى عشرين طلباً في اليوم. وإن لم يعرف إجابة، أو واجه كابتشا، يتوقف ويسألك.',
    autoPoints: [
      'يختار أفضل مطابقاتك ويعبّي الاستمارة من ملفك.',
      'يرسل سيرتك كما هي — ولا يضيف إليها حقيقة لم تقلها.',
      'أول ثلاثة تعتمدها بنفسك. بعدها يمشي وحده.'
    ],
    closing: 'قدّم على القادمة.', free: 'قدّم · مجانية لمن يبحث عن عمل.',
    privacy: 'الخصوصية', emailPh: 'you@example.com', sentTo: 'أرسلنا رسالة الدخول إلى',
    sentHint: 'افتح الرابط في الرسالة، أو اكتب الرمز هنا لتبقى في هذا المتصفح. وإن لم تجدها، انظر في «المهملات».',
    codePh: 'الرمز', codeGo: 'ادخل', resend: 'أعد الإرسال', changeEmail: 'غيّر البريد',
    signInTitle: 'ادخل إلى قدّم', signInSub: 'اكتب بريدك ونرسل لك رمز دخول. أول مرة؟ نفس الخطوة تنشئ حسابك.',
    emailLabel: 'بريدك الإلكتروني', sendCode: 'أرسل الرمز', sending: 'جارٍ الإرسال…', signInFoot: 'بلا كلمة مرور.',
    signingIn: 'جارٍ الدخول…', linkExpired: 'انتهت صلاحية الرابط. اطلب رسالة جديدة.'
  },
  en: {
    dir: 'ltr', brand: 'Qaddim', howItWorks: 'How it works', faq: 'FAQ', cta: 'Get started', signIn: 'Sign in', menu: 'Menu', light: 'Light', dark: 'Dark',
    heroA: 'New jobs in', heroB: 'and we apply for you',
    sub: 'Every 15 minutes Qaddim reads company hiring pages and ranks the new jobs against your profile. Turn on Autopilot and it applies for you. You approve the first three.',
    meta: ['Checked every 15 minutes', 'Arabic and English', 'Free'],
    openJobs: 'open jobs', updated: 'Updated', loading: 'Loading…',
    sourceH: 'We go to the source',
    sourceP: 'Every 15 minutes we read the job feeds of the hiring systems companies use. No reposts: every job links back to the employer.',
    scoreH: 'Every job gets a score',
    scoreP: 'Tell us your roles, country and level. Each job gets a match score. Companies and title words you exclude disappear.',
    scoreRows: [['Product Designer', 92], ['UX Researcher', 74], ['Data Analyst', 38]],
    orderH: 'Your search stays in order',
    orderP: 'Save jobs, mark what you applied to and keep notes. Two weeks after you apply, Qaddim shows you a follow-up date.',
    sample: 'Sample data',
    wordEn: 'means: apply.', amongCompanies: 'Among the companies we read',
    standH: 'Know where every application stands.',
    standP: 'Hiring systems rarely tell you what happened after you applied. Qaddim keeps your statuses and notes in one list, and shows you when to follow up.',
    nav: ['Today', 'Jobs for you', 'Applications', 'Search', 'Settings'],
    statuses: { saved: 'Saved', applied: 'Applied', interview: 'Interview', offer: 'Offer', closed: 'Closed', all: 'All' },
    appsTitle: 'Applications', notes: 'Notes', followBy: 'Follow up by 19 Nov',
    autoH1: 'Autopilot', autoH2: 'applies for you',
    autoP: "Up to 20 a day. If it doesn't know an answer or hits a CAPTCHA, it stops and asks you.",
    autoPoints: [
      'It picks your best match and fills the form from your profile.',
      'It sends your CV as it is, and never adds a fact you did not state.',
      'The first 3 wait for your approval. After that it runs on its own.'
    ],
    closing: 'Apply to the next one.', free: 'Qaddim. Free for job seekers.',
    privacy: 'Privacy', emailPh: 'you@example.com', sentTo: 'We sent a sign-in email to',
    sentHint: 'Open the link in the email, or type the code here to stay in this browser. If it is not there, check your spam folder.',
    codePh: 'Code', codeGo: 'Sign in', resend: 'Resend', changeEmail: 'Change email',
    signInTitle: 'Sign in to Qaddim', signInSub: "Enter your email and we'll send you a sign-in code. New here? The same step creates your account.",
    emailLabel: 'Your email', sendCode: 'Send code', sending: 'Sending…', signInFoot: 'No password needed.',
    signingIn: 'Signing you in…', linkExpired: 'That link has expired. Ask for a new one.'
  }
};

export const FAQS = {
  ar: [
    ['هل تقدّمون عني؟',
      'نعم — عبر متصفحك أنت. تضغط «يهمني»، فتُفتح الاستمارة وتُعبّأ من ملفك وتُرسل. السبب أن كل نظام توظيف يضع «تحقّق أنك لست روبوتاً» قبل الإرسال، وهذا الفحص يقيس المتصفح لا الضغطة: أي متصفح يعمل على خادم يسقط فيه، ومتصفحك يمرّ. فإن تحدّتك الكابتشا فعلاً، أو ظهر سؤال لم تجب عنه، تتوقف وتناديك بدل أن تخترع لك جواباً.'],
    ['من أين تأتي الوظائف؟',
      'من لوحات التوظيف التي تستخدمها الشركات نفسها: Greenhouse وLever وAshby وWorkable وSmartRecruiters. نقرأها كل ١٥ دقيقة. لا إعلانات معادة — كل وظيفة تحيلك إلى صاحب العمل مباشرة.'],
    ['أي المدن مشمولة؟',
      'الرياض وجدة والدمام والخبر ومدن سعودية أخرى، ودبي وأبوظبي والدوحة والمنامة والكويت ومسقط والقاهرة وعمّان. تختار مدنك، وما عداها لا يظهر لك.'],
    ['كيف تُحسب درجة المطابقة؟',
      'من ستة عناصر معلنة: مهاراتك المؤكدة ٣٠، قرب الوظيفة من مجالك ٢٥، مستوى الأقدمية ١٥، الموقع ١٠، حجم البرمجة ١٠، وقوة الإعلان نفسه ١٠ — ناقص خصم إن طُلبت خبرة أو شهادة لا تملكها. وكل درجة تأتي ومعها أسبابها.'],
    ['هل تحتفظون بسيرتي؟',
      'إن رفعتها، تُحفظ في مجلد خاص بك لا يقرؤه أحد غيرك، وتُستخدم لتعبئة طلباتك فقط. تحذفها أنت متى شئت ومعها الحساب كاملاً.'],
    ['كم تكلفتها؟', 'مجانية لمن يبحث عن عمل.']
  ],
  en: [
    ['Does Qaddim apply for me?',
      'Yes — through your own browser. You press “interested”, and the form opens, fills from your profile and submits. Every hiring system puts a “verify you are human” check before submit, and that check judges the browser rather than the click: a browser running on a server fails it, yours passes. If a CAPTCHA does challenge you, or a question appears that you have not answered, it stops and asks you instead of inventing an answer.'],
    ['Where do the jobs come from?',
      'From the hiring systems companies use themselves: Greenhouse, Lever, Ashby, Workable and SmartRecruiters. We read them every 15 minutes. No reposts — every job links back to the employer.'],
    ['Which cities are covered?',
      'Riyadh, Jeddah, Dammam, Khobar and other Saudi cities, plus Dubai, Abu Dhabi, Doha, Manama, Kuwait, Muscat, Cairo and Amman. You pick your cities; nothing outside them is shown.'],
    ['How is the match score worked out?',
      'From six published parts: your confirmed skills 30, how close the role is to your field 25, seniority 15, location 10, how much coding it needs 10, and how much the posting itself tells us 10 — minus a penalty if it asks for years or a certificate you do not have. Every score arrives with its reasons.'],
    ['Do you keep my CV?',
      'If you upload one, it is stored in a folder only you can read and is used to fill your applications. You can delete it, and the whole account, whenever you like.'],
    ['What does it cost?', 'Free for job seekers.']
  ]
};
