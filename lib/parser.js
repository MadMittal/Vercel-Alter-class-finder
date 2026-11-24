// ============================================================
// lib/parser.js — Pure string/cell parsing logic
// Adheres strictly to BRL-01..05 & Spec Section 5.3
// ============================================================

import { FACULTY_MAP, CEP_FACULTY } from './config.js';

export function parseRange(str) {
  if (!str) return null;
  const s = String(str).trim();

  // Pattern A: "11.15 am to 1.15 pm" | "9 am to 1:15 pm" | "10:00 to 12:00"
  const m = s.match(
    /^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?\s*(?:to|-)\s*(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?$/i
  );
  if (!m) return null;

  let sH = parseInt(m[1], 10);
  const sM = m[2] !== undefined ? parseInt(m[2], 10) : 0;
  let sMer = m[3] ? m[3].toLowerCase() : null;

  let eH = parseInt(m[4], 10);
  const eM = m[5] !== undefined ? parseInt(m[5], 10) : 0;
  let eMer = m[6] ? m[6].toLowerCase() : null;

  // Mermaid inheritance rules
  if (!sMer && eMer) {
    if (eMer === 'am') {
      sMer = 'am';
    } else {
      sMer = (sH >= 8 && sH <= 11) ? 'am' : 'pm';
    }
  } else if (sMer && !eMer) {
    eMer = sMer;
  } else if (!sMer && !eMer) {
    sMer = (sH >= 8 && sH <= 11) ? 'am' : 'pm';
    eMer = (eH >= 8 && eH <= 11 && eH >= sH) ? 'am' : 'pm';
  }

  const sMin = toMinutes(sH, sM, sMer);
  const eMin = toMinutes(eH, eM, eMer);

  if (sMin === null || eMin === null || eMin <= sMin) return null;
  return { start: sMin, end: eMin };
}

function toMinutes(h, m, mer) {
  if (h < 1 || h > 12) return null;
  if (m < 0 || m > 59) return null;
  let h24 = h % 12;
  if (mer === 'pm') h24 += 12;
  return h24 * 60 + m;
}

export function strikeRatio(text, strikeMap) {
  if (!text || !strikeMap || strikeMap.length === 0) return 0.0;
  let nonSpaceTotal = 0;
  let struckTotal = 0;
  const len = Math.min(text.length, strikeMap.length);

  for (let i = 0; i < len; i++) {
    if (text[i] !== ' ' && text[i] !== '\t' && text[i] !== '\n') {
      nonSpaceTotal++;
      if (strikeMap[i]) struckTotal++;
    }
  }
  return nonSpaceTotal === 0 ? 0.0 : struckTotal / nonSpaceTotal;
}

export function classifySession(rawText) {
  const t = String(rawText || '').trim();
  const lower = t.toLowerCase();

  if (/\bterm\s*break\b/i.test(t)) {
    return { type: 'Term Break', course: 'Term Break' };
  }
  if (/\bworkshop\b/i.test(t)) {
    return { type: 'Workshop', course: cleanCourseName(t, 'Workshop') };
  }
  if (/\bmasterclass\b/i.test(t)) {
    return { type: 'Masterclass', course: cleanCourseName(t, 'Masterclass') };
  }
  if (/\bguest\s*lecture\b/i.test(t)) {
    return { type: 'Guest Lecture', course: cleanCourseName(t, 'Guest Lecture') };
  }
  if (/\bbootcamp\b/i.test(t)) {
    return { type: 'Bootcamp', course: cleanCourseName(t, 'Bootcamp') };
  }

  for (const cep of CEP_FACULTY) {
    const rx = new RegExp(`\\b${cep}\\b`, 'i');
    if (rx.test(lower)) {
      return {
        type: 'Non-in-class Academic Session',
        course: `CEP Session - ${capitalize(cep)}`,
      };
    }
  }

  if (/\bout\s*of\s*class\b/i.test(t) || /\bactivity\b/i.test(t)) {
    return { type: 'Out of Class Activity', course: cleanCourseName(t, 'Out of Class') };
  }

  let mappedCourse = null;
  for (const [facultyKey, courseName] of Object.entries(FACULTY_MAP)) {
    const rx = new RegExp(`\\b${facultyKey}\\b`, 'i');
    if (rx.test(lower)) {
      mappedCourse = courseName;
      break;
    }
  }

  if (mappedCourse) {
    return { type: 'Course', course: mappedCourse };
  }

  const firstLine = t.split('\n')[0].replace(/^\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)?\s*(?:to|-)\s*\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)?\s*[-–:]?\s*/i, '').trim();
  return {
    type: 'Course',
    course: firstLine ? capitalize(firstLine) : 'Academic Session',
  };
}

export function extractRoom(text) {
  const m = String(text || '').match(/\b(CDS\s*\d{3}|LT\s*\d|Audi(?:torium)?|Lab\s*\d|Room\s*\d+)\b/i);
  return m ? m[1].replace(/\s+/g, ' ').toUpperCase() : null;
}

function cleanCourseName(raw, fallback) {
  const stripped = raw.split('\n')[0].trim();
  return stripped.length > 3 ? stripped : fallback;
}

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}
