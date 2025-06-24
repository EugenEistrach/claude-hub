// Note: tweetnacl is required for Discord Ed25519 signature verification
// Install with: npm install tweetnacl @types/tweetnacl
import nacl from 'tweetnacl';
import { processCommand, generateClaudePrompt } from '../services/claudeService';
import {
  parseDiscordCommand,
  createOperationStartEmbed,
  createOperationStatusEmbed,
  sendChannelMessage,
  editInteractionResponse
} from '../services/discordService';
import {
  discordOperationTracker,
  type PendingDiscordOperation
} from '../services/discordOperationTracker';
import { createLogger } from '../utils/logger';
import secureCredentials from '../utils/secureCredentials';
import { promptStorage } from '../services/promptStorage';
import type { Response } from 'express';
import type { DiscordWebhookRequest, DiscordWebhookHandler } from '../types/discord-express';
import type { DiscordInteractionPayload, DiscordInteractionResponse } from '../types/discord';
import { InteractionType, InteractionResponseType } from '../types/discord';

const logger = createLogger('discordController');

// Get Discord configuration from environment
const DISCORD_PUBLIC_KEY = process.env['DISCORD_PUBLIC_KEY'];
const DISCORD_APPLICATION_ID = process.env['DISCORD_APPLICATION_ID'];

// Validate Discord configuration
if (!DISCORD_PUBLIC_KEY || !DISCORD_APPLICATION_ID) {
  logger.error(
    'DISCORD_PUBLIC_KEY and DISCORD_APPLICATION_ID environment variables are required for Discord integration'
  );
}

/**
 * Verifies that the interaction came from Discord using Ed25519 signature
 */
function verifyDiscordSignature(req: DiscordWebhookRequest): boolean {
  try {
    const signature = req.get('x-signature-ed25519');
    const timestamp = req.get('x-signature-timestamp');

    if (!signature || !timestamp) {
      logger.warn('No signature or timestamp found in Discord interaction request');
      return false;
    }

    // Get public key from secure credentials or environment
    const publicKey = secureCredentials.get('DISCORD_PUBLIC_KEY') ?? DISCORD_PUBLIC_KEY;
    if (!publicKey) {
      logger.error('DISCORD_PUBLIC_KEY not found in secure credentials or environment');
      return false;
    }

    // Reconstruct the signed message
    const body = req.rawBody ?? JSON.stringify(req.body);
    const message = timestamp + body;

    // Verify the signature using Ed25519
    try {
      const isValid = nacl.sign.detached.verify(
        Buffer.from(message),
        Buffer.from(signature, 'hex'),
        Buffer.from(publicKey, 'hex')
      );

      if (!isValid) {
        logger.warn('Discord signature verification failed');
      }

      return isValid;
    } catch (error) {
      logger.error({ err: error }, 'Error during signature verification');
      return false;
    }
  } catch (error) {
    logger.error({ err: error }, 'Error verifying Discord signature');
    return false;
  }
}

/**
 * Handles incoming Discord interaction webhooks
 */
export const handleDiscordWebhook: DiscordWebhookHandler = (req, res) => {
  try {
    // Validate request body structure
    const bodyType = Object.prototype.toString.call(req.body);
    if (bodyType !== '[object Object]') {
      logger.error('Discord webhook request missing or invalid body structure');
      return res.status(400).json({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: '❌ Invalid request format.',
          flags: 64 // Ephemeral
        }
      });
    }

    // Verify the webhook signature
    if (!verifyDiscordSignature(req)) {
      logger.warn('Discord webhook verification failed');
      return res.status(401).json({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: '❌ Invalid request signature.',
          flags: 64 // Ephemeral
        }
      });
    }

    const payload = req.body;

    logger.info(
      {
        interactionId: payload.id,
        type: payload.type,
        user: payload.user?.username ?? payload.member?.user?.username ?? 'unknown',
        guild: payload.guild_id ?? 'DM',
        command: payload.data?.name,
        hasOptions: !!payload.data?.options,
        optionsCount: payload.data?.options?.length ?? 0
      },
      'Received Discord interaction'
    );

    // Handle PING interactions (Discord verification)
    if (payload.type === InteractionType.PING) {
      logger.info('Responding to Discord PING verification');
      return res.json({
        type: InteractionResponseType.PONG
      });
    }

    // Handle APPLICATION_COMMAND interactions
    if (payload.type === InteractionType.APPLICATION_COMMAND) {
      return handleApplicationCommand(payload, res);
    }

    // Other interaction types not supported yet
    logger.warn({ type: payload.type }, 'Unsupported Discord interaction type');
    return res.json({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: 'This interaction type is not supported yet.',
        flags: 64 // Ephemeral
      }
    });
  } catch (error) {
    return handleDiscordWebhookError(error, res);
  }
};

/**
 * Handle Discord application commands (slash commands)
 */
function handleApplicationCommand(
  payload: DiscordInteractionPayload,
  res: Response<DiscordInteractionResponse>
): Response<DiscordInteractionResponse> {
  try {
    // Check if user is authorized
    const user = payload.user ?? payload.member?.user;
    if (!user) {
      logger.error('No user information in Discord interaction');
      return res.json({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: '❌ Unable to identify user.',
          flags: 64 // Ephemeral
        }
      });
    }

    // Check authorization
    const authorizedUsers = process.env.DISCORD_AUTHORIZED_USERS
      ? process.env.DISCORD_AUTHORIZED_USERS.split(',').map(id => id.trim())
      : [];

    if (authorizedUsers.length > 0 && !authorizedUsers.includes(user.id)) {
      logger.info(
        {
          userId: user.id,
          username: user.username,
          command: payload.data?.name
        },
        'Unauthorized user attempted to use Discord command'
      );

      return res.json({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: `❌ Sorry <@${user.id}>, you are not authorized to use Claude commands.`,
          flags: 64 // Ephemeral
        }
      });
    }

    // Parse the command
    const commandData = payload.data;
    if (!commandData) {
      logger.error('No command data in Discord interaction');
      return res.json({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: '❌ Invalid command data.',
          flags: 64 // Ephemeral
        }
      });
    }

    // Parse the command to extract repository and options
    const parsedCommand = parseDiscordCommand(payload);

    // Debug log the parsed command
    logger.info(
      {
        parsedCommand: {
          commandName: parsedCommand.commandName,
          repository: parsedCommand.repository,
          commandText: parsedCommand.commandText,
          options: parsedCommand.options
        }
      },
      'Parsed Discord command'
    );

    // Generate operation ID and start tracking
    const operationId = discordOperationTracker.generateOperationId();

    const operation: PendingDiscordOperation = {
      operationId,
      userId: user.id,
      channelId: payload.channel_id ?? '',
      guildId: payload.guild_id,
      username: user.username,
      command: parsedCommand.commandText,
      repository: parsedCommand.repository?.fullName, // Optional - undefined for general commands
      startTime: new Date(),
      interactionId: payload.id
    };

    discordOperationTracker.startOperation(operation);

    // Generate the prompt early so we can show it in the initial embed
    const commandOptions = {
      repoFullName: operation.repository,
      issueNumber: operation.repository ? 0 : undefined,
      command: parsedCommand.commandText,
      isPullRequest: false,
      branchName: null
    };

    const fullPrompt = generateClaudePrompt(commandOptions);
    operation.fullPrompt = fullPrompt;

    // Store the prompt for web access
    promptStorage.set(operationId, {
      prompt: fullPrompt,
      timestamp: Date.now(),
      operationId
    });

    // Log command execution
    logger.info(
      {
        operationId,
        userId: user.id,
        username: user.username,
        command: commandData.name,
        repository: operation.repository ?? 'general'
      },
      'Starting Discord Claude operation'
    );

    // Send immediate response with operation details and capture for editing later
    res.json({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        embeds: [
          createOperationStartEmbed(
            operationId,
            parsedCommand.commandText,
            operation.repository,
            fullPrompt
          )
        ]
      }
    });

    // Process the command asynchronously - will edit the original interaction response
    processDiscordOperationAsync(operationId, payload).catch(error => {
      logger.error({ operationId, err: error }, 'Error in async Discord operation processing');
    });

    return res;
  } catch (error) {
    const err = error as Error;
    logger.error({ err }, 'Error handling Discord application command');

    return res.json({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: '❌ An error occurred while processing your command.',
        flags: 64 // Ephemeral
      }
    });
  }
}

/**
 * Process Discord operation asynchronously using operation tracker
 */
async function processDiscordOperationAsync(
  operationId: string,
  payload: DiscordInteractionPayload
): Promise<void> {
  const operation = discordOperationTracker.getOperation(operationId);
  if (!operation) {
    logger.error({ operationId }, 'Operation not found for processing');
    return;
  }

  try {
    logger.info(
      {
        operationId,
        repository: operation.repository,
        userId: operation.userId,
        command: operation.command
      },
      'Starting Claude processing for Discord operation'
    );

    // Generate the prompt for debugging
    const commandOptions = {
      repoFullName: operation.repository, // Optional - undefined for general commands
      issueNumber: operation.repository ? 0 : undefined, // Only set for repository commands
      command: operation.command,
      isPullRequest: false,
      branchName: null
    };

    const fullPrompt = generateClaudePrompt(commandOptions);

    // Store the prompt in the operation for debugging
    operation.fullPrompt = fullPrompt;

    // Use existing Claude service - same as GitHub!
    const claudeResponse = await processCommand(commandOptions);

    const duration = Date.now() - operation.startTime.getTime();

    // Edit the original interaction response with simple completion status
    await editInteractionResponse({
      applicationId: DISCORD_APPLICATION_ID ?? '',
      interactionToken: payload.token,
      content: `<@${operation.userId}>`,
      embeds: [
        createOperationStatusEmbed(
          operation.operationId,
          operation.command,
          operation.repository,
          true,
          duration,
          operation.fullPrompt
        )
      ]
    });

    // Send the actual result as a follow-up message (no code blocks, just raw response)
    await sendChannelMessage({
      channelId: operation.channelId,
      content: claudeResponse,
      operationId: operation.operationId
    });

    logger.info(
      {
        operationId,
        userId: operation.userId,
        repository: operation.repository,
        duration
      },
      'Discord operation completed successfully'
    );
  } catch (error) {
    const err = error as Error;

    logger.error(
      {
        operationId,
        err: err.message,
        userId: operation.userId,
        repository: operation.repository
      },
      'Discord operation failed'
    );

    const duration = Date.now() - operation.startTime.getTime();

    // Edit the original interaction response with error status
    try {
      await editInteractionResponse({
        applicationId: DISCORD_APPLICATION_ID ?? '',
        interactionToken: payload.token,
        content: `<@${operation.userId}>`,
        embeds: [
          createOperationStatusEmbed(
            operation.operationId,
            operation.command,
            operation.repository,
            false,
            duration,
            operation.fullPrompt
          )
        ]
      });

      // Send the error message as a follow-up
      // Ensure error message doesn't exceed Discord limit
      const errorMessage = err.message.length > 1900 
        ? `❌ **Error:** ${err.message.substring(0, 1900)}...`
        : `❌ **Error:** ${err.message}`;
        
      await sendChannelMessage({
        channelId: operation.channelId,
        content: errorMessage,
        operationId: operation.operationId
      });
    } catch (notificationError) {
      logger.error(
        {
          operationId,
          err: notificationError
        },
        'Failed to edit interaction response with error status'
      );
    }
  } finally {
    // Clean up operation tracking
    discordOperationTracker.completeOperation(operationId);
  }
}

/**
 * Handle general Discord webhook errors
 */
function handleDiscordWebhookError(
  error: unknown,
  res: Response<DiscordInteractionResponse>
): Response<DiscordInteractionResponse> {
  const err = error as Error;

  // Generate a unique error reference
  const timestamp = new Date().toISOString();
  const errorId = `discord-err-${Math.random().toString(36).substring(2, 10)}`;

  // Log detailed error with reference
  logger.error(
    {
      errorId,
      timestamp,
      err: {
        message: err.message,
        stack: err.stack
      }
    },
    'Error handling Discord webhook (with error reference)'
  );

  // Return Discord-compatible error response
  return res.status(500).json({
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      content: `❌ An error occurred (${errorId}). Please try again or contact support.`,
      flags: 64 // Ephemeral
    }
  });
}
