// ============================================================
// lib/config.js — Core Configuration, Constants & IST Date Helpers
// Masters' Union Cohort 7 Alt-Class Finder
// ============================================================

export const SECTIONS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

export const HARD_BLOCKING = new Set([
  'Course',
  'Unmapped',
  'ReExam',
  'EndTerm',
  'Quiz',
  'CXO',
  'Outclass',
  'SA',
  'ODC',
  'Workshop',
  'CEP',
]);

export const NON_BLOCKING = new Set([
  'Elective',
  'Holiday',
  'Blocked',
  'Out of Class Activity',
  'Non-in-class Academic Session',
]);

export const FACULTY_MAP = {
  'bhupesh':   'Market Research',
  'praxel':    'AI in Business - 3',
  'makers':    'Makers Lab',
  'aparna':    'Digital Marketing',
  'vivek':     'Digital Marketing',
  'jit':       'Digital Marketing',
  'pranav':    'Financial Modelling',
  'mayank':    'Financial Modelling',
  'avantika':  'HRM',
  'tathagata': 'HRM',
  'tathagath': 'HRM',
  'arindham':  'HRM',
  'saurabh':   'Science of Selling',
  'rishabh':   'Science of Selling',
  'garima':    'Macro Economics',
  'kunal':     'Macro Economics',
  'ashish':    'B2B Marketing',
  'shreyas':   'Unit Economics',
  'sachi':     'Category Management',
  'ritesh':    'Category Management',
  'payal':     'Business Valuation',
  'tarun':     'IAPM',
  'bhanu':     'Product Growth',
  'sainath':   'Diversity, Equity & Inclusion',
  'siddhant':  'Sports Marketing & Fan Engagement',
};

export const CEP_FACULTY = new Set(['rohit', 'kushagra', 'harsh']);

// Strictly non-academic or excluded sessions:
// Outclass, CEP, SA, Practicum, CXO/CEXO, Re-exam, Quiz, Test, Workshop, Masterclass, Guest Lecture, Bootcamp
export const NON_ACADEMIC_PATTERNS = [
  /\b(?:out\s*class|outclclass|outclass|out\s*of\s*class)\b/i,
  /\b(?:cep|rohit|kushagra|harsh)\b/i,
  /\b(?:sa|student\s*affairs|case\s*union)\b/i,
  /\bpracticum\b/i,
  /\bc(?:e)?xo\b/i,
  /\b(?:re\s*[-–]?\s*exam(?:ination)?|reexam(?:ination)?)\b/i,
  /\bquiz(?:zes)?\b/i,
  /\b(?:surprise\s*)?test\b/i,
  /\b(?:workshop|masterclass|guest\s*lecture|bootcamp)\b/i,
];

export function isNonAcademicSession(course, rawText = '') {
  const t = (String(course || '') + ' ' + String(rawText || '')).trim();
  return NON_ACADEMIC_PATTERNS.some(rx => rx.test(t));
}

/** Return current calendar date in IST (Asia/Kolkata) formatted as YYYY-MM-DD. */
export function getTodayIST(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: CFG.TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** Add signed days to a YYYY-MM-DD ISO string using pure UTC arithmetic. */
export function addDaysISO(isoDate, deltaDays) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + deltaDays)).toISOString().slice(0, 10);
}

export const CFG = {
  SOURCE_SHEET_ID: process.env.SOURCE_SHEET_ID || '1esfFF_aoab5VoxNUg7IWLqYgwO-sEJUDtVIQ1k78Olk',
  SHEET_NAME: process.env.SHEET_NAME || 'C7 PreLMS T3',
  TIMEZONE: 'Asia/Kolkata',
  DEFAULT_RANGE_DAYS: 14,
  CACHE_TTL_MS: 5 * 60 * 1000, // 5 minutes in-memory cache
  STRIKE_RATIO: 0.5,
  TERM_LABEL: 'Cohort 7 — Term 3',
};

/** HTTP caching headers for API JSON responses (5m Edge CDN cache, browser always revalidates at CDN). */
export function apiCacheHeaders(forceRefresh = false) {
  return forceRefresh
    ? { 'Cache-Control': 'no-store' }
    : {
        'Cache-Control': 'public, max-age=0, must-revalidate',
        'Vercel-CDN-Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60',
      };
}
