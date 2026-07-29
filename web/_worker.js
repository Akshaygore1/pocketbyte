const RANGE_PATTERN = /^bytes=(\d*)-(\d*)$/;
const RUNTIME_JAR_PATH = "/freej2me-web.jar";

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

function responseHeaders(source) {
  const headers = new Headers(source);
  headers.set("Accept-Ranges", "bytes");
  headers.delete("Content-Encoding");
  return headers;
}

async function serveRuntimeJar(request, assets) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "GET, HEAD" },
    });
  }

  const assetHeaders = new Headers(request.headers);
  assetHeaders.delete("Range");
  assetHeaders.delete("If-Range");
  const assetRequest = new Request(request.url, {
    method: "GET",
    headers: assetHeaders,
  });
  const assetResponse = await assets.fetch(assetRequest);
  if (!assetResponse.ok) return assetResponse;

  const rangeHeader = request.headers.get("Range");
  if (!rangeHeader) {
    const headers = responseHeaders(assetResponse.headers);
    return new Response(
      request.method === "HEAD" ? null : assetResponse.body,
      {
        status: assetResponse.status,
        statusText: assetResponse.statusText,
        headers,
      },
    );
  }

  const assetBytes = await assetResponse.arrayBuffer();
  const range = parseByteRange(rangeHeader, assetBytes.byteLength);
  if (!range) {
    return new Response(null, {
      status: 416,
      headers: {
        "Accept-Ranges": "bytes",
        "Content-Range": `bytes */${assetBytes.byteLength}`,
      },
    });
  }

  const contentLength = range.end - range.start + 1;
  const headers = responseHeaders(assetResponse.headers);
  headers.set("Content-Length", String(contentLength));
  headers.set(
    "Content-Range",
    `bytes ${range.start}-${range.end}/${assetBytes.byteLength}`,
  );

  return new Response(
    request.method === "HEAD"
      ? null
      : assetBytes.slice(range.start, range.end + 1),
    { status: 206, headers },
  );
}

export default {
  fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === RUNTIME_JAR_PATH) {
      return serveRuntimeJar(request, env.ASSETS);
    }
    return env.ASSETS.fetch(request);
  },
};
