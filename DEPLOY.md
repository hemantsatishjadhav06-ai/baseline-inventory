# Deploy Baseline — GitHub + Render

This project builds to a static site (verified: `npm run build` → `dist/`, ~166 kB gzip).
The dashboard runs on seeded data, so it deploys cleanly with no backend or database.

---

## ⚠️ Read first — rotate your tokens

The GitHub token (`ghp_…`) and Render key (`rnd_…`) shared in chat are **compromised** (they're in a transcript). Before deploying, rotate both:

- **GitHub:** Settings → Developer settings → Personal access tokens → revoke the old one → generate a new **fine-grained** token with `Contents: Read/Write` on this repo only.
- **Render:** Account Settings → API Keys → revoke → create new.

Never paste tokens into chat, code, or commits again. Use them only in your terminal or your platform's secret store.

---

## Option A — Deploy via Render Blueprint (recommended, no API key needed)

This uses the included `render.yaml` and Render's GitHub integration. No Render API key required.

### 1. Push to GitHub

```bash
cd baseline-app
git init
git add .
git commit -m "Baseline: inventory intelligence dashboard"

# create the repo (pick one):
#  • GitHub UI: New repository → copy its URL, or
#  • gh CLI:    gh repo create baseline-inventory --private --source=. --push

git branch -M main
git remote add origin https://github.com/<your-username>/baseline-inventory.git
git push -u origin main
```

> When git prompts for a password, paste your **rotated** PAT (not your account password).
> To avoid storing it: `git config credential.helper cache`.

### 2. Deploy on Render

1. Render Dashboard → **New** → **Blueprint**.
2. Connect your GitHub account, pick `baseline-inventory`.
3. Render reads `render.yaml`, detects `baseline-dashboard` (static site), and deploys.
4. You get a live URL like `https://baseline-dashboard.onrender.com`.

PR previews are enabled in the blueprint, so every pull request gets its own preview URL.

---

## Option B — Deploy via Render API (uses your rotated key)

If you prefer scripting it. Put the **rotated** key in your shell — never in a file:

```bash
export RENDER_API_KEY="<your-rotated-render-key>"   # paste in terminal only
export OWNER_ID="<your-render-owner-id>"            # GET /v1/owners

# After the repo is on GitHub, create a static site:
curl -X POST https://api.render.com/v1/services \
  -H "Authorization: Bearer $RENDER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "static_site",
    "name": "baseline-dashboard",
    "ownerId": "'"$OWNER_ID"'",
    "repo": "https://github.com/<your-username>/baseline-inventory",
    "branch": "main",
    "buildCommand": "npm install && npm run build",
    "publishPath": "dist",
    "autoDeploy": "yes"
  }'
```

Render pulls the repo, builds, and returns the service URL.

---

## Test after deploy

1. Open the Render URL — the **Overview** tab should load with charts.
2. Click **Stockout Radar** → rows ranked by days-of-cover, red/amber risk badges.
3. Click **Add** on a row → toast confirms, the **Reorder / Auto-PO** badge count increments.
4. **Reorder / Auto-PO** → supplier PO cards; click **Approve & Send** → card turns green.
5. **Dead Stock** → trapped-cash totals + markdown candidates.

Lighthouse check (optional): `npx lighthouse <url> --view`.

---

## Going live with real Magento data (phase 2)

The static site shows seeded data. To wire in `console.tennisoutlet.in`:

1. Uncomment the `baseline-api` service + `baseline-db` in `render.yaml`.
2. In Render, set `MAGENTO_ACCESS_TOKEN` as a **secret env var** (the rotated token) — not in the file.
3. Add a small `integration/server.js` that runs the sync worker + exposes `/api/v1/*` (the client and engine in `integration/` are ready; see `../Baseline_Engineering_Documentation.md` §7).
4. Replace the in-file `RAW` dataset in `src/BaselineDashboard.jsx` with `fetch('/api/v1/...')` calls.

---

## Local preview

```bash
npm install
npm run dev        # http://localhost:5173
npm run build && npm run preview   # production build
```
