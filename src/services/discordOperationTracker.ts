import { randomBytes } from 'crypto';
import { createLogger } from '../utils/logger';

const logger = createLogger('discordOperationTracker');

/**
 * Interface for tracking pending Discord operations
 */
export interface PendingDiscordOperation {
  operationId: string; // Using sessionId as operationId for consistency
  sessionId?: string; // Optional explicit sessionId (same as operationId)
  userId: string; // Discord user ID
  channelId: string; // Discord channel ID
  guildId?: string; // Discord server ID (optional for DMs)
  username: string; // Discord username (for mentions)
  command: string; // Original command
  repository?: string; // Repository being processed (optional for general commands)
  startTime: Date; // When operation started
  interactionId: string; // Original interaction ID (for reference)
  messageId?: string; // Discord message ID for updates (set after initial response)
  fullPrompt?: string; // Full prompt sent to Claude (for debugging)
}

/**
 * Simple Discord operation tracker for managing async Claude operations
 *
 * This provides lightweight tracking for Discord operations that take longer
 * than Discord's 15-minute interaction limit. Unlike the SessionManager
 * (which handles Claude Code container orchestration), this just tracks
 * operation context for completion notifications.
 */
class DiscordOperationTracker {
  private operations = new Map<string, PendingDiscordOperation>();

  /**
   * Generate a unique operation ID
   * @deprecated Use sessionStorage.generateSessionId() instead
   */
  generateOperationId(): string {
    return `discord-${randomBytes(6).toString('hex')}`;
  }

  /**
   * Start tracking a Discord operation
   */
  startOperation(operation: PendingDiscordOperation): void {
    this.operations.set(operation.operationId, operation);

    logger.info(
      {
        operationId: operation.operationId,
        sessionId: operation.sessionId ?? operation.operationId,
        userId: operation.userId,
        username: operation.username,
        repository: operation.repository,
        commandLength: operation.command.length
      },
      'Started Discord operation tracking'
    );
  }

  /**
   * Complete and remove a Discord operation from tracking
   */
  completeOperation(operationId: string): PendingDiscordOperation | null {
    const operation = this.operations.get(operationId);

    if (operation) {
      this.operations.delete(operationId);

      const duration = Date.now() - operation.startTime.getTime();
      logger.info(
        {
          operationId,
          duration,
          durationMinutes: Math.round(duration / 60000)
        },
        'Completed Discord operation'
      );
    } else {
      logger.warn({ operationId }, 'Attempted to complete non-existent operation');
    }

    return operation ?? null;
  }

  /**
   * Get a specific operation by ID
   */
  getOperation(operationId: string): PendingDiscordOperation | null {
    return this.operations.get(operationId) ?? null;
  }

  /**
   * Get all pending operations
   */
  getPendingOperations(): PendingDiscordOperation[] {
    return Array.from(this.operations.values());
  }

  /**
   * Get pending operations for a specific user
   */
  getUserOperations(userId: string): PendingDiscordOperation[] {
    return Array.from(this.operations.values()).filter(op => op.userId === userId);
  }

  /**
   * Get pending operations for a specific channel
   */
  getChannelOperations(channelId: string): PendingDiscordOperation[] {
    return Array.from(this.operations.values()).filter(op => op.channelId === channelId);
  }

  /**
   * Clean up old operations (for memory management)
   * Default: Remove operations older than 2 hours
   */
  cleanupOldOperations(maxAgeMs: number = 2 * 60 * 60 * 1000): number {
    const cutoff = Date.now() - maxAgeMs;
    let cleanedCount = 0;

    for (const [id, operation] of this.operations) {
      if (operation.startTime.getTime() < cutoff) {
        this.operations.delete(id);
        cleanedCount++;

        logger.warn(
          {
            operationId: id,
            age: Date.now() - operation.startTime.getTime(),
            repository: operation.repository
          },
          'Cleaned up stale Discord operation'
        );
      }
    }

    if (cleanedCount > 0) {
      logger.info({ cleanedCount, remaining: this.operations.size }, 'Operation cleanup completed');
    }

    return cleanedCount;
  }

  /**
   * Get operation statistics
   */
  getStats(): {
    total: number;
    byRepository: Record<string, number>;
    byUser: Record<string, number>;
    averageAge: number;
  } {
    const operations = Array.from(this.operations.values());
    const now = Date.now();

    const byRepository: Record<string, number> = {};
    const byUser: Record<string, number> = {};
    let totalAge = 0;

    for (const op of operations) {
      // Count by repository
      const repoKey = op.repository ?? 'general';
      byRepository[repoKey] = (byRepository[repoKey] || 0) + 1;

      // Count by user
      byUser[op.userId] = (byUser[op.userId] || 0) + 1;

      // Calculate age
      totalAge += now - op.startTime.getTime();
    }

    return {
      total: operations.length,
      byRepository,
      byUser,
      averageAge: operations.length > 0 ? totalAge / operations.length : 0
    };
  }
}

// Export singleton instance
export const discordOperationTracker = new DiscordOperationTracker();

// Periodic cleanup (every 30 minutes)
setInterval(
  () => {
    discordOperationTracker.cleanupOldOperations();
  },
  30 * 60 * 1000
);
