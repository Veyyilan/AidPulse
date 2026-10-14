import React, { useMemo, useRef, useCallback } from 'react'
import { MapContainer, TileLayer, Marker, Popup, useMapEvents, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { NEED_SHAPES, NEED_LABELS } from '../utils/domain'
import { StatusLabel } from './StatusIndicators'

delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl:       'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl:     'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
})

// Tamil Nadu maxBounds
const TN_MAX_BOUNDS = [[5.0, 73.0], [15.5, 82.5]]

// Create monochrome SVG icon per need type + status
function makeIcon(needType, isFilled) {
  const shape  = NEED_SHAPES[needType?.toLowerCase()] || 'square'
  const fill   = isFilled ? '#111111' : '#F4F1EA'
  const stroke = '#111111'
  let svg = ''

  if (shape === 'circle') {
    svg = `<circle cx="12" cy="12" r="8" stroke="${stroke}" stroke-width="2.5" fill="${fill}"/>`
  } else if (shape === 'triangle') {
    svg = `<polygon points="12,3 22,21 2,21" stroke="${stroke}" stroke-width="2.5" fill="${fill}"/>`
  } else if (shape === 'diamond') {
    svg = `<rect x="5" y="5" width="14" height="14" transform="rotate(45 12 12)" stroke="${stroke}" stroke-width="2.5" fill="${fill}"/>`
  } else {
    svg = `<rect x="4" y="4" width="16" height="16" stroke="${stroke}" stroke-width="2.5" fill="${fill}"/>`
  }

  return L.divIcon({
    html: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22">${svg}</svg>`,
    className: '',
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    popupAnchor: [0, -14],
  })
}

// GPS accuracy circle (not drawn in Leaflet to avoid complexity — shown as text)
function MapClickHandler({ onMapClick }) {
  useMapEvents({ click: (e) => onMapClick?.(e.latlng.lat, e.latlng.lng) })
  return null
}

function PinMarker({ pin, onDragEnd }) {
  const ref = useRef(null)
  const handlers = useMemo(() => ({
    dragend() {
      const ll = ref.current?.getLatLng()
      if (ll) onDragEnd?.(ll.lat, ll.lng)
    },
  }), [onDragEnd])

  const icon = L.divIcon({
    html: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="26" height="26">
      <circle cx="12" cy="10" r="6" stroke="#111" stroke-width="2" fill="#F4F1EA"/>
      <line x1="12" y1="16" x2="12" y2="22" stroke="#111" stroke-width="2"/>
    </svg>`,
    className: '',
    iconSize: [26, 26],
    iconAnchor: [13, 22],
    popupAnchor: [0, -24],
  })

  return (
    <Marker
      draggable={Boolean(onDragEnd)}
      eventHandlers={handlers}
      position={[pin.lat, pin.lng]}
      icon={icon}
      ref={ref}
    >
      <Popup>
        <div style={{ fontFamily: 'var(--font-sans)', fontSize: '0.8125rem' }}>
          <strong>{pin.source === 'gps' ? 'GPS fix' : 'Manual pin'}</strong>
          {pin.accuracy != null && <div style={{ opacity: 0.65, fontSize: '0.75rem' }}>Accuracy ±{pin.accuracy} m</div>}
          <code style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', display: 'block', marginTop: 4 }}>
            {pin.lat.toFixed(5)}, {pin.lng.toFixed(5)}
          </code>
          {onDragEnd && <div style={{ fontSize: '0.7rem', opacity: 0.5, marginTop: 4 }}>Drag to adjust</div>}
        </div>
      </Popup>
    </Marker>
  )
}

// Imperatively re-center map when center prop changes (react-leaflet v5)
function MapController({ center, zoom }) {
  const map = useMap()
  const prev = useRef(null)
  if (!prev.current ||
      prev.current[0] !== center[0] ||
      prev.current[1] !== center[1]) {
    prev.current = center
    map.setView(center, zoom ?? map.getZoom(), { animate: true })
  }
  return null
}

export const DEFAULT_TN_CENTER = [11.13, 78.66]
export const CHENNAI_CENTER    = [13.08, 80.27]

export default function AidMap({
  reports    = [],
  center     = DEFAULT_TN_CENTER,
  zoom       = 7,
  height     = '100%',
  onMapClick,
  manualPin,
  onPinDragEnd,
  selectedId,
  onReportClick,
  readOnly   = false,
  autoCenter = false,
}) {
  return (
    <div style={{ height, width: '100%', position: 'relative' }}>
      <MapContainer
        center={center}
        zoom={zoom}
        style={{ height: '100%', width: '100%' }}
        maxBounds={TN_MAX_BOUNDS}
        maxBoundsViscosity={0.8}
        zoomControl
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {autoCenter && <MapController center={center} zoom={zoom} />}

        {!readOnly && onMapClick && <MapClickHandler onMapClick={onMapClick} />}

        {reports.map((r) => {
          if (r.lat == null || r.lng == null) return null
          // For multi-need reports, show the primary (first) need
          const primaryNeed = (r.needs?.[0]?.needType) || r.needType || 'rescue'
          const allResolved = (r.needs || []).every(n => n.status === 'resolved')
          const anyClaimed  = (r.needs || []).some(n => n.status === 'claimed' || n.status === 'on_the_way' || n.status === 'in_progress')
          const isFilled    = allResolved || anyClaimed

          return (
            <Marker
              key={r.id}
              position={[r.lat, r.lng]}
              icon={makeIcon(primaryNeed, isFilled)}
              eventHandlers={{ click: () => onReportClick?.(r) }}
              opacity={selectedId && selectedId !== r.id ? 0.5 : 1}
            >
              <Popup>
                <div style={{ fontFamily: 'var(--font-sans)', minWidth: 170 }}>
                  {(r.needs || [{ needType: r.needType, status: r.status }]).map(n => (
                    <div key={n.needType} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.3rem' }}>
                      <StatusLabel status={n.status} />
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem' }}>
                        {NEED_LABELS[n.needType] || n.needType?.toUpperCase()}
                      </span>
                    </div>
                  ))}
                  <code style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', opacity: 0.55, display: 'block', marginTop: 4 }}>
                    {r.lat.toFixed(5)}, {r.lng.toFixed(5)}
                  </code>
                </div>
              </Popup>
            </Marker>
          )
        })}

        {manualPin && (
          <PinMarker pin={manualPin} onDragEnd={readOnly ? undefined : onPinDragEnd} />
        )}
      </MapContainer>
    </div>
  )
}
