const axios = require('axios');

// Configuration for the external logging service
const LOGGING_SERVICE_CONFIG = {
  baseURL: 'http://20.244.56.144/evaluation-service/logs',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer 7101e1cb-fe1c-4b8d-bbd3-438565d1b3f6'
  }
};

/**
 * Custom Logging Middleware that sends logs to external service
 * @param {string} stack - The stack name (e.g., 'backend')
 * @param {string} level - Log level (e.g., 'info', 'error', 'warn')
 * @param {string} package - The package/module name
 * @param {string} message - The log message
 */
const logToExternalService = async (stack, level, package, message) => {
  try {
    const logData = {
      stack,
      level,
      package,
      message
    };

    const response = await axios.post(LOGGING_SERVICE_CONFIG.baseURL, logData, {
      headers: LOGGING_SERVICE_CONFIG.headers
    });

    console.log('Log sent successfully:', response.data);
    return response.data;
  } catch (error) {
    console.error('Failed to send log to external service:', error.message);
    // Fallback to console logging if external service fails
    console.log(`[${level.toUpperCase()}] [${stack}] [${package}]: ${message}`);
  }
};

/**
 * Express middleware for logging requests and responses
 */
const loggingMiddleware = (req, res, next) => {
  const startTime = Date.now();
  
  // Log the incoming request
  logToExternalService('backend', 'info', 'middleware', `Incoming ${req.method} request to ${req.url}`);
  
  // Override res.end to log the response
  const originalEnd = res.end;
  res.end = function(chunk, encoding) {
    const duration = Date.now() - startTime;
    const statusCode = res.statusCode;
    
    // Log the response
    const logLevel = statusCode >= 400 ? 'error' : 'info';
    logToExternalService(
      'backend', 
      logLevel, 
      'middleware', 
      `Response sent: ${req.method} ${req.url} - Status: ${statusCode} - Duration: ${duration}ms`
    );
    
    // Call the original res.end
    originalEnd.call(this, chunk, encoding);
  };
  
  next();
};

/**
 * Utility function for manual logging from other parts of the application
 */
const logMessage = (stack, level, package, message) => {
  return logToExternalService(stack, level, package, message);
};

module.exports = {
  loggingMiddleware,
  logMessage,
  logToExternalService
};
