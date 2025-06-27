# Claude Hub Deployment Guide for Dokploy on Hetzner

## Prerequisites
- Hetzner server with Dokploy installed
- GitHub repository (forked or original) 
- GitHub token with webhook permissions
- Discord bot tokens (if using Discord integration)
- Anthropic API key OR Claude subscription authentication
- Domain pointed to your Hetzner server

## Architecture Overview
```
Internet → Hetzner Server → Dokploy (Traefik) → Docker Containers
         ↓                                    ↓
    GitHub/Discord Webhooks            Claude Hub + Claude Code
```

## Quick Start

### 1. Prepare Your Repository

Create a Dokploy-specific Docker Compose file in your repository:

```bash
# In your local repository
cat > docker-compose.dokploy.yml << 'EOF'
version: '3.8'

services:
  webhook:
    build:
      context: .
      dockerfile: Dockerfile
    environment:
      # Core Configuration
      NODE_ENV: production
      PORT: 3002
      TRUST_PROXY: "true"
      WEBHOOK_URL: ${WEBHOOK_URL}
      
      # Authentication
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}
      GITHUB_TOKEN: ${GITHUB_TOKEN}
      GITHUB_WEBHOOK_SECRET: ${GITHUB_WEBHOOK_SECRET}
      CLAUDE_API_SECRET: ${CLAUDE_API_SECRET}
      
      # Bot Configuration
      BOT_USERNAME: ${BOT_USERNAME}
      BOT_EMAIL: ${BOT_EMAIL}
      AUTHORIZED_USERS: ${AUTHORIZED_USERS}
      DEFAULT_GITHUB_OWNER: ${DEFAULT_GITHUB_OWNER}
      
      # Claude Container
      CLAUDE_USE_CONTAINERS: "1"
      CLAUDE_CONTAINER_IMAGE: "claudecode:latest"
      CLAUDE_AUTH_HOST_DIR: "/claude-auth"
      BASH_DEFAULT_TIMEOUT_MS: "600000"
      BASH_MAX_TIMEOUT_MS: "1200000"
      
      # Discord Integration (optional)
      DISCORD_APPLICATION_ID: ${DISCORD_APPLICATION_ID}
      DISCORD_BOT_TOKEN: ${DISCORD_BOT_TOKEN}
      DISCORD_PUBLIC_KEY: ${DISCORD_PUBLIC_KEY}
      DISCORD_CHANNEL_ID: ${DISCORD_CHANNEL_ID}
      DISCORD_AUTHORIZED_USERS: ${DISCORD_AUTHORIZED_USERS}
      
      # Vercel (optional)
      VERCEL_TOKEN: ${VERCEL_TOKEN}
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - ../files/claude-auth:/claude-auth
      - ../files/aws-credentials:/root/.aws:ro
      - ../files/claude-config:/home/node/.claude
    ports:
      - "3002:3002"
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost:3002/health"]
      interval: 30s
      timeout: 10s
      retries: 3
    depends_on:
      - claudecode
    networks:
      - claude-network

  claudecode:
    build:
      context: .
      dockerfile: Dockerfile.claudecode
      args:
        BUILDKIT_INLINE_CACHE: 1
    volumes:
      - ../files/claude-auth:/claude-auth:ro
      - ../files/aws-credentials:/root/.aws:ro
      - ../files/claude-config:/root/.claude
    environment:
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}
    command: ["sleep", "infinity"]
    networks:
      - claude-network

networks:
  claude-network:
    driver: bridge
EOF

# Commit the file
git add docker-compose.dokploy.yml
git commit -m "Add Dokploy deployment configuration"
git push
```

### 2. Pre-Setup Claude Authentication (One-time)

Since Dokploy doesn't support interactive container sessions, authenticate Claude locally first:

```bash
# Option A: Using Anthropic API Key (Simplest)
# Just set ANTHROPIC_API_KEY in Dokploy environment variables

# Option B: Using Claude Subscription
# Build and run Claude container locally
docker build -f Dockerfile.claudecode -t claudecode:local .

# Create auth directory
mkdir -p claude-auth

# Run authentication
docker run -it --rm \
  -v $(pwd)/claude-auth:/root/.claude \
  claudecode:local \
  claude --dangerously-skip-permissions

# Follow the authentication flow in your browser
# After authentication, the credentials will be saved in ./claude-auth
```

### 3. Deploy to Dokploy

1. **Create New Project in Dokploy:**
   - Navigate to your Dokploy dashboard
   - Click "Create New Project"
   - Select "Docker Compose"

2. **Configure Git Repository:**
   - Repository URL: `https://github.com/your-username/claude-hub.git`
   - Branch: `main`
   - Build Path: `/`
   - Compose Path: `docker-compose.dokploy.yml`

3. **Set Environment Variables in Dokploy UI:**
   ```bash
   # Core Configuration
   WEBHOOK_URL=https://claude.yourdomain.com
   
   # Authentication (choose one)
   ANTHROPIC_API_KEY=sk-ant-your-key-here
   
   # GitHub Configuration
   GITHUB_TOKEN=ghp_your_github_token
   GITHUB_WEBHOOK_SECRET=generate-strong-secret-here
   CLAUDE_API_SECRET=generate-strong-secret-here
   
   # Bot Configuration
   BOT_USERNAME=@ClaudeBot
   BOT_EMAIL=claude@yourdomain.com
   AUTHORIZED_USERS=github-user1,github-user2
   DEFAULT_GITHUB_OWNER=your-org
   
   # Discord Integration (optional)
   DISCORD_APPLICATION_ID=your-app-id
   DISCORD_BOT_TOKEN=your-bot-token
   DISCORD_PUBLIC_KEY=your-public-key
   DISCORD_CHANNEL_ID=your-channel-id
   DISCORD_AUTHORIZED_USERS=discord-id1,discord-id2
   
   # Vercel (optional)
   VERCEL_TOKEN=your-vercel-token
   ```

4. **Configure Domain:**
   - In Dokploy project settings, add domain: `claude.yourdomain.com`
   - Dokploy will automatically handle SSL with Let's Encrypt

5. **Enable Auto-Deploy:**
   - In project settings, enable "Auto Deploy on Push"
   - Copy the webhook URL provided by Dokploy
   - Add this webhook to your GitHub repository

### 4. Upload Authentication Files (if using subscription auth)

After deployment, upload your authentication files:

```bash
# SSH into your Dokploy server
ssh root@your-server-ip

# Navigate to your project files directory
cd /var/lib/dokploy/projects/your-project-id/files

# Create directories if they don't exist
mkdir -p claude-auth aws-credentials claude-config

# Upload your local auth files
# From your local machine:
scp -r ./claude-auth/* root@your-server-ip:/var/lib/dokploy/projects/your-project-id/files/claude-auth/
```

### 5. Configure GitHub Webhooks

1. Go to your GitHub repository → Settings → Webhooks
2. Add webhook:
   - **Payload URL**: `https://claude.yourdomain.com/api/webhooks/github`
   - **Content type**: `application/json`
   - **Secret**: Use value from `GITHUB_WEBHOOK_SECRET`
   - **Events**: Select:
     - Issues
     - Issue comments
     - Pull requests
     - Pull request reviews
     - Pull request review comments
     - Check suites

### 6. Configure Discord (Optional)

If using Discord integration:

1. Set Interactions Endpoint URL in Discord Developer Portal:
   - `https://claude.yourdomain.com/api/webhooks/discord`

2. After deployment, register commands:
   ```bash
   # Get container ID from Dokploy UI or via SSH
   docker exec -it <container-id> npm run discord:register
   ```

## Automated CI/CD Pipeline

### GitHub Actions for Image Building

Create `.github/workflows/build-and-push.yml`:

```yaml
name: Build and Push Docker Images

on:
  push:
    branches: [ main ]
    paths:
      - 'Dockerfile'
      - 'Dockerfile.claudecode'
      - 'src/**'
      - 'package*.json'

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}

jobs:
  build-and-push:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write

    steps:
    - name: Checkout repository
      uses: actions/checkout@v4

    - name: Log in to Container Registry
      uses: docker/login-action@v3
      with:
        registry: ${{ env.REGISTRY }}
        username: ${{ github.actor }}
        password: ${{ secrets.GITHUB_TOKEN }}

    - name: Extract metadata
      id: meta
      uses: docker/metadata-action@v5
      with:
        images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
        tags: |
          type=ref,event=branch
          type=ref,event=pr
          type=sha,prefix={{branch}}-
          type=raw,value=latest,enable={{is_default_branch}}

    - name: Build and push webhook image
      uses: docker/build-push-action@v5
      with:
        context: .
        file: ./Dockerfile
        push: true
        tags: ${{ steps.meta.outputs.tags }}
        labels: ${{ steps.meta.outputs.labels }}
        cache-from: type=gha
        cache-to: type=gha,mode=max

    - name: Build and push claudecode image
      uses: docker/build-push-action@v5
      with:
        context: .
        file: ./Dockerfile.claudecode
        push: true
        tags: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}-claudecode:latest
        cache-from: type=gha
        cache-to: type=gha,mode=max
```

Then update your `docker-compose.dokploy.yml` to use the pre-built images:

```yaml
services:
  webhook:
    image: ghcr.io/your-username/claude-hub:latest
    # ... rest of configuration

  claudecode:
    image: ghcr.io/your-username/claude-hub-claudecode:latest
    # ... rest of configuration
```

## Monitoring & Maintenance

### View Logs
- Access logs directly in Dokploy UI
- Real-time log streaming available
- Filter by service (webhook or claudecode)

### Update Deployment
1. Push changes to GitHub
2. Dokploy automatically deploys (if auto-deploy enabled)
3. Or manually trigger deployment in Dokploy UI

### Health Monitoring
- Dokploy shows service health status
- Access metrics at: `https://claude.yourdomain.com/health`
- Set up external monitoring (e.g., UptimeRobot) for alerts

## Troubleshooting

### Common Issues

**Docker socket access issues:**
```bash
# Check permissions
docker exec <container-id> ls -la /var/run/docker.sock

# If needed, adjust permissions on host
sudo chmod 666 /var/run/docker.sock
```

**Claude authentication failures:**
- Verify ANTHROPIC_API_KEY is set correctly
- Check volume mappings for auth files
- Ensure files exist in `/var/lib/dokploy/projects/your-project-id/files/`

**Webhook not receiving events:**
- Verify webhook secret matches in GitHub and environment
- Check Dokploy logs for incoming requests
- Ensure domain is correctly configured with SSL

**Container build failures:**
- Check Dokploy build logs
- Ensure all Dockerfiles are in correct locations
- Verify build context paths

## Security Best Practices

1. **Use Docker Volumes**: Store sensitive data in Dokploy's `../files` directory
2. **Environment Variables**: Use Dokploy's encrypted environment variable storage
3. **Regular Updates**: Enable auto-deploy to get security updates automatically
4. **Access Control**: Limit AUTHORIZED_USERS to necessary GitHub accounts
5. **SSL/TLS**: Always use HTTPS (Dokploy handles this automatically)

## Advantages of Dokploy

- **Simplified Deployment**: Git push → Auto deploy
- **Built-in SSL**: Automatic Let's Encrypt certificates
- **Easy Rollbacks**: One-click rollback to previous versions
- **Resource Efficient**: Lower overhead than Kubernetes
- **Persistent Storage**: Simple volume management with `../files`
- **Native Docker Compose**: Use familiar Docker Compose syntax
- **GitHub Integration**: Automatic webhook configuration

## Migration from Coolify

If migrating from Coolify:

1. Export environment variables
2. Copy persistent data to new server
3. Update domain DNS records
4. Deploy using this guide
5. Update GitHub webhook URLs
6. Test all integrations

## Support

For issues specific to:
- **Claude Hub**: Create issue at https://github.com/your-username/claude-hub/issues
- **Dokploy**: Check https://docs.dokploy.com or their Discord
- **Claude Authentication**: See https://docs.anthropic.com/en/docs/claude-code