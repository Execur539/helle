import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createBareServer } from "@nebula-services/bare-server-node";
import chalk from "chalk";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import basicAuth from "express-basic-auth";
import mime from "mime";
import fetch from "node-fetch";
import https from "node:https";
import os from "node:os"; // Added to get server IP
import readline from "node:readline"; // Added for terminal control

import config from "./config.js";

// ===== Terminal Manager for Bottom Visitor List =====
const terminalManager = {
  // Track terminal dimensions
  height: process.stdout.rows || 24,
  width: process.stdout.columns || 80,
  
  // Track reserved lines at bottom for visitor list
  reservedLines: 5,
  isInitialized: false,
  
  // Scroll state for visitor list
  scrollPosition: 0,
  visitorList: [], // Cache the full list of visitors
  
  // Initialize terminal tracking
  init() {
    if (this.isInitialized) return;
    
    // Update terminal dimensions when resized
    process.stdout.on('resize', () => {
      this.height = process.stdout.rows;
      this.width = process.stdout.columns;
      
      // When terminal is resized, reset scrolling region and re-render
      this.setupScrollRegion();
      this.drawSeparator();
      this.renderVisitorList();
    });
    
    // Initial size detection
    this.height = process.stdout.rows || 24;
    this.width = process.stdout.columns || 80;
    this.isInitialized = true;
    
    // Initial terminal setup
    this.setupScrollRegion();
    
    // Setup keyboard input for scrolling
    this.setupKeyboardInput();
    
    // Setup periodic rendering and separator maintenance
    setInterval(() => {
      this.drawSeparator(); // Ensure separator stays intact
      this.renderVisitorList();
    }, 5000);
  },
  
  // Setup keyboard input capture for arrow keys
  setupKeyboardInput() {
    if (!process.stdin.isTTY) return;
    
    // Enable raw mode to capture keystrokes
    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.setRawMode) {
      process.stdin.setRawMode(true);
    }
    
    // Listen for key events
    process.stdin.on('keypress', (str, key) => {
      if (key && (key.name === 'up' || key.name === 'down' || 
                  key.name === 'left' || key.name === 'right')) {
        // Handle scroll events
        if (key.name === 'down' || key.name === 'right') {
          this.scrollDown();
        } else if (key.name === 'up' || key.name === 'left') {
          this.scrollUp();
        }
        
        // Immediately redraw the visitor list
        this.renderVisitorList();
        
        // Prevent default handling
        return false;
      }
      
      // CTRL+C should still exit
      if (key && key.ctrl && key.name === 'c') {
        process.exit();
      }
    });
    
    logger.info('Arrow key scrolling enabled for visitor list');
  },
  
  // Scroll the visitor list down
  scrollDown() {
    if (this.visitorList.length === 0) return;
    
    // Calculate maximum scroll position (last entry should be visible)
    const maxScroll = Math.max(0, this.visitorList.length - 1);
    
    // Increment scroll position, but don't go beyond the end
    if (this.scrollPosition < maxScroll) {
      this.scrollPosition++;
    } else {
      // Optional: wrap around to the beginning
      this.scrollPosition = 0;
    }
  },
  
  // Scroll the visitor list up
  scrollUp() {
    if (this.visitorList.length === 0) return;
    
    // Decrement scroll position, but don't go below zero
    if (this.scrollPosition > 0) {
      this.scrollPosition--;
    } else {
      // Optional: wrap around to the end
      this.scrollPosition = Math.max(0, this.visitorList.length - 1);
    }
  },
  
  // Set up terminal scrolling region to exclude visitor list area
  setupScrollRegion() {
    if (!process.stdout.isTTY) return;
    
    // Leave one extra line for the separator that won't scroll
    const scrollableArea = this.height - this.reservedLines - 1;
    
    // Clear screen and set up scrolling region
    process.stdout.write('\x1B[2J'); // Clear entire screen
    process.stdout.write(`\x1B[1;${scrollableArea}r`); // Set scrolling region from line 1 to (height-reserved-1)
    process.stdout.write('\x1B[H'); // Move cursor to top-left
    
    // Draw the initial separator
    this.drawSeparator();
    
    // Move cursor back to top for continued logging
    process.stdout.write('\x1B[H');
  },
  
  // Draw a robust separator line that won't be part of the scrolling region
  drawSeparator() {
    if (!process.stdout.isTTY) return;
    
    // Save cursor position
    process.stdout.write('\x1B7');
    
    // Calculate separator line position (just outside scrolling region)
    const separatorLine = this.height - this.reservedLines;
    
    // Move to separator line position
    process.stdout.write(`\x1B[${separatorLine};0H`);
    
    // Clear the entire line first to remove any corruption
    process.stdout.write('\x1B[2K');
    
    // Draw a more robust separator with distinct characters
    const separatorChar = '═'; // Using a double line character for better visibility
    process.stdout.write(chalk.bold.blue(separatorChar.repeat(this.width)));
    
    // Restore cursor position
    process.stdout.write('\x1B8');
  },
  
  // Clear specific lines in the terminal
  clearLines(startLine, count) {
    let result = '';
    // Move to position
    result += `\x1B[${startLine};0H`;
    // Clear lines one by one
    for (let i = 0; i < count; i++) {
      result += '\x1B[2K'; // Clear entire line
      if (i < count - 1) result += '\x1B[1B'; // Move down one line
    }
    process.stdout.write(result);
  },
  
  // Render the visitor list at the bottom of the terminal
  renderVisitorList() {
    // Don't render if terminal is not interactive
    if (!process.stdout.isTTY) return;
    
    // Save cursor position
    process.stdout.write('\x1B7');
    
    // Calculate where to start rendering (outside scrolling region)
    const startLine = this.height - this.reservedLines + 1;
    
    // Move to the fixed area (using direct positioning, not relative to scrolling region)
    process.stdout.write(`\x1B[${startLine};0H`);
    
    // Clear the reserved area for visitor list
    for (let i = 0; i < this.reservedLines - 1; i++) {
      process.stdout.write('\x1B[2K'); // Clear entire line
      process.stdout.write('\x1B[1B'); // Move down one line
    }
    
    // Return to the start of the fixed area
    process.stdout.write(`\x1B[${startLine};0H`);
    
    // Build the full visitor list first
    const now = Date.now();
    this.visitorList = [];
    
    visitorNumbers.forEach((id, ip) => {
      const lastVisit = visitorLog.get(ip) || 0;
      // Only include visitors from the past 10 minutes
      if (now - lastVisit < TEN_MINUTES) {
        // Filter out server IPs
        if (!serverIPs.includes(ip)) {
          this.visitorList.push({ id, ip });
        }
      }
    });
    
    // Sort by ID for consistent ordering
    this.visitorList.sort((a, b) => a.id - b.id);
    
    // Adjust scroll position if needed (in case visitors left the list)
    if (this.visitorList.length > 0) {
      // Make sure scroll position is within bounds
      this.scrollPosition = Math.max(0, Math.min(this.scrollPosition, this.visitorList.length - 1));
    } else {
      // Reset scroll position if no visitors
      this.scrollPosition = 0;
    }
    
    // Prepare the content
    const visitorCount = this.visitorList.length;
    
    // Determine how many rows we have for visitor entries
    // We need at most 2 rows for indicators (above/below)
    const maxVisibleRows = this.reservedLines - 2; // Room for header and maybe indicators
    
    // Create header with count and scroll indicators
    let header = chalk.bold('🔍 ACTIVE VISITORS');
    if (visitorCount > 0) {
      header += chalk.bold(` (${visitorCount} total)`);
      
      // Add scrolling indicator if needed
      if (visitorCount > maxVisibleRows - 1) {
        header += chalk.dim(' [Use ↑/↓ keys to scroll]');
      }
    }
    process.stdout.write(`${header}\n`);
    
    // If no visitors, show message and return early
    if (visitorCount === 0) {
      process.stdout.write(chalk.gray('  No active visitors\n'));
      process.stdout.write('\x1B8'); // Restore cursor position
      return;
    }
    
    // Calculate how many visitors we can show
    // If we need "more above" indicator, reduce by 1
    // If we need "more below" indicator, reduce by 1
    const needsAboveIndicator = this.scrollPosition > 0;
    const needsBelowIndicator = this.scrollPosition + maxVisibleRows - (needsAboveIndicator ? 1 : 0) < visitorCount;
    
    // Calculate available rows for actual visitor entries
    const availableRows = maxVisibleRows - (needsAboveIndicator ? 1 : 0) - (needsBelowIndicator ? 1 : 0);
    
    // Show indicator that you can scroll up if not showing the first visitor
    if (needsAboveIndicator) {
      process.stdout.write(chalk.yellow('  ▲ more above\n'));
    }
    
    // Calculate range of visitors to show (not using modulo to avoid wrapping)
    const startIdx = this.scrollPosition;
    const endIdx = Math.min(startIdx + availableRows, visitorCount);
    
    // Extract and format the slice of visitors to show
    const visitorEntries = [];
    for (let i = startIdx; i < endIdx; i++) {
      const visitor = this.visitorList[i];
      visitorEntries.push(`  ${chalk.cyan(`#${visitor.id}`)}${chalk.dim(' → ')}${visitor.ip}`);
    }
    
    // Write out the visitor entries
    process.stdout.write(visitorEntries.join('\n'));
    
    // If we have more visitors below, show indicator
    if (needsBelowIndicator) {
      process.stdout.write('\n' + chalk.yellow('  ▼ more below'));
    }
    
    // Restore cursor position (back to the scrollable region)
    process.stdout.write('\x1B8');
  },
  
  // Make sure cursor is in the correct region before writing logs
  ensureLoggingRegion() {
    if (!process.stdout.isTTY) return;
    
    // Get current cursor position
    let cursorPos;
    try {
      // This is a hack to get cursor position in Node.js
      // Not 100% reliable but helps in many cases
      const currentCursorPos = readline.cursorTo;
      if (currentCursorPos && currentCursorPos.y >= this.height - this.reservedLines - 1) {
        // If cursor is in or near the fixed area, move it back to scrolling region
        process.stdout.write(`\x1B[${this.height - this.reservedLines - 2};0H`);
      }
    } catch (e) {
      // If we can't get cursor position, do nothing
    }
  },
  
  // Estimate the current cursor line position
  getCurrentCursorLine() {
    if (!process.stdout.isTTY) return 0;
    
    // This is an approximation since Node.js doesn't have a direct way
    // to get the current cursor position
    const scrollableArea = this.height - this.reservedLines - 1;
    
    // We'll use a simple counter that wraps within the scrollable region
    this._currentLine = (this._currentLine || 1) + 1;
    if (this._currentLine >= scrollableArea) {
      this._currentLine = 1; // Wrap around when reaching the bottom
    }
    
    return this._currentLine;
  }
};

// ===== Enhanced Logging System =====
const logger = {
  startTime: new Date(),
  
  // Track repeated visitor actions
  actionTracker: {
    // Maps visitorId -> { action, path, count, timestamp, linePosition }
    visitorActions: new Map(),
    // Store last cursor position after each log
    lastCursorLine: 0,
    
    // Check if an action is being repeated and track it
    track(visitorNum, actionType, path) {
      const key = `${visitorNum}`;
      const now = Date.now();
      
      // Get or create tracking info for this visitor
      let trackedAction = this.visitorActions.get(key);
      if (!trackedAction) {
        trackedAction = { 
          action: null, 
          path: null, 
          count: 0, 
          timestamp: now,
          linePosition: 0,  // Terminal line where this message was last logged
        };
        this.visitorActions.set(key, trackedAction);
      }
      
      // Check if this is the same action+path as before
      const isRepeated = trackedAction.action === actionType && trackedAction.path === path;
      if (isRepeated) {
        // Same action, increment counter
        trackedAction.count++;
        trackedAction.timestamp = now;
        return { 
          count: trackedAction.count, 
          isRepeated, 
          linePosition: trackedAction.linePosition 
        };
      } else {
        // New action, reset counter and update line position 
        trackedAction.action = actionType;
        trackedAction.path = path;
        trackedAction.count = 1;
        trackedAction.timestamp = now;
        trackedAction.linePosition = this.lastCursorLine;
        return { 
          count: 1, 
          isRepeated: false, 
          linePosition: 0 
        };
      }
    },
    
    // Update the last cursor line
    updateCursorPosition(line) {
      this.lastCursorLine = line;
    },
    
    // Clean up old tracking data
    cleanup() {
      const now = Date.now();
      const expireTime = 10 * 60 * 1000; // 10 minutes
      
      this.visitorActions.forEach((data, key) => {
        if (now - data.timestamp > expireTime) {
          this.visitorActions.delete(key);
        }
      });
    }
  },
  
  // Format timestamps consistently
  timestamp() {
    const now = new Date();
    return chalk.dim(`[${now.toLocaleTimeString()}]`);
  },
  
  // Central log function that respects the bottom area
  log(message, options = {}) {
    const { updateExisting = false, linePosition = 0 } = options;
    
    if (terminalManager.isInitialized && process.stdout.isTTY) {
      // Ensure we're in the scrollable region
      terminalManager.ensureLoggingRegion();
      
      if (updateExisting && linePosition > 0) {
        // Save current position
        process.stdout.write('\x1B7');
        
        // Move to the line that needs updating
        process.stdout.write(`\x1B[${linePosition};0H`);
        
        // Clear the entire line
        process.stdout.write('\x1B[2K');
        
        // Write the updated message
        process.stdout.write(`${this.timestamp()} ${message}`);
        
        // Restore position
        process.stdout.write('\x1B8');
      } else {
        // Regular new log message
        console.log(`${this.timestamp()} ${message}`);
        
        // Store the line where this message was written
        // This is approximate since we can't get the exact cursor position
        if (process.stdout.rows) {
          const currentLine = terminalManager.getCurrentCursorLine();
          this.actionTracker.updateCursorPosition(currentLine);
        }
      }
      
      // Ensure the separator remains intact after logging
      terminalManager.drawSeparator();
    } else {
      // Normal logging if not in TTY mode
      console.log(`${this.timestamp()} ${message}`);
    }
  },
  
  // Primary log levels
  info(message) {
    this.log(`${chalk.blue('ℹ️ INFO')} ${message}`);
  },
  
  success(message) {
    this.log(`${chalk.green('✅ SUCCESS')} ${message}`);
  },
  
  warn(message) {
    this.log(`${chalk.yellow('⚠️ WARNING')} ${message}`);
  },
  
  error(message) {
    this.log(`${chalk.red('❌ ERROR')} ${message}`);
  },
  
  // Visitor tracking specific logs
  visitor: {
    new(visitorNum, path) {
      const { count, isRepeated, linePosition } = logger.actionTracker.track(visitorNum, 'new', path);
      const countSuffix = count > 1 ? chalk.cyan(` [repeated ${count} times]`) : '';
      const message = `${chalk.green('👋 NEW VISITOR')} #${visitorNum} requested: ${path}${countSuffix}`;
      
      logger.log(message, { updateExisting: isRepeated, linePosition });
    },
    
    return(visitorNum, path) {
      const { count, isRepeated, linePosition } = logger.actionTracker.track(visitorNum, 'return', path);
      const countSuffix = count > 1 ? chalk.cyan(` [repeated ${count} times]`) : '';
      const message = `${chalk.magenta('🔄 RETURN VISITOR')} #${visitorNum} requested: ${path}${countSuffix}`;
      
      logger.log(message, { updateExisting: isRepeated, linePosition });
    },
    
    navigation(visitorNum, path) {
      const { count, isRepeated, linePosition } = logger.actionTracker.track(visitorNum, 'navigation', path);
      const countSuffix = count > 1 ? chalk.cyan(` [repeated ${count} times]`) : '';
      const message = `${chalk.yellow('🧭 NAVIGATION')} Visitor #${visitorNum} navigated to: ${path}${countSuffix}`;
      
      logger.log(message, { updateExisting: isRepeated, linePosition });
    },
    
    navigationNewID(visitorNum, path) {
      const { count, isRepeated, linePosition } = logger.actionTracker.track(visitorNum, 'navigationNewID', path);
      const countSuffix = count > 1 ? chalk.cyan(` [repeated ${count} times]`) : '';
      const message = `${chalk.yellow('🧭 NAVIGATION')} + ${chalk.green('👋 NEW ID')} #${visitorNum} navigated to: ${path}${countSuffix}`;
      
      logger.log(message, { updateExisting: isRepeated, linePosition });
    },
    
    developer(path) {
      // No need to track developer actions as they're not typically repetitive
      logger.log(`${chalk.cyan('👨‍💻 DEVELOPER')} accessed: ${path}`);
    }
  },
  
  // System events
  system: {
    startup() {
      // For startup, we can use direct console since terminal manager isn't initialized yet
      console.log(`\n${chalk.bold.blue('='.repeat(50))}`);
      console.log(`${logger.timestamp()} ${chalk.bold.green('🚀 SERVER STARTING')}`);
      console.log(`${chalk.bold.blue('='.repeat(50))}\n`);
      
      // Initialize the terminal manager
      terminalManager.init();
    },
    
    ready(protocol, port) {
      logger.log(`${chalk.green('🌐 READY')} ${protocol} server running on port ${chalk.bold(port)}`);
      
      // Ensure the separator and visitor list are intact
      terminalManager.drawSeparator();
      terminalManager.renderVisitorList();
    },
    
    stats(totalVisitors, activeVisitors, uptimeHours) {
      logger.log(`${chalk.blue('📊 STATISTICS')} ${totalVisitors} total visitors, ${activeVisitors} active (10m), Uptime: ${uptimeHours}h`);
    }
  },
  
  // File logging
  fileLog(message) {
    fs.appendFile(path.join(process.cwd(), 'visitor_log.txt'), `${new Date().toISOString()} - ${message}\n`, (err) => {
      if (err) this.error(`Failed to write to log file: ${err.message}`);
    });
  },
  
  // Truncate long paths for display
  truncatePath(path, maxLength = 50) {
    if (path.length <= maxLength) return path;
    const start = path.substring(0, maxLength / 2 - 2);
    const end = path.substring(path.length - (maxLength / 2 - 1));
    return `${start}...${end}`;
  }
};

logger.system.startup();

const __dirname = process.cwd();
const key = fs.readFileSync(path.join(__dirname, "key.pem"));
const cert = fs.readFileSync(path.join(__dirname, "cert.pem"));
const serverHTTPS = https.createServer({ key, cert });
const serverHTTP = http.createServer();
const app = express();
const bareServer = createBareServer("/fq/");
const HTTPS_PORT = 443;
const HTTP_PORT = 80;
const cache = new Map();
const CACHE_TTL = 30 * 24 * 60 * 60 * 1000; 

// Visitor tracking system
const visitorLog = new Map(); // Stores last visit time for each IP
const activeSessions = new Map(); // Stores active visitor sessions
const requestLog = new Map(); // Track recent requests to prevent duplicates
const visitorNumbers = new Map(); // Maps IPs to visitor numbers
let visitorCounter = 0; // Counts total unique visitors
const TEN_MINUTES = 10 * 60 * 1000; // 10 minutes in milliseconds
const DEDUPE_WINDOW = 1000; // 1 second deduplication window

// Get server's own IP addresses
const getServerIPs = () => {
  const interfaces = os.networkInterfaces();
  const ips = [];
  
  Object.keys(interfaces).forEach((ifname) => {
    interfaces[ifname].forEach((iface) => {
      // Skip internal and non-IPv4 addresses
      if (iface.internal === false && iface.family === 'IPv4') {
        ips.push(iface.address);
      }
    });
  });
  
  // Add localhost addresses
  ips.push('127.0.0.1', 'localhost', '::1');
  return ips;
};

const serverIPs = getServerIPs();
logger.info(`Server IP addresses: ${serverIPs.join(', ')}`);

// Middleware for logging visitors
app.use((req, res, next) => {
  // Get visitor IP (handling proxies)
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || 
             req.socket.remoteAddress || 
             'unknown';
  
  // Enhanced check for asset requests
  const isAssetRequest = 
      // API and special paths
      req.path.startsWith('/e/') || 
      req.path.startsWith('/fq/') || 
      req.path.startsWith('/ai-proxy/') ||
      
      // Common asset directories
      req.path.startsWith('/img/') ||
      req.path.startsWith('/images/') ||
      req.path.startsWith('/assets/') ||
      req.path.startsWith('/static/') ||
      req.path.startsWith('/media/') ||
      req.path.startsWith('/fonts/') ||
      req.path.startsWith('/icons/') ||
      req.path.startsWith('/css/') ||
      req.path.startsWith('/js/') ||
      
      // File extensions for various assets
      /\.(js|css|png|jpe?g|gif|svg|ico|webp|bmp|tiff|avif|woff2?|ttf|otf|eot|mp[34]|webm|ogg|wav|flac|json|xml|csv|txt|pdf|map|zip|rar|gz|7z|docx?|xlsx?|pptx?)$/i.test(req.path);
  
  // Don't log asset requests
  if (isAssetRequest) {
    return next();
  }
  
  const now = Date.now();
  
  // Check for duplicate requests (same IP and path within deduplication window)
  const requestKey = `${ip}:${req.path}`;
  const lastRequest = requestLog.get(requestKey);
  if (lastRequest && (now - lastRequest < DEDUPE_WINDOW)) {
    // Skip logging this duplicate request
    return next();
  }
  
  // Record this request to prevent duplicates
  requestLog.set(requestKey, now);
  
  // Clean up old entries from requestLog periodically
  if (requestLog.size > 1000) { // Prevent memory growth
    for (const [key, timestamp] of requestLog.entries()) {
      if (now - timestamp > DEDUPE_WINDOW * 2) {
        requestLog.delete(key);
      }
    }
  }
  
  const referrer = req.headers.referer || '';
  const lastVisit = visitorLog.get(ip) || 0;
  const isServerIP = serverIPs.includes(ip);
  
  // Check if this IP had an ID before this request
  const hadIDBeforeRequest = visitorNumbers.has(ip);
  
  // Assign a visitor number if this IP doesn't have one yet
  if (!visitorNumbers.has(ip) && !isServerIP) {
    visitorCounter++;
    visitorNumbers.set(ip, visitorCounter);
    logger.info(`New visitor registered with ID #${visitorCounter}`);
  }
  
  // Get the visitor number for this IP
  const visitorNum = visitorNumbers.get(ip) || 'Dev';
  
  // Truncate the path for display in logs
  const displayPath = logger.truncatePath(req.path);
  
  // More accurate internal navigation check:
  // Only count as internal if referrer is from our site and different from current path
  const referrerUrl = referrer ? new URL(referrer) : null;
  const isInternalNavigation = referrerUrl && 
      referrerUrl.hostname === req.hostname && 
      referrerUrl.pathname !== req.path;
  
  // Prioritize log categories - only log one type per request
  if (isServerIP) {
    logger.visitor.developer(displayPath);
  } 
  else if (isInternalNavigation) {
    // Internal navigation - user navigating within the site
    
    // Check for the edge case: navigation detected but ID was just assigned
    if (!hadIDBeforeRequest) {
      // This is the anomaly case - navigating between pages but no ID until now
      logger.visitor.navigationNewID(visitorNum, displayPath);
      
      // Log this unusual event to the file
      logger.fileLog(`ANOMALY - Visitor #${visitorNum} navigated without prior ID - IP: ${ip} - Path: ${req.path}`);
      
      // Set the last visit time since this is effectively a new visitor
      visitorLog.set(ip, now);
    } else {
      // Normal navigation with existing ID
      logger.visitor.navigation(visitorNum, displayPath);
    }
  }
  else if (!lastVisit || (now - lastVisit > TEN_MINUTES)) {
    // Unique visit - first time or returning after 10+ minutes
    logger.visitor.new(visitorNum, displayPath);
    
    // Log unique visits to file
    logger.fileLog(`UNIQUE - Visitor #${visitorNum} - IP: ${ip} - Path: ${req.path}`);
    
    // Update last visit time for this IP
    visitorLog.set(ip, now);
  } 
  else {
    // Non-unique visit - returning within 10 minutes
    logger.visitor.return(visitorNum, displayPath);
    
    // Log non-unique visits to file as well
    logger.fileLog(`NON-UNIQUE - Visitor #${visitorNum} - IP: ${ip} - Path: ${req.path}`);
  }
  
  // Track active session
  activeSessions.set(ip, now);
  
  next();
});

// Clean up expired sessions periodically
setInterval(() => {
  const now = Date.now();
  for (const [ip, time] of activeSessions.entries()) {
    if (now - time > TEN_MINUTES) {
      activeSessions.delete(ip);
    }
  }
  
  // Clean up old request log entries
  for (const [key, timestamp] of requestLog.entries()) {
    if (now - timestamp > DEDUPE_WINDOW * 2) {
      requestLog.delete(key);
    }
  }
}, 60 * 1000); // Check every minute

// Periodically log visitor statistics
setInterval(() => {
  const now = Date.now();
  const activeCount = activeSessions.size;
  const uptime = Math.floor((now - logger.startTime) / (60 * 60 * 1000));
  
  logger.system.stats(visitorCounter, activeCount, uptime);
  
  // Clean up expired sessions
  for (const [ip, time] of activeSessions.entries()) {
    if (now - time > TEN_MINUTES) {
      activeSessions.delete(ip);
    }
  }
  
  // Clean up old request log entries
  for (const [key, timestamp] of requestLog.entries()) {
    if (now - timestamp > DEDUPE_WINDOW * 2) {
      requestLog.delete(key);
    }
  }
  
  // Always redraw separator and refresh the visitor list after stats update
  terminalManager.drawSeparator();
  terminalManager.renderVisitorList();
}, 60 * 60 * 1000); // Log stats every hour

if (config.challenge !== false) {
  logger.success("Password protection is enabled");

  app.use(basicAuth({ users: config.users, challenge: true }));
}

app.get("/e/*", async (req, res, next) => {
  try {
    if (cache.has(req.path)) {
      const { data, contentType, timestamp } = cache.get(req.path);
      if (Date.now() - timestamp > CACHE_TTL) {
        cache.delete(req.path);
      } else {
        res.writeHead(200, { "Content-Type": contentType });
        return res.end(data);
      }
    }

    const baseUrls = {
      "/e/1/": "https://raw.githubusercontent.com/qrs/x/fixy/",
      "/e/2/": "https://raw.githubusercontent.com/3v1/V5-Assets/main/",
      "/e/3/": "https://raw.githubusercontent.com/3v1/V5-Retro/master/",
    };

    let reqTarget;
    for (const [prefix, baseUrl] of Object.entries(baseUrls)) {
      if (req.path.startsWith(prefix)) {
        reqTarget = baseUrl + req.path.slice(prefix.length);
        break;
      }
    }

    if (!reqTarget) {
      return next();
    }

    const asset = await fetch(reqTarget);
    if (!asset.ok) {
      return next();
    }

    const data = Buffer.from(await asset.arrayBuffer());
    const ext = path.extname(reqTarget);
    const no = [".unityweb"];
    const contentType = no.includes(ext)
      ? "application/octet-stream"
      : mime.getType(ext);

    cache.set(req.path, { data, contentType, timestamp: Date.now() });
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  } catch (error) {
    console.error("Error fetching asset:", error);
    res.setHeader("Content-Type", "text/html");
    res.status(500).send("Error fetching the asset");
  }
});

app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// active requests tracking
const activeRequests = new Map();
const abortControllers = new Map();

// cancel endpoint
app.post('/ai-proxy/cancel/:requestId', (req, res) => {
    const { requestId } = req.params;
    const forceClose = req.headers['x-force-close'] === 'true';
    
    if (forceClose) {
        // Force close connection to LM Studio
        const aiResponse = activeRequests.get(requestId);
        if (aiResponse?.connection) {
            aiResponse.connection.destroy();
        }
    }

    const controller = abortControllers.get(requestId);
    if (controller) {
        controller.abort();
        abortControllers.delete(requestId);
    }

    const request = activeRequests.get(requestId);
    if (request) {
        // Cancel the reader if open
        if (request.reader) {
            request.reader.cancel();
        }
        // Destroy LM Studio response stream
        if (request.lmResponse?.body) {
            request.lmResponse.body.destroy();
        }
        if (request.destroy) request.destroy();
        if (request.end) request.end();
        // Also destroy the Express response/socket
        if (request.response) {
            request.response.end();
            request.response.socket?.destroy();
        }
        activeRequests.delete(requestId);
    }

    console.log(`Request ${requestId} cancelled${forceClose ? ' (force closed)' : ''}`);
    res.sendStatus(200);
});


class AbortableStream {
    constructor(stream, controller) {
        this.stream = stream;
        this.controller = controller;
        this.isAborted = false;
    }

    pipe(destination) {
        this.destination = destination;
        this.stream.on('data', (chunk) => {
            if (!this.isAborted) {
                destination.write(chunk);
            }
        });

        this.stream.on('end', () => {
            if (!this.isAborted) {
                destination.end();
            }
        });

        this.stream.on('error', (error) => {
            destination.destroy(error);
        });

        this.controller.signal.addEventListener('abort', () => {
            this.abort();
        });

        return destination;
    }

    abort() {
        this.isAborted = true;
        if (this.destination) {
            this.destination.end();
        }
        this.stream.destroy();
    }
}

app.use('/ai-proxy', async (req, res) => {
    let aiRequest;
    const requestId = req.headers['x-request-id'];
    const controller = new AbortController();

    try {
        const targetUrl = `http://sse.execur.reworked.omexey.com:1234${req.url}`;
        
        if (req.method === 'HEAD') {
            const response = await fetch(targetUrl, { method: 'HEAD' });
            return res.sendStatus(response.ok ? 200 : 500);
        }

        if (requestId) {
            abortControllers.set(requestId, controller);
        }

        // Create the request but don't await it yet
        aiRequest = fetch(targetUrl, {
            method: req.method,
            headers: {
                'Content-Type': 'application/json',
            },
            body: req.method === 'POST' ? JSON.stringify(req.body) : undefined,
            signal: controller.signal
        });

        if (requestId) {
            activeRequests.set(requestId, {
                response: res,
                connection: req.connection
            });
        }

        const response = await aiRequest;
        if (requestId) {
            // Store the LM Studio response stream
            const activeReq = activeRequests.get(requestId);
            if (activeReq) {
                activeReq.lmResponse = response;
            }
        }

        // Clean up on request end
        req.on('close', () => {
            if (requestId) {
                const controller = abortControllers.get(requestId);
                if (controller) {
                    controller.abort();
                    abortControllers.delete(requestId);
                }
                const request = activeRequests.get(requestId);
                if (request) {
                    // Also destroy LM Studio SSE stream if open
                    if (request.lmResponse?.body) {
                        request.lmResponse.body.destroy();
                    }
                    // Cancel the reader on close
                    if (request.reader) {
                        request.reader.cancel();
                    }
                    activeRequests.delete(requestId);
                }
            }
            // Force close the connection to LM Studio
            if (aiRequest?.body) {
                aiRequest.body.destroy();
            }
        });

        if (response.headers.get('content-type')?.includes('text/event-stream')) {
            res.setHeader('Content-Type', 'text/event-stream');
            // Store the Node.js stream instead of using getReader()
            const lmStream = response.body;
            if (requestId) {
                const activeReq = activeRequests.get(requestId);
                if (activeReq) {
                    activeReq.lmResponse = response;
                    activeReq.lmStream = lmStream;
                }
            }

            // Wrap the Node stream in AbortableStream and pipe to the client
            const abortableStream = new AbortableStream(lmStream, controller);
            abortableStream.pipe(res);

            // Handle cleanup when the stream ends
            lmStream.on('end', () => {
                if (requestId) {
                    abortControllers.delete(requestId);
                    activeRequests.delete(requestId);
                }
            });

            // Force-close on response close
            res.on('close', () => {
                lmStream.destroy();
                res.socket?.destroy();
            });
        } else {
            const data = await response.text();
            res.send(data);
            
            if (requestId) {
                abortControllers.delete(requestId);
                activeRequests.delete(requestId);
            }
        }
    } catch (error) {
        if (error.name === 'AbortError') {
            console.log('Request aborted:', requestId);
            // Force close the connection to LM Studio
            if (aiRequest?.body) {
                aiRequest.body.destroy();
            }
        } else {
            console.error('Proxy error:', error);
        }
        
        if (requestId) {
            abortControllers.delete(requestId);
            activeRequests.delete(requestId);
        }
        
        res.status(500).send('Proxy error');
    }
});

/* if (process.env.MASQR === "true") {
  console.log(chalk.green("Masqr is enabled"));
  setupMasqr(app);
} */

app.use(express.static(path.join(__dirname, "static")));
app.use("/fq", cors({ origin: true }));

const routes = [
  { path: "/yz", file: "apps.html" },
  { path: "/up", file: "games.html" },
  { path: "/play.html", file: "games.html" },
  { path: "/vk", file: "settings.html" },
  { path: "/rx", file: "tabs.html" },
  { path: "/", file: "index.html" },
];

// biome-ignore lint/complexity/noForEach:
routes.forEach(route => {
  app.get(route.path, (_req, res) => {
    res.sendFile(path.join(__dirname, "static", route.file));
  });
});

app.use((req, res, next) => {
  res.status(404).sendFile(path.join(__dirname, "static", "404.html"));
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).sendFile(path.join(__dirname, "static", "404.html"));
});

serverHTTPS.on("request", (req, res) => {
  if (bareServer.shouldRoute(req)) {
    bareServer.routeRequest(req, res);
  } else {
    app(req, res);
  }
});

serverHTTPS.on("upgrade", (req, socket, head) => {
  if (bareServer.shouldRoute(req)) {
    bareServer.routeUpgrade(req, socket, head);
  } else {
    socket.end();
  }
});

serverHTTPS.on("listening", () => {
  logger.system.ready("HTTPS", HTTPS_PORT);
});

serverHTTPS.listen(HTTPS_PORT);

serverHTTP.on("request", (req, res) => {
  if (bareServer.shouldRoute(req)) {
    bareServer.routeRequest(req, res);
  } else {
    app(req, res);
  }
});

serverHTTP.on("upgrade", (req, socket, head) => {
  if (bareServer.shouldRoute(req)) {
    bareServer.routeUpgrade(req, socket, head);
  } else {
    socket.end();
  }
});

serverHTTP.on("listening", () => {
  logger.system.ready("HTTP", HTTP_PORT);
});

serverHTTP.listen(HTTP_PORT);

// Console error handling - override console.error to maintain terminal regions
const originalConsoleError = console.error;
console.error = function() {
  // Ensure we're writing in the correct region
  if (terminalManager.isInitialized && process.stdout.isTTY) {
    terminalManager.ensureLoggingRegion();
  }
  originalConsoleError.apply(console, arguments);
};

// When exiting, restore normal terminal behavior
process.on('exit', () => {
  if (process.stdout.isTTY) {
    // Disable scrolling region, reset terminal
    process.stdout.write('\x1B[r');
    
    // Disable raw mode if it was enabled
    if (process.stdin.setRawMode) {
      process.stdin.setRawMode(false);
    }
  }
});

// Handle unexpected termination
process.on('SIGINT', () => {
  if (process.stdout.isTTY) {
    // Disable scrolling region, reset terminal
    process.stdout.write('\x1B[r');
    process.stdout.write('\x1B[2J'); // Clear screen
    process.stdout.write('\x1B[H');  // Move to home position
    
    // Disable raw mode if it was enabled
    if (process.stdin.setRawMode) {
      process.stdin.setRawMode(false);
    }
  }
  process.exit(0);
});

// Add additional periodic separator maintenance
setInterval(() => {
  // Redraw the separator to ensure it remains intact
  if (terminalManager.isInitialized) {
    terminalManager.drawSeparator();
  }
}, 10000); // Check every 10 seconds

// Add periodic cleanup to the existing interval
setInterval(() => {
  // Clean up expired tracking data
  logger.actionTracker.cleanup();
  
  // ...existing cleanup code...
}, 60 * 1000); // Check every minute
