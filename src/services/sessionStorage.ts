import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import crypto from 'crypto';
import { createLogger } from '../utils/logger';

const logger = createLogger('sessionStorage');

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const readdir = promisify(fs.readdir);
const unlink = promisify(fs.unlink);
const rmdir = promisify(fs.rmdir);
const mkdir = promisify(fs.mkdir);
const exists = promisify(fs.exists);

export interface SessionMetadata {
  id: string;
  timestamp: number;
  operationId: string;
  repoFullName?: string;
  issueNumber?: number | null;
  isPullRequest?: boolean;
  branchName?: string | null;
  operationType?: string;
  channelId?: string;
  userId?: string;
}

export interface SessionData extends SessionMetadata {
  prompt?: string;
  response?: string;
  traceHtmlPath?: string;
  traceJsonlPath?: string;
}

class SessionStorage {
  private sessionsDir: string;
  private cleanupInterval: ReturnType<typeof setInterval>;
  private retentionDays: number;

  constructor() {
    // Use the local sessions directory
    this.sessionsDir = process.env.CLAUDE_SESSIONS_VOLUME_PATH ?? path.resolve(process.cwd(), 'sessions');
    this.retentionDays = parseInt(process.env.CLAUDE_SESSIONS_RETENTION_DAYS ?? '7', 10);

    // Ensure sessions directory exists
    this.ensureSessionsDirectory().catch(err => {
      logger.error(
        { error: err.message },
        'Failed to ensure sessions directory during initialization'
      );
    });

    // Clean up old sessions every hour
    this.cleanupInterval = setInterval(
      () => {
        this.cleanup().catch(err => {
          logger.error({ error: err.message }, 'Error during cleanup');
        });
      },
      60 * 60 * 1000
    );
  }

  private async ensureSessionsDirectory(): Promise<void> {
    try {
      await mkdir(this.sessionsDir, { recursive: true });
      logger.info({ sessionsDir: this.sessionsDir }, 'Sessions directory ensured');
    } catch (error) {
      logger.error(
        { error: (error as Error).message, sessionsDir: this.sessionsDir },
        'Failed to create sessions directory'
      );
    }
  }

  generateSessionId(): string {
    // Generate a cryptographically secure random ID
    return crypto.randomBytes(16).toString('hex');
  }

  private getSessionPath(sessionId: string): string {
    // Validate session ID to prevent path traversal
    if (!sessionId.match(/^[a-f0-9]{32}$/)) {
      throw new Error('Invalid session ID format');
    }
    return path.join(this.sessionsDir, sessionId);
  }

  async createSession(metadata: SessionMetadata): Promise<void> {
    const sessionPath = this.getSessionPath(metadata.id);

    try {
      // Create session directory
      await mkdir(sessionPath, { recursive: true });

      // Save metadata
      await writeFile(
        path.join(sessionPath, 'metadata.json'),
        JSON.stringify(metadata, null, 2),
        'utf8'
      );

      logger.info({ sessionId: metadata.id, sessionPath }, 'Session created');
    } catch (error) {
      logger.error(
        { error: (error as Error).message, sessionId: metadata.id },
        'Failed to create session'
      );
      throw error;
    }
  }

  async savePrompt(sessionId: string, prompt: string): Promise<void> {
    const sessionPath = this.getSessionPath(sessionId);
    const promptPath = path.join(sessionPath, 'prompt.txt');

    try {
      await writeFile(promptPath, prompt, 'utf8');
      logger.debug({ sessionId, promptSize: prompt.length }, 'Prompt saved');
    } catch (error) {
      logger.error({ error: (error as Error).message, sessionId }, 'Failed to save prompt');
      throw error;
    }
  }

  async saveResponse(sessionId: string, response: string): Promise<void> {
    const sessionPath = this.getSessionPath(sessionId);
    const responsePath = path.join(sessionPath, 'response.txt');

    try {
      await writeFile(responsePath, response, 'utf8');
      logger.debug({ sessionId, responseSize: response.length }, 'Response saved');
    } catch (error) {
      logger.error({ error: (error as Error).message, sessionId }, 'Failed to save response');
      throw error;
    }
  }

  async getSession(sessionId: string): Promise<SessionData | null> {
    const sessionPath = this.getSessionPath(sessionId);

    try {
      // Check if session exists
      if (!(await exists(sessionPath))) {
        return null;
      }

      // Read metadata
      const metadataPath = path.join(sessionPath, 'metadata.json');
      const metadataContent = await readFile(metadataPath, 'utf8');
      const metadata: SessionMetadata = JSON.parse(metadataContent);

      // Build session data object
      const sessionData: SessionData = { ...metadata };

      // Read prompt if exists
      const promptPath = path.join(sessionPath, 'prompt.txt');
      if (await exists(promptPath)) {
        sessionData.prompt = await readFile(promptPath, 'utf8');
      }

      // Read response if exists
      const responsePath = path.join(sessionPath, 'response.txt');
      if (await exists(responsePath)) {
        sessionData.response = await readFile(responsePath, 'utf8');
      }

      // Check for trace files
      const traceHtmlPath = path.join(sessionPath, 'trace.html');
      if (await exists(traceHtmlPath)) {
        sessionData.traceHtmlPath = traceHtmlPath;
      }

      const traceJsonlPath = path.join(sessionPath, 'trace.jsonl');
      if (await exists(traceJsonlPath)) {
        sessionData.traceJsonlPath = traceJsonlPath;
      }

      return sessionData;
    } catch (error) {
      logger.error({ error: (error as Error).message, sessionId }, 'Failed to get session');
      return null;
    }
  }

  async getPrompt(sessionId: string): Promise<string | null> {
    const sessionPath = this.getSessionPath(sessionId);
    const promptPath = path.join(sessionPath, 'prompt.txt');

    try {
      if (!(await exists(promptPath))) {
        return null;
      }
      return await readFile(promptPath, 'utf8');
    } catch (error) {
      logger.error({ error: (error as Error).message, sessionId }, 'Failed to get prompt');
      return null;
    }
  }

  async getResponse(sessionId: string): Promise<string | null> {
    const sessionPath = this.getSessionPath(sessionId);
    const responsePath = path.join(sessionPath, 'response.txt');

    try {
      if (!(await exists(responsePath))) {
        return null;
      }
      return await readFile(responsePath, 'utf8');
    } catch (error) {
      logger.error({ error: (error as Error).message, sessionId }, 'Failed to get response');
      return null;
    }
  }

  async getTraceHtml(sessionId: string): Promise<string | null> {
    const sessionPath = this.getSessionPath(sessionId);
    const tracePath = path.join(sessionPath, 'trace.html');

    try {
      if (!(await exists(tracePath))) {
        return null;
      }
      return await readFile(tracePath, 'utf8');
    } catch (error) {
      logger.error({ error: (error as Error).message, sessionId }, 'Failed to get trace HTML');
      return null;
    }
  }

  async getTraceJsonl(sessionId: string): Promise<string | null> {
    const sessionPath = this.getSessionPath(sessionId);
    const tracePath = path.join(sessionPath, 'trace.jsonl');

    try {
      if (!(await exists(tracePath))) {
        return null;
      }
      return await readFile(tracePath, 'utf8');
    } catch (error) {
      logger.error({ error: (error as Error).message, sessionId }, 'Failed to get trace JSONL');
      return null;
    }
  }

  async listSessions(): Promise<SessionMetadata[]> {
    try {
      const sessionDirs = await readdir(this.sessionsDir);
      const sessions: SessionMetadata[] = [];

      for (const sessionId of sessionDirs) {
        // Skip non-session directories
        if (!sessionId.match(/^[a-f0-9]{32}$/)) {
          continue;
        }

        try {
          const metadataPath = path.join(this.sessionsDir, sessionId, 'metadata.json');
          if (await exists(metadataPath)) {
            const metadataContent = await readFile(metadataPath, 'utf8');
            const metadata: SessionMetadata = JSON.parse(metadataContent);
            sessions.push(metadata);
          }
        } catch (error) {
          logger.warn(
            { error: (error as Error).message, sessionId },
            'Failed to read session metadata'
          );
        }
      }

      // Sort by timestamp descending
      sessions.sort((a, b) => b.timestamp - a.timestamp);

      return sessions;
    } catch (error) {
      logger.error({ error: (error as Error).message }, 'Failed to list sessions');
      return [];
    }
  }

  async cleanup(): Promise<void> {
    const now = Date.now();
    const maxAge = this.retentionDays * 24 * 60 * 60 * 1000;
    let cleanedCount = 0;

    try {
      const sessionDirs = await readdir(this.sessionsDir);

      for (const sessionId of sessionDirs) {
        // Skip non-session directories
        if (!sessionId.match(/^[a-f0-9]{32}$/)) {
          continue;
        }

        const sessionPath = path.join(this.sessionsDir, sessionId);

        try {
          // Check metadata timestamp
          const metadataPath = path.join(sessionPath, 'metadata.json');
          if (await exists(metadataPath)) {
            const metadataContent = await readFile(metadataPath, 'utf8');
            const metadata: SessionMetadata = JSON.parse(metadataContent);

            if (now - metadata.timestamp > maxAge) {
              // Delete all files in session directory
              await this.deleteSession(sessionId);
              cleanedCount++;
            }
          }
        } catch (error) {
          logger.warn(
            { error: (error as Error).message, sessionId },
            'Error checking session for cleanup'
          );
        }
      }

      if (cleanedCount > 0) {
        logger.info({ cleanedCount }, 'Cleaned up old sessions');
      }
    } catch (error) {
      logger.error({ error: (error as Error).message }, 'Error during cleanup');
    }
  }

  private async deleteSession(sessionId: string): Promise<void> {
    const sessionPath = this.getSessionPath(sessionId);

    try {
      // Delete all files in the directory
      const files = await readdir(sessionPath);
      for (const file of files) {
        await unlink(path.join(sessionPath, file));
      }

      // Delete the directory
      await rmdir(sessionPath);

      logger.debug({ sessionId }, 'Session deleted');
    } catch (error) {
      logger.error({ error: (error as Error).message, sessionId }, 'Failed to delete session');
      throw error;
    }
  }

  destroy(): void {
    clearInterval(this.cleanupInterval);
  }
}

// Export singleton instance
export const sessionStorage = new SessionStorage();
