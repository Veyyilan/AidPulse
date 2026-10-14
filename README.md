# AidPulse

AidPulse is a real-time disaster relief platform. Citizens report needs with GPS location, NGOs claim them instantly so no request is served twice, and government and admins see live maps and coverage gaps. A MERN-stack PWA that queues reports offline and sends them when signal returns.

> Real-time disaster relief coordination PWA.  
> Built with React + Vite · Tailwind CSS · React-Leaflet · Socket.IO · PWA

## Quick Start

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173)

---

## Demo Accounts

Sign in with **any password** and one of these emails to access each role:

| Email | Role |
|---|---|
| `citizen@test.com` | Citizen |
| `ngo@relief.org` | NGO / Volunteer |
| `gov@lagos.ng` | Government |
| `admin@sys.aidpulse` | Admin |

---

## Project Structure

```
src/
├── api/
│   ├── axiosInstance.js     # Axios with VITE_API_URL + JWT interceptor
│   └── endpoints.js         # All API calls (1:1 with backend routes)
├── components/
│   ├── AidMap.jsx           # react-leaflet map, shape-based markers
│   ├── Nav.jsx              # Top nav with role + offline indicator
│   ├── ProtectedRoute.jsx   # JWT role guard
│   ├── StatusIndicators.jsx # Shape/text status labels (no color encoding)
│   └── Toast.jsx            # Auto-dismissing notification
├── context/
│   ├── AuthContext.jsx      # JWT auth state; swap login() for real API
│   ├── OfflineContext.jsx   # Online/offline + submission queue
│   └── SocketContext.jsx    # Socket.IO with JWT handshake + event listeners
├── hooks/
│   ├── useGeolocation.js    # GPS + manual override
│   └── useReports.js        # Report CRUD, optimistic updates, offline queue
└── pages/
    ├── LoginPage.jsx        # Full-page split login/register
    ├── CitizenPage.jsx      # Report form + my reports list
    ├── NGOPage.jsx          # Map + pending request list with claim
    ├── GovernmentPage.jsx   # Read-only map + stats strip + filters
    └── AdminPage.jsx        # Clusters table, heatmap, user management
```

---

## Backend Contract

### Environment

```
VITE_API_URL=http://localhost:4000/api
```

### JWT Payload Required

```json
{ "id": "...", "role": "citizen|ngo|government|admin", "name": "..." }
```

### Auth Endpoints

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/auth/login` | `{ email, password }` | `{ token, user }` |
| POST | `/auth/register` | `{ name, email, password, role }` | `{ token, user }` |
| GET | `/auth/me` | — | `{ user }` |

### Reports Endpoints

| Method | Path | Notes |
|---|---|---|
| POST | `/reports` | `{ needType, description, lat, lng, accuracy }` |
| GET | `/reports/mine` | Authenticated user reports |
| GET | `/reports/nearby?lat=&lng=` | Sorted by distance |
| GET | `/reports?status=&needType=` | All reports, filterable |
| POST | `/reports/:id/claim` | Returns 409 if already claimed |
| POST | `/reports/:id/release` | Force-release stale claim |
| PATCH | `/reports/:id/status` | `{ status }` |

### Admin Endpoints

| Method | Path |
|---|---|
| GET | `/users` |
| POST | `/users/:id/suspend` |
| POST | `/users/:id/restore` |
| GET | `/stats/overview` |
| GET | `/stats/gaps` |
| GET | `/stats/clusters` |

### Socket.IO Events (Server to Client)

| Event | Payload |
|---|---|
| `report:new` | Full report object |
| `report:claimed` | `{ id, claimedBy, status }` |
| `report:status_updated` | `{ id, status }` |
| `report:released` | `{ id, status: "pending" }` |
| `gap:alert` | `{ lat, lng, radius, count }` |

Connect with `{ auth: { token } }` in handshake.

---

## Design System

- `--ink: #111111` / `--paper: #F4F1EA` — only two colors
- Dark mode: `data-theme="dark"` on `<html>`
- Fonts: Newsreader (headings), IBM Plex Sans (body), IBM Plex Mono (coords/IDs)
- No gradients, no shadows, no rounded corners, no color-based status encoding
- Status shown by: text label + shape (filled/outlined/hatched marker)
- Map markers: circle=Medical, square=Water, triangle=Shelter, diamond=Food

---

## PWA / Offline

- Service worker caches app shell + OSM tiles (7-day TTL, max 500)
- Offline queue stored in `localStorage` as `aidpulse_submission_queue`
- Auto-retried on reconnect via `aidpulse:retry-queue` custom event
