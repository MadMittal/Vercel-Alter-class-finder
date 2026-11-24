// ============================================================
// lib/build.js — Deduplication, Numbering & Merged Groups
// Adheres strictly to BRL-01..05 & Spec Section 5.4
// ============================================================

import { isNonAcademicSession } from './config.js';

export function buildDataset(rawEvents, metadata = {}) {
  // Filter out any non-academic or tentative sessions
  rawEvents = (rawEvents || []).filter(
    e => e.type !== 'Non-Academic' && e.type !== 'Tentative' && !isNonAcademicSession(e.course, e.rawText)
  );

  // 1. Deduplication (Active beats Cancelled; full-day Holiday deduped per section+date)
  const slotMap = new Map();
  for (const e of rawEvents) {
    const key = e.type === 'Holiday'
      ? `${e.section}|${e.date}|Holiday`
      : `${e.section}|${e.date}|${e.startMin}|${e.endMin}|${e.course}`;
    if (!slotMap.has(key)) {
      slotMap.set(key, e);
    } else {
      const existing = slotMap.get(key);
      if (existing.status === 'Cancelled' && e.status === 'Active') {
        slotMap.set(key, e);
      }
    }
  }
  const deduplicated = Array.from(slotMap.values());

  // 2. Chronological sort
  deduplicated.sort((a, b) => {
    return (
      a.date.localeCompare(b.date) ||
      a.startMin - b.startMin ||
      (a.section || '').localeCompare(b.section || '')
    );
  });

  // 3. Sequential Session Numbering per (section, course)
  // BRL-02: Only Active Course entries for real sections A-H get sequential numbers
  // Cancelled sessions & ALL-section events MUST NOT consume a session number!
  const counters = new Map();
  for (const e of deduplicated) {
    if (e.type !== 'Course' || e.status !== 'Active' || e.section === 'ALL') {
      e.no = null;
      continue;
    }
    const key = `${e.section}|${e.course}`;
    const nextNo = (counters.get(key) || 0) + 1;
    counters.set(key, nextNo);
    e.no = nextNo;
  }

  // 4. Group merged sessions across sections
  const groupMap = {};
  for (const e of deduplicated) {
    const key = `${e.date}|${e.startMin}|${e.endMin}|${e.course}`;
    if (!groupMap[key]) {
      groupMap[key] = `grp_${e.date}_${e.startMin}_${e.course.replace(/\s+/g, '_')}`;
    }
    e.groupId = groupMap[key];
  }

  // 5. Generate stable, unique IDs
  const usedIds = new Set();
  for (const e of deduplicated) {
    const dStr = e.date.replace(/-/g, '');
    const cSlug = e.course.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8);
    const base = `${dStr}_${e.startMin}_${e.section}_${cSlug}`;
    let id = base;
    let seq = 1;
    while (usedIds.has(id)) {
      id = `${base}_${seq++}`;
    }
    usedIds.add(id);
    e.id = id;
  }

  // 6. Aggregate course catalog (Courses only) & strip Cancelled sessions before returning
  const cancelledCount = deduplicated.filter(s => s.status === 'Cancelled').length;
  const activeOnly = deduplicated.filter(s => s.status !== 'Cancelled');

  const courseCounts = {};
  let minDate = null;
  let maxDate = null;
  for (const e of activeOnly) {
    if (!minDate || e.date < minDate) minDate = e.date;
    if (!maxDate || e.date > maxDate) maxDate = e.date;
    if (e.type === 'Course' && e.status === 'Active' && e.no) {
      courseCounts[e.course] = Math.max(courseCounts[e.course] || 0, e.no);
    }
  }
  const courses = Object.keys(courseCounts)
    .sort()
    .map(name => ({ name, maxNo: courseCounts[name] }));

  return {
    meta: {
      version: metadata.version || 1,
      sourceFormat: metadata.sourceFormat || 'unknown',
      generatedAt: new Date().toISOString(),
      minDate,
      maxDate,
      counts: {
        raw: rawEvents.length,
        sessions: activeOnly.length,
        active: activeOnly.filter(s => s.status === 'Active' && s.type !== 'Holiday').length,
        cancelled: cancelledCount,
      },
    },
    courses,
    sessions: activeOnly,
  };
}
