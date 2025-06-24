import express from 'express';
import { handleDiscordWebhook } from '../controllers/discordController';
import type { DiscordHealthResponse } from '../types/discord-express';

const router = express.Router();

/**
 * Discord interaction webhook endpoint
 * POST /api/webhooks/discord
 *
 * This endpoint receives interaction events from Discord, including:
 * - Slash commands
 * - Button clicks (future)
 * - Select menu interactions (future)
 * - Modal submissions (future)
 *
 * Discord requires a response within 3 seconds, so we use the deferred response pattern
 * for long-running operations like Claude processing.
 */
router.post('/', handleDiscordWebhook as express.RequestHandler);

// Health check endpoint for Discord webhook
router.get('/health', (_req, res: express.Response<DiscordHealthResponse>) => {
  res.json({
    status: 'ok',
    service: 'discord-webhook',
    timestamp: new Date().toISOString()
  });
});

export default router;
