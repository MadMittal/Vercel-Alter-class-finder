// ============================================================
// lib/build.js — Deduplication, Numbering & Merged Groups
// Adheres strictly to BRL-01..05 & Spec Section 5.4
// ============================================================

import { SECTIONS } from './config.js';

export function buildDataset(rawEvents, metadata = {}) {
  // 1. Deduplication (Active beats Cancelled)
  const slotMap = new Map();
  for (const e of rawEvents) {
    const key = `${e.section}|${e.date}|${e.startMin}|${e.endMin}|${e.course}`;
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
  // BRL-02: Cancelled sessions MUST NOT consume a session number!
  const counters = new Map();
  for (const e of deduplicated) {
    if (e.type !== 'Course') {
      e.no = null;
      continue;
    }
    const key = `${e.section}|${e.course}`;
    if (e.status === 'Cancelled') {
      e.no = null;
    } else {
      const current = counters.get(key) || 0;
      const nextNo = current + 1;
      counters.set(key, nextNo);
      e.no = nextNo;
    }
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
    let base = `${dStr}_${e.startMin}_${e.section}_${cSlug}`;
    let id = base;
    let seq = 1;
    while (usedIds.has(id)) {
      id = `${base}_${seq++}`;
    }
    usedIds.add(id);
    e.id = id;
  }

  // 6. Aggregate course catalog
  const courseCounts = {};
  for (const e of deduplicated) {
    if (e.type === 'Course' && e.status === 'Active' && e.no) {
      courseCounts[e.course] = Math.max(courseCounts[e.course] || 0, e.no);
    }
  }
  const courses = Object.keys(courseCounts)
    .sort()
    .map(name => ({ name: name, maxNo: courseCounts[name] }));

  return {
    meta: {
      version: metadata.version || 1,
      generatedAt: new Date().toISOString(),
      counts: {
        raw: rawEvents.length,
        sessions: deduplicated.length,
        active: deduplicated.filter(s => s.status === 'Active').length,
        cancelled: deduplicated.filter(s => s.status === 'Cancelled').length,
      },
    },
    courses: courses,
    sessions: deduplicated,
  };
}
