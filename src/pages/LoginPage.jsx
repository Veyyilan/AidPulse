import React, { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useAuth } from '../context/AuthContext'

// ─── Schemas ──────────────────────────────────────────────────────────────
const loginSchema = z.object({
  email:    z.string().email('Enter a valid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
})

const registerSchema = z.object({
  name:     z.string().min(2, 'Name must be at least 2 characters'),
  email:    z.string().email('Enter a valid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  role:     z.enum(['citizen', 'ngo', 'government'], { message: 'Select a role' }),
})

// ─── Pulse line SVG ───────────────────────────────────────────────────────
function PulseLine() {
  return (
    <div className="pulse-line" style={{ margin: '1.5rem 0' }}>
      <svg width="180" height="32" viewBox="0 0 180 32" fill="none">
        <path
          d="M0 16 L30 16 L40 4 L50 28 L60 16 L80 16 L90 8 L100 24 L110 16 L130 16 L138 10 L146 22 L154 16 L180 16"
          stroke="var(--ink)"
          strokeWidth="1.5"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  )
}

// ─── Login Form ───────────────────────────────────────────────────────────
function LoginForm({ onSwitch }) {
  const { login } = useAuth()
  const navigate   = useNavigate()
  const [serverError, setServerError] = useState('')
  const [loading, setLoading]         = useState(false)

  const { register, handleSubmit, formState: { errors } } = useForm({
    resolver: zodResolver(loginSchema),
  })

  const onSubmit = async (data) => {
    setLoading(true)
    setServerError('')
    try {
      const user = await login(data.email, data.password)
      const routes = { citizen: '/citizen', ngo: '/ngo', government: '/government', admin: '/admin' }
      navigate(routes[user.role] || '/citizen')
    } catch {
      setServerError('Invalid credentials. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate style={{ maxWidth: 360 }}>
      <h2 style={{ marginBottom: '0.5rem' }}>Sign in</h2>
      <p style={{ opacity: 0.55, fontSize: '0.875rem', marginBottom: '2.5rem' }}>
        Access your AidPulse dashboard.
      </p>

      {serverError && (
        <p style={{ fontSize: '0.8125rem', marginBottom: '1rem', opacity: 0.8 }}>{serverError}</p>
      )}

      <div style={{ marginBottom: '1.75rem' }}>
        <label className="field-label" htmlFor="login-email">Email address</label>
        <input
          id="login-email"
          type="email"
          autoComplete="email"
          className={`input-underline${errors.email ? ' error' : ''}`}
          placeholder="you@example.com"
          {...register('email')}
        />
        {errors.email && <p className="field-error">{errors.email.message}</p>}
      </div>

      <div style={{ marginBottom: '2.5rem' }}>
        <label className="field-label" htmlFor="login-password">Password</label>
        <input
          id="login-password"
          type="password"
          autoComplete="current-password"
          className={`input-underline${errors.password ? ' error' : ''}`}
          placeholder="••••••••"
          {...register('password')}
        />
        {errors.password && <p className="field-error">{errors.password.message}</p>}
      </div>

      <button
        id="login-submit"
        type="submit"
        className="btn-solid"
        disabled={loading}
        style={{ width: '100%', marginBottom: '1.5rem' }}
      >
        {loading ? 'Signing in...' : 'Sign in'}
      </button>

      <p style={{ fontSize: '0.875rem' }}>
        No account?{' '}
        <button type="button" className="btn-text" onClick={onSwitch}>
          Register here
        </button>
      </p>
    </form>
  )
}

// ─── Register Form ────────────────────────────────────────────────────────
function RegisterForm({ onSwitch }) {
  const { register: registerUser } = useAuth()
  const navigate = useNavigate()
  const [loading, setLoading]    = useState(false)
  const [serverError, setServerError] = useState('')

  const { register, handleSubmit, formState: { errors } } = useForm({
    resolver: zodResolver(registerSchema),
    defaultValues: { role: 'citizen' },
  })

  const onSubmit = async (data) => {
    setLoading(true)
    setServerError('')
    try {
      const user = await registerUser(data.name, data.email, data.password, data.role)
      const routes = { citizen: '/citizen', ngo: '/ngo', government: '/government', admin: '/admin' }
      navigate(routes[user.role] || '/citizen')
    } catch {
      setServerError('Registration failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate style={{ maxWidth: 360 }}>
      <h2 style={{ marginBottom: '0.5rem' }}>Create account</h2>
      <p style={{ opacity: 0.55, fontSize: '0.875rem', marginBottom: '2.5rem' }}>
        Join the network. Respond faster.
      </p>

      {serverError && (
        <p style={{ fontSize: '0.8125rem', marginBottom: '1rem', opacity: 0.8 }}>{serverError}</p>
      )}

      <div style={{ marginBottom: '1.75rem' }}>
        <label className="field-label" htmlFor="reg-name">Full name</label>
        <input id="reg-name" type="text" className={`input-underline${errors.name ? ' error' : ''}`}
          placeholder="Your name" autoComplete="name" {...register('name')} />
        {errors.name && <p className="field-error">{errors.name.message}</p>}
      </div>

      <div style={{ marginBottom: '1.75rem' }}>
        <label className="field-label" htmlFor="reg-email">Email address</label>
        <input id="reg-email" type="email" className={`input-underline${errors.email ? ' error' : ''}`}
          placeholder="you@example.com" autoComplete="email" {...register('email')} />
        {errors.email && <p className="field-error">{errors.email.message}</p>}
      </div>

      <div style={{ marginBottom: '1.75rem' }}>
        <label className="field-label" htmlFor="reg-password">Password</label>
        <input id="reg-password" type="password" className={`input-underline${errors.password ? ' error' : ''}`}
          placeholder="Min. 6 characters" autoComplete="new-password" {...register('password')} />
        {errors.password && <p className="field-error">{errors.password.message}</p>}
      </div>

      <div style={{ marginBottom: '2.5rem' }}>
        <label className="field-label" htmlFor="reg-role">Role</label>
        <select id="reg-role" className={`select-underline${errors.role ? ' error' : ''}`} {...register('role')}>
          <option value="citizen">Citizen</option>
          <option value="ngo">NGO / Volunteer</option>
          <option value="government">Government responder</option>
        </select>
        {errors.role && <p className="field-error">{errors.role.message}</p>}
      </div>

      <button type="submit" id="reg-submit" className="btn-solid" disabled={loading}
        style={{ width: '100%', marginBottom: '1.5rem' }}>
        {loading ? 'Creating account...' : 'Create account'}
      </button>

      <p style={{ fontSize: '0.875rem' }}>
        Already registered?{' '}
        <button type="button" className="btn-text" onClick={onSwitch}>Sign in</button>
      </p>
    </form>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────
export default function LoginPage() {
  const { user } = useAuth()
  const navigate  = useNavigate()
  const [mode, setMode] = useState('login') // 'login' | 'register'

  useEffect(() => {
    if (user) {
      const routes = { citizen: '/citizen', ngo: '/ngo', government: '/government', admin: '/admin' }
      navigate(routes[user.role] || '/citizen')
    }
  }, [user, navigate])

  return (
    <div className="split-layout">
      {/* Left — wordmark + tagline */}
      <div className="left-panel rule-r" style={{
        display: 'flex', flexDirection: 'column', justifyContent: 'center',
        padding: 'clamp(2rem, 6vw, 5rem)',
      }}>
        <h1 style={{ fontSize: 'clamp(3rem, 7vw, 5.5rem)', letterSpacing: '-0.03em', lineHeight: 1 }}>
          AidPulse
        </h1>
        <PulseLine />
        <p style={{ maxWidth: 320, fontSize: '1rem', fontWeight: 300, lineHeight: 1.7, opacity: 0.7 }}>
          Real-time disaster relief coordination — connecting citizens who need help with
          the NGOs and responders who can deliver it.
        </p>

        <div style={{ marginTop: '4rem', borderTop: 'var(--rule)', paddingTop: '1.5rem' }}>
          <p className="mono" style={{ fontSize: '0.6875rem', opacity: 0.4, letterSpacing: '0.08em' }}>
            SHAPES LEGEND
          </p>
          {[
            ['circle', 'Medical'],
            ['square', 'Water'],
            ['triangle', 'Shelter'],
            ['diamond', 'Food'],
          ].map(([shape, label]) => (
            <div key={shape} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginTop: '0.6rem' }}>
              <span className={`marker-shape ${shape}`} style={{ flexShrink: 0 }} />
              <span style={{ fontSize: '0.8125rem', fontFamily: 'var(--font-mono)', letterSpacing: '0.05em' }}>
                {label}
              </span>
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
          : <RegisterForm onSwitch={() => setMode('login')} />
        }
      </div>
    </div>
  )
}
