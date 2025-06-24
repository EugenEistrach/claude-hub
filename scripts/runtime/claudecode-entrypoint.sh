#!/bin/bash
set -e

# Unified entrypoint for Claude Code operations
# Handles both auto-tagging (minimal tools) and general operations (full tools)
# Operation type is controlled by OPERATION_TYPE environment variable

# Initialize firewall - must be done as root
# Temporarily disabled to test Claude Code
# /usr/local/bin/init-firewall.sh

# Environment variables (passed from service)
# Simply reference the variables directly - no need to reassign
# They are already available in the environment

# Ensure workspace directory exists and has proper permissions
mkdir -p /workspace
chown -R node:node /workspace

# Set up Claude authentication by syncing from captured auth directory
if [ -d "/home/node/.claude" ]; then
  echo "Setting up Claude authentication from mounted auth directory..." >&2
  
  # Create a writable copy of Claude configuration in workspace
  CLAUDE_WORK_DIR="/workspace/.claude"
  mkdir -p "$CLAUDE_WORK_DIR"
  
  echo "DEBUG: Source auth directory contents:" >&2
  ls -la /home/node/.claude/ >&2 || echo "DEBUG: Source auth directory not accessible" >&2
  
  # Sync entire auth directory to writable location (including database files, project state, etc.)
  if command -v rsync >/dev/null 2>&1; then
    rsync -av /home/node/.claude/ "$CLAUDE_WORK_DIR/" 2>/dev/null || echo "rsync failed, trying cp" >&2
  else
    # Fallback to cp with comprehensive copying
    cp -r /home/node/.claude/* "$CLAUDE_WORK_DIR/" 2>/dev/null || true
    cp -r /home/node/.claude/.* "$CLAUDE_WORK_DIR/" 2>/dev/null || true
  fi
  
  echo "DEBUG: Working directory contents after sync:" >&2
  ls -la "$CLAUDE_WORK_DIR/" >&2 || echo "DEBUG: Working directory not accessible" >&2
  
  # Set proper ownership and permissions for the node user
  chown -R node:node "$CLAUDE_WORK_DIR"
  chmod 600 "$CLAUDE_WORK_DIR"/.credentials.json 2>/dev/null || true
  chmod 755 "$CLAUDE_WORK_DIR" 2>/dev/null || true
  
  echo "DEBUG: Final permissions check:" >&2
  ls -la "$CLAUDE_WORK_DIR/.credentials.json" >&2 || echo "DEBUG: .credentials.json not found" >&2
  
  echo "Claude authentication directory synced to $CLAUDE_WORK_DIR" >&2
else
  echo "WARNING: No Claude authentication source found at /home/node/.claude." >&2
fi

# Configure GitHub authentication
if [ -n "${GITHUB_TOKEN}" ]; then
  export GH_TOKEN="${GITHUB_TOKEN}"
  echo "${GITHUB_TOKEN}" | sudo -u node gh auth login --with-token
  sudo -u node gh auth setup-git
else
  echo "No GitHub token provided, skipping GitHub authentication"
fi

# Configure Vercel authentication
if [ -n "${VERCEL_TOKEN}" ]; then
  echo "Setting up Vercel authentication..." >&2
  export VERCEL_TOKEN="${VERCEL_TOKEN}"
  # Vercel CLI will automatically use VERCEL_TOKEN environment variable
  echo "Vercel authentication configured via VERCEL_TOKEN" >&2
else
  echo "No Vercel token provided, skipping Vercel authentication" >&2
fi

# Clone the repository as node user
if [ -n "${GITHUB_TOKEN}" ] && [ -n "${REPO_FULL_NAME}" ]; then
  echo "Cloning repository ${REPO_FULL_NAME}..." >&2
  sudo -u node git clone "https://x-access-token:${GITHUB_TOKEN}@github.com/${REPO_FULL_NAME}.git" /workspace/repo >&2
  cd /workspace/repo
else
  echo "No repository to clone - creating empty workspace" >&2
  mkdir -p /workspace/repo
  chown node:node /workspace/repo
  cd /workspace/repo
fi

# MCP configuration is handled via .claude.json updates only
# The .mcp.json file should already exist in the project if needed

# Configure git globally first (for all operations, even general commands)
# Always configure git for the node user since Claude CLI runs as node
echo "DEBUG: Configuring git for node user (BOT_EMAIL=${BOT_EMAIL}, BOT_USERNAME=${BOT_USERNAME})" >&2
sudo -u node git config --global user.email "${BOT_EMAIL:-claude@example.com}"
sudo -u node git config --global user.name "${BOT_USERNAME#@}"  # Strip @ prefix for git config

# Also configure for root if running as root (for any git operations in the script itself)
if [ "$(id -u)" = "0" ]; then
  git config --global user.email "${BOT_EMAIL:-claude@example.com}"
  git config --global user.name "${BOT_USERNAME#@}"
  echo "DEBUG: Also configured git for root user" >&2
fi

# Verify git config was set
echo "DEBUG: Git config for node user:" >&2
sudo -u node git config --global --list 2>&1 | grep -E "user\.(name|email)" >&2 || echo "No git config found for node user" >&2

# Checkout the correct branch based on operation type (only if we have a repository)
if [ -n "${REPO_FULL_NAME}" ] && [ -d ".git" ]; then
    if [ "${OPERATION_TYPE}" = "auto-tagging" ]; then
        # Auto-tagging always uses main branch (doesn't need specific branches)
        echo "Using main branch for auto-tagging" >&2
        sudo -u node git checkout main >&2 || sudo -u node git checkout master >&2
    elif [ "${IS_PULL_REQUEST}" = "true" ] && [ -n "${BRANCH_NAME}" ]; then
        echo "Checking out PR branch: ${BRANCH_NAME}" >&2
        sudo -u node git checkout "${BRANCH_NAME}" >&2
    else
        echo "Using main branch" >&2
        sudo -u node git checkout main >&2 || sudo -u node git checkout master >&2
    fi
else
    echo "No repository context - skipping git checkout operations" >&2
fi

# Configure Claude authentication
# Support both API key and interactive auth methods
echo "DEBUG: Checking authentication options..." >&2
echo "DEBUG: ANTHROPIC_API_KEY set: $([ -n "${ANTHROPIC_API_KEY}" ] && echo 'YES' || echo 'NO')" >&2
echo "DEBUG: /workspace/.claude/.credentials.json exists: $([ -f "/workspace/.claude/.credentials.json" ] && echo 'YES' || echo 'NO')" >&2
echo "DEBUG: /workspace/.claude contents:" >&2
ls -la /workspace/.claude/ >&2 || echo "DEBUG: /workspace/.claude directory not found" >&2

if [ -n "${ANTHROPIC_API_KEY}" ]; then
  echo "Using Anthropic API key for authentication..." >&2
  export ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY}"
elif [ -f "/workspace/.claude/.credentials.json" ]; then
  echo "Using Claude interactive authentication from working directory..." >&2
  # No need to set ANTHROPIC_API_KEY - Claude CLI will use the credentials file
  # Set HOME to point to our working directory for Claude CLI
  export CLAUDE_HOME="/workspace/.claude"
  echo "DEBUG: Set CLAUDE_HOME to $CLAUDE_HOME" >&2
else
  echo "WARNING: No Claude authentication found. Please set ANTHROPIC_API_KEY or ensure ~/.claude is mounted." >&2
fi

# Create response file with proper permissions
RESPONSE_FILE="/workspace/response.txt"
touch "${RESPONSE_FILE}"
chown node:node "${RESPONSE_FILE}"

# Determine allowed tools based on operation type
if [ "${OPERATION_TYPE}" = "auto-tagging" ]; then
    ALLOWED_TOOLS="Read,GitHub,Bash(gh issue edit:*),Bash(gh issue view:*),Bash(gh label list:*)"  # Minimal tools for auto-tagging (security)
    echo "Running Claude Code for auto-tagging with minimal tools..." >&2
elif [ "${OPERATION_TYPE}" = "pr-review" ] || [ "${OPERATION_TYPE}" = "manual-pr-review" ]; then
    # PR Review: Broad research access + controlled write access
    # Read access: Full file system, git history, GitHub data
    # Write access: GitHub comments/reviews, PR labels, but no file deletion/modification
    ALLOWED_TOOLS="Read,GitHub,Bash(gh:*),Bash(git log:*),Bash(git show:*),Bash(git diff:*),Bash(git blame:*),Bash(find:*),Bash(grep:*),Bash(rg:*),Bash(cat:*),Bash(head:*),Bash(tail:*),Bash(ls:*),Bash(tree:*)"
    echo "Running Claude Code for PR review with broad research access..." >&2
else
    ALLOWED_TOOLS="Bash,Create,Edit,Read,Write,GitHub"  # Full tools for general operations
    echo "Running Claude Code with full tool access..." >&2
fi

# Add MCP tools to allowed tools if MCP servers are configured
if [ -n "${MCP_CONFIG_CONTENT}" ] && command -v jq >/dev/null 2>&1; then
    echo "Extracting MCP server names for allowed tools..." >&2
    MCP_SERVER_NAMES=$(echo "${MCP_CONFIG_CONTENT}" | jq -r '.mcpServers | keys[]' 2>/dev/null || echo "")
    
    if [ -n "$MCP_SERVER_NAMES" ]; then
        # Convert server names to comma-separated mcp__ format
        MCP_TOOLS=$(echo "$MCP_SERVER_NAMES" | sed 's/^/mcp__/' | tr '\n' ',' | sed 's/,$//')
        echo "DEBUG: Formatted MCP tools: ${MCP_TOOLS}" >&2
        
        # Append MCP tools to ALLOWED_TOOLS
        ALLOWED_TOOLS="${ALLOWED_TOOLS},${MCP_TOOLS}"
        echo "Added MCP tools to allowed list: ${MCP_TOOLS}" >&2
    else
        echo "WARNING: No MCP server names found to add to allowed tools" >&2
    fi
fi

# Check if command exists
if [ -z "${COMMAND}" ]; then
  echo "ERROR: No command provided. COMMAND environment variable is empty." | tee -a "${RESPONSE_FILE}" >&2
  exit 1
fi

# Log the command length for debugging
echo "Command length: ${#COMMAND}" >&2

# Check if .mcp.json exists in the project
echo "DEBUG: Checking for project .mcp.json:" >&2
echo "DEBUG: Current working directory: $(pwd)" >&2
echo "DEBUG: .mcp.json exists: $([ -f .mcp.json ] && echo 'YES' || echo 'NO')" >&2

# Run Claude Code with proper HOME environment
# If we synced Claude auth to workspace, use workspace as HOME
if [ -f "/workspace/.claude/.credentials.json" ]; then
  CLAUDE_USER_HOME="/workspace"
  echo "DEBUG: Using /workspace as HOME for Claude CLI (synced auth)" >&2
  # Also ensure git config exists in workspace home
  if [ ! -f "/workspace/.gitconfig" ]; then
    echo "DEBUG: Copying git config to workspace home" >&2
    sudo -u node cp /home/node/.gitconfig /workspace/.gitconfig 2>/dev/null || true
    sudo chown node:node /workspace/.gitconfig 2>/dev/null || true
  fi
else
  CLAUDE_USER_HOME="${CLAUDE_HOME:-/home/node}"
  echo "DEBUG: Using $CLAUDE_USER_HOME as HOME for Claude CLI (fallback)" >&2
fi

# Setup Claude Code project state for MCP servers if .mcp.json exists
if [ -f ".mcp.json" ]; then
  echo "Found .mcp.json in project, updating Claude state..." >&2
  
  # Extract server names from the .mcp.json file
  if command -v jq >/dev/null 2>&1; then
    # Get list of server names from mcpServers object
    SERVER_NAMES=$(jq -r '.mcpServers | keys[]' .mcp.json 2>/dev/null || echo "")
    
    if [ -n "$SERVER_NAMES" ]; then
      # Create enabledMcpjsonServers array
      ENABLED_SERVERS_JSON=$(echo "$SERVER_NAMES" | jq -R . | jq -s .)
      
      echo "DEBUG: Enabling MCP servers: $SERVER_NAMES" >&2
      
      # Update .claude.json in workspace home directory
      CLAUDE_JSON_PATH="/workspace/.claude/.claude.json"
      CURRENT_DIR=$(pwd)
      
      if [ -f "$CLAUDE_JSON_PATH" ]; then
        echo "DEBUG: Updating existing .claude.json" >&2
        # Update existing file - modify the project section for current directory
        jq --arg project_path "$CURRENT_DIR" \
           --argjson enabled_servers "$ENABLED_SERVERS_JSON" \
           '(.projects[$project_path].enabledMcpjsonServers = $enabled_servers) | 
            (.projects[$project_path].disabledMcpjsonServers = [])' \
           "$CLAUDE_JSON_PATH" > "$CLAUDE_JSON_PATH.tmp" && \
        mv "$CLAUDE_JSON_PATH.tmp" "$CLAUDE_JSON_PATH"
      else
        echo "DEBUG: Creating new .claude.json" >&2
        mkdir -p "$(dirname "$CLAUDE_JSON_PATH")"
        # Create minimal file structure
        jq -n --arg project_path "$CURRENT_DIR" \
           --argjson enabled_servers "$ENABLED_SERVERS_JSON" \
           '{
             "projects": {
               ($project_path): {
                 "enabledMcpjsonServers": $enabled_servers,
                 "disabledMcpjsonServers": []
               }
             }
           }' > "$CLAUDE_JSON_PATH"
      fi
      
      chown -R node:node "$(dirname "$CLAUDE_JSON_PATH")" 2>/dev/null || true
      
      echo "DEBUG: MCP servers enabled in .claude.json" >&2
    else
      echo "WARNING: No MCP servers found in .mcp.json" >&2
    fi
  else
    echo "WARNING: jq not available, cannot setup MCP state automatically" >&2
  fi
else
  echo "No .mcp.json found in project directory" >&2
fi

if [ "${OUTPUT_FORMAT}" = "stream-json" ]; then
  # For stream-json, output directly to stdout for real-time processing
  exec sudo -u node -E env \
      HOME="$CLAUDE_USER_HOME" \
      PATH="/usr/local/bin:/usr/local/share/npm-global/bin:$PATH" \
      ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY}" \
      GH_TOKEN="${GITHUB_TOKEN}" \
      GITHUB_TOKEN="${GITHUB_TOKEN}" \
      VERCEL_TOKEN="${VERCEL_TOKEN}" \
      BASH_DEFAULT_TIMEOUT_MS="${BASH_DEFAULT_TIMEOUT_MS}" \
      BASH_MAX_TIMEOUT_MS="${BASH_MAX_TIMEOUT_MS}" \
      /usr/local/share/npm-global/bin/claude \
      --allowedTools "${ALLOWED_TOOLS}" \
      --output-format stream-json \
      --verbose \
      --print "${COMMAND}"
else
  
  # Default behavior - write to file  
  sudo -u node -E env \
      HOME="$CLAUDE_USER_HOME" \
      PATH="/usr/local/bin:/usr/local/share/npm-global/bin:$PATH" \
      ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY}" \
      GH_TOKEN="${GITHUB_TOKEN}" \
      GITHUB_TOKEN="${GITHUB_TOKEN}" \
      VERCEL_TOKEN="${VERCEL_TOKEN}" \
      BASH_DEFAULT_TIMEOUT_MS="${BASH_DEFAULT_TIMEOUT_MS}" \
      BASH_MAX_TIMEOUT_MS="${BASH_MAX_TIMEOUT_MS}" \
      /usr/local/share/npm-global/bin/claude \
      --allowedTools "${ALLOWED_TOOLS}" \
      --verbose \
      --print "${COMMAND}" \
      > "${RESPONSE_FILE}" 2>&1
  
  # Capture the exit code before it gets lost
  CLAUDE_EXIT_CODE=$?
  
  # If Claude failed, show the error output
  if [ $CLAUDE_EXIT_CODE -ne 0 ]; then
    echo "DEBUG: Claude CLI FAILED. Error output:" >&2
    cat "${RESPONSE_FILE}" >&2
  fi
fi

# Check for errors
if [ $? -ne 0 ]; then
  echo "ERROR: Claude Code execution failed. See logs for details." | tee -a "${RESPONSE_FILE}" >&2
fi

# Output the response
cat "${RESPONSE_FILE}"