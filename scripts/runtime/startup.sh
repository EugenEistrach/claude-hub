#!/bin/bash

echo "Starting Claude GitHub webhook service (running as root initially)..."

# Check for uploaded credentials and copy them
if [ -d "/uploads" ] && [ -f "/uploads/.credentials.json" ]; then
    echo "Found uploaded credentials, installing..."
    mkdir -p /home/node/.claude
    cp /uploads/.credentials.json /home/node/.claude/
    [ -f "/uploads/.claude.json" ] && cp /uploads/.claude.json /home/node/.claude/
    chown -R claudeuser:claudeuser /home/node/.claude
    chmod 600 /home/node/.claude/.credentials.json 2>/dev/null || true
    echo "Credentials installed successfully"
fi

# Fix permissions for volumes
echo "Fixing volume permissions..."
chown -R claudeuser:claudeuser /app/sessions /home/node/.claude 2>/dev/null || true
mkdir -p /app/sessions && chown claudeuser:claudeuser /app/sessions

# Fix docker socket access by updating docker group GID
DOCKER_GID=$(stat -c '%g' /var/run/docker.sock 2>/dev/null || echo "")
if [ -n "$DOCKER_GID" ]; then
    echo "Fixing docker group GID to match host ($DOCKER_GID)..."
    # Try to modify existing docker group or create new one
    groupmod -g $DOCKER_GID docker 2>/dev/null || \
    groupadd -g $DOCKER_GID docker 2>/dev/null || true
    usermod -aG docker claudeuser 2>/dev/null || true
fi

# Build the Claude Code runner image if we have access to Dockerfile.claudecode
if [ -f "Dockerfile.claudecode" ]; then
    echo "Building Claude Code runner image..."
    if docker build -f Dockerfile.claudecode -t claude-code-runner:latest .; then
        echo "Claude Code runner image built successfully."
    else
        echo "Warning: Failed to build Claude Code runner image. Service will attempt to build on first use."
    fi
else
    echo "Dockerfile.claudecode not found, skipping Claude Code runner image build."
fi

# In production, dist directory is already built in the Docker image
if [ ! -d "dist" ]; then
    echo "Error: dist directory not found. Please rebuild the Docker image."
    exit 1
fi

# Drop privileges and start the webhook service as claudeuser
echo "Dropping privileges and starting webhook service as claudeuser..."
exec su - claudeuser -c "cd /app && node dist/index.js"