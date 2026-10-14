import React, { useEffect, useRef } from 'react'
import { MapContainer, TileLayer, Marker, Popup, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { NeedTypeShape, StatusLabel } from './StatusIndicators'

// Fix leaflet default marker icon missing in Vite
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
})

// Custom SVG icon factory — shape-based, monochrome
function createShapeIcon(needType, status) {
  const filled = status === 'claimed' || status === 'resolved'
  const shapeMap = {
    Medical: `<circle cx="12" cy="12" r="8" stroke="var(--ink)" stroke-width="2" fill="${filled ? 'var(--ink)' : 'var(--paper)'}" />`,
    Water:   `<rect x="4" y="4" width="16" height="16" stroke="var(--ink)" stroke-width="2" fill="${filled ? 'var(--ink)' : 'var(--paper)'}" />`,
    Shelter: `<polygon points="12,3 22,21 2,21" stroke="var(--ink)" stroke-width="2" fill="${filled ? 'var(--ink)' : 'var(--paper)'}" />`,
    Food:    `<rect x="4" y="12" width="16" height="16" stroke="var(--ink)" stroke-width="2" fill="${filled ? 'var(--ink)' : 'var(--paper)'}" transform="rotate(-45 12 12)" />`,
  }
  const shape = shapeMap[needType] || shapeMap.Water
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">${shape}</svg>`
  return L.divIcon({
    html: svg,
    className: '',
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -14],
  })
}

// Map click handler for manual pin
function MapClickHandler({ onMapClick }) {
  useMapEvents({
    click: (e) => onMapClick?.(e.latlng.lat, e.latlng.lng),
  })
  return null
}

export default function AidMap({
  reports = [],
  center = [6.4550, 3.3841],
  zoom = 13,
  onMapClick,
  manualPin,
  height = '100%',
  selectedId,
  onReportClick,
  readOnly = false,
}) {
  return (
    <div style={{ height, width: '100%', position: 'relative' }}>
      <MapContainer
        center={center}
        zoom={zoom}
        style={{ height: '100%', width: '100%' }}
        zoomControl={true}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {!readOnly && onMapClick && <MapClickHandler onMapClick={onMapClick} />}

        {reports.map(r => (
          <Marker
            key={r.id}
            position={[r.lat, r.lng]}
            icon={createShapeIcon(r.needType, r.status)}
            eventHandlers={{ click: () => onReportClick?.(r) }}
          >
            <Popup className="aid-popup">
              <div style={{ fontFamily: 'var(--font-sans)', minWidth: 160 }}>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.4rem' }}>
                  <StatusLabel status={r.status} />
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem' }}>{r.needType?.toUpperCase()}</span>
                </div>
                <p style={{ fontSize: '0.8125rem', marginBottom: '0.4rem' }}>{r.description}</p>
                <code className="mono" style={{ fontSize: '0.65rem', opacity: 0.6 }}>
                  {r.lat.toFixed(5)}, {r.lng.toFixed(5)}
                </code>
              </div>
            </Popup>
          </Marker>
        ))}

        {manualPin && (
          <Marker position={[manualPin.lat, manualPin.lng]}>
            <Popup>Manual pin location</Popup>
          </Marker>
        )}
      </MapContainer>
    </div>
  )
}
