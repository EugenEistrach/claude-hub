#!/bin/bash

# Setup script for Claude authentication on Dokploy
# This script helps prepare authentication files before deployment

set -e

echo "Claude Hub - Dokploy Authentication Setup"
echo "========================================"
echo

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if running with required tools
command -v docker >/dev/null 2>&1 || { echo -e "${RED}Docker is required but not installed.${NC}" >&2; exit 1; }

# Create local directories for auth files
echo -e "${YELLOW}Creating local directories for authentication files...${NC}"
mkdir -p claude-auth-local
mkdir -p aws-credentials-local
mkdir -p claude-config-local

# Function to setup API key authentication
setup_api_key() {
    echo -e "${GREEN}Using API Key authentication${NC}"
    echo "Please ensure you set ANTHROPIC_API_KEY in Dokploy environment variables."
    echo "No additional authentication files needed."
    exit 0
}

# Function to setup subscription authentication
setup_subscription() {
    echo -e "${GREEN}Setting up Claude subscription authentication...${NC}"
    
    # Build claudecode image locally
    echo -e "${YELLOW}Building claudecode image locally...${NC}"
    docker build -f Dockerfile.claudecode -t claudecode:auth-setup .
    
    # Run authentication
    echo -e "${YELLOW}Starting Claude authentication process...${NC}"
    echo "This will open a browser window for authentication."
    echo
    
    docker run -it --rm \
        -v $(pwd)/claude-config-local:/root/.claude \
        claudecode:auth-setup \
        claude --dangerously-skip-permissions
    
    # Check if authentication was successful
    if [ -f "claude-config-local/config.json" ]; then
        echo -e "${GREEN}Authentication successful!${NC}"
        echo
        echo "Authentication files saved to ./claude-config-local/"
        echo
        echo -e "${YELLOW}Next steps:${NC}"
        echo "1. Deploy to Dokploy using the web interface"
        echo "2. After deployment, upload auth files:"
        echo "   scp -r ./claude-config-local/* root@your-server:/var/lib/dokploy/projects/your-project-id/files/claude-config/"
        echo
    else
        echo -e "${RED}Authentication failed or was cancelled.${NC}"
        exit 1
    fi
}

# Function to setup AWS credentials
setup_aws() {
    echo -e "${YELLOW}Setting up AWS credentials...${NC}"
    
    if [ -d "$HOME/.aws" ]; then
        echo "Found AWS credentials in $HOME/.aws"
        read -p "Copy AWS credentials for deployment? (y/n): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            cp -r $HOME/.aws/* ./aws-credentials-local/
            echo -e "${GREEN}AWS credentials copied to ./aws-credentials-local/${NC}"
        fi
    else
        echo "No AWS credentials found in $HOME/.aws"
        echo "If you need AWS authentication, manually copy credentials to ./aws-credentials-local/"
    fi
}

# Main menu
echo "Select authentication method:"
echo "1) Anthropic API Key (recommended)"
echo "2) Claude Subscription"
echo "3) Exit"
echo
read -p "Enter your choice (1-3): " choice

case $choice in
    1)
        setup_api_key
        ;;
    2)
        setup_subscription
        setup_aws
        ;;
    3)
        echo "Exiting..."
        exit 0
        ;;
    *)
        echo -e "${RED}Invalid choice${NC}"
        exit 1
        ;;
esac

# Create deployment preparation script
cat > prepare-dokploy-files.sh << 'EOF'
#!/bin/bash
# Run this on your Dokploy server after deployment

PROJECT_ID=$1
if [ -z "$PROJECT_ID" ]; then
    echo "Usage: $0 <dokploy-project-id>"
    exit 1
fi

PROJECT_DIR="/var/lib/dokploy/projects/$PROJECT_ID/files"

# Create directories
mkdir -p "$PROJECT_DIR/claude-auth"
mkdir -p "$PROJECT_DIR/aws-credentials"
mkdir -p "$PROJECT_DIR/claude-config"

echo "Directories created at $PROJECT_DIR"
echo "Now upload your authentication files to these directories"
EOF

chmod +x prepare-dokploy-files.sh

echo
echo -e "${GREEN}Setup complete!${NC}"
echo
echo "Created files:"
echo "- prepare-dokploy-files.sh (run on Dokploy server)"
echo "- Local auth directories with your credentials"
echo
echo -e "${YELLOW}Remember to:${NC}"
echo "1. Set environment variables in Dokploy UI"
echo "2. Upload auth files after deployment"
echo "3. Configure GitHub webhooks"