import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { encodeMessage, MessageBuffer } from './framing.ts';

describe('encodeMessage', () => {
  it('frames a payload with a Content-Length header and CRLF separator', () => {
    const got = encodeMessage({ jsonrpc: '2.0', id: 1, method: 'shutdown' });
    const body = '{"jsonrpc":"2.0","id":1,"method":"shutdown"}';
    assert.equal(got, `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  });

  it('counts bytes, not characters, for non-ASCII payloads', () => {
    const got = encodeMessage({ m: 'ké' });
    assert.match(got, /^Content-Length: 11\r\n\r\n/);
  });
});

describe('MessageBuffer', () => {
  it('returns nothing until a whole message has arrived', () => {
    const buf = new MessageBuffer();
    const body = '{"a":1}';
    assert.deepEqual(buf.push(`Content-Length: ${body.length}\r\n\r\n`), []);
    assert.deepEqual(buf.push(body), [{ a: 1 }]);
  });

  it('decodes several messages delivered in one chunk', () => {
    const buf = new MessageBuffer();
    const chunk = encodeMessage({ a: 1 }) + encodeMessage({ b: 2 });
    assert.deepEqual(buf.push(chunk), [{ a: 1 }, { b: 2 }]);
  });

  it('decodes a message split mid-header', () => {
    const buf = new MessageBuffer();
    const whole = encodeMessage({ a: 1 });
    assert.deepEqual(buf.push(whole.slice(0, 5)), []);
    assert.deepEqual(buf.push(whole.slice(5)), [{ a: 1 }]);
  });

  it('splits on byte length so a multi-byte payload is not truncated', () => {
    const buf = new MessageBuffer();
    assert.deepEqual(buf.push(encodeMessage({ m: 'ké' }) + encodeMessage({ n: 2 })), [
      { m: 'ké' },
      { n: 2 },
    ]);
  });

  it('ignores extra headers a server may send', () => {
    const buf = new MessageBuffer();
    const body = '{"a":1}';
    const framed = `Content-Length: ${body.length}\r\nContent-Type: application/vscode-jsonrpc\r\n\r\n${body}`;
    assert.deepEqual(buf.push(framed), [{ a: 1 }]);
  });

  it('throws on a frame with no Content-Length rather than hanging forever', () => {
    const buf = new MessageBuffer();
    assert.throws(() => buf.push('Content-Type: text/plain\r\n\r\n{}'), /Content-Length/);
  });
});
