/**
 * The one place M colour is decided: tree-sitter capture name -> VS Code
 * semantic token type (+ modifiers).
 *
 * This file is the whole of this repo's "M knowledge" for highlighting, and it
 * is deliberately a lookup table with no logic. What each construct IS is
 * decided upstream in `tree-sitter-m/queries/highlights.scm`; this only
 * translates the vocabulary. (CLAUDE.md — thin client, fat toolchain.)
 *
 * Two rules govern it:
 *   1. Every capture the query declares must appear here — `mapping.test.ts`
 *      red-gates that, because an unmapped capture renders as plain text with
 *      no error anywhere.
 *   2. Only STANDARD VS Code token types are used. A custom type is coloured
 *      only if the active theme (or a `semanticTokenScopes` fallback) happens
 *      to map it — the same silent-uncoloured failure, one layer down and only
 *      for some users. We ship no custom types.
 */

export interface TokenMapping {
  readonly type: string;
  readonly modifiers: readonly string[];
}

/** The token types VS Code defines out of the box (every theme colours them). */
export const STANDARD_TOKEN_TYPES: readonly string[] = [
  'namespace',
  'class',
  'enum',
  'interface',
  'struct',
  'typeParameter',
  'type',
  'parameter',
  'variable',
  'property',
  'enumMember',
  'decorator',
  'event',
  'function',
  'method',
  'macro',
  'label',
  'comment',
  'string',
  'keyword',
  'number',
  'regexp',
  'operator',
];

export const STANDARD_TOKEN_MODIFIERS: readonly string[] = [
  'declaration',
  'definition',
  'readonly',
  'static',
  'deprecated',
  'abstract',
  'async',
  'modification',
  'documentation',
  'defaultLibrary',
];

const m = (type: string, ...modifiers: string[]): TokenMapping => ({ type, modifiers });

export const CAPTURE_MAP: Readonly<Record<string, TokenMapping>> = {
  // --- direct equivalents ---------------------------------------------------
  comment: m('comment'),
  string: m('string'),
  number: m('number'),
  keyword: m('keyword'),
  operator: m('operator'),
  variable: m('variable'),
  function: m('function'),
  // `label` is a standard VS Code type, so M's column-0 line labels map exactly.
  label: m('label'),
  // Formals `(A,B,C)` and by-reference `.VAR` — VS Code calls these parameters.
  'variable.parameter': m('parameter'),

  // --- judgement calls, each with its reason --------------------------------
  // Intrinsics ($ORDER, $ZTRNLNM …) are functions supplied by the engine, which
  // is precisely what `defaultLibrary` means.
  'function.builtin': m('function', 'defaultLibrary'),
  // Intrinsic special variables ($HOROLOG, $ZVERSION …). Not `readonly`: some
  // ($X, $Y, $ZTRAP) are assignable, so the modifier would be a lie.
  'variable.builtin': m('variable', 'defaultLibrary'),
  // Postconditionals `:cond`. The capture spans the whole `:expr`, but the
  // expression's own captures are narrower and win when painted, so in practice
  // this colours the `:` marker — which is the distinction worth drawing.
  'keyword.operator': m('keyword'),
  // Pattern-match codes (A, N, U, L, P, C, E) inside `?1A.N`. These are pattern
  // atoms, and `regexp` is the standard type themes reserve for exactly that.
  'constant.builtin': m('regexp'),
  // WRITE format controls (`!`, `#`, `?N`, `*x`) and dot-block depth prefixes.
  // VS Code has no punctuation token type; `operator` is the closest standard
  // type and themes colour it distinctly from keywords and identifiers.
  'punctuation.special': m('operator'),
};

/** The legend handed to VS Code. Derived — never hand-listed, so it cannot drift. */
export const LEGEND: { readonly types: readonly string[]; readonly modifiers: readonly string[] } =
  {
    types: [...new Set(Object.values(CAPTURE_MAP).map((v) => v.type))].sort(),
    modifiers: [...new Set(Object.values(CAPTURE_MAP).flatMap((v) => v.modifiers))].sort(),
  };

export function mappingFor(capture: string): TokenMapping | undefined {
  return Object.hasOwn(CAPTURE_MAP, capture) ? CAPTURE_MAP[capture] : undefined;
}
