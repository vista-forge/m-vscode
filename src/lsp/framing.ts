/**
 * `Content-Length` message framing for the base JSON-RPC protocol LSP rides on.
 *
 * The extension itself never uses this — `vscode-languageclient` owns the wire
 * in the extension host. It exists so the **equivalence gate** can talk to a
 * real `m lsp` process headlessly, with no VS Code instance, and still exercise
 * the same bytes the editor would exchange.
 */

/** Frame one JSON payload for transmission. */
export function encodeMessage(payload: unknown): string {
  const body = JSON.stringify(payload);
  return `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`;
}

/**
 * Incremental decoder: feed it whatever arrives on stdout, get back whole
 * messages. Buffers in bytes, because `Content-Length` counts bytes and a
 * chunk boundary can land inside a multi-byte character.
 */
export class MessageBuffer {
  private buf = Buffer.alloc(0);

  push(chunk: string | Buffer): unknown[] {
    this.buf = Buffer.concat([this.buf, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
    const out: unknown[] = [];
    for (;;) {
      const sep = this.buf.indexOf('\r\n\r\n');
      if (sep < 0) return out;
      const header = this.buf.subarray(0, sep).toString('ascii');
      const match = /^content-length:\s*(\d+)\s*$/im.exec(header);
      if (!match?.[1]) throw new Error(`LSP frame has no Content-Length header: ${header}`);
      const length = Number(match[1]);
      const start = sep + 4;
      if (this.buf.length < start + length) return out; // body still in flight
      out.push(JSON.parse(this.buf.subarray(start, start + length).toString('utf8')));
      this.buf = this.buf.subarray(start + length);
    }
  }
}
