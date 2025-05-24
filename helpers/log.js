/**
 * Log Helper
 * 
 * A utility for logging messages to files in the logs directory.
 * 
 * Features:
 * - Logs to specific named files
 * - Creates files if they don't exist
 * - Appends to existing files
 * - Adds timestamps to log entries
 * - Supports multiple log levels (info, warn, error)
 */

const fs = require('fs');
const path = require('path');
const util = require('util');

// Ensure logs directory exists
const logsDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

/**
 * Format the current date and time for log entries
 * 
 * @returns {string} Formatted date/time string
 */
function getTimestamp() {
    const now = new Date();
    return now.toISOString().replace('T', ' ').substr(0, 19);
}

/**
 * Format a log message with timestamp and level
 * 
 * @param {string} level - Log level (INFO, WARN, ERROR)
 * @param {string} message - The message to log
 * @returns {string} Formatted log entry
 */
function formatLogMessage(level, message) {
    return `[${getTimestamp()}] [${level}] ${message}\n`;
}

/**
 * Write a log entry to a specified file
 * 
 * @param {string} filename - Name of the log file (without .log extension)
 * @param {string} level - Log level (INFO, WARN, ERROR)
 * @param {string|object} message - Message or object to log
 */
function writeLog(filename, level, message) {
    try {
        // Format the message
        let formattedMessage = message;
        
        // Handle objects and arrays by converting to string
        if (typeof message === 'object' && message !== null) {
            formattedMessage = util.inspect(message, { depth: null, colors: false });
        }
        
        const logEntry = formatLogMessage(level, formattedMessage);
        
        // Ensure filename has .log extension
        const logFilename = filename.endsWith('.log') ? filename : `${filename}.log`;
        const logPath = path.join(logsDir, logFilename);
        
        // Append to the log file
        fs.appendFileSync(logPath, logEntry);
    } catch (error) {
        console.error(`Failed to write to log file '${filename}':`, error);
    }
}

/**
 * Log an info message
 * 
 * @param {string} filename - Name of the log file
 * @param {string|object} message - Message or object to log
 */
function info(filename, message) {
    writeLog(filename, 'INFO', message);
}

/**
 * Log a warning message
 * 
 * @param {string} filename - Name of the log file
 * @param {string|object} message - Message or object to log
 */
function warn(filename, message) {
    writeLog(filename, 'WARN', message);
}

/**
 * Log an error message
 * 
 * @param {string} filename - Name of the log file
 * @param {string|object} message - Message or object to log
 */
function error(filename, message) {
    writeLog(filename, 'ERROR', message);
}

/**
 * Log a debug message (only in non-production environments)
 * 
 * @param {string} filename - Name of the log file
 * @param {string|object} message - Message or object to log
 */
function debug(filename, message) {
    if (process.env.NODE_ENV !== 'production') {
        writeLog(filename, 'DEBUG', message);
    }
}

/**
 * Clear a log file
 * 
 * @param {string} filename - Name of the log file to clear
 */
function clearLog(filename) {
    try {
        const logFilename = filename.endsWith('.log') ? filename : `${filename}.log`;
        const logPath = path.join(logsDir, logFilename);
        
        if (fs.existsSync(logPath)) {
            fs.writeFileSync(logPath, '');
        }
    } catch (error) {
        console.error(`Failed to clear log file '${filename}':`, error);
    }
}

/**
 * List all log files
 * 
 * @returns {string[]} Array of log filenames
 */
function listLogs() {
    try {
        return fs.readdirSync(logsDir)
            .filter(file => file.endsWith('.log'));
    } catch (error) {
        console.error('Failed to list log files:', error);
        return [];
    }
}

module.exports = {
    info,
    warn,
    error,
    debug,
    clearLog,
    listLogs
};