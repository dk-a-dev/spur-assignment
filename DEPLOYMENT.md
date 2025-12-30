# Deploying Spur Chat Application to Render

## Prerequisites
- Your Postgres and Redis are already set up on Render ✅
- Get a Gemini API key from [Google AI Studio](https://makersuite.google.com/app/apikey)

## Deployment Strategy: **Native Node.js (NOT Docker)**
Render works best with native Node.js deployments - simpler, faster, and more cost-effective.

---

## Option 1: Automatic Deployment (Recommended - Using render.yaml)

### Step 1: Push to GitHub
```bash
git add .
git commit -m "Ready for Render deployment"
git push origin main
```

### Step 2: Deploy on Render
1. Go to [Render Dashboard](https://dashboard.render.com/)
2. Click **"New +"** → **"Blueprint"**
3. Connect your GitHub repository
4. Render will automatically detect `render.yaml` and create 3 services:
   - **spur-chat-api** (Web Service - Backend API)
   - **spur-chat-worker** (Background Worker - BullMQ)
   - **spur-chat-frontend** (Static Site - Svelte Frontend)

### Step 3: Add Sensitive Environment Variables
After services are created, manually add in Render Dashboard:

For **spur-chat-api** and **spur-chat-worker**:
- `GEMINI_API_KEY`: Your Gemini API key

For **spur-chat-frontend**:
- `VITE_API_URL`: Update with your actual API URL (e.g., `https://spur-chat-api.onrender.com`)

---

## Option 2: Manual Deployment

### Backend API Service

1. **Create Web Service**
   - Name: `spur-chat-api`
   - Runtime: Node
   - Region: Virginia (same as your DB)
   - Root Directory: `backend`
   - Build Command: `npm install && npm run build`
   - Start Command: `npm run start`

2. **Environment Variables**
   ```
   NODE_ENV=production
   PORT=8080
   DATABASE_URL=postgresql://spur_assignment_db_user:8wzD23Ls3SbGGDugNO5S4SvBpTgF13C3@dpg-d5a266re5dus73es1hkg-a.virginia-postgres.render.com/spur_assignment_db
   REDIS_URL=rediss://red-d5a26n63jp1c73ccm6o0:bKRltqqRiavqHrLdVJaEF7GwHl69pOuI@virginia-keyvalue.render.com:6379
   GEMINI_API_KEY=your_actual_gemini_api_key
   GEMINI_MODEL=gemini-2.0-flash-exp
   RATE_LIMIT_VISITOR_PER_MINUTE=10
   RATE_LIMIT_IP_PER_MINUTE=60
   CACHE_TTL_SECONDS=900
   MAX_ACTIVE_CONVERSATIONS=3
   ACTIVE_CONVERSATION_TTL_MINUTES=1440
   ```

### Background Worker Service

1. **Create Background Worker**
   - Name: `spur-chat-worker`
   - Runtime: Node
   - Region: Virginia
   - Root Directory: `backend`
   - Build Command: `npm install && npm run build`
   - Start Command: `npm run start:worker`

2. **Environment Variables** (same as API + worker-specific ones)

### Frontend Static Site

1. **Create Static Site**
   - Name: `spur-chat-frontend`
   - Root Directory: `frontend`
   - Build Command: `npm install && npm run build`
   - Publish Directory: `dist`

2. **Environment Variables**
   ```
   VITE_API_URL=https://spur-chat-api.onrender.com
   ```
   (Replace with your actual API URL)

---

## Prisma Database Setup

After deploying the backend, you need to run migrations:

### Method 1: Using Render Shell (Recommended)
1. Go to your backend service in Render
2. Click **"Shell"** tab
3. Run:
   ```bash
   npm run prisma:migrate:deploy
   npm run prisma:seed  # Optional: seed initial FAQ data
   ```

### Method 2: Using Render Deploy Hook
Add a custom deploy command in render.yaml or manually:
```bash
npm install && npm run build && npm run prisma:migrate:deploy
```

---

## Important Notes

### 1. Build Command Changes
✅ Updated `package.json` with:
- `build`: Now includes `npx prisma generate && tsc`
- `prisma:migrate:deploy`: For production migrations
- `start:worker`: For background worker process

### 2. Database Migrations
Your migrations are already in `prisma/migrations/`. On first deploy:
```bash
npm run prisma:migrate:deploy
```

### 3. Why NOT Docker?
- Render's native Node.js is simpler and faster
- Better integration with Render features (auto-scaling, logs, etc.)
- Lower cold start times
- Easier debugging

### 4. Health Checks
Your app runs on port 8080. Render will automatically:
- Check HTTP 200 responses
- Handle auto-restart if app crashes

### 5. Free Tier Limitations
- Services spin down after 15 minutes of inactivity
- First request after spin-down takes ~30 seconds
- Upgrade to paid tier ($7/month) for always-on services

---

## Post-Deployment Checklist

- [ ] Backend API is running and accessible
- [ ] Worker service is processing jobs
- [ ] Frontend is deployed and connected to API
- [ ] Database migrations are applied
- [ ] CORS is configured correctly (check backend/src/app.ts)
- [ ] Test chat functionality
- [ ] Check logs for any errors

---

## Useful Render Commands

```bash
# View logs
render logs -s spur-chat-api

# Restart service
render restart -s spur-chat-api

# Run shell in service
render shell -s spur-chat-api
```

---

## Troubleshooting

### Build Fails
- Check Node.js version (should be 18 or 20)
- Verify all dependencies are in `package.json`
- Check build logs in Render dashboard

### Database Connection Issues
- Verify DATABASE_URL is correct
- Ensure SSL is enabled (your URL has `sslmode=require`)
- Check if Prisma client is generated: `npx prisma generate`

### Redis Connection Issues
- Use `rediss://` (with double 's') for secure connections
- Verify Redis URL format and credentials

### CORS Issues
- Update CORS origins in backend/src/app.ts
- Add your frontend URL to allowed origins

---

## Need Help?
- Render Docs: https://render.com/docs
- Prisma Docs: https://www.prisma.io/docs
- Your architecture: See backend/ARCHITECTURE.md
