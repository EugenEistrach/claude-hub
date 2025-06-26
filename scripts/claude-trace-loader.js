// Custom Claude Trace loader that respects CLAUDE_TRACE_LOG_DIR environment variable
try {
  // Find the correct path for claude-trace
  const possiblePaths = [
    "@mariozechner/claude-trace/dist/interceptor",
    "/usr/local/share/npm-global/lib/node_modules/@mariozechner/claude-trace/dist/interceptor",
    "/home/node/.npm-global/lib/node_modules/@mariozechner/claude-trace/dist/interceptor"
  ];
  
  let interceptor = null;
  for (const path of possiblePaths) {
    try {
      interceptor = require(path);
      break;
    } catch (e) {
      // Try next path
    }
  }
  
  if (!interceptor) {
    throw new Error("Could not find claude-trace interceptor in any known location");
  }
  
  const { initializeInterceptor } = interceptor;
  
  // Configure with our desired log directory
  const config = {
    logDirectory: process.env.CLAUDE_TRACE_LOG_DIR || ".claude-trace",
    enableRealTimeHTML: true,
    logLevel: "info"
  };
  
  console.error(`Initializing Claude Trace with log directory: ${config.logDirectory}`);
  const logger = initializeInterceptor(config);
  
  // Override the cleanup method to prevent file deletion
  if (logger && logger.cleanup) {
    const originalCleanup = logger.cleanup.bind(logger);
    logger.cleanup = function() {
      console.error("Claude Trace cleanup called - skipping to preserve files");
      // Don't call originalCleanup to preserve files
    };
  }
} catch (error) {
  console.error("❌ Error loading Claude Trace interceptor:", error.message);
  // Don't exit - let the process continue without tracing
}