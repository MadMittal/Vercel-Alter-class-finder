// ============================================================
// lib/sheets.js — Google Sheets Live Fetcher & XLSX Strike Parser
// Primary: XLSX export (preserves strikethrough cancellations)
// Fallback: Public gviz JSON endpoint
// Refreshes every 5 minutes automatically
// ============================================================

import zlib from 'node:zlib';
import { CFG, SECTIONS, isNonAcademicSession } from './config.js';
import {
  SLOT_TIMES,
  EVENING_SLOT,
  classifySession,
  extractRoom,
  splitCellEntries,
} from './parser.js';
import { buildDataset } from './build.js';

let memoryCache = {
  data: null,
  timestamp: 0,
};

export async function getLiveDataset(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && memoryCache.data && (now - memoryCache.timestamp < CFG.CACHE_TTL_MS)) {
    return memoryCache.data;
  }

  let rawEvents = [];
  let sourceFormat = 'xlsx';
  try {
    rawEvents = await fetchFromPublicXlsx();
  } catch (xlsxErr) {
    console.warn('XLSX fetch failed, falling back to gviz:', xlsxErr.message);
    sourceFormat = 'gviz';
    try {
      rawEvents = await fetchFromPublicGviz();
    } catch (gvizErr) {
      if (memoryCache.data) {
        console.warn('All live fetches failed, serving stale cache:', gvizErr.message);
        return memoryCache.data;
      }
      throw gvizErr;
    }
  }

  if (!rawEvents || rawEvents.length === 0) {
    if (memoryCache.data) return memoryCache.data;
    throw new Error('No timetable sessions could be extracted from Google Sheets.');
  }

  const dataset = buildDataset(rawEvents, {
    version: (memoryCache.data?.meta?.version || 0) + 1,
    sourceFormat,
  });

  memoryCache = { data: dataset, timestamp: now };
  return dataset;
}

// ── Zero-dependency ZIP & XLSX XML readers (Node stdlib only) ─────────────

function unzipFiles(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Invalid XLSX/ZIP buffer');

  const cdCount = buf.readUInt16LE(eocd + 10);
  let pos = buf.readUInt32LE(eocd + 16);
  const files = {};

  for (let i = 0; i < cdCount; i++) {
    if (buf.readUInt32LE(pos) !== 0x02014b50) break;
    const method = buf.readUInt16LE(pos + 10);
    const compSize = buf.readUInt32LE(pos + 20);
    const fnLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const cmtLen = buf.readUInt16LE(pos + 32);
    const localOff = buf.readUInt32LE(pos + 42);
    const name = buf.toString('utf8', pos + 46, pos + 46 + fnLen);
    pos += 46 + fnLen + extraLen + cmtLen;

    const lFnLen = buf.readUInt16LE(localOff + 26);
    const lExLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lFnLen + lExLen;
    const slice = buf.subarray(dataStart, dataStart + compSize);

    if (method === 0) files[name] = slice;
    else if (method === 8) files[name] = zlib.inflateRawSync(slice);
  }
  return files;
}

function decodeXml(str) {
  return String(str || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function getAttr(attrStr, attrName) {
  const m = new RegExp(`(?:^|\\s)${attrName}="([^"]*)"`).exec(attrStr || '');
  return m ? decodeXml(m[1]) : '';
}

function matchXmlElements(xml, tagName) {
  const rx = new RegExp(`<${tagName}\\b([^>]*)\\/>|<${tagName}\\b([^>]*)>([\\s\\S]*?)<\\/${tagName}>`, 'g');
  return [...String(xml || '').matchAll(rx)].map(m => ({
    attrs: m[1] !== undefined ? m[1] : (m[2] || ''),
    inner: m[3] || '',
  }));
}

function hasStrikeTag(xmlBlock) {
  const hits = matchXmlElements(xmlBlock, 'strike');
  if (hits.length === 0) return false;
  const val = getAttr(hits[0].attrs, 'val').toLowerCase();
  return val !== '0' && val !== 'false';
}

function extractRichTextWithStrikes(blockXml) {
  const runs = matchXmlElements(blockXml, 'r');
  if (runs.length > 0) {
    let text = '';
    const strikes = [];
    for (const r of runs) {
      const rPr = matchXmlElements(r.inner, 'rPr')[0]?.inner || '';
      const isStruck = hasStrikeTag(rPr);
      const runTxt = matchXmlElements(r.inner, 't').map(t => decodeXml(t.inner)).join('');
      text += runTxt;
      for (let i = 0; i < runTxt.length; i++) strikes.push(isStruck);
    }
    return { text, strikes };
  }
  const text = matchXmlElements(blockXml, 't').map(t => decodeXml(t.inner)).join('');
  const isStruck = hasStrikeTag(blockXml);
  return { text, strikes: new Array(text.length).fill(isStruck) };
}

function parseStruckStyleIndices(stylesXml) {
  const struckFonts = new Set();
  const fontsBlock = matchXmlElements(stylesXml, 'fonts')[0]?.inner || '';
  matchXmlElements(fontsBlock, 'font').forEach((f, idx) => {
    if (hasStrikeTag(f.inner)) struckFonts.add(idx);
  });

  const struckXfs = new Set();
  const xfsBlock = matchXmlElements(stylesXml, 'cellXfs')[0]?.inner || '';
  matchXmlElements(xfsBlock, 'xf').forEach((xf, idx) => {
    const fId = parseInt(getAttr(xf.attrs, 'fontId') || '-1', 10);
    if (struckFonts.has(fId)) struckXfs.add(idx);
  });
  return struckXfs;
}

function resolveTargetSheetPath(files, desiredSheetName) {
  const wbXml = files['xl/workbook.xml']?.toString('utf8') || '';
  const relsXml = files['xl/_rels/workbook.xml.rels']?.toString('utf8') || '';

  const relMap = {};
  for (const rel of matchXmlElements(relsXml, 'Relationship')) {
    const id = getAttr(rel.attrs, 'Id');
    const target = getAttr(rel.attrs, 'Target');
    if (id && target) relMap[id] = target.replace(/^\/+/, '');
  }

  const norm = s => String(s || '').replace(/[:\s]+/g, '').toLowerCase();
  const wanted = norm(desiredSheetName);
  const sheets = matchXmlElements(wbXml, 'sheet').map(sh => ({
    name: getAttr(sh.attrs, 'name'),
    rid: getAttr(sh.attrs, 'r:id'),
  }));

  const chosen = sheets.find(sh => norm(sh.name) === wanted) || sheets[0];
  if (chosen && relMap[chosen.rid]) {
    const p = relMap[chosen.rid];
    return p.startsWith('xl/') ? p : `xl/${p}`;
  }
  return 'xl/worksheets/sheet1.xml';
}

function colRefToIndex(colLetters) {
  let idx = 0;
  for (let i = 0; i < colLetters.length; i++) {
    idx = idx * 26 + (colLetters.charCodeAt(i) - 64);
  }
  return idx - 1;
}

function excelSerialToISO(rawVal) {
  const s = String(rawVal || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (dmy) {
    const y = parseInt(dmy[3], 10) < 100 ? 2000 + parseInt(dmy[3], 10) : parseInt(dmy[3], 10);
    return `${y}-${String(parseInt(dmy[2], 10)).padStart(2, '0')}-${String(parseInt(dmy[1], 10)).padStart(2, '0')}`;
  }
  const num = parseFloat(s);
  if (!isNaN(num) && num > 30000 && num < 70000) {
    // 25569 = days between 1899-12-30 and 1970-01-01
    return new Date(Math.round((num - 25569) * 86400000)).toISOString().slice(0, 10);
  }
  return null;
}

// Track emitted entries uniformly for both XLSX and GVIZ
function pushParsedEntries({ rawEvents, entries, dateISO, dow, week, sec }) {
  for (const entry of entries) {
    if (isNonAcademicSession(entry.name, entry.raw)) continue;
    const classification = classifySession(entry.name, entry.raw);
    if (classification.type === 'Non-Academic' || classification.type === 'Tentative' || isNonAcademicSession(classification.course, entry.raw)) {
      continue;
    }

    let entrySec = sec;
    if (entrySec === null) {
      const secMatch = /\(([A-H])\)/i.exec(entry.name + ' ' + entry.raw);
      entrySec = secMatch ? secMatch[1].toUpperCase() : 'ALL';
    }

    const isCancelled = (entry.strikeRatio >= CFG.STRIKE_RATIO) || /\bcancel/i.test(entry.raw + ' ' + entry.name);
    rawEvents.push({
      date: dateISO,
      dow,
      week,
      section: entrySec,
      startMin: entry.startMin,
      endMin: entry.endMin,
      course: classification.course,
      type: classification.type,
      status: isCancelled ? 'Cancelled' : 'Active',
      room: classification.type === 'Holiday' ? 'Campus Closed' : extractRoom(entry.raw),
      rawText: entry.raw,
    });
  }
}

export function parseXlsxBuffer(buf, sheetName = CFG.SHEET_NAME) {
  const files = unzipFiles(buf);
  const struckXfs = files['xl/styles.xml']
    ? parseStruckStyleIndices(files['xl/styles.xml'].toString('utf8'))
    : new Set();

  const ssXml = files['xl/sharedStrings.xml']?.toString('utf8') || '';
  const sharedStrings = matchXmlElements(ssXml, 'si').map(si =>
    extractRichTextWithStrikes(si.inner)
  );

  const sheetPath = resolveTargetSheetPath(files, sheetName);
  const sheetXml = files[sheetPath]?.toString('utf8');
  if (!sheetXml) throw new Error(`Missing worksheet XML: ${sheetPath}`);

  const rawEvents = [];
  for (const row of matchXmlElements(sheetXml, 'row')) {
    const rowNum = parseInt(getAttr(row.attrs, 'r') || '0', 10);
    if (rowNum < 4) continue;

    const rowCells = {};
    for (const c of matchXmlElements(row.inner, 'c')) {
      const attrs = c.attrs;
      const inner = c.inner;
      const ref = getAttr(attrs, 'r');
      const colMatch = /^[A-Z]+/.exec(ref);
      if (!colMatch) continue;
      const colIdx = colRefToIndex(colMatch[0]);

      const t = getAttr(attrs, 't');
      const styleIdx = parseInt(getAttr(attrs, 's') || '0', 10);
      const cellStruck = struckXfs.has(styleIdx);

      let text = '';
      let strikes = [];
      if (t === 's') {
        const vTxt = matchXmlElements(inner, 'v')[0]?.inner;
        const sIdx = vTxt !== undefined ? parseInt(vTxt, 10) : -1;
        if (sIdx >= 0 && sharedStrings[sIdx]) {
          text = sharedStrings[sIdx].text;
          strikes = cellStruck ? new Array(text.length).fill(true) : sharedStrings[sIdx].strikes;
        }
      } else if (t === 'inlineStr') {
        const parsed = extractRichTextWithStrikes(inner);
        text = parsed.text;
        strikes = cellStruck ? new Array(text.length).fill(true) : parsed.strikes;
      } else {
        const vTxt = matchXmlElements(inner, 'v')[0]?.inner;
        text = vTxt !== undefined ? decodeXml(vTxt) : '';
        strikes = new Array(text.length).fill(cellStruck);
      }
      rowCells[colIdx] = { text, strikes };
    }

    const dateISO = excelSerialToISO(rowCells[0]?.text);
    if (!dateISO) continue;

    const dowStr = rowCells[1]?.text || '';
    const dow = dowStr.split(/[\s-]+/)[0] || '';
    const weekM = /W(\d+)/i.exec(dowStr);
    const week = weekM ? parseInt(weekM[1], 10) : null;

    for (let sIdx = 0; sIdx < SECTIONS.length; sIdx++) {
      const sec = SECTIONS[sIdx];
      const colStart = 2 + sIdx * 4;
      for (let slot = 0; slot < 4; slot++) {
        const cell = rowCells[colStart + slot];
        if (!cell || cell.text.trim().length < 3) continue;
        const entries = splitCellEntries(cell.text, cell.strikes, SLOT_TIMES[slot]);
        pushParsedEntries({ rawEvents, entries, dateISO, dow, week, sec });
      }
    }

    const evCell = rowCells[34];
    if (evCell && evCell.text.trim().length >= 3) {
      const entries = splitCellEntries(evCell.text, evCell.strikes, EVENING_SLOT);
      pushParsedEntries({ rawEvents, entries, dateISO, dow, week, sec: null });
    }
  }

  return rawEvents;
}

async function fetchFromPublicXlsx() {
  const url = `https://docs.google.com/spreadsheets/d/${CFG.SOURCE_SHEET_ID}/export?format=xlsx`;
  const res = await fetch(url, { next: { revalidate: 300 } });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching XLSX`);
  const arrBuf = await res.arrayBuffer();
  return parseXlsxBuffer(Buffer.from(arrBuf), CFG.SHEET_NAME);
}

async function fetchFromPublicGviz() {
  const url = `https://docs.google.com/spreadsheets/d/${CFG.SOURCE_SHEET_ID}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(CFG.SHEET_NAME)}`;
  const res = await fetch(url, { next: { revalidate: 300 } });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching gviz`);
  const text = await res.text();
  const jsonStr = text.replace(/^[^{]*/, '').replace(/[^}]*$/, '');
  const parsed = JSON.parse(jsonStr);

  const rawEvents = [];
  const rows = parsed.table?.rows || [];

  for (let ri = 0; ri < rows.length; ri++) {
    const c = rows[ri]?.c || [];
    if (!c[0] || !c[0].v) continue;

    let dateISO = null;
    if (c[0].f) {
      dateISO = excelSerialToISO(c[0].f);
    }
    if (!dateISO && typeof c[0].v === 'string') {
      const dm = c[0].v.match(/Date\((\d{4}),\s*(\d{1,2}),\s*(\d{1,2})\)/);
      if (dm) {
        dateISO = `${dm[1]}-${String(Number(dm[2]) + 1).padStart(2, '0')}-${String(dm[3]).padStart(2, '0')}`;
      }
    }
    if (!dateISO) continue;

    const dowStr = c[1]?.v ? String(c[1].v) : '';
    const dow = dowStr.split(/[\s-]+/)[0] || '';
    const weekM = /W(\d+)/i.exec(dowStr);
    const week = weekM ? parseInt(weekM[1], 10) : null;

    for (let sIdx = 0; sIdx < SECTIONS.length; sIdx++) {
      const sec = SECTIONS[sIdx];
      const colStart = 2 + sIdx * 4;
      for (let slot = 0; slot < 4; slot++) {
        const cell = c[colStart + slot];
        if (!cell || !cell.v) continue;
        const cellText = String(cell.v).trim();
        if (cellText.length < 3) continue;
        const entries = splitCellEntries(cellText, [], SLOT_TIMES[slot]);
        pushParsedEntries({ rawEvents, entries, dateISO, dow, week, sec });
      }
    }

    const evCell = c[34];
    if (evCell && evCell.v) {
      const evText = String(evCell.v).trim();
      if (evText.length >= 3) {
        const entries = splitCellEntries(evText, [], EVENING_SLOT);
        pushParsedEntries({ rawEvents, entries, dateISO, dow, week, sec: null });
      }
    }
  }

  return rawEvents;
}
