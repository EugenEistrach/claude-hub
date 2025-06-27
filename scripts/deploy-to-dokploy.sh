#!/bin/bash

# Dokploy Deployment Script for Claude Hub
# This script automates the deployment of Claude Hub to Dokploy

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
DOKPLOY_URL="${DOKPLOY_URL:-https://perfux.dev}"
DOKPLOY_API_KEY="${DOKPLOY_API_KEY}"
GITHUB_REPO="eugeneistrach/claude-hub"
DOMAIN="claude.perfux.dev"

echo -e "${BLUE}Claude Hub - Dokploy Deployment Script${NC}"
echo "====================================="
echo

# Check for API key
if [ -z "$DOKPLOY_API_KEY" ]; then
    echo -e "${RED}Error: DOKPLOY_API_KEY environment variable not set${NC}"
    echo "Please set your Dokploy API key:"
    echo "  export DOKPLOY_API_KEY=your-api-key"
    echo
    echo "You can find your API key in Dokploy:"
    echo "  Settings → API Keys → Create New Key"
    exit 1
fi

# Function to make API calls
api_call() {
    local method=$1
    local endpoint=$2
    local data=$3
    
    if [ -z "$data" ]; then
        curl -s -X "$method" \
            "${DOKPLOY_URL}/api/${endpoint}" \
            -H "x-api-key: ${DOKPLOY_API_KEY}" \
            -H "Content-Type: application/json"
    else
        curl -s -X "$method" \
            "${DOKPLOY_URL}/api/${endpoint}" \
            -H "x-api-key: ${DOKPLOY_API_KEY}" \
            -H "Content-Type: application/json" \
            -d "$data"
    fi
}

# Step 1: Create Project
echo -e "${YELLOW}Creating project...${NC}"
PROJECT_RESPONSE=$(api_call POST "project.create" '{
    "name": "claude-hub",
    "description": "Claude GitHub Webhook Service"
}')

PROJECT_ID=$(echo "$PROJECT_RESPONSE" | grep -o '"projectId":"[^"]*' | cut -d'"' -f4)

if [ -z "$PROJECT_ID" ]; then
    echo -e "${RED}Failed to create project${NC}"
    echo "Response: $PROJECT_RESPONSE"
    exit 1
fi

echo -e "${GREEN}✓ Project created with ID: $PROJECT_ID${NC}"

# Step 2: Create Docker Compose Service
echo -e "${YELLOW}Creating Docker Compose service...${NC}"
COMPOSE_RESPONSE=$(api_call POST "compose.create" "{
    \"name\": \"claude-webhook\",
    \"projectId\": \"$PROJECT_ID\",
    \"appName\": \"claude-hub\"
}")

COMPOSE_ID=$(echo "$COMPOSE_RESPONSE" | grep -o '"composeId":"[^"]*' | cut -d'"' -f4)

if [ -z "$COMPOSE_ID" ]; then
    echo -e "${RED}Failed to create compose service${NC}"
    echo "Response: $COMPOSE_RESPONSE"
    exit 1
fi

echo -e "${GREEN}✓ Compose service created with ID: $COMPOSE_ID${NC}"

# Step 3: Configure the service
echo -e "${YELLOW}Configuring service...${NC}"

# Prepare environment variables
read -r -d '' ENV_VARS << 'EOF' || true
# Core Configuration
NODE_ENV=production
PORT=3002
TRUST_PROXY=true
WEBHOOK_URL=https://claude.perfux.dev

# Authentication - IMPORTANT: Update these values!
ANTHROPIC_API_KEY=your-anthropic-api-key
GITHUB_TOKEN=ghp_your_github_token
GITHUB_WEBHOOK_SECRET=generate-strong-secret-here
CLAUDE_API_SECRET=generate-strong-secret-here

# Bot Configuration
BOT_USERNAME=@ClaudeBot
BOT_EMAIL=claude@example.com
AUTHORIZED_USERS=github-user1,github-user2
DEFAULT_GITHUB_OWNER=your-org
DEFAULT_AUTHORIZED_USER=your-github-username

# Claude Container
CLAUDE_USE_CONTAINERS=1
CLAUDE_CONTAINER_IMAGE=claudecode:latest
CLAUDE_AUTH_HOST_DIR=/claude-auth
BASH_DEFAULT_TIMEOUT_MS=600000
BASH_MAX_TIMEOUT_MS=1200000

# GitHub Repository for images
GITHUB_REPOSITORY=eugeneistrach/claude-hub

# PR Review Configuration
PR_REVIEW_WAIT_FOR_ALL_CHECKS=true
PR_REVIEW_DEBOUNCE_MS=5000
PR_REVIEW_MAX_WAIT_MS=1800000
PR_REVIEW_CONDITIONAL_TIMEOUT_MS=300000
EOF

# Escape the environment variables for JSON
ENV_VARS_ESCAPED=$(echo "$ENV_VARS" | sed 's/"/\\"/g' | sed ':a;N;$!ba;s/\n/\\n/g')

# Update compose configuration
UPDATE_RESPONSE=$(api_call POST "compose.update" "{
    \"composeId\": \"$COMPOSE_ID\",
    \"sourceType\": \"github\",
    \"owner\": \"eugeneistrach\",
    \"repository\": \"claude-hub\",
    \"branch\": \"main\",
    \"autoDeploy\": true,
    \"composeFile\": \"./docker-compose.dokploy.yml\",
    \"env\": \"$ENV_VARS_ESCAPED\",
    \"domains\": [{
        \"host\": \"$DOMAIN\",
        \"https\": true,
        \"certificateType\": \"letsencrypt\"
    }]
}")

echo -e "${GREEN}✓ Service configured${NC}"

# Step 4: Deploy
echo -e "${YELLOW}Deploying service...${NC}"
DEPLOY_RESPONSE=$(api_call POST "compose.deploy" "{
    \"composeId\": \"$COMPOSE_ID\"
}")

echo -e "${GREEN}✓ Deployment initiated${NC}"

# Summary
echo
echo -e "${BLUE}Deployment Summary${NC}"
echo "=================="
echo -e "Project ID: ${GREEN}$PROJECT_ID${NC}"
echo -e "Compose ID: ${GREEN}$COMPOSE_ID${NC}"
echo -e "Domain: ${GREEN}https://$DOMAIN${NC}"
echo
echo -e "${YELLOW}Next Steps:${NC}"
echo "1. Update environment variables in Dokploy UI:"
echo "   - Go to Projects → claude-hub → Environment"
echo "   - Set your actual values for:"
echo "     • ANTHROPIC_API_KEY"
echo "     • GITHUB_TOKEN"
echo "     • GITHUB_WEBHOOK_SECRET"
echo "     • AUTHORIZED_USERS"
echo "     • etc."
echo
echo "2. If using Claude subscription auth:"
echo "   - Run: ./scripts/setup-dokploy-auth.sh"
echo "   - Upload auth files to Dokploy server"
echo
echo "3. Configure GitHub webhooks:"
echo "   - URL: https://$DOMAIN/api/webhooks/github"
echo "   - Secret: Use your GITHUB_WEBHOOK_SECRET value"
echo
echo "4. Monitor deployment in Dokploy UI"
echo
echo -e "${GREEN}Deployment script completed!${NC}"