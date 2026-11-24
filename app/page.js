'use client';

import React, { useState, useEffect, useRef } from 'react';

const SECTIONS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const FIVE_MINUTES_MS = 5 * 60 * 1000;

function getClientTodayIST() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function addDaysISO(isoDate, delta) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

function pluralize(count, singular, plural) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export default function Home() {
  const [section, setSection] = useState('A');
  const [sectionReady, setSectionReady] = useState(false);
  const [dateFilter, setDateFilter] = useState('today_tomorrow');
  const [onlyClashes, setOnlyClashes] = useState(false);
  const [activeTab, setActiveTab] = useState('schedule');
  const [alternatesReturnTab, setAlternatesReturnTab] = useState('schedule');

  const [bootstrap, setBootstrap] = useState(null);
  const [timetableDays, setTimetableDays] = useState([]);
  const [upcomingClashes, setUpcomingClashes] = useState([]);
  const [loadingSchedule, setLoadingSchedule] = useState(true);

  // Clash resolver state
  const [activeClashDay, setActiveClashDay] = useState(null);
  const [clashAdvice, setClashAdvice] = useState(null);
  const [selectedClusterIdx, setSelectedClusterIdx] = useState(0);
  const [loadingClash, setLoadingClash] = useState(false);
  const [confirmedPlan, setConfirmedPlan] = useState(null);

  // Alternates tab state
  const [skippedSession, setSkippedSession] = useState(null);
  const [alternatesData, setAlternatesData] = useState(null);
  const [loadingAlternates, setLoadingAlternates] = useState(false);

  // Subject browser state
  const [courseSearch, setCourseSearch] = useState('');
  const [selectedCourse, setSelectedCourse] = useState('');
  const [selectedSessionNo, setSelectedSessionNo] = useState('');
  const [subjectOfferings, setSubjectOfferings] = useState([]);
  const [loadingSubject, setLoadingSubject] = useState(false);

  // Status & notifications
  const [statusInfo, setStatusInfo] = useState(null);
  const [lastSyncedTime, setLastSyncedTime] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [toastMessage, setToastMessage] = useState('');

  // Sequence counters to prevent stale async responses on rapid section/filter clicks
  const timetableReqSeq = useRef(0);
  const clashReqSeq = useRef(0);
  const altReqSeq = useRef(0);
  const subjectReqSeq = useRef(0);

  // 1. Read saved section first, then load initial bootstrap + status + 5-min auto-sync timer
  useEffect(() => {
    try {
      const savedSec = localStorage.getItem('mu_user_section');
      if (savedSec && SECTIONS.includes(savedSec)) {
        setSection(savedSec);
      }
    } catch (_) {}
    setSectionReady(true);

    fetchAllLiveMeta(false);
    const interval = setInterval(() => {
      fetchAllLiveMeta(false);
    }, FIVE_MINUTES_MS);
    return () => clearInterval(interval);
  }, []);

  // 2. Fetch timetable once section is ready and whenever section / filter / tab returns to schedule
  useEffect(() => {
    if (!sectionReady) return;
    if (activeTab === 'schedule') {
      fetchTimetable();
    } else if (activeTab === 'subject' && selectedCourse && selectedSessionNo) {
      // Keep Browse Subjects conflict badges accurate when user switches Section A-H
      fetchSubjectOfferings(selectedCourse, selectedSessionNo, section);
    }
  }, [sectionReady, section, dateFilter, activeTab]);

  function showToast(msg) {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(''), 2600);
  }

  function stampSyncClock() {
    const nowStr = new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }).format(new Date());
    setLastSyncedTime(nowStr);
  }

  async function fetchAllLiveMeta(force = false) {
    if (force) setRefreshing(true);
    try {
      const q = force ? '?refresh=1' : '';
      const [bRes, sRes] = await Promise.all([
        fetch(`/api/bootstrap${q}`),
        fetch('/api/status'),
      ]);
      const [bJson, sJson] = await Promise.all([bRes.json(), sRes.json()]);
      if (bJson.ok) setBootstrap(bJson.data);
      if (sJson.ok) setStatusInfo(sJson.data);
      stampSyncClock();
      if (force && sectionReady && activeTab === 'schedule') {
        await fetchTimetable();
        showToast('Timetable synced with Google Sheets!');
      }
    } catch (err) {
      if (force) showToast('Could not refresh right now');
    } finally {
      if (force) setRefreshing(false);
    }
  }

  function handleSectionChange(sec) {
    setSection(sec);
    try {
      localStorage.setItem('mu_user_section', sec);
    } catch (_) {}
    if (activeTab === 'clash' || activeTab === 'alternates') {
      setActiveTab('schedule');
    }
  }

  function getDateRange() {
    const today = bootstrap?.today || getClientTodayIST();
    if (dateFilter === 'today_tomorrow') {
      return { from: today, to: addDaysISO(today, 1), isAll: false };
    } else if (dateFilter === '7d') {
      return { from: today, to: addDaysISO(today, 7), isAll: false };
    } else if (dateFilter === '15d') {
      return { from: today, to: addDaysISO(today, 15), isAll: false };
    } else {
      return { from: null, to: null, isAll: true };
    }
  }

  async function fetchTimetable() {
    const reqId = ++timetableReqSeq.current;
    setLoadingSchedule(true);
    try {
      const { from, to, isAll } = getDateRange();
      const url = isAll
        ? `/api/timetable?section=${section}&range=all`
        : `/api/timetable?section=${section}&from=${from}&to=${to}`;
      const res = await fetch(url);
      const json = await res.json();
      if (reqId !== timetableReqSeq.current) return;
      if (json.ok) {
        setTimetableDays(json.data.days || []);
        setUpcomingClashes(json.data.upcomingClashes || []);
      } else {
        setTimetableDays([]);
        setUpcomingClashes([]);
      }
    } catch (err) {
      if (reqId === timetableReqSeq.current) showToast('Error loading schedule');
    } finally {
      if (reqId === timetableReqSeq.current) setLoadingSchedule(false);
    }
  }

  async function openClashResolver(dayOrDate, focusSessionId = null) {
    const reqId = ++clashReqSeq.current;
    const dayObj = typeof dayOrDate === 'string'
      ? { date: dayOrDate, dow: '' }
      : dayOrDate;

    setActiveClashDay(dayObj);
    setConfirmedPlan(null);
    setClashAdvice(null);
    setSelectedClusterIdx(0);
    setActiveTab('clash');
    setLoadingClash(true);
    window.scrollTo({ top: 0, behavior: 'auto' });

    try {
      const q = focusSessionId ? `&sessionId=${encodeURIComponent(focusSessionId)}` : '';
      const res = await fetch(`/api/clash-advice?section=${section}&date=${dayObj.date}${q}`);
      const json = await res.json();
      if (reqId !== clashReqSeq.current) return;
      if (json.ok) {
        setClashAdvice(json.data);
        setSelectedClusterIdx(json.data.selectedClusterIndex || 0);
        if (!dayObj.dow && json.data.dow) {
          setActiveClashDay({ ...dayObj, dow: json.data.dow });
        }
      } else {
        showToast(json.error?.message || 'Error analyzing clash');
      }
    } catch (err) {
      if (reqId === clashReqSeq.current) showToast('Error loading clash options');
    } finally {
      if (reqId === clashReqSeq.current) setLoadingClash(false);
    }
  }

  const activeCluster = clashAdvice?.clusters?.[selectedClusterIdx] || clashAdvice;

  function handleConfirmPlan(keptSessionId) {
    const sessions = activeCluster?.evaluatedSessions;
    if (!sessions || sessions.length === 0) return;

    const kept = sessions.find(s => s.session.id === keptSessionId);
    const others = sessions.filter(s => s.session.id !== keptSessionId);
    if (!kept || others.length === 0) return;

    const dateFormatted = formatDisplayDate(clashAdvice.date, activeCluster.dow || clashAdvice.dow);
    const keptTime = formatMinTo12h(kept.session.startMin) + ' – ' + formatMinTo12h(kept.session.endMin);

    const allSkippedHaveFreeAlt = others.every(o => o.bestAlternate && o.bestAlternate.free);
    const anyMissingAlt = others.some(o => o.hasNoAlternates || !o.bestAlternate);
    const primaryOther = others[0];
    const isSingleSameDayFree = others.length === 1 &&
      primaryOther.bestAlternate &&
      primaryOther.bestAlternate.free &&
      primaryOther.bestAlternate.date === clashAdvice.date;
    const isAltEarlier = isSingleSameDayFree && (primaryOther.bestAlternate.startMin < kept.session.startMin);

    let copyText = `🎓 Masters' Union Class Plan (Section ${section})\n📅 Date: ${dateFormatted}\n-----------------------------------------\n`;

    if (isSingleSameDayFree && isAltEarlier) {
      const alt = primaryOther.bestAlternate;
      copyText += `⚡ SAME-DAY ATTENDANCE PLAN:\n` +
        `1️⃣ ${alt.timeFormatted}: Attend ${primaryOther.session.course}${primaryOther.session.no ? ` (Session #${primaryOther.session.no})` : ''}\n` +
        `   • Room: ${alt.room || 'TBD'} (with Section ${alt.sections.join(', ')})\n\n` +
        `2️⃣ ${keptTime}: Attend ${kept.session.course}${kept.session.no ? ` (Session #${kept.session.no})` : ''}\n` +
        `   • Room: ${kept.session.room || 'TBD'} (with Section ${section})\n`;
    } else if (isSingleSameDayFree && !isAltEarlier) {
      const alt = primaryOther.bestAlternate;
      copyText += `⚡ SAME-DAY ATTENDANCE PLAN:\n` +
        `1️⃣ ${keptTime}: Attend ${kept.session.course}${kept.session.no ? ` (Session #${kept.session.no})` : ''}\n` +
        `   • Room: ${kept.session.room || 'TBD'} (with Section ${section})\n\n` +
        `2️⃣ ${alt.timeFormatted}: Attend ${primaryOther.session.course}${primaryOther.session.no ? ` (Session #${primaryOther.session.no})` : ''}\n` +
        `   • Room: ${alt.room || 'TBD'} (with Section ${alt.sections.join(', ')})\n`;
    } else {
      copyText += `1️⃣ ATTEND ON ${dateFormatted} (${keptTime}):\n` +
        `   • ${kept.session.course}${kept.session.no ? ` (Session #${kept.session.no})` : ''}\n` +
        `   • Room: ${kept.session.room || 'TBD'} (Section ${section})\n\n`;
      others.forEach((o, i) => {
        const labelNo = others.length > 1 ? `2${String.fromCharCode(97 + i)}` : '2️⃣';
        if (o.bestAlternate) {
          const alt = o.bestAlternate;
          const overlapNote = !alt.free && alt.conflictsWith?.length
            ? ` ⚠️ WARNING: Overlaps with ${alt.conflictsWith.map(c => `${c.course} (${c.timeFormatted})`).join(', ')}`
            : '';
          copyText += `${labelNo} ALTERNATE FOR ${o.session.course}${o.session.no ? ` (Session #${o.session.no})` : ''}:\n` +
            `   • ${formatDisplayDate(alt.date, alt.dow)} @ ${alt.timeFormatted} | Room ${alt.room || 'TBD'} (Section ${alt.sections.join(', ')})${overlapNote}\n\n`;
        } else {
          copyText += `${labelNo} ${o.session.course}: No alternate slot available in other sections.\n\n`;
        }
      });
    }

    copyText += `-----------------------------------------\n⚠️ Note: If either class has a Quiz or Graded Evaluation, attend that class in your own section and take the other class in an alternate slot or section.`;

    setConfirmedPlan({
      kept,
      others,
      dateFormatted,
      keptTime,
      copyText,
      allSkippedHaveFreeAlt,
      anyMissingAlt,
      isSingleSameDayFree,
      isAltEarlier,
    });
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  async function openAlternatesForSession(sessionId, returnTo = 'schedule') {
    const reqId = ++altReqSeq.current;
    setAlternatesReturnTab(returnTo);
    setActiveTab('alternates');
    setLoadingAlternates(true);
    window.scrollTo({ top: 0, behavior: 'auto' });

    try {
      const res = await fetch(`/api/alternates?section=${section}&sessionId=${encodeURIComponent(sessionId)}`);
      const json = await res.json();
      if (reqId !== altReqSeq.current) return;
      if (json.ok) {
        setAlternatesData(json.data);
        setSkippedSession(json.data.skipped);
      } else {
        showToast(json.error?.message || 'Error finding alternates');
      }
    } catch (err) {
      if (reqId === altReqSeq.current) showToast('Error loading alternates');
    } finally {
      if (reqId === altReqSeq.current) setLoadingAlternates(false);
    }
  }

  function handleCourseChange(courseName) {
    setSelectedCourse(courseName);
    setSelectedSessionNo('');
    setSubjectOfferings([]);
  }

  async function fetchSubjectOfferings(courseName, sessionNo, sec) {
    const reqId = ++subjectReqSeq.current;
    if (!courseName || !sessionNo) return;
    setLoadingSubject(true);

    try {
      const res = await fetch(
        `/api/subject?course=${encodeURIComponent(courseName)}&sessionNo=${encodeURIComponent(sessionNo)}&section=${sec}`
      );
      const json = await res.json();
      if (reqId !== subjectReqSeq.current) return;
      if (json.ok) {
        setSubjectOfferings(json.data.rows || []);
      }
    } catch (err) {
      if (reqId === subjectReqSeq.current) showToast('Error loading subject offerings');
    } finally {
      if (reqId === subjectReqSeq.current) setLoadingSubject(false);
    }
  }

  function handleSessionChange(no) {
    setSelectedSessionNo(no);
    if (!selectedCourse || !no) {
      setSubjectOfferings([]);
      return;
    }
    fetchSubjectOfferings(selectedCourse, no, section);
  }

  async function copyToClipboard(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        showToast('Copied to clipboard!');
        return;
      }
    } catch (_) {}

    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      showToast(ok ? 'Copied to clipboard!' : 'Please copy the text manually');
    } catch (_) {
      showToast('Please copy the text manually');
    }
  }

  function formatMinTo12h(min) {
    let h = Math.floor(min / 60);
    const m = min % 60;
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12;
    if (h === 0) h = 12;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} ${ampm}`;
  }

  function formatDisplayDate(isoDate, dow) {
    if (!isoDate) return '';
    const [y, mo, d] = isoDate.split('-').map(Number);
    const curYear = parseInt((bootstrap?.today || getClientTodayIST()).slice(0, 4), 10);
    const yrSuffix = y !== curYear ? ` '${String(y).slice(-2)}` : '';
    return `${dow ? dow + ', ' : ''}${d} ${MONTHS[mo - 1]}${yrSuffix}`;
  }

  function getClashContextDate(isoDate, dow) {
    if (!isoDate) return '';
    const formatted = formatDisplayDate(isoDate, dow);
    const today = bootstrap?.today || getClientTodayIST();
    if (isoDate === today) return `${formatted} (Today)`;
    if (isoDate === addDaysISO(today, 1)) return `${formatted} (Tomorrow)`;
    return formatted;
  }

  function formatSubjectCopyText(item) {
    const sessPart = item.no ? ` Session #${item.no}` : '';
    return `${item.course}${sessPart} | ${item.dow} ${item.date} | ${item.timeFormatted} | Room: ${item.room || 'TBD'} | Section ${item.sections.join(', ')}`;
  }

  const todayISO = bootstrap?.today || getClientTodayIST();
  const visibleDays = onlyClashes ? timetableDays.filter(d => d.hasClash) : timetableDays;
  const filteredCourses = (bootstrap?.courses || []).filter(c =>
    c.name.toLowerCase().includes(courseSearch.trim().toLowerCase())
  );
  const selectedCourseObj = bootstrap?.courses?.find(c => c.name === selectedCourse);

  return (
    <div>
      {/* Top Bar */}
      <header className="mu-header">
        <div className="header-container">
          <div className="logo-title-group" onClick={() => setActiveTab('schedule')}>
            <img src="/mu-logo.png" alt="Masters' Union" className="mu-logo-img" />
            <span className="app-tag">Alt-Class Finder</span>
          </div>
          <button
            id="sync-pill"
            className="sync-status-pill"
            onClick={() => fetchAllLiveMeta(true)}
            title="Auto-updates every 5 minutes. Click to refresh now."
          >
            <span className="pulse-indicator"></span>
            <span>{refreshing ? 'Syncing…' : 'Live Sync · 5m'}</span>
          </button>
        </div>
      </header>

      <main className="app-container">
        {/* Section Selector */}
        <div className="section-nav-wrapper">
          <div className="section-nav-header">
            <span>1. Pick Your Section:</span>
            <span style={{ color: 'var(--google-blue)', fontWeight: 700 }}>Section {section}</span>
          </div>
          <div className="section-chips-grid">
            {SECTIONS.map(s => (
              <button
                key={s}
                className={`section-chip ${section === s ? 'active' : ''}`}
                onClick={() => handleSectionChange(s)}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* Tab Navigation */}
        <nav className="nav-tabs">
          <button
            className={`nav-tab-btn ${activeTab === 'schedule' || activeTab === 'clash' || activeTab === 'alternates' ? 'active' : ''}`}
            onClick={() => setActiveTab('schedule')}
          >
            📅 My Schedule
          </button>
          <button
            className={`nav-tab-btn ${activeTab === 'subject' ? 'active' : ''}`}
            onClick={() => setActiveTab('subject')}
          >
            🔍 Browse Subjects
          </button>
          <button
            className={`nav-tab-btn ${activeTab === 'status' ? 'active' : ''}`}
            onClick={() => setActiveTab('status')}
          >
            ℹ️ Help & Status
          </button>
        </nav>

        {/* ============================================================ */}
        {/* TAB 1: SCHEDULE VIEW                                         */}
        {/* ============================================================ */}
        {activeTab === 'schedule' && (
          <div>
            {/* Filter Pills */}
            <div className="filter-pills-bar">
              <button
                className={`filter-pill ${dateFilter === 'today_tomorrow' && !onlyClashes ? 'active' : ''}`}
                onClick={() => { setOnlyClashes(false); setDateFilter('today_tomorrow'); }}
              >
                ⚡ Today & Tomorrow
              </button>
              <button
                className={`filter-pill ${dateFilter === '7d' && !onlyClashes ? 'active' : ''}`}
                onClick={() => { setOnlyClashes(false); setDateFilter('7d'); }}
              >
                📅 Next 7 Days
              </button>
              <button
                className={`filter-pill ${dateFilter === '15d' && !onlyClashes ? 'active' : ''}`}
                onClick={() => { setOnlyClashes(false); setDateFilter('15d'); }}
              >
                📅 Next 15 Days
              </button>
              <button
                className={`filter-pill ${dateFilter === 'all' && !onlyClashes ? 'active' : ''}`}
                onClick={() => { setOnlyClashes(false); setDateFilter('all'); }}
              >
                🗓️ Entire Term
              </button>
              {upcomingClashes.length > 0 && (
                <button
                  className={`filter-pill clash-toggle ${onlyClashes ? 'active' : ''}`}
                  onClick={() => {
                    if (!onlyClashes && dateFilter === 'today_tomorrow') setDateFilter('all');
                    setOnlyClashes(!onlyClashes);
                  }}
                >
                  ⚠️ Clashes Only ({upcomingClashes.length})
                </button>
              )}
            </div>

            {/* Upcoming Clashes Summary Alert */}
            {!loadingSchedule && (
              upcomingClashes.length > 0 ? (
                <div className="clash-summary-banner">
                  <div style={{ fontSize: 13.5, color: 'var(--text-primary)' }}>
                    <strong>⚠️ You have {pluralize(upcomingClashes.length, 'clash day', 'clash days')} ahead in Section {section}</strong>
                    <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 2 }}>
                      Next overlap: <strong>{getClashContextDate(upcomingClashes[0].date, upcomingClashes[0].dow)}</strong>
                    </div>
                  </div>
                  <button
                    className="clash-summary-btn"
                    onClick={() => openClashResolver(upcomingClashes[0])}
                  >
                    Fix Next Clash →
                  </button>
                </div>
              ) : (
                <div className="clash-summary-banner all-good">
                  <div style={{ fontSize: 13.5, color: 'var(--google-green)', fontWeight: 700 }}>
                    ✅ No upcoming class clashes found for Section {section}!
                  </div>
                </div>
              )
            )}

            {/* Schedule Items */}
            {loadingSchedule ? (
              <div>
                <div className="skeleton-card">
                  <div className="skeleton-bar" style={{ height: 18, width: '40%', marginBottom: 12 }}></div>
                  <div className="skeleton-bar" style={{ height: 14, width: '70%' }}></div>
                </div>
                <div className="skeleton-card">
                  <div className="skeleton-bar" style={{ height: 18, width: '50%', marginBottom: 12 }}></div>
                  <div className="skeleton-bar" style={{ height: 14, width: '60%' }}></div>
                </div>
              </div>
            ) : visibleDays.length === 0 ? (
              <div className="empty-state-box">
                <div style={{ fontSize: 32, marginBottom: 8 }}>☕</div>
                <p style={{ fontWeight: 700, fontSize: 16, color: 'var(--text-primary)', marginBottom: 4 }}>
                  No classes scheduled for Section {section}
                </p>
                <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 14 }}>
                  {onlyClashes
                    ? 'No clashes in the selected dates! Tap below to see all dates or upcoming clashes.'
                    : dateFilter === 'today_tomorrow'
                      ? 'Section ' + section + ' has no scheduled classes today or tomorrow.'
                      : 'No sessions found in this date range.'}
                </p>
                <button
                  className="action-attend-btn"
                  style={{ maxWidth: 260, margin: '0 auto' }}
                  onClick={() => { setOnlyClashes(false); setDateFilter('7d'); }}
                >
                  📅 View Next 7 Days →
                </button>
              </div>
            ) : (
              visibleDays.map(d => {
                const isToday = d.date === todayISO;
                const clashingCount = d.sessions.filter(s => s.isClashing).length;

                return (
                  <div key={d.date} className="day-group">
                    <div className="day-header-banner">
                      <div className={`day-label ${isToday ? 'today' : ''}`}>
                        <span>{formatDisplayDate(d.date, d.dow)}</span>
                        {isToday && <span className="today-badge">Today</span>}
                      </div>
                      {d.hasClash && clashingCount > 0 && (
                        <button className="clash-alert-pill" onClick={() => openClashResolver(d)}>
                          ⚠️ {pluralize(clashingCount, 'Class Clashes', 'Clashes')} — Fix Now
                        </button>
                      )}
                    </div>

                    {d.sessions.filter(s => s.status === 'Active').map(s => {
                      const isHoliday = s.type === 'Holiday';
                      const timeStr = `${formatMinTo12h(s.startMin)} – ${formatMinTo12h(s.endMin)}`;

                      if (isHoliday) {
                        return (
                          <div key={s.id} className="class-card holiday-card">
                            <div className="card-top-row">
                              <div className="course-name">🌴 Holiday — No Classes Scheduled</div>
                              <div className="card-badges">
                                <span className="pill-badge badge-holiday">Holiday</span>
                              </div>
                            </div>
                            <div className="card-details-row">
                              <span className="detail-item">Marked as Holiday in the official timetable</span>
                            </div>
                          </div>
                        );
                      }

                      return (
                        <div
                          key={s.id}
                          className={`class-card ${s.isClashing ? 'clash' : ''}`}
                        >
                          <div className="card-top-row">
                            <div className="course-name">{s.course}</div>
                            <div className="card-badges">
                              {s.no && <span className="pill-badge badge-session">Session #{s.no}</span>}
                              {s.type === 'Quiz' && <span className="pill-badge badge-quiz">📝 Quiz</span>}
                              {s.type === 'EndTerm' && <span className="pill-badge badge-endterm">🎓 End Term</span>}
                              {s.type === 'ODC' && <span className="pill-badge badge-odc">🚌 ODC</span>}
                              {s.type !== 'Course' && !['Quiz', 'EndTerm', 'ODC'].includes(s.type) && (
                                <span className="pill-badge" style={{ background: '#EEEEEE', color: '#3C4043' }}>{s.type}</span>
                              )}
                              {s.isClashing && <span className="pill-badge badge-clash">Clash</span>}
                            </div>
                          </div>

                          <div className="card-details-row">
                            <span className="detail-item">🕒 <strong>{timeStr}</strong></span>
                            <span className="detail-item">📍 Room: <strong>{s.room || 'TBD'}</strong></span>
                            {s.section === 'ALL' && <span className="detail-item">👥 All Sections</span>}
                          </div>

                          {s.isClashing && (
                            <div className="clash-warning-box">
                              <span>
                                ⚠️ Same time as <strong>{s.clashesWithCourses?.join(', ') || 'another class'}</strong>!
                              </span>
                              <button
                                className="resolve-clash-btn"
                                onClick={() => openClashResolver(d, s.id)}
                              >
                                Fix This Clash →
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* ============================================================ */}
        {/* TAB 2: CLASH RESOLUTION FLOW                                 */}
        {/* ============================================================ */}
        {activeTab === 'clash' && (
          <div>
            <button className="back-nav-btn" onClick={() => setActiveTab('schedule')}>
              ← Back to My Schedule
            </button>

            {/* Date Hero Banner */}
            {activeClashDay && (
              <div className="clash-date-hero">
                <div className="clash-date-calendar-icon">📅</div>
                <div>
                  <div className="clash-date-text">
                    {getClashContextDate(activeClashDay.date, activeClashDay.dow)}
                  </div>
                  <div className="clash-time-subtext">
                    🕒 {activeCluster?.timeFormatted || ''} · Section {section} Class Clash
                  </div>
                </div>
              </div>
            )}

            {/* Multi-Cluster Selector when 2+ separate clash windows happen on one day */}
            {clashAdvice?.clusters?.length > 1 && (
              <div className="cluster-switcher">
                {clashAdvice.clusters.map((cl, idx) => (
                  <button
                    key={idx}
                    className={`cluster-pill ${selectedClusterIdx === idx ? 'active' : ''}`}
                    onClick={() => { setSelectedClusterIdx(idx); setConfirmedPlan(null); }}
                  >
                    Clash {idx + 1}: {cl.timeFormatted}
                  </button>
                ))}
              </div>
            )}

            {/* Evaluation Disclaimer Banner */}
            <div className="evaluation-disclaimer-card">
              <div className="disclaimer-title">
                <span>⚠️</span>
                <span>Important Rule: Quizzes & Graded Evaluations</span>
              </div>
              <div className="disclaimer-body">
                If either class has a <strong>Quiz or Graded Evaluation</strong>, attend that class in your own section and take the other class in an alternate slot or section.
              </div>
            </div>

            {loadingClash ? (
              <div>
                <div className="skeleton-card">
                  <div className="skeleton-bar" style={{ height: 24, width: '60%', marginBottom: 12 }}></div>
                  <div className="skeleton-bar" style={{ height: 16, width: '85%' }}></div>
                </div>
                <div className="skeleton-card">
                  <div className="skeleton-bar" style={{ height: 24, width: '50%', marginBottom: 12 }}></div>
                  <div className="skeleton-bar" style={{ height: 16, width: '75%' }}></div>
                </div>
              </div>
            ) : confirmedPlan ? (
              /* Plan Confirmed View */
              <div className={`plan-confirmed-card ${!confirmedPlan.allSkippedHaveFreeAlt ? 'has-warning' : ''}`}>
                <div className="plan-celebration-title">
                  <span>{confirmedPlan.allSkippedHaveFreeAlt ? '🎉' : '⚠️'}</span>
                  <span>
                    {confirmedPlan.allSkippedHaveFreeAlt
                      ? 'Clash-Free Plan Confirmed!'
                      : 'Plan Selected (Has Overlap)'}
                  </span>
                </div>
                <div className="plan-celebration-sub">
                  Here is your plan for Section {section} on {confirmedPlan.dateFormatted}:
                </div>

                <div className="plan-steps-container">
                  {confirmedPlan.isSingleSameDayFree && confirmedPlan.isAltEarlier ? (
                    <>
                      <div className="same-day-solution-banner">
                        ⚡ <strong>Same-Day Plan ({confirmedPlan.dateFormatted}):</strong> Attend <strong>{confirmedPlan.others[0].session.course}</strong> first at {confirmedPlan.others[0].bestAlternate.timeFormatted}, then stay for <strong>{confirmedPlan.kept.session.course}</strong> at {confirmedPlan.keptTime}.
                      </div>
                      <div className="step-box alt-step">
                        <div className="step-header alt">
                          <span>1️⃣</span> <span>Step 1 · Attend Earlier at {confirmedPlan.others[0].bestAlternate.timeFormatted}</span>
                        </div>
                        <div className="step-body-main">
                          {confirmedPlan.others[0].session.course} {confirmedPlan.others[0].session.no ? `(Session #${confirmedPlan.others[0].session.no})` : ''}
                        </div>
                        <div className="step-body-sub">
                          📅 {confirmedPlan.dateFormatted} · 📍 Room: <strong>{confirmedPlan.others[0].bestAlternate.room || 'TBD'}</strong> (with Section {confirmedPlan.others[0].bestAlternate.sections.join(', ')})
                        </div>
                      </div>
                      <div className="step-box today-step">
                        <div className="step-header today">
                          <span>2️⃣</span> <span>Step 2 · Attend at {confirmedPlan.keptTime}</span>
                        </div>
                        <div className="step-body-main">
                          {confirmedPlan.kept.session.course} {confirmedPlan.kept.session.no ? `(Session #${confirmedPlan.kept.session.no})` : ''}
                        </div>
                        <div className="step-body-sub">
                          📅 {confirmedPlan.dateFormatted} · 📍 Room: <strong>{confirmedPlan.kept.session.room || 'TBD'}</strong> (with Section {section})
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="step-box today-step">
                        <div className="step-header today">
                          <span>1️⃣</span> <span>Step 1 · Attend on {confirmedPlan.dateFormatted} ({confirmedPlan.keptTime})</span>
                        </div>
                        <div className="step-body-main">
                          {confirmedPlan.kept.session.course} {confirmedPlan.kept.session.no ? `(Session #${confirmedPlan.kept.session.no})` : ''}
                        </div>
                        <div className="step-body-sub">
                          📍 Room: <strong>{confirmedPlan.kept.session.room || 'TBD'}</strong> (with Section {section})
                        </div>
                      </div>

                      {confirmedPlan.others.map((o, idx) => {
                        const alt = o.bestAlternate;
                        const isAltFree = alt && alt.free;
                        const stepNo = confirmedPlan.others.length > 1 ? `2${String.fromCharCode(97 + idx)}` : '2️⃣';
                        return (
                          <div key={o.session.id} className={`step-box ${!alt ? 'danger-step' : isAltFree ? 'alt-step' : 'warn-step'}`}>
                            <div className={`step-header ${!alt ? 'danger' : isAltFree ? 'alt' : 'warn'}`}>
                              <span>{stepNo}</span>
                              <span>
                                {!alt
                                  ? `No Alternate Available for ${o.session.course}`
                                  : isAltFree
                                    ? `Step 2 · Attend Alternate Session`
                                    : `Step 2 · Alternate Overlaps Existing Class`}
                              </span>
                            </div>
                            <div className="step-body-main">
                              {o.session.course} {o.session.no ? `(Session #${o.session.no})` : ''}
                            </div>
                            {alt ? (
                              <div className="step-body-sub">
                                📅 {formatDisplayDate(alt.date, alt.dow)} @ {alt.timeFormatted} · 📍 Room: <strong>{alt.room || 'TBD'}</strong> (with Section {alt.sections.join(', ')})
                                {!alt.free && alt.conflictsWith?.length > 0 && (
                                  <div style={{ color: 'var(--google-red)', fontWeight: 700, marginTop: 4 }}>
                                    ⚠️ Overlaps with your {alt.conflictsWith.map(c => `${c.course} (${c.timeFormatted})`).join(', ')}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div className="step-body-sub" style={{ color: 'var(--google-red)', fontWeight: 600 }}>
                                No other section offers this session. Please consult Academic Operations.
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </>
                  )}
                </div>

                <div className="plan-action-row">
                  <button
                    className="copy-whatsapp-btn"
                    style={{ width: '100%', justifyContent: 'center', padding: 12, fontSize: 14 }}
                    onClick={() => copyToClipboard(confirmedPlan.copyText)}
                  >
                    📋 Copy Plan for WhatsApp / Notes
                  </button>
                  {confirmedPlan.others.map(o =>
                    o.totalAlternates > 0 && (
                      <button
                        key={o.session.id}
                        className="back-nav-btn"
                        style={{ width: '100%', justifyContent: 'center', padding: '6px 0', marginBottom: 0 }}
                        onClick={() => openAlternatesForSession(o.session.id, 'clash')}
                      >
                        🔍 View All {pluralize(o.totalAlternates, 'Alternate', 'Alternates')} for {o.session.course} →
                      </button>
                    )
                  )}
                  <button
                    className="back-nav-btn"
                    style={{ width: '100%', justifyContent: 'center', color: 'var(--text-secondary)', padding: '6px 0', marginBottom: 0 }}
                    onClick={() => setConfirmedPlan(null)}
                  >
                    ↺ Choose a Different Option
                  </button>
                  <button
                    className="back-nav-btn"
                    style={{ width: '100%', justifyContent: 'center', color: 'var(--text-secondary)', padding: '6px 0', marginBottom: 0 }}
                    onClick={() => setActiveTab('schedule')}
                  >
                    ← Done & Back to My Schedule
                  </button>
                </div>
              </div>
            ) : (
              <div>
                {/* Recommendation / Conflict Warning Banner */}
                {activeCluster?.recommendation?.reason && (
                  <div className={`recommendation-banner ${activeCluster.recommendation.hasClashFreeOption ? '' : 'warning'}`}>
                    <div className="rec-tag">
                      {activeCluster.recommendation.hasClashFreeOption ? '💡 ' : '⚠️ '}
                      {activeCluster.recommendation.badgeText || 'Recommendation'}
                    </div>
                    <div className="rec-text">{activeCluster.recommendation.reason}</div>
                  </div>
                )}

                {/* Decision Cards — handles 2-way and 3+ way clashes uniformly */}
                {activeCluster?.evaluatedSessions?.map((kept, idx) => {
                  const others = activeCluster.evaluatedSessions.filter(o => o.session.id !== kept.session.id);
                  const isRec = activeCluster.recommendation?.attendSessionId === kept.session.id;
                  const keptTime = `${formatMinTo12h(kept.session.startMin)} – ${formatMinTo12h(kept.session.endMin)}`;
                  const clashDateFormatted = getClashContextDate(activeClashDay.date, activeCluster.dow || activeClashDay.dow);

                  const primaryOther = others[0];
                  const isSingleSameDayFree = others.length === 1 &&
                    primaryOther?.bestAlternate &&
                    primaryOther.bestAlternate.free &&
                    primaryOther.bestAlternate.date === activeClashDay.date;
                  const isAltEarlier = isSingleSameDayFree && (primaryOther.bestAlternate.startMin < kept.session.startMin);
                  const allFree = others.every(o => o.bestAlternate && o.bestAlternate.free);

                  return (
                    <div
                      key={kept.session.id}
                      className={`decision-choice-card ${isRec ? 'is-recommended' : ''}`}
                    >
                      <div className="decision-top">
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: 2 }}>
                            CHOICE {idx + 1} · ATTEND IN YOUR SECTION
                          </div>
                          <div className="decision-course-name">
                            Keep {kept.session.course}
                            {kept.session.no && (
                              <span style={{ fontSize: 14, color: 'var(--google-blue)', fontWeight: 600 }}> (Session #{kept.session.no})</span>
                            )}
                          </div>
                          <div className="decision-subtitle">
                            Go to your regular {keptTime} class with Section {section}, and shift {others.map(o => o.session.course).join(' & ')}.
                          </div>
                        </div>
                        {isRec && (
                          <span className="pill-badge" style={{ background: 'var(--google-green)', color: '#FFF', fontWeight: 700 }}>
                            ⭐ Best Plan
                          </span>
                        )}
                      </div>

                      {isSingleSameDayFree && isAltEarlier ? (
                        <>
                          <div className="same-day-solution-banner">
                            ⚡ <strong>Same-Day Solution:</strong> Take <strong>{primaryOther.session.course}</strong> earlier at {primaryOther.bestAlternate.timeFormatted}, then attend <strong>{kept.session.course}</strong> at {keptTime} on {clashDateFormatted}.
                          </div>
                          <div className="step-box alt-step">
                            <div className="step-header alt">
                              <span>1️⃣</span> <span>Step 1 · Attend Earlier at {primaryOther.bestAlternate.timeFormatted}</span>
                            </div>
                            <div className="step-body-main">
                              {primaryOther.session.course} in Room {primaryOther.bestAlternate.room || 'TBD'}
                            </div>
                            <div className="step-body-sub">
                              📅 {clashDateFormatted} · 👥 With Section {primaryOther.bestAlternate.sections.join(', ')} {' '}
                              <span style={{ color: 'var(--google-green)', fontWeight: 700 }}>(✅ Free for Section {section})</span>
                            </div>
                          </div>
                          <div className="step-box today-step">
                            <div className="step-header today">
                              <span>2️⃣</span> <span>Step 2 · Attend at {keptTime}</span>
                            </div>
                            <div className="step-body-main">
                              {kept.session.course} in Room {kept.session.room || 'TBD'}
                            </div>
                            <div className="step-body-sub">
                              📅 {clashDateFormatted} · Your regular Section {section} class
                            </div>
                          </div>
                        </>
                      ) : isSingleSameDayFree && !isAltEarlier ? (
                        <>
                          <div className="same-day-solution-banner">
                            ⚡ <strong>Same-Day Solution:</strong> Attend <strong>{kept.session.course}</strong> at {keptTime}, then take <strong>{primaryOther.session.course}</strong> later at {primaryOther.bestAlternate.timeFormatted} on {clashDateFormatted}.
                          </div>
                          <div className="step-box today-step">
                            <div className="step-header today">
                              <span>1️⃣</span> <span>Step 1 · Attend at {keptTime}</span>
                            </div>
                            <div className="step-body-main">
                              {kept.session.course} in Room {kept.session.room || 'TBD'}
                            </div>
                            <div className="step-body-sub">
                              📅 {clashDateFormatted} · Your regular Section {section} class
                            </div>
                          </div>
                          <div className="step-box alt-step">
                            <div className="step-header alt">
                              <span>2️⃣</span> <span>Step 2 · Attend Later at {primaryOther.bestAlternate.timeFormatted}</span>
                            </div>
                            <div className="step-body-main">
                              {primaryOther.session.course} in Room {primaryOther.bestAlternate.room || 'TBD'}
                            </div>
                            <div className="step-body-sub">
                              📅 {clashDateFormatted} · 👥 With Section {primaryOther.bestAlternate.sections.join(', ')} {' '}
                              <span style={{ color: 'var(--google-green)', fontWeight: 700 }}>(✅ Free for Section {section})</span>
                            </div>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="step-box today-step">
                            <div className="step-header today">
                              <span>1️⃣</span> <span>Step 1 · Attend on {clashDateFormatted} ({keptTime})</span>
                            </div>
                            <div className="step-body-main">Walk into Room {kept.session.room || 'TBD'} for {kept.session.course}</div>
                            <div className="step-body-sub">Your regular class with Section {section}</div>
                          </div>

                          {others.map((other, oIdx) => {
                            const alt = other.bestAlternate;
                            const stepTag = others.length > 1 ? `2${String.fromCharCode(97 + oIdx)}` : '2️⃣';
                            if (other.hasNoAlternates || !alt) {
                              return (
                                <div key={other.session.id} className="step-box danger-step">
                                  <div className="step-header danger">
                                    <span>🚫</span> <span>Step {stepTag} · No Alternate for {other.session.course}</span>
                                  </div>
                                  <div className="step-body-main" style={{ color: 'var(--google-red)' }}>
                                    No alternate session exists in any other section!
                                  </div>
                                  <div className="step-body-sub">
                                    If you skip {other.session.course} on {clashDateFormatted}, there is no other section to attend.
                                  </div>
                                </div>
                              );
                            }

                            const altDateStr = getClashContextDate(alt.date, alt.dow);
                            const conflictsText = alt.conflictsWith?.map(c => `${c.course} (${c.timeFormatted})`).join(', ');
                            return (
                              <div key={other.session.id} className={`step-box ${alt.free ? 'alt-step' : 'warn-step'}`}>
                                <div className={`step-header ${alt.free ? 'alt' : 'warn'}`}>
                                  <span>{alt.free ? stepTag : '⚠️'}</span>
                                  <span>
                                    {alt.free
                                      ? `Step ${stepTag} · Attend ${other.session.course} on ${formatDisplayDate(alt.date, alt.dow)}`
                                      : `Step ${stepTag} · Only Alternate for ${other.session.course} Overlaps`}
                                  </span>
                                </div>
                                <div className="step-body-main">
                                  📅 {altDateStr} · 🕒 {alt.timeFormatted}
                                </div>
                                <div className="step-body-sub">
                                  📍 Room: {alt.room || 'TBD'} · 👥 With Section {alt.sections.join(', ')} {' '}
                                  {alt.free ? (
                                    <span style={{ color: 'var(--google-green)', fontWeight: 700 }}>
                                      (✅ Free for Section {section})
                                    </span>
                                  ) : (
                                    <div style={{ color: 'var(--google-red)', fontWeight: 700, marginTop: 4 }}>
                                      ⚠️ Overlaps with your {conflictsText || 'scheduled class'}! You cannot attend both at {alt.timeFormatted}.
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </>
                      )}

                      {/* Action Button */}
                      <button
                        className={`action-attend-btn ${isRec ? 'recommended' : allFree ? '' : 'warning-btn'}`}
                        style={{ marginTop: 10 }}
                        onClick={() => handleConfirmPlan(kept.session.id)}
                      >
                        {allFree
                          ? `${isRec ? '⭐ ' : '👉 '}Confirm Plan: ${isSingleSameDayFree ? `Attend Both on ${formatDisplayDate(activeClashDay.date, activeCluster.dow)}` : `Attend ${kept.session.course} on ${formatDisplayDate(activeClashDay.date, activeCluster.dow)}`}`
                          : `⚠️ Select ${kept.session.course} (Has Overlap Warning)`}
                      </button>

                      {/* Secondary Links to View All Alternates */}
                      {others.map(other =>
                        !other.hasNoAlternates && other.totalAlternates > 0 && (
                          <div key={other.session.id} style={{ textAlign: 'center', marginTop: 8 }}>
                            <a
                              href="#"
                              onClick={(e) => {
                                e.preventDefault();
                                openAlternatesForSession(other.session.id, 'clash');
                              }}
                              style={{ fontSize: 13, color: 'var(--google-blue)', textDecoration: 'underline', fontWeight: 600 }}
                            >
                              View all {pluralize(other.totalAlternates, 'alternate slot', 'alternate slots')} for {other.session.course} →
                            </a>
                          </div>
                        )
                      )}
                    </div>
                  );
                })}

                <button
                  className="back-nav-btn"
                  style={{ width: '100%', justifyContent: 'center', marginTop: 4 }}
                  onClick={() => setActiveTab('schedule')}
                >
                  ← Back to My Schedule
                </button>
              </div>
            )}
          </div>
        )}

        {/* ============================================================ */}
        {/* TAB 3: ALTERNATES RESULTS LIST                               */}
        {/* ============================================================ */}
        {activeTab === 'alternates' && (
          <div>
            <button
              className="back-nav-btn"
              onClick={() => setActiveTab(alternatesReturnTab === 'clash' && activeClashDay ? 'clash' : 'schedule')}
            >
              {alternatesReturnTab === 'clash' && activeClashDay ? '← Back to Clash Options' : '← Back to My Schedule'}
            </button>

            {skippedSession && (
              <div className="skipped-summary-banner">
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--google-amber)', marginBottom: 2, textTransform: 'uppercase' }}>
                  ALL ALTERNATE TIMINGS
                </div>
                <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>
                  {skippedSession.course} {skippedSession.no ? `(Session #${skippedSession.no})` : ''}
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
                  Your regular Section {section} slot: {formatDisplayDate(skippedSession.date, skippedSession.dow)} at {formatMinTo12h(skippedSession.startMin)}
                </div>
              </div>
            )}

            {loadingAlternates ? (
              <div>
                <div className="skeleton-card">
                  <div className="skeleton-bar" style={{ height: 20, width: '60%', marginBottom: 12 }}></div>
                  <div className="skeleton-bar" style={{ height: 14, width: '80%' }}></div>
                </div>
                <div className="skeleton-card">
                  <div className="skeleton-bar" style={{ height: 20, width: '50%', marginBottom: 12 }}></div>
                  <div className="skeleton-bar" style={{ height: 14, width: '70%' }}></div>
                </div>
              </div>
            ) : !alternatesData?.rows || alternatesData.rows.length === 0 ? (
              <div className="empty-state-box">
                <div style={{ fontSize: 32, marginBottom: 8 }}>⚠️</div>
                <p style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>
                  {alternatesData?.message || 'No alternates found for this session.'}
                </p>
                <p style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
                  No other section is offering this session. Please contact Academic Operations.
                </p>
              </div>
            ) : (
              alternatesData.rows.map((alt, idx) => {
                const isFree = alt.free;
                const sectionsStr = alt.sections.join(', ');
                const dateFormatted = formatDisplayDate(alt.date, alt.dow);
                const sessPart = alt.no ? ` Session #${alt.no}` : '';
                const copyText = `${alt.course}${sessPart} | ${alt.dow} ${alt.date} | ${alt.timeFormatted} | Room: ${alt.room} | Section ${sectionsStr}`;

                return (
                  <div
                    key={idx}
                    className={`alt-recommendation-card ${isFree ? 'free' : 'conflict'}`}
                  >
                    <div className="recommendation-rank">
                      {isFree
                        ? (idx === 0 ? '⭐ Best Match (Free for You)' : '✅ Clash-Free Option')
                        : '⚠️ Overlaps With Your Section Timetable'}
                    </div>

                    <div className="alt-header-row">
                      <div className="alt-datetime">{dateFormatted} · {alt.timeFormatted}</div>
                      <div>
                        {isFree ? (
                          <span className="pill-badge" style={{ background: 'var(--google-green-surface)', color: 'var(--google-green)', fontWeight: 700 }}>
                            Free for Sec {section}
                          </span>
                        ) : (
                          <span className="pill-badge" style={{ background: 'var(--google-red-surface)', color: 'var(--google-red)' }}>
                            Conflicts
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="card-details-row" style={{ marginBottom: 12 }}>
                      <span className="detail-item">📍 Room: <strong>{alt.room}</strong></span>
                      <span className="detail-item">👥 Section: <strong>{sectionsStr}</strong></span>
                      {alt.sameDay && (
                        <span className="detail-item" style={{ color: 'var(--google-blue)', fontWeight: 600 }}>
                          ✨ Same Day
                        </span>
                      )}
                    </div>

                    {!isFree && alt.conflictsWith && alt.conflictsWith.length > 0 && (
                      <div style={{ fontSize: 12.5, color: 'var(--google-red)', fontWeight: 600, marginBottom: 10, background: 'var(--google-red-surface)', padding: '8px 10px', borderRadius: 6 }}>
                        ⚠️ Overlaps with your {alt.conflictsWith.map(c => `${c.course} (${c.timeFormatted})`).join(', ')}
                      </div>
                    )}

                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                      <button
                        className="copy-whatsapp-btn"
                        onClick={() => copyToClipboard(copyText)}
                      >
                        📋 Copy Class Details
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* ============================================================ */}
        {/* TAB 4: SUBJECT BROWSER                                       */}
        {/* ============================================================ */}
        {activeTab === 'subject' && (
          <div>
            <div className="form-card">
              <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>Find Any Class Across All Sections</h3>

              <label className="form-label" htmlFor="subject-search-box">Search Course (optional)</label>
              <input
                id="subject-search-box"
                type="text"
                className="form-input"
                placeholder="Type course name, e.g. Valuation, Marketing…"
                value={courseSearch}
                onChange={(e) => setCourseSearch(e.target.value)}
              />

              <label className="form-label" htmlFor="subject-course-picker">1. Select Course</label>
              <select
                id="subject-course-picker"
                className="form-select"
                value={selectedCourse}
                onChange={(e) => handleCourseChange(e.target.value)}
              >
                <option value="">-- Select a Course --</option>
                {filteredCourses.map(c => (
                  <option key={c.name} value={c.name}>
                    {c.name} ({pluralize(c.maxNo, 'session', 'sessions')})
                  </option>
                ))}
              </select>

              <label className="form-label" htmlFor="subject-session-picker">2. Select Session Number</label>
              <select
                id="subject-session-picker"
                className="form-select"
                value={selectedSessionNo}
                onChange={(e) => handleSessionChange(e.target.value)}
                disabled={!selectedCourse}
              >
                <option value="">{selectedCourse ? '-- Select Session # --' : '-- Select Course First --'}</option>
                {selectedCourseObj &&
                  Array.from({ length: selectedCourseObj.maxNo }, (_, i) => (
                    <option key={i + 1} value={i + 1}>
                      Session #{i + 1}
                    </option>
                  ))}
              </select>

              <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                Checking against your <strong>Section {section}</strong> timetable to show which slots are free.
              </div>
            </div>

            {loadingSubject ? (
              <div className="skeleton-card">
                <div className="skeleton-bar" style={{ height: 80 }}></div>
              </div>
            ) : selectedCourse && selectedSessionNo && subjectOfferings.length === 0 ? (
              <div className="empty-state-box">
                <p style={{ fontWeight: 700, fontSize: 15 }}>No active slots found for {selectedCourse} Session #{selectedSessionNo}.</p>
              </div>
            ) : (
              subjectOfferings.map((r, idx) => {
                const dateFormatted = formatDisplayDate(r.date, r.dow);
                const sectionsStr = r.sections.join(', ');
                const copyText = formatSubjectCopyText(r);
                const isOwnSectionSlot = r.sections.includes(section);
                const otherConflicts = (r.conflictsWith || []).filter(c => !(c.course === r.course && c.startMin === r.startMin));

                return (
                  <div key={idx} className={`class-card ${isOwnSectionSlot ? (otherConflicts.length > 0 ? 'clash' : '') : r.free ? 'alternate' : 'clash'}`} style={{ marginBottom: 10 }}>
                    <div className="card-top-row">
                      <div className="course-name">{dateFormatted} · {r.timeFormatted}</div>
                      <div className="card-badges">
                        {isOwnSectionSlot ? (
                          <span className="pill-badge badge-session">
                            📘 Your Section ({section}){otherConflicts.length > 0 ? ' · Clash' : ''}
                          </span>
                        ) : r.free ? (
                          <span className="pill-badge" style={{ background: 'var(--google-green-surface)', color: 'var(--google-green)', fontWeight: 700 }}>
                            ✅ Free for Section {section}
                          </span>
                        ) : (
                          <span className="pill-badge" style={{ background: 'var(--google-red-surface)', color: 'var(--google-red)' }}>
                            ⚠️ Overlaps Section {section}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="card-details-row" style={{ marginBottom: 8 }}>
                      <span className="detail-item">📍 Room: <strong>{r.room}</strong></span>
                      <span className="detail-item">👥 Section: <strong>{sectionsStr}</strong></span>
                    </div>

                    {isOwnSectionSlot && otherConflicts.length > 0 && (
                      <div style={{ fontSize: 12.5, color: 'var(--google-red)', fontWeight: 600, marginBottom: 8 }}>
                        Your Section {section} also has {otherConflicts.map(c => c.course).join(', ')} at this time
                      </div>
                    )}
                    {!isOwnSectionSlot && !r.free && r.conflictsWith?.length > 0 && (
                      <div style={{ fontSize: 12.5, color: 'var(--google-red)', fontWeight: 600, marginBottom: 8 }}>
                        Overlaps with your: {r.conflictsWith.map(c => `${c.course} (${c.timeFormatted})`).join(', ')}
                      </div>
                    )}

                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <button
                        className="copy-whatsapp-btn"
                        onClick={() => copyToClipboard(copyText)}
                      >
                        📋 Copy Details
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* ============================================================ */}
        {/* TAB 5: HELP & STATUS                                         */}
        {/* ============================================================ */}
        {activeTab === 'status' && (
          <div>
            <div className="form-card">
              <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>How to Use This App (3 Simple Steps)</h3>
              <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 12 }}>
                Made for <strong>Masters&apos; Union Cohort 7</strong> students to solve same-time class clashes easily.
              </p>
              <div className="help-step-list">
                <div className="help-step-item">
                  <span className="help-step-num">1</span>
                  <div><strong>Tap your Section (A–H)</strong> at the top. The app saves your choice automatically.</div>
                </div>
                <div className="help-step-item">
                  <span className="help-step-num">2</span>
                  <div><strong>Look for red boxes</strong> saying &quot;Fix This Clash →&quot; on any day where two classes happen at the same time.</div>
                </div>
                <div className="help-step-item">
                  <span className="help-step-num">3</span>
                  <div><strong>Pick Choice 1 or Choice 2</strong>, tap Confirm, and copy your plan for WhatsApp or Notes.</div>
                </div>
              </div>
            </div>

            <div className="form-card">
              <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>What the Colors & Labels Mean</h3>
              <div style={{ fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.8 }}>
                <div>🔴 <strong>Red Border (Clash):</strong> Two classes overlap at the same time in your section.</div>
                <div>🟢 <strong>Green Badge (Free):</strong> Attending another section at this time will NOT clash with your classes.</div>
                <div>🟡 <strong>Amber Warning (Overlaps):</strong> You already have another class at that alternate time.</div>
                <div>🔵 <strong>Blue Border (Regular Class):</strong> Normal scheduled class in your section.</div>
              </div>
            </div>

            <div className="form-card">
              <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>Live Timetable Status</h3>
              <div style={{ fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.8, marginBottom: 12 }}>
                <div><strong>Cohort & Term:</strong> {statusInfo?.termLabel || 'Cohort 7 — Term 3'}</div>
                <div><strong>Auto-Update Schedule:</strong> Checks Google Sheets every {statusInfo?.refreshMinutes || 5} minutes</div>
                {lastSyncedTime && <div><strong>Last Checked (IST):</strong> {lastSyncedTime}</div>}
                <div><strong>Total Academic Classes Tracked:</strong> {statusInfo?.counts?.active ?? '—'}</div>
                <div><strong>Status:</strong> {statusInfo?.status === 'HEALTHY' ? '✅ Up to date & working normally' : 'Checking…'}</div>
              </div>
              <button
                className="action-attend-btn"
                onClick={() => fetchAllLiveMeta(true)}
                disabled={refreshing}
              >
                {refreshing ? '🔄 Refreshing Timetable…' : '🔄 Refresh Timetable Now'}
              </button>
            </div>
          </div>
        )}
      </main>

      <div id="toast" className={toastMessage ? 'show' : ''}>
        {toastMessage}
      </div>
    </div>
  );
}
