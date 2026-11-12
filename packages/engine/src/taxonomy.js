// The shared vocabulary: role families, skill areas, cities, and the words that signal a gap.
// A user picks from these; the scorer never invents a category of its own.

/** Role families a user can rank. The first one they pick is worth the most. */
export const ROLE_FAMILIES = [
  { id: 'ai_product', label: 'AI Product', label_ar: 'منتجات الذكاء الاصطناعي',
    terms: ['ai product analyst', 'ai product manager', 'ai product owner', 'ai product', 'محلل منتجات الذكاء الاصطناعي'] },
  { id: 'product', label: 'Product Management / Analysis', label_ar: 'إدارة وتحليل المنتجات',
    terms: ['product analyst', 'associate product manager', 'apm', 'junior product manager', 'product manager', 'product owner', 'product analytics', 'محلل منتجات', 'محلل منتج', 'مدير منتج'] },
  { id: 'ai_solutions', label: 'AI Solutions / AI Business Analysis', label_ar: 'حلول الذكاء الاصطناعي',
    terms: ['ai solutions analyst', 'ai business analyst', 'ai solution*', 'ai analyst', 'ai consultant', 'genai analyst'] },
  { id: 'business_analysis', label: 'Business Analysis', label_ar: 'تحليل الأعمال',
    terms: ['business analyst', 'business systems analyst', 'systems analyst', 'requirements analyst', 'محلل أعمال', 'محلل اعمال', 'محلل نظم'] },
  { id: 'data', label: 'Data / BI Analysis', label_ar: 'تحليل البيانات',
    terms: ['data analyst', 'bi analyst', 'business intelligence analyst', 'analytics analyst', 'reporting analyst', 'insights analyst', 'data & analytics', 'analytics specialist', 'محلل بيانات'] },
  { id: 'digital_transformation', label: 'Digital Transformation', label_ar: 'التحول الرقمي',
    terms: ['digital transformation', 'transformation analyst', 'التحول الرقمي'] },
  { id: 'strategy', label: 'Strategy', label_ar: 'الاستراتيجية',
    terms: ['ai strategy', 'technology strategy', 'tech strategy', 'strategy analyst', 'digital strategy', 'استراتيجية'] },
  { id: 'product_ops', label: 'Product / Business Operations', label_ar: 'عمليات المنتج والأعمال',
    terms: ['product operations', 'product ops', 'business operations', 'business intelligence', 'ذكاء الأعمال'] },
  { id: 'tech_ops', label: 'Technology Operations / NOC', label_ar: 'العمليات التقنية',
    terms: ['noc', 'technical operations', 'it operations', 'technology operations', 'service operations', 'operations analyst', 'techops'] },
  { id: 'marketing', label: 'Marketing', label_ar: 'التسويق',
    terms: ['marketing specialist', 'digital marketing', 'growth marketing', 'brand manager', 'تسويق'] },
  { id: 'sales', label: 'Sales / Account Management', label_ar: 'المبيعات',
    terms: ['account executive', 'account manager', 'sales executive', 'sales manager', 'business development', 'مبيعات'] },
  { id: 'finance', label: 'Finance / Accounting', label_ar: 'المالية والمحاسبة',
    terms: ['financial analyst', 'accountant', 'finance manager', 'treasury', 'محاسب', 'محلل مالي'] },
  { id: 'hr', label: 'HR / Talent', label_ar: 'الموارد البشرية',
    terms: ['recruiter', 'talent acquisition', 'hr specialist', 'hr business partner', 'موارد بشرية'] },
  { id: 'design', label: 'Design / UX', label_ar: 'التصميم وتجربة المستخدم',
    terms: ['product designer', 'ux designer', 'ui designer', 'ux researcher', 'graphic designer', 'مصمم'] },
  { id: 'software', label: 'Software Engineering', label_ar: 'هندسة البرمجيات',
    terms: ['software engineer', 'backend engineer', 'frontend engineer', 'full stack', 'mobile developer', 'devops', 'sre', 'data engineer', 'مطور', 'مبرمج'] },
  { id: 'data_science', label: 'Data Science / ML', label_ar: 'علم البيانات',
    terms: ['data scientist', 'machine learning engineer', 'ml engineer', 'research scientist'] },
  { id: 'customer', label: 'Customer Success / Support', label_ar: 'خدمة ودعم العملاء',
    terms: ['customer success', 'customer support', 'client delivery', 'solution consultant', 'presales', 'خدمة العملاء'] },
  { id: 'supply_chain', label: 'Supply Chain / Logistics', label_ar: 'سلاسل الإمداد',
    terms: ['supply chain', 'logistics', 'procurement', 'warehouse', 'سلسلة الإمداد', 'مشتريات'] },
  { id: 'compliance', label: 'Risk / Compliance', label_ar: 'المخاطر والامتثال',
    terms: ['compliance officer', 'risk analyst', 'aml', 'anti money laundering', 'internal audit', 'امتثال', 'مخاطر'] }
];

/** Skill areas a user confirms they actually have. Only confirmed areas earn points. */
export const SKILL_AREAS = [
  { id: 'product', label: 'Product (user problems, features, adoption)', label_ar: 'المنتج',
    terms: ['product manag*', 'product owner', 'product discovery', 'roadmap', 'user problem*', 'pain point*', 'feature*', 'product adoption', 'adoption', 'user research', 'customer insight*', 'product analytics', 'prioritiz*', 'mvp'] },
  { id: 'ba', label: 'Business analysis (requirements, user stories, process mapping)', label_ar: 'تحليل الأعمال',
    terms: ['business analys*', 'business requirement*', 'requirements gathering', 'requirement*', 'user stor*', 'process mapping', 'process map*', 'bpmn', 'stakeholder*', 'brd', 'gap analysis'] },
  { id: 'data', label: 'Data analytics / BI', label_ar: 'تحليل البيانات',
    terms: ['analytics', 'data analys*', 'power bi', 'powerbi', 'tableau', 'dashboard*', 'kpi*', 'reporting', 'insight*', 'metrics', 'business intelligence', 'visuali*'] },
  { id: 'ai', label: 'AI applied to business problems', label_ar: 'الذكاء الاصطناعي',
    terms: ['artificial intelligence', 'ai', 'genai', 'generative ai', 'machine learning', 'llm*', 'ai solution*', 'ai product*', 'ai powered', 'ai driven', 'ذكاء اصطناعي', 'الذكاء الاصطناعي'] },
  { id: 'dt', label: 'Digital transformation / operational efficiency', label_ar: 'التحول الرقمي',
    terms: ['digital transformation', 'transformation', 'operational efficiency', 'process improvement', 'efficiency', 'optimiz*', 'automation', 'التحول الرقمي'] },
  { id: 'ops', label: 'Technical operations (servers, NOC)', label_ar: 'العمليات التقنية',
    terms: ['noc', 'server*', 'infrastructure', 'monitoring', 'incident*', 'it operations', 'technical operations', 'uptime'] },
  { id: 'design', label: 'Working with design teams', label_ar: 'العمل مع فرق التصميم',
    terms: ['design team*', 'designers', 'ux', 'user experience', 'cross functional'] },
  { id: 'sales', label: 'Sales / client facing', label_ar: 'المبيعات والتعامل مع العملاء',
    terms: ['client facing', 'account management', 'pipeline', 'quota', 'negotiat*', 'crm', 'salesforce'] },
  { id: 'finance', label: 'Finance / accounting', label_ar: 'المالية',
    terms: ['financial', 'budget*', 'forecast*', 'reconcil*', 'ifrs', 'audit*', 'invoic*'] }
];

/** Requirements that count as a gap unless the user listed them as a real skill. */
export const GAP_TERMS = [
  ['sql', 'SQL'], ['python', 'Python'], ['tableau', 'Tableau'], ['looker', 'Looker'],
  ['excel', 'Advanced Excel'], ['jira', 'Jira'], ['scrum', 'Scrum'], ['agile', 'Agile methods'],
  ['a b test*', 'A/B testing'], ['experimentation', 'Experimentation'], ['statistic*', 'Statistics'],
  ['mixpanel', 'Mixpanel'], ['amplitude', 'Amplitude'], ['figma', 'Figma'], ['aws', 'AWS'],
  ['azure', 'Azure'], ['gcp', 'GCP'], ['snowflake', 'Snowflake'], ['dbt', 'dbt'], ['spark', 'Spark'],
  ['salesforce', 'Salesforce'], ['sap', 'SAP'], ['erp', 'ERP'], ['tensorflow', 'TensorFlow'],
  ['pytorch', 'PyTorch'], ['java', 'Java'], ['javascript', 'JavaScript'],
  ['mba', 'MBA'], ['master s degree', "Master's degree"], ['masters degree', "Master's degree"]
];

export const CERT_TERMS = [
  ['pmp', 'PMP'], ['cbap', 'CBAP'], ['ccba', 'CCBA'], ['pmi pba', 'PMI-PBA'], ['cfa', 'CFA'],
  ['cpa', 'CPA'], ['itil', 'ITIL'], ['prince2', 'PRINCE2'], ['csm', 'CSM'], ['pspo', 'PSPO'],
  ['ccna', 'CCNA'], ['ccnp', 'CCNP'], ['cissp', 'CISSP'], ['socpa', 'SOCPA']
];

export const HEAVY_CODE = ['write code', 'writing code', 'coding', 'software development', 'develop applications',
  'backend', 'frontend', 'full stack', 'production code', 'java', 'javascript', 'typescript', 'react', 'node js',
  'nodejs', 'c++', 'c#', 'golang', 'kotlin', 'swift', 'microservices', 'git', 'ci cd', 'kubernetes', 'docker',
  'code review*', 'programming'];
export const MEDIUM_CODE = ['sql', 'python', 'r programming', 'dax', 'scripting', 'apis'];

export const DEV_TITLE = ['software', 'backend', 'back end', 'frontend', 'front end', 'full stack', 'fullstack',
  'mobile developer', 'ios', 'android', 'devops', 'sre', 'site reliability', 'qa engineer', 'test automation',
  'data engineer', 'ml engineer', 'machine learning engineer', 'platform engineer', 'security engineer',
  'embedded', 'firmware', 'developer', 'programmer', 'engineer', 'engineering manager', 'مطور', 'مبرمج'];

export const PROGRAM_TERMS = ['graduate program', 'graduate programme', 'builders program', 'fresh graduate',
  'graduate development program', 'management trainee', 'internship program', 'تمهير'];

/** Cities the platform understands, with the spellings that appear in real postings. */
export const CITY_ALIASES = {
  riyadh: ['riyadh', 'الرياض'], jeddah: ['jeddah', 'jiddah', 'جدة'], dammam: ['dammam', 'الدمام'],
  khobar: ['khobar', 'al khobar', 'الخبر'], dhahran: ['dhahran', 'الظهران'], mecca: ['mecca', 'makkah', 'مكة'],
  medina: ['medina', 'madinah', 'المدينة'], neom: ['neom', 'نيوم'], tabuk: ['tabuk', 'تبوك'],
  abha: ['abha', 'أبها'], qassim: ['qassim', 'buraidah', 'القصيم', 'بريدة'],
  dubai: ['dubai', 'دبي'], 'abu dhabi': ['abu dhabi', 'أبوظبي', 'ابوظبي'], sharjah: ['sharjah', 'الشارقة'],
  doha: ['doha', 'الدوحة'], manama: ['manama', 'bahrain', 'المنامة'], kuwait: ['kuwait', 'الكويت'],
  muscat: ['muscat', 'مسقط'], cairo: ['cairo', 'القاهرة'], amman: ['amman', 'عمان']
};

/** Countries, so "Saudi Arabia" with no city still lands somewhere sensible. */
export const COUNTRY_ALIASES = {
  sa: ['saudi arabia', 'saudi', 'ksa', 'kingdom of saudi arabia', 'السعودية'],
  ae: ['united arab emirates', 'uae', 'الإمارات'], qa: ['qatar', 'قطر'], bh: ['bahrain', 'البحرين'],
  kw: ['kuwait', 'الكويت'], om: ['oman', 'عمان'], eg: ['egypt', 'مصر'], jo: ['jordan', 'الأردن']
};

/**
 * Places that are not here.
 *
 * A posting marked "remote" used to be kept whenever its location named no country this file
 * knew — and this file knew eight. So "Remote - Americas", "Remote, Texas" and "Taiwan (Remote)"
 * were all read as "remote, open from anywhere" and offered to people in Riyadh: 188 of them.
 * This is not a gazetteer. It is enough that a location naming one of these — and nothing in
 * the region — is understood as somewhere else.
 */
export const ELSEWHERE = [
  // areas that leave this region out
  'europe', 'eu', 'european union', 'emea north', 'dach', 'nordics', 'benelux', 'apac', 'asia pacific', 'anz',
  'latam', 'latin america', 'north america', 'namer', 'south america', 'central america', 'americas', 'america', 'amer',
  'sub saharan africa', 'southern africa', 'west africa', 'east africa', 'southeast asia', 'south asia',
  'east asia', 'northeast asia', 'north asia', 'central asia', 'cis', 'oceania', 'caribbean',
  // the United States, as it is written
  'united states', 'united states of america', 'usa', 'us', 'u s', 'u s a',
  'alabama', 'alaska', 'arizona', 'arkansas', 'california', 'colorado', 'connecticut', 'delaware', 'florida',
  'georgia', 'hawaii', 'idaho', 'illinois', 'indiana', 'iowa', 'kansas', 'kentucky', 'louisiana', 'maine',
  'maryland', 'massachusetts', 'michigan', 'minnesota', 'mississippi', 'missouri', 'montana', 'nebraska',
  'nevada', 'new hampshire', 'new jersey', 'new mexico', 'new york', 'north carolina', 'north dakota', 'ohio',
  'oklahoma', 'oregon', 'pennsylvania', 'rhode island', 'south carolina', 'south dakota', 'tennessee', 'texas',
  'utah', 'vermont', 'virginia', 'washington', 'west virginia', 'wisconsin', 'wyoming', 'district of columbia',
  'nyc', 'bay area', 'sf bay area', 'silicon valley',
  // Canada
  'canada', 'ontario', 'quebec', 'british columbia', 'alberta', 'manitoba', 'saskatchewan', 'nova scotia',
  'ottawa', 'halifax', 'calgary', 'edmonton', 'waterloo', 'winnipeg',
  // the United Kingdom and Ireland
  'united kingdom', 'uk', 'u k', 'great britain', 'britain', 'england', 'scotland', 'wales', 'northern ireland', 'ireland',
  // every other country outside the eight
  'afghanistan', 'albania', 'algeria', 'andorra', 'angola', 'argentina', 'armenia', 'australia', 'austria',
  'azerbaijan', 'bahamas', 'bangladesh', 'barbados', 'belarus', 'belgium', 'belize', 'benin', 'bhutan', 'bolivia',
  'bosnia', 'botswana', 'brazil', 'brunei', 'bulgaria', 'burkina faso', 'burundi', 'cambodia', 'cameroon',
  'cape verde', 'chad', 'chile', 'china', 'colombia', 'congo', 'costa rica', 'croatia', 'cuba', 'cyprus',
  'czech republic', 'czechia', 'denmark', 'djibouti', 'dominican republic', 'ecuador', 'el salvador', 'eritrea',
  'estonia', 'eswatini', 'ethiopia', 'fiji', 'finland', 'france', 'gabon', 'gambia', 'germany', 'ghana', 'greece',
  'guatemala', 'guinea', 'guyana', 'haiti', 'honduras', 'hong kong', 'hungary', 'iceland', 'india', 'indonesia',
  'iran', 'iraq', 'israel', 'italy', 'ivory coast', 'jamaica', 'japan', 'kazakhstan', 'kenya', 'kosovo',
  'kyrgyzstan', 'laos', 'latvia', 'lebanon', 'lesotho', 'liberia', 'libya', 'liechtenstein', 'lithuania',
  'luxembourg', 'macau', 'madagascar', 'malawi', 'malaysia', 'maldives', 'mali', 'malta', 'mauritania',
  'mauritius', 'mexico', 'moldova', 'monaco', 'mongolia', 'montenegro', 'morocco', 'mozambique', 'myanmar',
  'namibia', 'nepal', 'netherlands', 'the netherlands', 'new zealand', 'nicaragua', 'niger', 'nigeria',
  'north korea', 'north macedonia', 'norway', 'pakistan', 'palestine', 'panama', 'papua new guinea', 'paraguay',
  'peru', 'philippines', 'poland', 'portugal', 'puerto rico', 'romania', 'russia', 'rwanda', 'senegal', 'serbia',
  'seychelles', 'sierra leone', 'singapore', 'slovakia', 'slovenia', 'somalia', 'south africa', 'south korea',
  'korea', 'south sudan', 'spain', 'sri lanka', 'sudan', 'suriname', 'sweden', 'switzerland', 'syria', 'syrian arab republic', 'taiwan',
  'tajikistan', 'tanzania', 'thailand', 'togo', 'trinidad and tobago', 'tunisia', 'turkey', 'turkiye',
  'turkmenistan', 'uganda', 'ukraine', 'uruguay', 'uzbekistan', 'venezuela', 'vietnam', 'yemen', 'zambia', 'zimbabwe',
  // cities a "remote" posting is most often pinned to
  'london', 'manchester', 'edinburgh', 'dublin', 'berlin', 'munich', 'hamburg', 'frankfurt', 'paris', 'amsterdam',
  'brussels', 'madrid', 'barcelona', 'lisbon', 'rome', 'milan', 'zurich', 'geneva', 'vienna', 'prague', 'warsaw',
  'krakow', 'budapest', 'bucharest', 'sofia', 'athens', 'stockholm', 'oslo', 'copenhagen', 'helsinki', 'istanbul',
  'tel aviv', 'beirut', 'baghdad', 'erbil', 'casablanca', 'tunis', 'algiers', 'lagos', 'nairobi', 'accra',
  'johannesburg', 'cape town', 'karachi', 'lahore', 'islamabad', 'dhaka', 'colombo', 'mumbai', 'delhi', 'new delhi',
  'bangalore', 'bengaluru', 'hyderabad', 'pune', 'chennai', 'gurgaon', 'gurugram', 'noida', 'kolkata', 'manila',
  'jakarta', 'kuala lumpur', 'bangkok', 'ho chi minh', 'hanoi', 'seoul', 'tokyo', 'osaka', 'taipei', 'shanghai',
  'beijing', 'shenzhen', 'sydney', 'melbourne', 'brisbane', 'auckland', 'toronto', 'vancouver', 'montreal',
  'san francisco', 'los angeles', 'seattle', 'boston', 'chicago', 'austin', 'dallas', 'houston', 'denver',
  'atlanta', 'miami', 'sao paulo', 'rio de janeiro', 'mexico city', 'bogota', 'buenos aires', 'santiago', 'lima'
];

/**
 * Areas that do include this region. "Remote - EMEA" is open to someone in Jeddah; so is
 * "Global". Named alongside somewhere else ("APAC; EMEA"), these win.
 */
export const COVERS_REGION = [
  'emea', 'mena', 'menat', 'mea', 'middle east', 'gcc', 'gulf', 'global', 'globally', 'worldwide', 'world wide',
  'anywhere', 'international', 'africa', 'north africa', 'levant', 'arab world', 'الشرق الأوسط', 'الخليج', 'عالمي'
];

/**
 * Region cities whose names are also towns elsewhere. "Medina, Ohio" is not Medina.
 * Beside one of these, a foreign place with no region country named means the foreign one.
 */
export const SHARED_CITY_NAMES = ['medina', 'mecca', 'cairo'];

/**
 * US states as boards abbreviate them: "Foster City, CA", "Remote - TX". Read from the text as
 * written — capitals, and only straight after a comma or a dash — because lower-cased and on
 * their own, "in", "or", "me", "ok" and "hi" are words. Those five are left out altogether.
 */
export const US_STATE_CODE = /(?:,\s*|[-–]\s+)(?:AL|AK|AZ|AR|CA|CO|CT|DC|DE|FL|GA|IA|ID|IL|KS|KY|LA|MA|MD|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY)(?=$|[\s,;)])/;

export const CITY_COUNTRY = {
  riyadh: 'sa', jeddah: 'sa', dammam: 'sa', khobar: 'sa', dhahran: 'sa', mecca: 'sa', medina: 'sa',
  neom: 'sa', tabuk: 'sa', abha: 'sa', qassim: 'sa',
  dubai: 'ae', 'abu dhabi': 'ae', sharjah: 'ae', doha: 'qa', manama: 'bh', kuwait: 'kw', muscat: 'om',
  cairo: 'eg', amman: 'jo'
};
