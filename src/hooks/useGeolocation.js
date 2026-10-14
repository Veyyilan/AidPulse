import { useState, useCallback, useRef, useEffect } from 'react'

// Tamil Nadu bounds
export const TN_BOUNDS = { minLat: 7.9, maxLat: 13.7, minLng: 76.1, maxLng: 80.5 }

export function isInsideTN(lat, lng) {
  return lat >= TN_BOUNDS.minLat && lat <= TN_BOUNDS.maxLat &&
         lng >= TN_BOUNDS.minLng && lng <= TN_BOUNDS.maxLng
}

function geoMsg(code) {
  switch (code) {
    case 1: return 'Location access denied. Go to Site settings → Location → Allow.'
    case 2: return 'Device cannot find location. Turn on Location in device settings.'
    case 3: return 'Location timed out. Tap "Use my location" to retry, or place pin manually.'
    default: return 'Location unavailable. Place pin manually on the map.'
  }
}

export function useGeolocation() {
  const [position,  setPosition]  = useState(null)
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState(null)
  const [warning,   setWarning]   = useState(null)
  const [denied,    setDenied]    = useState(false)

  const watchId    = useRef(null)
  const timerRef   = useRef(null)
  const bestRef    = useRef(null)
  const mountGuard = useRef(false)   // StrictMode guard

  const stop = useCallback(() => {
    if (watchId.current !== null) {
      navigator.geolocation.clearWatch(watchId.current)
      watchId.current = null
    }
    clearTimeout(timerRef.current)
    timerRef.current = null
  }, [])

  const applyBest = useCallback(() => {
    stop()
    setLoading(false)
    const b = bestRef.current
    if (b) {
      setPosition(b)
      setWarning(b.accuracy > 100
        ? 'Accuracy over 100 m — move to open sky or drag the pin to refine.'
        : null)
    } else {
      setError('Could not fix location. Place the pin manually on the map.')
    }
  }, [stop])

  const startWatch = useCallback(() => {
    if (!navigator.geolocation) {
      setError('Geolocation not supported by this browser.')
      return
    }
    stop()
    setLoading(true)
    setError(null)
    setWarning(null)
    bestRef.current = null

    timerRef.current = setTimeout(applyBest, 20000)

    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude: lat, longitude: lng, accuracy } = pos.coords
        const acc = Math.round(accuracy)
        const candidate = { lat, lng, accuracy: acc, source: 'gps' }
        if (!bestRef.current || acc < bestRef.current.accuracy) {
          bestRef.current = candidate
          setPosition(candidate)
          setWarning(acc > 100
            ? `Accuracy ${acc} m — move to open sky or drag pin to refine.`
            : null)
        }
        if (acc <= 30) applyBest()
      },
      (err) => {
        stop()
        setLoading(false)
        if (err.code === 1) setDenied(true)
        setError(geoMsg(err.code))
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 5000 }
    )
  }, [stop, applyBest])

  // On mount: check permission, auto-start if granted. Guard against StrictMode double-fire.
  useEffect(() => {
    if (mountGuard.current) return
    mountGuard.current = true

    if (!navigator.geolocation) {
      setError('Geolocation not supported by this browser.')
      return
    }

    const tryAuto = () => startWatch()

    if (navigator.permissions) {
      navigator.permissions.query({ name: 'geolocation' }).then((status) => {
        if (status.state === 'granted') tryAuto()
        // Listen for user changing permission while page is open
        status.addEventListener('change', () => {
          if (status.state === 'granted') { setDenied(false); tryAuto() }
          if (status.state === 'denied')  { setDenied(true);  stop() }
        })
      }).catch(tryAuto)
    } else {
      tryAuto()
    }

    return () => stop()
  }, [startWatch, stop])

  // Manual trigger from "Use my location" button
  const request = useCallback(() => {
    setDenied(false)
    startWatch()
  }, [startWatch])

  const setManual = useCallback((lat, lng) => {
    stop()
    setLoading(false)
    setError(null)
    setWarning(null)
    setPosition({ lat, lng, accuracy: null, source: 'manual' })
  }, [stop])

  const clear = useCallback(() => {
    stop()
    setPosition(null)
    setError(null)
    setWarning(null)
    bestRef.current = null
  }, [stop])

  return { position, loading, error, warning, denied, request, setManual, clear }
}
