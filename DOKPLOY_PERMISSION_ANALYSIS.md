# Dokploy Permission Analysis & Fix Proposal

## Current Issue
The webhook container runs as `claudeuser (UID 1001)` but all host directories are owned by `root:root` with 755 permissions, causing EACCES errors when trying to write to mounted volumes.

## Container User Structure

### Webhook Container (claude-hub)
- **User**: claudeuser (UID=1001, GID=1001)
- **Groups**: claudeuser, docker (GID=999)
- **Created in Dockerfile**: Line 88-89
- **Runs as**: claudeuser (line 147)

### ClaudeCode Container
- **User**: root (runs as root, line 102)
- **Has node user**: UID=1000 (default from node:24 base image)
- **Execution**: Runs as root but can switch users

## Volume Mount Analysis

| Host Path | Container Path | Mode | Purpose | Current Owner | Required By |
|-----------|---------------|------|---------|---------------|-------------|
| `/var/run/docker.sock` | `/var/run/docker.sock` | rw | Docker access | root:docker (660) | claudeuser (via docker group) |
| `/etc/dokploy/compose/claude-hub-hglfmx/files/aws-credentials` | `/root/.aws` | ro | AWS creds | root:root (755) | claudeuser needs read |
| `/etc/dokploy/compose/claude-hub-hglfmx/files/claude-config` | `/home/node/.claude` | rw | Claude auth | root:root (755) | claudeuser needs write |
| `/etc/dokploy/compose/claude-hub-hglfmx/files/sessions` | `/app/sessions` | rw | Session traces | root:root (755) | claudeuser needs write |

### Nested Container Mount Issue
The webhook container passes `HOST_SESSIONS_DIR=/app/sessions` to the claude container, which then mounts it as `/sessions`. This creates a chain:
- Host: `/etc/dokploy/compose/claude-hub-hglfmx/files/sessions`
- Webhook container: `/app/sessions` 
- Claude container: `/sessions`

Both containers need write access to this directory.

## Root Cause
Dokploy creates all directories as `root:root` with 755 permissions, but our container runs as `claudeuser (1001)`, which cannot write to these directories.

## Proposed Solution

### Option 1: Init Container Pattern (Recommended)
Add an init container that fixes permissions before the main container starts:

```yaml
services:
  init-permissions:
    image: busybox
    user: root
    command: |
      sh -c "
      chown -R 1001:1001 /files/claude-config /files/sessions
      chmod -R 755 /files/claude-config /files/sessions
      "
    volumes:
      - ../files:/files
    
  webhook:
    depends_on:
      init-permissions:
        condition: service_completed_successfully
    # ... rest of config
```

### Option 2: Startup Script in Container
Modify the startup script to handle permissions:

```bash
# In scripts/runtime/startup.sh
#!/bin/bash

# Fix permissions if running as root (for development)
if [ "$EUID" -eq 0 ]; then
  chown -R claudeuser:claudeuser /app/sessions /home/node/.claude 2>/dev/null || true
fi

# Continue with normal startup...
```

### Option 3: Dokploy Post-Deploy Hook
Create a post-deploy script that Dokploy runs after container creation:

```bash
#!/bin/bash
# post-deploy.sh
COMPOSE_DIR="/etc/dokploy/compose/claude-hub-hglfmx/files"
chown -R 1001:1001 "$COMPOSE_DIR/sessions" "$COMPOSE_DIR/claude-config"
chmod -R 755 "$COMPOSE_DIR/sessions" "$COMPOSE_DIR/claude-config"
```

### Option 4: Run Container as Root (Not Recommended)
Change Dockerfile to not switch to claudeuser, but this reduces security.

## Immediate Workaround
For testing, manually fix permissions on the server:
```bash
ssh hetzner
cd /etc/dokploy/compose/claude-hub-hglfmx/files
chown -R 1001:1001 sessions claude-config
chmod -R 755 sessions claude-config
```

## Long-term Recommendations

1. **Standardize UIDs**: Use consistent UIDs across all containers (e.g., 1001 for all)
2. **Volume Permissions**: Document required permissions in deployment guide
3. **Health Checks**: Add permission checks to container health checks
4. **Automated Testing**: Add tests that verify volume permissions work correctly

## Implementation Priority

1. **Immediate**: Apply manual workaround to unblock deployment
2. **Short-term**: Implement Option 1 (init container) for automatic permission handling
3. **Long-term**: Consider migrating to named volumes with proper permission management

## Security Considerations

- Avoid running containers as root when possible
- Use read-only mounts where write access isn't needed (aws-credentials)
- Consider using Docker secrets for sensitive data instead of volume mounts
- Implement proper file ownership rather than 777 permissions