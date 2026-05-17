import { useState, useRef, useCallback, useEffect } from 'react'
import { Analytics } from '@vercel/analytics/react'
import { translations, detectLang } from './i18n'
import './App.css'

const defaultSettings = { focus: 25, short: 5, long: 15, longEvery: 4 }

const modeColor = {
  focus: 'var(--primary)',
  short: 'var(--short-break)',
  long:  'var(--long-break)',
}

const t = translations[detectLang()]

function extractYouTubeId(url) {
  const match = url.match(
    /(?:youtube\.com\/watch\?(?:.*&)?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/
  )
  return match ? match[1] : null
}

function loadSettings() {
  try {
    const raw = localStorage.getItem('pomodoro:settings')
    return raw ? { ...defaultSettings, ...JSON.parse(raw) } : defaultSettings
  } catch { return defaultSettings }
}

function SettingField({ label, value, onChange, suffix = t.settings.suffixMin }) {
  return (
    <div className="setting-field">
      <span className="setting-field-label">{label}</span>
      <div className="setting-field-wrap">
        <input
          type="number" min={1} max={180} value={value}
          onChange={e => onChange(parseInt(e.target.value, 10))}
          className="setting-field-input"
        />
        <span className="setting-field-suffix">{suffix}</span>
      </div>
    </div>
  )
}

const TrashIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6"/>
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
  </svg>
)

function App() {
  const [mode, setMode]                 = useState('focus')
  const [isRunning, setIsRunning]       = useState(false)
  const [focusCount, setFocusCount]     = useState(0)
  const [settings, setSettings]         = useState(loadSettings)
  const [timeLeft, setTimeLeft]         = useState(() => loadSettings().focus * 60)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [sessionLabel, setSessionLabel] = useState('')
  const [youtubeUrl, setYoutubeUrl]     = useState(() => localStorage.getItem('pomodoro:yt') || 'https://www.youtube.com/watch?v=jfKfPfyJRdk')
  const [history, setHistory]           = useState(() => {
    try { return JSON.parse(localStorage.getItem('pomodoro:history') || '[]') } catch { return [] }
  })
  const [goals, setGoals]               = useState(() => {
    try { return JSON.parse(localStorage.getItem('pomodoro:goals') || '[]') } catch { return [] }
  })
  const [activeGoalId, setActiveGoalId] = useState(null)
  const [newGoalName, setNewGoalName]   = useState('')
  const [newGoalSessions, setNewGoalSessions] = useState(3)

  const intervalRef  = useRef(null)
  const startTimeRef = useRef(null)
  const iframeRef    = useRef(null)

  useEffect(() => { localStorage.setItem('pomodoro:settings', JSON.stringify(settings)) }, [settings])
  useEffect(() => { localStorage.setItem('pomodoro:history',  JSON.stringify(history))  }, [history])
  useEffect(() => { localStorage.setItem('pomodoro:yt',       youtubeUrl)               }, [youtubeUrl])
  useEffect(() => { localStorage.setItem('pomodoro:goals',    JSON.stringify(goals))    }, [goals])

  useEffect(() => {
    if (mode !== 'focus' || !activeGoalId) return
    const goal = goals.find(g => g.id === activeGoalId)
    if (goal) setSessionLabel(goal.name)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGoalId, mode])

  const ytCmd = useCallback((func) => {
    iframeRef.current?.contentWindow?.postMessage(
      JSON.stringify({ event: 'command', func, args: [] }),
      'https://www.youtube.com'
    )
  }, [])

  const playBeep = useCallback(() => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)()
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.connect(g); g.connect(ctx.destination)
      o.frequency.value = 660
      g.gain.setValueAtTime(0.001, ctx.currentTime)
      g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.02)
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6)
      o.start(); o.stop(ctx.currentTime + 0.6)
    } catch {}
  }, [])

  useEffect(() => {
    if (!isRunning) return
    intervalRef.current = setInterval(() => {
      setTimeLeft(prev => (prev <= 1 ? 0 : prev - 1))
    }, 1000)
    return () => clearInterval(intervalRef.current)
  }, [isRunning])

  useEffect(() => {
    if (timeLeft !== 0 || !isRunning) return
    clearInterval(intervalRef.current)
    playBeep()

    const endTime = Date.now()
    setHistory(prev => [{
      id: crypto.randomUUID(),
      mode,
      name: mode === 'focus' ? (activeGoalId ? goals.find(g => g.id === activeGoalId)?.name ?? sessionLabel : sessionLabel) : '',
      goalId: mode === 'focus' ? activeGoalId : null,
      startTime: startTimeRef.current,
      endTime,
      duration: settings[mode],
    }, ...prev].slice(0, 100))
    startTimeRef.current = Date.now()

    if (mode === 'focus') {
      let nextLabel = ''
      if (activeGoalId) {
        const goal = goals.find(g => g.id === activeGoalId)
        if (goal) {
          const newDone = goal.done + 1
          setGoals(prev => prev.map(g => g.id === activeGoalId ? { ...g, done: newDone } : g))
          if (newDone >= goal.total) {
            const currentIdx = goals.findIndex(g => g.id === activeGoalId)
            const nextGoal = goals.slice(currentIdx + 1).find(g => g.done < g.total)
            if (nextGoal) {
              setActiveGoalId(nextGoal.id)
              nextLabel = nextGoal.name
            } else {
              setActiveGoalId(null)
            }
          } else {
            nextLabel = goal.name
          }
        }
      }
      setSessionLabel(nextLabel)

      const next = focusCount + 1
      setFocusCount(next)
      const nextMode = next % settings.longEvery === 0 ? 'long' : 'short'
      setMode(nextMode)
      setTimeLeft(settings[nextMode] * 60)
      ytCmd('pauseVideo')
    } else {
      setMode('focus')
      setTimeLeft(settings.focus * 60)
      ytCmd('playVideo')
    }

    intervalRef.current = setInterval(() => {
      setTimeLeft(prev => (prev <= 1 ? 0 : prev - 1))
    }, 1000)
  }, [timeLeft, isRunning, mode, focusCount, settings, playBeep, ytCmd, sessionLabel, goals, activeGoalId])

  const handleStartPause = () => {
    if (!isRunning) {
      if (startTimeRef.current === null) startTimeRef.current = Date.now()
      if (mode === 'focus') {
        ytCmd('playVideo')

        let goalToUse = null

        if (activeGoalId) {
          const current = goals.find(g => g.id === activeGoalId)
          if (current && current.done < current.total) {
            goalToUse = current
          } else {
            const currentIdx = goals.findIndex(g => g.id === activeGoalId)
            const next = goals.slice(currentIdx + 1).find(g => g.done < g.total)
            if (next) {
              goalToUse = next
              setActiveGoalId(next.id)
            } else {
              setActiveGoalId(null)
            }
          }
        } else {
          const first = goals.find(g => g.done < g.total)
          if (first) {
            goalToUse = first
            setActiveGoalId(first.id)
          }
        }

        setSessionLabel(goalToUse ? goalToUse.name : '')
      }
    } else {
      ytCmd('pauseVideo')
    }
    setIsRunning(r => !r)
  }

  const handleReset = () => {
    clearInterval(intervalRef.current)
    setIsRunning(false)
    startTimeRef.current = null
    ytCmd('pauseVideo')
    setTimeLeft(settings[mode] * 60)
  }

  const handleModeSwitch = (newMode) => {
    clearInterval(intervalRef.current)
    setIsRunning(false)
    startTimeRef.current = null
    ytCmd('pauseVideo')
    setMode(newMode)
    setTimeLeft(settings[newMode] * 60)
  }

  const updateSetting = (key, val) => {
    const v = Math.max(1, Math.min(180, val || 1))
    setSettings(prev => ({ ...prev, [key]: v }))
    if (!isRunning && key === mode) setTimeLeft(v * 60)
  }

  const handleAddGoal = () => {
    if (!newGoalName.trim()) return
    setGoals(prev => [...prev, {
      id: crypto.randomUUID(),
      name: newGoalName.trim(),
      total: Math.max(1, newGoalSessions),
      done: 0,
    }])
    setNewGoalName('')
    setNewGoalSessions(3)
  }

  const handleSelectGoal = (id) => {
    if (activeGoalId === id) {
      setActiveGoalId(null)
      setSessionLabel('')
    } else {
      const goal = goals.find(g => g.id === id)
      if (goal) {
        setActiveGoalId(id)
        setSessionLabel(goal.name)
      }
    }
  }

  const handleDeleteGoal = (id) => {
    setGoals(prev => prev.filter(g => g.id !== id))
    if (activeGoalId === id) {
      setActiveGoalId(null)
      setSessionLabel('')
    }
  }

  const updateHistoryName = (id, name) =>
    setHistory(prev => prev.map(item => item.id === id ? { ...item, name } : item))
  const clearHistory = () => setHistory([])

  const formatTime = s => {
    const m = Math.floor(s / 60).toString().padStart(2, '0')
    return `${m}:${(s % 60).toString().padStart(2, '0')}`
  }
  const formatTimeOfDay = ts => {
    if (!ts) return '--:--'
    return new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  }
  const formatDay = ts => {
    const d = new Date(ts)
    if (d.toDateString() === new Date().toDateString()) return t.history.today
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
  }

  const youtubeId    = extractYouTubeId(youtubeUrl)
  const total        = settings[mode] * 60
  const progress     = 1 - timeLeft / total
  const circumference = 2 * Math.PI * 88

  const focusTotal    = history.filter(h => h.mode === 'focus').reduce((s, h) => s + h.duration, 0)
  const focusSessions = history.filter(h => h.mode === 'focus').length

  const grouped = history.reduce((acc, h) => {
    const key = formatDay(h.endTime)
    ;(acc[key] ||= []).push(h)
    return acc
  }, {})

  return (
    <div className="page">

      <header className="page-header">
        <div className="logo">
          <div className="logo-dot" style={{ background: modeColor[mode] }} />
          <span className="logo-text">pomodoro</span>
        </div>
      </header>

      <main className="page-main">

        {/* ── Goals card ── */}
        <aside className="goals-card">
          <div className="panel-header">
            <div>
              <h2 className="panel-title">{t.goals.title}</h2>
              <p className="panel-subtitle">{t.goals.subtitle}</p>
            </div>
            {goals.length > 0 && (
              <button className="btn-trash" onClick={() => { setGoals([]); setActiveGoalId(null); setSessionLabel('') }} aria-label={t.goals.clearAriaLabel}>
                <TrashIcon />
              </button>
            )}
          </div>

          <div className="goals-form">
            <input
              className="goals-name-input"
              type="text"
              placeholder={t.goals.namePlaceholder}
              value={newGoalName}
              onChange={e => setNewGoalName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAddGoal()}
              maxLength={60}
            />
            <div className="goals-form-row">
              <div className="goals-sessions-wrap">
                <input
                  type="number" min={1} max={99}
                  value={newGoalSessions}
                  onChange={e => setNewGoalSessions(Math.max(1, parseInt(e.target.value) || 1))}
                  className="goals-sessions-input"
                />
                <span className="goals-sessions-label">{t.goals.sessions}</span>
              </div>
              <button className="goals-add-btn" onClick={handleAddGoal}>
                {t.goals.add}
              </button>
            </div>
          </div>

          <div className="goals-content">
            {goals.length === 0 ? (
              <div className="panel-empty">
                <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
                </svg>
                <p>{t.goals.empty}</p>
                <span>{t.goals.emptyHint}</span>
              </div>
            ) : (
              <ul className="goals-list">
                {goals.map(goal => {
                  const completed = goal.done >= goal.total
                  const isActive  = activeGoalId === goal.id
                  const pct       = Math.min(100, (goal.done / goal.total) * 100)
                  return (
                    <li
                      key={goal.id}
                      className={`goal-item ${isActive ? 'active' : ''} ${completed ? 'completed' : ''}`}
                      onClick={() => !completed && handleSelectGoal(goal.id)}
                    >
                      <div className="goal-item-row">
                        <span className="goal-dot" style={{ background: completed ? 'var(--short-break)' : 'var(--primary)' }} />
                        <span className="goal-name">{goal.name}</span>
                        <span className="goal-count">{goal.done}/{goal.total}</span>
                        <button
                          className="goal-delete"
                          onClick={e => { e.stopPropagation(); handleDeleteGoal(goal.id) }}
                          aria-label="Remover meta"
                        >
                          ×
                        </button>
                      </div>
                      <div className="goal-progress">
                        <div className="goal-progress-fill" style={{ width: `${pct}%`, background: completed ? 'var(--short-break)' : 'var(--primary)' }} />
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </aside>

        {/* ── Timer card ── */}
        <section className="timer-card">

          <div className="mode-tabs">
            {['focus', 'short', 'long'].map(m => (
              <button
                key={m}
                className={`tab ${mode === m ? 'active' : ''}`}
                onClick={() => handleModeSwitch(m)}
              >
                {t.modeLabel[m]}
              </button>
            ))}
          </div>

          <div className="timer-container">
            <svg className="progress-ring" viewBox="0 0 200 200">
              <circle cx="100" cy="100" r="88" className="ring-bg" />
              <circle
                cx="100" cy="100" r="88"
                className="ring-progress"
                style={{ stroke: modeColor[mode] }}
                strokeDasharray={circumference}
                strokeDashoffset={-(circumference * progress)}
              />
            </svg>
            <div className="timer-inner">
              <span className="timer-mode-label">{t.modeLabel[mode]}</span>
              <span className="timer-display">{formatTime(timeLeft)}</span>
              <span className="timer-cycle">
                {t.timer.cycle(focusCount + (mode === 'focus' ? 1 : 0), focusCount)}
              </span>
            </div>
          </div>

          <div className="controls">
            <button
              className="btn btn-primary"
              style={{ background: modeColor[mode] }}
              onClick={handleStartPause}
            >
              {isRunning ? (
                <>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="6" y="4" width="4" height="16" rx="1"/>
                    <rect x="14" y="4" width="4" height="16" rx="1"/>
                  </svg>
                  {t.timer.pause}
                </>
              ) : (
                <>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                    <polygon points="5 3 19 12 5 21 5 3"/>
                  </svg>
                  {t.timer.start}
                </>
              )}
            </button>
            <button className="btn btn-icon" onClick={handleReset} aria-label="Resetar">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="1 4 1 10 7 10"/>
                <path d="M3.51 15a9 9 0 1 0 .49-4.1"/>
              </svg>
            </button>
          </div>

          {mode === 'focus' && (
            <input
              className="session-label-input"
              type="text"
              placeholder={t.timer.sessionPlaceholder}
              value={sessionLabel}
              onChange={e => setSessionLabel(e.target.value)}
              maxLength={80}
            />
          )}

          {/* ── Collapsible settings ── */}
          <div className="settings-panel">
            <button
              className="settings-toggle"
              onClick={() => setSettingsOpen(o => !o)}
              aria-expanded={settingsOpen}
            >
              <span className="settings-toggle-label">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3"/>
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                </svg>
                {t.settings.title}
              </span>
              <svg
                className={`settings-chevron ${settingsOpen ? 'open' : ''}`}
                width="16" height="16" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              >
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </button>

            <div className={`settings-body ${settingsOpen ? 'open' : ''}`}>
              <div className="settings-body-inner">
                <div className="settings-fields">
                  <SettingField label={t.settings.focus}      value={settings.focus}     onChange={v => updateSetting('focus',     v)} />
                  <SettingField label={t.settings.shortBreak} value={settings.short}     onChange={v => updateSetting('short',     v)} />
                  <SettingField label={t.settings.longBreak}  value={settings.long}      onChange={v => updateSetting('long',      v)} />
                  <SettingField label={t.settings.longEvery}  value={settings.longEvery} onChange={v => updateSetting('longEvery', v)} suffix={t.settings.suffixCycles} />
                </div>
                <div className="settings-restore">
                  <button onClick={() => { setSettings(defaultSettings); setTimeLeft(defaultSettings[mode] * 60) }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="23 4 23 10 17 10"/>
                      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                    </svg>
                    {t.settings.restore}
                  </button>
                </div>

                <div className="youtube-section">
                  <p className="youtube-label">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2C0 8.1 0 12 0 12s0 3.9.5 5.8a3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1C24 15.9 24 12 24 12s0-3.9-.5-5.8z"/>
                      <polygon fill="white" points="9.7 15.5 15.8 12 9.7 8.5 9.7 15.5"/>
                    </svg>
                    {t.settings.youtubeLabel}
                  </p>
                  <input
                    className="youtube-input"
                    type="text"
                    placeholder={t.settings.youtubePlaceholder}
                    value={youtubeUrl}
                    onChange={e => setYoutubeUrl(e.target.value)}
                  />
                  {youtubeId && (
                    <div className="youtube-player">
                      <iframe
                        ref={iframeRef}
                        key={youtubeId}
                        src={`https://www.youtube.com/embed/${youtubeId}?enablejsapi=1&rel=0`}
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                        title="YouTube player"
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

        </section>

        {/* ── History card ── */}
        <aside className="history-card">

          <div className="panel-header">
            <div>
              <h2 className="panel-title">{t.history.title}</h2>
              <p className="panel-subtitle">{t.history.subtitle}</p>
            </div>
            {history.length > 0 && (
              <button className="btn-trash" onClick={clearHistory} aria-label={t.history.clearAriaLabel}>
                <TrashIcon />
              </button>
            )}
          </div>

          <div className="history-stats">
            <div className="stat-box">
              <span className="stat-label">{t.history.focusTotal}</span>
              <span className="stat-value">{focusTotal}min</span>
            </div>
            <div className="stat-box">
              <span className="stat-label">{t.history.sessions}</span>
              <span className="stat-value">{focusSessions}</span>
            </div>
          </div>

          <div className="history-content">
            {history.length === 0 ? (
              <div className="panel-empty">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/>
                  <polyline points="12 6 12 12 16 14"/>
                </svg>
                <p>{t.history.empty}</p>
                <span>{t.history.emptyHint}</span>
              </div>
            ) : (
              <div className="history-list">
                {Object.entries(grouped).map(([day, items]) => (
                  <div key={day} className="history-group">
                    <h4 className="history-group-label">{day}</h4>
                    <ul className="history-group-items">
                      {items.map(item => (
                        <li key={item.id} className="history-item">
                          <div className="history-item-row">
                            <span className="history-dot" style={{ background: modeColor[item.mode] }} />
                            <span className="history-label">{t.modeLabel[item.mode]}</span>
                            <span className="history-meta">{item.duration}min</span>
                            <span className="history-meta">{formatTimeOfDay(item.endTime)}</span>
                          </div>
                          <input
                            className="history-name-input"
                            type="text"
                            placeholder={item.mode === 'focus' ? t.history.sessionPlaceholder : t.history.breakPlaceholder}
                            value={item.name}
                            onChange={e => updateHistoryName(item.id, e.target.value)}
                          />
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>

        </aside>
      </main>

      <footer className="page-footer">{t.footer}</footer>
      <Analytics />
    </div>
  )
}

export default App
