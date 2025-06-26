# Session Links Feature

## Overview

The Session Links feature enhances all Claude webhook responses (API, GitHub, Discord) by including direct links to session artifacts. This provides easy access to:
- The original prompt sent to Claude
- Claude's response
- Visual trace viewer (when claude-trace is enabled)
- Raw trace data in JSONL format

## Response Formats

### API Response (Enhanced)

```json
{
  "status": "success",
  "sessionId": "session-abc123",
  "result": "Claude's response text...",
  "links": {
    "prompt": "https://api.example.com/sessions/session-abc123/prompt.txt",
    "response": "https://api.example.com/sessions/session-abc123/response.txt",
    "trace": "https://api.example.com/sessions/session-abc123/trace",
    "traceData": "https://api.example.com/sessions/session-abc123/trace.jsonl"
  },
  "metadata": {
    "commandType": "general",
    "duration": 5234,
    "timestamp": "2025-06-25T10:30:00Z"
  }
}
```

### GitHub Webhook Response (Enhanced)

```json
{
  "success": true,
  "sessionId": "github-session-xyz789",
  "message": "Command processed successfully",
  "claudeResponse": "PR review completed...",
  "links": {
    "prompt": "https://api.example.com/sessions/github-session-xyz789/prompt.txt",
    "response": "https://api.example.com/sessions/github-session-xyz789/response.txt"
  },
  "context": {
    "repo": "owner/repo",
    "pr": 123,
    "type": "pull_request",
    "branch": "feature-branch"
  }
}
```

### Discord Embed (Enhanced)

Discord embeds now include a "Session Details" section with clickable links:

```
✅ Command Completed
ID: `discord-789` • Status: **Success** • Duration: **45s**

**Command:**
```
Review this PR
```

📝 **Session Details:**
• Session ID: `discord-789`
• [View Prompt](http://api.example.com/sessions/discord-789/prompt.txt)
• [View Response](http://api.example.com/sessions/discord-789/response.txt)
• [View Trace](http://api.example.com/sessions/discord-789/trace) 🔍
```

## Implementation Details

### Core Components

1. **Session URL Generator** (`src/utils/sessionUrls.ts`)
   - `generateSessionLinks()`: Creates URLs for session artifacts
   - `formatSessionLinksForDiscord()`: Formats links for Discord embeds
   - `getBaseUrl()`: Extracts base URL from request or environment

2. **Enhanced Response Types** (`src/types/responses.ts`)
   - `ClaudeExecutionResult`: Internal result type with session metadata
   - `EnhancedClaudeResponse`: API response with links
   - `EnhancedGitHubResponse`: GitHub webhook response with links

3. **Updated Services**
   - `claudeService.ts`: Returns `ClaudeExecutionResult` instead of plain string
   - `discordService.ts`: Accepts session links in embed creation

4. **Updated Controllers**
   - `claudeController.ts`: Generates and includes links in API responses
   - `githubController.ts`: Adds links to webhook responses
   - `discordController.ts`: Passes links to Discord embed creation

### File Existence Checking

When a session path is provided, the system checks which files actually exist before generating links:
- Only includes links to files that are present in the session directory
- Prevents broken links in responses
- Gracefully handles partial sessions (e.g., no trace files)

### Base URL Detection

The system intelligently determines the base URL:
1. From request headers (X-Forwarded-Proto, X-Forwarded-Host)
2. From environment variables (API_BASE_URL, WEBHOOK_URL)
3. Default fallback (http://localhost:8082)

## Configuration

No additional configuration is required. The feature uses existing environment variables:
- `WEBHOOK_URL`: Base URL for generating session links
- `PORT`: Default port if WEBHOOK_URL is not set
- `ENABLE_CLAUDE_TRACE`: When enabled, trace links are included

## Security Considerations

- Session IDs are randomly generated and unguessable
- Links are only accessible to those who receive the webhook response
- No authentication is currently required for accessing session artifacts
- Consider implementing authentication if sensitive data is processed

## Future Enhancements

1. **Authentication**: Add token-based access to session artifacts
2. **Expiration**: Automatically clean up old sessions after X days
3. **Compression**: Store large responses in compressed format
4. **Search**: Add ability to search across session history
5. **Analytics**: Track which session links are accessed most