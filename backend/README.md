# AidPulse Backend

Express + Mongoose + Socket.IO backend for AidPulse.

- **Auth**: JWT (bcrypt hashed passwords, bcryptjs).
- **Realtime**: Socket.IO with token handshake auth and role-based rooms.
- **Geo**: MongoDB `2dsphere` index for `$near` / `$geoNear` queries, duplicate detection, and coverage-gap aggregation.
- **Integrity**: claims are a single atomic `findOneAndUpdate`; claim history is an append-only `claimaudits` collection.

## Quick start

```bash
cd backend
npm install
cp .env.example .env      # then edit values
npm run seed              # create demo users + sample reports
npm run dev               # http://localhost:4000
```

## Scripts

| Script | Description |
| --- | --- |
| `npm run dev` | Start with nodemon (auto-reload) |
| `npm start` | Start production server |
| `npm run seed` | Seed demo users and reports (idempotent upsert by email) |
| `npm test` | Run the full end-to-end suite (in-memory MongoDB, no DB required) |
| `npm run test:smoke` | HTTP/API integration checks |
| `npm run test:realtime` | Socket.IO auth/rooms/events + stale-claim sweeper |

### Running the tests

`npm test` boots an in-memory MongoDB (`mongodb-memory-server`) and the real
HTTP + Socket.IO server, then drives them end-to-end. No external database or
network is required after the first run (the mongod binary is cached locally).

### Local MongoDB with Docker

```bash
npm run dev            # in one terminal (needs a running MongoDB)
docker compose up -d   # in another, if you don't have MongoDB installed
```

## API

### Auth — `/api/auth`
| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| POST | `/register` | – | `{ name, email, password, role?, phone?, organizationName? }`. `admin` can never be self-assigned. |
| POST | `/login` | – | `{ email, password }` → `{ id, name, email, role, token }` |
| GET | `/me` | JWT | Current user |

### Reports — `/api/reports`
| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| POST | `/` | citizen | Create report; runs duplicate detection; rate limited |
| GET | `/` | ngo/gov/admin | Filters: `status`, `needType`, `limit` |
| GET | `/mine` | any | Reports created by caller |
| GET | `/nearby?lat&lng&maxDistance` | ngo/gov/admin | `$geoNear` sorted by distance |
| PATCH | `/:id/claim` | ngo | Atomic claim → `409` if already taken |
| PATCH | `/:id/release` | ngo/admin | Release a claim |
| PATCH | `/:id/status` | ngo/gov/admin | `{ status }` |

> `POST /:id/claim` and `POST /:id/release` are also accepted (frontend compatibility).

### Admin — `/api/admin`
| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/duplicates` | admin | Duplicate clusters |
| GET | `/gaps` | admin | Coverage-gap cells |
| GET | `/audit/:id` | admin | Claim audit trail for a report |
| PATCH | `/users/:id/suspend` | admin | `{ suspended?: boolean }` (default `true`) |

### SMS — `/api/sms`
| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| POST | `/inbound` | `x-api-key` | Parses `"NEED, location text"` into a report with `source: sms` |

### Frontend compatibility shim (also mounted)
`GET /api/users`, `POST /api/users/:id/suspend`, `POST /api/users/:id/restore`,
`GET /api/stats/overview`, `GET /api/stats/gaps`, `GET /api/stats/clusters`,
`GET /api/health`.

## Socket.IO

Connect with `io(url, { auth: { token } })`. Rooms are joined from the **verified role only**:

| Role | Room |
| --- | --- |
| ngo | `ngo-room` |
| government | `control-room` |
| admin | `admin-room` |
| any | `user:<id>` |

Server → client events: `report:new`, `report:claimed`, `report:status_updated`, `report:released`, `gap:alert`.

## Data integrity guarantees

1. **Atomic claim** — a single conditional `findOneAndUpdate`; two NGOs can never claim the same case.
2. **Duplicate detection** — new reports within 150 m and 2 h of an existing open report of the same need type get `duplicateOf` set and increment the original's `duplicateCount`.
3. **Audit-then-emit** — a `claimaudits` row is written *before* the socket event is emitted.
4. **Stale-claim sweeper** — cron job reverts claims idle longer than `STALE_CLAIM_HOURS` and logs `force_released`.
5. **Append-only audit** — `claimaudits` has no update/delete routes and model hooks reject mutation.
