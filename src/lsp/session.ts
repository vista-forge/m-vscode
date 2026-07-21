/**
 * A minimal headless LSP session over a child process's stdio.
 *
 * Used ONLY by the equivalence gate. The shipped extension talks to `m lsp`
 * through `vscode-languageclient`; this exists so the gate can prove
 * editor/CI diagnostic parity in a plain `node:test` run, with no VS Code
 * instance and no network.
 *
 * Deliberately small — it implements exactly the four messages the gate needs
 * (initialize, didOpen, formatting, shutdown/exit) and nothing more.
 */

import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { encodeMessage, MessageBuffer } from './framing.js';
import type { LspDiagnosticLike } from './normalize.js';

interface RpcMessage {
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
}

export interface TextEdit {
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
  newText: string;
}

export interface LspPosition {
  line: number;
  character: number;
}

export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

export interface MarkupContent {
  kind: string;
  value: string;
}

export interface HoverResult {
  contents: MarkupContent;
  range?: LspRange;
}

export interface CompletionItemResult {
  label: string;
  kind?: number;
  detail?: string;
  documentation?: MarkupContent | string;
  sortText?: string;
}

export interface DocumentSymbolResult {
  name: string;
  kind: number;
  range: LspRange;
  selectionRange: LspRange;
  children?: DocumentSymbolResult[];
}

export interface FoldingRangeResult {
  startLine: number;
  endLine: number;
  kind?: string;
}

const DEFAULT_TIMEOUT_MS = 60_000;

export class LspSession {
  private proc: ChildProcessWithoutNullStreams | undefined;
  private readonly buffer = new MessageBuffer();
  private nextId = 1;
  private readonly pending = new Map<number, (m: RpcMessage) => void>();
  private readonly notificationWaiters: ((m: RpcMessage) => boolean)[] = [];
  private stderr = '';

  /** The server's advertised capabilities, available after `start`. */
  capabilities: unknown;

  constructor(
    private readonly command: string,
    private readonly args: readonly string[],
  ) {}

  async start(rootDir: string): Promise<void> {
    const proc = spawn(this.command, [...this.args], {
      cwd: rootDir,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.proc = proc;
    proc.on('error', (err) => {
      throw new Error(
        `could not launch \`${this.command} ${this.args.join(' ')}\`: ${err.message}`,
      );
    });
    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', (chunk: string) => {
      this.stderr += chunk;
    });
    proc.stdout.on('data', (chunk: Buffer) => {
      for (const msg of this.buffer.push(chunk)) this.dispatch(msg as RpcMessage);
    });

    const init = (await this.request('initialize', {
      processId: process.pid,
      rootUri: pathToFileURL(rootDir).href,
      capabilities: {},
    })) as { capabilities?: unknown };
    this.capabilities = init.capabilities;
    this.notify('initialized', {});
  }

  /** Open a document and resolve with the first diagnostics published for it. */
  async openAndAwaitDiagnostics(path: string, text: string): Promise<LspDiagnosticLike[]> {
    const uri = pathToFileURL(path).href;
    const published = this.awaitNotification('textDocument/publishDiagnostics', uri);
    this.notify('textDocument/didOpen', {
      textDocument: { uri, languageId: 'mumps', version: 1, text },
    });
    return published;
  }

  /**
   * Send a full-text didChange and resolve with the next diagnostics publish
   * for the document — the W0-c "didChange→publish" instrument, used by the
   * E3 acceptance runner to measure the ratified live-lint budget at the
   * layer it was ratified on (the server), independent of host-side costs.
   */
  async changeAndAwaitDiagnostics(
    path: string,
    text: string,
    version: number,
  ): Promise<LspDiagnosticLike[]> {
    const uri = pathToFileURL(path).href;
    const published = this.awaitNotification('textDocument/publishDiagnostics', uri);
    this.notify('textDocument/didChange', {
      textDocument: { uri, version },
      contentChanges: [{ text }],
    });
    return published;
  }

  async formatting(path: string): Promise<TextEdit[]> {
    const result = await this.request('textDocument/formatting', {
      textDocument: { uri: pathToFileURL(path).href },
      options: { tabSize: 1, insertSpaces: true },
    });
    return (result ?? []) as TextEdit[];
  }

  /**
   * P3-feat Session B. These four exist ONLY to prove, against the real
   * server, that hover/completion/documentSymbol/foldingRange answer with
   * real content over the wire — this session is the headless stand-in for
   * `vscode-languageclient`'s built-in features (HoverFeature,
   * CompletionItemFeature, DocumentSymbolFeature, FoldingRangeFeature), which
   * the shipped extension relies on instead of hand-rolling any of this.
   */

  async hover(path: string, position: LspPosition): Promise<HoverResult | null> {
    const result = await this.request('textDocument/hover', {
      textDocument: { uri: pathToFileURL(path).href },
      position,
    });
    return (result ?? null) as HoverResult | null;
  }

  async completion(path: string, position: LspPosition): Promise<CompletionItemResult[]> {
    const result = await this.request('textDocument/completion', {
      textDocument: { uri: pathToFileURL(path).href },
      position,
    });
    if (Array.isArray(result)) return result as CompletionItemResult[];
    const list = result as { items?: CompletionItemResult[] } | null;
    return list?.items ?? [];
  }

  async documentSymbol(path: string): Promise<DocumentSymbolResult[]> {
    const result = await this.request('textDocument/documentSymbol', {
      textDocument: { uri: pathToFileURL(path).href },
    });
    return (result ?? []) as DocumentSymbolResult[];
  }

  async foldingRange(path: string): Promise<FoldingRangeResult[]> {
    const result = await this.request('textDocument/foldingRange', {
      textDocument: { uri: pathToFileURL(path).href },
    });
    return (result ?? []) as FoldingRangeResult[];
  }

  async stop(): Promise<void> {
    if (!this.proc) return;
    try {
      await this.request('shutdown', null);
      this.notify('exit', null);
    } catch {
      // A server that already died needs no polite shutdown.
    }
    const proc = this.proc;
    this.proc = undefined;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        proc.kill('SIGKILL');
        resolve();
      }, 2_000);
      proc.on('close', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  private dispatch(msg: RpcMessage): void {
    if (typeof msg.id === 'number' && this.pending.has(msg.id)) {
      const resolve = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      resolve?.(msg);
      return;
    }
    for (let i = this.notificationWaiters.length - 1; i >= 0; i--) {
      if (this.notificationWaiters[i]?.(msg)) this.notificationWaiters.splice(i, 1);
    }
  }

  private send(payload: unknown): void {
    if (!this.proc) throw new Error('LSP session is not running');
    this.proc.stdin.write(encodeMessage(payload));
  }

  private notify(method: string, params: unknown): void {
    this.send({ jsonrpc: '2.0', method, params });
  }

  private request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`LSP request ${method} timed out. stderr: ${this.stderr}`));
      }, DEFAULT_TIMEOUT_MS);
      this.pending.set(id, (m) => {
        clearTimeout(timer);
        if (m.error) reject(new Error(`${method} failed: ${m.error.message}`));
        else resolve(m.result);
      });
      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  private awaitNotification(method: string, uri: string): Promise<LspDiagnosticLike[]> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`no ${method} for ${uri}. stderr: ${this.stderr}`));
      }, DEFAULT_TIMEOUT_MS);
      this.notificationWaiters.push((m) => {
        if (m.method !== method) return false;
        const p = m.params as { uri?: string; diagnostics?: LspDiagnosticLike[] } | undefined;
        if (p?.uri !== uri) return false;
        clearTimeout(timer);
        resolve(p.diagnostics ?? []);
        return true;
      });
    });
  }
}
