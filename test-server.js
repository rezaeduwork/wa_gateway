const express = require('express');
const app = express();
const port = 3000;

// Parse JSON requests
app.use(express.json());

// Add error handling middleware
app.use((err, req, res, next) => {
  console.error(`Error processing request: ${err.message}`);
  console.error(err.stack);
  res.status(500).json({
    error: 'Internal Server Error',
    message: err.message
  });
});

// Root path
app.get('/', (req, res) => {
  res.json({ 
    message: 'Test server is running correctly',
    timestamp: new Date().toISOString()
  });
});

// Add the API routes that Laravel is trying to access
app.use('/api', (req, res, next) => {
  // Request logging removed
  next();
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy' });
});

// Status endpoint
app.get('/api/status', (req, res) => {
  res.json({ status: 'connected' });
});

// Init connection endpoint - the one Laravel is trying to use
app.post('/api/init-connection', (req, res) => {
  try {
    // Log removed
    res.json({ 
      success: true,
      message: 'Connection initialized successfully',
      connectionId: req.body.connectionId || 'default'
    });
  } catch (error) {
    console.error(`Error initializing test connection: ${error.message}`);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Start server on all interfaces
app.listen(port, '0.0.0.0', () => {
  // Startup logs removed
});