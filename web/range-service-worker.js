const CACHE_PREFIX = "pocketbyte-runtime-range-";
const CACHE_NAME = `${CACHE_PREFIX}v1-972381`;
const RUNTIME_JAR_PATH = "/freej2me-web.jar";
const RANGE_PATTERN = /^bytes=(\d*)-(\d*)$/;

function parseByteRange(value, size) {
  if (!value || value.includes(",")) return null;

  const match = RANGE_PATTERN.exec(value.trim());
  if (!match || (!match[1] && !match[2])) return null;

  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    return {
      start: Math.max(size - suffixLength, 0),
      end: size - 1,
    };
  }

  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (
    !Number.isSafeInteger(start)
    || !Number.isSafeInteger(requestedEnd)
    || start < 0
    || requestedEnd < start
    || start >= size
  ) {
    return null;
  }

  return {
    start,
    end: Math.min(requestedEnd, size - 1),
  };
}

async function readRuntimeJar(request) {
  const cache = await caches.open(CACHE_NAME);
  const cacheKey = new Request(new URL(RUNTIME_JAR_PATH, request.url));
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const headers = new Headers(request.headers);
  headers.delete("Range");
  headers.delete("If-Range");
  const response = await fetch(new Request(cacheKey, { headers }));
  if (response.ok) await cache.put(cacheKey, response.clone());
  return response;
}

function runtimeHeaders(source) {
  const headers = new Headers(source);
  headers.set("Accept-Ranges", "bytes");
  headers.delete("Content-Encoding");
  return headers;
}

async function serveRuntimeJar(request) {
  const response = await readRuntimeJar(request);
  if (!response.ok) return response;

  const rangeHeader = request.headers.get("Range");
  if (!rangeHeader) {
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: runtimeHeaders(response.headers),
    });
  }

  const bytes = await response.arrayBuffer();
  const range = parseByteRange(rangeHeader, bytes.byteLength);
  if (!range) {
    return new Response(null, {
      status: 416,
      headers: {
        "Accept-Ranges": "bytes",
        "Content-Range": `bytes */${bytes.byteLength}`,
      },
    });
  }

  const headers = runtimeHeaders(response.headers);
  headers.set("Content-Length", String(range.end - range.start + 1));
  headers.set(
    "Content-Range",
    `bytes ${range.start}-${range.end}/${bytes.byteLength}`,
  );
  return new Response(bytes.slice(range.start, range.end + 1), {
    status: 206,
    headers,
  });
}

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
        .map((key) => caches.delete(key)),
    );
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data === "claim-clients") {
    event.waitUntil(self.clients.claim());
  }
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method === "GET"
    && url.origin === self.location.origin
    && url.pathname === RUNTIME_JAR_PATH
  ) {
    event.respondWith(serveRuntimeJar(event.request));
  }
});
