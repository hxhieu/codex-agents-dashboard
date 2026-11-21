package com.codexagents.dashboard;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Set;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.CopyOnWriteArraySet;
import java.util.concurrent.TimeUnit;
import org.json.JSONObject;

final class LiveStream {
  private static final byte[] CONNECTED = bytes(": connected\n\n");
  private static final byte[] KEEPALIVE = bytes(": keepalive\n\n");
  private static final byte[] END = new byte[0];
  private final Set<Subscriber> subscribers = new CopyOnWriteArraySet<>();
  private byte[] receiver = frame("receiver", "{\"status\":\"Starting Wi-Fi receiver…\"}");

  synchronized InputStream subscribe() {
    Subscriber subscriber = new Subscriber();
    subscriber.send(CONNECTED);
    subscriber.send(receiver);
    subscribers.add(subscriber);
    return subscriber;
  }

  void sendEvent(String json) {
    send(frame("agent", json));
  }

  synchronized void setReceiver(String url, String status) {
    String json = "{\"url\":" + JSONObject.quote(url == null ? "" : url) + ",\"status\":" + JSONObject.quote(status) + "}";
    receiver = frame("receiver", json);
    send(receiver);
  }

  synchronized void close() {
    for (Subscriber subscriber : subscribers) subscriber.close();
  }

  private synchronized void send(byte[] bytes) {
    for (Subscriber subscriber : subscribers) subscriber.send(bytes);
  }

  private static byte[] frame(String event, String json) {
    return bytes("event: " + event + "\ndata: " + json + "\n\n");
  }

  private static byte[] bytes(String value) {
    return value.getBytes(StandardCharsets.UTF_8);
  }

  private final class Subscriber extends InputStream {
    private final ArrayBlockingQueue<byte[]> queue = new ArrayBlockingQueue<>(32);
    private byte[] current = END;
    private int position;
    private volatile boolean closed;

    void send(byte[] frame) {
      if (!closed && !queue.offer(frame)) close();
    }

    @Override
    public int read(byte[] buffer, int offset, int length) {
      if (length == 0) return 0;
      if (closed) return -1;
      if (position == current.length) {
        try {
          current = queue.poll(15, TimeUnit.SECONDS);
        } catch (InterruptedException interrupted) {
          Thread.currentThread().interrupt();
          close();
          return -1;
        }
        if (current == END || closed) return -1;
        if (current == null) current = KEEPALIVE;
        position = 0;
      }
      int count = Math.min(length, current.length - position);
      System.arraycopy(current, position, buffer, offset, count);
      position += count;
      return count;
    }

    @Override
    public int read() {
      byte[] single = new byte[1];
      return read(single, 0, 1) < 0 ? -1 : Byte.toUnsignedInt(single[0]);
    }

    @Override
    public void close() {
      closed = true;
      subscribers.remove(this);
      queue.clear();
      queue.offer(END);
    }
  }
}
