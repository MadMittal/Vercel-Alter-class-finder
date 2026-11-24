// ============================================================
// lib/config.js — Core Configuration & Constants
// Masters' Union Cohort 7 Alt-Class Finder
// ============================================================

export const SECTIONS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

export const HARD_BLOCKING = new Set([
  'Course',
  'Term Break',
  'Workshop',
  'Masterclass',
  'Guest Lecture',
  'Bootcamp',
]);

export const NON_BLOCKING = new Set([
  'Out of Class Activity',
  'Non-in-class Academic Session',
]);

export const FACULTY_MAP = {
  // Economics / Core
  'kunal':    'Macro Economics',
  'shravan':  'Macro Economics',
  // Finance
  'mayank':   'Financial Modelling',
  'mukul':    'Financial Modelling',
  'anuj':     'Financial Management',
  'shubham':  'Financial Management',
  'satish':   'Accounting',
  'abhishek': 'Accounting',
  // Marketing & Sales
  'alok':     'Brand Management',
  'tarun':    'Consumer Behavior',
  'bhanu':    'Digital Marketing',
  'sachi':    'Digital Marketing',
  'manasvi':  'B2B Marketing',
  'vasu':     'B2B Marketing',
  // Product / Tech / Operations
  'harsh':    'Operations Management',
  'anand':    'Supply Chain',
  'vikram':   'Product Management',
  'shashank': 'Product Management',
  'shreyas':  'Product Strategy',
  'aditya':   'Analytics',
  'rahul':    'Data Science',
  'gagan':    'Data Analytics',
  'prateek':  'Business Valuation',
  'divya':    'Business Valuation',
  'mohit':    'Consulting',
  'rohit':    'Leadership',
  'kushagra': 'Strategy',
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
