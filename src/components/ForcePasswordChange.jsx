import React, { useState } from 'react'
import { useAuth } from '../context/AuthContext'

// Shown when the signed-in account still has mustChangePassword=true. Every
// other API route returns 403 until the password is changed, so we block the
// rest of the app behind this screen.
export default function ForcePasswordChange() {
  const { user, changePassword, logout } = useAuth()
  const [current, setCurrent] = useState('')
  const [next,    setNext]    = useState('')
  const [confirm, setConfirm] = useState('')
  const [err,     setErr]     = useState('')
  const [busy,    setBusy]    = useState(false)

  const onSubmit = async (e) => {
    e.preventDefault()
    setErr('')
    if (next.length < 8)          { setErr('New password must be at least 8 characters.'); return }
    if (next !== confirm)         { setErr('New passwords do not match.'); return }
    if (next === current)         { setErr('New password must differ from the current one.'); return }
    setBusy(true)
    try {
      await changePassword(current, next)
    } catch (e2) {
      setErr(e2.message || 'Could not change password.')
    } finally {
      setBusy(false)
    }
  }

  const fields = [
    { id: 'cp-current', label: 'Current (temporary) password', val: current, set: setCurrent },
    { id: 'cp-new',     label: 'New password (min. 8 characters)', val: next, set: setNext },
    { id: 'cp-confirm', label: 'Confirm new password', val: confirm, set: setConfirm },
  ]

  return (
    <div style={{ display: 'flex', minHeight: 'calc(100dvh - 52px)', padding: '2rem 1.25rem' }}>
      <div style={{ margin: 'auto', width: '100%', maxWidth: 380 }}>
        <h2 style={{ marginBottom: '0.4rem' }}>Set a new password</h2>
        <p style={{ opacity: 0.55, fontSize: '0.875rem', marginBottom: '2rem' }}>
          This account was created with a temporary password. Choose a new one to continue
          {user?.email ? ` (${user.email})` : ''}.
        </p>

        <form onSubmit={onSubmit} noValidate>
          {err && (
            <p style={{ fontSize: '0.8125rem', fontWeight: 500, marginBottom: '1rem' }}>{err}</p>
          )}

          {fields.map(({ id, label, val, set }) => (
            <div key={id} style={{ marginBottom: '1.5rem' }}>
              <label className="field-label" htmlFor={id}>{label}</label>
              <input
                id={id}
                type="password"
                autoComplete="off"
                className="input-underline"
                value={val}
                onChange={e => set(e.target.value)}
              />
            </div>
          ))}

          <button
            id="cp-submit"
            type="submit"
            className="btn-solid"
            disabled={busy}
            style={{ width: '100%', marginBottom: '1.25rem' }}
          >
            {busy ? 'Saving…' : 'Save and continue'}
          </button>

          <button type="button" className="btn-text" onClick={logout} style={{ fontSize: '0.8125rem' }}>
            Sign out
          </button>
        </form>
      </div>
    </div>
  )
}
