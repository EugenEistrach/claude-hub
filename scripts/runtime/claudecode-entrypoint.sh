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

# MCP configuration is handled via template files that are processed at startup

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

# Note: MCP tools will be added to ALLOWED_TOOLS after template processing


# Check if command exists
if [ -z "${COMMAND}" ]; then
  echo "ERROR: No command provided. COMMAND environment variable is empty." | tee -a "${RESPONSE_FILE}" >&2
  exit 1
fi

# Log the command length for debugging
echo "Command length: ${#COMMAND}" >&2


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

# Set template
WORKSPACE_TEMPLATE="${WORKSPACE_TEMPLATE:-default}"

# Copy and process template
if [ -d "/templates/${WORKSPACE_TEMPLATE}" ]; then
  echo "Initializing workspace from template: ${WORKSPACE_TEMPLATE}" >&2
  
  # Debug: Check Discord environment variables
  echo "DEBUG: DISCORD_BOT_TOKEN is $([ -n "${DISCORD_BOT_TOKEN}" ] && echo 'set' || echo 'not set')" >&2
  echo "DEBUG: DISCORD_CHANNEL_ID=${DISCORD_CHANNEL_ID:-'not set'}" >&2
  
  # Create temp directory for processing
  TEMP_WORKSPACE="/tmp/workspace-temp"
  mkdir -p "$TEMP_WORKSPACE"
  
  # Copy template to temp location
  cp -r "/templates/${WORKSPACE_TEMPLATE}/." "$TEMP_WORKSPACE/"
  
  # Process all files for environment variable substitution
  find "$TEMP_WORKSPACE" -type f \( -name "*.json" -o -name ".gitconfig" \) | while read -r file; do
    echo "Processing $file for variable substitution..." >&2
    # Use envsubst to replace ${VARIABLE} with actual values
    envsubst < "$file" > "$file.tmp" && mv "$file.tmp" "$file"
  done
  
  # Copy processed files to final location
  cp -r "$TEMP_WORKSPACE/." /workspace/
  
  
  rm -rf "$TEMP_WORKSPACE"
  
  # Set ownership
  chown -R node:node /workspace
  
  echo "Workspace initialized from template" >&2
  
  # Debug: Check if mcp-servers.json was created
  echo "DEBUG: Checking processed template files:" >&2
  ls -la /workspace/mcp-servers.json 2>&1 >&2 || echo "DEBUG: No mcp-servers.json after template processing" >&2
else
  echo "WARNING: Template '${WORKSPACE_TEMPLATE}' not found" >&2
fi

# Add MCP tools to allowed tools if MCP servers are configured (AFTER template processing)
echo "DEBUG: Checking if we need to add MCP tools to allowed tools..." >&2
echo "DEBUG: Looking for /workspace/.mcp.json..." >&2
if [ -f "/workspace/.mcp.json" ] && command -v jq >/dev/null 2>&1; then
    echo "Extracting MCP server names for allowed tools..." >&2
    echo "DEBUG: .mcp.json content:" >&2
    cat /workspace/.mcp.json >&2
    
    MCP_SERVER_NAMES=$(jq -r '.mcpServers | keys[]' /workspace/.mcp.json 2>/dev/null || echo "")
    echo "DEBUG: Extracted server names: $MCP_SERVER_NAMES" >&2
    
    if [ -n "$MCP_SERVER_NAMES" ]; then
        # Convert server names to comma-separated mcp__ format
        MCP_TOOLS=$(echo "$MCP_SERVER_NAMES" | sed 's/^/mcp__/' | tr '\n' ',' | sed 's/,$//')
        echo "DEBUG: Formatted MCP tools: ${MCP_TOOLS}" >&2
        
        # Append MCP tools to ALLOWED_TOOLS
        ALLOWED_TOOLS="${ALLOWED_TOOLS},${MCP_TOOLS}"
        echo "Added MCP tools to allowed list: ${MCP_TOOLS}" >&2
        echo "DEBUG: Updated ALLOWED_TOOLS: ${ALLOWED_TOOLS}" >&2
    else
        echo "WARNING: No MCP server names found to add to allowed tools" >&2
    fi
else
    echo "DEBUG: Either /workspace/.mcp.json not found or jq not available" >&2
    [ ! -f "/workspace/.mcp.json" ] && echo "DEBUG: .mcp.json does not exist" >&2
    ! command -v jq >/dev/null 2>&1 && echo "DEBUG: jq command not found" >&2
fi

# Set up Claude Trace environment (always enabled)
if [ -n "${CLAUDE_TRACE_SESSION_ID}" ]; then
  echo "Setting up Claude Trace for session ${CLAUDE_TRACE_SESSION_ID}..." >&2
  
  # Create session directory directly in mounted host location
  SESSION_DIR="/sessions/${CLAUDE_TRACE_SESSION_ID}"
  mkdir -p "${SESSION_DIR}"
  chown node:node "${SESSION_DIR}"
  
  # Point trace output to the mounted sessions directory  
  export CLAUDE_TRACE_OUTPUT_DIR="${SESSION_DIR}"
  
  # Use our custom Claude Trace loader that respects CLAUDE_TRACE_LOG_DIR
  CLAUDE_TRACE_LOADER="/usr/local/lib/claude-trace-loader.js"
  
  if [ ! -f "$CLAUDE_TRACE_LOADER" ]; then
    echo "WARNING: Custom claude-trace loader not found at $CLAUDE_TRACE_LOADER" >&2
    # Fallback to original locations
    POSSIBLE_LOCATIONS=(
      "/usr/local/share/npm-global/lib/node_modules/@mariozechner/claude-trace/dist/interceptor-loader.js"
      "/home/claudeuser/.npm-global/lib/node_modules/@mariozechner/claude-trace/dist/interceptor-loader.js"
      "$NPM_CONFIG_PREFIX/lib/node_modules/@mariozechner/claude-trace/dist/interceptor-loader.js"
    )
    
    for location in "${POSSIBLE_LOCATIONS[@]}"; do
      if [ -f "$location" ]; then
        CLAUDE_TRACE_LOADER="$location"
        echo "DEBUG: Using fallback claude-trace loader at $location" >&2
        break
      fi
    done
  else
    echo "DEBUG: Using custom claude-trace loader at $CLAUDE_TRACE_LOADER" >&2
  fi
  
  if [ -z "$CLAUDE_TRACE_LOADER" ]; then
    echo "WARNING: claude-trace not found in any expected location. Trace will not be available." >&2
    echo "DEBUG: Checked locations:" >&2
    for location in "${POSSIBLE_LOCATIONS[@]}"; do
      echo "  - $location" >&2
    done
    # Claude Trace loader not found, but we still proceed
  else
    # Set Claude Trace environment variables
    export CLAUDE_TRACE_LOG_DIR="${CLAUDE_TRACE_OUTPUT_DIR}"
    export CLAUDE_TRACE_INCLUDE_ALL_REQUESTS="true"
    export CLAUDE_TRACE_OPEN_BROWSER="false"
    
    # Add Node.js require flag to inject interceptor
    export NODE_OPTIONS="--require $CLAUDE_TRACE_LOADER"
    
    echo "Claude Trace configured to output to ${CLAUDE_TRACE_OUTPUT_DIR}" >&2
  fi
fi

# Setup MCP servers if template exists
echo "DEBUG: Checking for MCP server configuration..." >&2
if [ -f "/workspace/.mcp.json" ] && command -v jq >/dev/null 2>&1; then
  echo "Setting up MCP servers from template..." >&2
  
  # Extract each server and add using claude mcp add-json
  jq -c '.mcpServers | to_entries[]' /workspace/.mcp.json | while read -r server_entry; do
    server_name=$(echo "$server_entry" | jq -r '.key')
    server_config=$(echo "$server_entry" | jq -c '.value')
    
    echo "Adding MCP server: $server_name" >&2
    
    # Add server using claude mcp add-json
    if sudo -u node -E env \
        HOME="$CLAUDE_USER_HOME" \
        PATH="/usr/local/bin:/usr/local/share/npm-global/bin:$PATH" \
        /usr/local/share/npm-global/bin/claude mcp add-json "$server_name" "$server_config" 2>&1 >&2; then
      echo "Successfully added MCP server: $server_name" >&2
    else
      echo "ERROR: Failed to add MCP server: $server_name" >&2
    fi
  done
  
  # Enable servers in .claude.json
  echo "Enabling MCP servers..." >&2
  MCP_SERVERS=$(jq -r '.mcpServers | keys | @json' /workspace/.mcp.json)
  CLAUDE_JSON_PATH="$CLAUDE_USER_HOME/.claude.json"
  
  if [ -f "$CLAUDE_JSON_PATH" ]; then
    jq --argjson servers "$MCP_SERVERS" \
       --arg project_path "/workspace/repo" \
       '.projects[$project_path].enabledMcpjsonServers = $servers' \
       "$CLAUDE_JSON_PATH" > "$CLAUDE_JSON_PATH.tmp" && \
    mv "$CLAUDE_JSON_PATH.tmp" "$CLAUDE_JSON_PATH"
    chown node:node "$CLAUDE_JSON_PATH"
    echo "MCP servers enabled in .claude.json" >&2
  else
    echo "WARNING: .claude.json not found at $CLAUDE_JSON_PATH" >&2
  fi
  
  # Ensure /workspace/.claude.json is writable if it exists
  if [ -f "/workspace/.claude.json" ]; then
    chown node:node "/workspace/.claude.json"
  fi
else
  echo "DEBUG: No MCP configuration found" >&2
fi

echo "DEBUG: Current working directory before Claude execution: $(pwd)" >&2
echo "DEBUG: Checking for .mcp.json in current directory..." >&2
ls -la .mcp.json 2>&1 >&2 || echo "DEBUG: No .mcp.json in current directory" >&2

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
      NODE_OPTIONS="${NODE_OPTIONS}" \
      CLAUDE_TRACE_LOG_DIR="${CLAUDE_TRACE_LOG_DIR}" \
      CLAUDE_TRACE_INCLUDE_ALL_REQUESTS="${CLAUDE_TRACE_INCLUDE_ALL_REQUESTS}" \
      CLAUDE_TRACE_OPEN_BROWSER="${CLAUDE_TRACE_OPEN_BROWSER}" \
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
      NODE_OPTIONS="${NODE_OPTIONS}" \
      CLAUDE_TRACE_LOG_DIR="${CLAUDE_TRACE_LOG_DIR}" \
      CLAUDE_TRACE_INCLUDE_ALL_REQUESTS="${CLAUDE_TRACE_INCLUDE_ALL_REQUESTS}" \
      CLAUDE_TRACE_OPEN_BROWSER="${CLAUDE_TRACE_OPEN_BROWSER}" \
      /usr/local/share/npm-global/bin/claude \
      --allowedTools "${ALLOWED_TOOLS}" \
      --verbose \
      --print "${COMMAND}" \
      > "${RESPONSE_FILE}" 2>&1
  
  # Capture the exit code before it gets lost
  CLAUDE_EXIT_CODE=$?
  
  # If Claude failed, show the error output
  if [ $CLAUDE_EXIT_CODE -ne 0 ]; then
    echo "ERROR: Claude CLI FAILED with exit code $CLAUDE_EXIT_CODE" >&2
    echo "DEBUG: Error output from Claude CLI:" >&2
    cat "${RESPONSE_FILE}" >&2
    echo "DEBUG: End of Claude CLI error output" >&2
    exit $CLAUDE_EXIT_CODE
  fi
fi

# Handle Claude Trace files (always check since trace is always enabled)
if [ -n "${SESSION_ID}" ]; then
  echo "DEBUG: Checking for Claude Trace files..." >&2
  echo "DEBUG: CLAUDE_TRACE_LOG_DIR=${CLAUDE_TRACE_LOG_DIR}" >&2
  echo "DEBUG: CLAUDE_TRACE_OUTPUT_DIR=${CLAUDE_TRACE_OUTPUT_DIR}" >&2
  
  # With direct mounting, files should be written directly to /sessions/${SESSION_ID}
  SESSION_DIR="/sessions/${SESSION_ID}"
  
  echo "DEBUG: Checking mounted sessions directory: $SESSION_DIR" >&2
  if [ -d "$SESSION_DIR" ]; then
    echo "DEBUG: Sessions directory exists, checking for trace files..." >&2
    ls -la "$SESSION_DIR" >&2
    
    # Find and rename log files to standard names if needed
    LATEST_JSONL=$(ls -t "$SESSION_DIR"/log-*.jsonl 2>/dev/null | head -n1)
    LATEST_HTML=$(ls -t "$SESSION_DIR"/log-*.html 2>/dev/null | head -n1)
    
    if [ -f "$LATEST_JSONL" ] && [ ! -f "$SESSION_DIR/trace.jsonl" ]; then
      echo "DEBUG: Renaming $LATEST_JSONL to trace.jsonl" >&2
      mv "$LATEST_JSONL" "$SESSION_DIR/trace.jsonl"
      chmod 644 "$SESSION_DIR/trace.jsonl"
    fi
    
    if [ -f "$LATEST_HTML" ] && [ ! -f "$SESSION_DIR/trace.html" ]; then
      echo "DEBUG: Renaming $LATEST_HTML to trace.html" >&2
      mv "$LATEST_HTML" "$SESSION_DIR/trace.html"
      chmod 644 "$SESSION_DIR/trace.html"
    fi
    
    echo "DEBUG: Final trace file check:" >&2
    ls -la "$SESSION_DIR"/trace.* 2>&1 >&2 || echo "DEBUG: No trace files found" >&2
  else
    echo "DEBUG: Sessions directory $SESSION_DIR does not exist" >&2
  fi
else
  echo "DEBUG: No SESSION_ID provided for trace file handling" >&2
fi

# Debug: Log the final .claude.json after Claude has run
echo "DEBUG: Checking final .claude.json after Claude execution..." >&2
CLAUDE_JSON_DEBUG_PATH="$CLAUDE_USER_HOME/.claude/.claude.json"
echo "DEBUG: Looking for .claude.json at $CLAUDE_JSON_DEBUG_PATH" >&2
if [ -f "$CLAUDE_JSON_DEBUG_PATH" ]; then
    echo "DEBUG: Final .claude.json contents:" >&2
    cat "$CLAUDE_JSON_DEBUG_PATH" >&2
    echo "DEBUG: End of final .claude.json contents" >&2
    echo "DEBUG: File size: $(wc -c < "$CLAUDE_JSON_DEBUG_PATH") bytes" >&2
else
    echo "DEBUG: Still no .claude.json found after Claude execution at $CLAUDE_JSON_DEBUG_PATH" >&2
    echo "DEBUG: Checking all .claude.json files in system:" >&2
    find / -name ".claude.json" -type f 2>/dev/null | head -10 >&2
fi

# Debug: Check final ALLOWED_TOOLS value
echo "DEBUG: Final ALLOWED_TOOLS value: ${ALLOWED_TOOLS}" >&2

# Output the response
cat "${RESPONSE_FILE}"

# Ensure all writes are flushed to disk
sync

# Copy debug logs to a persistent location before container exits
if [ -n "${SESSION_ID}" ]; then
  DEBUG_LOG_FILE="/tmp/claude-shared/${SESSION_ID}/debug.log"
  mkdir -p "$(dirname "$DEBUG_LOG_FILE")"
  {
    echo "=== CONTAINER DEBUG LOG ==="
    echo "Timestamp: $(date)"
    echo "Session ID: ${SESSION_ID}"
    echo "ALLOWED_TOOLS: ${ALLOWED_TOOLS}"
    echo "WORKSPACE_TEMPLATE: ${WORKSPACE_TEMPLATE}"
    echo ""
    echo "=== MCP Configuration ==="
    echo ".mcp.json exists in repo: $([ -f /workspace/repo/.mcp.json ] && echo 'YES' || echo 'NO')"
    if [ -f /workspace/repo/.mcp.json ]; then
      echo ".mcp.json contents:"
      cat /workspace/repo/.mcp.json
    fi
    echo ""
    echo "=== Claude JSON ==="
    echo "Claude JSON path: $CLAUDE_USER_HOME/.claude/.claude.json"
    if [ -f "$CLAUDE_USER_HOME/.claude/.claude.json" ]; then
      echo ".claude.json contents:"
      cat "$CLAUDE_USER_HOME/.claude/.claude.json"
    else
      echo ".claude.json not found"
    fi
    echo ""
    echo "=== Environment ==="
    echo "DISCORD_BOT_TOKEN: $([ -n "${DISCORD_BOT_TOKEN}" ] && echo '[SET]' || echo '[NOT SET]')"
    echo "DISCORD_CHANNEL_ID: ${DISCORD_CHANNEL_ID:-'[NOT SET]'}"
  } > "$DEBUG_LOG_FILE" 2>&1
  
  echo "DEBUG: Debug log saved to $DEBUG_LOG_FILE" >&2
  
  # Final session directory check (mounted host directory)
  echo "DEBUG: Final session directory contents:" >&2
  ls -la "/sessions/${SESSION_ID}/" >&2
  
  # Trace files are now written directly to mounted /sessions directory - no copying needed
  
  # Force sync again
  sync
  
  # Small delay to ensure writes complete
  sleep 1
fi