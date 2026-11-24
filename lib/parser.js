// ============================================================
// lib/parser.js — Pure string, cell, and classification logic
// Shared across live sheet ingestion and unit tests
// ============================================================

import { FACULTY_MAP, CEP_FACULTY, isNonAcademicSession } from './config.js';

export const SLOT_TIMES = [
  { start: 540, end: 660 },   // 09:00 - 11:00
  { start: 675, end: 795 },   // 11:15 - 13:15
  { start: 855, end: 975 },   // 14:15 - 16:15
  { start: 990, end: 1110 },  // 16:30 - 18:30
];
export const EVENING_SLOT = { start: 1125, end: 1245 };

const TIME_LINE_RE = /^\s*(\d{1,2}(?:[.:]\d{2})?\s*(?:am|pm)?\s*to\s*\d{1,2}(?:[.:]\d{2})?\s*(?:am|pm)?)\s*[-–]\s*(.+)$/i;
const TIME_ONLY_RE = /^\s*\d{1,2}(?:[.:]\d{2})?\s*(?:am|pm)?\s*to\s*\d{1,2}(?:[.:]\d{2})?\s*(?:am|pm)?\s*$/i;

function toMinutes(token, ampm) {
  const clean = String(token || '').replace(/am|pm/gi, '').trim().replace(/^(\d{1,2})\.(\d{2})$/, '$1:$2');
  const parts = clean.split(':');
  const h = parseInt(parts[0], 10);
  const m = parts.length > 1 ? parseInt(parts[1], 10) : 0;
  if (isNaN(h) || isNaN(m) || h < 1 || h > 23 || m < 0 || m > 59) return null;
  if (h > 12) return h * 60 + m;
  let h24 = h % 12;
  if (ampm === 'pm') h24 += 12;
  return h24 * 60 + m;
}

/** Parse time range like "11.15 am to 1.15 pm" or "5:00 pm to 6:00" into minutes since midnight. */
export function parseRange(str) {
  if (!str) return null;
  const s = String(str).trim();
  const idx = s.toLowerCase().indexOf(' to ');
  if (idx >= 0) {
    const startStr = s.slice(0, idx).trim();
    const endStr = s.slice(idx + 4).trim();
    const startHasAm = /am/i.test(startStr);
    const startHasPm = /pm/i.test(startStr);
    const endHasAm = /am/i.test(endStr);
    const endHasPm = /pm/i.test(endStr);

    let startAmPm = startHasAm ? 'am' : startHasPm ? 'pm' : null;
    let endAmPm = endHasAm ? 'am' : endHasPm ? 'pm' : null;

    if (!startAmPm && endAmPm) {
      if (endAmPm === 'am') {
        startAmPm = 'am';
      } else {
        const amProbe = toMinutes(startStr, 'am');
        startAmPm = (amProbe !== null && amProbe >= 480) ? 'am' : 'pm';
      }
    } else if (startAmPm && !endAmPm) {
      endAmPm = startAmPm;
    } else if (!startAmPm && !endAmPm) {
      const sProbe = toMinutes(startStr, 'am');
      startAmPm = (sProbe !== null && sProbe >= 480) ? 'am' : 'pm';
      endAmPm = 'pm';
    }

    const startMin = toMinutes(startStr, startAmPm);
    let endMin = toMinutes(endStr, endAmPm);
    if (startMin === null || endMin === null) return null;
    if (endMin <= startMin && startAmPm === 'am' && !endHasAm && !endHasPm) {
      endMin = toMinutes(endStr, 'pm');
    }
    if (endMin === null || endMin <= startMin) return null;
    return { start: startMin, end: endMin };
  }
  return null;
}

/** Fraction of non-whitespace characters marked with strikethrough. */
export function strikeRatio(text, strikeMap) {
  if (!text || !strikeMap || strikeMap.length === 0) return 0.0;
  let nonSpaceTotal = 0;
  let struckTotal = 0;
  const len = Math.min(text.length, strikeMap.length);
  for (let i = 0; i < len; i++) {
    const ch = text[i];
    if (ch !== ' ' && ch !== '\t' && ch !== '\n' && ch !== '\r') {
      nonSpaceTotal++;
      if (strikeMap[i]) struckTotal++;
    }
  }
  return nonSpaceTotal === 0 ? 0.0 : struckTotal / nonSpaceTotal;
}

/** Extract normalized lowercase faculty key from a display string. */
export function facultyKey(name) {
  const cleaned = String(name || '')
    .replace(/\([^)]*\)/g, '')
    .trim()
    .replace(/^dr\.?\s+/i, '')
    .trim();
  return (cleaned.split(/[\s,\-]+/)[0] || '').toLowerCase();
}

function resolveFacultyCourse(name, lowerFull) {
  const fKey = facultyKey(name);
  if (FACULTY_MAP[fKey]) return FACULTY_MAP[fKey];
  for (const [key, cName] of Object.entries(FACULTY_MAP)) {
    const rx = new RegExp(`\\b${key}\\b`, 'i');
    if (rx.test(lowerFull)) return cName;
  }
  return null;
}

/** Classify a session entry into structured { type, course } cleanly separating exams, quizzes, ODCs, electives, holidays, and regular courses. */
export function classifySession(rawName, rawText = '') {
  const name = String(rawName || '').trim();
  const full = (name + ' ' + String(rawText || '')).trim();
  const lower = full.toLowerCase();

  if (isNonAcademicSession(name, rawText)) {
    return { type: 'Non-Academic', course: 'Non-Academic' };
  }
  if (/^\s*holiday\s*$/i.test(name) || /\bholiday\b/i.test(name)) {
    return { type: 'Holiday', course: 'Holiday' };
  }
  if (/^tenta[ti]/i.test(name) || /\breserved\s+for\s+end/i.test(name)) {
    return { type: 'Tentative', course: 'Tentative' };
  }
  if (/\bterm\s*break\b/i.test(full)) {
    return { type: 'Term Break', course: 'Term Break' };
  }

  for (const cep of CEP_FACULTY) {
    if (new RegExp(`\\b${cep}\\b`, 'i').test(lower)) {
      return { type: 'Non-Academic', course: 'Non-Academic' };
    }
  }

  // Separate graded evaluations & ODCs BEFORE FACULTY_MAP so they never inflate Course Session #s
  if (/\bend\s*[-]?\s*term|\bendterm\b/i.test(name)) {
    const subj = resolveFacultyCourse(name, lower);
    const label = subj ? `${subj} — End Term` : capitalize(name.replace(/\bend\s*term/i, 'End Term').trim());
    return { type: 'EndTerm', course: label };
  }
  if (/\bquiz\b/i.test(name)) {
    const subj = resolveFacultyCourse(name, lower);
    const label = subj ? `${subj} — Quiz` : capitalize(name);
    return { type: 'Quiz', course: label };
  }
  if (/\bodc\b/i.test(name)) {
    const subj = resolveFacultyCourse(name, lower);
    const clean = name.replace(/\bodc\b/i, '').trim();
    const label = subj ? `${subj} ODC` : (clean ? `${clean} ODC` : 'ODC');
    return { type: 'ODC', course: label };
  }
  if (/\bworkshop\b/i.test(full)) {
    return { type: 'Workshop', course: capitalize(name) || 'Workshop' };
  }
  if (/\bmasterclass\b/i.test(full)) {
    return { type: 'Masterclass', course: capitalize(name) || 'Masterclass' };
  }
  if (/\bguest\s*lecture\b/i.test(full)) {
    return { type: 'Guest Lecture', course: capitalize(name) || 'Guest Lecture' };
  }
  if (/\bbootcamp\b/i.test(full)) {
    return { type: 'Bootcamp', course: capitalize(name) || 'Bootcamp' };
  }
  if (/^elective\b/i.test(name)) {
    return { type: 'Elective', course: 'Elective' };
  }
  if (/\bout\s*of\s*class\b/i.test(full) || /\bactivity\b/i.test(full)) {
    return { type: 'Out of Class Activity', course: 'Out of Class Activity' };
  }

  const mappedCourse = resolveFacultyCourse(name, lower);
  if (mappedCourse) {
    return { type: 'Course', course: mappedCourse };
  }

  const cleanName = name.replace(/^[-–:]\s*/, '').trim();
  return { type: 'Course', course: cleanName ? capitalize(cleanName) : 'Academic Class' };
}

/** Extract room identifier from continuation/raw cell text. */
export function extractRoom(raw) {
  const m = /\b(CDS\s*\d+|C\.\s*\d+|LT\s*\d+|Lab\s*\d+|Room\s*\d+)\b/i.exec(String(raw || ''));
  return m ? m[1].replace(/\s+/g, ' ').trim().toUpperCase() : 'TBD';
}

/** Split one cell (with optional per-character strikethrough flags) into parsed session entries. */
export function splitCellEntries(text, strikeArr, slot) {
  const str = String(text || '');
  const strikes = Array.isArray(strikeArr) ? strikeArr : [];
  const lines = str.split('\n');
  const entries = [];
  let cur = null;
  let charPos = 0;

  const finalize = () => {
    if (!cur || !cur.name || cur.name.length < 2) return;
    const raw = str.slice(cur.charStart, cur.charEnd);
    const slice = strikes.slice(cur.charStart, cur.charEnd);
    entries.push({
      name: cur.name,
      raw,
      startMin: cur.startMin,
      endMin: cur.endMin,
      strikeRatio: strikeRatio(raw, slice),
      untimed: cur.untimed || false,
    });
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineStart = charPos;
    const lineEnd = charPos + line.length;
    charPos = lineEnd + (i < lines.length - 1 ? 1 : 0);

    if (TIME_ONLY_RE.test(line)) {
      finalize();
      cur = null;
      continue;
    }

    const tm = TIME_LINE_RE.exec(line);
    if (tm) {
      finalize();
      const range = parseRange(tm[1]);
      cur = {
        name: tm[2].trim(),
        charStart: lineStart,
        charEnd: lineEnd,
        startMin: range ? range.start : slot.start,
        endMin: range ? range.end : slot.end,
        untimed: false,
      };
    } else if (cur && line.trim()) {
      cur.charEnd = lineEnd;
    } else if (!cur && /^\s*holiday\s*$/i.test(line)) {
      cur = {
        name: 'Holiday',
        charStart: lineStart,
        charEnd: lineEnd,
        startMin: slot.start,
        endMin: slot.end,
        untimed: true,
      };
    }
  }

  finalize();
  return entries;
}

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}
