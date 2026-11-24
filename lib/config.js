// ============================================================
// lib/config.js — Core Configuration & Constants
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

export const CFG = {
  SOURCE_SHEET_ID: process.env.SOURCE_SHEET_ID || '1esfFF_aoab5VoxNUg7IWLqYgwO-sEJUDtVIQ1k78Olk',
  SHEET_NAME: process.env.SHEET_NAME || 'C7: PreLMS T3',
  TIMEZONE: 'Asia/Kolkata',
  DEFAULT_RANGE_DAYS: 14,
  CACHE_TTL_MS: 5 * 60 * 1000, // 5 minutes in-memory cache
  TERM_LABEL: 'Cohort 7 — Term 3',
};
