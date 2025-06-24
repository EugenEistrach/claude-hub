import { execFileSync } from 'child_process';
import { promisify } from 'util';
import { execFile } from 'child_process';
import path from 'path';
import fs from 'fs';
import { createLogger } from '../utils/logger';
import { sanitizeBotMentions } from '../utils/sanitize';
import secureCredentials from '../utils/secureCredentials';
import type {
  ClaudeCommandOptions,
  OperationType,
  ClaudeEnvironmentVars,
  DockerExecutionOptions,
  ContainerSecurityConfig,
  ClaudeResourceLimits
} from '../types/claude';

const logger = createLogger('claudeService');

// Get bot username from environment variables - required
const BOT_USERNAME = process.env['BOT_USERNAME'];

// Validate bot username is set
if (!BOT_USERNAME) {
  logger.error(
    'BOT_USERNAME environment variable is not set in claudeService. This is required to prevent infinite loops.'
  );
  throw new Error('BOT_USERNAME environment variable is required');
}

const execFileAsync = promisify(execFile);

/**
 * Process template string by replacing ${VAR_NAME} with environment variable values
 */
function processTemplate(templateContent: string, env: Record<string, string | undefined>): string {
  return templateContent.replace(/\$\{([^}]+)\}/g, (match, varName) => {
    const value = env[varName];
    if (value === undefined) {
      logger.warn({ varName }, 'Environment variable not found for MCP template substitution');
      return match; // Keep placeholder if env var not found
    }
    return value;
  });
}

/**
 * Generate the prompt that would be sent to Claude (for debugging)
 */
export function generateClaudePrompt({
  repoFullName,
  issueNumber,
  command,
  isPullRequest = false,
  branchName = null,
  operationType = 'default'
}: ClaudeCommandOptions): string {
  return createPrompt({
    operationType,
    repoFullName,
    issueNumber,
    branchName,
    isPullRequest,
    command
  });
}

/**
 * Processes a command using Claude Code CLI
 */
export async function processCommand({
  repoFullName,
  issueNumber,
  command,
  isPullRequest = false,
  branchName = null,
  operationType = 'default'
}: ClaudeCommandOptions): Promise<string> {
  try {
    logger.info(
      {
        repo: repoFullName,
        issue: issueNumber,
        isPullRequest,
        branchName,
        commandLength: command.length
      },
      'Processing command with Claude'
    );

    const githubToken = secureCredentials.get('GITHUB_TOKEN');
  const vercelToken = secureCredentials.get('VERCEL_TOKEN') ?? process.env.VERCEL_TOKEN;
  
  if (vercelToken) {
    logger.info('VERCEL_TOKEN is available for Claude container');
  } else {
    logger.info('VERCEL_TOKEN is not set - Vercel CLI will not be authenticated');
  }

    // In test mode, skip execution and return a mock response
    // Support both classic (ghp_) and fine-grained (github_pat_) GitHub tokens
    const isValidGitHubToken =
      githubToken && (githubToken.includes('ghp_') || githubToken.includes('github_pat_'));
    if (process.env['NODE_ENV'] === 'test' || !isValidGitHubToken) {
      logger.info(
        {
          repo: repoFullName,
          issue: issueNumber
        },
        'TEST MODE: Skipping Claude execution'
      );

      // Create a test response and sanitize it
      const testResponse = `Hello! I'm Claude responding to your request.

Since this is a test environment, I'm providing a simulated response. In production, I would:
1. Clone the repository ${repoFullName}
2. ${isPullRequest ? `Checkout PR branch: ${branchName}` : 'Use the main branch'}
3. Analyze the codebase and execute: "${command}"
4. Use GitHub CLI to interact with issues, PRs, and comments

For real functionality, please configure valid GitHub and Claude API tokens.`;

      // Always sanitize responses, even in test mode
      return sanitizeBotMentions(testResponse);
    }

    // Build Docker image if it doesn't exist
    const dockerImageName = process.env['CLAUDE_CONTAINER_IMAGE'] ?? 'claudecode:latest';
    try {
      execFileSync('docker', ['inspect', dockerImageName], { stdio: 'ignore' });
      logger.info({ dockerImageName }, 'Docker image already exists');
    } catch {
      logger.info({ dockerImageName }, 'Building Docker image for Claude Code runner');
      execFileSync('docker', ['build', '-f', 'Dockerfile.claudecode', '-t', dockerImageName, '.'], {
        cwd: path.join(__dirname, '../..'),
        stdio: 'pipe'
      });
    }

    // Use unified entrypoint script for all operation types
    const entrypointScript = getEntrypointScript();
    logger.info(
      { operationType },
      `Using ${operationType === 'auto-tagging' ? 'minimal tools for auto-tagging operation' : 'full tool set for standard operation'}`
    );

    // Create unique container name (sanitized to prevent command injection)
    const sanitizedRepoName = repoFullName
      ? repoFullName.replace(/[^a-zA-Z0-9\-_]/g, '-')
      : 'general';
    const containerName = `claude-${sanitizedRepoName}-${Date.now()}`;

    // Create the full prompt with context and instructions based on operation type
    logger.info(
      {
        operationType,
        repoFullName,
        issueNumber,
        branchName,
        isPullRequest,
        commandLength: command.length
      },
      'Creating prompt with parameters'
    );

    const fullPrompt = createPrompt({
      operationType,
      repoFullName,
      issueNumber,
      branchName,
      isPullRequest,
      command
    });

    // Prepare environment variables for the container
    const envVars = createEnvironmentVars({
      repoFullName,
      issueNumber,
      isPullRequest,
      branchName,
      operationType,
      fullPrompt,
      githubToken,
      vercelToken
    });

    // Run the container
    logger.info(
      {
        containerName,
        repo: repoFullName,
        isPullRequest,
        branch: branchName
      },
      'Starting Claude Code container'
    );

    // Build docker run command as an array to prevent command injection
    const dockerArgs = buildDockerArgs({
      containerName,
      entrypointScript,
      dockerImageName,
      envVars
    });

    // Create sanitized version for logging (remove sensitive values)
    const sanitizedArgs = sanitizeDockerArgs(dockerArgs);

    try {
      logger.info({ dockerArgs: sanitizedArgs }, 'Executing Docker command');

      // Get container lifetime from environment variable or use default (2 hours)
      const containerLifetimeMs = parseInt(process.env['CONTAINER_LIFETIME_MS'] ?? '7200000', 10);
      logger.info({ containerLifetimeMs }, 'Setting container lifetime');

      const executionOptions: DockerExecutionOptions = {
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
        timeout: containerLifetimeMs // Container lifetime in milliseconds
      };

      const result = await execFileAsync('docker', dockerArgs, executionOptions);

      let responseText = result.stdout.trim();

      // Check for empty response
      if (!responseText) {
        logger.warn(
          {
            containerName,
            repo: repoFullName,
            issue: issueNumber
          },
          'Empty response from Claude Code container'
        );

        // Try to get container logs as the response instead
        try {
          responseText = execFileSync('docker', ['logs', containerName], {
            encoding: 'utf8',
            maxBuffer: 1024 * 1024,
            stdio: ['pipe', 'pipe', 'pipe']
          });
          logger.info('Retrieved response from container logs');
        } catch (e) {
          logger.error(
            {
              error: (e as Error).message,
              containerName
            },
            'Failed to get container logs as fallback'
          );
        }
      }

      // Sanitize response to prevent infinite loops by removing bot mentions
      responseText = sanitizeBotMentions(responseText);

      logger.info(
        {
          repo: repoFullName,
          issue: issueNumber,
          responseLength: responseText.length,
          containerName,
          stdout: responseText.substring(0, 500) // Log first 500 chars
        },
        'Claude Code execution completed successfully'
      );

      return responseText;
    } catch (error) {
      return handleDockerExecutionError(error, {
        containerName,
        dockerArgs: sanitizedArgs,
        dockerImageName,
        githubToken,
        repoFullName: repoFullName ?? 'general',
        issueNumber: issueNumber ?? null
      });
    }
  } catch (error) {
    return handleGeneralError(error, {
      repoFullName: repoFullName ?? 'general',
      issueNumber: issueNumber ?? null
    });
  }
}

/**
 * Get entrypoint script for Claude Code execution
 * Uses unified entrypoint that handles all operation types based on OPERATION_TYPE env var
 */
function getEntrypointScript(): string {
  return '/scripts/runtime/claudecode-entrypoint.sh';
}

/**
 * Create prompt based on operation type and context
 */
function createPrompt({
  operationType,
  repoFullName,
  issueNumber,
  branchName,
  isPullRequest,
  command
}: {
  operationType: OperationType;
  repoFullName?: string;
  issueNumber?: number | null;
  branchName?: string | null;
  isPullRequest?: boolean;
  command: string;
}): string {
  // Determine prompt template based on context
  if (operationType === 'auto-tagging') {
    return createGitHubAutoTaggingPrompt({ repoFullName, issueNumber, command });
  } else if (repoFullName && issueNumber === 0 && !isPullRequest) {
    // Discord command with repository context (issue #0 is a special marker)
    logger.info({ repoFullName, issueNumber, isPullRequest }, 'Using Discord repository prompt');
    return createDiscordRepositoryPrompt({ repoFullName, command });
  } else if (repoFullName && issueNumber !== null && issueNumber !== undefined) {
    logger.info({ repoFullName, issueNumber, isPullRequest }, 'Using GitHub context prompt');
    return createGitHubContextPrompt({
      repoFullName,
      issueNumber,
      branchName,
      isPullRequest,
      command
    });
  } else {
    logger.info('Using general prompt (no repository context)');
    return createGeneralPrompt({ command });
  }
}

/**
 * Create Discord-specific prompt with repository context
 */
function createDiscordRepositoryPrompt({
  repoFullName,
  command
}: {
  repoFullName: string;
  command: string;
}): string {
  return `You are Claude, an AI assistant helping with a repository task from Discord.

**Context:**
- Repository: ${repoFullName}
- Source: Discord command
- **Current Directory: The repository ${repoFullName} has been cloned and you are currently in /workspace/repo**
- Running in: Unattended mode

**Available Tools & Authentication:**
- **Vercel CLI**: Fully authenticated - can deploy, manage projects, domains, logs
- **GitHub CLI**: Full access - repos, issues, PRs, API operations
- **Git**: Version control, branching, commits, push/pull
- **File System**: Read, Write, Edit all repository files
- **MCP Tools**:
  - \`context7\`: For recent docs (e.g., Tailwind 4, Claude Code)
  - \`discord-agent-comm\`: Send status updates (use sparingly, don't spam)

**Instructions:**
1. **Validate before assuming**: Test tool availability (e.g., \`vercel --version\`) before claiming limitations
2. Repository is cloned and ready in /workspace/repo
3. Complete tasks fully - create branches, commit, push changes
4. For deployments: Use \`vercel\` or \`vercel --prod\` as appropriate
5. **Progress Updates**: Use \`discord-agent-comm\` for status on long tasks or when stuck
6. **IMPORTANT - Response Format:**
   - Return clean, properly formatted text/markdown
   - Do NOT escape special characters or newlines
   - Your response will be sent directly to Discord
   - **Keep your final response under 1000 characters** (aim for concise summaries)
   - For longer content: provide a brief summary and mention "Details saved to [filename]"
   - Focus on what was accomplished, not how

**User Request:**
${command}

Please complete this task fully and autonomously.`;
}

/**
 * Create GitHub auto-tagging prompt
 */
function createGitHubAutoTaggingPrompt({
  repoFullName,
  issueNumber,
  command
}: {
  repoFullName?: string;
  issueNumber?: number | null;
  command: string;
}): string {
  return `You are Claude, an AI assistant analyzing a GitHub issue for automatic label assignment.

**Context:**
- Repository: ${repoFullName ?? 'Unknown'}
- Issue Number: #${issueNumber ?? 'Unknown'}
- Operation: Auto-tagging (Read-only + Label assignment)

**Available Tools:**
- Read: Access repository files and issue content
- GitHub: Use 'gh' CLI for label operations only

**Task:**
Analyze the issue and apply appropriate labels using GitHub CLI commands. Use these categories:
- Priority: critical, high, medium, low
- Type: bug, feature, enhancement, documentation, question, security
- Complexity: trivial, simple, moderate, complex
- Component: api, frontend, backend, database, auth, webhook, docker

**Process:**
1. First run 'gh label list' to see available labels
2. Analyze the issue content
3. Use 'gh issue edit #{issueNumber} --add-label "label1,label2,label3"' to apply labels
4. Do NOT comment on the issue - only apply labels

**User Request:**
${command}

Complete the auto-tagging task using only the minimal required tools.`;
}

/**
 * Create GitHub-specific prompt with repository context
 */
function createGitHubContextPrompt({
  repoFullName,
  issueNumber,
  branchName,
  isPullRequest,
  command
}: {
  repoFullName: string;
  issueNumber: number | null;
  branchName?: string | null;
  isPullRequest?: boolean;
  command: string;
}): string {
  return `You are ${process.env.BOT_USERNAME}, an AI assistant responding to a GitHub ${isPullRequest ? 'pull request' : 'issue'}.

**Context:**
- Repository: ${repoFullName}
- ${isPullRequest ? 'Pull Request' : 'Issue'} Number: #${issueNumber}
- Current Branch: ${branchName ?? 'main'}
- Running in: Unattended mode
- **Current Directory: The repository has been cloned and you are currently in /workspace/repo**

**Available Tools & Authentication:**
- **Vercel CLI**: Fully authenticated - deploy (\`vercel\`/\`vercel --prod\`), manage projects/domains/logs
- **GitHub CLI**: Full access - repos, issues, PRs, API operations
- **Git**: Version control, branching, commits, push/pull
- **MCP Tools**:
  - \`context7\`: For recent docs (e.g., Tailwind 4, Claude Code)
  - \`discord-agent-comm\`: Send status updates (use sparingly, don't spam)

**Instructions:**
1. **Validate before assuming**: Test commands (e.g., \`vercel --version\`, \`gh --version\`) instead of assuming limitations
2. Repository cloned at /workspace/repo - create feature branches for work
3. Complete tasks fully: code > test > commit > push > PR if needed
4. Use \`gh issue comment\`/\`gh pr comment\` for progress updates
5. Debug and fix errors before completing - don't stop at partial solutions
6. **Progress & Help**: Use \`discord-agent-comm\` when stuck or for major milestones (sparingly)
7. **IMPORTANT - Markdown Formatting:**
   - When your response contains markdown (like headers, lists, code blocks), return it as properly formatted markdown
   - Do NOT escape or encode special characters like newlines (\\n) or quotes
   - Return clean, human-readable markdown that GitHub will render correctly
   - Your response should look like normal markdown text, not escaped strings
8. **Request Acknowledgment:**
   - For larger or complex tasks that will take significant time, first acknowledge the request
   - Post a brief comment like "I understand. Working on [task description]..." before starting
   - Use 'gh issue comment' or 'gh pr comment' to post this acknowledgment immediately
   - This lets the user know their request was received and is being processed

**User Request:**
${command}

Please complete this task fully and autonomously.`;
}

/**
 * Create general prompt without repository context
 */
function createGeneralPrompt({ command }: { command: string }): string {
  return `You are Claude, an AI assistant helping with general tasks.

**Context:**
- Running in: General command mode
- You have full system access including Git and GitHub CLI

**Available Tools & Authentication:**
- **Vercel CLI**: Fully authenticated - deploy (\`vercel\`/\`vercel --prod\`), list, domains, link, logs
- **GitHub CLI**: Full access - create repos (\`gh repo create\`), issues, PRs, clone, manage
- **Git**: Version control, branching, commits, push/pull
- **File System**: Create, edit, manage files and directories
- **Shell**: Execute any bash commands needed
- **MCP Tools**:
  - \`context7\`: For recent docs (e.g., Tailwind 4, Claude Code)
  - \`discord-agent-comm\`: Send status updates (use sparingly, don't spam)

**Instructions:**
1. **Validate before assuming**: Test tool availability (e.g., \`vercel --version\`, \`gh --version\`) instead of claiming limitations
2. You CAN create repos, push code, deploy projects - don't assume restrictions
3. Complete workflow: init git > commit > create GitHub repo > push > deploy if needed
4. Always complete tasks fully
5. **Progress Updates**: Use \`discord-agent-comm\` for status on long tasks or when stuck
6. **Discord Response Format:**
   - **Keep your final response under 1000 characters** (be concise!)
   - Focus on what was accomplished, not detailed steps
   - For code/logs: mention "Details saved to [filename]" instead of including them

**User Request:**
${command}

Please complete this task fully and autonomously.`;
}

/**
 * Create environment variables for container
 */
function createEnvironmentVars({
  repoFullName,
  issueNumber,
  isPullRequest,
  branchName,
  operationType,
  fullPrompt,
  githubToken,
  vercelToken
}: {
  repoFullName?: string;
  issueNumber?: number | null;
  isPullRequest?: boolean;
  branchName?: string | null;
  operationType: OperationType;
  fullPrompt: string;
  githubToken: string;
  vercelToken?: string;
}): ClaudeEnvironmentVars {
  return {
    REPO_FULL_NAME: repoFullName ?? '',
    ISSUE_NUMBER: issueNumber?.toString() ?? '',
    IS_PULL_REQUEST: isPullRequest ? 'true' : 'false',
    BRANCH_NAME: branchName ?? '',
    OPERATION_TYPE: operationType,
    COMMAND: fullPrompt,
    GITHUB_TOKEN: githubToken,
    ANTHROPIC_API_KEY: secureCredentials.get('ANTHROPIC_API_KEY') ?? '',
    BOT_USERNAME: process.env.BOT_USERNAME,
    BOT_EMAIL: process.env.BOT_EMAIL,
    VERCEL_TOKEN: vercelToken ?? ''
  };
}

/**
 * Build Docker arguments array
 */
function buildDockerArgs({
  containerName,
  entrypointScript,
  dockerImageName,
  envVars
}: {
  containerName: string;
  entrypointScript: string;
  dockerImageName: string;
  envVars: ClaudeEnvironmentVars;
}): string[] {
  const dockerArgs = ['run', '--rm'];

  // Apply container security constraints
  const securityConfig = getContainerSecurityConfig();
  applySecurityConstraints(dockerArgs, securityConfig);

  // Add container name
  dockerArgs.push('--name', containerName);

  // Add Claude authentication directory as a volume mount for syncing
  // This allows the entrypoint to copy auth files to a writable location
  const hostAuthDir = process.env.CLAUDE_AUTH_HOST_DIR;
  if (hostAuthDir) {
    // Resolve relative paths to absolute paths for Docker volume mounting
    const absoluteAuthDir = path.isAbsolute(hostAuthDir)
      ? hostAuthDir
      : path.resolve(process.cwd(), hostAuthDir);
    dockerArgs.push('-v', `${absoluteAuthDir}:/home/node/.claude`);
  }

  // Prepare MCP configuration for copying into container
  // Template file is mounted directly into the webhook container at /app/.mcp.json.template
  const mcpTemplatePath = path.resolve('/app', '.mcp.json.template');
  const mcpConfigPath = path.resolve('/app', '.mcp.json');
  
  logger.info({ 
    cwd: process.cwd(),
    mcpTemplatePath,
    mcpConfigPath,
    templateExists: fs.existsSync(mcpTemplatePath),
    configExists: fs.existsSync(mcpConfigPath)
  }, 'Checking for MCP configuration files');
  
  let mcpConfigContent = '';
  
  // Process MCP template if it exists
  if (fs.existsSync(mcpTemplatePath)) {
    logger.info('Found MCP template, processing with environment variables');
    const templateContent = fs.readFileSync(mcpTemplatePath, 'utf8');
    mcpConfigContent = processTemplate(templateContent, process.env);
    logger.info({ 
      templateLength: templateContent.length,
      processedLength: mcpConfigContent.length,
      hasDiscordToken: mcpConfigContent.includes('DISCORD_BOT_TOKEN'),
      hasGitHubToken: mcpConfigContent.includes('GITHUB_TOKEN')
    }, 'MCP template processed successfully');
  } else if (fs.existsSync(mcpConfigPath)) {
    logger.info('Found static MCP config file');
    mcpConfigContent = fs.readFileSync(mcpConfigPath, 'utf8');
  } else {
    logger.info('No MCP configuration found (neither .mcp.json.template nor .mcp.json)');
  }

  // Store MCP config content in environment variable for entrypoint to handle
  if (mcpConfigContent) {
    envVars.MCP_CONFIG_CONTENT = mcpConfigContent;
    logger.info({ configSize: mcpConfigContent.length }, 'MCP configuration will be copied by entrypoint script');
  }

  // Add environment variables as separate arguments
  Object.entries(envVars)
    .filter(([, value]) => value !== undefined && value !== '')
    .forEach(([key, value]) => {
      dockerArgs.push('-e', `${key}=${String(value)}`);
    });

  // Add the image name and custom entrypoint
  dockerArgs.push('--entrypoint', entrypointScript, dockerImageName);

  return dockerArgs;
}

/**
 * Get container security configuration
 */
function getContainerSecurityConfig(): ContainerSecurityConfig {
  const resourceLimits: ClaudeResourceLimits = {
    memory: process.env.CLAUDE_CONTAINER_MEMORY_LIMIT ?? '2g',
    cpuShares: process.env.CLAUDE_CONTAINER_CPU_SHARES ?? '1024',
    pidsLimit: process.env.CLAUDE_CONTAINER_PIDS_LIMIT ?? '256'
  };

  if (process.env.CLAUDE_CONTAINER_PRIVILEGED === 'true') {
    return {
      privileged: true,
      requiredCapabilities: [],
      optionalCapabilities: {},
      resourceLimits
    };
  }

  return {
    privileged: false,
    requiredCapabilities: ['NET_ADMIN', 'SYS_ADMIN'],
    optionalCapabilities: {
      NET_RAW: process.env.CLAUDE_CONTAINER_CAP_NET_RAW === 'true',
      SYS_TIME: process.env.CLAUDE_CONTAINER_CAP_SYS_TIME === 'true',
      DAC_OVERRIDE: process.env.CLAUDE_CONTAINER_CAP_DAC_OVERRIDE === 'true',
      AUDIT_WRITE: process.env.CLAUDE_CONTAINER_CAP_AUDIT_WRITE === 'true'
    },
    resourceLimits
  };
}

/**
 * Apply security constraints to Docker arguments
 */
function applySecurityConstraints(dockerArgs: string[], config: ContainerSecurityConfig): void {
  if (config.privileged) {
    dockerArgs.push('--privileged');
  } else {
    // Add required capabilities
    config.requiredCapabilities.forEach(cap => {
      dockerArgs.push(`--cap-add=${cap}`);
    });

    // Add optional capabilities if enabled
    Object.entries(config.optionalCapabilities).forEach(([cap, enabled]) => {
      if (enabled) {
        dockerArgs.push(`--cap-add=${cap}`);
      }
    });

    // Add resource limits
    dockerArgs.push(
      '--memory',
      config.resourceLimits.memory,
      '--cpu-shares',
      config.resourceLimits.cpuShares,
      '--pids-limit',
      config.resourceLimits.pidsLimit
    );
  }
}

/**
 * Sanitize Docker arguments for logging
 */
function sanitizeDockerArgs(dockerArgs: string[]): string[] {
  return dockerArgs.map(arg => {
    if (typeof arg !== 'string') return arg;

    // Check if this is an environment variable assignment
    const envMatch = arg.match(/^([A-Z_]+)=(.*)$/);
    if (envMatch) {
      const envKey = envMatch[1];
      const sensitiveKeys = [
        'GITHUB_TOKEN',
        'ANTHROPIC_API_KEY',
        'AWS_ACCESS_KEY_ID',
        'AWS_SECRET_ACCESS_KEY',
        'AWS_SESSION_TOKEN'
      ];
      if (sensitiveKeys.includes(envKey)) {
        return `${envKey}=[REDACTED]`;
      }
      // For the command, also redact to avoid logging the full command
      if (envKey === 'COMMAND') {
        return `${envKey}=[COMMAND_CONTENT]`;
      }
    }
    return arg;
  });
}

/**
 * Handle Docker execution errors
 */
function handleDockerExecutionError(
  error: unknown,
  context: {
    containerName: string;
    dockerArgs: string[];
    dockerImageName: string;
    githubToken: string;
    repoFullName: string;
    issueNumber: number | null;
  }
): never {
  const err = error as Error & { stderr?: string; stdout?: string; message: string };

  // Sanitize stderr and stdout to remove any potential credentials
  const sanitizeOutput = (output: string | undefined): string | undefined => {
    if (!output) return output;
    let sanitized = output.toString();

    // Sensitive values to redact
    const sensitiveValues = [
      context.githubToken,
      secureCredentials.get('ANTHROPIC_API_KEY')
    ].filter(val => val && val.length > 0);

    // Redact specific sensitive values first
    sensitiveValues.forEach(value => {
      if (value) {
        const stringValue = String(value);
        const escapedValue = stringValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        sanitized = sanitized.replace(new RegExp(escapedValue, 'g'), '[REDACTED]');
      }
    });

    // Then apply pattern-based redaction for any missed credentials
    const sensitivePatterns = [
      /AKIA[0-9A-Z]{16}/g, // AWS Access Key pattern
      /[a-zA-Z0-9/+=]{40}/g, // AWS Secret Key pattern
      /sk-[a-zA-Z0-9]{32,}/g, // API key pattern
      /github_pat_[a-zA-Z0-9_]{82}/g, // GitHub fine-grained token pattern
      /ghp_[a-zA-Z0-9]{36}/g // GitHub personal access token pattern
    ];

    sensitivePatterns.forEach(pattern => {
      sanitized = sanitized.replace(pattern, '[REDACTED]');
    });

    return sanitized;
  };

  // Check for specific error types
  const errorMsg = err.message;
  const errorOutput = err.stderr ? err.stderr.toString() : '';

  // Check if this is a docker image not found error
  if (errorOutput.includes('Unable to find image') || errorMsg.includes('Unable to find image')) {
    logger.error('Docker image not found. Attempting to rebuild...');
    try {
      execFileSync(
        'docker',
        ['build', '-f', 'Dockerfile.claudecode', '-t', context.dockerImageName, '.'],
        {
          cwd: path.join(__dirname, '../..'),
          stdio: 'pipe'
        }
      );
      logger.info('Successfully rebuilt Docker image');
    } catch (rebuildError) {
      logger.error(
        {
          error: (rebuildError as Error).message
        },
        'Failed to rebuild Docker image'
      );
    }
  }

  logger.error(
    {
      error: err.message,
      stderr: sanitizeOutput(err.stderr),
      stdout: sanitizeOutput(err.stdout),
      containerName: context.containerName,
      dockerArgs: context.dockerArgs
    },
    'Error running Claude Code container'
  );

  // Try to get container logs for debugging
  try {
    const logs = execFileSync('docker', ['logs', context.containerName], {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    logger.error({ containerLogs: logs }, 'Container logs');
  } catch (e) {
    logger.error({ error: (e as Error).message }, 'Failed to get container logs');
  }

  // Try to clean up the container if it's still running
  try {
    execFileSync('docker', ['kill', context.containerName], { stdio: 'ignore' });
  } catch {
    // Container might already be stopped
  }

  // Generate an error ID for log correlation
  const timestamp = new Date().toISOString();
  const errorId = `err-${Math.random().toString(36).substring(2, 10)}`;

  // Log the detailed error with full context
  const sanitizedStderr = sanitizeOutput(err.stderr);
  const sanitizedStdout = sanitizeOutput(err.stdout);

  logger.error(
    {
      errorId,
      timestamp,
      error: err.message,
      stderr: sanitizedStderr,
      stdout: sanitizedStdout,
      containerName: context.containerName,
      dockerArgs: context.dockerArgs,
      repo: context.repoFullName,
      issue: context.issueNumber
    },
    'Claude Code container execution failed (with error reference)'
  );

  // Throw a generic error with reference ID, but without sensitive details
  const errorMessage = sanitizeBotMentions(
    `Error executing Claude command (Reference: ${errorId}, Time: ${timestamp})`
  );

  throw new Error(errorMessage);
}

/**
 * Handle general service errors
 */
function handleGeneralError(
  error: unknown,
  context: { repoFullName: string; issueNumber: number | null }
): never {
  const err = error as Error;

  // Sanitize the error message to remove any credentials
  const sanitizeMessage = (message: string): string => {
    if (!message) return message;
    let sanitized = message;
    const sensitivePatterns = [
      /AWS_ACCESS_KEY_ID="[^"]+"/g,
      /AWS_SECRET_ACCESS_KEY="[^"]+"/g,
      /AWS_SESSION_TOKEN="[^"]+"/g,
      /GITHUB_TOKEN="[^"]+"/g,
      /ANTHROPIC_API_KEY="[^"]+"/g,
      /AKIA[0-9A-Z]{16}/g, // AWS Access Key pattern
      /[a-zA-Z0-9/+=]{40}/g, // AWS Secret Key pattern
      /sk-[a-zA-Z0-9]{32,}/g, // API key pattern
      /github_pat_[a-zA-Z0-9_]{82}/g, // GitHub fine-grained token pattern
      /ghp_[a-zA-Z0-9]{36}/g // GitHub personal access token pattern
    ];

    sensitivePatterns.forEach(pattern => {
      sanitized = sanitized.replace(pattern, '[REDACTED]');
    });
    return sanitized;
  };

  logger.error(
    {
      err: {
        message: sanitizeMessage(err.message),
        stack: sanitizeMessage(err.stack ?? '')
      },
      repo: context.repoFullName,
      issue: context.issueNumber
    },
    'Error processing command with Claude'
  );

  // Generate an error ID for log correlation
  const timestamp = new Date().toISOString();
  const errorId = `err-${Math.random().toString(36).substring(2, 10)}`;

  // Log the sanitized error with its ID for correlation
  const sanitizedErrorMessage = sanitizeMessage(err.message);
  const sanitizedErrorStack = err.stack ? sanitizeMessage(err.stack) : null;

  logger.error(
    {
      errorId,
      timestamp,
      error: sanitizedErrorMessage,
      stack: sanitizedErrorStack,
      repo: context.repoFullName,
      issue: context.issueNumber
    },
    'General error in Claude service (with error reference)'
  );

  // Throw a generic error with reference ID, but without sensitive details
  const errorMessage = sanitizeBotMentions(
    `Error processing Claude command (Reference: ${errorId}, Time: ${timestamp})`
  );

  throw new Error(errorMessage);
}
