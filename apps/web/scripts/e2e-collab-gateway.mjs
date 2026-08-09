#!/usr/bin/env node
/**
 * Upgrade-capable local gateway for Playwright.
 *
 * Stock `next dev` does not forward external WebSocket Upgrade rewrites from
 * `proxy.ts`. This reverse proxy terminates `/collab/document` and
 * `/collab/presence` upgrades with the same HMAC signer, then pipes them to
 * the collab backend. All other traffic is proxied to Next.js.
 */
import http from "node:http";
import {
  COLLAB_GATEWAY_AUTH_HEADER_NAMES,
  createCollabGatewayAuthHeaders,
  parseCollabGatewaySignerConfig,
} from "@softmaple/collab-gateway-auth";

const DOCUMENT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SENSITIVE_FORWARDED_HEADERS = [
  "authorization",
  "cookie",
  "proxy-authorization",
];

const requireEnv = (name) => {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is required`);
  }
  return value;
};

const listenPort = Number(requireEnv("E2E_GATEWAY_PORT"));
const nextOrigin = new URL(requireEnv("E2E_NEXT_ORIGIN"));
const collabOrigin = new URL(requireEnv("E2E_COLLAB_ORIGIN"));
const publicOrigin = `http://127.0.0.1:${listenPort}`;
const signerConfig = parseCollabGatewaySignerConfig(
  process.env.COLLAB_GATEWAY_HMAC_KEY_ID,
  process.env.COLLAB_GATEWAY_HMAC_SECRET,
);

const collabRoutes = new Map([
  ["/collab/document", { backendPath: "/document", query: "none" }],
  ["/collab/presence", { backendPath: "/presence", query: "room" }],
]);

/** Prevent transient proxy socket resets from crashing the gateway process. */
const swallowStreamError = (stream) => {
  stream.on("error", () => {
    stream.destroy();
  });
};

const isWebSocketUpgrade = (req) => {
  const connectionTokens = (req.headers.connection ?? "")
    .split(",")
    .map((token) => token.trim().toLowerCase());
  return (
    req.method === "GET" &&
    req.headers.upgrade?.toLowerCase() === "websocket" &&
    connectionTokens.includes("upgrade") &&
    req.headers["sec-websocket-version"] === "13" &&
    typeof req.headers["sec-websocket-key"] === "string"
  );
};

const isSameOriginBrowserRequest = (req) => {
  const origin = req.headers.origin;
  if (origin === undefined || origin === "null") return false;
  try {
    return new URL(origin).origin === publicOrigin;
  } catch {
    return false;
  }
};

const hasValidGatewayQuery = (url, queryMode) => {
  if (queryMode === "none") return url.search === "";
  const entries = [...url.searchParams.entries()];
  return (
    entries.length === 1 &&
    entries[0]?.[0] === "roomId" &&
    DOCUMENT_ID_PATTERN.test(entries[0]?.[1] ?? "")
  );
};

const writeSocketError = (socket, statusLine) => {
  swallowStreamError(socket);
  try {
    socket.write(`HTTP/1.1 ${statusLine}\r\nConnection: close\r\n\r\n`);
  } catch {
    // Client may already be gone.
  }
  socket.destroy();
};

const serializeHeaders = (headers) =>
  Object.entries(headers)
    .flatMap(([name, value]) => {
      if (value === undefined) return [];
      return Array.isArray(value)
        ? value.map((entry) => `${name}: ${entry}`)
        : [`${name}: ${value}`];
    })
    .join("\r\n");

const publicHostFromRequest = (req) =>
  typeof req.headers.host === "string" && req.headers.host.length > 0
    ? req.headers.host
    : `127.0.0.1:${listenPort}`;

/**
 * Headers for upstream Next. Keep the browser-facing Host / forwarded host so
 * Server Actions CSRF accepts Origin from the public gateway port.
 */
const nextProxyHeaders = (req) => {
  const publicHost = publicHostFromRequest(req);
  return {
    ...req.headers,
    host: publicHost,
    "x-forwarded-host": publicHost,
    "x-forwarded-proto": "http",
    "x-forwarded-port": String(listenPort),
  };
};

const proxyHttp = (req, res, targetOrigin) => {
  swallowStreamError(req);
  swallowStreamError(res);

  const proxyReq = http.request(
    {
      protocol: targetOrigin.protocol,
      hostname: targetOrigin.hostname,
      port: targetOrigin.port,
      path: req.url,
      method: req.method,
      headers: nextProxyHeaders(req),
    },
    (proxyRes) => {
      swallowStreamError(proxyRes);
      if (res.writableEnded || res.destroyed) {
        proxyRes.destroy();
        return;
      }
      res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
      proxyRes.pipe(res);
      res.on("close", () => {
        if (!proxyRes.destroyed) proxyRes.destroy();
      });
    },
  );
  swallowStreamError(proxyReq);
  proxyReq.on("error", () => {
    if (!res.headersSent && !res.writableEnded) {
      res.writeHead(502);
      res.end("Bad gateway");
      return;
    }
    res.destroy();
  });
  req.on("aborted", () => {
    proxyReq.destroy();
  });
  req.pipe(proxyReq);
};

const pipeUpgrade = (req, socket, head, targetOrigin, path, headers) => {
  swallowStreamError(socket);

  const proxyReq = http.request({
    protocol: targetOrigin.protocol,
    hostname: targetOrigin.hostname,
    port: targetOrigin.port,
    path,
    method: "GET",
    headers,
  });
  swallowStreamError(proxyReq);

  proxyReq.on("upgrade", (proxyRes, proxySocket, proxyHead) => {
    swallowStreamError(proxySocket);
    try {
      socket.write(
        `HTTP/1.1 101 Switching Protocols\r\n${serializeHeaders(proxyRes.headers)}\r\n\r\n`,
      );
    } catch {
      proxySocket.destroy();
      return;
    }
    if (proxyHead.length > 0) socket.write(proxyHead);
    if (head.length > 0) proxySocket.write(head);
    const tearDown = () => {
      proxySocket.destroy();
      socket.destroy();
    };
    proxySocket.on("error", tearDown);
    socket.on("error", tearDown);
    proxySocket.on("close", tearDown);
    socket.on("close", tearDown);
    proxySocket.pipe(socket);
    socket.pipe(proxySocket);
  });

  proxyReq.on("response", (proxyRes) => {
    swallowStreamError(proxyRes);
    try {
      socket.write(
        `HTTP/1.1 ${proxyRes.statusCode} ${proxyRes.statusMessage}\r\n${serializeHeaders(proxyRes.headers)}\r\n\r\n`,
      );
    } catch {
      proxyRes.destroy();
      return;
    }
    proxyRes.on("error", () => {
      socket.destroy();
    });
    proxyRes.pipe(socket);
  });

  proxyReq.on("error", () => {
    socket.destroy();
  });
  proxyReq.end();
};

const server = http.createServer((req, res) => {
  proxyHttp(req, res, nextOrigin);
});

server.on("clientError", (error, socket) => {
  swallowStreamError(socket);
  if (error.code === "ECONNRESET" || !socket.writable) {
    socket.destroy();
    return;
  }
  writeSocketError(socket, "400 Bad Request");
});

server.on("upgrade", (req, socket, head) => {
  swallowStreamError(socket);
  let requestUrl;
  try {
    requestUrl = new URL(req.url ?? "/", publicOrigin);
  } catch {
    writeSocketError(socket, "400 Bad Request");
    return;
  }

  const route = collabRoutes.get(requestUrl.pathname);
  if (route === undefined) {
    pipeUpgrade(
      req,
      socket,
      head,
      nextOrigin,
      `${requestUrl.pathname}${requestUrl.search}`,
      nextProxyHeaders(req),
    );
    return;
  }

  if (
    !isWebSocketUpgrade(req) ||
    !hasValidGatewayQuery(requestUrl, route.query)
  ) {
    writeSocketError(socket, "400 Bad Request");
    return;
  }
  if (!isSameOriginBrowserRequest(req)) {
    writeSocketError(socket, "403 Forbidden");
    return;
  }

  const backendUrl = new URL(route.backendPath, collabOrigin);
  if (route.query === "room") backendUrl.search = requestUrl.search;

  let authHeaders;
  try {
    authHeaders = createCollabGatewayAuthHeaders({
      config: signerConfig,
      webSocketKey: req.headers["sec-websocket-key"],
      path: `${backendUrl.pathname}${backendUrl.search}`,
    });
  } catch {
    writeSocketError(socket, "400 Bad Request");
    return;
  }

  const headers = { ...req.headers, host: collabOrigin.host };
  for (const header of SENSITIVE_FORWARDED_HEADERS) {
    delete headers[header];
  }
  for (const header of COLLAB_GATEWAY_AUTH_HEADER_NAMES) {
    delete headers[header];
  }
  for (const header of COLLAB_GATEWAY_AUTH_HEADER_NAMES) {
    const value = authHeaders.get(header);
    if (value !== null) headers[header] = value;
  }

  pipeUpgrade(
    req,
    socket,
    head,
    collabOrigin,
    `${backendUrl.pathname}${backendUrl.search}`,
    headers,
  );
});

server.listen(listenPort, "127.0.0.1", () => {
  console.log(
    `E2E collab gateway on ${publicOrigin} → next ${nextOrigin.origin}, collab ${collabOrigin.origin}`,
  );
});
