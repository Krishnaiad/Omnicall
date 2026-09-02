import pino from 'pino';
import pinoHttp from 'pino-http';

// In-memory metrics store (Spec 3)
export const metricsStore = {
  totalRequests: 0,
  statusBuckets: {
    '2xx': 0,
    '4xx': 0,
    '5xx': 0,
  },
  recentErrors: [], // Max 50 elements
};

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level: (label) => {
      return { level: label.toUpperCase() };
    },
  },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'body.password',
      'body.token',
      'body.refreshToken',
      'res.headers["set-cookie"]',
    ],
    censor: '[REDACTED]',
  },
});

export const httpLogger = pinoHttp({
  logger,
  customProps: function (req, res) {
    return {
      userId: req.user?.id || req.user?.sub,
      route: req.url,
      statusCode: res.statusCode,
    };
  },
  customLogLevel: function (req, res, err) {
    if (res.statusCode >= 400 && res.statusCode < 500) {
      return 'warn';
    } else if (res.statusCode >= 500 || err) {
      return 'error';
    }
    return 'info';
  },
  customSuccessMessage: function (req, res) {
    return `Request completed with status ${res.statusCode}`;
  },
  customErrorMessage: function (req, res, err) {
    return `Request failed with status ${res.statusCode}: ${err.message}`;
  },
});

export const metricsMiddleware = (req, res, next) => {
  res.on('finish', () => {
    metricsStore.totalRequests++;

    const status = res.statusCode;
    if (status >= 200 && status < 300) {
      metricsStore.statusBuckets['2xx']++;
    } else if (status >= 400 && status < 500) {
      metricsStore.statusBuckets['4xx']++;
    } else if (status >= 500) {
      metricsStore.statusBuckets['5xx']++;
      // Capture error
      metricsStore.recentErrors.unshift({
        timestamp: new Date().toISOString(),
        method: req.method,
        url: req.originalUrl || req.url,
        statusCode: status,
        userId: req.user?.id || req.user?.sub,
      });
      // Cap at 50
      if (metricsStore.recentErrors.length > 50) {
        metricsStore.recentErrors.pop();
      }
    }
  });
  next();
};
