import { type Language, Parser, Query, type Tree } from 'web-tree-sitter';
import { buildTokens, type RawCapture, type SemanticToken } from './paint.js';
import { defaultGrammarPaths, type GrammarPaths, loadGrammar } from './wasm.js';

/**
 * The whole highlighting engine, free of any `vscode` import so it is testable
 * without an extension host. `provider.ts` is the thin adapter over it.
 *
 * A `TypingSession` holds one document's tree and re-parses incrementally as
 * edits arrive. Incremental parsing is not an optimisation detail here — it is
 * what makes mid-typing states cheap enough to re-highlight on every keystroke,
 * which is the state R1 (`typing-session.e2e.test.ts`) pins down.
 */
export class MHighlighter {
  private constructor(
    private readonly language: Language,
    private readonly query: Query,
    readonly artifactSha256: string,
    readonly grammarVersion: string,
  ) {}

  static async create(baseDir: string, overrides?: Partial<GrammarPaths>): Promise<MHighlighter> {
    const paths = { ...defaultGrammarPaths(baseDir), ...overrides };
    const loaded = await loadGrammar(paths);
    return new MHighlighter(
      loaded.language,
      new Query(loaded.language, loaded.highlights),
      loaded.artifactSha256,
      loaded.grammarVersion,
    );
  }

  open(text: string): TypingSession {
    const parser = new Parser();
    parser.setLanguage(this.language);
    return new TypingSession(parser, this.query, text);
  }

  dispose(): void {
    this.query.delete();
  }
}

export class TypingSession {
  private tree: Tree;
  private cached: SemanticToken[] | undefined;
  private cachedCaptures: RawCapture[] | undefined;

  constructor(
    private readonly parser: Parser,
    private readonly query: Query,
    private buffer: string,
  ) {
    this.tree = parse(parser, buffer, undefined);
  }

  get text(): string {
    return this.buffer;
  }

  get rootType(): string {
    return this.tree.rootNode.type;
  }

  get hasError(): boolean {
    return this.tree.rootNode.hasError;
  }

  /** Apply one edit — `[start, end)` replaced by `inserted` — and re-parse. */
  replace(startIndex: number, endIndex: number, inserted: string): void {
    const old = this.buffer;
    const next = old.slice(0, startIndex) + inserted + old.slice(endIndex);
    const newEndIndex = startIndex + inserted.length;

    this.tree.edit({
      startIndex,
      oldEndIndex: endIndex,
      newEndIndex,
      startPosition: pointAt(old, startIndex),
      oldEndPosition: pointAt(old, endIndex),
      newEndPosition: pointAt(next, newEndIndex),
    });

    const previous = this.tree;
    this.tree = parse(this.parser, next, previous);
    previous.delete();
    this.buffer = next;
    this.cached = undefined;
    this.cachedCaptures = undefined;
  }

  captures(): RawCapture[] {
    this.cachedCaptures ??= this.query.captures(this.tree.rootNode).map((c) => ({
      name: c.name,
      startRow: c.node.startPosition.row,
      startColumn: c.node.startPosition.column,
      endRow: c.node.endPosition.row,
      endColumn: c.node.endPosition.column,
    }));
    return this.cachedCaptures;
  }

  /** The distinct capture names this document actually produced. */
  captureNames(): string[] {
    return [...new Set(this.captures().map((c) => c.name))];
  }

  tokens(): SemanticToken[] {
    this.cached ??= buildTokens(this.captures());
    return this.cached;
  }

  dispose(): void {
    this.tree.delete();
    this.parser.delete();
  }
}

function parse(parser: Parser, text: string, previous: Tree | undefined): Tree {
  const tree = parser.parse(text, previous);
  if (!tree) {
    // The parser only returns null when it was cancelled or ran out of budget;
    // we set neither, so this is unreachable — and if it ever happens, an
    // uncoloured editor with no explanation is the one outcome to avoid.
    throw new Error('tree-sitter returned no tree for the document (parser cancelled?)');
  }
  return tree;
}

/** Byte-free position lookup: JS string indices are UTF-16, like tree-sitter's columns. */
function pointAt(text: string, index: number): { row: number; column: number } {
  let row = 0;
  let lineStart = 0;
  for (let i = 0; i < index && i < text.length; i++) {
    if (text[i] === '\n') {
      row += 1;
      lineStart = i + 1;
    }
  }
  return { row, column: Math.min(index, text.length) - lineStart };
}
