import { createLogger } from '../utils/logger';

const logger = createLogger('responseStorage');

interface ResponseData {
  content: string;
  timestamp: number;
  operationId: string;
  channelId?: string;
}

class ResponseStorage {
  private storage = new Map<string, ResponseData>();
  private cleanupInterval: ReturnType<typeof setInterval>;

  constructor() {
    // Clean up old responses every 5 minutes (keep for 30 minutes)
    this.cleanupInterval = setInterval(
      () => {
        this.cleanup();
      },
      5 * 60 * 1000
    );
  }

  set(id: string, data: ResponseData): void {
    this.storage.set(id, data);
    logger.debug({ id, size: data.content.length }, 'Stored response');
  }

  get(id: string): ResponseData | undefined {
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
      logger.info({ cleanedCount, remaining: this.storage.size }, 'Cleaned up old responses');
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
export const responseStorage = new ResponseStorage();