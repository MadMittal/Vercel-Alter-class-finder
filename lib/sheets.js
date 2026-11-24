// ============================================================
// lib/sheets.js — Google Sheets API v4 Fetcher & Strikethrough Parser
// ============================================================

import { google } from 'googleapis';
import { CFG, SECTIONS } from './config.js';
import { parseRange, classifySession, extractRoom, strikeRatio } from './parser.js';
import { buildDataset } from './build.js';

let memoryCache = {
  data: null,
  timestamp: 0,
};

// Column bounds mapping according to Handover Pack Section 4:
// Section A: C..F, B: G..J, C: K..N, D: O..R, E: S..V, F: W..Z, G: AA..AD, H: AE..AH
const SECTION_COLS = {
  'A': [2, 3, 4, 5],
  'B': [6, 7, 8, 9],
  'C': [10, 11, 12, 13],
  'D': [14, 15, 16, 17],
  'E': [18, 19, 20, 21],
  'F': [22, 23, 24, 25],
  'G': [26, 27, 28, 29],
  'H': [30, 31, 32, 33],
};

export async function getLiveDataset(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && memoryCache.data && (now - memoryCache.timestamp < CFG.CACHE_TTL_MS)) {
    return memoryCache.data;
  }

  try {
    let rawEvents = [];

    // Check for Google Service Account credentials
    if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
      rawEvents = await fetchFromGoogleSheetsApi();
    } else if (process.env.APPS_SCRIPT_BACKUP_URL) {
      rawEvents = await fetchFromAppsScriptBackup();
    } else {
      // If credentials are not yet configured, attempt public gviz fetch
      rawEvents = await fetchFromPublicGviz();
    }

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

async function fetchFromGoogleSheetsApi() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });

  const sheets = google.sheets({ version: 'v4', auth });
  const res = await sheets.spreadsheets.get({
    spreadsheetId: CFG.SOURCE_SHEET_ID,
    ranges: [`'${CFG.SHEET_NAME}'!A1:AI75`],
    fields: 'sheets(data/rowData/values(formattedValue,textFormatRuns))',
  });

  const rowData = res.data.sheets?.[0]?.data?.[0]?.rowData || [];
  return parseRowData(rowData);
}

function parseRowData(rowData) {
  const rawEvents = [];
  const totalRows = rowData.length;

  for (let r = 2; r < totalRows; r++) { // Data starts at Row 3 (index 2)
    const row = rowData[r]?.values || [];
    const dateCell = row[0]?.formattedValue || '';
    const dowCell = row[1]?.formattedValue || '';

    const dateISO = normalizeDate(dateCell);
    if (!dateISO) continue;

    for (const [sec, colIndexes] of Object.entries(SECTION_COLS)) {
      for (const colIdx of colIndexes) {
        const cell = row[colIdx];
        if (!cell || !cell.formattedValue) continue;

        const text = cell.formattedValue.trim();
        if (!text || text.length < 3) continue;

        // Build character strike map from textFormatRuns
        const strikeMap = new Array(text.length).fill(false);
        const runs = cell.textFormatRuns || [];
        for (let i = 0; i < runs.length; i++) {
          const run = runs[i];
          const start = run.startIndex || 0;
          const end = (i + 1 < runs.length && runs[i + 1].startIndex !== undefined)
            ? runs[i + 1].startIndex
            : text.length;
          const isStruck = !!run.format?.strikethrough;
          if (isStruck) {
            for (let j = start; j < Math.min(end, text.length); j++) {
              strikeMap[j] = true;
            }
          }
        }

        const isCancelled = strikeRatio(text, strikeMap) >= 0.50;
        const range = parseRange(text);
        if (!range) continue;

        const classification = classifySession(text);
        const room = extractRoom(text);

        rawEvents.push({
          date: dateISO,
          dow: dowCell || 'Wednesday',
          section: sec,
          startMin: range.start,
          endMin: range.end,
          course: classification.course,
          type: classification.type,
          status: isCancelled ? 'Cancelled' : 'Active',
          room: room,
          rawText: text,
        });
      }
    }
  }
  return rawEvents;
}

async function fetchFromAppsScriptBackup() {
  const url = process.env.APPS_SCRIPT_BACKUP_URL;
  const res = await fetch(url, { headers: { 'User-Agent': 'Vercel-Node' } });
  const json = await res.json();
  if (json.ok && json.data && json.data.sessions) {
    return json.data.sessions;
  }
  return [];
}

async function fetchFromPublicGviz() {
  const url = `https://docs.google.com/spreadsheets/d/${CFG.SOURCE_SHEET_ID}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(CFG.SHEET_NAME)}`;
  const res = await fetch(url);
  const text = await res.text();
  const jsonStr = text.replace(/^[^{]*/, '').replace(/[^}]*$/, '');
  const parsed = JSON.parse(jsonStr);

  const rawEvents = [];
  const rows = parsed.table?.rows || [];

  for (let r = 2; r < rows.length; r++) {
    const row = rows[r]?.c || [];
    const dateCell = row[0]?.v || '';
    const dowCell = row[1]?.v || '';

    const dateISO = normalizeDate(String(dateCell));
    if (!dateISO) continue;

    for (const [sec, colIndexes] of Object.entries(SECTION_COLS)) {
      for (const colIdx of colIndexes) {
        const cell = row[colIdx];
        if (!cell || !cell.v) continue;

        const cellText = String(cell.v).trim();
        if (!cellText || cellText.length < 3) continue;

        const range = parseRange(cellText);
        if (!range) continue;

        const classification = classifySession(cellText);
        const room = extractRoom(cellText);

        rawEvents.push({
          date: dateISO,
          dow: dowCell || 'Wednesday',
          section: sec,
          startMin: range.start,
          endMin: range.end,
          course: classification.course,
          type: classification.type,
          status: 'Active',
          room: room,
          rawText: cellText,
        });
      }
    }
  }
  return rawEvents;
}

function normalizeDate(val) {
  if (!val) return null;
  const str = String(val).trim();
  const isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) return str;

  const dmyMatch = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (dmyMatch) {
    const d = parseInt(dmyMatch[1], 10);
    const m = parseInt(dmyMatch[2], 10);
    let y = parseInt(dmyMatch[3], 10);
    if (y < 100) y += 2000;
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  return null;
}
