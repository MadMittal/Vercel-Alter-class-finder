'use client';

import React, { useState, useEffect } from 'react';

const SECTIONS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export default function Home() {
  const [section, setSection] = useState('A');
  const [dateFilter, setDateFilter] = useState('today_tomorrow');
  const [activeTab, setActiveTab] = useState('schedule');
  const [bootstrap, setBootstrap] = useState(null);
  const [timetableDays, setTimetableDays] = useState([]);
  const [loadingSchedule, setLoadingSchedule] = useState(true);
  
  // Clash resolver state
  const [activeClashDay, setActiveClashDay] = useState(null);
  const [clashAdvice, setClashAdvice] = useState(null);
  const [loadingClash, setLoadingClash] = useState(false);
  const [confirmedPlan, setConfirmedPlan] = useState(null);
  
  // Alternates tab state
  const [skippedSession, setSkippedSession] = useState(null);
  const [alternatesData, setAlternatesData] = useState(null);
  const [loadingAlternates, setLoadingAlternates] = useState(false);

  // Subject browser state
  const [selectedCourse, setSelectedCourse] = useState('');
  const [selectedSessionNo, setSelectedSessionNo] = useState('');
  const [subjectOfferings, setSubjectOfferings] = useState([]);
  const [loadingSubject, setLoadingSubject] = useState(false);

  // Status diagnostics
  const [statusInfo, setStatusInfo] = useState(null);
  const [toastMessage, setToastMessage] = useState('');

  // Initial load
  useEffect(() => {
    const savedSec = localStorage.getItem('mu_user_section');
    if (savedSec && SECTIONS.includes(savedSec)) {
      setSection(savedSec);
    }
    fetchBootstrap();
    fetchStatus();
  }, []);

  // Fetch timetable when section or dateFilter changes
  useEffect(() => {
    if (activeTab === 'schedule') {
      fetchTimetable();
    }
  }, [section, dateFilter, activeTab]);

  function showToast(msg) {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(''), 2500);
  }

  function handleSectionChange(sec) {
    setSection(sec);
    localStorage.setItem('mu_user_section', sec);
    if (activeTab === 'clash' || activeTab === 'alternates') {
      setActiveTab('schedule');
    }
  }

  async function fetchBootstrap() {
    try {
      const res = await fetch('/api/bootstrap');
      const json = await res.json();
      if (json.ok) {
        setBootstrap(json.data);
      }
    } catch (err) {
      console.error('Bootstrap failed:', err);
    }
  }

  async function fetchStatus() {
    try {
      const res = await fetch('/api/status');
      const json = await res.json();
      if (json.ok) {
        setStatusInfo(json.data);
      }
    } catch (err) {
      console.error('Status fetch failed:', err);
    }
  }

  function getDateRange() {
    const today = bootstrap?.today || new Date().toISOString().slice(0, 10);
    const [y, m, d] = today.split('-').map(Number);

    if (dateFilter === 'today_tomorrow') {
      const tomorrow = new Date(Date.UTC(y, m - 1, d + 1));
      return { from: today, to: tomorrow.toISOString().slice(0, 10) };
    } else if (dateFilter === '7d') {
      const to7 = new Date(Date.UTC(y, m - 1, d + 7));
      return { from: today, to: to7.toISOString().slice(0, 10) };
    } else if (dateFilter === '15d') {
      const to15 = new Date(Date.UTC(y, m - 1, d + 15));
      return { from: today, to: to15.toISOString().slice(0, 10) };
    } else {
      return { from: '2026-11-01', to: '2027-03-31' };
    }
  }

  async function fetchTimetable() {
    setLoadingSchedule(true);
    try {
      const { from, to } = getDateRange();
      const res = await fetch(`/api/timetable?section=${section}&from=${from}&to=${to}`);
      const json = await res.json();
      if (json.ok) {
        setTimetableDays(json.data.days || []);
      } else {
        setTimetableDays([]);
      }
    } catch (err) {
      showToast('Error loading schedule');
    } finally {
      setLoadingSchedule(false);
    }
  }

  async function openClashResolver(day) {
    setActiveClashDay(day);
    setConfirmedPlan(null);
    setActiveTab('clash');
    setLoadingClash(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });

    try {
      const res = await fetch(`/api/clash-advice?section=${section}&date=${day.date}`);
      const json = await res.json();
      if (json.ok) {
        setClashAdvice(json.data);
      } else {
        showToast(json.error?.message || 'Error analyzing clash');
      }
    } catch (err) {
      showToast('Error loading clash recommendations');
    } finally {
      setLoadingClash(false);
    }
  }

  function handleConfirmPlan(keptSessionId) {
    if (!clashAdvice?.evaluatedSessions) return;
    const sessions = clashAdvice.evaluatedSessions;
    const kept = sessions.find(s => s.session.id === keptSessionId);
    const other = sessions.find(s => s.session.id !== keptSessionId);

    if (!kept || !other) return;

    const dateFormatted = formatDisplayDate(clashAdvice.date, clashAdvice.dow);
    const keptTime = formatMinTo12h(kept.session.startMin) + ' – ' + formatMinTo12h(kept.session.endMin);

    const isSameDayAlt = other.bestAlternate && other.bestAlternate.date === clashAdvice.date;
    const isAltEarlier = isSameDayAlt && (other.bestAlternate.startMin < kept.session.startMin);

    let copyText = '';
    if (isSameDayAlt && isAltEarlier) {
      copyText = `🎓 Masters' Union Clash Plan (Section ${section})\n` +
        `📅 Date: ${dateFormatted}\n` +
        `-----------------------------------------\n` +
        `⚡ SAME-DAY ATTENDANCE PLAN:\n` +
        `1️⃣ ${other.bestAlternate.timeFormatted}: Attend ${other.session.course} ${other.session.no ? '(Session #' + other.session.no + ')' : ''}\n` +
        `   • Room: ${other.bestAlternate.room || 'TBD'} (with Section ${other.bestAlternate.sections.join(', ')})\n\n` +
        `2️⃣ ${keptTime}: Attend ${kept.session.course} ${kept.session.no ? '(Session #' + kept.session.no + ')' : ''}\n` +
        `   • Room: ${kept.session.room || 'TBD'} (with Section ${section})\n` +
        `-----------------------------------------\n` +
        `⚠️ Note: If either class has a Quiz or Graded Evaluation, attend that class in your own section and take the other class in an alternate slot or section.`;
    } else if (isSameDayAlt && !isAltEarlier) {
      copyText = `🎓 Masters' Union Clash Plan (Section ${section})\n` +
        `📅 Date: ${dateFormatted}\n` +
        `-----------------------------------------\n` +
        `⚡ SAME-DAY ATTENDANCE PLAN:\n` +
        `1️⃣ ${keptTime}: Attend ${kept.session.course} ${kept.session.no ? '(Session #' + kept.session.no + ')' : ''}\n` +
        `   • Room: ${kept.session.room || 'TBD'} (with Section ${section})\n\n` +
        `2️⃣ ${other.bestAlternate.timeFormatted}: Attend ${other.session.course} ${other.session.no ? '(Session #' + other.session.no + ')' : ''}\n` +
        `   • Room: ${other.bestAlternate.room || 'TBD'} (with Section ${other.bestAlternate.sections.join(', ')})\n` +
        `-----------------------------------------\n` +
        `⚠️ Note: If either class has a Quiz or Graded Evaluation, attend that class in your own section and take the other class in an alternate slot or section.`;
    } else {
      const altDetails = other.bestAlternate
        ? `${formatDisplayDate(other.bestAlternate.date, other.bestAlternate.dow)} @ ${other.bestAlternate.timeFormatted} in Room ${other.bestAlternate.room} (with Section ${other.bestAlternate.sections.join(', ')})`
        : 'No alternate scheduled in other sections.';
      copyText = `🎓 Masters' Union Clash Plan (Section ${section})\n` +
        `📅 Date: ${dateFormatted} (${clashAdvice.timeFormatted || keptTime})\n` +
        `-----------------------------------------\n` +
        `✅ 1. ATTEND ON ${dateFormatted}:\n` +
        `   • ${kept.session.course} ${kept.session.no ? '(Session #' + kept.session.no + ')' : ''}\n` +
        `   • Room: ${kept.session.room || 'TBD'} @ ${keptTime}\n\n` +
        `🎯 2. TAKE ALTERNATE:\n` +
        `   • ${other.session.course} ${other.session.no ? '(Session #' + other.session.no + ')' : ''}\n` +
        `   • ${altDetails}\n` +
        `-----------------------------------------\n` +
        `⚠️ Note: If either class has a Quiz or Graded Evaluation, attend that class in your own section and take the other class in an alternate slot or section.`;
    }

    setConfirmedPlan({
      kept,
      other,
      dateFormatted,
      keptTime,
      copyText,
      isSameDayAlt,
      isAltEarlier,
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function openAlternatesForSession(sessionId) {
    setActiveTab('alternates');
    setLoadingAlternates(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });

    try {
      const res = await fetch(`/api/alternates?section=${section}&sessionId=${sessionId}`);
      const json = await res.json();
      if (json.ok) {
        setAlternatesData(json.data);
        setSkippedSession(json.data.skipped);
      } else {
        showToast(json.error?.message || 'Error finding alternates');
      }
    } catch (err) {
      showToast('Error loading alternates');
    } finally {
      setLoadingAlternates(false);
    }
  }

  async function handleCourseChange(courseName) {
    setSelectedCourse(courseName);
    setSelectedSessionNo('');
    setSubjectOfferings([]);
  }

  async function handleSessionChange(no) {
    setSelectedSessionNo(no);
    if (!selectedCourse || !no) return;
    setLoadingSubject(true);

    try {
      const res = await fetch(`/api/subject?course=${encodeURIComponent(selectedCourse)}&sessionNo=${no}&section=${section}`);
      const json = await res.json();
      if (json.ok) {
        setSubjectOfferings(json.data.rows || []);
      }
    } catch (err) {
      showToast('Error loading subject offerings');
    } finally {
      setLoadingSubject(false);
    }
  }

  function copyToClipboard(text) {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text);
      showToast('Copied to clipboard!');
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
    const parts = isoDate.split('-').map(Number);
    const y = parts[0], mo = parts[1], d = parts[2];
    return `${dow || ''}, ${d} ${MONTHS[mo - 1]}`;
  }

  function getClashContextDate(isoDate, dow) {
    if (!isoDate) return '';
    const formatted = formatDisplayDate(isoDate, dow);
    const today = bootstrap?.todayDate || todayISO;
    if (today && isoDate === today) return `${formatted} (Today)`;
    if (today) {
      try {
        const d = new Date(today);
        d.setDate(d.getDate() + 1);
        if (isoDate === d.toISOString().slice(0, 10)) return `${formatted} (Tomorrow)`;
      } catch (_) {}
    }
    return formatted;
  }

  const todayISO = bootstrap?.today || new Date().toISOString().slice(0, 10);
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
          <div id="sync-pill" className="sync-status-pill">
            <span className="pulse-indicator"></span>
            <span>Vercel Edge Active</span>
          </div>
        </div>
      </header>

      <main className="app-container">
        {/* Section Selector */}
        <div className="section-nav-wrapper">
          <div className="section-nav-header">
            <span>SELECT YOUR SECTION:</span>
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
            className={`nav-tab-btn ${activeTab === 'schedule' ? 'active' : ''}`}
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
            ℹ️ Status & Help
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
                className={`filter-pill ${dateFilter === 'today_tomorrow' ? 'active' : ''}`}
                onClick={() => setDateFilter('today_tomorrow')}
              >
                ⚡ Today & Tomorrow
              </button>
              <button
                className={`filter-pill ${dateFilter === '7d' ? 'active' : ''}`}
                onClick={() => setDateFilter('7d')}
              >
                📅 Next 7 Days
              </button>
              <button
                className={`filter-pill ${dateFilter === '15d' ? 'active' : ''}`}
                onClick={() => setDateFilter('15d')}
              >
                📅 Next 15 Days
              </button>
              <button
                className={`filter-pill ${dateFilter === 'all' ? 'active' : ''}`}
                onClick={() => setDateFilter('all')}
              >
                🗓️ Entire Term
              </button>
            </div>

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
            ) : timetableDays.length === 0 ? (
              <div className="empty-state-box">
                <div style={{ fontSize: 32, marginBottom: 8 }}>☕</div>
                <p style={{ fontWeight: 700, fontSize: 16, color: 'var(--text-primary)', marginBottom: 4 }}>
                  No classes scheduled
                </p>
                <p style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
                  {dateFilter === 'today_tomorrow'
                    ? 'You have no classes today or tomorrow! Tap "Next 7 Days" or "Next 15 Days" to view upcoming classes.'
                    : 'No sessions found in this date range.'}
                </p>
              </div>
            ) : (
              timetableDays.map(d => {
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
                        <div className="clash-alert-pill" onClick={() => openClashResolver(d)}>
                          ⚠️ {clashingCount} Clashes — Resolve
                        </div>
                      )}
                    </div>

                    {d.sessions.map(s => {
                      const isCancelled = s.status === 'Cancelled';
                      const timeStr = `${formatMinTo12h(s.startMin)} – ${formatMinTo12h(s.endMin)}`;

                      return (
                        <div
                          key={s.id}
                          className={`class-card ${s.isClashing ? 'clash' : ''} ${isCancelled ? 'cancelled' : ''}`}
                        >
                          <div className="card-top-row">
                            <div className="course-name">{s.course}</div>
                            <div className="card-badges">
                              {s.no && <span className="pill-badge badge-session">Session #{s.no}</span>}
                              {s.isClashing && <span className="pill-badge badge-clash">Clash</span>}
                              {isCancelled && <span className="pill-badge badge-cancelled">Cancelled</span>}
                              {s.type !== 'Course' && (
                                <span className="pill-badge" style={{ background: '#EEEEEE' }}>{s.type}</span>
                              )}
                            </div>
                          </div>

                          <div className="card-details-row">
                            <span className="detail-item">🕒 <strong>{timeStr}</strong></span>
                            <span className="detail-item">📍 Room: <strong>{s.room || 'TBD'}</strong></span>
                            {s.section === 'ALL' && <span className="detail-item">👥 All Sections</span>}
                          </div>

                          {s.isClashing && (
                            <div className="clash-warning-box">
                              <span>⚠️ Overlaps with another class! We found smart alternates.</span>
                              <button className="resolve-clash-btn" onClick={() => openClashResolver(d)}>
                                Resolve →
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
              ← Back to Schedule
            </button>

            {/* Date Hero Banner */}
            {activeClashDay && (
              <div className="clash-date-hero">
                <div className="clash-date-calendar-icon">📅</div>
                <div>
                  <div className="clash-date-text">
                    {formatDisplayDate(activeClashDay.date, activeClashDay.dow)}
                  </div>
                  <div className="clash-time-subtext">
                    🕒 {clashAdvice?.timeFormatted || ''} · Section {section} Timetable Clash
                  </div>
                </div>
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
              <div className="plan-confirmed-card">
                <div className="plan-celebration-title">
                  <span>🎉</span> <span>Clash-Free Plan Confirmed!</span>
                </div>
                <div className="plan-celebration-sub">
                  Here is your plan for Section {section} on {confirmedPlan.dateFormatted}:
                </div>
                <div className="plan-steps-container">
                  {confirmedPlan.isSameDayAlt && confirmedPlan.isAltEarlier ? (
                    <>
                      <div className="same-day-solution-banner">
                        ⚡ <strong>Same-Day Plan ({confirmedPlan.dateFormatted}):</strong> Attend <strong>{confirmedPlan.other.session.course}</strong> at {confirmedPlan.other.bestAlternate.timeFormatted} and <strong>{confirmedPlan.kept.session.course}</strong> at {confirmedPlan.keptTime}.
                      </div>
                      <div className="step-box alt-step">
                        <div className="step-header alt">
                          <span>1️⃣</span> <span>Attend Earlier at {confirmedPlan.other.bestAlternate.timeFormatted}</span>
                        </div>
                        <div className="step-body-main">
                          {confirmedPlan.other.session.course} {confirmedPlan.other.session.no ? `(Session #${confirmedPlan.other.session.no})` : ''}
                        </div>
                        <div className="step-body-sub">
                          📅 {confirmedPlan.dateFormatted} · 📍 Room: <strong>{confirmedPlan.other.bestAlternate.room || 'TBD'}</strong> (with Section {confirmedPlan.other.bestAlternate.sections.join(', ')})
                        </div>
                      </div>

                      <div className="step-box today-step">
                        <div className="step-header today">
                          <span>2️⃣</span> <span>Attend at {confirmedPlan.keptTime}</span>
                        </div>
                        <div className="step-body-main">
                          {confirmedPlan.kept.session.course} {confirmedPlan.kept.session.no ? `(Session #${confirmedPlan.kept.session.no})` : ''}
                        </div>
                        <div className="step-body-sub">
                          📅 {confirmedPlan.dateFormatted} · 📍 Room: <strong>{confirmedPlan.kept.session.room || 'TBD'}</strong> (with Section {section})
                        </div>
                      </div>
                    </>
                  ) : confirmedPlan.isSameDayAlt && !confirmedPlan.isAltEarlier ? (
                    <>
                      <div className="same-day-solution-banner">
                        ⚡ <strong>Same-Day Plan ({confirmedPlan.dateFormatted}):</strong> Attend <strong>{confirmedPlan.kept.session.course}</strong> at {confirmedPlan.keptTime} and <strong>{confirmedPlan.other.session.course}</strong> at {confirmedPlan.other.bestAlternate.timeFormatted}.
                      </div>
                      <div className="step-box today-step">
                        <div className="step-header today">
                          <span>1️⃣</span> <span>Attend at {confirmedPlan.keptTime}</span>
                        </div>
                        <div className="step-body-main">
                          {confirmedPlan.kept.session.course} {confirmedPlan.kept.session.no ? `(Session #${confirmedPlan.kept.session.no})` : ''}
                        </div>
                        <div className="step-body-sub">
                          📅 {confirmedPlan.dateFormatted} · 📍 Room: <strong>{confirmedPlan.kept.session.room || 'TBD'}</strong> (with Section {section})
                        </div>
                      </div>

                      <div className="step-box alt-step">
                        <div className="step-header alt">
                          <span>2️⃣</span> <span>Attend Later at {confirmedPlan.other.bestAlternate.timeFormatted}</span>
                        </div>
                        <div className="step-body-main">
                          {confirmedPlan.other.session.course} {confirmedPlan.other.session.no ? `(Session #${confirmedPlan.other.session.no})` : ''}
                        </div>
                        <div className="step-body-sub">
                          📅 {confirmedPlan.dateFormatted} · 📍 Room: <strong>{confirmedPlan.other.bestAlternate.room || 'TBD'}</strong> (with Section {confirmedPlan.other.bestAlternate.sections.join(', ')})
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="step-box today-step">
                        <div className="step-header today">
                          <span>1️⃣</span> <span>Attend on {confirmedPlan.dateFormatted}</span>
                        </div>
                        <div className="step-body-main">
                          {confirmedPlan.kept.session.course} {confirmedPlan.kept.session.no ? `(Session #${confirmedPlan.kept.session.no})` : ''}
                        </div>
                        <div className="step-body-sub">
                          🕒 {confirmedPlan.dateFormatted} @ {confirmedPlan.keptTime} · 📍 Room: <strong>{confirmedPlan.kept.session.room || 'TBD'}</strong>
                        </div>
                      </div>

                      <div className="step-box alt-step">
                        <div className="step-header alt">
                          <span>2️⃣</span> <span>Attend Alternate Session</span>
                        </div>
                        <div className="step-body-main">
                          {confirmedPlan.other.session.course} {confirmedPlan.other.session.no ? `(Session #${confirmedPlan.other.session.no})` : ''}
                        </div>
                        {confirmedPlan.other.bestAlternate ? (
                          <div className="step-body-sub">
                            📅 {formatDisplayDate(confirmedPlan.other.bestAlternate.date, confirmedPlan.other.bestAlternate.dow)} @ {confirmedPlan.other.bestAlternate.timeFormatted} · 📍 Room: <strong>{confirmedPlan.other.bestAlternate.room || 'TBD'}</strong> (with Section {confirmedPlan.other.bestAlternate.sections.join(', ')})
                          </div>
                        ) : (
                          <div className="step-body-sub" style={{ color: 'var(--google-red)' }}>
                            No alternate session scheduled in any other section.
                          </div>
                        )}
                      </div>
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
                  {confirmedPlan.other.bestAlternate && (
                    <button
                      className="back-nav-btn"
                      style={{ width: '100%', justifyContent: 'center', padding: '8px 0' }}
                      onClick={() => openAlternatesForSession(confirmedPlan.other.session.id)}
                    >
                      🔍 View All {confirmedPlan.other.totalAlternates} Alternates for {confirmedPlan.other.session.course} →
                    </button>
                  )}
                  <button
                    className="back-nav-btn"
                    style={{ width: '100%', justifyContent: 'center', color: 'var(--text-secondary)', padding: '8px 0' }}
                    onClick={() => setActiveTab('schedule')}
                  >
                    ← Done & Back to My Schedule
                  </button>
                </div>
              </div>
            ) : (
              <div>
                {/* Recommendation Banner */}
                {clashAdvice?.recommendation?.reason && (
                  <div className={`recommendation-banner ${clashAdvice.recommendation.badgeText === 'Action Required' ? 'warning' : ''}`}>
                    <div className="rec-tag">💡 {clashAdvice.recommendation.badgeText || 'Smart Recommendation'}</div>
                    <div className="rec-text">{clashAdvice.recommendation.reason}</div>
                  </div>
                )}

                {/* 2-Step Decision Cards */}
                {clashAdvice?.evaluatedSessions?.map((kept, idx) => {
                  const other = idx === 0 ? clashAdvice.evaluatedSessions[1] : clashAdvice.evaluatedSessions[0];
                  const isRec = clashAdvice.recommendation?.attendSessionId === kept.session.id;
                  const keptTime = `${formatMinTo12h(kept.session.startMin)} – ${formatMinTo12h(kept.session.endMin)}`;
                  const clashDateFormatted = getClashContextDate(activeClashDay.date, activeClashDay.dow);

                  const isSameDayAlt = other.bestAlternate && other.bestAlternate.date === activeClashDay.date;
                  const isAltEarlier = isSameDayAlt && (other.bestAlternate.startMin < kept.session.startMin);

                  return (
                    <div
                      key={kept.session.id}
                      className={`decision-choice-card ${isRec ? 'is-recommended' : ''}`}
                    >
                      <div className="decision-top">
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: 2 }}>
                            OPTION {idx + 1}
                          </div>
                          <div className="decision-course-name">
                            {kept.session.course}
                            {kept.session.no && <span style={{ fontSize: 14, color: 'var(--google-blue)', fontWeight: 600 }}> (Session #{kept.session.no})</span>}
                          </div>
                        </div>
                        {isRec && (
                          <span className="pill-badge" style={{ background: 'var(--google-green)', color: '#FFF', fontWeight: 700 }}>
                            ⭐ Recommended
                          </span>
                        )}
                      </div>

                      {/* Step Sequences */}
                      {isSameDayAlt && isAltEarlier ? (
                        <>
                          <div className="same-day-solution-banner">
                            ⚡ <strong>Same-Day Solution:</strong> Attend <strong>{other.session.course}</strong> at {other.bestAlternate.timeFormatted} and <strong>{kept.session.course}</strong> at {keptTime} on {clashDateFormatted}.
                          </div>

                          {/* Step 1: Earlier Class */}
                          <div className="step-box alt-step">
                            <div className="step-header alt">
                              <span>1️⃣</span> <span>Step 1 · Attend Earlier at {other.bestAlternate.timeFormatted}</span>
                            </div>
                            <div className="step-body-main">
                              Attend <strong>{other.session.course}</strong> in Room {other.bestAlternate.room || 'TBD'}
                            </div>
                            <div className="step-body-sub">
                              📅 {clashDateFormatted} · 👥 Section {other.bestAlternate.sections.join(', ')} {' '}
                              <span style={{ color: 'var(--google-green)', fontWeight: 700 }}>(✅ Clash-Free for Section {section})</span>
                            </div>
                          </div>

                          {/* Step 2: Second Class */}
                          <div className="step-box today-step">
                            <div className="step-header today">
                              <span>2️⃣</span> <span>Step 2 · Attend at {keptTime}</span>
                            </div>
                            <div className="step-body-main">
                              Walk into Room {kept.session.room || 'TBD'} for <strong>{kept.session.course}</strong>
                            </div>
                            <div className="step-body-sub">
                              📅 {clashDateFormatted} · Regular class with Section {section}
                            </div>
                          </div>
                        </>
                      ) : isSameDayAlt && !isAltEarlier ? (
                        <>
                          <div className="same-day-solution-banner">
                            ⚡ <strong>Same-Day Solution:</strong> Attend <strong>{kept.session.course}</strong> at {keptTime} and <strong>{other.session.course}</strong> at {other.bestAlternate.timeFormatted} on {clashDateFormatted}.
                          </div>

                          {/* Step 1: First Class */}
                          <div className="step-box today-step">
                            <div className="step-header today">
                              <span>1️⃣</span> <span>Step 1 · Attend at {keptTime}</span>
                            </div>
                            <div className="step-body-main">
                              Walk into Room {kept.session.room || 'TBD'} for <strong>{kept.session.course}</strong>
                            </div>
                            <div className="step-body-sub">
                              📅 {clashDateFormatted} · Regular class with Section {section}
                            </div>
                          </div>

                          {/* Step 2: Later Class */}
                          <div className="step-box alt-step">
                            <div className="step-header alt">
                              <span>2️⃣</span> <span>Step 2 · Attend Later at {other.bestAlternate.timeFormatted}</span>
                            </div>
                            <div className="step-body-main">
                              Attend <strong>{other.session.course}</strong> in Room {other.bestAlternate.room || 'TBD'}
                            </div>
                            <div className="step-body-sub">
                              📅 {clashDateFormatted} · 👥 Section {other.bestAlternate.sections.join(', ')} {' '}
                              <span style={{ color: 'var(--google-green)', fontWeight: 700 }}>(✅ Clash-Free for Section {section})</span>
                            </div>
                          </div>
                        </>
                      ) : (
                        <>
                          {/* Step 1 */}
                          <div className="step-box today-step">
                            <div className="step-header today">
                              <span>1️⃣</span> <span>Step 1 · Attend on {clashDateFormatted}</span>
                            </div>
                            <div className="step-body-main">Walk into Room {kept.session.room || 'TBD'} at {keptTime}</div>
                            <div className="step-body-sub">Course: {kept.session.course} with Section {section}</div>
                          </div>

                          {/* Step 2 */}
                          {other.hasNoAlternates ? (
                            <div className="step-box warn-step">
                              <div className="step-header warn">
                                <span>⚠️</span> <span>Step 2 · Warning for {other.session.course}</span>
                              </div>
                              <div className="step-body-main" style={{ color: 'var(--google-red)' }}>
                                No alternate session exists in any other section!
                              </div>
                              <div className="step-body-sub">
                                If you attend {kept.session.course} on {clashDateFormatted}, you will not have an alternate slot for {other.session.course}.
                              </div>
                            </div>
                          ) : other.bestAlternate ? (
                            <div className="step-box alt-step">
                              <div className="step-header alt">
                                <span>2️⃣</span> <span>Step 2 · Catch {other.session.course} on {formatDisplayDate(other.bestAlternate.date, other.bestAlternate.dow)}</span>
                              </div>
                              <div className="step-body-main">
                                📅 {formatDisplayDate(other.bestAlternate.date, other.bestAlternate.dow)} · 🕒 {other.bestAlternate.timeFormatted}
                              </div>
                              <div className="step-body-sub">
                                📍 Room: {other.bestAlternate.room || 'TBD'} · 👥 Section {other.bestAlternate.sections.join(', ')} {' '}
                                {other.bestAlternate.free ? (
                                  <span style={{ color: 'var(--google-green)', fontWeight: 700 }}>
                                    (✅ Clash-Free for Section {section})
                                  </span>
                                ) : (
                                  <span style={{ color: 'var(--google-red)' }}>
                                    (⚠️ Conflicts with your timetable)
                                  </span>
                                )}
                              </div>
                            </div>
                          ) : null}
                        </>
                      )}

                      {/* Action Button */}
                      <button
                        className={`action-attend-btn ${isRec ? 'recommended' : ''}`}
                        style={{ marginTop: 10 }}
                        onClick={() => handleConfirmPlan(kept.session.id)}
                      >
                        {isRec ? '⭐ ' : '👉 '}Confirm Plan: {isSameDayAlt ? `Attend Both on ${formatDisplayDate(activeClashDay.date, activeClashDay.dow)}` : `Attend ${kept.session.course} on ${formatDisplayDate(activeClashDay.date, activeClashDay.dow)}`}
                      </button>

                      {/* Secondary Link */}
                      {!other.hasNoAlternates && other.totalAlternates > 0 && (
                        <div style={{ textAlign: 'center', marginTop: 8 }}>
                          <a
                            href="#"
                            onClick={(e) => {
                              e.preventDefault();
                              openAlternatesForSession(other.session.id);
                            }}
                            style={{ fontSize: 13, color: 'var(--google-blue)', textDecoration: 'underline', fontWeight: 600 }}
                          >
                            View all {other.totalAlternates} alternate slots for {other.session.course} →
                          </a>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ============================================================ */}
        {/* TAB 3: ALTERNATES RESULTS LIST                               */}
        {/* ============================================================ */}
        {activeTab === 'alternates' && (
          <div>
            <button className="back-nav-btn" onClick={() => setActiveTab('schedule')}>
              ← Back to Schedule
            </button>

            {skippedSession && (
              <div className="skipped-summary-banner">
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--google-yellow)', marginBottom: 2 }}>
                  LOOKING FOR ALTERNATE
                </div>
                <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>
                  {skippedSession.course} {skippedSession.no ? `(Session #${skippedSession.no})` : ''}
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
                  Originally scheduled on {formatDisplayDate(skippedSession.date, skippedSession.dow)} at {formatMinTo12h(skippedSession.startMin)}
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
                const copyText = `${alt.course} Session #${alt.no} | ${alt.dow} ${alt.date} | ${alt.timeFormatted} | Room: ${alt.room} | Section ${sectionsStr}`;

                return (
                  <div
                    key={idx}
                    className={`alt-recommendation-card ${isFree ? 'free' : 'conflict'}`}
                  >
                    <div className="recommendation-rank">
                      {isFree
                        ? (idx === 0 ? '⭐ Best Match (Free for You)' : '✅ Clash-Free Option')
                        : '⚠️ Has Conflict with Your Timetable'}
                    </div>

                    <div className="alt-header-row">
                      <div className="alt-datetime">{dateFormatted} · {alt.timeFormatted}</div>
                      <div>
                        {isFree ? (
                          <span className="pill-badge" style={{ background: 'var(--google-green-surface)', color: 'var(--google-green)', fontWeight: 700 }}>
                            Free for you
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
                        <span className="detail-item" style={{ color: 'var(--google-green)', fontWeight: 600 }}>
                          ✨ Same Day
                        </span>
                      )}
                    </div>

                    {!isFree && alt.conflictsWith && alt.conflictsWith.length > 0 && (
                      <div style={{ fontSize: 12, color: 'var(--google-red)', marginBottom: 10, background: '#FFF5F5', padding: '6px 10px', borderRadius: 4 }}>
                        Conflicts with your {alt.conflictsWith.map(c => c.course).join(', ')}
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
              <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>Find Any Class Occurrence</h3>
              
              <label className="form-label" htmlFor="subject-course-picker">Select Course</label>
              <select
                id="subject-course-picker"
                className="form-select"
                value={selectedCourse}
                onChange={(e) => handleCourseChange(e.target.value)}
              >
                <option value="">-- Select a Course --</option>
                {bootstrap?.courses?.map(c => (
                  <option key={c.name} value={c.name}>
                    {c.name} ({c.maxNo} sessions)
                  </option>
                ))}
              </select>

              <label className="form-label" htmlFor="subject-session-picker">Select Session Number</label>
              <select
                id="subject-session-picker"
                className="form-select"
                value={selectedSessionNo}
                onChange={(e) => handleSessionChange(e.target.value)}
                disabled={!selectedCourse}
              >
                <option value="">-- Select Session # --</option>
                {selectedCourseObj &&
                  Array.from({ length: selectedCourseObj.maxNo }, (_, i) => (
                    <option key={i + 1} value={i + 1}>
                      Session #{i + 1}
                    </option>
                  ))}
              </select>

              <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                Showing alternate timings across all sections A through H.
              </div>
            </div>

            {loadingSubject ? (
              <div className="skeleton-card">
                <div className="skeleton-bar" style={{ height: 80 }}></div>
              </div>
            ) : (
              subjectOfferings.map((r, idx) => {
                const dateFormatted = formatDisplayDate(r.date, r.dow);
                const sectionsStr = r.sections.join(', ');
                const copyText = `${r.course} Session #${r.no} | ${r.dow} ${r.date} | ${r.timeFormatted} | Room: ${r.room} | Section ${sectionsStr}`;

                return (
                  <div key={idx} className="class-card alternate" style={{ marginBottom: 10 }}>
                    <div className="card-top-row">
                      <div className="course-name">{dateFormatted} · {r.timeFormatted}</div>
                      <div className="card-badges">
                        {r.free ? (
                          <span className="pill-badge" style={{ background: 'var(--google-green-surface)', color: 'var(--google-green)', fontWeight: 700 }}>
                            Free for Section {section}
                          </span>
                        ) : (
                          <span className="pill-badge" style={{ background: 'var(--google-red-surface)', color: 'var(--google-red)' }}>
                            Conflicts with Section {section}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="card-details-row" style={{ marginBottom: 8 }}>
                      <span className="detail-item">📍 Room: <strong>{r.room}</strong></span>
                      <span className="detail-item">👥 Section: <strong>{sectionsStr}</strong></span>
                    </div>

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
        {/* TAB 5: ABOUT & DIAGNOSTICS                                   */}
        {/* ============================================================ */}
        {activeTab === 'status' && (
          <div>
            <div className="form-card">
              <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>About Alt-Class Finder</h3>
              <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 12 }}>
                Created for <strong>Masters&apos; Union Cohort 7</strong> to help students navigate timetable clashes with ease.
              </p>
              <ul style={{ fontSize: 13, color: 'var(--text-secondary)', paddingLeft: 20, lineHeight: 1.7 }}>
                <li><strong>Deployed on Vercel:</strong> Global CDN edge delivery with sub-100ms response times.</li>
                <li><strong>Direct Master Sync:</strong> Synchronized with Google Sheets every 5 minutes.</li>
                <li><strong>Accurate Attendance Numbering:</strong> Cancelled sessions (struck through in the master sheet) are skipped so session numbers align with actual syllabus coverage.</li>
                <li><strong>Smart Ranking:</strong> Alternate class recommendations prioritize slots that are completely free in your section&apos;s calendar.</li>
              </ul>
            </div>

            <div className="form-card">
              <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>System Health</h3>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.8 }}>
                <div><strong>Cohort:</strong> Masters&apos; Union Cohort 7</div>
                <div><strong>Current Term:</strong> {statusInfo?.termLabel || 'Cohort 7 — Term 3'}</div>
                <div><strong>Platform:</strong> {statusInfo?.platform || 'Vercel Edge'}</div>
                <div><strong>Total Tracked Sessions:</strong> {statusInfo?.counts?.sessions || 0}</div>
                <div><strong>Active Classes:</strong> {statusInfo?.counts?.active || 0}</div>
                <div><strong>Cancelled Sessions:</strong> {statusInfo?.counts?.cancelled || 0} (Skipped from numbering)</div>
                <div><strong>Edge Cache Revalidation:</strong> Every 5 minutes</div>
              </div>
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
