# Docker Volume Solution for Permissions

## Why Docker Volumes Are Better

1. **Automatic Permission Management**: Docker handles permissions based on first container that uses it
2. **No Host Filesystem Issues**: Independent of host OS permissions
3. **Portable**: Works the same on any Docker host
4. **Easier Backup**: Docker manages volume lifecycle

## Current vs Proposed Architecture

### Current (Bind Mounts)
```yaml
volumes:
  - ../files/sessions:/app/sessions  # Host filesystem, permission issues
  - ../files/claude-config:/home/node/.claude
```

### Proposed (Named Volumes)
```yaml
volumes:
  - claude-sessions:/app/sessions  # Docker-managed volume
  - claude-config:/home/node/.claude
  - claude-auth:/claude-auth

volumes:
  claude-sessions:
    driver: local
  claude-config:
    driver: local
  claude-auth:
    driver: local
```

## Implementation for Dokploy

### Option 1: Pure Docker Volumes
```yaml
version: '3.8'

services:
  webhook:
    image: ghcr.io/${GITHUB_REPOSITORY:-eugeneistrach/claude-hub}:latest
    ports:
      - "3002"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - claude-sessions:/app/sessions
      - claude-config:/home/node/.claude
      - claude-auth:/claude-auth
      # AWS credentials still need host mount for security
      - ../files/aws-credentials:/root/.aws:ro
    environment:
      # ... env vars ...
    networks:
      - dokploy-network
    labels:
      - "dokploy.enabled=true"

volumes:
  claude-sessions:
    driver: local
  claude-config:
    driver: local
  claude-auth:
    driver: local

networks:
  dokploy-network:
    external: true
```

### Option 2: Hybrid Approach (Recommended for Dokploy)
Keep Dokploy's file structure but use volumes internally:

```yaml
version: '3.8'

services:
  # Permission fixer service that runs once
  init-volumes:
    image: busybox
    user: root
    command: |
      sh -c "
      # Create directories with correct permissions
      mkdir -p /volumes/sessions /volumes/config /volumes/auth
      chown -R 1001:1001 /volumes/sessions /volumes/config
      chmod -R 755 /volumes/sessions /volumes/config
      echo 'Volumes initialized with correct permissions'
      "
    volumes:
      - claude-sessions:/volumes/sessions
      - claude-config:/volumes/config
      - claude-auth:/volumes/auth

  webhook:
    image: ghcr.io/${GITHUB_REPOSITORY:-eugeneistrach/claude-hub}:latest
    depends_on:
      init-volumes:
        condition: service_completed_successfully
    ports:
      - "3002"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - claude-sessions:/app/sessions
      - claude-config:/home/node/.claude
      - claude-auth:/claude-auth
      # AWS credentials from Dokploy's files directory
      - ../files/aws-credentials:/root/.aws:ro
    environment:
      HOST_SESSIONS_DIR: /app/sessions  # For nested container
    networks:
      - dokploy-network
    labels:
      - "dokploy.enabled=true"

volumes:
  claude-sessions:
  claude-config:
  claude-auth:

networks:
  dokploy-network:
    external: true
```

## Benefits of This Approach

1. **No Permission Issues**: Volumes are initialized with correct permissions
2. **Container-Managed**: Docker handles the volume lifecycle
3. **Persistent**: Data survives container restarts
4. **Clean**: No host filesystem pollution

## Migration Strategy

### Step 1: Update docker-compose.dokploy.yml
Replace bind mounts with named volumes.

### Step 2: Handle AWS Credentials
AWS credentials should stay as bind mount from Dokploy's files directory for security (easy rotation).

### Step 3: Initialize Authentication
For Claude auth, either:
- Pre-populate the volume using init container
- Let the container initialize on first run

### Step 4: Data Migration (if needed)
```bash
# Copy existing data to volumes
docker run --rm \
  -v /etc/dokploy/compose/claude-hub-hglfmx/files/sessions:/source:ro \
  -v claude-sessions:/target \
  busybox cp -r /source/. /target/
```

## Dokploy Considerations

1. **Volume Naming**: Dokploy might prefix volume names with project name
2. **Backup**: Check if Dokploy backs up named volumes
3. **UI Access**: Volumes won't be visible in Dokploy's files UI

## Recommended Approach

Use **Option 2 (Hybrid)** because:
- Works with Dokploy's architecture
- Solves permission issues permanently
- AWS credentials stay in Dokploy's managed files
- Init container ensures correct permissions

## Implementation Steps

1. Update `docker-compose.dokploy.yml` with volume definitions
2. Add init-volumes service to set permissions
3. Push changes to trigger Dokploy redeploy
4. Volumes will be created with correct permissions automatically