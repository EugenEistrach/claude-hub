# Claude Hub Deployment Guide for Coolify on Hetzner

## Prerequisites
- Hetzner server with Coolify installed
- GitHub repository (forked or original)
- GitHub token with webhook permissions
- Discord bot tokens (if using Discord integration)
- Anthropic API key OR Claude subscription authentication
- Domain pointed to your Hetzner server

## Architecture Overview
```
Internet → Hetzner Server → Coolify (Traefik) → Docker Containers
         ↓                                    ↓
    GitHub/Discord Webhooks            Claude Hub + Claude Code
```

## 1. Prepare the Server

### SSH into your Hetzner server:
```bash
ssh root@your-server-ip
```

### Create directories for persistent data:
```bash
mkdir -p /data/claude-hub/.claude-hub
mkdir -p /data/claude-hub/.aws
```

### Build Claude Code container on server:
```bash
# Clone repo temporarily to build the container
cd /tmp
git clone https://github.com/your-username/claude-hub.git
cd claude-hub
docker build -f Dockerfile.claudecode -t claudecode:latest .
cd /
rm -rf /tmp/claude-hub
```

## 2. Setup in Coolify

### Create New Project:
1. In Coolify dashboard, click "New Project"
2. Choose "Docker Compose" (to use existing docker-compose.yml)
3. Connect your GitHub repository
4. Set branch to `main`

### Configure Build Settings:
- **Build Pack**: Docker Compose
- **Base Directory**: `/` (root of repo)
- **Docker Compose Location**: `docker-compose.yml`

## 3. Environment Variables

In Coolify's environment variables section, add:

```bash
# Core Configuration
NODE_ENV=production
PORT=3002
TRUST_PROXY=true
WEBHOOK_URL={{COOLIFY_URL}}  # Coolify will replace with actual URL

# Authentication
ANTHROPIC_API_KEY=your-anthropic-api-key
GITHUB_TOKEN=ghp_your_github_token
GITHUB_WEBHOOK_SECRET=generate-strong-secret-here
CLAUDE_API_SECRET=generate-strong-secret-here

# Bot Configuration
BOT_USERNAME=@ClaudeBot
BOT_EMAIL=claude@yourdomain.com
AUTHORIZED_USERS=github-user1,github-user2
DEFAULT_GITHUB_OWNER=your-org

# Claude Container
CLAUDE_USE_CONTAINERS=1
CLAUDE_CONTAINER_IMAGE=claudecode:latest
CLAUDE_AUTH_HOST_DIR=/data/claude-hub/.claude-hub
BASH_DEFAULT_TIMEOUT_MS=600000
BASH_MAX_TIMEOUT_MS=1200000

# Discord Integration (if using)
DISCORD_APPLICATION_ID=your-app-id
DISCORD_BOT_TOKEN=your-bot-token
DISCORD_PUBLIC_KEY=your-public-key
DISCORD_CHANNEL_ID=your-channel-id
DISCORD_AUTHORIZED_USERS=discord-id1,discord-id2

# Vercel (optional)
VERCEL_TOKEN=your-vercel-token
```

## 4. Persistent Storage

In Coolify's Storage section, add these volume mappings:

| Host Path | Container Path | Description |
|-----------|----------------|-------------|
| `/var/run/docker.sock` | `/var/run/docker.sock` | Docker socket access |
| `/data/claude-hub/.aws` | `/root/.aws:ro` | AWS credentials (if using) |
| `/data/claude-hub/.claude-hub` | `/home/node/.claude` | Claude authentication |

## 5. Domain Configuration

In Coolify's Domains section:
1. Set primary domain: `claude.yourdomain.com`
2. Coolify automatically handles SSL with Let's Encrypt
3. For multiple endpoints, you can add:
   - `claude.yourdomain.com` → Main webhook
   - `discord-claude.yourdomain.com` → Discord endpoint (optional)

## 6. Health Check

Configure health check in Coolify:
- **Health Check Path**: `/health`
- **Health Check Port**: `3002`
- **Health Check Interval**: `30s`

## 7. Deploy

1. Click "Deploy" in Coolify
2. Monitor the deployment logs
3. Once deployed, check health: `https://claude.yourdomain.com/health`

## 8. Post-Deployment Setup

### Setup Claude Authentication (if not using API key):
```bash
# SSH into server
ssh root@your-server-ip

# Run interactive setup in container
docker exec -it <container-id> /bin/bash
claude --dangerously-skip-permissions
# Complete authentication flow
exit

# Copy auth to persistent location
docker cp <container-id>:/home/node/.claude/. /data/claude-hub/.claude-hub/
```

### Configure GitHub Webhooks:
1. Go to your GitHub repo → Settings → Webhooks
2. Add webhook:
   - **URL**: `https://claude.yourdomain.com/api/webhooks/github`
   - **Secret**: Use value from `GITHUB_WEBHOOK_SECRET`
   - **Events**: Issues, Issue comments, Pull requests, Check suites

### Configure Discord (if using):
1. Set Interactions Endpoint URL in Discord Developer Portal:
   - `https://claude.yourdomain.com/api/webhooks/discord`
2. Register commands:
   ```bash
   docker exec -it <container-id> npm run discord:register
   ```

## 9. Monitoring & Maintenance

### View logs in Coolify:
- Application logs are available in Coolify's UI
- Real-time logs during deployment

### Manual container access:
```bash
# List containers
docker ps

# View logs
docker logs -f <container-name>

# Execute commands
docker exec -it <container-name> /bin/bash
```

### Update deployment:
1. Push changes to GitHub
2. Coolify auto-deploys (if configured)
3. Or manually trigger deploy in Coolify UI

## 10. Troubleshooting

### Common issues:

**Container can't access Docker socket:**
- Ensure Docker socket is mounted correctly
- Check permissions on server

**Claude authentication issues:**
- Verify ANTHROPIC_API_KEY is set
- Or check persistent volume for auth files

**Webhook not receiving events:**
- Check webhook URL in GitHub/Discord
- Verify TRUST_PROXY=true is set
- Check Coolify's Traefik logs

**Health check failing:**
- Verify PORT=3002 in environment
- Check if claudecode:latest image exists
- Review application logs

## Security Best Practices

1. **Secrets Management**:
   - Use Coolify's environment variables (encrypted)
   - Never commit secrets to Git

2. **Network Security**:
   - Coolify's Traefik handles SSL/TLS
   - No need to expose ports directly

3. **Container Security**:
   - Run containers as non-root when possible
   - Limit container resources in Coolify

4. **Regular Updates**:
   - Keep Coolify updated
   - Update base images regularly
   - Monitor security advisories

## Advantages of Coolify Deployment

- **Automatic SSL**: Let's Encrypt certificates managed automatically
- **Built-in Reverse Proxy**: Traefik handles routing
- **Easy Rollbacks**: One-click rollback to previous versions
- **Resource Monitoring**: Built-in metrics and logs
- **Auto-deployment**: Push to Git → Auto deploy
- **Environment Management**: Secure variable storage
- **No Cloudflare Tunnels Needed**: Direct HTTPS with real certificates