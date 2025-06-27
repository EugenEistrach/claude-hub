# Dokploy Architecture Analysis & Fix Proposal

## CURRENT STATE

### 1. YOUR LOCAL MAC
- **Location**: Your MacBook
- **User**: Your mac username
- **Claude Auth**: `~/.claude-hub/.credentials.json`
- **This script runs here**: `./scripts/setup/setup-dokploy-credentials.sh`

### 2. REMOTE HETZNER SERVER (via `ssh hetzner`)
- **OS**: Linux
- **SSH User**: `eugeneistrach` (UID 1000)
- **Docker installed**: Yes
- **Dokploy installed**: Yes
- **Directory Structure**:
  ```
  /etc/dokploy/compose/claude-hub-hglfmx/
  ├── code/              (git repo files)
  └── files/            
      ├── aws-credentials/    (owned by root)
      ├── claude-config/      (owned by dockeruser UID 1001)
      └── sessions/           (owned by dockeruser UID 1001)
  ```

### 3. WEBHOOK CONTAINER (`claude-hub-hglfmx-webhook-1`)
- **Runs on**: Hetzner server
- **Image**: `ghcr.io/eugeneistrach/claude-hub:latest`
- **Runs as**: `claudeuser` (UID 1001)
- **Volume Mounts**:
  ```
  /var/run/docker.sock → /var/run/docker.sock
  /etc/dokploy/compose/claude-hub-hglfmx/files/aws-credentials → /root/.aws
  /etc/dokploy/compose/claude-hub-hglfmx/files/claude-config → /home/node/.claude
  /etc/dokploy/compose/claude-hub-hglfmx/files/sessions → /app/sessions
  ```
- **Purpose**: Receives API requests, spawns Claude containers

### 4. CLAUDE CONTAINER (`claude-general-*`)
- **Spawned by**: Webhook container via docker run
- **Image**: `ghcr.io/eugeneistrach/claude-hub-claudecode:latest`
- **Runs as**: `root`
- **Volume Mounts**:
  ```
  /claude-auth → /home/node/.claude (BUT THIS IS WRONG - should be the host path)
  /app/sessions → /sessions (ALSO WRONG - should be host path)
  ```
- **Purpose**: Runs Claude to execute commands

### CURRENT PROBLEMS

1. **Upload Problem**: 
   - Need to get files from Mac → into `/etc/dokploy/compose/claude-hub-hglfmx/files/claude-config/`
   - That dir is owned by UID 1001
   - SSH user is UID 1000
   - Can't write there without sudo

2. **Claude Container Mount Problem**:
   - Webhook container passes wrong paths to Claude container
   - Claude container can't see the credentials

3. **Permission Hell**:
   - Different UIDs everywhere
   - Bind mounts with host filesystem permissions
   - Need sudo for everything

---

## PROPOSED STATE

### 1. YOUR LOCAL MAC (No Change)
- **Location**: Your MacBook
- **User**: Your mac username
- **Claude Auth**: `~/.claude-hub/.credentials.json`
- **This script runs here**: `./scripts/setup/setup-dokploy-credentials.sh`

### 2. REMOTE HETZNER SERVER - NEW STRUCTURE
- **SSH User**: `eugeneistrach` (UID 1000)
- **New Upload Directory**: `/home/eugeneistrach/claude-uploads/`
  - Owned by eugeneistrach
  - Can upload here without sudo
- **Docker Volumes** (instead of bind mounts):
  ```
  claude-sessions     (Docker managed volume)
  claude-config       (Docker managed volume)
  claude-aws          (Docker managed volume)
  ```

### 3. WEBHOOK CONTAINER - UPDATED
- **Runs on**: Hetzner server
- **Image**: `ghcr.io/eugeneistrach/claude-hub:latest`
- **Runs as**: `root` initially, then drops to `claudeuser`
- **Volume Mounts**:
  ```yaml
  volumes:
    - /var/run/docker.sock:/var/run/docker.sock
    - claude-aws:/root/.aws
    - claude-config:/home/node/.claude
    - claude-sessions:/app/sessions
    - /home/eugeneistrach/claude-uploads:/uploads:ro  # Read-only mount for uploads
  ```
- **Startup Process**:
  1. Starts as root
  2. Checks `/uploads` for new credentials
  3. Copies them to `/home/node/.claude` with correct permissions
  4. Fixes docker socket permissions
  5. Drops to claudeuser
  6. Runs the app

### 4. CLAUDE CONTAINER - FIXED
- **Spawned by**: Webhook container
- **Volume Mounts** (using host paths from Dokploy):
  ```
  ${HOST_CLAUDE_CONFIG_PATH}:/home/node/.claude
  ${HOST_SESSIONS_PATH}:/sessions
  ```
- **Environment Variables**:
  ```
  HOST_CLAUDE_CONFIG_PATH=/var/lib/docker/volumes/claude-config/_data
  HOST_SESSIONS_PATH=/var/lib/docker/volumes/claude-sessions/_data
  ```

### 5. DOCKER-COMPOSE.DOKPLOY.YML
```yaml
version: '3.8'

volumes:
  claude-sessions:
  claude-config:
  claude-aws:

services:
  webhook:
    image: ghcr.io/${GITHUB_REPOSITORY:-eugeneistrach/claude-hub}:latest
    ports:
      - "3002"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - claude-aws:/root/.aws
      - claude-config:/home/node/.claude
      - claude-sessions:/app/sessions
      - /home/eugeneistrach/claude-uploads:/uploads:ro
    environment:
      # Pass volume paths for nested container
      HOST_CLAUDE_CONFIG_PATH: /var/lib/docker/volumes/dokploy_claude-config/_data
      HOST_SESSIONS_PATH: /var/lib/docker/volumes/dokploy_claude-sessions/_data
      # ... other env vars
```

### 6. SETUP SCRIPT FLOW
```bash
# 1. Local: Run interactive auth
./scripts/setup/setup-claude-interactive.sh

# 2. Local: Upload to remote upload directory
scp ~/.claude-hub/.credentials.json hetzner:~/claude-uploads/

# 3. Remote: Container picks up on restart
ssh hetzner "docker restart claude-hub-*"
```

### 7. STARTUP.SH CHANGES
```bash
#!/bin/bash
# Running as root initially

# Check for uploaded credentials
if [ -d "/uploads" ] && [ -f "/uploads/.credentials.json" ]; then
    echo "Found uploaded credentials, installing..."
    cp /uploads/.credentials.json /home/node/.claude/
    chown -R claudeuser:claudeuser /home/node/.claude
    # Note: Don't delete from uploads - it's read-only
fi

# Fix docker socket permissions
DOCKER_GID=$(stat -c '%g' /var/run/docker.sock)
groupmod -g $DOCKER_GID docker || groupadd -g $DOCKER_GID docker
usermod -aG docker claudeuser

# Drop to claudeuser
exec su - claudeuser -c "cd /app && node dist/index.js"
```

## BENEFITS OF THIS APPROACH

1. **No Permission Issues**: Docker volumes are managed by Docker
2. **Simple Upload**: Just scp to your home directory
3. **Automatic**: Container picks up credentials on restart
4. **Secure**: Read-only mount, proper privilege dropping
5. **Portable**: Works on any Dokploy instance

## ONE-TIME MANUAL SETUP

On the Hetzner server:
```bash
# Create upload directory
mkdir -p ~/claude-uploads
chmod 700 ~/claude-uploads
```

That's it. Everything else is automatic.

## MIGRATION STEPS

1. Update `docker-compose.dokploy.yml` to use volumes
2. Update `Dockerfile` to remove `USER claudeuser` line
3. Update `startup.sh` with the new logic
4. Update `claudeService.ts` to use correct volume paths
5. Push changes and let Dokploy redeploy
6. Run setup script to upload credentials