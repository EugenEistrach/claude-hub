import { createLogger } from '../utils/logger';

const logger = createLogger('promptStorage');

interface PromptData {
  prompt: string;
  timestamp: number;
  operationId: string;
}

class PromptStorage {
  private storage = new Map<string, PromptData>();
  private cleanupInterval: ReturnType<typeof setInterval>;

  constructor() {
    // Clean up old prompts every 5 minutes (keep for 30 minutes)
    this.cleanupInterval = setInterval(
      () => {
        this.cleanup();
      },
      5 * 60 * 1000
    );
  }

  set(id: string, data: PromptData): void {
    this.storage.set(id, data);
    logger.debug({ id, size: data.prompt.length }, 'Stored prompt');
  }

  get(id: string): PromptData | undefined {
    return this.storage.get(id);
  }

  delete(id: string): boolean {
    return this.storage.delete(id);
  }

  cleanup(): void {
    const now = Date.now();
    const maxAge = 30 * 60 * 1000; // 30 minutes
    let cleanedCount = 0;

    for (const [id, data] of this.storage) {
      if (now - data.timestamp > maxAge) {
        this.storage.delete(id);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      logger.info({ cleanedCount, remaining: this.storage.size }, 'Cleaned up old prompts');
    }
  }

  size(): number {
    return this.storage.size;
  }

  destroy(): void {
    clearInterval(this.cleanupInterval);
    this.storage.clear();
  }
}

// Export singleton instance
export const promptStorage = new PromptStorage();
