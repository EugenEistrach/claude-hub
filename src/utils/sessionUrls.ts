import { existsSync } from 'fs';
import { join } from 'path';

export interface SessionLinks {
  prompt?: string;
  response?: string;
  trace?: string;
  traceData?: string;
}

export interface SessionLinkConfig {
  baseUrl: string;
  includeInDiscord?: boolean;
  includeInGitHub?: boolean;
  shortUrls?: boolean;
}

/**
 * Generate URLs for session artifacts
 * @param sessionId The session ID
 * @param baseUrl The base URL for the API
 * @param sessionPath Optional path to check for file existence
 * @returns Object containing URLs for available session artifacts
 */
export function generateSessionLinks(
  sessionId: string,
  baseUrl: string,
  sessionPath?: string
): SessionLinks {
  const links: SessionLinks = {};
  
  // Remove trailing slash from baseUrl if present
  const normalizedBaseUrl = baseUrl.replace(/\/$/, '');
  
  // If sessionPath is provided, check which files exist
  if (sessionPath) {
    if (existsSync(join(sessionPath, 'prompt.txt'))) {
      links.prompt = `${normalizedBaseUrl}/sessions/${sessionId}/prompt`;
    }
    
    if (existsSync(join(sessionPath, 'response.txt'))) {
      links.response = `${normalizedBaseUrl}/sessions/${sessionId}/response`;
    }
    
    if (existsSync(join(sessionPath, 'trace.html'))) {
      links.trace = `${normalizedBaseUrl}/sessions/${sessionId}/trace`;
    }
    
    if (existsSync(join(sessionPath, 'trace.jsonl'))) {
      links.traceData = `${normalizedBaseUrl}/sessions/${sessionId}/trace.jsonl`;
    }
  } else {
    // If no path provided, generate all links optimistically
    links.prompt = `${normalizedBaseUrl}/sessions/${sessionId}/prompt`;
    links.response = `${normalizedBaseUrl}/sessions/${sessionId}/response`;
    links.trace = `${normalizedBaseUrl}/sessions/${sessionId}/trace`;
    links.traceData = `${normalizedBaseUrl}/sessions/${sessionId}/trace.jsonl`;
  }
  
  return links;
}

/**
 * Format session links for Discord message
 * @param links The session links object
 * @param sessionId The session ID
 * @returns Formatted string for Discord message
 */
export function formatSessionLinksForDiscord(
  links: SessionLinks,
  sessionId: string
): string {
  const parts: string[] = [
    `📝 **Session Details:**`,
    `• Session ID: \`${sessionId}\``
  ];
  
  if (links.prompt) {
    parts.push(`• [View Prompt](${links.prompt})`);
  }
  
  if (links.response) {
    parts.push(`• [View Response](${links.response})`);
  }
  
  if (links.trace) {
    parts.push(`• [View Trace](${links.trace}) 🔍`);
  }
  
  if (links.traceData) {
    parts.push(`• [Download Trace Data](${links.traceData})`);
  }
  
  return parts.join('\n');
}

/**
 * Get the base URL from environment or request
 * @param req Optional Express request object
 * @returns The base URL for constructing links
 */
export function getBaseUrl(req?: { get?: (header: string) => string | undefined; protocol?: string }): string {
  // If we have a request object, construct from it
  if (req?.get) {
    const protocol = req.get('x-forwarded-proto') ?? req.protocol ?? 'http';
    const host = req.get('x-forwarded-host') ?? req.get('host') ?? 'localhost';
    return `${protocol}://${host}`;
  }
  
  // Fall back to environment variable or default
  return process.env.API_BASE_URL ?? process.env.WEBHOOK_URL ?? 'http://localhost:8082';
}