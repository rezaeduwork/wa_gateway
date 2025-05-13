const { 
  sendMessage, 
  sendMedia, 
  getConnectionStatus, 
  getAllConnectionStatuses,
  initWhatsappConnection, 
  disconnectConnection,
  qrEmitters, 
  connections 
} = require('../services/whatsappService');
const fs = require('fs');
const path = require('path');

// Get allowed domains from environment variables
const allowedDomains = process.env.ALLOWED_WEBHOOK_DOMAINS?.split(',') || [];
// Get API key for authentication
const apiSecretKey = process.env.API_SECRET_KEY;
// Check if we're in development mode
const isDevelopment = process.env.NODE_ENV === 'development' || !process.env.NODE_ENV;
const clients = new Map(); // Map to store connected clients for SSE by connectionId

/**
 * Middleware to validate that the request is coming from an authorized source
 */
exports.validateApiRequest = (req, res, next) => {
  const origin = req.get('origin');
  const authHeader = req.get('Authorization');
  
  // Logging removed
  
  // Skip validation in development mode
  if (isDevelopment) {
    // Logging removed
    return next();
  }
  
  // Check origin if defined
  if (allowedDomains.length > 0 && origin && !allowedDomains.includes(origin)) {
    // Logging removed
    return res.status(403).json({ error: 'Forbidden: Invalid origin' });
  }
  
  // Check API key if defined
  if (apiSecretKey) {
    if (!authHeader || authHeader !== `Bearer ${apiSecretKey}`) {
      // Logging removed
      return res.status(401).json({ error: 'Unauthorized: Invalid API key' });
    }
  }
  
  next();
};

exports.validateWebhookDomain = (req, res, next) => {
  const origin = req.get('origin');
  if (allowedDomains.length > 0 && (!origin || !allowedDomains.includes(origin))) {
    return res.status(403).json({ error: 'Forbidden: Invalid webhook domain' });
  }
  next();
};

exports.getStatus = async (req, res) => {
  try {
    const { connectionId } = req.query;
    
    if (connectionId) {
      // Get status for a specific connection
      const status = await getConnectionStatus(connectionId);
      res.json({ connectionId, status });
    } else {
      // Get status for all connections
      const allStatuses = await getAllConnectionStatuses();
      res.json({ connections: allStatuses });
    }
  } catch (error) {
    console.error(`Error getting connection status: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Initialize a new Whatsapp connection
 */
exports.initConnection = async (req, res) => {
  try {
    const { connectionId, refreshQr } = req.body;
    
    if (!connectionId) {
      return res.status(400).json({ error: 'Connection ID is required' });
    }
    
    // Check if this is a refresh QR request for an existing connection
    const isRefreshing = refreshQr === true;
    
    // Start the Whatsapp connection process with the specific connection ID
    // Pass the refreshQr flag to indicate this is just refreshing a QR code
    await initWhatsappConnection(connectionId, isRefreshing);
    
    res.json({ 
      success: true, 
      connectionId,
      message: isRefreshing 
        ? `Refreshing QR code for ${connectionId}` 
        : `WhatsApp connection initialized for ${connectionId}`
    });
  } catch (error) {
    console.error(`Error initializing connection (${req.body.connectionId}): ${error.message}`);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to initialize Whatsapp connection',
      details: error.message 
    });
  }
};

/**
 * Disconnect a specific WhatsApp connection
 */
exports.disconnectConnection = async (req, res) => {
  try {
    const { connectionId } = req.params;
    
    if (!connectionId) {
      return res.status(400).json({ error: 'Connection ID is required' });
    }
    
    const result = await disconnectConnection(connectionId);
    
    if (result.success) {
      res.json({
        success: true,
        connectionId,
        message: `WhatsApp connection ${connectionId} disconnected`
      });
    } else {
      res.status(404).json({
        success: false,
        connectionId,
        message: result.message
      });
    }
  } catch (error) {
    console.error(`Error disconnecting connection (${req.params.connectionId}): ${error.message}`);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Get all active connections
 */
exports.getConnections = async (req, res) => {
  try {
    const allStatuses = await getAllConnectionStatuses();
    const connectionsList = Object.entries(allStatuses).map(([id, status]) => ({
      id,
      status
    }));
    
    res.json({
      success: true,
      connections: connectionsList
    });
  } catch (error) {
    console.error(`Error getting all connections: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Server-Sent Events handler for QR code and connection updates
 */
exports.eventsHandler = async (req, res) => {
  let { connectionId } = req.params;
  
  try {
    // Set default connection ID if not provided
    if (!connectionId) {
      connectionId = 'default';
      // Logging removed
    }
    
    // Logging removed
    
    // Try to initialize the connection if it doesn't exist
    if (!qrEmitters.has(connectionId)) {
      // Logging removed
      try {
        await initWhatsappConnection(connectionId);
        // Logging removed
      } catch (error) {
        console.error(`Error initializing connection in eventsHandler (${connectionId}): ${error.message}`);
        return res.status(500).json({ 
          error: 'Failed to initialize WhatsApp connection',
          message: error.message,
          connectionId: connectionId
        });
      }
    }
    
    // Get the QR emitter for this specific connection
    const qrEmitter = qrEmitters.get(connectionId);
    
    if (!qrEmitter) {
      console.error(`No QR emitter found for connection ID: ${connectionId}`);
      return res.status(404).json({ 
        error: `No connection found for ID: ${connectionId}`,
        details: 'The connection may have been initialized but the QR emitter is missing'
      });
    }
    
    // Set headers for SSE
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no' // Important for Nginx proxying
    });

    // Generate a unique client ID for this connection
    const clientId = `${connectionId}-${Date.now()}`;

    // Initialize clients map for this connection if it doesn't exist
    if (!clients.has(connectionId)) {
      clients.set(connectionId, []);
    }

    // Add client to the connected clients list for this connection
    clients.get(connectionId).push({
      id: clientId,
      res
    });

    // Logging removed

    // Send initial ping to ensure the connection is working
    const initialData = JSON.stringify({
      message: 'connected',
      timestamp: new Date().toISOString(),
      connectionId: connectionId,
      clientId: clientId
    });
    res.write(`event: ping\ndata: ${initialData}\n\n`);

    // Check current status and send it immediately
    try {
      const currentStatus = await getConnectionStatus(connectionId);
      const statusData = JSON.stringify({ 
        status: currentStatus,
        timestamp: new Date().toISOString() 
      });
      // Logging removed
      res.write(`event: connection\ndata: ${statusData}\n\n`);
    } catch (error) {
      console.error(`Error getting connection status for SSE (${connectionId}): ${error.message}`);
      // Logging removed
    }

    // Function to send QR code when it's received
    const qrListener = qrCode => {
      const data = JSON.stringify({ 
        qr: qrCode,
        timestamp: new Date().toISOString() 
      });
      // Logging removed
      res.write(`event: qr\ndata: ${data}\n\n`);
    };

    // Function to send connection updates
    const connectionListener = status => {
      const data = JSON.stringify({ 
        status,
        timestamp: new Date().toISOString() 
      });
      // Logging removed
      res.write(`event: connection\ndata: ${data}\n\n`);
    };

    // Function to send connection errors
    const errorListener = error => {
      const data = JSON.stringify({ 
        error: error.message || 'Unknown error',
        timestamp: new Date().toISOString() 
      });
      // Logging removed
      res.write(`event: error\ndata: ${data}\n\n`);
    };

    // Keep connection alive by sending periodic pings
    const pingInterval = setInterval(() => {
      res.write(`event: ping\ndata: ${new Date().toISOString()}\n\n`);
    }, 30000); // Every 30 seconds

    // Register event listeners
    qrEmitter.on('qr', qrListener);
    qrEmitter.on('connection', connectionListener);
    qrEmitter.on('error', errorListener);
    
    // Remove client from the list and clean up event listeners when connection is closed
    req.on('close', () => {
      // Logging removed
      qrEmitter.removeListener('qr', qrListener);
      qrEmitter.removeListener('connection', connectionListener);
      qrEmitter.removeListener('error', errorListener);
      
      clearInterval(pingInterval);
      
      if (clients.has(connectionId)) {
        const connectionClients = clients.get(connectionId);
        const index = connectionClients.findIndex(client => client.id === clientId);
        if (index !== -1) {
          connectionClients.splice(index, 1);
          // If no clients are left for this connection, remove the key
          if (connectionClients.length === 0) {
            clients.delete(connectionId);
          }
        }
      }
    });
  } catch (error) {
    console.error(`Error in eventsHandler: ${error.message}`);
    console.error(error.stack);
    res.status(500).json({
      error: 'Internal server error in events handler',
      message: error.message
    });
  }
};

exports.sendText = async (req, res) => {
  const { connectionId, number, message } = req.body;
  
  if (!connectionId) {
    return res.status(400).json({ error: 'Connection ID is required' });
  }
  
  try {
    await sendMessage(connectionId, number, message);
    res.json({ success: true, connectionId });
  } catch (error) {
    console.error(`Error sending text message (${connectionId} to ${number}): ${error.message}`);
    res.status(500).json({ error: 'Failed to send message', details: error.message });
  }
};

exports.sendImage = async (req, res) => {
  const { connectionId, number, image, caption } = req.body;
  
  if (!connectionId) {
    return res.status(400).json({ error: 'Connection ID is required' });
  }
  
  if (!image) {
    return res.status(400).json({ error: 'Image URL is required' });
  }
  
  try {
    await sendMedia(connectionId, number, image, 'image', caption || '');
    res.json({ 
      success: true, 
      connectionId,
      message: 'Image sent successfully'
    });
  } catch (error) {
    console.error(`Error sending image (${connectionId} to ${number}): ${error.message}`);
    res.status(500).json({ 
      success: false,
      error: 'Failed to send image', 
      details: error.message 
    });
  }
};

/**
 * Send an audio message
 */
exports.sendAudio = async (req, res) => {
  const { connectionId, number, audio } = req.body;
  
  if (!connectionId) {
    return res.status(400).json({ error: 'Connection ID is required' });
  }
  
  try {
    await sendMedia(connectionId, number, audio, 'audio');
    res.json({ success: true, connectionId });
  } catch (error) {
    console.error(`Error sending audio (${connectionId} to ${number}): ${error.message}`);
    res.status(500).json({ error: 'Failed to send audio', details: error.message });
  }
};

/**
 * Broadcast a message to multiple recipients
 */
exports.broadcast = async (req, res) => {
  const { connectionId, numbers, message, media, type } = req.body;
  
  if (!connectionId) {
    return res.status(400).json({ error: 'Connection ID is required' });
  }
  
  if (!Array.isArray(numbers) || numbers.length === 0) {
    return res.status(400).json({ error: 'Invalid recipient numbers. Must be a non-empty array.' });
  }
  
  try {
    const results = [];
    let hasErrors = false;
    
    // Simple text broadcast
    if (!media) {
      for (const number of numbers) {
        try {
          await sendMessage(connectionId, number, message);
          results.push({ number, status: 'success' });
        } catch (error) {
          console.error(`Error in broadcast to ${number}: ${error.message}`);
          results.push({ number, status: 'error', error: error.message });
          hasErrors = true;
        }
      }
    } 
    // Media broadcast
    else {
      for (const number of numbers) {
        try {
          await sendMedia(connectionId, number, media, type || 'image');
          results.push({ number, status: 'success' });
        } catch (error) {
          console.error(`Error in media broadcast to ${number}: ${error.message}`);
          results.push({ number, status: 'error', error: error.message });
          hasErrors = true;
        }
      }
    }
    
    res.json({ 
      success: !hasErrors, 
      partial: hasErrors, 
      connectionId,
      results 
    });
  } catch (error) {
    console.error(`Error in broadcast from ${connectionId}: ${error.message}`);
    res.status(500).json({ error: 'Failed to broadcast message', details: error.message });
  }
};

/**
 * Register a webhook for specific events
 */
exports.registerWebhook = async (req, res) => {
  const { type, url } = req.body;
  
  if (!type || !url) {
    return res.status(400).json({ error: 'Type and URL are required' });
  }
  
  // You might want to store this in a database or configuration file in a real application
  // For now, we'll just acknowledge the webhook registration
  
  // Logging removed
  
  res.json({ 
    success: true,
    message: `Successfully registered webhook for ${type} events`
  });
};

/**
 * Get QR code for a specific connection
 * This endpoint allows retrieving QR codes via regular HTTP instead of SSE
 */
exports.getQrCode = async (req, res) => {
  try {
    const { connectionId } = req.query;
    
    // Logging removed
    
    if (!connectionId) {
      return res.status(400).json({ error: 'Connection ID is required' });
    }
    
    // Check if the connection exists
    if (!connections.has(connectionId)) {
      // If connection doesn't exist yet, initialize it
      try {
        // Logging removed
        await initWhatsappConnection(connectionId);
      } catch (error) {
        console.error(`Error initializing connection for QR code (${connectionId}): ${error.message}`);
        return res.status(500).json({ 
          success: false,
          error: 'Failed to initialize WhatsApp connection',
          message: error.message
        });
      }
    }
    
    // Get the stored QR code for this connection
    // Make sure global.qrCodes exists
    if (!global.qrCodes) {
      // Logging removed
      global.qrCodes = new Map();
    }
    
    const cachedQr = global.qrCodes.get(connectionId);
    // Logging removed
    
    const emitter = qrEmitters.get(connectionId);
    
    // If we have a QR code already, return it immediately
    if (cachedQr) {
      // Logging removed
      return res.json({
        success: true,
        qr: cachedQr,  // This is what the API returns
        timestamp: Date.now()
      });
    }
    
    // No cached QR code, return information about the connection
    // Logging removed
    return res.json({
      success: false,
      message: 'QR code not available yet. Please try again.',
      hasEmitter: !!emitter,
      connectionExists: connections.has(connectionId),
      cacheSize: global.qrCodes.size
    });
  } catch (error) {
    console.error(`Error getting QR code (${req.query.connectionId}): ${error.message}`);
    // Logging removed
    res.status(500).json({
      success: false,
      error: 'Failed to get QR code',
      message: error.message
    });
  }
};

/**
 * Get messages for a specific connection
 * This allows retrieving historical messages for syncing with Laravel
 */
exports.getMessages = async (req, res) => {
  try {
    const { connectionId } = req.params;
    const { since } = req.query;
    
    if (!connectionId) {
      return res.status(400).json({ error: 'Connection ID is required' });
    }
    
    // Check if the connection exists
    if (!connections.has(connectionId)) {
      return res.status(404).json({ 
        success: false,
        error: `Connection ${connectionId} not found`,
        message: 'The connection ID provided does not exist'
      });
    }
    
    // Logging removed
    
    const sock = connections.get(connectionId);
    if (!sock.store) {
      return res.status(500).json({
        success: false,
        error: 'Store not available',
        message: 'The message store is not available for this connection'
      });
    }
    
    let messages = [];
    try {
      // Get all messages from the store
      const chats = await sock.store.chats.all();
      
      // Process timestamp if provided
      const sinceTimestamp = since ? parseInt(since) * 1000 : 0; // Convert to milliseconds
      
      // Get messages from each chat
      for (const chat of chats) {
        try {
          const jid = chat.id;
          // Skip status broadcasts, etc.
          if (jid === 'status@broadcast') continue;
          
          // Fetch messages from store
          const chatMessages = await sock.store.messages.get(jid);
          
          if (!chatMessages) continue;
          
          // Filter by timestamp if needed
          const filteredMessages = since ? 
            chatMessages.filter(msg => new Date(msg.messageTimestamp * 1000) > new Date(sinceTimestamp)) : 
            chatMessages;
          
          messages = [...messages, ...filteredMessages];
        } catch (chatError) {
          console.error(`Error getting messages for chat in ${connectionId}: ${chatError.message}`);
          // Logging removed
        }
      }
      
      // Logging removed
      
      // Sort by timestamp (newest first)
      messages.sort((a, b) => b.messageTimestamp - a.messageTimestamp);
      
      res.json({
        success: true,
        data: {
          connectionId,
          count: messages.length,
          messages: messages
        }
      });
    } catch (storeError) {
      console.error(`Error accessing message store for ${connectionId}: ${storeError.message}`);
      // Logging removed
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve messages',
        message: storeError.message
      });
    }
  } catch (error) {
    console.error(`Error in getMessages for ${req.params.connectionId}: ${error.message}`);
    // Logging removed
    res.status(500).json({
      success: false,
      error: 'Failed to get messages',
      message: error.message
    });
  }
};

/**
 * Mark messages from a specific sender as read
 */
exports.markAsRead = async (req, res) => {
  try {
    const { connectionId, number, messageId } = req.body;
    
    if (!connectionId) {
      return res.status(400).json({ error: 'Connection ID is required' });
    }
    
    if (!number) {
      return res.status(400).json({ error: 'Sender number is required' });
    }
    
    // Check if the connection exists
    if (!connections.has(connectionId)) {
      return res.status(404).json({ 
        success: false,
        error: `Connection ${connectionId} not found`
      });
    }
    
    const sock = connections.get(connectionId);
    
    try {
      // Format the number to JID format if needed
      const jid = number.includes('@') ? number : `${number}@s.whatsapp.net`;
      
      // Read all unread messages if no specific messageId is provided
      if (messageId) {
        // Mark specific message as read
        await sock.readMessages([{ key: { remoteJid: jid, id: messageId } }]);
        console.log(`[${connectionId}] Marked specific message ${messageId} from ${number} as read`);
      } else {
        // Mark all unread messages as read
        await sock.chatModify({ markRead: true }, jid, []);
        console.log(`[${connectionId}] Marked all messages from ${number} as read`);
      }
      
      res.json({ 
        success: true,
        connectionId,
        number,
        message: messageId ? `Marked message ${messageId} as read` : 'Marked all messages as read'
      });
    } catch (error) {
      console.error(`[${connectionId}] Error marking messages as read:`, error);
      res.status(500).json({ 
        success: false,
        error: 'Failed to mark messages as read',
        details: error.message
      });
    }
  } catch (error) {
    console.error(`Error in markAsRead: ${error.message}`);
    res.status(500).json({
      success: false,
      error: 'Failed to mark messages as read',
      message: error.message
    });
  }
};