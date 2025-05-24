const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const EventEmitter = require('events');
const { writeLog } = require('../helpers/log');

// Create a connections map to store multiple WhatsApp connections
const connections = new Map();
// Create a map to store message queues for each connection
const messageQueues = new Map();
// Create a map to store emitters for each connection
const qrEmitters = new Map();

// Add QR code storage at the beginning of the file
// This will be used to store QR codes for HTTP retrieval
if (!global.qrCodes) {
  global.qrCodes = new Map();
}

// Create a custom logger that implements the child() method
class CustomLogger {
  constructor(connectionId) {
    this.connectionId = connectionId;
  }

  // Helper method to format objects for logging
  formatValue(value) {
    if (typeof value === 'object') {
      try {
        // For large objects, just show type to avoid console spam
        if (value && typeof value === 'object' && value.constructor) {
          return JSON.stringify(value, null, 2);
          // return `[${value.constructor.name} object]`;
        }
        return '[Object]';
      } catch (e) {
        return '[Object]';
      }
    }
    return value;
  }

  info(message) {
    // Info logging removed
  }

  warn(message) {
    // Keep warning logs for important issues
    // const formattedMessage = this.formatValue(message);
    // console.warn(`[${this.connectionId}] WARN: ${formattedMessage}`);
  }

  error(message) {
    // Keep error logs
    const formattedMessage = this.formatValue(message);
    console.error(`[${this.connectionId}] ERROR: ${formattedMessage}`);
  }

  debug(message) {
    // Skip debug logs for better readability
  }

  trace(message) {
    // Skip trace logs for better readability
  }

  // Implement the child method required by Baileys
  child(options) {
    return new CustomLogger(`${this.connectionId}:${options.prefix || ''}`);
  }
}

// Export the connections map for external access
exports.connections = connections;
exports.qrEmitters = qrEmitters;

// Get Laravel backend webhook URL from environment variable
const laravelWebhookUrl = process.env.LARAVEL_WEBHOOK_URL || 'http://127.0.0.1:8000/api/webhook/whatsapp';
const customHeaders = { 
  Authorization: `Bearer ${process.env.WEBHOOK_AUTH_TOKEN}`,
  'Content-Type': 'application/json'
};

/**
 * Initialize auth state for a specific connection
 * @param {string} connectionId - Unique identifier for the connection
 */
const initAuthState = async (connectionId) => {
  // Create auth folder for this specific connection if it doesn't exist
  const connectionAuthPath = path.join(__dirname, '../auth_info_baileys', connectionId);
  if (!fs.existsSync(connectionAuthPath)) {
    fs.mkdirSync(connectionAuthPath, { recursive: true });
  }
  
  const authState = await useMultiFileAuthState(connectionAuthPath);
  return authState;
};

/**
 * Enqueue a message for a specific connection
 */
function enqueueMessage(connectionId, message) {
  if (!messageQueues.has(connectionId)) {
    messageQueues.set(connectionId, []);
  }
  messageQueues.get(connectionId).push(message);
}

/**
 * Process message queue for a specific connection
 */
async function processMessageQueue(connectionId) {
  if (!connections.has(connectionId)) return;
  
  const sock = connections.get(connectionId);
  const queue = messageQueues.get(connectionId) || [];
  
  while (queue.length > 0) {
    const message = queue.shift();
    try {
      await sock.sendMessage(message.number, message.content);
      // Success log removed
      
      // Notify Laravel backend about message sent
      await notifyLaravelBackend({
        connectionId,
        type: 'message_sent',
        status: 'success',
        data: message
      });
    } catch (error) {
      // Keep error logging
      console.error(`[${connectionId}] Failed to send message from queue:`, error);
      queue.push(message); // Re-enqueue the message for retry
      
      // Notify Laravel backend about message failure
      await notifyLaravelBackend({
        connectionId,
        type: 'message_failure',
        status: 'failed',
        error: error.message,
        data: message
      });
    }
  }
}

// Start queue processing for all connections
setInterval(() => {
  connections.forEach((_, connectionId) => {
    processMessageQueue(connectionId);
  });
}, 1000);

/**
 * Send notification to Laravel backend
 */
async function notifyLaravelBackend(payload) {
  try {
    // Make sure we always include the Authorization header
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.WEBHOOK_AUTH_TOKEN || 'simple_api_token_123'}`
    };
    
    // Get Laravel webhook URL from environment variable
    const primaryWebhookUrl = process.env.LARAVEL_WEBHOOK_URL || 'http://127.0.0.1:8000/api/webhook/whatsapp';
    let payloadNew = {data: payload};
    
    try {
      if (payload.type) {
        payloadNew['type'] = payload.type;
      }
      if (payload.connectionId) {
        payloadNew['connectionId'] = payload.connectionId;
      }
      // First try the primary webhook URL
      const response = await axios.post(primaryWebhookUrl, payloadNew, { headers, timeout: 5000 });
      const data = await response.data;
      if (!data) {
        // Keep error logging
        console.error('Error: Failed to notify Laravel backend');
      }
      return;
    } catch (primaryError) {
      // Keep error logging
      console.error(`Failed to notify webhook (${primaryWebhookUrl}): ${primaryError.message}`);
      try {
        writeLog(payloadNew['type'].replace(' ','_')+String(Math.floor(Date.now() / 60000))+'.log', JSON.stringify(payloadNew));      
      } catch (error) {}
    }
  } catch (error) {
    // Keep error logging
    console.error(`Failed to notify any Laravel backend: ${error.message}`);
    if (error.code === 'ECONNREFUSED') {
      console.error('Make sure Laravel is running and accessible at the correct address');
      console.error('Current webhook URL: ' + (process.env.LARAVEL_WEBHOOK_URL || 'http://127.0.0.1:8000/api/webhook/whatsapp'));
    }
  }
}

/**
 * Legacy function for backward compatibility
 * Redirects to the new notifyLaravelBackend function
 */
async function notifyWebhook(url, payload) {
  // Log removed
  return notifyLaravelBackend(payload);
}

/**
 * Initialize a Whatsapp connection with a specific connectionId
 * @param {string} connectionId - Unique identifier for the connection (e.g., phone number or user ID)
 * @param {boolean} isRefreshingQr - Whether this is just a QR code refresh request
 */
exports.initWhatsappConnection = async (connectionId, isRefreshingQr = false) => {
  if (!connectionId) {
    throw new Error('Connection ID is required');
  }

  // Log removed
  
  try {
    // Check if connection already exists
    if (connections.has(connectionId)) {
      const existingConnection = connections.get(connectionId);
      
      // If this is a QR refresh request and we're already in connecting state
      if (isRefreshingQr && existingConnection && !existingConnection.user) {
        console.log(`[${connectionId}] Refreshing QR code for connection in connecting state`);
        
        // For QR refresh in connecting state, we'll trigger a new QR code
        // without full disconnection/reconnection cycle
        
        // Get the QR emitter for this connection
        const qrEmitter = qrEmitters.get(connectionId);
        if (qrEmitter) {
          // Reset the connection state to force a new QR code
          qrEmitter.emit('refreshQr');
        }
        
        return existingConnection;
      }
      
      // For a regular connection that's already authenticated
      if (existingConnection?.user) {
        console.log(`[${connectionId}] Connection is already authenticated`);
        
        // Emit the current connection state to any listeners
        const qrEmitter = qrEmitters.get(connectionId);
        if (qrEmitter) {
          qrEmitter.emit('connection', 'connected');
        }
        
        return existingConnection;
      } else {
        // Log removed
        try {
          existingConnection.end();
          connections.delete(connectionId);
        } catch (err) {
          // Keep error logging
          console.error(`[${connectionId}] Error closing existing connection:`, err);
          // Continue with initialization even if closing fails
        }
      }
    }
      // Create a new emitter for this connection if it doesn't exist
    if (!qrEmitters.has(connectionId)) {
      qrEmitters.set(connectionId, new EventEmitter());
    }
    const qrEmitter = qrEmitters.get(connectionId);
    
    // Set up a listener for QR refresh events
    qrEmitter.on('refreshQr', () => {
      console.log(`[${connectionId}] QR code refresh requested`);
      
      // Trigger generation of a new QR code if possible
      if (sock && typeof sock.requestNewQR === 'function') {
        sock.requestNewQR();
      } else {
        console.log(`[${connectionId}] Manual QR code refresh not supported by the library version, falling back to connection reset`);
        // If the library doesn't support direct QR refresh, we'll need to notify about this
        // and handle it differently in the UI
        qrEmitter.emit('error', { 
          type: 'qr_refresh_error',
          message: 'QR code refresh not supported by this WhatsApp library version'
        });
      }
    });
    
    // Initialize auth state for this connection
    const { state, saveCreds } = await initAuthState(connectionId);
    
    // Create custom logger for this connection
    const logger = new CustomLogger(connectionId);
    
    // Create the socket for this connection with proper logger
    const sock = makeWASocket({ 
      auth: state,
      logger: logger,
      connectTimeoutMs: 5000,
      keepAliveIntervalMs: 5000
    });

    // Store the socket in connections map
    connections.set(connectionId, sock);

    // Add explicit event handlers for errors
    sock.ev.on('error', (err) => {
      // Keep error logging
      console.error(`[${connectionId}] Socket error:`, err);
      qrEmitter.emit('error', { message: err.message || 'Socket error' });
      // Don't rethrow, just log
    });
    
    // Add explicit error handlers for WebSocket errors
    if (sock.ws) {
      sock.ws.on('error', (err) => {
        // Keep error logging
        console.error(`[${connectionId}] WebSocket error:`, err);
        qrEmitter.emit('error', { message: err.message || 'WebSocket error' });
      });
    }
    
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      try {
        const { connection, lastDisconnect, qr } = update;
        
        // Remove non-error logging
        
        // Emit the QR code when available
        if (qr) {
          console.log(`[${connectionId}] New QR code generated`);
          
          // Store the QR code for HTTP polling
          global.qrCodes.set(connectionId, qr);
          
          // Emit for SSE clients
          qrEmitter.emit('qr', qr);
          
          // Send QR code to Laravel backend
          try {
            await notifyLaravelBackend({
              connectionId,
              type: 'qr_code',
              qr: qr
            });
            console.log(`[${connectionId}] QR code sent to Laravel backend`);
          } catch (notifyError) {
            // Keep error logging
            console.error(`[${connectionId}] Failed to notify Laravel about QR code:`, notifyError);
          }
        }
        
        // Handle connection status updates
        if (connection === 'open') {
          // Connection is successful, get user data
          const user = sock.user;
          console.log(`[${connectionId}] Connection successful for user:`, user.id);
          
          // Emit for SSE clients
          qrEmitter.emit('connection', 'connected');
          
          // Notify Laravel backend about successful connection with user data
          await notifyLaravelBackend({
            connectionId,
            type: 'connection_update',
            status: 'connected',
            user: {
              id: user.id
            }
          });
        }        if (connection === 'close') {
          // More detailed logging about the disconnect reason
          console.log(`[${connectionId}] Connection closed, analyzing disconnect reason:`, lastDisconnect);
          
          // Check if this is a user-initiated disconnect
          if (sock.userInitiatedDisconnect) {
            console.log(`[${connectionId}] This is a user-initiated disconnect, skipping reconnect`);
            
            // Emit the connection closed status
            qrEmitter.emit('connection', 'disconnected');
            
            // Notify Laravel backend about disconnection
            await notifyLaravelBackend({
              connectionId,
              type: 'connection_update',
              status: 'disconnected',
              userInitiated: true,
              message: 'User initiated disconnect'
            });
            
            // Skip reconnection for user-initiated disconnects
            return;
          }
          
          // Get error information if available
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          const errorMessage = lastDisconnect?.error?.message || 'Unknown reason';
          
          // Better shouldReconnect logic - only reconnect if there's an actual error
          // that isn't a logout AND isn't a user-initiated disconnect
          let shouldReconnect = false;
          
          if (lastDisconnect?.error) {
            // Only attempt reconnect if there's an actual error and it's not a logout
            shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            console.log(`[${connectionId}] Disconnect with error, status code: ${statusCode}, should reconnect: ${shouldReconnect}`);
          } else {
            // No error means this was likely a clean disconnect (either by user or app)
            console.log(`[${connectionId}] Clean disconnect without error, skipping reconnection`);
            shouldReconnect = false;
          }
          
          // Emit the connection closed status
          qrEmitter.emit('connection', 'disconnected');
          
          // Notify Laravel backend about disconnection with more details
          await notifyLaravelBackend({
            connectionId,
            type: 'connection_update',
            status: 'disconnected',
            user: sock.user,
            shouldReconnect: shouldReconnect,
            error: lastDisconnect?.error ? {
              statusCode,
              message: errorMessage
            } : undefined
          });
          
          if (shouldReconnect) {
            let retryCount = 0;
            const maxRetries = 5; // Limit retries to 5 attempts
            const retryInterval = 5000; // Retry every 5 seconds

            while (retryCount < maxRetries) {
              try {
                // Keep error logging for retries
                console.error(`[${connectionId}] Retrying connection... Attempt ${retryCount + 1}`);
                await exports.initWhatsappConnection(connectionId);
                console.log('restored connection after retrying');
                await notifyLaravelBackend({
                  connectionId,
                  type: 'connection_update',
                  status: 'connected',
                  user: {
                    id: sock.user?.id
                  }
                });
                break; // Exit loop on success
              } catch (error) {
                retryCount=retryCount+1;
                // Keep error logging
                console.error(`[${connectionId}] Retry attempt ${retryCount} failed:`, error);

                // Notify Laravel backend about retry attempt
                await notifyLaravelBackend({
                  connectionId,
                  type: 'retry_attempt',
                  status: 'retrying',
                  attempt: retryCount,
                  error: error.message
                });

                if (retryCount >= maxRetries) {
                  // Keep error logging
                  console.error(`[${connectionId}] Max retry attempts reached. Giving up.`);
                  
                  // Notify Laravel backend about max retry attempts reached
                  await notifyLaravelBackend({
                    connectionId,
                    type: 'retry_attempt',
                    status: 'failed',
                    maxRetriesReached: true
                  });
                  
                  break;
                }

                await new Promise((resolve) => setTimeout(resolve, retryInterval));
              }
            }
          }
        } 
      } catch (err) {
        // Keep error logging
        console.error(`[${connectionId}] Error handling connection update:`, err);
        qrEmitter.emit('error', { message: err.message || 'Connection update error' });
      }
    });    // Set up event handlers for messages and receipts
    sock.ev.on('messages.upsert', async (msg) => {
      // Remove non-error logging
      
      // Notify Laravel backend about incoming message - regular webhook
      await notifyLaravelBackend({
        connectionId,
        type: 'incoming_message',
        data: msg
      });
      
      // Also notify the WhatsApp bot webhook for bot processing
      try {
        const botWebhookUrl = process.env.WHATSAPP_BOT_WEBHOOK_URL || 'http://127.0.0.1:8000/api/webhook/whatsapp-bot';
        const headers = {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.WEBHOOK_AUTH_TOKEN || 'simple_api_token_123'}`
        };

        await axios.post(botWebhookUrl, {
          connectionId,
          type: 'incoming_message',
          data: msg
        }, { headers, timeout: 10000 });
        
        console.log(`[${connectionId}] Message forwarded to bot webhook`);
      } catch (botError) {
        console.error(`[${connectionId}] Failed to forward message to bot webhook: ${botError.message}`);
      }

      if (msg.messages) {
        for (const message of msg.messages) {
          if (message.key.fromMe) continue; // Skip outgoing messages

          // Notify Laravel backend about message status
          await notifyLaravelBackend({
            connectionId,
            type: 'message_status',
            status: 'received',
            data: message
          });
        }
      }
    });

    sock.ev.on('messages.update', async (updates) => {
      // Notify Laravel backend about message updates
      await notifyLaravelBackend({
        connectionId,
        type: 'message_update',
        data: updates
      });
    });

    sock.ev.on('message-receipt.update', async (receipts) => {
      // Notify Laravel backend about message receipts
      await notifyLaravelBackend({
        connectionId,
        type: 'message_receipt',
        data: receipts
      });
    });
    
    return sock;
  } catch (error) {
    // Keep error logging
    console.error(`[${connectionId}] Error initializing Whatsapp connection:`, error);
    
    // Create more detailed error notification
    const errorDetails = {
      message: error.message,
      stack: error.stack,
      code: error.code,
      name: error.name
    };
    
    // Notify Laravel backend about initialization error
    await notifyLaravelBackend({
      connectionId,
      type: 'connection_error',
      error: errorDetails
    });
    
    // If we have a QR emitter, emit an error event that the frontend can listen for
    if (qrEmitters.has(connectionId)) {
      qrEmitters.get(connectionId).emit('error', {
        type: 'initialization_error',
        message: error.message
      });
    }
    
    throw error;
  }
};

exports.getConnectionStatus = async (connectionId) => {
  if (!connectionId) {
    throw new Error('Connection ID is required');
  }
  
  const sock = connections.get(connectionId);
  return sock?.user ? 'connected' : 'disconnected';
};

exports.getAllConnectionStatuses = async () => {
  const statuses = {};
  for (const [connectionId, sock] of connections.entries()) {
    statuses[connectionId] = sock?.user ? 'connected' : 'disconnected';
  }
  return statuses;
};

exports.sendMessage = async (connectionId, number, message) => {
  if (!connectionId) {
    throw new Error('Connection ID is required');
  }
  
  const sock = connections.get(connectionId);
  if (!sock) {
    throw new Error(`No connection found for ID: ${connectionId}`);
  }
  
  try {
    const jid = `${number}@s.whatsapp.net`;
    const content = { text: message };
    await sock.sendMessage(jid, content);
    // Remove success logging
    
    // Notify Laravel backend about message sent
    await notifyLaravelBackend({
      connectionId,
      type: 'message_sent',
      status: 'success',
      number: number,
      message: message
    });
    
    return { success: true };
  } catch (error) {
    // Keep error logging
    console.error(`[${connectionId}] Failed to send message:`, error);
    
    // Notify Laravel backend about message failure
    await notifyLaravelBackend({
      connectionId,
      type: 'message_failure',
      status: 'failed',
      number: number,
      message: message,
      error: error.message
    });
    
    throw error;
  }
};

exports.sendMedia = async (connectionId, number, media, type, caption = '') => {
  if (!connectionId) {
    throw new Error('Connection ID is required');
  }
  
  const sock = connections.get(connectionId);
  if (!sock) {
    throw new Error(`No connection found for ID: ${connectionId}`);
  }
  
  try {
    const jid = `${number}@s.whatsapp.net`;
    let content = {};
    
    if (type === 'image') {
      content = {
        image: { url: media },
        caption: caption || undefined
      };
    } else if (type === 'audio') {
      content = {
        audio: { url: media },
        mimetype: 'audio/mp4'
      };
    } else if (type === 'document') {
      content = {
        document: { url: media },
        mimetype: 'application/pdf',
        fileName: caption || 'document.pdf'
      };
    } else if (type === 'video') {
      content = {
        video: { url: media },
        caption: caption || undefined
      };
    }
    
    // Send the media directly instead of enqueueing
    await sock.sendMessage(jid, content);
    // Remove success logging
    
    // Notify Laravel backend about message sent
    await notifyLaravelBackend({
      connectionId,
      type: 'message_sent',
      status: 'success',
      number: number,
      mediaType: type,
      mediaUrl: media,
      caption: caption
    });
    
    return { success: true };
  } catch (error) {
    // Keep error logging
    console.error(`[${connectionId}] Failed to send media message:`, error);
    
    // Notify Laravel backend about message failure
    await notifyLaravelBackend({
      connectionId,
      type: 'message_failure',
      status: 'failed',
      number: number,
      mediaType: type,
      mediaUrl: media,
      caption: caption,
      error: error.message
    });
    
    throw error;
  }
}

exports.getDeliveryConfirmation = async (req, res) => {
  const { connectionId, messageId } = req.query;
  if (!connectionId || !messageId) {
    return res.status(400).json({ error: 'Connection ID and Message ID are required' });
  }

  // Simulate fetching delivery confirmation from a database or in-memory store
  const deliveryStatus = { connectionId, messageId, status: 'delivered', timestamp: new Date().toISOString() };

  res.json(deliveryStatus);
};

exports.disconnectConnection = async (connectionId) => {
  if (!connectionId || !connections.has(connectionId)) {
    throw new Error(`No connection found for ID: ${connectionId}`);
  }
  
  const sock = connections.get(connectionId);
  if (sock) {
    try {
      // Set a flag to indicate this is a user-initiated disconnection
      sock.userInitiatedDisconnect = true;
        // Mark this connection as user-initiated disconnect to prevent auto-reconnect
      sock.userInitiatedDisconnect = true;
      console.log(`[${connectionId}] Setting userInitiatedDisconnect flag to prevent auto-reconnect`);
      
      // Safer way to modify the connection.update handler to prevent reconnection
      if (sock.ev && typeof sock.ev === 'object') {
        try {
          // Different versions of the library might store event handlers differently
          // This is a safer approach that checks all possible structures
          if (sock.ev._events && sock.ev._events['connection.update']) {
            const originalHandler = sock.ev._events['connection.update'];
            
            // Handle both array and single function cases
            if (Array.isArray(originalHandler)) {
              sock.ev._events['connection.update'] = async (update) => {
                // Skip reconnection logic for user-initiated disconnects
                if (update.connection === 'close' && sock.userInitiatedDisconnect) {
                  console.log(`[${connectionId}] User initiated disconnect detected, preventing auto-reconnect`);
                  return; // Don't process normal disconnect handler
                }
                
                // For other cases, call the original handlers
                for (const handler of originalHandler) {
                  if (typeof handler === 'function') {
                    await handler(update);
                  }
                }
              };
            } else if (typeof originalHandler === 'function') {
              // Single handler case
              sock.ev._events['connection.update'] = async (update) => {
                // Skip reconnection logic for user-initiated disconnects
                if (update.connection === 'close' && sock.userInitiatedDisconnect) {
                  console.log(`[${connectionId}] User initiated disconnect detected, preventing auto-reconnect`);
                  return; // Don't process normal disconnect handler
                }
                
                // Otherwise call the original handler
                await originalHandler(update);
              };
            }
          } else if (sock.ev.off && sock.ev.on && typeof sock.ev.off === 'function') {
            // Alternative approach: completely remove and replace the handler
            // This works for some versions of the library that use a different event system
            console.log(`[${connectionId}] Using alternative event handler approach`);
            
            // Define a new handler that will ignore reconnection for this socket
            const newHandler = async (update) => {
              if (update.connection === 'close' && sock.userInitiatedDisconnect) {
                console.log(`[${connectionId}] User initiated disconnect, preventing auto-reconnect`);
                return; // Don't trigger reconnection
              }
            };
            
            // Register our handler with highest priority
            sock.ev.on('connection.update', newHandler);
          }
        } catch (eventError) {
          // Just log the error and continue with disconnection
          console.error(`[${connectionId}] Error modifying event handler:`, eventError);
        }
      }
      
      // Close the socket - use logout if available to prevent auto-reconnect
      if (typeof sock.logout === 'function') {
        await sock.logout().catch(err => {
          console.error(`[${connectionId}] Error during logout:`, err);
        });
      } else if (typeof sock.end === 'function') {
        sock.end();
      }
      
      // Remove from all maps
      connections.delete(connectionId);
      messageQueues.delete(connectionId);
      qrEmitters.delete(connectionId);
      
      // Also remove the QR code if it exists
      if (global.qrCodes && global.qrCodes.has(connectionId)) {
        global.qrCodes.delete(connectionId);
      }
      
      // Clean up auth files if they exist
      try {
        const connectionAuthPath = path.join(__dirname, '../auth_info_baileys', connectionId);
        if (fs.existsSync(connectionAuthPath)) {
          fs.rmSync(connectionAuthPath, { recursive: true, force: true });
          console.log(`[${connectionId}] Auth files deleted successfully`);
        }
      } catch (cleanupError) {
        console.error(`[${connectionId}] Error cleaning up auth files:`, cleanupError);
      }
      
      console.log(`[${connectionId}] Connection closed and removed from memory`);
      
      // Notify Laravel backend about user-initiated disconnect
      await notifyLaravelBackend({
        connectionId,
        type: 'connection_update',
        status: 'disconnected',
        message: 'User initiated disconnect',
        userInitiated: true
      });
      
      return { success: true };
    } catch (error) {
      console.error(`[${connectionId}] Error during disconnect:`, error);
      return { success: false, error: error.message };
    }
  }
  
  return { success: false, message: 'Connection not found' };
};

// For backwards compatibility (legacy support)
// Initialize a connection using the configured default connection ID
let defaultConnectionInitialized = false;
exports.initDefaultConnection = async () => {
  if (!defaultConnectionInitialized) {
    const defaultConnectionId = process.env.WHATSAPP_GATEWAY_DEFAULT_CONNECTION_ID;
    if (!defaultConnectionId) {
      throw new Error('WHATSAPP_GATEWAY_DEFAULT_CONNECTION_ID environment variable is not set');
    }
    
    await exports.initWhatsappConnection(defaultConnectionId);
    defaultConnectionInitialized = true;
    // Remove success logging
  }
  return connections.get(process.env.WHATSAPP_GATEWAY_DEFAULT_CONNECTION_ID);
};

/**
 * Sync connections from Laravel backend
 * This gets connections from Laravel and tries to restore them
 */
exports.syncConnectionsFromLaravel = async () => {
  try {
    // Remove non-error logging
    
    // Get Laravel API URL from environment variables
    const laravelApiUrl = process.env.LARAVEL_API_URL || 'http://127.0.0.1:8000/api';
    const authToken = process.env.WEBHOOK_AUTH_TOKEN || process.env.API_SECRET_KEY;
    
    // Headers for authentication
    const headers = { 'Content-Type': 'application/json' };
    if (authToken) {
      headers.Authorization = `Bearer ${authToken}`;
    }
    
    // Make request to Laravel to get active connections
    const response = await axios.get(`${laravelApiUrl}/connections/active`, { headers });
    
    if (response.status === 200 && response.data && Array.isArray(response.data)) {
      // Remove non-error logging
      
      // Try to restore each connection
      for (const conn of response.data) {
        if (!conn.connection_id) continue;
        
        try {
          // Remove non-error logging
          
          // Check if connection is already in memory
          if (connections.has(conn.connection_id)) {
            // Remove non-error logging
            continue;
          }
          
          // Try to initialize the connection using stored credentials
          await exports.initWhatsappConnection(conn.connection_id);
          // Remove success logging
          
          // Notify Laravel that we restored the connection
          await notifyLaravelBackend({
            connectionId: conn.connection_id,
            type: 'connection_sync',
            status: 'restored',
            message: 'Connection restored after Node.js restart'
          });
        } catch (error) {
          // Keep error logging
          console.error(`Failed to restore connection ${conn.connection_id}:`, error.message);
          
          // Notify Laravel that restoration failed
          await notifyLaravelBackend({
            connectionId: conn.connection_id,
            type: 'connection_sync',
            status: 'failed',
            error: error.message
          });
        }
      }
      
      return { success: true, restoredCount: response.data.length };
    } else {
      // Keep error logging
      console.error('Invalid response from Laravel API:', response.status, response.data);
      return { success: false, error: 'Invalid response from Laravel API' };
    }
  } catch (error) {
    // Keep error logging
    console.error('Error syncing connections from Laravel:', error.message);
    return { success: false, error: error.message };
  }
};