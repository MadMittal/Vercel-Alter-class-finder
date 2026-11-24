// ============================================================
// lib/query.js — Timetable queries, Clash detection & Alternates
// Adheres strictly to BRL-06..10
// ============================================================

import { SECTIONS, HARD_BLOCKING } from './config.js';

export function toPublicSession(s) {
  return {
    id:       s.id,
    date:     s.date,
    dow:      s.dow,
    week:     s.week,
    section:  s.section,
    startMin: s.startMin,
    endMin:   s.endMin,
    timeFormatted: formatMinTo12h(s.startMin) + ' – ' + formatMinTo12h(s.endMin),
    course:   s.course,
    no:       s.no,
    room:     s.room || 'TBD',
    type:     s.type,
    status:   s.status,
    groupId:  s.groupId,
  };
}

export function formatTime(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function formatMinTo12h(min) {
  let h = Math.floor(min / 60);
  const m = min % 60;
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} ${ampm}`;
}

export function intervalsOverlap(s1, e1, s2, e2) {
  return s1 < e2 && s2 < e1;
}

export function daysDiff(d1, d2) {
  const [y1, m1, day1] = d1.split('-').map(Number);
  const [y2, m2, day2] = d2.split('-').map(Number);
  const utc1 = Date.UTC(y1, m1 - 1, day1);
  const utc2 = Date.UTC(y2, m2 - 1, day2);
  return Math.round((utc2 - utc1) / 86400000);
}

export function getStudentSchedule(sessions, section, excludeSessionId) {
  return sessions.filter(s => {
    if (s.id === excludeSessionId) return false;
    if (s.status !== 'Active') return false;
    if (!HARD_BLOCKING.has(s.type)) return false;
    return s.section === section || s.section === 'ALL';
  });
}

export function queryTimetable(dataset, section, fromISO, toISO) {
  if (!SECTIONS.includes(section)) {
    throw new Error(`Invalid section: ${section}`);
  }

  const inRange = dataset.sessions.filter(s => {
    if (s.section !== section && s.section !== 'ALL') return false;
    if (s.date < fromISO || s.date > toISO) return false;
    return true;
  });

  const clashesMap = detectClashesMap(dataset.sessions, section, fromISO, toISO);
  const daysMap = new Map();

  for (const s of inRange) {
    if (!daysMap.has(s.date)) {
      daysMap.set(s.date, {
        date: s.date,
        dow: s.dow,
        week: s.week,
        hasClash: false,
        sessions: [],
      });
    }
    const day = daysMap.get(s.date);
    const dayClashingIds = clashesMap[s.date] || new Set();
    const isClashing = dayClashingIds.has(s.id);
    if (isClashing) day.hasClash = true;

    day.sessions.push({
      ...toPublicSession(s),
      isClashing: isClashing,
    });
  }

  const days = Array.from(daysMap.values());
  days.sort((a, b) => a.date.localeCompare(b.date));
  days.forEach(d => {
    d.sessions.sort((a, b) => a.startMin - b.startMin);
  });
  return days;
}

export function detectClashesMap(sessions, section, fromISO, toISO) {
  const result = {};
  const activeHard = sessions.filter(s => {
    if (s.status !== 'Active') return false;
    if (!HARD_BLOCKING.has(s.type)) return false;
    if (s.date < fromISO || s.date > toISO) return false;
    return s.section === section || s.section === 'ALL';
  });

  const byDate = new Map();
  for (const s of activeHard) {
    if (!byDate.has(s.date)) byDate.set(s.date, []);
    byDate.get(s.date).push(s);
  }

  for (const [date, list] of byDate.entries()) {
    const clashingIds = new Set();
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        if (intervalsOverlap(a.startMin, a.endMin, b.startMin, b.endMin)) {
          clashingIds.add(a.id);
          clashingIds.add(b.id);
        }
      }
    }
    if (clashingIds.size > 0) {
      result[date] = clashingIds;
    }
  }
  return result;
}

export function queryAlternates(dataset, section, sessionId, opts = {}) {
  const showPast = opts.showPast || false;
  const todayISO = opts.todayISO || new Date().toISOString().slice(0, 10);

  const skipped = dataset.sessions.find(s => s.id === sessionId);
  if (!skipped) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  if (skipped.type !== 'Course' || !skipped.no) {
    return {
      skipped: toPublicSession(skipped),
      rows: [],
      reason: 'NON_COURSE',
      message: 'Alternates are only available for academic courses with session numbers.',
    };
  }

  const candidates = dataset.sessions.filter(s => {
    if (s.course !== skipped.course) return false;
    if (s.no !== skipped.no) return false;
    if (s.status !== 'Active') return false;
    if (s.groupId === skipped.groupId) return false;
    if (s.section === section) return false;
    if (!showPast && s.date < todayISO) return false;
    return true;
  });

  if (candidates.length === 0) {
    return {
      skipped: toPublicSession(skipped),
      rows: [],
      reason: 'NO_COPIES',
      message: `No other section is offering Session #${skipped.no} of "${skipped.course}".`,
    };
  }

  const groupMap = new Map();
  for (const c of candidates) {
    const gKey = c.groupId || `${c.date}|${c.startMin}|${c.endMin}|${c.room}`;
    if (!groupMap.has(gKey)) {
      groupMap.set(gKey, {
        groupId:       c.groupId,
        date:          c.date,
        dow:           c.dow,
        week:          c.week,
        startMin:      c.startMin,
        endMin:        c.endMin,
        timeFormatted: `${formatMinTo12h(c.startMin)} – ${formatMinTo12h(c.endMin)}`,
        course:        c.course,
        no:            c.no,
        room:          c.room || 'TBD',
        sections:      new Set(),
      });
    }
    groupMap.get(gKey).sections.add(c.section);
  }

  const ownSchedule = getStudentSchedule(dataset.sessions, section, skipped.id);
  const rows = [];

  for (const item of groupMap.values()) {
    const conflicts = ownSchedule.filter(own => {
      if (own.date !== item.date) return false;
      return intervalsOverlap(item.startMin, item.endMin, own.startMin, own.endMin);
    });

    const free = conflicts.length === 0;
    const sameDay = item.date === skipped.date;
    const daysOffset = daysDiff(skipped.date, item.date);

    rows.push({
      groupId:       item.groupId,
      date:          item.date,
      dow:           item.dow,
      week:          item.week,
      startMin:      item.startMin,
      endMin:        item.endMin,
      timeFormatted: item.timeFormatted,
      course:        item.course,
      no:            item.no,
      room:          item.room,
      sections:      Array.from(item.sections).sort(),
      free:          free,
      sameDay:       sameDay,
      daysDiff:      daysOffset,
      conflictsWith: conflicts.map(x => ({
        course:   x.course,
        startMin: x.startMin,
        endMin:   x.endMin,
        timeFormatted: `${formatMinTo12h(x.startMin)} – ${formatMinTo12h(x.endMin)}`,
      })),
      isPast: item.date < todayISO,
    });
  }

  // BRL-08 Sort: free > sameDay > abs(daysDiff) > date asc > startMin asc
  rows.sort((a, b) => {
    if (a.free !== b.free) return a.free ? -1 : 1;
    if (a.sameDay !== b.sameDay) return a.sameDay ? -1 : 1;
    const diffA = Math.abs(a.daysDiff);
    const diffB = Math.abs(b.daysDiff);
    if (diffA !== diffB) return diffA - diffB;
    return a.date.localeCompare(b.date) || a.startMin - b.startMin;
  });

  return {
    skipped: toPublicSession(skipped),
    rows: rows,
    reason: 'OK',
    message: `${rows.length} alternate slot(s) found across sections.`,
  };
}

export function getClashAdvice(dataset, section, date, todayISO) {
  todayISO = todayISO || new Date().toISOString().slice(0, 10);
  const clashesMap = detectClashesMap(dataset.sessions, section, date, date);
  const clashingIds = clashesMap[date] ? Array.from(clashesMap[date]) : [];
  if (clashingIds.length < 2) {
    return { hasClash: false, message: 'No clash detected on this date.' };
  }

  const sessionMap = new Map(dataset.sessions.map(s => [s.id, s]));
  const clashingSessions = clashingIds.map(id => sessionMap.get(id)).filter(Boolean);

  const evaluated = clashingSessions.map(s => {
    let alts = null;
    try {
      alts = queryAlternates(dataset, section, s.id, { showPast: false, todayISO: todayISO });
    } catch (_) {
      alts = { rows: [], reason: 'ERROR' };
    }
    const freeCount = alts.rows ? alts.rows.filter(r => r.free).length : 0;
    const totalCount = alts.rows ? alts.rows.length : 0;
    const bestFree = alts.rows ? alts.rows.find(r => r.free) : null;
    const bestAny = alts.rows && alts.rows.length > 0 ? alts.rows[0] : null;

    return {
      session: toPublicSession(s),
      totalAlternates: totalCount,
      freeAlternates: freeCount,
      bestAlternate: bestFree || bestAny,
      hasNoAlternates: totalCount === 0,
      hasFreeAlternates: freeCount > 0,
      allAlternates: alts.rows || [],
    };
  });

  const A = evaluated[0];
  const B = evaluated[1];
  let recommendation = null;

  if (A.hasNoAlternates && !B.hasNoAlternates) {
    recommendation = {
      attendSessionId: A.session.id,
      attendCourse: A.session.course,
      skipSessionId: B.session.id,
      skipCourse: B.session.course,
      badgeText: 'Smart Recommendation',
      reason: `"${A.session.course}" has NO alternate sessions scheduled in any other section. You must attend it now. For "${B.session.course}", an alternate is available on ${B.bestAlternate.dow} ${B.bestAlternate.date} at ${B.bestAlternate.timeFormatted} with Section ${B.bestAlternate.sections.join('/')}.`,
      bestAlternateForSkipped: B.bestAlternate,
    };
  } else if (B.hasNoAlternates && !A.hasNoAlternates) {
    recommendation = {
      attendSessionId: B.session.id,
      attendCourse: B.session.course,
      skipSessionId: A.session.id,
      skipCourse: A.session.course,
      badgeText: 'Smart Recommendation',
      reason: `"${B.session.course}" has NO alternate sessions scheduled in any other section. You must attend it now. For "${A.session.course}", an alternate is available on ${A.bestAlternate.dow} ${A.bestAlternate.date} at ${A.bestAlternate.timeFormatted} with Section ${A.bestAlternate.sections.join('/')}.`,
      bestAlternateForSkipped: A.bestAlternate,
    };
  } else if (A.hasNoAlternates && B.hasNoAlternates) {
    recommendation = {
      attendSessionId: null,
      attendCourse: null,
      skipSessionId: null,
      skipCourse: null,
      badgeText: 'Action Required',
      reason: `Neither "${A.session.course}" nor "${B.session.course}" has alternate sessions in other sections. Please consult Academic Operations.`,
      bestAlternateForSkipped: null,
    };
  } else {
    if (!A.hasFreeAlternates && B.hasFreeAlternates) {
      recommendation = {
        attendSessionId: A.session.id,
        attendCourse: A.session.course,
        skipSessionId: B.session.id,
        skipCourse: B.session.course,
        badgeText: 'Recommended',
        reason: `Alternates for "${A.session.course}" conflict with your schedule, but "${B.session.course}" has clash-free alternates. Attend "${A.session.course}" now.`,
        bestAlternateForSkipped: B.bestAlternate,
      };
    } else if (!B.hasFreeAlternates && A.hasFreeAlternates) {
      recommendation = {
        attendSessionId: B.session.id,
        attendCourse: B.session.course,
        skipSessionId: A.session.id,
        skipCourse: A.session.course,
        badgeText: 'Recommended',
        reason: `Alternates for "${B.session.course}" conflict with your schedule, but "${A.session.course}" has clash-free alternates. Attend "${B.session.course}" now.`,
        bestAlternateForSkipped: A.bestAlternate,
      };
    } else {
      const scarce = A.freeAlternates <= B.freeAlternates ? A : B;
      const other = scarce === A ? B : A;

      let reasonText = '';
      if (other.bestAlternate && other.bestAlternate.date === date) {
        if (other.bestAlternate.startMin < scarce.session.startMin) {
          reasonText = `Both classes can be attended on ${scarce.session.dow}! Attend "${other.session.course}" earlier at ${other.bestAlternate.timeFormatted} (with Section ${other.bestAlternate.sections.join('/')}) and attend "${scarce.session.course}" at ${formatMinTo12h(scarce.session.startMin)} with Section ${section}.`;
        } else {
          reasonText = `Both classes can be attended on ${scarce.session.dow}! Attend "${scarce.session.course}" at ${formatMinTo12h(scarce.session.startMin)} with Section ${section} and attend "${other.session.course}" later at ${other.bestAlternate.timeFormatted} (with Section ${other.bestAlternate.sections.join('/')}).`;
        }
      } else if (other.bestAlternate) {
        reasonText = `"${scarce.session.course}" has fewer alternate slots available. Attend it on ${scarce.session.dow} (${date}) and catch "${other.session.course}" on ${other.bestAlternate.dow} (${other.bestAlternate.date}) at ${other.bestAlternate.timeFormatted} with Section ${other.bestAlternate.sections.join('/')}.`;
      } else {
        reasonText = `"${scarce.session.course}" has fewer alternates. Attend it on ${scarce.session.dow} (${date}).`;
      }

      recommendation = {
        attendSessionId: scarce.session.id,
        attendCourse: scarce.session.course,
        skipSessionId: other.session.id,
        skipCourse: other.session.course,
        badgeText: 'Recommended',
        reason: reasonText,
        bestAlternateForSkipped: other.bestAlternate,
      };
    }
  }

  const firstS = clashingSessions[0] || {};
  return {
    hasClash: true,
    date: date,
    dow: firstS.dow || '',
    startMin: firstS.startMin || 0,
    endMin: firstS.endMin || 0,
    timeFormatted: firstS.startMin ? `${formatMinTo12h(firstS.startMin)} – ${formatMinTo12h(firstS.endMin)}` : '',
    section: section,
    evaluatedSessions: evaluated,
    recommendation: recommendation,
  };
}

export function querySubjectSessions(dataset, course, sessionNo, studentSection, todayISO) {
  todayISO = todayISO || new Date().toISOString().slice(0, 10);
  const targetNo = parseInt(sessionNo, 10);

  const matched = dataset.sessions.filter(s => {
    if (s.course !== course) return false;
    if (s.no !== targetNo) return false;
    if (s.status !== 'Active') return false;
    return true;
  });

  const groupMap = new Map();
  for (const s of matched) {
    const gKey = s.groupId || `${s.date}|${s.startMin}|${s.endMin}|${s.room}`;
    if (!groupMap.has(gKey)) {
      groupMap.set(gKey, {
        groupId:       s.groupId,
        date:          s.date,
        dow:           s.dow,
        week:          s.week,
        startMin:      s.startMin,
        endMin:        s.endMin,
        timeFormatted: `${formatMinTo12h(s.startMin)} – ${formatMinTo12h(s.endMin)}`,
        course:        s.course,
        no:            s.no,
        room:          s.room || 'TBD',
        sections:      new Set(),
      });
    }
    groupMap.get(gKey).sections.add(s.section);
  }

  const ownSchedule = studentSection
    ? getStudentSchedule(dataset.sessions, studentSection, null)
    : null;

  const rows = [];
  for (const item of groupMap.values()) {
    let free = true;
    let conflictsWith = [];

    if (ownSchedule) {
      const conflicts = ownSchedule.filter(own => {
        if (own.date !== item.date) return false;
        return intervalsOverlap(item.startMin, item.endMin, own.startMin, own.endMin);
      });
      free = conflicts.length === 0;
      conflictsWith = conflicts.map(x => ({
        course:   x.course,
        startMin: x.startMin,
        endMin:   x.endMin,
        timeFormatted: `${formatMinTo12h(x.startMin)} – ${formatMinTo12h(x.endMin)}`,
      }));
    }

    rows.push({
      groupId:       item.groupId,
      date:          item.date,
      dow:           item.dow,
      startMin:      item.startMin,
      endMin:        item.endMin,
      timeFormatted: item.timeFormatted,
      course:        item.course,
      no:            item.no,
      room:          item.room,
      sections:      Array.from(item.sections).sort(),
      free:          free,
      conflictsWith: conflictsWith,
      isPast:        item.date < todayISO,
    });
  }

  rows.sort((a, b) => a.date.localeCompare(b.date) || a.startMin - b.startMin);
  return rows;
}
