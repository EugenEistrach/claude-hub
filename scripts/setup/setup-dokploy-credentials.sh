#!/bin/bash
set -e

# Dokploy Credentials Setup Script
# This script sets up Claude authentication and uploads it to Dokploy

echo "🔐 Dokploy Credentials Setup"
echo "==========================="
echo ""

# Check if we have SSH access configured
if ! ssh -o ConnectTimeout=5 hetzner "echo 'SSH connection successful'" >/dev/null 2>&1; then
    echo "❌ Cannot connect to Hetzner server via SSH"
    echo "Please ensure 'ssh hetzner' is configured in your ~/.ssh/config"
    exit 1
fi

# Determine auth directory
AUTH_DIR="${CLAUDE_HUB_DIR:-$HOME/.claude-hub}"
UPLOAD_DIR="/home/eugeneistrach/claude-uploads"

echo "📍 Local auth directory: $AUTH_DIR"
echo "📍 Remote upload directory: $UPLOAD_DIR"
echo ""

# Option 1: Use existing Claude authentication
if [ -f "$AUTH_DIR/.credentials.json" ]; then
    echo "✅ Found existing Claude authentication"
    echo ""
    echo "Uploading to server..."
    
    # Upload to the user's upload directory
    echo "📤 Uploading files..."
    scp "$AUTH_DIR/.credentials.json" "hetzner:$UPLOAD_DIR/"
    if [ -f "$AUTH_DIR/.claude.json" ]; then
        scp "$AUTH_DIR/.claude.json" "hetzner:$UPLOAD_DIR/"
    fi
    
    echo "✅ Claude authentication uploaded successfully"
    echo ""
    echo "📋 The container will pick up credentials on next restart"
    
# Option 2: Run interactive setup
else
    echo "❌ No Claude authentication found"
    echo ""
    echo "You need to run the interactive setup first:"
    echo "  ./scripts/setup/setup-claude-interactive.sh"
    echo ""
    echo "After authentication, run this script again to upload to Dokploy"
    exit 1
fi

echo ""
echo "🎉 Dokploy credentials setup complete!"
echo ""
echo "Next steps:"
echo "1. Wait for Dokploy to redeploy (or manually restart container)"
echo "2. Test the API endpoint"
echo ""
echo "To manually restart:"
echo "  ssh hetzner 'docker restart claude-hub-hglfmx-webhook-1'"
echo ""
echo "To test:"
echo "  curl -X POST https://claude.perfux.dev/api/claude/execute \\"
echo "    -H 'Authorization: Bearer test-secret-key-12345' \\"
echo "    -H 'Content-Type: application/json' \\"
echo "    -d '{\"command\": \"echo Hello from Claude\"}'"