const express = require('express');
const router = express.Router();
const apiController = require('../controllers/apiController');

// Apply API validation middleware to all routes
router.use(apiController.validateApiRequest);

// Status endpoints
router.get('/status', apiController.getStatus);
router.get('/connections', apiController.getConnections);

// Connection management endpoints
router.post('/connection', apiController.initConnection);
router.delete('/connection/:connectionId', apiController.disconnectConnection);

// Get QR code endpoint (for HTTP polling instead of SSE)
router.get('/qr-code', apiController.getQrCode);

// Server-Sent Events endpoint for QR code and connection status updates
router.get('/events', apiController.eventsHandler); // Add route for default connection
router.get('/events/:connectionId', apiController.eventsHandler);

// Message endpoints
router.post('/send-message', apiController.sendText);
router.post('/send-image', apiController.sendImage);
router.post('/send-audio', apiController.sendAudio);
router.post('/broadcast', apiController.broadcast);
router.post('/mark-as-read', apiController.markAsRead); // New endpoint to mark messages as read
router.get('/messages/:connectionId', apiController.getMessages); // New endpoint to fetch messages

// Webhook registration
router.post('/register-webhook', apiController.registerWebhook);

// For backward compatibility
router.post('/init-connection', apiController.initConnection);

module.exports = router;