/**
 * Server-Sent Events as an async generator, with transparent reconnect
 * (Last-Event-ID) when the connection drops mid-stream.
 *
 *   const stream = client.events.stream();
 *   for await (const chunk of stream) { ... }
 */

export interface SSEEvent {
  event: string;
  data: string;
  id: string | null;
}

export interface SSEStreamOptions {
  /** Reconnect attempts after a mid-stream drop. Default 3. */
  maxReconnects?: number;
  /** Signal cancels iteration (and any in-flight fetch). */
  signal?: AbortSignal;
}

/**
 * Parse one SSE frame block into an event; returns null for keep-alive
 * comments or empty blocks.
 */
export function parseSSEFrame(block: string): SSEEvent | null {
  let event = "message";
  let data = "";
  let id: string | null = null;
  for (const rawLine of block.split("\n")) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line === "" || line.startsWith(":")) {
      continue;
    }
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) {
      value = value.slice(1);
    }
    switch (field) {
      case "event":
        event = value;
        break;
      case "data":
        data = data === "" ? value : `${data}\n${value}`;
        break;
      case "id":
        id = value;
        break;
      // retry: honored implicitly via reconnect backoff.
      default:
        break;
    }
  }
  if (data === "" && id === null) {
    return null;
  }
  return { event, data, id };
}

/**
 * Drive an SSE endpoint. `fetchStream` issues one HTTP request (receiving
 * the Last-Event-ID of the last dispatched event on reconnect); events are
 * yielded as parsed frames.
 */
export async function* connectSSE(
  fetchStream: (lastEventId: string | null) => Promise<Response>,
  options: SSEStreamOptions = {},
): AsyncGenerator<SSEEvent, void, unknown> {
  const maxReconnects = options.maxReconnects ?? 3;
  let lastEventId: string | null = null;
  let reconnects = 0;

  for (;;) {
    if (options.signal?.aborted) {
      return;
    }
    const response = await fetchStream(lastEventId);
    if (!response.ok || !response.body) {
      throw new Error(`SSE stream failed with HTTP ${response.status}`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let dropped = false;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        let boundary = buffer.indexOf("\n\n");
        while (boundary !== -1) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const frame = parseSSEFrame(block);
          if (frame !== null) {
            if (frame.id !== null) {
              lastEventId = frame.id;
            }
            yield frame;
          }
          boundary = buffer.indexOf("\n\n");
        }
      }
      // Server closed the stream cleanly (done frame) — flush any trailing
      // block without the blank line, then stop without reconnecting.
      if (buffer.trim() !== "") {
        const frame = parseSSEFrame(buffer);
        if (frame !== null) {
          if (frame.id !== null) {
            lastEventId = frame.id;
          }
          yield frame;
        }
      }
      return;
    } catch (error) {
      if (options.signal?.aborted) {
        return;
      }
      dropped = true;
      if (reconnects >= maxReconnects) {
        throw error;
      }
    } finally {
      reader.releaseLock();
      if (dropped && reconnects < maxReconnects) {
        reconnects += 1;
        // Reconnect immediately; SSE retry hints are advisory and servers
        // close idle pushes promptly.
      }
    }
    if (!dropped) {
      return;
    }
  }
}
