import type { Request, Response } from 'express';
import type { DiscordInteractionPayload, DiscordInteractionResponse } from './discord';

/**
 * Discord-specific Express Request interface
 *
 * Extends Express Request with Discord interaction payload and raw body for signature verification.
 * This is separate from WebhookRequest to maintain clean separation between GitHub and Discord types.
 */
export interface DiscordWebhookRequest extends Request {
  /** Raw request body buffer for Discord Ed25519 signature verification */
  rawBody?: Buffer;
  /** Discord interaction payload */
  body: DiscordInteractionPayload;
}

/**
 * Discord webhook handler type
 *
 * Handles Discord interaction webhooks with proper typing for Discord-specific
 * request and response structures. Uses Discord's native interaction response format.
 */
export type DiscordWebhookHandler = (
  req: DiscordWebhookRequest,
  res: Response<DiscordInteractionResponse>
) =>
  | Promise<Response<DiscordInteractionResponse> | void>
  | Response<DiscordInteractionResponse>
  | void;

/**
 * Discord health check response interface
 *
 * Separate from main webhook responses for consistency with existing health check patterns.
 */
export interface DiscordHealthResponse {
  status: 'ok' | 'error';
  service: 'discord-webhook';
  timestamp: string;
  checks?: {
    signatureVerification?: boolean;
    botTokenValid?: boolean;
    commandsRegistered?: boolean;
  };
}

/**
 * Discord error response for non-interaction endpoints
 *
 * Used for health checks and other non-interaction endpoints that don't follow
 * Discord's interaction response format.
 */
export interface DiscordErrorResponse {
  error: string;
  message?: string;
  service: 'discord-webhook';
  timestamp: string;
}

/**
 * Discord webhook validation interface
 *
 * Used for Discord signature verification and request validation.
 */
export interface DiscordWebhookValidation {
  isValid: boolean;
  reason?: string;
  signature?: string;
  timestamp?: string;
}
