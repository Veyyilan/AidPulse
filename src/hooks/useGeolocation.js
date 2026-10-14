import { useState, useCallback } from 'react'

export function useGeolocation() {
  const [position, setPosition] = useState(null) // { lat, lng, accuracy }
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState(null)

  const request = useCallback(() => {
    if (!navigator.geolocation) {
      setError('Geolocation is not supported by your browser.')
      return
    }
    setLoading(true)
    setError(null)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPosition({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: Math.round(pos.coords.accuracy),
        })
        setLoading(false)
      },
      (err) => {
        const msgs = {
          1: 'Location access denied. Use the map pin below to set location manually.',
          2: 'Position unavailable. Check your GPS signal.',
          3: 'Location request timed out.',
        }
        setError(msgs[err.code] || 'Unknown location error.')
        setLoading(false)
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
    )
  }, [])

  const setManual = useCallback((lat, lng) => {
    setPosition({ lat, lng, accuracy: null })
    setError(null)
  }, [])

  return { position, loading, error, request, setManual }
}
