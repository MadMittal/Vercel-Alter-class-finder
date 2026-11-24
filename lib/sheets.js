// ============================================================
// lib/sheets.js — Google Sheets Live Fetcher & Engine
// Refreshes every 5 minutes automatically
// ============================================================

import { CFG, SECTIONS, FACULTY_MAP, CEP_FACULTY, isNonAcademicSession } from './config.js';
import { buildDataset } from './build.js';

let memoryCache = {
  data: null,
  timestamp: 0,
};

const SLOT_TIMES = [
  { start: 540, end: 660 },   // 09:00 - 11:00
  { start: 675, end: 795 },   // 11:15 - 13:15
  { start: 855, end: 975 },   // 14:15 - 16:15
  { start: 990, end: 1110 },  // 16:30 - 18:30
];
const EVENING_SLOT = { start: 1110, end: 1230 };

const TIME_LINE_RE = /^\s*(\d{1,2}(?:[.:]\d{2})?\s*(?:am|pm)?\s*to\s*\d{1,2}(?:[.:]\d{2})?\s*(?:am|pm)?)\s*[-–]\s*(.+)$/i;
const TIME_ONLY_RE = /^\s*\d{1,2}(?:[.:]\d{2})?\s*(?:am|pm)?\s*to\s*\d{1,2}(?:[.:]\d{2})?\s*(?:am|pm)?\s*$/i;

function toMin(token, ampm) {
  token = token.replace(/am|pm/gi, '').trim().replace(/^(\d{1,2})\.(\d{2})$/, '$1:$2');
  let h = token.includes(':') ? parseInt(token.split(':')[0], 10) : parseInt(token, 10);
  let m = token.includes(':') ? parseInt(token.split(':')[1], 10) : 0;
  if (isNaN(h) || isNaN(m)) return null;
  if (ampm === 'pm' && h !== 12) h += 12;
  if (ampm === 'am' && h === 12) h = 0;
  return h * 60 + m;
}

function parseRange(rangeStr) {
  const idx = rangeStr.toLowerCase().indexOf(' to ');
  if (idx < 0) return null;
  const startStr = rangeStr.slice(0, idx).trim();
  const endStr = rangeStr.slice(idx + 4).trim();
  let startAmPm = /am/i.test(startStr) ? 'am' : (/pm/i.test(startStr) ? 'pm' : null);
  let endAmPm = /am/i.test(endStr) ? 'am' : (/pm/i.test(endStr) ? 'pm' : null);
  if (!startAmPm && endAmPm) startAmPm = (endAmPm === 'am' || toMin(startStr, 'am') >= 480) ? 'am' : 'pm';
  if (startAmPm && !endAmPm) endAmPm = startAmPm;
  let startMin = toMin(startStr, startAmPm);
  let endMin = toMin(endStr, endAmPm);
  if (startMin === null || endMin === null) return null;
  if (endMin <= startMin && startAmPm === 'am' && !/am/i.test(endStr)) endMin = toMin(endStr, 'pm');
  if (endMin === null || endMin <= startMin) return null;
  return { start: startMin, end: endMin };
}

function extractRoom(raw) {
  const m = /\b(CDS\s*\d+|C\.\s*\d+|LT\s*\d|Lab\s*\d)\b/i.exec(raw);
  return m ? m[1].replace(/\s+/g, ' ').trim().toUpperCase() : 'TBD';
}

function facultyKey(name) {
  name = name.replace(/\([^)]*\)/g, '').trim();
  name = name.replace(/^dr\.?\s+/i, '').trim();
  return (name.split(/[\s,\-]+/)[0] || '').toLowerCase();
}

function classify(rawName, rawText) {
  if (isNonAcademicSession(rawName, rawText)) {
    return { type: 'Non-Academic', course: 'Non-Academic' };
  }

  const t = (rawName + ' ' + rawText).trim();
  const lower = t.toLowerCase();

  if (/\bterm\s*break\b/i.test(t)) return { type: 'Term Break', course: 'Term Break' };
  if (/\bworkshop\b/i.test(t)) return { type: 'Workshop', course: 'Workshop' };
  if (/\bmasterclass\b/i.test(t)) return { type: 'Masterclass', course: 'Masterclass' };
  if (/\bguest\s*lecture\b/i.test(t)) return { type: 'Guest Lecture', course: 'Guest Lecture' };
  if (/\bbootcamp\b/i.test(t)) return { type: 'Bootcamp', course: 'Bootcamp' };

  const fKey = facultyKey(rawName);
  for (const cep of CEP_FACULTY) {
    if (fKey === cep || lower.includes(cep)) {
      return {
        type: 'Non-in-class Academic Session',
        course: `CEP Session - ${capitalize(cep)}`,
      };
    }
  }

  if (/\bout\s*of\s*class\b/i.test(t) || /\bactivity\b/i.test(t)) {
    return { type: 'Out of Class Activity', course: 'Out of Class Activity' };
  }

  // Lookup in Faculty Map
  if (FACULTY_MAP[fKey]) {
    return { type: 'Course', course: FACULTY_MAP[fKey] };
  }

  // Check any faculty match in rawName
  for (const [key, cName] of Object.entries(FACULTY_MAP)) {
    if (lower.includes(key)) {
      return { type: 'Course', course: cName };
    }
  }

  const cleanName = rawName.replace(/^[-–:]\s*/, '').trim();
  return { type: 'Course', course: cleanName ? capitalize(cleanName) : 'Academic Class' };
}

function capitalize(s) {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function splitEntries(text, slot) {
  const lines = text.split('\n');
  const entries = [];
  let cur = null;
  for (const line of lines) {
    if (TIME_ONLY_RE.test(line)) {
      if (cur && cur.name && cur.name.length >= 2) entries.push(cur);
      cur = null;
      continue;
    }
    const tm = TIME_LINE_RE.exec(line);
    if (tm) {
      if (cur && cur.name && cur.name.length >= 2) entries.push(cur);
      const range = parseRange(tm[1]);
      cur = {
        name: tm[2].trim(),
        raw: line,
        startMin: range ? range.start : slot.start,
        endMin: range ? range.end : slot.end,
      };
    } else if (cur && line.trim()) {
      cur.raw += '\n' + line;
    }
  }
  if (cur && cur.name && cur.name.length >= 2) entries.push(cur);
  return entries;
}

export async function getLiveDataset(forceRefresh = false) {
  const now = Date.now();
  // Cached for 5 minutes (300,000 ms)
  if (!forceRefresh && memoryCache.data && (now - memoryCache.timestamp < CFG.CACHE_TTL_MS)) {
    return memoryCache.data;
  }

  try {
    const rawEvents = await fetchFromPublicGviz();
    if (!rawEvents || rawEvents.length === 0) {
      if (memoryCache.data) return memoryCache.data;
      throw new Error('No timetable sessions could be extracted from Google Sheets.');
    }

    const dataset = buildDataset(rawEvents, {
      version: (memoryCache.data?.meta?.version || 0) + 1,
    });

    memoryCache = {
      data: dataset,
      timestamp: now,
    };
    return dataset;
  } catch (err) {
    if (memoryCache.data) {
      console.warn('Fetch failed, serving stale cache:', err.message);
      return memoryCache.data;
    }
    throw err;
  }
}

async function fetchFromPublicGviz() {
  const url = `https://docs.google.com/spreadsheets/d/${CFG.SOURCE_SHEET_ID}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(CFG.SHEET_NAME)}`;
  const res = await fetch(url, { next: { revalidate: 300 } });
  const text = await res.text();
  const jsonStr = text.replace(/^[^{]*/, '').replace(/[^}]*$/, '');
  const parsed = JSON.parse(jsonStr);

  const rawEvents = [];
  const rows = parsed.table?.rows || [];

  for (let ri = 0; ri < rows.length; ri++) {
    const r = rows[ri];
    const c = r?.c || [];
    if (!c[0] || !c[0].v) continue;

    // Parse date from Date(yyyy, m, d) or formatted string
    let dateISO = null;
    if (c[0].f) {
      const dmy = String(c[0].f).trim().match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
      if (dmy) {
        const d = parseInt(dmy[1], 10);
        const m = parseInt(dmy[2], 10);
        let y = parseInt(dmy[3], 10);
        if (y < 100) y += 2000;
        dateISO = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      }
    }
    if (!dateISO && typeof c[0].v === 'string') {
      const dm = c[0].v.match(/Date\((\d{4}),\s*(\d{1,2}),\s*(\d{1,2})\)/);
      if (dm) {
        const y = dm[1];
        const m = String(Number(dm[2]) + 1).padStart(2, '0');
        const d = String(dm[3]).padStart(2, '0');
        dateISO = `${y}-${m}-${d}`;
      }
    }
    if (!dateISO) continue;

    const dowStr = c[1]?.v ? String(c[1].v) : '';
    const dow = dowStr.split(/[\s-]+/)[0] || 'Wed';
    const weekM = /W(\d+)/i.exec(dowStr);
    const week = weekM ? parseInt(weekM[1], 10) : null;

    // 8 Sections (A to H), 4 slots each starting at column index 2
    for (let sIdx = 0; sIdx < SECTIONS.length; sIdx++) {
      const sec = SECTIONS[sIdx];
      const colStart = 2 + sIdx * 4;

      for (let slot = 0; slot < 4; slot++) {
        const cell = c[colStart + slot];
        if (!cell || !cell.v) continue;

        const cellText = String(cell.v).trim();
        if (!cellText || cellText.length < 3) continue;

        const entries = splitEntries(cellText, SLOT_TIMES[slot]);
        for (const entry of entries) {
          if (isNonAcademicSession(entry.name, entry.raw)) continue;
          const classification = classify(entry.name, entry.raw);
          if (classification.type === 'Non-Academic' || isNonAcademicSession(classification.course, entry.raw)) continue;
          const room = extractRoom(entry.raw);
          const isCancelled = /\bcancel|\bholiday/i.test(entry.raw + ' ' + entry.name);

          rawEvents.push({
            date: dateISO,
            dow: dow,
            week: week,
            section: sec,
            startMin: entry.startMin,
            endMin: entry.endMin,
            course: classification.course,
            type: classification.type,
            status: isCancelled ? 'Cancelled' : 'Active',
            room: room,
            rawText: entry.raw,
          });
        }
      }
    }

    // Evening Slot (Column 34 / index 34)
    const evCell = c[34];
    if (evCell && evCell.v) {
      const evText = String(evCell.v).trim();
      if (evText.length >= 3) {
        const entries = splitEntries(evText, EVENING_SLOT);
        for (const entry of entries) {
          if (isNonAcademicSession(entry.name, entry.raw)) continue;
          const classification = classify(entry.name, entry.raw);
          if (classification.type === 'Non-Academic' || isNonAcademicSession(classification.course, entry.raw)) continue;
          const secMatch = /\(([A-H])\)/i.exec(entry.name + ' ' + entry.raw);
          const entrySec = secMatch ? secMatch[1].toUpperCase() : 'ALL';
          const room = extractRoom(entry.raw);

          rawEvents.push({
            date: dateISO,
            dow: dow,
            week: week,
            section: entrySec,
            startMin: entry.startMin,
            endMin: entry.endMin,
            course: classification.course,
            type: classification.type,
            status: 'Active',
            room: room,
            rawText: entry.raw,
          });
        }
      }
    }
  }

  return rawEvents;
}
