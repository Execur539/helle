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

import config from "./config.js";

console.log(chalk.yellow("🚀 Starting server..."));

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

if (config.challenge !== false) {
  console.log(
    chalk.green("🔒 Password protection is enabled! Listing logins below"),
  );


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
  console.log(chalk.green(`🔒 HTTPS server is running on https://localhost:${HTTPS_PORT}`));
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
  console.log(chalk.green(`🌍 HTTP server is running on http://localhost:${HTTP_PORT}`));
});

serverHTTP.listen(HTTP_PORT);
