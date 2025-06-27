# Dokploy Quick Start Guide

## 5-Minute Setup via Dokploy UI

### Prerequisites
- Dokploy server running (perfux.dev)
- GitHub account with your fork of claude-hub
- Anthropic API key or Claude subscription

### Step 1: Create Project in Dokploy

1. Login to Dokploy at https://perfux.dev
2. Click **"New Project"**
3. Select **"Docker Compose"**
4. Fill in:
   - **Name**: `claude-hub`
   - **Description**: `Claude GitHub Webhook Service`

### Step 2: Configure Git Repository

1. In project settings, set:
   - **Source Type**: GitHub
   - **Repository**: `eugeneistrach/claude-hub`
   - **Branch**: `main`
   - **Compose Path**: `docker-compose.dokploy.yml`
   - **Auto Deploy**: ✅ Enable

### Step 3: Set Environment Variables

1. Go to **Environment** tab
2. Copy contents from `.env.dokploy.example`
3. Update these required values:
   ```
   ANTHROPIC_API_KEY=your-actual-api-key
   GITHUB_TOKEN=your-github-token
   GITHUB_WEBHOOK_SECRET=generate-strong-secret
   AUTHORIZED_USERS=your-github-username
   DEFAULT_AUTHORIZED_USER=your-github-username
   ```

### Step 4: Configure Domain

1. Go to **Domains** tab
2. Add domain:
   - **Host**: `claude.perfux.dev`
   - **HTTPS**: ✅ Enable
   - **Certificate**: Let's Encrypt

### Step 5: Deploy

1. Click **"Deploy"** button
2. Monitor logs for any issues
3. Wait for "Deployment successful" message

### Step 6: Setup GitHub Webhook

1. Go to your GitHub repo → Settings → Webhooks
2. Add webhook:
   - **URL**: `https://claude.perfux.dev/api/webhooks/github`
   - **Secret**: (use your GITHUB_WEBHOOK_SECRET value)
   - **Events**: Issues, Issue comments, Pull requests, Check suites

### Step 7: Test

Create an issue in your repo and comment:
```
@ClaudeBot help me understand this codebase
```

## Troubleshooting

### If deployment fails:
1. Check logs in Dokploy UI
2. Verify environment variables are set correctly
3. Ensure domain DNS points to your server

### If webhook doesn't work:
1. Check webhook delivery in GitHub settings
2. Verify GITHUB_WEBHOOK_SECRET matches
3. Check container logs for errors

### If Claude authentication fails:
1. Verify ANTHROPIC_API_KEY is correct
2. For subscription auth, see full deployment guide

## Need Help?

- Full guide: `/docs/DOKPLOY_DEPLOYMENT.md`
- Auth setup: `./scripts/setup-dokploy-auth.sh`
- Support: Create issue in GitHub repo