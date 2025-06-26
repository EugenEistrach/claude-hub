import 'dotenv/config';
import express from 'express';
import bodyParser from 'body-parser';
import rateLimit from 'express-rate-limit';
import { createLogger } from './utils/logger';
import { StartupMetrics } from './utils/startup-metrics';
import githubRoutes from './routes/github';
import discordRoutes from './routes/discord';
import webhookRoutes from './routes/webhooks';
import claudeRoutes from './routes/claude';
import sessionsRoutes from './routes/sessions';
import { promptStorage } from './services/promptStorage';
import { responseStorage } from './services/responseStorage';
import { sessionStorage } from './services/sessionStorage';
import type { WebhookRequest, HealthCheckResponse, ErrorResponse } from './types/express';
import { execSync } from 'child_process';

const app = express();

// Configure trust proxy setting based on environment
// Set TRUST_PROXY=true when running behind reverse proxies (nginx, cloudflare, etc.)
const trustProxy = process.env['TRUST_PROXY'] === 'true';
if (trustProxy) {
  app.set('trust proxy', true);
}

const PORT = parseInt(process.env['PORT'] ?? '3002', 10);
const appLogger = createLogger('app');
const startupMetrics = new StartupMetrics();

// Record initial milestones
startupMetrics.recordMilestone('env_loaded', 'Environment variables loaded');
startupMetrics.recordMilestone('express_initialized', 'Express app initialized');

// Rate limiting configuration
// When behind a proxy, we need to properly handle client IP detection
const rateLimitConfig = {
  windowMs: 15 * 60 * 1000, // 15 minutes
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  // Skip validation when behind proxy to avoid startup errors
  validate: trustProxy ? false : undefined
};

const generalRateLimit = rateLimit({
  ...rateLimitConfig,
  max: 100, // Limit each IP to 100 requests per windowMs
  message: {
    error: 'Too many requests',
    message: 'Too many requests from this IP, please try again later.'
  }
});

const webhookRateLimit = rateLimit({
  ...rateLimitConfig,
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 50, // Limit each IP to 50 webhook requests per 5 minutes
  message: {
    error: 'Too many webhook requests',
    message: 'Too many webhook requests from this IP, please try again later.'
  },
  skip: _req => {
    // Skip rate limiting in test environment
    return process.env['NODE_ENV'] === 'test';
  }
});

// Apply rate limiting
app.use('/api/webhooks', webhookRateLimit);
app.use(generalRateLimit);

// Request logging middleware
app.use((req, res, next) => {
  const startTime = Date.now();

  res.on('finish', () => {
    const responseTime = Date.now() - startTime;
    appLogger.info(
      {
        method: req.method,
        url: req.url,
        statusCode: res.statusCode,
        responseTime: `${responseTime}ms`
      },
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      `${req.method?.replace(/[\r\n\t]/g, '_') || 'UNKNOWN'} ${req.url?.replace(/[\r\n\t]/g, '_') || '/unknown'}`
    );
  });

  next();
});

// Middleware
app.use(startupMetrics.metricsMiddleware());

app.use(
  bodyParser.json({
    verify: (req: express.Request & { rawBody?: Buffer }, _res, buf) => {
      // Store the raw body buffer for webhook signature verification
      req.rawBody = buf;
    }
  })
);

startupMetrics.recordMilestone('middleware_configured', 'Express middleware configured');

// Routes
app.use('/api/webhooks/github', githubRoutes); // Legacy endpoint
app.use('/api/webhooks/discord', discordRoutes); // Discord integration endpoint
app.use('/api/webhooks', webhookRoutes); // New modular webhook endpoint
app.use('/api/claude', claudeRoutes); // Claude agent API endpoint
app.use('/sessions', sessionsRoutes); // Session storage endpoints

startupMetrics.recordMilestone('routes_configured', 'API routes configured');

// Endpoint to serve full prompts
app.get('/prompts/:id', async (req: express.Request, res: express.Response): Promise<void> => {
  const promptId = req.params.id;

  // First check if this is a session ID in the new storage
  try {
    const sessionPrompt = await sessionStorage.getPrompt(promptId);
    if (sessionPrompt) {
      appLogger.info({ promptId, source: 'session' }, 'Prompt request (redirecting to session)');
      res.redirect(`/sessions/${promptId}/prompt`);
      return;
    }
  } catch (error) {
    appLogger.debug(
      { error: (error as Error).message },
      'Session lookup failed, trying memory storage'
    );
  }

  // Fall back to in-memory storage
  const promptData = promptStorage.get(promptId);

  appLogger.info({ promptId, found: !!promptData, source: 'memory' }, 'Prompt request');

  if (!promptData) {
    res
      .status(404)
      .type('text/plain')
      .send('Prompt not found or expired (prompts are kept for 30 minutes)');
    return;
  }

  // Set headers for plain text display
  res.set({
    'Content-Type': 'text/plain; charset=utf-8',
    'X-Operation-ID': promptData.operationId,
    'X-Timestamp': new Date(promptData.timestamp).toISOString()
  });

  res.send(promptData.prompt);
});

// Endpoint to serve full responses
app.get('/responses/:id', async (req: express.Request, res: express.Response): Promise<void> => {
  const responseId = req.params.id;

  // First check if this is a session ID in the new storage
  try {
    const sessionResponse = await sessionStorage.getResponse(responseId);
    if (sessionResponse) {
      appLogger.info(
        { responseId, source: 'session' },
        'Response request (redirecting to session)'
      );
      res.redirect(`/sessions/${responseId}/response`);
      return;
    }
  } catch (error) {
    appLogger.debug(
      { error: (error as Error).message },
      'Session lookup failed, trying memory storage'
    );
  }

  // Fall back to in-memory storage
  const responseData = responseStorage.get(responseId);

  appLogger.info({ responseId, found: !!responseData, source: 'memory' }, 'Response request');

  if (!responseData) {
    res
      .status(404)
      .type('text/plain')
      .send('Response not found or expired (responses are kept for 30 minutes)');
    return;
  }

  // Set headers for plain text display
  res.set({
    'Content-Type': 'text/plain; charset=utf-8',
    'X-Operation-ID': responseData.operationId,
    'X-Timestamp': new Date(responseData.timestamp).toISOString()
  });

  res.send(responseData.content);
});

// Health check endpoint
app.get('/health', (req: WebhookRequest, res: express.Response<HealthCheckResponse>) => {
  const healthCheckStart = Date.now();

  const checks: HealthCheckResponse = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    startup: req.startupMetrics,
    docker: {
      available: false,
      error: null,
      checkTime: null
    },
    claudeCodeImage: {
      available: false,
      error: null,
      checkTime: null
    }
  };

  // Check Docker availability
  const dockerCheckStart = Date.now();
  try {
    execSync('docker ps', { stdio: 'ignore' });
    checks.docker.available = true;
  } catch (error) {
    checks.docker.error = (error as Error).message;
  }
  checks.docker.checkTime = Date.now() - dockerCheckStart;

  // Check Claude Code runner image
  const imageCheckStart = Date.now();
  const dockerImageName = process.env['CLAUDE_CONTAINER_IMAGE'] ?? 'claudecode:latest';
  try {
    execSync(`docker image inspect ${dockerImageName}`, { stdio: 'ignore' });
    checks.claudeCodeImage.available = true;
  } catch {
    checks.claudeCodeImage.error = 'Image not found';
  }
  checks.claudeCodeImage.checkTime = Date.now() - imageCheckStart;

  // Set overall status
  if (!checks.docker.available || !checks.claudeCodeImage.available) {
    checks.status = 'degraded';
  }

  checks.healthCheckDuration = Date.now() - healthCheckStart;
  res.status(200).json(checks);
});

// Error handling middleware
app.use(
  (
    err: Error,
    req: express.Request,
    res: express.Response<ErrorResponse>,
    _next: express.NextFunction
  ) => {
    appLogger.error(
      {
        err: {
          message: err.message,
          stack: err.stack
        },
        method: req.method,
        url: req.url
      },
      'Request error'
    );

    // Handle JSON parsing errors
    if (err instanceof SyntaxError && 'body' in err) {
      res.status(400).json({ error: 'Invalid JSON' });
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// Only start the server if this is the main module (not being imported for testing)
if (require.main === module) {
  app.listen(PORT, () => {
    startupMetrics.recordMilestone('server_listening', `Server listening on port ${PORT}`);
    const totalStartupTime = startupMetrics.markReady();
    appLogger.info(`Server running on port ${PORT} (startup took ${totalStartupTime}ms)`);
  });
}

export default app;
