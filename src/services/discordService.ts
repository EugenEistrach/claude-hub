import type { AxiosInstance } from 'axios';
import axios from 'axios';
import { createLogger } from '../utils/logger';
import secureCredentials from '../utils/secureCredentials';
import { responseStorage } from './responseStorage';
import type {
  DiscordInteractionPayload,
  DiscordEmbed,
  DiscordWebhookMessage,
  DiscordAPIMessage,
  CreateDiscordResponseRequest,
  EditDiscordResponseRequest,
  CreateFollowupMessageRequest,
  ParsedDiscordCommand,
  DiscordRepositoryContext,
  ApplicationCommandInteractionDataOption,
  DiscordAPIError
} from '../types/discord';
import { DiscordMessageFlags } from '../types/discord';

const logger = createLogger('discordService');

// Discord API base URL
const DISCORD_API_BASE = 'https://discord.com/api/v10';

// Create axios instance for Discord API
let discordClient: AxiosInstance | null = null;

function getDiscordClient(): AxiosInstance {
  if (!discordClient) {
    const botToken = secureCredentials.get('DISCORD_BOT_TOKEN') ?? process.env.DISCORD_BOT_TOKEN;

    discordClient = axios.create({
      baseURL: DISCORD_API_BASE,
      headers: {
        Authorization: botToken ? `Bot ${botToken}` : '',
        'Content-Type': 'application/json',
        'User-Agent': 'Claude-Discord-Integration/1.0'
      },
      timeout: 15000 // 15 second timeout
    });

    // Add response interceptor for error logging
    discordClient.interceptors.response.use(
      response => response,
      error => {
        logger.error(
          {
            method: error.config?.method,
            url: error.config?.url,
            status: error.response?.status,
            data: error.response?.data
          },
          'Discord API request failed'
        );
        return Promise.reject(error);
      }
    );
  }

  return discordClient;
}

/**
 * Create an initial interaction response
 */
export function createInteractionResponse({
  content,
  embeds,
  ephemeral = false
}: CreateDiscordResponseRequest): void {
  try {
    // This would normally be sent as the immediate response to the webhook
    // Since we use deferred responses, this function is mostly for reference
    logger.info(
      {
        hasContent: !!content,
        embedCount: embeds?.length ?? 0,
        ephemeral
      },
      'Would create interaction response (using deferred pattern instead)'
    );
  } catch (error) {
    logger.error({ err: error }, 'Error creating interaction response');
    throw error;
  }
}

/**
 * Edit the original interaction response
 */
export async function editInteractionResponse({
  applicationId,
  interactionToken,
  content,
  embeds,
  components
}: EditDiscordResponseRequest): Promise<void> {
  try {
    // Validate content length
    let finalContent = content;
    if (content && content.length > 2000) {
      logger.warn(
        {
          originalLength: content.length,
          applicationId
        },
        'Interaction response content exceeds limit, truncating'
      );
      finalContent = content.substring(0, 1997) + '...';
    }

    const client = getDiscordClient();

    const webhookMessage: DiscordWebhookMessage = {
      content: finalContent,
      embeds,
      components
    };

    await client.patch(
      `/webhooks/${applicationId}/${interactionToken}/messages/@original`,
      webhookMessage
    );

    logger.info(
      {
        applicationId,
        hasContent: !!finalContent,
        embedCount: embeds?.length ?? 0,
        contentLength: finalContent?.length ?? 0
      },
      'Edited interaction response successfully'
    );
  } catch (error) {
    const err = error as Error & {
      response?: { status?: number; statusText?: string; data?: unknown };
    };
    logger.error(
      {
        err: err.message,
        applicationId,
        status: err.response?.status,
        statusText: err.response?.statusText,
        data: err.response?.data
      },
      'Failed to edit interaction response'
    );

    // If it's a 404, the interaction might have expired or been deleted
    if (err.response?.status === 404) {
      throw new Error(`Discord interaction not found (404) - it may have expired or been deleted`);
    }

    throw new Error(`Failed to edit Discord response: ${err.message}`);
  }
}

/**
 * Create a followup message for an interaction
 */
export async function createFollowupMessage({
  applicationId,
  interactionToken,
  content,
  embeds,
  ephemeral = false,
  components
}: CreateFollowupMessageRequest): Promise<DiscordAPIMessage> {
  try {
    const client = getDiscordClient();

    const webhookMessage: DiscordWebhookMessage = {
      content,
      embeds,
      components,
      flags: ephemeral ? DiscordMessageFlags.EPHEMERAL : undefined
    };

    const response = await client.post(
      `/webhooks/${applicationId}/${interactionToken}`,
      webhookMessage
    );

    logger.info(
      {
        applicationId,
        hasContent: !!content,
        embedCount: embeds?.length ?? 0,
        ephemeral
      },
      'Created followup message successfully'
    );

    return response.data;
  } catch (error) {
    const err = error as Error;
    logger.error(
      {
        err: err.message,
        applicationId
      },
      'Failed to create followup message'
    );
    throw new Error(`Failed to create Discord followup: ${err.message}`);
  }
}

/**
 * Parse Discord command and extract repository context
 */
export function parseDiscordCommand(payload: DiscordInteractionPayload): ParsedDiscordCommand {
  const commandData = payload.data;
  if (!commandData) {
    throw new Error('No command data in payload');
  }

  const commandName = commandData.name;
  const options: Record<string, string | number | boolean> = {};
  let repository: DiscordRepositoryContext | undefined;
  let issueNumber: number | undefined;
  let branchName: string | undefined;
  let commandText = '';

  // Extract options from command
  if (commandData.options) {
    logger.debug(
      {
        commandName,
        optionsCount: commandData.options.length,
        rawOptions: commandData.options
      },
      'Processing Discord command options'
    );
    for (const option of commandData.options) {
      processCommandOption(option, options);
    }
    logger.debug({ extractedOptions: options }, 'Extracted options from Discord command');
  }

  // Extract repository from 'repo' option
  if (options.repo && typeof options.repo === 'string') {
    let repoString = options.repo;

    // Handle GitHub URLs
    const githubUrlMatch = repoString.match(/github\.com\/([^/]+)\/([^/\s]+)/);
    if (githubUrlMatch) {
      repository = {
        owner: githubUrlMatch[1],
        name: githubUrlMatch[2].replace(/\.git$/, ''), // Remove .git if present
        fullName: `${githubUrlMatch[1]}/${githubUrlMatch[2].replace(/\.git$/, '')}`
      };
    } else {
      // Handle owner/repo format
      const repoParts = repoString.split('/');
      if (repoParts.length === 2) {
        repository = {
          owner: repoParts[0],
          name: repoParts[1],
          fullName: repoString
        };
      } else if (repoParts.length === 1) {
        // Assume it's just the repo name, try to get owner from environment
        const defaultOwner = process.env.DEFAULT_REPO_OWNER ?? process.env.GITHUB_OWNER;
        if (defaultOwner) {
          repository = {
            owner: defaultOwner,
            name: repoParts[0],
            fullName: `${defaultOwner}/${repoParts[0]}`
          };
        }
      }
    }
    logger.debug({ repository, repoString }, 'Extracted repository from Discord command');
  } else {
    logger.debug(
      {
        hasRepoOption: 'repo' in options,
        repoType: typeof options.repo,
        repoValue: options.repo
      },
      'No repository found in Discord command options'
    );
  }

  // Extract issue/PR number
  if (options.issue && typeof options.issue === 'number') {
    issueNumber = options.issue;
  } else if (options.pr && typeof options.pr === 'number') {
    issueNumber = options.pr;
  }

  // Extract branch name
  if (options.branch && typeof options.branch === 'string') {
    branchName = options.branch;
  }

  // Extract command text
  if (options.command && typeof options.command === 'string') {
    commandText = options.command;
  } else if (options.query && typeof options.query === 'string') {
    commandText = options.query;
  } else if (options.prompt && typeof options.prompt === 'string') {
    commandText = options.prompt;
  }

  // If no explicit command text, build it from the command name and options
  if (!commandText) {
    commandText = buildCommandText(commandName, options, issueNumber);
  }

  return {
    commandName,
    repository,
    issueNumber,
    branchName,
    commandText,
    options
  };
}

/**
 * Process command option recursively
 */
function processCommandOption(
  option: ApplicationCommandInteractionDataOption,
  options: Record<string, string | number | boolean>
): void {
  if (option.value !== undefined) {
    options[option.name] = option.value;
  }

  // Process sub-options for sub-commands
  if (option.options) {
    for (const subOption of option.options) {
      processCommandOption(subOption, options);
    }
  }
}

/**
 * Build command text from command name and options
 */
function buildCommandText(
  commandName: string,
  options: Record<string, string | number | boolean>,
  issueNumber?: number
): string {
  // Handle specific command types
  switch (commandName) {
    case 'review':
    case 'pr-review':
      if (issueNumber) {
        return `Review PR #${issueNumber}`;
      }
      return 'Review this pull request';

    case 'issue':
      if (options.action === 'tag' || options.action === 'label') {
        return `Auto-tag issue #${issueNumber ?? 'this issue'}`;
      }
      return `Process issue #${issueNumber ?? 'this issue'}`;

    case 'help':
      return 'Show help for using Claude in this repository';

    default:
      return `Execute ${commandName} command`;
  }
}

/**
 * Create a success embed for Discord
 */
export function createSuccessEmbed(title: string, description?: string): DiscordEmbed {
  return {
    title: `✅ ${title}`,
    description,
    color: 0x00ff00, // Green
    timestamp: new Date().toISOString()
  };
}

/**
 * Create an error embed for Discord
 */
export function createErrorEmbed(description: string): DiscordEmbed {
  return {
    title: '❌ Error',
    description,
    color: 0xff0000, // Red
    timestamp: new Date().toISOString()
  };
}

/**
 * Create a processing embed for Discord
 */
export function createProcessingEmbed(repository: string, command: string): DiscordEmbed {
  return {
    title: '⏳ Processing Command',
    description: `Processing your request for **${repository}**...`,
    fields: [
      {
        name: 'Command',
        value: command.length > 100 ? command.substring(0, 97) + '...' : command,
        inline: false
      }
    ],
    color: 0xffff00, // Yellow
    timestamp: new Date().toISOString(),
    footer: {
      text: 'This may take a moment...'
    }
  };
}

/**
 * Create a code block embed for Discord
 */
export function createCodeBlockEmbed(
  title: string,
  code: string,
  language = 'typescript'
): DiscordEmbed {
  // Discord embed descriptions have a 4096 character limit
  const truncatedCode = code.length > 4000 ? code.substring(0, 3997) + '...' : code;

  return {
    title,
    description: `\`\`\`${language}\n${truncatedCode}\n\`\`\``,
    color: 0x2f3136, // Dark gray
    timestamp: new Date().toISOString()
  };
}

/**
 * Format repository information as Discord embed
 */
export function createRepositoryEmbed(repository: DiscordRepositoryContext): DiscordEmbed {
  return {
    title: '📁 Repository Information',
    fields: [
      {
        name: 'Repository',
        value: repository.fullName,
        inline: true
      },
      {
        name: 'Owner',
        value: repository.owner,
        inline: true
      },
      {
        name: 'Name',
        value: repository.name,
        inline: true
      }
    ],
    color: 0x5865f2, // Discord blurple
    timestamp: new Date().toISOString()
  };
}

/**
 * Check rate limits from Discord API response headers
 */
export function checkDiscordRateLimits(headers: Record<string, unknown>): void {
  const remaining = headers['x-ratelimit-remaining'];
  const reset = headers['x-ratelimit-reset'];

  if (remaining !== undefined && Number(remaining) < 5) {
    logger.warn(
      {
        remaining,
        resetAt: reset ? new Date(Number(reset) * 1000).toISOString() : 'unknown'
      },
      'Discord API rate limit warning'
    );
  }
}

/**
 * Get repository context from Discord channel or message
 * This could be enhanced to store repo associations per channel/guild
 */
export function getRepositoryContext(
  guildId?: string,
  channelId?: string
): DiscordRepositoryContext | null {
  // This is a placeholder for future enhancement
  // Could store guild/channel -> repository mappings in a database
  // For now, return null and require explicit repo specification
  logger.debug(
    {
      guildId,
      channelId
    },
    'Repository context lookup not implemented - requiring explicit specification'
  );

  return null;
}

/**
 * Send message to Discord channel (for completion notifications)
 */
export async function sendChannelMessage({
  channelId,
  content,
  embeds,
  operationId
}: {
  channelId: string;
  content?: string;
  embeds?: DiscordEmbed[];
  operationId?: string;
}): Promise<DiscordAPIMessage> {
  try {
    // Pre-send validation
    if (!content && (!embeds || embeds.length === 0)) {
      throw new Error('Cannot send empty Discord message - must have content or embeds');
    }

    // Discord message length limit is 2000 characters
    const MAX_CONTENT_LENGTH = 2000;
    let finalContent = content;
    
    if (content && content.length > MAX_CONTENT_LENGTH) {
      logger.warn(
        {
          originalLength: content.length,
          channelId
        },
        'Discord message content exceeds limit, storing and linking'
      );
      
      // Generate unique ID for this response
      const responseId = `resp-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
      
      // Store the full response
      responseStorage.set(responseId, {
        content,
        timestamp: Date.now(),
        operationId: operationId ?? responseId,
        channelId
      });
      
      // Create a link to the full response
      const webhookUrl = process.env.WEBHOOK_URL ?? `http://localhost:${process.env.PORT ?? 3002}`;
      const responseUrl = `${webhookUrl}/responses/${responseId}`;
      
      // Create a summary message with link
      finalContent = `The response was too long for Discord (${content.length} characters). You can view the full response here:\n\n📄 **[View Full Response](${responseUrl})**\n\n**Summary:** ${content.substring(0, 500)}...`;
    }

    const client = getDiscordClient();

    const message = {
      content: finalContent,
      embeds
    };

    const response = await client.post(`/channels/${channelId}/messages`, message);

    logger.info(
      {
        channelId,
        hasContent: !!finalContent,
        embedCount: embeds?.length ?? 0,
        contentLength: finalContent?.length ?? 0
      },
      'Sent Discord channel message successfully'
    );

    return response.data;
  } catch (error) {
    const axiosError = error as Error & {
      response?: {
        status?: number;
        statusText?: string;
        data?: DiscordAPIError;
      };
    };
    const isDiscordError = axiosError.response?.status !== undefined && 
                           axiosError.response.status >= 400 && 
                           axiosError.response.status < 500;
    
    // Log detailed error information
    logger.error(
      {
        err: axiosError.message,
        channelId,
        status: axiosError.response?.status,
        statusText: axiosError.response?.statusText,
        // Discord-specific error info (not sensitive)
        discordErrorCode: axiosError.response?.data?.code,
        discordErrorMessage: axiosError.response?.data?.message
      },
      'Failed to send Discord channel message'
    );

    // Log content preview separately for debugging (first 200 chars)
    if (content) {
      logger.error(
        {
          contentPreview: content.substring(0, 200) + (content.length > 200 ? '...' : ''),
          contentLength: content.length,
          channelId
        },
        'Discord message content preview for debugging'
      );
    }

    if (isDiscordError && axiosError.response?.data?.message) {
      throw new Error(`Discord API error: ${axiosError.response.data.message}`);
    }
    
    throw new Error(`Failed to send Discord message: ${axiosError.message}`);
  }
}

/**
 * Edit a Discord message (for updating operation status)
 */
export async function editChannelMessage({
  channelId,
  messageId,
  content,
  embeds
}: {
  channelId: string;
  messageId: string;
  content?: string;
  embeds?: DiscordEmbed[];
}): Promise<DiscordAPIMessage> {
  try {
    const client = getDiscordClient();

    const message = {
      content,
      embeds
    };

    const response = await client.patch(`/channels/${channelId}/messages/${messageId}`, message);

    logger.info(
      {
        channelId,
        messageId,
        hasContent: !!content,
        embedCount: embeds?.length ?? 0
      },
      'Edited Discord channel message successfully'
    );

    return response.data;
  } catch (error) {
    const err = error as Error;
    logger.error(
      {
        err: err.message,
        channelId,
        messageId
      },
      'Failed to edit Discord channel message'
    );
    throw new Error(`Failed to edit Discord message: ${err.message}`);
  }
}

/**
 * Create operation start embed
 */
export function createOperationStartEmbed(
  operationId: string,
  command: string,
  _repository?: string,
  _fullPrompt?: string
): DiscordEmbed {
  // Get the webhook URL from environment
  const webhookUrl = process.env.WEBHOOK_URL ?? `http://localhost:${process.env.PORT ?? 3002}`;
  const promptUrl = `${webhookUrl}/prompts/${operationId}`;

  // Truncate command if too long (Discord embed description limit is 4096)
  // Reserve space for the rest of the description (~100 chars)
  const maxCommandLength = 3900;
  const displayCommand = command.length > maxCommandLength 
    ? command.substring(0, maxCommandLength) + '...' 
    : command;

  return {
    title: '🚀 Processing Claude Command',
    description: `ID: \`${operationId}\` • Status: **Running**\n\n**Command:**\n\`\`\`\n${displayCommand}\n\`\`\`\n\n[📋 View Full Prompt](${promptUrl})`,
    color: 0xffff00, // Yellow
    timestamp: new Date().toISOString()
  };
}

/**
 * Create operation status update embed
 */
export function createOperationStatusEmbed(
  operationId: string,
  command: string,
  _repository: string | undefined,
  success: boolean,
  duration?: number,
  _fullPrompt?: string
): DiscordEmbed {
  // Get the webhook URL from environment
  const webhookUrl = process.env.WEBHOOK_URL ?? `http://localhost:${process.env.PORT ?? 3002}`;
  const promptUrl = `${webhookUrl}/prompts/${operationId}`;

  // Add duration to the status line if provided
  let statusLine = `ID: \`${operationId}\` • Status: **${success ? 'Success' : 'Failed'}**`;
  if (duration) {
    const seconds = Math.floor(duration / 1000);
    const minutes = Math.floor(seconds / 60);
    const durationText = minutes > 0 ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
    statusLine += ` • Duration: **${durationText}**`;
  }

  // Truncate command if too long (Discord embed description limit is 4096)
  // Reserve space for the rest of the description (~200 chars for status + prompt link)
  const maxCommandLength = 3800;
  const displayCommand = command.length > maxCommandLength 
    ? command.substring(0, maxCommandLength) + '...' 
    : command;

  return {
    title: success ? '✅ Command Completed' : '❌ Command Failed',
    description: `${statusLine}\n\n**Command:**\n\`\`\`\n${displayCommand}\n\`\`\`\n\n[📋 View Full Prompt](${promptUrl})`,
    color: success ? 0x00ff00 : 0xff0000, // Green or Red
    timestamp: new Date().toISOString()
  };
}

// Note: createResultEmbed has been deprecated in favor of sending raw messages
// The function below is kept for reference but should not be used
