import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { identityApi } from '../api/endpoints'

// ─── Pulse animation ─────────────────────────────────────────────────────────
function PulseLine() {
  return (
    <div className="pulse-line" style={{ margin: '1.5rem 0' }}>
      <svg width="200" height="36" viewBox="0 0 200 36" fill="none">
        <path
          d="M0 18 L35 18 L45 4 L55 32 L65 18 L90 18 L100 8 L110 28 L120 18 L150 18 L160 10 L170 26 L180 18 L200 18"
          stroke="var(--ink)" strokeWidth="1.5" fill="none"
          strokeLinecap="round" strokeLinejoin="round"
        />
      </svg>
    </div>
  )
}

// ─── Validation helpers ───────────────────────────────────────────────────────
const emailRe  = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const phoneRe  = /^[6-9]\d{9}$/  // 10-digit Indian mobile

// ─── Login Form ───────────────────────────────────────────────────────────────
function LoginForm({ onSwitch }) {
  const { login }   = useAuth()
  const navigate    = useNavigate()

  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [errs,     setErrs]     = useState({})
  const [apiErr,   setApiErr]   = useState('')
  const [busy,     setBusy]     = useState(false)

  const validate = () => {
    const e = {}
    if (!emailRe.test(email))   e.email    = 'Enter a valid email address'
    if (password.length < 1)    e.password = 'Password is required'
    return e
  }

  const onSubmit = async (ev) => {
    ev.preventDefault()
    const e = validate()
    if (Object.keys(e).length) { setErrs(e); return }
    setErrs({}); setApiErr('')
    setBusy(true)
    try {
      const u = await login(email.trim(), password)
      const routes = { citizen: '/citizen', ngo: '/ngo', government: '/government' }
      navigate(routes[u.role] || '/citizen')
    } catch (err) {
      setApiErr(err.message || 'Invalid credentials. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate style={{ maxWidth: 360 }}>
      <h2 style={{ marginBottom: '0.4rem' }}>Sign in</h2>
      <p style={{ opacity: 0.5, fontSize: '0.875rem', marginBottom: '2.5rem' }}>
        Access your AidPulse dashboard.
      </p>

      {apiErr && (
        <p style={{ fontSize: '0.8125rem', fontWeight: 500, marginBottom: '1rem' }}>{apiErr}</p>
      )}

      <div style={{ marginBottom: '1.75rem' }}>
        <label className="field-label" htmlFor="login-email">Email address</label>
        <input
          id="login-email"
          type="email"
          autoComplete="email"
          className={`input-underline${errs.email ? ' error' : ''}`}
          placeholder="your@email.com"
          value={email}
          onChange={e => setEmail(e.target.value)}
        />
        {errs.email && <p className="field-error">{errs.email}</p>}
      </div>

      <div style={{ marginBottom: '2.5rem' }}>
        <label className="field-label" htmlFor="login-password">Password</label>
        <input
          id="login-password"
          type="password"
          autoComplete="current-password"
          className={`input-underline${errs.password ? ' error' : ''}`}
          placeholder="••••••"
          value={password}
          onChange={e => setPassword(e.target.value)}
        />
        {errs.password && <p className="field-error">{errs.password}</p>}
      </div>

      <button
        id="login-submit"
        type="submit"
        className="btn-solid"
        disabled={busy}
        style={{ width: '100%', marginBottom: '1.5rem' }}
      >
        {busy ? 'Signing in…' : 'Sign in'}
      </button>

      <p style={{ fontSize: '0.875rem' }}>
        No account?{' '}
        <button type="button" className="btn-text" onClick={onSwitch}>Register here</button>
      </p>
    </form>
  )
}

// ─── Register Form (citizen-only) ─────────────────────────────────────────────
function RegisterForm({ onSwitch, digilockerMode }) {
  const { register } = useAuth()
  const navigate     = useNavigate()

  const [name,     setName]     = useState('')
  const [email,    setEmail]    = useState('')
  const [phone,    setPhone]    = useState('')
  const [password, setPassword] = useState('')
  const [consent,  setConsent]  = useState(false)
  const [errs,     setErrs]     = useState({})
  const [apiErr,   setApiErr]   = useState('')
  const [busy,     setBusy]     = useState(false)
  const [digiStep, setDigiStep] = useState(false) // DigiLocker redirect step

  const validate = () => {
    const e = {}
    if (name.trim().length < 2)    e.name     = 'Name must be at least 2 characters'
    if (!emailRe.test(email))       e.email    = 'Enter a valid email address'
    const digits = phone.replace(/\s+/g, '')
    if (!digits)                     e.phone    = 'Phone number is required'
    else if (!phoneRe.test(digits))  e.phone    = 'Enter a valid 10-digit Indian mobile number (starts 6–9)'
    if (password.length < 8)        e.password = 'Password must be at least 8 characters'
    if (!consent)                   e.consent  = 'You must agree to continue'
    return e
  }

  const handleDigiLocker = async () => {
    try {
      setBusy(true)
      const { data } = await identityApi.digilockerStart()
      if (data?.url) window.location.href = data.url
    } catch {
      setApiErr('DigiLocker verification unavailable. Please continue without it.')
      setDigiStep(false)
    } finally {
      setBusy(false)
    }
  }

  const onSubmit = async (ev) => {
    ev.preventDefault()

    // If DigiLocker mode required, show step first
    if (digilockerMode && !digiStep) {
      setDigiStep(true)
      return
    }

    const e = validate()
    if (Object.keys(e).length) { setErrs(e); return }
    setErrs({}); setApiErr('')
    setBusy(true)

    try {
      const digits = phone.replace(/\s+/g, '')
      await register(name.trim(), email.trim(), digits, password, consent)
      // After registration, go back to login so user enters credentials again
      onSwitch()
    } catch (err) {
      setApiErr(err.message || 'Registration failed. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate style={{ maxWidth: 360 }}>
      <h2 style={{ marginBottom: '0.4rem' }}>Create account</h2>
      <p style={{ opacity: 0.5, fontSize: '0.875rem', marginBottom: '2.5rem' }}>
        Citizen only. NGO accounts are created by Government.
      </p>

      {apiErr && (
        <p style={{ fontSize: '0.8125rem', fontWeight: 500, marginBottom: '1rem' }}>{apiErr}</p>
      )}

      {/* DigiLocker step */}
      {digiStep && (
        <div style={{
          border: 'var(--rule)',
          padding: '1.25rem',
          marginBottom: '1.75rem',
        }}>
          <p style={{ fontSize: '0.875rem', marginBottom: '1rem' }}>
            This service uses <strong>DigiLocker</strong> to verify your identity.
            You will be redirected to DigiLocker to complete verification.
          </p>
          <div style={{ display: 'flex', gap: '1rem' }}>
            <button
              type="button"
              className="btn-solid"
              onClick={handleDigiLocker}
              disabled={busy}
              style={{ flex: 1 }}
            >
              {busy ? 'Redirecting…' : 'Verify with DigiLocker'}
            </button>
            <button
              type="button"
              className="btn-text"
              onClick={() => setDigiStep(false)}
            >
              Skip
            </button>
          </div>
        </div>
      )}

      {!digiStep && (
        <>
          <div style={{ marginBottom: '1.75rem' }}>
            <label className="field-label" htmlFor="reg-name">Full name</label>
            <input
              id="reg-name"
              type="text"
              autoComplete="name"
              className={`input-underline${errs.name ? ' error' : ''}`}
              placeholder="Full name"
              value={name}
              onChange={e => setName(e.target.value)}
            />
            {errs.name && <p className="field-error">{errs.name}</p>}
          </div>

          <div style={{ marginBottom: '1.75rem' }}>
            <label className="field-label" htmlFor="reg-email">Email address</label>
            <input
              id="reg-email"
              type="email"
              autoComplete="email"
              className={`input-underline${errs.email ? ' error' : ''}`}
              placeholder="your@email.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
            />
            {errs.email && <p className="field-error">{errs.email}</p>}
          </div>

          <div style={{ marginBottom: '1.75rem' }}>
            <label className="field-label" htmlFor="reg-phone">
              Mobile number (+91)
            </label>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '0.9375rem',
                opacity: 0.55,
                paddingBottom: '0.5rem',
                borderBottom: '1px solid var(--ink)',
              }}>
                +91
              </span>
              <input
                id="reg-phone"
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                className={`input-underline${errs.phone ? ' error' : ''}`}
                placeholder="10-digit number, starts 6–9"
                value={phone}
                onChange={e => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                style={{ flex: 1 }}
              />
            </div>
            {errs.phone && <p className="field-error">{errs.phone}</p>}
          </div>

          <div style={{ marginBottom: '1.75rem' }}>
            <label className="field-label" htmlFor="reg-password">
              Password (min. 8 characters)
            </label>
            <input
              id="reg-password"
              type="password"
              autoComplete="new-password"
              className={`input-underline${errs.password ? ' error' : ''}`}
              placeholder="••••••"
              value={password}
              onChange={e => setPassword(e.target.value)}
            />
            {errs.password && <p className="field-error">{errs.password}</p>}
          </div>

          <div style={{ marginBottom: '2.5rem' }}>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', cursor: 'pointer' }}>
              <input
                id="reg-consent"
                type="checkbox"
                checked={consent}
                onChange={e => setConsent(e.target.checked)}
                style={{ marginTop: '0.2rem', accentColor: 'var(--ink)', flexShrink: 0 }}
              />
              <span style={{ fontSize: '0.8125rem', lineHeight: 1.55 }}>
                I agree that AidPulse may collect my location and contact details
                to coordinate disaster relief across Tamil Nadu.
              </span>
            </label>
            {errs.consent && <p className="field-error" style={{ marginTop: '0.4rem' }}>{errs.consent}</p>}
          </div>

          <button
            id="reg-submit"
            type="submit"
            className="btn-solid"
            disabled={busy}
            style={{ width: '100%', marginBottom: '1.5rem' }}
          >
            {busy ? 'Creating account…' : 'Create account'}
          </button>
        </>
      )}

      <p style={{ fontSize: '0.875rem' }}>
        Already registered?{' '}
        <button type="button" className="btn-text" onClick={onSwitch}>Sign in</button>
      </p>
    </form>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function LoginPage() {
  const { user }               = useAuth()
  const navigate               = useNavigate()
  const [mode, setMode]        = useState('login') // 'login' | 'register'

  // Get DigiLocker mode from API (would be set by backend identity adapter)
  const digilockerMode = import.meta.env.VITE_IDENTITY_MODE === 'digilocker'

  React.useEffect(() => {
    if (user) {
      const routes = { citizen: '/citizen', ngo: '/ngo', government: '/government' }
      navigate(routes[user.role] || '/citizen', { replace: true })
    }
  }, [user, navigate])

  return (
    <div className="split-layout">
      {/* Left — brand + legend */}
      <div
        className="left-panel rule-r"
        style={{
          display: 'flex', flexDirection: 'column', justifyContent: 'center',
          padding: 'clamp(2rem, 6vw, 5rem)',
        }}
      >
        <h1 style={{
          fontSize: 'clamp(3rem, 8vw, 5.5rem)',
          letterSpacing: '-0.03em',
          lineHeight: 1,
        }}>
          AidPulse
        </h1>

        <PulseLine />

        <p style={{
          maxWidth: 300, fontSize: '1rem',
          fontWeight: 300, lineHeight: 1.7, opacity: 0.65,
        }}>
          Real-time disaster relief coordination across Tamil Nadu — connecting citizens
          with NGOs and government responders.
        </p>

        {/* Shape legend */}
        <div style={{ marginTop: '4rem', borderTop: 'var(--rule)', paddingTop: '1.5rem' }}>
          <p style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.625rem',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            opacity: 0.4,
            marginBottom: '0.875rem',
          }}>
            Need type legend
          </p>

          {[
            { shape: 'circle',   label: 'Medical' },
            { shape: 'triangle', label: 'Rescue' },
            { shape: 'square',   label: 'Food' },
            { shape: 'diamond',  label: 'Shelter' },
          ].map(({ shape, label }) => (
            <div key={shape} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginTop: '0.6rem' }}>
              <span className={`marker-shape ${shape}`} style={{ flexShrink: 0 }} />
              <span style={{
                fontSize: '0.8125rem',
                fontFamily: 'var(--font-mono)',
                letterSpacing: '0.05em',
              }}>
                {label}
              </span>
            </div>
          ))}
        </div>

        {/* Status legend */}
        <div style={{ marginTop: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          {[
            { style: 'border: 1px dashed var(--ink)',  label: 'Pending' },
            { style: 'border: 1px solid var(--ink); background: var(--ink); color: var(--paper)', label: 'Claimed' },
            { style: 'border: 1px solid var(--ink); background: repeating-linear-gradient(45deg, var(--ink) 0, var(--ink) 1px, transparent 0, transparent 4px)', label: 'Resolved' },
          ].map(({ style: s, label }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <span
                style={{
                  ...Object.fromEntries(s.split(';').map(kv => {
                    const [k, ...v] = kv.split(':')
                    return [k?.trim().replace(/-([a-z])/g, (_, c) => c.toUpperCase()), v.join(':').trim()]
                  }).filter(([k]) => k)),
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.5rem',
                  letterSpacing: '0.07em',
                  padding: '0.1rem 0.3rem',
                  display: 'inline-block',
                }}
              />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', opacity: 0.65 }}>{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Right — auth form */}
      <div style={{
        display: 'flex', flexDirection: 'column', justifyContent: 'center',
        padding: 'clamp(2rem, 6vw, 5rem)',
      }}>
        {mode === 'login'
          ? <LoginForm    onSwitch={() => setMode('register')} />
          : <RegisterForm onSwitch={() => setMode('login')} digilockerMode={digilockerMode} />
        }
      </div>
    </div>
  )
}
