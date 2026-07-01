# Deployment Guide — CrossCurrent Racing Platform

**Status:** MVP → Full Website  
**Strategy:** Netlify now, self-hosted VPS later  
**Domain:** CrossCurrentRacing.com (future)

---

## ⚡ Quick start — get the team on it (current, ~8 min)

The app runs on a local JSON store in dev (`.data/store.json`, one machine, not
shared). Production needs Postgres. Fastest path:

1. **Postgres (Neon, free):** <https://neon.tech> → New Project → copy the
   **pooled** connection string (`…-pooler…?sslmode=require`). Serverless
   functions open many short connections, so the *pooled* endpoint matters.
   *(Or use Netlify's "Add database" button, which provisions Neon and sets
   `DATABASE_URL` automatically — then skip to step 3.)*

2. **Apply the schema — no psql needed:**
   ```powershell
   $env:DATABASE_URL = "postgres://…pooler…?sslmode=require"
   npm run migrate
   ```
   This runs `db/1_init_schema.sql` (idempotent) and creates every table,
   including the newer **`settings`** (active weighting preset) and **`races`**
   (briefing calendar) tables. Re-runnable any time.

3. **Netlify:** Add new site → Import from Git → `Slat3ruk/ccr-platform`. Build
   settings auto-detect from `netlify.toml` (do **not** set a publish directory —
   `@netlify/plugin-nextjs` handles it). Under **Site settings → Environment**,
   add `DATABASE_URL` (required). `GOOGLE_SHEETS_*` are optional (only for live
   benchmark re-sync; the seeded tiers work without them). Deploy.

4. **Seed reference data (once):** open the site and click **"Load sample data"**
   on the rankings banner, or `POST /api/seed`. Loads the car roster, tracks and
   145 benchmark tiers, then computes rankings. Drivers can now log from anywhere.

**Verify:** `GET /api/seed` should report `"backend": "postgres"` (not `json`).
The first real Postgres run is the one thing not yet smoke-tested end-to-end
(dev uses the JSON store) — this checklist *is* that smoke test.

The phased detail (Netlify env vars, Docker staging, self-hosted VPS, CI) follows.

---

## Phase 1: MVP Deploy (Netlify) — 5 minutes

Netlify is the gold standard for Next.js apps. Free tier, auto-deploys from GitHub, zero ops overhead.

### 1.1 Prerequisites

- GitHub account (done ✅)
- Netlify account (free at netlify.com)
- `git push` working (done ✅)

### 1.2 Connect GitHub to Netlify

1. Go to **netlify.com** → Sign up (free)
2. Click **"New site from Git"**
3. Select **GitHub** → authorize Netlify
4. Find repo: **`Slat3ruk/ccr-platform`**
5. Deploy settings (auto-detected from `netlify.toml`):
   - **Build command:** `npm run build`
   - **Publish directory:** *leave blank* — `@netlify/plugin-nextjs` sets the
     output target itself. (Older guides said `.next`; don't override it.)
   - **Environment variables:** Add `DATABASE_URL` (+ optional `GOOGLE_SHEETS_*`,
     see section 1.3). Run `npm run migrate` once against the DB first (Quick start).
6. Click **Deploy**

Done. Your app is live at `https://ccr-platform.netlify.app/` (or custom subdomain).

### 1.3 Environment Variables (Netlify)

In Netlify dashboard, go to **Site settings** → **Environment**:

```
DATABASE_URL=<your-postgres-url>
GOOGLE_SHEETS_API_KEY=<your-api-key>
GOOGLE_SHEETS_ID=1vTN03UvJDm99byA6vQPZHKOCYVvfxLu1zkJAzdaKyROykzEKY2-Xl1rl1q5znZEf36m88dxMKsY2eaO
NEXT_PUBLIC_API_URL=https://ccr-platform.netlify.app
NODE_ENV=production
```

**Database:** Use Netlify Postgres (easy) or external (AWS RDS, DigitalOcean Managed DB).

### 1.4 Auto-Deploy on Push

Once connected, every `git push` to `master` automatically triggers a build + deploy.

```bash
# Edit code locally
git commit -m "Add feature"
git push origin master

# Netlify auto-builds & deploys in ~2 minutes
# Check status: netlify.com dashboard
```

### 1.5 Custom Subdomain (Optional)

Later, when you own `CrossCurrentRacing.com`:

1. Buy domain (Namecheap, GoDaddy, etc.)
2. In Netlify: **Site settings** → **Domain management** → **Add custom domain**
3. Point to: `ccr-platform.netlify.app` (CNAME)
4. Or use Netlify DNS for full control

This way, before you migrate hosting, the app is already at `data.crosscurrentracing.com` (or similar).

---

## Phase 2: Staging Deploy (Docker Compose) — Mid-stage

When you have beta testers or other projects to coordinate, use Docker Compose for a local/staging environment.

### 2.1 Docker Setup

Create `Dockerfile` in repo root:

```dockerfile
FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install

# Copy source
COPY . .

# Build Next.js
RUN npm run build

# Expose port
EXPOSE 3000

# Start app
CMD ["npm", "start"]
```

### 2.2 Docker Compose (with PostgreSQL + app)

Create `docker-compose.yml`:

```yaml
version: '3.8'

services:
  db:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: ccr_platform
      POSTGRES_USER: ccr_admin
      POSTGRES_PASSWORD: ${DB_PASSWORD:-changeme}
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./db/1_init_schema.sql:/docker-entrypoint-initdb.d/01_schema.sql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ccr_admin"]
      interval: 10s
      timeout: 5s
      retries: 5

  app:
    build: .
    environment:
      DATABASE_URL: postgres://ccr_admin:${DB_PASSWORD:-changeme}@db:5432/ccr_platform
      GOOGLE_SHEETS_API_KEY: ${GOOGLE_SHEETS_API_KEY}
      GOOGLE_SHEETS_ID: 1vTN03UvJDm99byA6vQPZHKOCYVvfxLu1zkJAzdaKyROykzEKY2-Xl1rl1q5znZEf36m88dxMKsY2eaO
      NEXT_PUBLIC_API_URL: http://localhost:3000
      NODE_ENV: production
    ports:
      - "3000:3000"
    depends_on:
      db:
        condition: service_healthy
    restart: unless-stopped

volumes:
  postgres_data:
```

### 2.3 Run Locally

```bash
# Copy environment template
cp .env.example .env.local

# Start containers
docker-compose up -d

# Watch logs
docker-compose logs -f app

# App available at http://localhost:3000
# Database at localhost:5432

# Stop
docker-compose down
```

### 2.4 Deploy to Staging VPS

When you're ready for beta testers to access a shared environment:

```bash
# On your staging server (DigitalOcean, Linode, etc.)
# Clone repo
git clone https://github.com/Slat3ruk/ccr-platform.git
cd ccr-platform

# Create .env.local with prod values
echo "DATABASE_URL=postgres://..." > .env.local
echo "GOOGLE_SHEETS_API_KEY=..." >> .env.local

# Start containers
docker-compose up -d

# App is live on http://<staging-server-ip>:3000
# Or use a reverse proxy (nginx) to bind to a domain
```

---

## Phase 3: Production Deploy (Self-Hosted) — When Ready

When you buy `CrossCurrentRacing.com` and want to host multiple projects, move to a self-hosted VPS.

### 3.1 VPS Setup (DigitalOcean / Linode / AWS)

1. **Spin up a Linux server** (Ubuntu 22.04, $5–20/month)
2. **Install Docker + Docker Compose**
3. **Clone the repo**
4. **Add reverse proxy (nginx) for routing:**

```nginx
# /etc/nginx/sites-available/default

upstream app {
  server localhost:3000;
}

server {
  listen 80;
  server_name crosscurrentracing.com www.crosscurrentracing.com;

  # Redirect to HTTPS
  return 301 https://$server_name$request_uri;
}

server {
  listen 443 ssl http2;
  server_name crosscurrentracing.com www.crosscurrentracing.com;

  ssl_certificate /etc/letsencrypt/live/crosscurrentracing.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/crosscurrentracing.com/privkey.pem;

  location / {
    proxy_pass http://app;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

5. **SSL certificate (Let's Encrypt, free):**

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot certonly --nginx -d crosscurrentracing.com -d www.crosscurrentracing.com
```

6. **Deploy with Docker Compose:**

```bash
docker-compose up -d
```

### 3.2 Multi-Project Routing

When you add more projects (strategy tool, docs, etc.), use nginx to route by path:

```nginx
upstream ccr_data {
  server localhost:3000;  # data platform
}

upstream ccr_strategy {
  server localhost:3001;  # strategy tool (runs on different port)
}

upstream ccr_docs {
  server localhost:3002;  # documentation
}

server {
  listen 443 ssl http2;
  server_name crosscurrentracing.com;

  # Data platform at /data
  location /data {
    proxy_pass http://ccr_data/;
  }

  # Strategy tool at /strategy
  location /strategy {
    proxy_pass http://ccr_strategy/;
  }

  # Docs at /docs
  location /docs {
    proxy_pass http://ccr_docs/;
  }

  # Homepage at /
  location / {
    # Could be a landing page, or redirect to /data
    proxy_pass http://ccr_data/;
  }
}
```

Each app runs in its own Docker container, nginx routes traffic.

### 3.3 Monitoring & Backups

```bash
# Backup database daily
docker-compose exec db pg_dump -U ccr_admin ccr_platform > backup_$(date +%Y%m%d).sql

# Monitor logs
docker-compose logs -f app

# Restart if needed
docker-compose restart app
```

---

## CI/CD: Auto-Deploy on Push (GitHub Actions)

Add `.github/workflows/deploy.yml` to auto-test & deploy:

```yaml
name: Deploy to Production

on:
  push:
    branches: [master]

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '20'

      - name: Install dependencies
        run: npm install

      - name: Run tests (when available)
        run: npm run test --if-present

      - name: Build
        run: npm run build

      - name: Deploy to Netlify (Phase 1)
        uses: nwtgck/actions-netlify@v2
        with:
          publish-dir: './.next'
          production-branch: master
          github-token: ${{ secrets.GITHUB_TOKEN }}
          deploy-message: "Deploy from GitHub Actions"
          enable-commit-comment: true
        env:
          NETLIFY_AUTH_TOKEN: ${{ secrets.NETLIFY_AUTH_TOKEN }}
          NETLIFY_SITE_ID: ${{ secrets.NETLIFY_SITE_ID }}

      - name: Deploy to VPS (Phase 3; add later)
        if: github.ref == 'refs/heads/master'
        run: |
          echo "Trigger deployment to VPS"
          # SSH into VPS, git pull, docker-compose restart
```

To set up:

1. Create Netlify auth token: `netlify.com` → **User settings** → **Applications** → **Authorize**
2. In GitHub repo: **Settings** → **Secrets and variables** → **Actions** → Add:
   - `NETLIFY_AUTH_TOKEN`
   - `NETLIFY_SITE_ID`
3. Push to master → GitHub Actions auto-builds & deploys

---

## Quick Reference

| Phase | Where | How | Cost | Setup Time |
|-------|-------|-----|------|------------|
| **1 (MVP)** | Netlify | Auto-deploy from GitHub | Free (paid tiers available) | 5 min |
| **2 (Staging)** | Local Docker or staging VPS | `docker-compose up` | $0–10/mo | 30 min |
| **3 (Prod)** | Self-hosted VPS + nginx | Docker + DNS | $10–50/mo | 1–2 hours |

---

## Troubleshooting

**Build fails on Netlify:**
- Check `netlify.log` in Netlify dashboard
- Ensure `npm run build` works locally: `npm run build`
- Verify environment variables are set

**Database connection errors:**
- Check `DATABASE_URL` is valid
- Test connection: `psql $DATABASE_URL -c "SELECT 1"`
- Netlify can't connect to local DB; use Netlify Postgres or external RDS

**Docker container exits:**
- Check logs: `docker-compose logs app`
- Ensure database is healthy: `docker-compose logs db`

---

## Next Steps

1. ✅ **Phase 1 MVP:** Deploy to Netlify (5 min)
2. ✅ **Add GitHub Actions** (optional, nice-to-have)
3. **Build & test the app** (weeks 1–4)
4. **Staging:** Docker Compose when beta testers come online
5. **Production:** Buy domain, move to VPS when live

