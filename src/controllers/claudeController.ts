import type { Request, Response } from 'express';
import { processCommand } from '../services/claudeService';
import { createLogger } from '../utils/logger';
import { sanitizeBotMentions } from '../utils/sanitize';
import { generateSessionLinks, getBaseUrl } from '../utils/sessionUrls';
import type { EnhancedClaudeResponse } from '../types/responses';

const logger = createLogger('claudeController');

// Maximum command length to prevent abuse
const MAX_COMMAND_LENGTH = 10000;

interface ExecuteRequest {
  command: string;
  repo?: string;
  sessionId?: string;
  template?: string;
}

/**
 * Execute a Claude command via API
 * POST /api/claude/execute
 *
 * Security:
 * - Requires Bearer token authentication
 * - Input validation and sanitization
 * - Rate limited by Express middleware
 */
export async function executeCommand(req: Request, res: Response): Promise<void> {
  try {
    // Check authorization header
    const authHeader = req.headers.authorization;
    const expectedToken = process.env.CLAUDE_API_SECRET;

    if (!expectedToken) {
      logger.error('CLAUDE_API_SECRET not configured');
      res.status(500).json({
        error: 'Internal server error',
        message: 'API authentication not configured'
      });
      return;
    }

    if (!authHeader?.startsWith('Bearer ')) {
      logger.warn('Missing or invalid authorization header');
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Missing or invalid authorization header'
      });
      return;
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix
    if (token !== expectedToken) {
      logger.warn('Invalid API token attempt');
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid API token'
      });
      return;
    }

    // Validate request body
    const { command, repo, sessionId, template } = req.body as ExecuteRequest;

    if (!command || typeof command !== 'string') {
      res.status(400).json({
        error: 'Bad Request',
        message: 'Missing or invalid command in request body'
      });
      return;
    }

    if (command.length > MAX_COMMAND_LENGTH) {
      res.status(400).json({
        error: 'Bad Request',
        message: `Command exceeds maximum length of ${MAX_COMMAND_LENGTH} characters`
      });
      return;
    }

    // Sanitize command to prevent bot mention loops
    const sanitizedCommand = sanitizeBotMentions(command);

    logger.info(
      {
        commandLength: sanitizedCommand.length,
        ip: req.ip
      },
      'Processing Claude API execute request'
    );

    // Execute command with optional repository context
    const result = await processCommand({
      command: sanitizedCommand,
      repoFullName: repo,
      sessionId,
      template,
      operationType: 'default'
    });

    // Handle execution result
    if (!result.success) {
      res.status(500).json({
        status: 'error',
        sessionId: result.sessionId,
        error: result.error ?? 'Command execution failed',
        metadata: {
          commandLength: sanitizedCommand.length,
          timestamp: new Date().toISOString()
        }
      } as EnhancedClaudeResponse);
      return;
    }

    // Generate session links
    const baseUrl = getBaseUrl(req);
    const links = generateSessionLinks(result.sessionId, baseUrl, result.sessionPath);

    // Return successful response with session links
    const response: EnhancedClaudeResponse = {
      status: 'success',
      sessionId: result.sessionId,
      result: result.response,
      links,
      metadata: {
        commandLength: sanitizedCommand.length,
        timestamp: new Date().toISOString()
      }
    };

    res.json(response);
  } catch (error) {
    logger.error(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      },
      'Error executing Claude command via API'
    );

    // Return detailed error information
    const errorResponse: EnhancedClaudeResponse = {
      status: 'error',
      sessionId: 'error-' + Date.now(),
      error: 'Internal Server Error',
      message: error instanceof Error ? error.message : 'An unexpected error occurred',
      metadata: {
        timestamp: new Date().toISOString()
      }
    };

    res.status(500).json(errorResponse);
  }
}
