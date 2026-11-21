package com.codexagents.dashboard;

import android.content.res.AssetManager;
import fi.iki.elonen.NanoHTTPD;
import fi.iki.elonen.NanoHTTPD.Response.Status;
import java.io.ByteArrayOutputStream;
import java.io.EOFException;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import org.json.JSONObject;

final class DashboardServer extends NanoHTTPD {
  static final int PORT = 4321;
  private static final int MAX_BYTES = 1024 * 1024;
  private static final String JSON = "application/json; charset=utf-8";
  private final AssetManager assets;
  private final HookNormalizer normalizer;
  private final LiveStream stream;
  private final boolean dashboard;

  DashboardServer(String address, AssetManager assets, HookNormalizer normalizer, LiveStream stream, boolean dashboard) {
    super(address, PORT);
    this.assets = assets;
    this.normalizer = normalizer;
    this.stream = stream;
    this.dashboard = dashboard;
    setAsyncRunner(new BoundedConnections());
  }

  @Override
  public Response serve(IHTTPSession request) {
    String path = request.getUri();
    Response response;
    if ("/api/events".equals(path)) {
      response = request.getMethod() == Method.POST ? receive(request) : error(Status.METHOD_NOT_ALLOWED, "Use POST.");
    } else if (!dashboard) {
      response = error(Status.NOT_FOUND, "Not found.");
    } else if (request.getMethod() != Method.GET) {
      response = error(Status.METHOD_NOT_ALLOWED, "Use GET.");
    } else if ("/api/stream".equals(path)) {
      response = newChunkedResponse(Status.OK, "text/event-stream; charset=utf-8", stream.subscribe());
    } else if ("/api/usage".equals(path)) {
      String json = "{\"status\":\"unavailable\",\"remainingPercent\":null,\"resetsAt\":null,\"checkedAt\":\"" + Instant.now() + "\"}";
      response = newFixedLengthResponse(Status.OK, JSON, json);
    } else {
      response = asset(path);
    }
    response.addHeader("Cache-Control", "no-store, no-transform");
    response.addHeader("X-Content-Type-Options", "nosniff");
    response.closeConnection(true);
    return response;
  }

  @Override
  protected boolean useGzipWhenAccepted(Response response) {
    return false;
  }

  private Response receive(IHTTPSession request) {
    Map<String, String> headers = request.getHeaders();
    if (!headers.getOrDefault("content-type", "").toLowerCase(Locale.ROOT).startsWith("application/json")) {
      return error(Status.UNSUPPORTED_MEDIA_TYPE, "Use Content-Type: application/json.");
    }
    try {
      String body = readBody(request.getInputStream(), headers);
      HookNormalizer.Result result = normalizer.normalize(body, headers.get("x-machine"), headers.get("x-harness"));
      if (result.status == 400) return newFixedLengthResponse(Status.BAD_REQUEST, JSON, result.json);
      stream.sendEvent(result.json);
      return newFixedLengthResponse(Status.NO_CONTENT, null, "");
    } catch (ResponseException invalid) {
      return error(invalid.getStatus(), invalid.getMessage());
    } catch (IOException invalid) {
      return error(Status.BAD_REQUEST, "Invalid request body.");
    }
  }

  private static String readBody(InputStream input, Map<String, String> headers) throws IOException, ResponseException {
    ByteArrayOutputStream body = new ByteArrayOutputStream();
    String transfer = headers.get("transfer-encoding");
    String length = headers.get("content-length");
    if (transfer == null) {
      if (length == null) throw new ResponseException(Status.BAD_REQUEST, "A JSON body is required.");
      copyBody(input, body, bodyLength(length, 10));
    } else {
      if (length != null || !"chunked".equalsIgnoreCase(transfer)) {
        throw new ResponseException(Status.BAD_REQUEST, "Invalid request framing.");
      }
      while (true) {
        String sizeLine = readChunkLine(input);
        int extension = sizeLine.indexOf(';');
        int chunkSize = bodyLength(extension < 0 ? sizeLine : sizeLine.substring(0, extension), 16);
        if (chunkSize == 0) break;
        copyBody(input, body, chunkSize);
        if (input.read() != '\r' || input.read() != '\n') throw new IOException("Invalid chunk delimiter.");
      }
    }
    return new String(body.toByteArray(), StandardCharsets.UTF_8);
  }

  private static int bodyLength(String value, int radix) throws ResponseException {
    if (!value.matches(radix == 16 ? "[0-9A-Fa-f]+" : "[0-9]+")) {
      throw new ResponseException(Status.BAD_REQUEST, "Invalid request size.");
    }
    try {
      long count = Long.parseLong(value, radix);
      if (count <= MAX_BYTES) return (int) count;
    } catch (NumberFormatException overflow) {
      // The decimal or hexadecimal digits exceed a long and also exceed the body limit.
    }
    throw new ResponseException(Status.PAYLOAD_TOO_LARGE, "Body exceeds 1 MiB.");
  }

  private static void copyBody(InputStream input, ByteArrayOutputStream body, int count) throws IOException, ResponseException {
    if (count > MAX_BYTES - body.size()) throw new ResponseException(Status.PAYLOAD_TOO_LARGE, "Body exceeds 1 MiB.");
    byte[] buffer = new byte[Math.min(count, 8192)];
    while (count > 0) {
      int read = input.read(buffer, 0, Math.min(count, buffer.length));
      if (read < 0) throw new EOFException();
      body.write(buffer, 0, read);
      count -= read;
    }
  }

  private static String readChunkLine(InputStream input) throws IOException {
    StringBuilder line = new StringBuilder();
    for (int next = input.read(); next >= 0 && line.length() < 256; next = input.read()) {
      if (next == '\r' && input.read() == '\n') return line.toString();
      if (next < 32 || next > 126) break;
      line.append((char) next);
    }
    throw new IOException("Invalid chunk size line.");
  }

  private Response asset(String path) {
    if ("/".equals(path)) path = "/index.html";
    if (!"/index.html".equals(path) && !"/theme.js".equals(path)
        && !"/favicon.svg".equals(path) && !"/favicon-attention.svg".equals(path)
        && !path.matches("/_astro/[A-Za-z0-9_-][A-Za-z0-9_.-]*")) {
      return error(Status.NOT_FOUND, "Not found.");
    }
    String type = path.endsWith(".js") ? "text/javascript; charset=utf-8"
        : path.endsWith(".css") ? "text/css; charset=utf-8"
        : path.endsWith(".svg") ? "image/svg+xml" : "text/html; charset=utf-8";
    try {
      return newChunkedResponse(Status.OK, type, assets.open("site" + path));
    } catch (IOException missing) {
      return error(Status.NOT_FOUND, "Not found.");
    }
  }

  private static Response error(Status status, String message) {
    return newFixedLengthResponse(status, JSON, "{\"error\":" + JSONObject.quote(message) + "}");
  }

  private static final class BoundedConnections implements AsyncRunner {
    private final Set<ClientHandler> clients = ConcurrentHashMap.newKeySet();
    private boolean closed;

    @Override
    public synchronized void exec(ClientHandler client) {
      if (closed || clients.size() >= 16) {
        client.close();
        return;
      }
      clients.add(client);
      Thread thread = new Thread(client, "Dashboard HTTP");
      thread.setDaemon(true);
      thread.start();
    }

    @Override
    public void closed(ClientHandler client) {
      clients.remove(client);
    }

    @Override
    public synchronized void closeAll() {
      closed = true;
      for (ClientHandler client : clients) client.close();
    }
  }
}
