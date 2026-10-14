# AidPulse Deployment Guide

## Overview
- **Frontend**: Vercel (static + PWA)
- **Backend**: Render (Node.js Web Service)
- **Database**: MongoDB Atlas (M0 Free tier)

---

## 1. MongoDB Atlas Setup

### Create Cluster
1. Go to https://cloud.mongodb.com → **Build a Database** → **M0 Free** (Shared)
2. Cloud Provider: **AWS** (or your preference)
3. Region: Choose closest to your users (e.g., `us-east-1`)
4. Cluster Name: `aidpulse`
5. Wait for deployment (~3 min)

### Database User
1. **Database Access** → **Add New Database User**
2. Authentication: **Password**
3. Username: `aidpulse_app`
4. Password: **Generate secure password** (save it!)
5. Privileges: **Atlas Admin** (or `readWrite` on `aidpulse` database)
6. **Add User**

### Network Access
1. **Network Access** → **Add IP Address**
2. **Allow Access from Anywhere** (`0.0.0.0/0`) — required for Render/Vercel
   - *Note: For production, restrict to Render's outbound IPs*
3. **Confirm**

### Connection String
1. **Clusters** → **Connect** → **Drivers**
2. Driver: **Node.js**, Version: **4.1 or later**
3. Copy connection string:
   ```
   mongodb+srv://aidpulse_app:<password>@aidpulse.xxxxx.mongodb.net/?retryWrites=true&w=majority
   ```
4. Replace `<password>` with your database user password
5. Append database name: `/aidpulse`
   ```
   mongodb+srv://aidpulse_app:YOUR_PASSWORD@aidpulse.xxxxx.mongodb.net/aidpulse?retryWrites=true&w=majority
   ```

---

## 2. Render Backend Deployment

### Create Web Service
1. Go to https://dashboard.render.com → **New** → **Web Service**
2. Connect GitHub repo: `AidPulse` (push your repo first)
3. **Settings**:
   - Name: `aidpulse-api`
   - Region: Same as Atlas (e.g., `Oregon (US West)`)
   - Branch: `main`
   - Runtime: **Node**
   - Build Command: `cd backend && npm ci`
   - Start Command: `cd backend && npm start`
   - Plan: **Free**

### Environment Variables (Render Dashboard → Environment)
| Key | Value |
|-----|-------|
| `NODE_ENV` | `production` |
| `MONGO_URI` | `mongodb+srv://aidpulse_app:YOUR_PASSWORD@aidpulse.xxxxx.mongodb.net/aidpulse?retryWrites=true&w=majority` |
| `JWT_SECRET` | **Generate 64-char random string** (see below) |
| `JWT_EXPIRES_IN` | `1h` |
| `CLIENT_ORIGIN` | `https://aidpulse.vercel.app` (update after Vercel deploy) |
| `PORT` | `10000` (Render sets this automatically) |
| `STALE_CLAIM_HOURS` | `4` |
| `SMS_API_KEY` | *(optional)* |
| `DEPLOYMENT_REGION_BOUNDS` | *(optional, e.g., `6.0,7.0,3.0,4.0` for Lagos)* |
| `GAP_CELL_THRESHOLD` | `3` |
| `GEOCODE_ON_SMS` | `false` |

#### Generate JWT_SECRET
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# Example output: a1b2c3d4e5f6... (64 hex chars)
```

### Health Check
- Render will call `GET /api/health` — already implemented

### Custom Domain (Optional)
- Settings → Custom Domains → Add `api.aidpulse.yourdomain.com`

---

## 3. Vercel Frontend Deployment

### Create Project
1. Go to https://vercel.com/new → Import Git Repository
2. Select `AidPulse` repo
3. **Configure**:
   - Framework Preset: **Vite**
   - Root Directory: `./` (repo root)
   - Build Command: `npm run build`
   - Output Directory: `dist`
   - Install Command: `npm ci`

### Environment Variables (Vercel Dashboard → Settings → Environment Variables)
| Key | Value | Environment |
|-----|-------|-------------|
| `VITE_API_URL` | `https://aidpulse-api.onrender.com/api` | Production, Preview, Development |

### Deploy
- Click **Deploy** — first deploy will give you a `*.vercel.app` URL
- Copy that URL (e.g., `https://aidpulse-xyz.vercel.app`)

### Update Render `CLIENT_ORIGIN`
1. Render Dashboard → `aidpulse-api` → Environment
2. Update `CLIENT_ORIGIN` to your Vercel URL: `https://aidpulse-xyz.vercel.app`
3. **Save Changes** → triggers redeploy

### Custom Domain (Optional)
- Vercel Dashboard → Domains → Add `aidpulse.yourdomain.com`
- Update `CLIENT_ORIGIN` in Render to match

---

## 4. Post-Deploy Verification

### Seed Database (One-time)
```bash
# Local machine with Atlas URI
MONGO_URI="mongodb+srv://..." npm run seed
```
Expected output:
```
[seed] Connected to MongoDB
[seed] Upserted admin@aidpulse.local (admin)
[seed] Upserted ngo1@aidpulse.local (ngo)
[seed] Upserted ngo2@aidpulse.local (ngo)
[seed] Upserted gov@aidpulse.local (government)
[seed] Upserted citizen@aidpulse.local (citizen)
[seed] Inserted 4 sample reports
[seed] Done.
```

### Smoke Test
```bash
# Health
curl https://aidpulse-api.onrender.com/api/health
# {"status":"ok","uptime":123.45}

# Login
curl -X POST https://aidpulse-api.onrender.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"citizen@aidpulse.local","password":"Citizen123!"}'

# Create report (as citizen)
curl -X POST https://aidpulse-api.onrender.com/api/reports \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"needType":"Water","description":"Test deploy report","lat":6.455,"lng":3.3841,"clientId":"deploy-test-1"}'

# Frontend loads
open https://aidpulse-xyz.vercel.app
```

### Run Live Flow Check
```bash
BASE_URL=https://aidpulse-api.onrender.com/api npm run check:flow
# Should show 45 passed, 0 failed
```

---

## 5. Environment Variable Reference

### Backend (.env.example → .env)
```bash
NODE_ENV=production
PORT=10000
MONGO_URI=mongodb+srv://...
JWT_SECRET=64-char-hex-string
JWT_EXPIRES_IN=1h
CLIENT_ORIGIN=https://aidpulse.vercel.app
STALE_CLAIM_HOURS=4
SMS_API_KEY=
DEPLOYMENT_REGION_BOUNDS=
GAP_CELL_THRESHOLD=3
GEOCODE_ON_SMS=false
```

### Frontend (Vercel only)
```bash
VITE_API_URL=https://aidpulse-api.onrender.com/api
```

---

## 6. Free Tier Limits & Mitigations

| Service | Limit | Mitigation |
|---------|-------|------------|
| **MongoDB Atlas M0** | 512 MB storage, shared CPU | Monitor usage; upgrade to M2 ($9/mo) if needed |
| **Render Free** | Spins down after 15 min inactivity; 750 hrs/mo | First request after spin-down takes ~30s; acceptable for demo |
| **Vercel Hobby** | 100 GB bandwidth, 1k serverless invocations | Well within limits for demo |

### Keep Render Warm (Optional)
- Use cron-job.org or uptimerobot.com to ping `/api/health` every 10 min

---

## 7. Troubleshooting

| Issue | Fix |
|-------|-----|
| CORS error | Ensure `CLIENT_ORIGIN` in Render matches Vercel URL exactly (no trailing slash) |
| MongoDB connection timeout | Check Atlas Network Access allows `0.0.0.0/0`; verify password in URI |
| JWT_SECRET error in prod | Must be set and != default; generate new 64-char hex |
| Frontend blank page | Check browser console; verify `VITE_API_URL` points to Render `/api` |
| Socket.IO fails | Render Free supports WebSockets; ensure `transports: ['websocket']` in client |

---

## 8. Mentor Demo Checklist

### One-Line Pitch
> **"AidPulse: Real-time disaster response coordination — citizens report needs, NGOs claim and resolve them atomically, government sees gaps instantly. Built for offline-first resilience."**

### 2-Minute Demo Order
1. **Citizen Report** (30s)
   - Open `/citizen` → select **Water** → describe → GPS pin → Submit
   - Show "Report submitted" toast
2. **NGO Claim** (30s)
   - Open `/ngo` (incognito/different browser) → see new report on map/list
   - Click **Claim** → badge changes to "Claimed ✓"
3. **409 Race** (30s)
   - Open second NGO tab (`ngo2@aidpulse.local`)
   - Click **Claim** on same report → **"Already claimed by another responder"**
   - Show atomic guarantee
4. **Admin Gaps** (30s)
   - Open `/admin` → **Clusters** tab → see duplicate clusters
   - **Coverage gaps** tab → heatmap of underserved areas
   - **Users** tab → suspend/restore demo

### Four Test Results Ready
```
✅ Claim race: two NGOs claim at same instant → exactly one wins, one 409
✅ Offline idempotency: retry with same clientId on reconnect → exactly one report
✅ Role tamper: citizen token with edited localStorage role → server rejects with 403
✅ Realtime: citizen submit → NGO + Gov screens update without refresh (Socket.IO)
```

---

## 9. Repository Push

```bash
cd /path/to/AidPulse
git remote add origin https://github.com/YOUR_USERNAME/AidPulse.git
git push -u origin main
```

Then connect this repo in Render and Vercel.

---

**Last Updated**: 2026-10-14
**Version**: Step 7 Deployment Ready