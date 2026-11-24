// ============================================================
// lib/query.js — Timetable queries, Clash clusters & Alternates
// Handles multi-cluster days, N-way clashes & conflict-honest advice
// ============================================================

import { SECTIONS, HARD_BLOCKING, getTodayIST } from './config.js';

export function toPublicSession(s) {
  return {
    id:            s.id,
    date:          s.date,
    dow:           s.dow,
    week:          s.week,
    section:       s.section,
    startMin:      s.startMin,
    endMin:        s.endMin,
    timeFormatted: formatMinTo12h(s.startMin) + ' – ' + formatMinTo12h(s.endMin),
    course:        s.course,
    no:            s.no,
    room:          s.room || 'TBD',
    type:          s.type,
    status:        s.status,
    groupId:       s.groupId,
  };
}

export function formatTime(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatHumanDate(isoDate, dow) {
  if (!isoDate) return '';
  const [, mo, d] = isoDate.split('-').map(Number);
  return `${dow ? dow + ', ' : ''}${d} ${SHORT_MONTHS[mo - 1]}`;
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
  return Math.round((Date.UTC(y2, m2 - 1, day2) - Date.UTC(y1, m1 - 1, day1)) / 86400000);
}

export function getStudentSchedule(sessions, section, excludeSessionIds = []) {
  const excluded = Array.isArray(excludeSessionIds)
    ? new Set(excludeSessionIds)
    : new Set(excludeSessionIds ? [excludeSessionIds] : []);
  return sessions.filter(s => {
    if (excluded.has(s.id)) return false;
    if (s.status !== 'Active') return false;
    if (!HARD_BLOCKING.has(s.type)) return false;
    return s.section === section || s.section === 'ALL';
  });
}

/** Group hard-blocking overlapping sessions on a date into connected clusters (each size >= 2). */
export function buildClashClustersForDate(sessions, section, date) {
  const activeHard = sessions
    .filter(s => s.status === 'Active' && HARD_BLOCKING.has(s.type) && s.date === date && (s.section === section || s.section === 'ALL'))
    .sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);

  const clusters = [];
  let curGroup = [];
  let curMaxEnd = -1;

  for (const s of activeHard) {
    if (curGroup.length === 0) {
      curGroup = [s];
      curMaxEnd = s.endMin;
    } else if (s.startMin < curMaxEnd) {
      curGroup.push(s);
      curMaxEnd = Math.max(curMaxEnd, s.endMin);
    } else {
      if (curGroup.length >= 2) clusters.push(curGroup);
      curGroup = [s];
      curMaxEnd = s.endMin;
    }
  }
  if (curGroup.length >= 2) clusters.push(curGroup);

  return clusters;
}

export function detectClashesMap(sessions, section, fromISO, toISO) {
  const result = {};
  const dates = new Set();
  for (const s of sessions) {
    if (s.status !== 'Active' || !HARD_BLOCKING.has(s.type)) continue;
    if (s.section !== section && s.section !== 'ALL') continue;
    if (fromISO && s.date < fromISO) continue;
    if (toISO && s.date > toISO) continue;
    dates.add(s.date);
  }

  for (const d of dates) {
    const clusters = buildClashClustersForDate(sessions, section, d);
    if (clusters.length > 0) {
      const ids = new Set();
      for (const cl of clusters) {
        for (const s of cl) ids.add(s.id);
      }
      result[d] = ids;
    }
  }
  return result;
}

export function queryUpcomingClashDays(dataset, section, fromISO) {
  if (!SECTIONS.includes(section)) return [];
  const clashMap = detectClashesMap(dataset.sessions, section, fromISO, '2099-12-31');
  const dayInfo = new Map();
  for (const s of dataset.sessions) {
    if (!clashMap[s.date] || !clashMap[s.date].has(s.id)) continue;
    if (!dayInfo.has(s.date)) {
      dayInfo.set(s.date, { date: s.date, dow: s.dow, clashCount: clashMap[s.date].size, courses: [] });
    }
    dayInfo.get(s.date).courses.push(s.course);
  }
  return Array.from(dayInfo.values()).sort((a, b) => a.date.localeCompare(b.date));
}

export function queryTimetable(dataset, section, fromISO, toISO) {
  if (!SECTIONS.includes(section)) {
    throw new Error(`Invalid section: ${section}`);
  }

  const inRange = dataset.sessions.filter(s => {
    if (s.status !== 'Active') return false;
    if (s.section !== section && s.section !== 'ALL') return false;
    if (fromISO && s.date < fromISO) return false;
    if (toISO && s.date > toISO) return false;
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
        clashClustersCount: 0,
        sessions: [],
      });
    }
    const day = daysMap.get(s.date);
    const dayClashingIds = clashesMap[s.date] || new Set();
    const isClashing = dayClashingIds.has(s.id);
    if (isClashing) day.hasClash = true;

    day.sessions.push({
      ...toPublicSession(s),
      isClashing,
      clashesWithCourses: [],
    });
  }

  const days = Array.from(daysMap.values());
  days.sort((a, b) => a.date.localeCompare(b.date));
  for (const d of days) {
    d.sessions.sort((a, b) => {
      // Show Holiday marker first if present, otherwise chronological
      if (a.type === 'Holiday' && b.type !== 'Holiday') return -1;
      if (b.type === 'Holiday' && a.type !== 'Holiday') return 1;
      return a.startMin - b.startMin || (a.status === 'Active' ? -1 : 1);
    });
    if (d.hasClash) {
      const clusters = buildClashClustersForDate(dataset.sessions, section, d.date);
      d.clashClustersCount = clusters.length;
      for (const s of d.sessions) {
        if (!s.isClashing) continue;
        const peerCluster = clusters.find(cl => cl.some(x => x.id === s.id));
        if (peerCluster) {
          s.clashesWithCourses = peerCluster
            .filter(x => x.id !== s.id)
            .map(x => `${x.course} (${formatMinTo12h(x.startMin)} – ${formatMinTo12h(x.endMin)})`);
        }
      }
    }
  }
  return days;
}

export function queryAlternates(dataset, section, sessionId, opts = {}) {
  const showPast = opts.showPast || false;
  const todayISO = opts.todayISO || getTodayIST();

  const skipped = dataset.sessions.find(s => s.id === sessionId);
  if (!skipped) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  if (skipped.type !== 'Course' || !skipped.no) {
    const labelByType = {
      Quiz: 'Quizzes must be taken in your scheduled section.',
      EndTerm: 'End-Term exams must be taken in your assigned slot.',
      ODC: 'Off-Campus (ODC) sessions do not have alternate section swaps.',
    };
    return {
      skipped: toPublicSession(skipped),
      rows: [],
      reason: 'NON_COURSE',
      message: labelByType[skipped.type] || 'Alternates are only available for regular courses with session numbers.',
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
      message: `No other section is offering Session #${skipped.no} of "${skipped.course}" from today onwards.`,
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

  // Exclude ALL hard-blocking sessions at the same clashing cluster window? Wait: strictly exclude only skipped.id
  // so that attending an alternate during another clash window still accurately reports the other overlapping class!
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
      free,
      sameDay,
      daysDiff:      daysOffset,
      conflictsWith: conflicts.map(x => ({
        course:        x.course,
        startMin:      x.startMin,
        endMin:        x.endMin,
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
    rows,
    reason: 'OK',
    message: `${rows.length} alternate ${rows.length === 1 ? 'slot' : 'slots'} found across sections.`,
  };
}

function evaluateClusterAdvice(dataset, section, date, todayISO, clusterSessions) {
  const evaluated = clusterSessions.map(s => {
    let alts = null;
    try {
      alts = queryAlternates(dataset, section, s.id, { showPast: false, todayISO });
    } catch (_) {
      alts = { rows: [], reason: 'ERROR' };
    }
    const rows = alts.rows || [];
    const freeCount = rows.filter(r => r.free).length;
    const totalCount = rows.length;
    const bestFree = rows.find(r => r.free) || null;
    const bestAny = rows[0] || null;

    return {
      session: toPublicSession(s),
      totalAlternates: totalCount,
      freeAlternates: freeCount,
      bestAlternate: bestFree || bestAny,
      hasNoAlternates: totalCount === 0,
      hasFreeAlternates: freeCount > 0,
      allAlternates: rows,
    };
  });

  // Score every choice X = keep X in regular slot, skip every other session in cluster
  const rankedPlans = evaluated.map(kept => {
    const others = evaluated.filter(o => o.session.id !== kept.session.id);
    const missingAnyAlt = others.some(o => o.hasNoAlternates);
    const freeSkippedCount = others.filter(o => o.hasFreeAlternates).length;
    const allSkippedFree = others.every(o => o.hasFreeAlternates);
    const totalAltSlack = others.reduce((acc, o) => acc + o.freeAlternates, 0);
    // Higher is better to attend (so skip things WITH free alternates)
    return { kept, others, missingAnyAlt, freeSkippedCount, allSkippedFree, totalAltSlack };
  });

  // Prefer plans where nothing has zero alternates -> where ALL skipped have free alternates -> max free skipped -> max slack -> preserve graded evaluation (Quiz/EndTerm) if possible
  const typeWeight = t => (t === 'EndTerm' || t === 'Quiz' ? 2 : t === 'ODC' ? 1 : 0);
  rankedPlans.sort((p1, p2) => {
    if (p1.allSkippedFree !== p2.allSkippedFree) return p1.allSkippedFree ? -1 : 1;
    if (p1.missingAnyAlt !== p2.missingAnyAlt) return p1.missingAnyAlt ? 1 : -1;
    if (p1.freeSkippedCount !== p2.freeSkippedCount) return p2.freeSkippedCount - p1.freeSkippedCount;
    const twDiff = typeWeight(p2.kept.session.type) - typeWeight(p1.kept.session.type);
    if (twDiff !== 0) return twDiff;
    return p2.totalAltSlack - p1.totalAltSlack;
  });

  const best = rankedPlans[0];
  let recommendation = null;

  if (!best.allSkippedFree) {
    // Be 100% honest when no completely clash-free combo exists
    const allHaveZeroAlts = evaluated.every(e => e.hasNoAlternates);
    if (allHaveZeroAlts) {
      recommendation = {
        attendSessionId: null,
        attendCourse: null,
        hasClashFreeOption: false,
        badgeText: 'Action Required',
        reason: `None of these clashing sessions have alternate slots in other sections. Please contact Academic Operations for guidance.`,
      };
    } else if (best.missingAnyAlt) {
      const stuck = best.others.find(o => o.hasNoAlternates);
      recommendation = {
        attendSessionId: null,
        attendCourse: null,
        hasClashFreeOption: false,
        badgeText: 'Schedule Conflict Warning',
        reason: `"${stuck.session.course}" has no alternate sessions in other sections, and your other options either have no free alternate slots or overlap your existing classes.`,
      };
    } else {
      // Alternates exist on sheet, ONLY overlapping ones (e.g. Section B Nov 25 where 9 AM overlaps Market Research!)
      const sampleAlt = best.others[0]?.bestAlternate;
      const conflictNames = sampleAlt?.conflictsWith?.map(c => c.course).join(', ') || 'another scheduled class';
      recommendation = {
        attendSessionId: null,
        attendCourse: null,
        hasClashFreeOption: false,
        badgeText: 'No Clash-Free Swap Found',
        reason: `Alternate slots exist in other sections, but every available time slot overlaps your Section ${section} timetable (for example, ${sampleAlt?.timeFormatted || 'that slot'} overlaps with your ${conflictNames} class). Pick a class without a quiz, or tap "View all alternates" to inspect overlaps.`,
      };
    }
  } else if (evaluated.length === 2) {
    const scarce = best.kept;
    const other = best.others[0];
    let reasonText = '';

    if (other.bestAlternate && other.bestAlternate.free && other.bestAlternate.date === date) {
      if (other.bestAlternate.startMin < scarce.session.startMin) {
        reasonText = `Good news — you can attend both classes on ${scarce.session.dow}! Attend "${other.session.course}" earlier at ${other.bestAlternate.timeFormatted} (with Section ${other.bestAlternate.sections.join('/')}) and attend "${scarce.session.course}" at ${formatMinTo12h(scarce.session.startMin)} with Section ${section}.`;
      } else {
        reasonText = `Good news — you can attend both classes on ${scarce.session.dow}! Attend "${scarce.session.course}" at ${formatMinTo12h(scarce.session.startMin)} with Section ${section} and attend "${other.session.course}" later at ${other.bestAlternate.timeFormatted} (with Section ${other.bestAlternate.sections.join('/')}).`;
      }
    } else if (scarce.hasNoAlternates && other.bestAlternate) {
      reasonText = `"${scarce.session.course}" has NO alternate sessions in any other section, so attend it in Section ${section}. Catch "${other.session.course}" on ${formatHumanDate(other.bestAlternate.date, other.bestAlternate.dow)} at ${other.bestAlternate.timeFormatted} with Section ${other.bestAlternate.sections.join('/')}.`;
    } else if (other.bestAlternate) {
      reasonText = `Attend "${scarce.session.course}" in Section ${section} at ${formatMinTo12h(scarce.session.startMin)}, and take "${other.session.course}" clash-free on ${formatHumanDate(other.bestAlternate.date, other.bestAlternate.dow)} at ${other.bestAlternate.timeFormatted} with Section ${other.bestAlternate.sections.join('/')}.`;
    }

    recommendation = {
      attendSessionId: scarce.session.id,
      attendCourse: scarce.session.course,
      skipSessionId: other.session.id,
      skipCourse: other.session.course,
      hasClashFreeOption: true,
      badgeText: scarce.hasNoAlternates ? 'Must-Attend Match' : 'Recommended Plan',
      reason: reasonText,
      bestAlternateForSkipped: other.bestAlternate,
    };
  } else {
    // 3+ classes overlapping in one cluster
    const kept = best.kept;
    const otherSummary = best.others
      .map(o => `"${o.session.course}" (${o.bestAlternate.dow} ${o.bestAlternate.timeFormatted} w/ Sec ${o.bestAlternate.sections.join('/')})`)
      .join(' and ');
    recommendation = {
      attendSessionId: kept.session.id,
      attendCourse: kept.session.course,
      skipSessionId: null,
      skipCourse: null,
      hasClashFreeOption: true,
      badgeText: 'Multi-Clash Plan',
      reason: `You have ${evaluated.length} overlapping classes here. Attend "${kept.session.course}" with Section ${section}, and take alternates for ${otherSummary}.`,
      bestAlternateForSkipped: best.others[0]?.bestAlternate || null,
    };
  }

  const startMin = Math.min(...clusterSessions.map(s => s.startMin));
  const endMin = Math.max(...clusterSessions.map(s => s.endMin));
  return {
    startMin,
    endMin,
    timeFormatted: `${formatMinTo12h(startMin)} – ${formatMinTo12h(endMin)}`,
    evaluatedSessions: evaluated,
    recommendation,
  };
}

export function getClashAdvice(dataset, section, date, todayISO, targetSessionId = null) {
  if (!SECTIONS.includes(section)) {
    throw new Error(`Invalid section: ${section}`);
  }
  todayISO = todayISO || getTodayIST();
  const rawClusters = buildClashClustersForDate(dataset.sessions, section, date);
  if (rawClusters.length === 0) {
    return { hasClash: false, message: 'No clash detected on this date.' };
  }

  const clusters = rawClusters.map((cl, idx) => ({
    clusterIndex: idx,
    date,
    dow: cl[0]?.dow || '',
    ...evaluateClusterAdvice(dataset, section, date, todayISO, cl),
  }));

  let selectedIndex = 0;
  if (targetSessionId) {
    const found = clusters.findIndex(cl => cl.evaluatedSessions.some(e => e.session.id === targetSessionId));
    if (found >= 0) selectedIndex = found;
  }

  const primary = clusters[selectedIndex];
  return {
    hasClash: true,
    date,
    dow: primary.dow,
    section,
    selectedClusterIndex: selectedIndex,
    clusters,
    // Keep top-level fields populated from selected cluster for compatibility
    startMin: primary.startMin,
    endMin: primary.endMin,
    timeFormatted: primary.timeFormatted,
    evaluatedSessions: primary.evaluatedSessions,
    recommendation: primary.recommendation,
  };
}

export function querySubjectSessions(dataset, course, sessionNo, studentSection, todayISO) {
  todayISO = todayISO || getTodayIST();
  const targetNo = parseInt(sessionNo, 10);

  if (isNaN(targetNo) || targetNo < 1) {
    throw new Error('Valid positive sessionNo is required.');
  }

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

  const ownSchedule = (studentSection && SECTIONS.includes(studentSection))
    ? getStudentSchedule(dataset.sessions, studentSection, [])
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
        course:        x.course,
        startMin:      x.startMin,
        endMin:        x.endMin,
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
      free,
      conflictsWith,
      isPast:        item.date < todayISO,
    });
  }

  rows.sort((a, b) => a.date.localeCompare(b.date) || a.startMin - b.startMin);
  return rows;
}
