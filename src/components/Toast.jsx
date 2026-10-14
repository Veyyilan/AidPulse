import React, { useEffect, useState } from 'react'

export default function Toast({ message, duration = 4000, onDone }) {
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const t = setTimeout(() => { setVisible(false); onDone?.() }, duration)
    return () => clearTimeout(t)
  }, [duration, onDone])

  if (!visible) return null
  return (
    <div className="toast" role="status" aria-live="polite">
      {message}
    </div>
  )
}
