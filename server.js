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

import config from "./config.js";

// ===== Enhanced Logging System =====
const logger = {
  startTime: new Date(),
  
  // Format timestamps consistently
  timestamp() {
    const now = new Date();
    return chalk.dim(`[${now.toLocaleTimeString()}]`);
  },
  
  // Primary log levels
  info(message) {
    console.log(`${this.timestamp()} ${chalk.blue('ℹ️ INFO')} ${message}`);
  },
  
  success(message) {
    console.log(`${this.timestamp()} ${chalk.green('✅ SUCCESS')} ${message}`);
  },
  
  warn(message) {
    console.log(`${this.timestamp()} ${chalk.yellow('⚠️ WARNING')} ${message}`);
  },
  
  error(message) {
    console.log(`${this.timestamp()} ${chalk.red('❌ ERROR')} ${message}`);
  },
  
  // Visitor tracking specific logs
  visitor: {
    new(visitorNum, path) {
      console.log(`${logger.timestamp()} ${chalk.green('👋 NEW VISITOR')} #${visitorNum} requested: ${path}`);
    },
    
    return(visitorNum, path) {
      console.log(`${logger.timestamp()} ${chalk.magenta('🔄 RETURN VISITOR')} #${visitorNum} requested: ${path}`);
    },
    
    navigation(visitorNum, path) {
      console.log(`${logger.timestamp()} ${chalk.yellow('🧭 NAVIGATION')} Visitor #${visitorNum} navigated to: ${path}`);
    },
    
    developer(path) {
      console.log(`${logger.timestamp()} ${chalk.cyan('👨‍💻 DEVELOPER')} accessed: ${path}`);
    }
  },
  
  // System events
  system: {
    startup() {
      console.log(`\n${chalk.bold.blue('='.repeat(50))}`);
      console.log(`${logger.timestamp()} ${chalk.bold.green('🚀 SERVER STARTING')}`);
      console.log(`${chalk.bold.blue('='.repeat(50))}\n`);
    },
    
    ready(protocol, port) {
      console.log(`${logger.timestamp()} ${chalk.green('🌐 READY')} ${protocol} server running on port ${chalk.bold(port)}`);
    },
    
    stats(totalVisitors, activeVisitors, uptimeHours) {
      console.log(`${logger.timestamp()} ${chalk.blue('📊 STATISTICS')} ${totalVisitors} total visitors, ${activeVisitors} active (10m), Uptime: ${uptimeHours}h`);
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
    logger.visitor.navigation(visitorNum, displayPath);
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
