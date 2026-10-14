# AidPulse Backend

Express + Mongoose + Socket.IO backend for AidPulse.

- **Auth**: JWT with bcrypt-hashed passwords. Citizens sign in by phone; NGOs and government sign in by email.
- **Realtime**: Socket.IO with a token handshake and rooms derived only from the verified database role.
- **Geo**: MongoDB `2dsphere` index for `$geoNear` merge detection.
- **Integrity**: claims are a single conditional `updateOne` (`$elemMatch`), never read-then-write. Audit rows are written *before* socket events. `claimaudits` is append-only (model hooks reject update/delete).

## Quick start

```bash
cd backend
npm install
cp .env.example .env      # then edit values (at minimum JWT_SECRET)
npm run mongo:dev         # in-memory MongoDB for local development
npm run reset:dev         # clean slate: drop collections + rebuild indexes
npm run dev               # http://localhost:4000
```

On first start the government account is created from `GOV_EMAIL` / `GOV_PASSWORD`
**only if no government user exists**. It is never overwritten and the password is
never logged. The account has `mustChangePassword=true`.

## Scripts

| Script | Description |
| --- | --- |
| `npm run dev` | Start with nodemon |
| `npm start` | Start the server |
| `npm run mongo:dev` | Boot an ephemeral local MongoDB |
| `npm run reset:dev` | Drop collections and rebuild indexes (refuses production) |
| `npm run bootstrap:gov` | Manually create the government account (env or CLI args) |
| `npm run seed` | **Manual** demo data — refuses `NODE_ENV=production` |
| `npm test` / `npm run check:flow` | Full end-to-end suite (spawns Mongo + API) |
| `npm run check:flow -- --core` | Service/DB-level tests only (no HTTP) |
| `npm run check:flow -- --atlas` | Full suite against a throwaway Atlas database (needs `ATLAS_TEST_URI`) |

The test suite is the only automatic way data is created; nothing in the server
bootstrap inserts sample users or reports.

### Running against MongoDB Atlas

Point `ATLAS_TEST_URI` at a cluster URI **without** a database name, then pass `--atlas`:

```bash
ATLAS_TEST_URI="mongodb+srv://user:pass@cluster.mongodb.net/?retryWrites=true" \
  npm run check:flow -- --atlas
```

The script appends its own `aidpulse_test_<timestamp>` database name and **drops that database
in a `finally` block**, even when a check fails. As a guard rail it refuses to connect to,
reset or drop any database whose name does not start with `aidpulse_test_`, and it uses
generous (60 s) timeouts. The default `npm test` run stays fully offline on an in-memory
MongoDB.

## Environment

See `.env.example` for the full annotated list.

| Variable | Required | Purpose |
| --- | --- | --- |
| `MONGO_URI` | yes | MongoDB connection string |
| `JWT_SECRET` | yes | JWT signing secret (strong value required in production) |
| `JWT_EXPIRES_IN` | no | Token lifetime (default `1h`) |
| `CLIENT_ORIGIN` | yes | CORS + Socket.IO origin |
| `GOV_EMAIL`, `GOV_PASSWORD` | yes (prod) | One-time government bootstrap credentials |
| `IDENTITY_MODE` | no | `basic` (default) or `digilocker` |
| `PORT` | no | HTTP port (default `4000`) |
| `BCRYPT_ROUNDS` | no | Cost factor (default `12`) |
| `STALE_CLAIM_HOURS` | no | Claims idle longer than this are force-released (default `4`) |
| `STALE_SWEEP_MINUTES` | no | Sweeper interval (default `15`) |
| `GAP_THRESHOLD_MINUTES` | no | Pending-age floor for gap cells (default `30`) |
| `GAP_CELL_THRESHOLD` | no | Pending needs per 0.01° cell before an alert (default `3`) |
| `GAP_SCAN_MINUTES` | no | Gap scanner interval (default `5`) |

DigiLocker credentials are **only** required when `IDENTITY_MODE=digilocker`;
in `basic` mode they are never demanded and the identity routes return `501`
without breaking anything else.

## Documentation

- **[API.md](./API.md)** — full endpoint reference, error codes, and Socket.IO contract.

## Data model

- `users` — `name`, `phone` (unique-sparse), `email` (unique-sparse), `passwordHash`,
  `role` (`citizen` | `ngo` | `government`), `capabilities[]`, `organizationName`,
  `identityVerified`, `verifiedName`, `identityRefHash`, `consentAt`,
  `mustChangePassword`, `isSuspended`. No Aadhaar number is ever stored.
- `reports` — `reportedBy`, `clientId`, `location` (GeoJSON Point, `2dsphere`),
  `accuracyMeters`, `needs[]` (per-need `status`/`claimedBy`/`claimedAt`/`resolvedAt`/`updatedAt`),
  `mergedInto`, `reporterCount`, `flags[]`, `createdAt`.
- `claimaudits` — append-only: `reportId`, `needType`, `actorId`, `action`, `timestamp`.

Indexes: `location` `2dsphere`; unique `{reportedBy, clientId}` (partial);
`{mergedInto, createdAt}`; unique-sparse `phone` and `email`.
