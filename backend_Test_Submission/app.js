const express = require('express');
const mongoose = require('mongoose');
const shortid = require('shortid');
const morgan = require('morgan');
const cors = require('cors');
const { loggingMiddleware, logMessage } = require('../logging_middleware/logging');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(morgan('dev')); // HTTP request logging
app.use(loggingMiddleware); // Custom logging middleware

// MongoDB Connection
mongoose.connect('mongodb://127.0.0.1:27017/urlShortener').then(() => {
  console.log('MongoDB connected successfully');
  logMessage('backend', 'info', 'database', 'MongoDB connection established');
}).catch(err => {
  console.error('MongoDB connection error:', err);
  logMessage('backend', 'error', 'database', `MongoDB connection failed: ${err.message}`);
});

// URL Schema
const urlSchema = new mongoose.Schema({
  originalUrl: { 
    type: String, 
    required: true,
    validate: {
      validator: function(v) {
        return /^https?:\/\/.+/.test(v);
      },
      message: 'URL must be a valid HTTP or HTTPS URL'
    }
  },
  shortUrl: { 
    type: String, 
    required: true, 
    unique: true 
  },
  createdAt: { 
    type: Date, 
    default: Date.now 
  },
  accessCount: {
    type: Number,
    default: 0
  }
});

const Url = mongoose.model('Url', urlSchema);

// Health check endpoint
app.post('/health', async (req, res) => {
  try {
    logMessage('backend', 'info', 'health', 'Health check requested');
    
    const dbStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
    
    res.status(200).json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      database: dbStatus,
      uptime: process.uptime()
    });
  } catch (error) {
    logMessage('backend', 'error', 'health', `Health check failed: ${error.message}`);
    res.status(500).json({
      status: 'unhealthy',
      error: error.message
    });
  }
});

// Route: Shorten URL (POST only)
app.post('/shorten', async (req, res) => {
  try {
    const { originalUrl } = req.body;
    
    if (!originalUrl) {
      logMessage('backend', 'error', 'handler', 'Missing originalUrl in request body');
      return res.status(400).json({ 
        error: 'originalUrl is required in request body' 
      });
    }

    // Validate URL format
    if (!/^https?:\/\/.+/.test(originalUrl)) {
      logMessage('backend', 'error', 'handler', `Invalid URL format: ${originalUrl}`);
      return res.status(400).json({ 
        error: 'Invalid URL format. Must be a valid HTTP or HTTPS URL' 
      });
    }

    // Check if URL already exists
    const existingUrl = await Url.findOne({ originalUrl });
    if (existingUrl) {
      logMessage('backend', 'info', 'handler', `URL already shortened: ${originalUrl}`);
      return res.status(200).json({
        message: 'URL already shortened',
        originalUrl: existingUrl.originalUrl,
        shortUrl: existingUrl.shortUrl,
        createdAt: existingUrl.createdAt
      });
    }

    // Generate unique short URL
    let shortUrl;
    let isUnique = false;
    let attempts = 0;
    const maxAttempts = 10;

    while (!isUnique && attempts < maxAttempts) {
      shortUrl = shortid.generate();
      const exists = await Url.findOne({ shortUrl });
      if (!exists) {
        isUnique = true;
      }
      attempts++;
    }

    if (!isUnique) {
      logMessage('backend', 'error', 'handler', 'Failed to generate unique short URL after multiple attempts');
      return res.status(500).json({ 
        error: 'Failed to generate unique short URL' 
      });
    }

    // Create new URL record
    const newUrl = new Url({ originalUrl, shortUrl });
    await newUrl.save();

    logMessage('backend', 'info', 'handler', `URL shortened successfully: ${originalUrl} -> ${shortUrl}`);

    res.status(201).json({
      message: 'URL shortened successfully',
      originalUrl: newUrl.originalUrl,
      shortUrl: newUrl.shortUrl,
      shortUrlFull: `${req.protocol}://${req.get('host')}/${newUrl.shortUrl}`,
      createdAt: newUrl.createdAt
    });

  } catch (error) {
    logMessage('backend', 'error', 'handler', `Error shortening URL: ${error.message}`);
    res.status(500).json({ 
      error: 'Internal server error while shortening URL' 
    });
  }
});

// Route: Get URL info (POST method to maintain consistency)
app.post('/url-info', async (req, res) => {
  try {
    const { shortUrl } = req.body;
    
    if (!shortUrl) {
      logMessage('backend', 'error', 'handler', 'Missing shortUrl in request body');
      return res.status(400).json({ 
        error: 'shortUrl is required in request body' 
      });
    }

    const url = await Url.findOne({ shortUrl });
    if (!url) {
      logMessage('backend', 'error', 'handler', `Short URL not found: ${shortUrl}`);
      return res.status(404).json({ 
        error: 'Short URL not found' 
      });
    }

    logMessage('backend', 'info', 'handler', `URL info retrieved: ${shortUrl}`);

    res.status(200).json({
      originalUrl: url.originalUrl,
      shortUrl: url.shortUrl,
      shortUrlFull: `${req.protocol}://${req.get('host')}/${url.shortUrl}`,
      createdAt: url.createdAt,
      accessCount: url.accessCount
    });

  } catch (error) {
    logMessage('backend', 'error', 'handler', `Error retrieving URL info: ${error.message}`);
    res.status(500).json({ 
      error: 'Internal server error while retrieving URL info' 
    });
  }
});

// Route: Redirect to Original URL (POST method to maintain consistency)
app.post('/redirect', async (req, res) => {
  try {
    const { shortUrl } = req.body;
    
    if (!shortUrl) {
      logMessage('backend', 'error', 'handler', 'Missing shortUrl in request body');
      return res.status(400).json({ 
        error: 'shortUrl is required in request body' 
      });
    }

    const url = await Url.findOne({ shortUrl });
    if (!url) {
      logMessage('backend', 'error', 'handler', `Short URL not found: ${shortUrl}`);
      return res.status(404).json({ 
        error: 'Short URL not found' 
      });
    }

    // Increment access count
    url.accessCount += 1;
    await url.save();

    logMessage('backend', 'info', 'handler', `Redirecting: ${shortUrl} -> ${url.originalUrl}`);

    res.status(200).json({
      redirectUrl: url.originalUrl,
      accessCount: url.accessCount
    });

  } catch (error) {
    logMessage('backend', 'error', 'handler', `Error redirecting URL: ${error.message}`);
    res.status(500).json({ 
      error: 'Internal server error while redirecting URL' 
    });
  }
});

// Route: Get all URLs (POST method to maintain consistency)
app.post('/urls', async (req, res) => {
  try {
    const { limit = 10, page = 1 } = req.body;
    
    const skip = (page - 1) * limit;
    const urls = await Url.find()
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .select('-__v');

    const total = await Url.countDocuments();

    logMessage('backend', 'info', 'handler', `Retrieved ${urls.length} URLs (page ${page})`);

    res.status(200).json({
      urls: urls.map(url => ({
        ...url.toObject(),
        shortUrlFull: `${req.protocol}://${req.get('host')}/${url.shortUrl}`
      })),
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        totalUrls: total,
        limit: parseInt(limit)
      }
    });

  } catch (error) {
    logMessage('backend', 'error', 'handler', `Error retrieving URLs: ${error.message}`);
    res.status(500).json({ 
      error: 'Internal server error while retrieving URLs' 
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  logMessage('backend', 'error', 'middleware', `Unhandled error: ${err.message}`);
  res.status(500).json({ 
    error: 'Internal server error' 
  });
});

// 404 handler for undefined routes
app.use('*', (req, res) => {
  logMessage('backend', 'error', 'handler', `Route not found: ${req.method} ${req.originalUrl}`);
  res.status(404).json({ 
    error: 'Route not found. This service only supports POST methods.' 
  });
});

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`URL Shortener Microservice running on http://localhost:${PORT}`);
  logMessage('backend', 'info', 'server', `Server started on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logMessage('backend', 'info', 'server', 'SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  logMessage('backend', 'info', 'server', 'SIGINT received, shutting down gracefully');
  process.exit(0);
});
