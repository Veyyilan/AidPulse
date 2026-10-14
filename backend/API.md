# AidPulse API

Base URL: `/api` — all requests and responses are JSON (`Content-Type: application/json`).

**Authentication**: `Authorization: Bearer <JWT>`. Tokens come from `POST /auth/login` and
`POST /auth/register`. The role returned by `GET /auth/me` is always read from the database,
never trusted from the token.

**Roles**: `citizen`, `ngo`, `government`. Every protected route runs a JWT middleware
followed by a separate role middleware. A suspended account receives **401** (not 403) on
every authenticated route.

**First-login password change**: government-provisioned NGOs (and the bootstrapped government
account) start with `mustChangePassword=true`. While it is set, only `GET /auth/me` and
`POST /auth/change-password` are allowed — every other route returns **403**. The flag is read
from the database on every request, so clearing it takes effect immediately for the existing
token. Suspending an account also disconnects any socket it already has open.

---

## Error format

```json
{ "error": "Human readable message", "details": [{ "field": "needs", "message": "…" }] }
```

| Status | Meaning |
| --- | --- |
| 400 | Malformed request (bad `code`/`state`, invalid ObjectId) |
| 401 | Missing/invalid/expired token, suspended account, bad credentials |
| 403 | Wrong role, an NGO without the required capability, a non-owner acting on a claimed need, or a user who still must change their password |
| 404 | Resource not found |
| 409 | Conflict — claim lost/not yours to release, a status step that is skipped or backwards, releasing an unclaimed need, duplicate email/phone |
| 422 | Validation failed — outside Tamil Nadu, empty/duplicate/unknown needs, missing consent |
| 429 | Rate limit exceeded |
| 501 | Feature not enabled (DigiLocker routes in `basic` mode, or credentials absent) |
| 502 | Upstream DigiLocker failure |
| 500 | Unexpected server error |

---

## Authentication — `/api/auth`

### POST `/auth/register`
Self-registration. **Always creates a citizen — any `role` in the body is ignored.**

```json
{ "name": "Asha", "phone": "9000000001", "password": "Password123!", "consent": true, "email": "optional@x.test" }
```

| Field | Rule |
| --- | --- |
| `name` | required, 2–120 chars |
| `phone` | required, exactly 10 digits starting `6–9`; stored as `+91XXXXXXXXXX` |
| `password` | required, minimum 8 chars |
| `consent` | required, must be `true` — stored as `consentAt` |
| `email` | optional, unique-sparse |
| `role` | ignored (citizen-only registration) |

**201** → user object + `token`. `identityVerified` is `false` in `basic` mode.
**422** if consent is missing/true-false-mismatched, the phone is invalid, or the phone is
already registered (**409**).

### POST `/auth/login`
Provide **one** of:

- citizens → `{ "phone": "9000000001", "password": "…" }` (bare 10 digits or `+91…`)
- ngo / government → `{ "email": "x@y.test", "password": "…" }`

**200** → `{ id, name, phone, email, role, capabilities, organizationName, identityVerified,
verifiedName, mustChangePassword, isSuspended, consentAt, createdAt, token }`.
**401** for bad credentials or a suspended account.

### GET `/auth/me`
**200** → the same object as login (role reflects the database, plus the current `token`).

### POST `/auth/change-password`
```json
{ "currentPassword": "…", "newPassword": "…" }
```
**200** → clears `mustChangePassword`. Used by government-provisioned NGOs (and the
bootstrapped government account) on first login. **401** if `currentPassword` is wrong.
**422** if `newPassword` is identical to the current password.

---

## Identity — `/api/identity`

The adapter is behind `IDENTITY_MODE`. In `basic` mode (default) the DigiLocker routes
return **501** and nothing else breaks.

### GET `/identity/mode`
**200** → `{ "mode": "basic" | "digilocker", "digilockerConfigured": false }` (no secrets).

### GET `/identity/digilocker/start`
Auth required. **200** → `{ url, state, expiresAt }` (OAuth authorization code + PKCE S256;
the code verifier and state are held server-side with a short TTL).
**501** in `basic` mode or when DigiLocker credentials are absent.

### GET `/identity/digilocker/callback?code=…&state=…`
Exchanges the code, then stores **only** `identityVerified`, the verified name, and a
hashed DigiLocker reference — **never an Aadhaar number**. Redirects to
`CLIENT_ORIGIN/identity/done?status=success` when a client origin is configured, otherwise
returns the user object. **501** in `basic` mode.

---

## Reports — `/api/reports`

### POST `/reports`
```json
{ "needs": ["medical", "food"], "lat": 13.08, "lng": 80.27, "accuracyMeters": 12, "clientId": "uuid" }
```

| Field | Rule |
| --- | --- |
| `needs` | required, non-empty, **unique**, each ∈ `rescue` \| `medical` \| `food` \| `shelter` |
| `lat` | required, 7.9–13.7 (Tamil Nadu) |
| `lng` | required, 76.1–80.5 (Tamil Nadu) |
| `accuracyMeters` | optional, ≥ 0 |
| `clientId` | optional, ≤ 100 chars — idempotency key scoped to the reporting user |

**Behaviour**

- **Idempotency runs before rate limiting.** A retry with the same `(user, clientId)`
  returns the originally created report with **200** and never consumes rate-limit budget.
- **Merge runs before visibility.** After insert, the system looks for the *oldest* open
  primary (`mergedInto: null`) within **150 m / 2 h** (any other user) or **300 m / 6 h**
  (same user), merging only into an older report (`createdAt`, then `_id`) so cycles are
  impossible. If it merges: `reporterCount` increments, the child's needs are carried onto
  the primary (a need the primary lacks is added with the child's exact state, so an active
  claim is preserved and never re-added as a second pending need), the child gets
  `mergedInto` set, and **`report:status_updated`** is emitted for the primary instead of
  `report:new`. Merged reports are never deleted.
- `accuracyMeters > 1000` sets `flags: ["low_accuracy"]`.
- More than 5 merges into one report from the same user sets `flags: ["excessive_merges"]`.

**201** → report (or **200** on an idempotent hit). **422** outside Tamil Nadu or for bad
needs. **429** after 10 new reports per 10 minutes per user.

### GET `/reports`
Filters: `?status=pending|claimed|in_progress|resolved`, `?needType=…`, `?limit=1–500`.
Only primary reports (`mergedInto: null`) are returned.

- `ngo` → only reports containing a need in their `capabilities`; `needType` outside their
  capabilities returns `[]`.
- `government` → everything, `reportedBy` visible.
- `citizen` → everything with `reportedBy` hidden (`null`).

**200** → array of reports.

### GET `/reports/mine`
**200** → the reports the caller contributed to. Merged children resolve through
`mergedInto` (depth is always 1) to their primary and are de-duplicated, so a merged
contributor sees the primary's need statuses. For citizens `reportedBy` is `null`: a merged
contributor never sees another reporter's id, phone or name.

### POST `/reports/:id/needs/:type/claim` — NGO only
Atomically claims one need. The guard is a single conditional update
(`$elemMatch` on `{ type, status: "pending" }`) — never read-then-write, so two NGOs racing
on the same need produce exactly one winner.

**200** → updated report. **403** if the NGO lacks that capability. **409** if the need is
already claimed or the report was merged away.

### PATCH `/reports/:id/needs/:type/status` — NGO only
`{ "status": "in_progress" }`. Forward only, one step at a time
(`claimed → in_progress → resolved`), and only the claiming NGO may move it. `POST` with the
same body is also accepted.
**200** → updated report. **403** non-owner (including the previous owner once the sweeper has
released the claim). **409** if the step is skipped or moved backwards, or a concurrent change
loses.

### POST `/reports/:id/needs/:type/release` — NGO only
Returns a claimed/in_progress need to `pending` (claiming NGO only).
**200** → updated report. **403** if the need is currently claimed by another organisation.
**409** if it is not currently claimed by anyone (e.g. already released or swept).

---

## Government — `/api/gov`

All routes require the `government` role (403 otherwise).

| Method | Path | Body | Notes |
| --- | --- | --- | --- |
| POST | `/ngos` | `{ name, email, capabilities[], phone?, organizationName?, password? }` | **201** → `{ ngo, tempPassword }`; `capabilities` is a non-empty subset of the four need types (no `water`). `mustChangePassword=true`; the temp password is returned once. |
| GET | `/ngos` | – | **200** → array of NGO users |
| GET | `/gaps` | – | **200** → 0.01° grid cells with counts of pending needs older than `GAP_THRESHOLD_MINUTES` |
| POST | `/gaps/scan` | – | **200** → `{ changed: [...] }`; emits `gap:alert` only for cells whose state changed |
| GET | `/clusters` | – | **200** → merge clusters (primary + `mergedCount`, `reporterCount`, `flags`) |
| GET | `/flags` | – | **200** → reports carrying spam flags, for review |
| POST | `/users/:id/suspend` | – | **200** → suspended user; also disconnects any socket they have open. **422** if you suspend yourself |
| POST | `/users/:id/restore` | – | **200** → restored user |
| POST | `/force-release` | `{ reportId, needType? }` | **200** → `{ released, report }`. **409** if nothing is claimed |

---

## Health — `/api/health`

Public liveness probe: **200** → `{ "status": "ok", "uptime": 123.4 }`.

---

## Rate limits

| Scope | Limit |
| --- | --- |
| Report creation | 10 **new** reports per 10 minutes, keyed by user id (fixed window). Idempotent `clientId` retries are excluded. `trust proxy` is enabled so keys use the real client IP behind a proxy. |
| Auth endpoints | 100 requests per 15 minutes per IP |

---

## Background jobs

| Job | Interval | Behaviour |
| --- | --- | --- |
| Stale-claim sweeper | `STALE_SWEEP_MINUTES` (15) | Force-releases needs claimed/in_progress with no update for more than `STALE_CLAIM_HOURS` (4). Each release is a conditional update, so runs are idempotent and a freshly claimed need is never clobbered. Writes an audit row with `action: "force_released"`. |
| Merge reconciler | `STALE_SWEEP_MINUTES` (15) | Safety net for the create-time merge race: folds any open primary created in the last 2 h that still has an older open primary in range, using the same rules as creation (claims preserved, depth 1, no cycles). Idempotent — a second pass merges nothing. |
| Gap scanner | `GAP_SCAN_MINUTES` (5) | Recomputes 0.01° cells of pending needs older than `GAP_THRESHOLD_MINUTES` (30) and emits `gap:alert` to the government room **only when a cell's count changes** — including when claims/resolutions reduce a cell (even to zero). The dedupe state is an in-memory Map per process, so a restart re-announces currently-qualifying cells once. |

---

## Socket.IO

Connect with the JWT in the handshake — rooms are derived **only** from the verified
database role and capabilities, never from client input:

```js
const socket = io("http://localhost:4000", { auth: { token } });
```

| Role | Rooms |
| --- | --- |
| any authenticated user | `user:<id>` |
| ngo | `ngo`, plus `cap:<capability>` for each capability |
| government | `government` |

A missing or invalid/expired token rejects the handshake (`connect_error: unauthorized`), a
suspended user can never connect, and an already-connected socket is disconnected the moment
its user is suspended. Client-emitted `join` events are ignored — client sockets never get
rooms beyond `user:<id>`.

**Server → client events**

| Event | Payload | Emitted to |
| --- | --- | --- |
| `connected` | `{ userId, role, rooms }` | the connecting socket |
| `report:new` | report | government + `cap:<type>` for each need |
| `report:claimed` | report | reporter + government + `cap:<needType>` |
| `report:status_updated` | report (may include `mergedFrom`) | government + capabilities (+ primary reporter when a merge occurred) |
| `report:released` | report | government + capabilities (+ reporter) |
| `gap:alert` | `{ cellKey, lat, lng, count, needTypes, threshold, thresholdMinutes, at }` | government |

Claim/status/release events are always emitted **after** the `claimaudits` row is written,
so clients never observe an event for a write that failed.

---

## Report object

```json
{
  "id": "68f0…",
  "reportedBy": "68e0…" | null,
  "location": { "type": "Point", "coordinates": [80.27, 13.08] },
  "lat": 13.08,
  "lng": 80.27,
  "accuracyMeters": 12,
  "needs": [
    { "type": "medical", "status": "claimed", "claimedBy": "68d0…",
      "claimedAt": "…", "resolvedAt": null, "updatedAt": "…" }
  ],
  "mergedInto": "68f1…" | null,
  "reporterCount": 3,
  "flags": ["low_accuracy"],
  "createdAt": "…",
  "mergedFrom": "68f2…"
}
```

Per-need status lifecycle: `pending → claimed → in_progress → resolved`, forward only.
