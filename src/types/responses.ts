import type { SessionLinks } from '../utils/sessionUrls';

/**
 * Enhanced Claude API response with session links
 */
export interface EnhancedClaudeResponse {
  status: 'success' | 'error';
  sessionId: string;
  message?: string;
  result?: string;
  links?: SessionLinks;
  metadata?: {
    commandLength?: number;
    timestamp: string;
  };
  error?: string;
}

/**
 * Enhanced GitHub webhook response with session links
 */
export interface EnhancedGitHubResponse {
  success: boolean;
  sessionId?: string;
  message: string;
  claudeResponse?: string;
  links?: SessionLinks;
  context: {
    repo: string;
    issue?: number;
    pr?: number;
    type: string;
    branch?: string;
    sender?: string;
  };
  error?: string;
  errorReference?: string;
  timestamp?: string;
}

/**
 * Enhanced Discord operation result with session links
 */
export interface EnhancedDiscordOperationResult {
  success: boolean;
  operationId: string;
  sessionId?: string;
  claudeResponse?: string;
  responseId?: string;
  duration?: number;
  links?: SessionLinks;
  error?: string;
}

/**
 * Session metadata returned from Claude service
 */
export interface ClaudeExecutionResult {
  success: boolean;
  sessionId: string;
  response?: string;
  error?: string;
  sessionPath?: string;
  metadata?: {
    startTime?: number;
    endTime?: number;
    duration?: number;
  };
}