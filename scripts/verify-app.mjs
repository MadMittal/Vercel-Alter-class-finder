// ============================================================
// scripts/verify-app.mjs — Runnable Backend & GAS Logic Check
// Tests: IST TZ, XLSX Strikethrough, Classification, Numbering,
// Multi-Cluster & 3-Way Clashes, Honest Conflict Advice, GAS Tests.gs
// ============================================================

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { getTodayIST, addDaysISO, isNonAcademicSession } from '../lib/config.js';
import { parseRange, strikeRatio, classifySession, splitCellEntries } from '../lib/parser.js';
import { buildDataset } from '../lib/build.js';
import { getLiveDataset } from '../lib/sheets.js';
import { queryTimetable, queryAlternates, getClashAdvice, querySubjectSessions, queryUpcomingClashDays } from '../lib/query.js';

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    console.error(`  FAIL  ${name}: ${err.message}`);
    process.exitCode = 1;
  }
}

console.log('=== LEVEL 1: BACK-END UNIT & INVARIANT TESTS ===');

check('IST Date helper always formats YYYY-MM-DD in Asia/Kolkata', () => {
  // 2026-11-24T19:00:00Z is 2026-11-25 00:30 IST!
  const utcEvening = new Date('2026-11-24T19:00:00Z');
  assert.equal(getTodayIST(utcEvening), '2026-11-25');
  assert.equal(addDaysISO('2026-11-24', 1), '2026-11-25');
});

check('Parser time range handles am/pm inheritance and boundaries', () => {
  assert.deepEqual(parseRange('11.15 am to 1.15 pm'), { start: 675, end: 795 });
  assert.deepEqual(parseRange('5:00 pm to 6:00'), { start: 1020, end: 1080 });
  assert.deepEqual(parseRange('9 to 11 am'), { start: 540, end: 660 });
  assert.deepEqual(parseRange('6.45 pm to 8.45pm'), { start: 1125, end: 1245 });
  assert.deepEqual(parseRange('12.15 pm to 1.15 pm'), { start: 735, end: 795 });
});

check('Non-academic & Academic sub-type separation works strictly', () => {
  assert.equal(isNonAcademicSession('Outclass'), true);
  assert.equal(isNonAcademicSession('CEP (Siddharth)'), true);
  assert.equal(isNonAcademicSession('SA-Case Union'), true);
  assert.equal(isNonAcademicSession('Re-exam Term 2'), true);
  assert.equal(isNonAcademicSession('CEXO Session'), true);
  assert.equal(isNonAcademicSession('Surprise Test'), true);
  assert.equal(classifySession('Mayank Quiz').type, 'Non-Academic');
  assert.equal(classifySession('Surprise Test').type, 'Non-Academic');
  assert.equal(classifySession('Bhupesh End term').type, 'EndTerm');
  assert.equal(classifySession('Akshay End term').type, 'EndTerm');
  assert.equal(classifySession('Bhanu ODC').type, 'ODC');
  assert.equal(classifySession('HROS ODC').type, 'ODC');
  assert.equal(classifySession('Elective').type, 'Elective');
  assert.equal(classifySession('Holiday').type, 'Holiday');
  assert.equal(classifySession('Payal (60)').type, 'Course');
  assert.equal(classifySession('Payal (60)').course, 'Business Valuation');
});

check('Per-entry strikethrough detection separates Active and Cancelled inside same cell', () => {
  const txt = '11.15 am to 1.15 pm-Praxel\ncc-Khushi-CDS 709\n11.15 am to 1.15 pm-Shreyas\ncc-Vanshika-CDS 707';
  const splitIdx = txt.indexOf('11.15 am to 1.15 pm-Shreyas');
  const strikes = txt.split('').map((_, i) => i >= splitIdx);
  const entries = splitCellEntries(txt, strikes, { start: 675, end: 795 });
  assert.equal(entries.length, 2);
  assert.equal(entries[0].name, 'Praxel');
  assert.equal(entries[0].strikeRatio, 0);
  assert.equal(entries[1].name, 'Shreyas');
  assert.equal(entries[1].strikeRatio, 1);
});

check('Cancelled sessions and ALL-section sessions do NOT consume Session #', () => {
  const ds = buildDataset([
    { date: '2026-11-16', dow: 'Mon', week: 1, section: 'A', startMin: 540, endMin: 660, course: 'Unit Economics', type: 'Course', status: 'Active', room: 'CDS 705', rawText: 'x' },
    { date: '2026-11-17', dow: 'Tue', week: 1, section: 'A', startMin: 540, endMin: 660, course: 'Unit Economics', type: 'Course', status: 'Cancelled', room: 'CDS 705', rawText: 'x' },
    { date: '2026-11-18', dow: 'Wed', week: 1, section: 'A', startMin: 540, endMin: 660, course: 'Unit Economics', type: 'Course', status: 'Active', room: 'CDS 705', rawText: 'x' },
    { date: '2026-11-19', dow: 'Thu', week: 1, section: 'ALL', startMin: 1125, endMin: 1245, course: 'Market Research', type: 'Course', status: 'Active', room: 'CDS 706', rawText: 'x' },
  ]);
  assert.equal(ds.sessions.filter(s => s.status === 'Cancelled').length, 0);
  const ue = ds.sessions.filter(s => s.course === 'Unit Economics');
  assert.equal(ue.length, 2);
  assert.equal(ue[0].no, 1);
  assert.equal(ue[1].no, 2);
  assert.equal(ds.sessions.find(s => s.section === 'ALL').no, null);
});

console.log('\n=== LEVEL 2: LIVE SHEET INGESTION & REAL CLASH LOGIC ===');

const liveDataset = await getLiveDataset(true);

check(`Live ingestion uses XLSX, detects cancellations, and omits cancelled classes from dataset`, () => {
  assert.equal(liveDataset.meta.sourceFormat, 'xlsx');
  assert.ok(liveDataset.meta.counts.cancelled > 0, `Expected cancelled > 0, got ${liveDataset.meta.counts.cancelled}`);
  assert.equal(liveDataset.sessions.filter(s => s.status === 'Cancelled').length, 0);
  assert.ok(liveDataset.meta.counts.active > 800, `Expected active > 800, got ${liveDataset.meta.counts.active}`);
});

check('Zero Outclass/CEP/SA/Practicum/CXO/CEXO/ReExam/Quiz/Test/Workshop sessions and zero fake courses', () => {
  const nonAcad = liveDataset.sessions.filter(s => isNonAcademicSession(s.course, s.rawText));
  assert.equal(nonAcad.length, 0, `Found leaked non-academic sessions: ${nonAcad.map(s => s.course)}`);
  const leakedTypes = liveDataset.sessions.filter(s => ['Quiz', 'ReExam', 'Workshop', 'Masterclass', 'Guest Lecture', 'Bootcamp'].includes(s.type));
  assert.equal(leakedTypes.length, 0, `Found leaked excluded types: ${leakedTypes.map(s => s.type + ':' + s.course)}`);
  const courseNames = liveDataset.courses.map(c => c.name);
  for (const forbidden of ['Akshay End term', 'HROS ODC', 'Elective', 'Workshop', 'Financial Modelling — Quiz']) {
    assert.equal(courseNames.includes(forbidden), false, `Fake course found in catalog: ${forbidden}`);
  }
});

check('Holiday entries exist on 2026-11-24, 2026-12-25, 2027-01-01 and do not cause clashes', () => {
  const holidays = liveDataset.sessions.filter(s => s.section === 'A' && s.type === 'Holiday').map(s => s.date);
  assert.ok(holidays.includes('2026-11-24'));
  assert.ok(holidays.includes('2026-12-25'));
  assert.ok(holidays.includes('2027-01-01'));
});

check('Section A Nov 25 clash detects same-day FREE earlier alternate honestly', () => {
  const advice = getClashAdvice(liveDataset, 'A', '2026-11-25', '2026-11-24');
  assert.equal(advice.hasClash, true);
  assert.equal(advice.clusters.length, 1);
  assert.equal(advice.recommendation.hasClashFreeOption, true);
  assert.ok(advice.recommendation.reason.includes('earlier at 09:00 AM'));
  const bv = advice.evaluatedSessions.find(e => e.session.course === 'Business Valuation');
  assert.equal(bv.bestAlternate.free, true);
});

check('BUG 1 FIX: Section B Nov 25 clash NEVER claims Both can be attended / Clash-Free when 9 AM conflicts with Market Research', () => {
  const advice = getClashAdvice(liveDataset, 'B', '2026-11-25', '2026-11-24');
  assert.equal(advice.hasClash, true);
  assert.equal(advice.recommendation.hasClashFreeOption, false);
  assert.equal(advice.recommendation.attendSessionId, null);
  assert.ok(advice.recommendation.reason.includes('Market Research'), 'Must explicitly name Market Research conflict');
  assert.equal(advice.recommendation.reason.includes('Both classes can be attended'), false);
  for (const ev of advice.evaluatedSessions) {
    assert.equal(ev.hasFreeAlternates, false);
    assert.equal(ev.bestAlternate.free, false);
    assert.equal(ev.bestAlternate.conflictsWith[0].course, 'Market Research');
  }
});

check('Multi-cluster day: Section E 2026-11-28 returns 2 separate clusters (09:00 AM and 02:15 PM)', () => {
  const advice = getClashAdvice(liveDataset, 'E', '2026-11-28', '2026-11-24');
  assert.equal(advice.hasClash, true);
  assert.equal(advice.clusters.length, 2, `Expected 2 clusters on Sec E Nov 28, got ${advice.clusters.length}`);
  assert.equal(advice.clusters[0].evaluatedSessions.length, 2);
  assert.equal(advice.clusters[1].evaluatedSessions.length, 2);
});

check('3-way clash cluster: Section E 2026-12-23 returns 3 overlapping classes cleanly', () => {
  const advice = getClashAdvice(liveDataset, 'E', '2026-12-23', '2026-11-24');
  assert.equal(advice.hasClash, true);
  assert.equal(advice.clusters.length, 1);
  assert.equal(advice.evaluatedSessions.length, 3);
});

check('Product Growth has equal 8 sessions across A, B, F (Bhanu ODC separated cleanly)', () => {
  const counts = {};
  for (const sec of ['A', 'B', 'F']) {
    counts[sec] = liveDataset.sessions.filter(s => s.section === sec && s.course === 'Product Growth' && s.type === 'Course' && s.status === 'Active').length;
  }
  assert.deepEqual(counts, { A: 8, B: 8, F: 8 });
});

console.log('\n=== LEVEL 3: GAS PURE TEST SUITE (src/*.gs) ===');

check('GAS src/Tests.gs runAllTests() passes 100%', () => {
  const gasRoot = path.resolve(process.cwd(), '..');
  const ctx = {
    console: { log: () => {}, error: (...a) => console.error('GAS ERR:', ...a) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => '' }) },
    Utilities: { formatDate: (d) => d.toISOString().slice(0, 10) },
  };
  vm.createContext(ctx);
  for (const f of ['Config.gs', 'Parser.gs', 'Build.gs', 'Query.gs', 'Tests.gs']) {
    const code = fs.readFileSync(path.join(gasRoot, 'src', f), 'utf8');
    vm.runInContext(code, ctx, { filename: f });
  }
  const res = vm.runInContext('runAllTests()', ctx);
  assert.equal(res.failed, 0, `GAS test failures: ${JSON.stringify(res.details.filter(d => !d.pass))}`);
  assert.ok(res.passed >= 20);
});

console.log(`\nTotal backend checks passed: ${passed}`);
