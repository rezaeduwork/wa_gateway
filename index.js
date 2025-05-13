require('dotenv').config();
// Add Web Crypto API polyfill to fix "Cannot destructure property 'subtle' of 'globalThis.crypto'" error
const { Crypto } = require('@peculiar/webcrypto');
const crypto = new Crypto();
// Add crypto to global object to make it available to Baileys library
globalThis.crypto = crypto;

const express = require('express');
const { join } = require('path');
const cors = require('cors');
const { initWhatsappConnection, syncConnectionsFromLaravel } = require('./services/whatsappService');
const apiController = require('./controllers/apiController');

const app = express();
const port = process.env.PORT || 3000;

// Enhanced CORS options for SSE support - allow all origins in development
const corsOptions = {
  origin: process.env.ALLOWED_ORIGINS || '*', // More permissive in development
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['Content-Type']
};

// Apply CORS middleware
app.use(cors(corsOptions));
app.use(express.json());

// Silent request logging middleware
app.use((req, res, next) => {
  // console.log removed
  next();
});

// Silent error handling middleware
app.use((err, req, res, next) => {
  console.error(`Error processing request: ${err.message}`);
  console.error(err.stack);
  res.status(500).json({
    error: 'Internal Server Error',
    message: err.message
  });
});

// Routes
app.use('/api', require('./routes/api'));

// Direct SSE endpoint with authentication
app.get('/events', apiController.validateApiRequest, apiController.eventsHandler);

// Add explicit route for the root path
app.get('/', (req, res) => {
  res.json({
    name: 'WhatsApp Gateway API',
    status: 'online',
    version: '1.0.0',
    endpoints: [
      '/api/status',
      '/api/init-connection',
      '/api/send-message',
      '/health'
    ],
    documentation: 'To access the API, use the endpoints listed above with proper authentication'
  });
});

// Health check route
app.get('/health', (req, res) => {
  res.send({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    environment: {
      nodejs: process.version,
      platform: process.platform,
      connections: require('./services/whatsappService').qrEmitters.size
    }
  });
});

// Start server
app.listen(port, '0.0.0.0', async () => {
  // console.log statements removed
  
  // Check for default connection ID in environment
  const defaultConnectionId = process.env.WHATSAPP_GATEWAY_DEFAULT_CONNECTION_ID;
  
  if (defaultConnectionId) {
    try {
      // Initialize Whatsapp connection at startup if ID is provided
      await initWhatsappConnection(defaultConnectionId);
    } catch (error) {
      console.error(`Error initializing default connection: ${error.message}`);
    }
  }
  
  // Sync active connections from Laravel
  setTimeout(async () => {
    try {
      const syncResult = await syncConnectionsFromLaravel();
    } catch (error) {
      console.error(`Error syncing connections from Laravel: ${error.message}`);
    }
  }, 5000); // Wait 5 seconds after startup to ensure Laravel is accessible
});

// Global error handlers to prevent crashes
process.on('uncaughtException', (err) => {
  console.error(`Uncaught Exception: ${err.message}`);
  console.error(err.stack);
  // Don't exit the process, just log the error
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit the process, just log the error
});