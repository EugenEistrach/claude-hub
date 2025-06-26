import { Router } from 'express';
import { sessionStorage } from '../services/sessionStorage';
import { createLogger } from '../utils/logger';

const router = Router();
const logger = createLogger('sessions-routes');

// List all sessions
router.get('/', async (_req, res) => {
  try {
    const sessions = await sessionStorage.listSessions();

    logger.info({ count: sessions.length }, 'Listed sessions');

    res.json({
      sessions,
      count: sessions.length
    });
  } catch (error) {
    logger.error({ error: (error as Error).message }, 'Failed to list sessions');
    res.status(500).json({ error: 'Failed to list sessions' });
  }
});

// Get session metadata
router.get('/:sessionId', async (req, res) => {
  const { sessionId } = req.params;

  try {
    const session = await sessionStorage.getSession(sessionId);

    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    // Return metadata without the actual content
    const metadata = {
      id: session.id,
      timestamp: session.timestamp,
      operationId: session.operationId,
      repoFullName: session.repoFullName,
      issueNumber: session.issueNumber,
      isPullRequest: session.isPullRequest,
      branchName: session.branchName,
      operationType: session.operationType,
      hasPrompt: !!session.prompt,
      hasResponse: !!session.response,
      hasTraceHtml: !!session.traceHtmlPath,
      hasTraceJsonl: !!session.traceJsonlPath
    };

    logger.info({ sessionId }, 'Retrieved session metadata');

    res.json(metadata);
  } catch (error) {
    logger.error({ error: (error as Error).message, sessionId }, 'Failed to get session');
    res.status(500).json({ error: 'Failed to get session' });
  }
});

// Get session prompt
router.get('/:sessionId/prompt', async (req, res) => {
  const { sessionId } = req.params;

  try {
    const prompt = await sessionStorage.getPrompt(sessionId);

    if (!prompt) {
      res.status(404).type('text/plain').send('Prompt not found');
      return;
    }

    logger.info({ sessionId, size: prompt.length }, 'Retrieved prompt');

    // Set headers for plain text display
    res.set({
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Session-ID': sessionId
    });

    res.send(prompt);
  } catch (error) {
    logger.error({ error: (error as Error).message, sessionId }, 'Failed to get prompt');
    res.status(500).json({ error: 'Failed to get prompt' });
  }
});

// Get session response
router.get('/:sessionId/response', async (req, res) => {
  const { sessionId } = req.params;

  try {
    const response = await sessionStorage.getResponse(sessionId);

    if (!response) {
      res.status(404).type('text/plain').send('Response not found');
      return;
    }

    logger.info({ sessionId, size: response.length }, 'Retrieved response');

    // Set headers for plain text display
    res.set({
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Session-ID': sessionId
    });

    res.send(response);
  } catch (error) {
    logger.error({ error: (error as Error).message, sessionId }, 'Failed to get response');
    res.status(500).json({ error: 'Failed to get response' });
  }
});

// View trace HTML
router.get('/:sessionId/trace', async (req, res) => {
  const { sessionId } = req.params;

  try {
    const traceHtml = await sessionStorage.getTraceHtml(sessionId);

    if (!traceHtml) {
      res.status(404).type('text/plain').send('Trace not found');
      return;
    }

    logger.info({ sessionId }, 'Retrieved trace HTML');

    // Set headers for HTML display
    res.set({
      'Content-Type': 'text/html; charset=utf-8',
      'X-Session-ID': sessionId
    });

    res.send(traceHtml);
  } catch (error) {
    logger.error({ error: (error as Error).message, sessionId }, 'Failed to get trace HTML');
    res.status(500).json({ error: 'Failed to get trace HTML' });
  }
});

// Download trace JSONL
router.get('/:sessionId/trace.jsonl', async (req, res) => {
  const { sessionId } = req.params;

  try {
    const traceJsonl = await sessionStorage.getTraceJsonl(sessionId);

    if (!traceJsonl) {
      res.status(404).type('text/plain').send('Trace JSONL not found');
      return;
    }

    logger.info({ sessionId }, 'Retrieved trace JSONL');

    // Set headers for file download
    res.set({
      'Content-Type': 'application/x-ndjson',
      'Content-Disposition': `attachment; filename="trace-${sessionId}.jsonl"`,
      'X-Session-ID': sessionId
    });

    res.send(traceJsonl);
  } catch (error) {
    logger.error({ error: (error as Error).message, sessionId }, 'Failed to get trace JSONL');
    res.status(500).json({ error: 'Failed to get trace JSONL' });
  }
});

export default router;
