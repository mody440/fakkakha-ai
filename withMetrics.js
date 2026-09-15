// lib/withMetrics.js
// Wraps an endpoint handler so every call is timed and logged automatically
// — the endpoint itself doesn't need to know metrics exist. Attach the
// resulting statusCode by patching res.status/res.json so we can see what
// was actually sent, not just whether the handler threw.

const logger = require('./logger');

function withMetrics(endpointName, handler) {
  return async (req, res) => {
    const start = Date.now();
    let statusCode = 200;

    const originalStatus = res.status.bind(res);
    res.status = (code) => { statusCode = code; return originalStatus(code); };

    let caughtError = null;
    try {
      await handler(req, res);
    } catch (err) {
      caughtError = err.message || String(err);
      statusCode = 500;
      if (!res.headersSent) res.status(500).json({ error: 'internal_error', message: 'حصل عطل غير متوقع.' });
    } finally {
      const durationMs = Date.now() - start;
      // Fire-and-forget — never delay the response for metrics.
      logger.recordRequest({ endpoint: endpointName, statusCode, durationMs, cached: Boolean(res._cached), error: caughtError });
    }
  };
}

module.exports = { withMetrics };
