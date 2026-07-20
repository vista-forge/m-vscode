import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { MHighlighter, type TypingSession } from './highlighter.ts';
import type { SemanticToken } from './paint.ts';

/**
 * R1 — the typing-session fixture (proposal §7-R1).
 *
 * tree-sitter-m's error recovery is tree-sitter's default, tuned by batch
 * corpus parsing. An editor never sees a batch — it lives in the half-typed
 * states between valid programs. This replays those states over a real corpus
 * routine and asserts the highlighter survives them.
 *
 * WHAT THIS TOLERATES (all expected, none are failures):
 *   - ERROR and MISSING nodes; `hasError === true` for whole stretches.
 *   - Fewer tokens than a clean parse; tokens on the edited line changing type
 *     or vanishing while a construct is incomplete.
 *   - Unbalanced quotes/parens/carets existing for many consecutive steps.
 *
 * WHAT THIS FORBIDS (each is a distinct failure mode, asserted separately):
 *   F1  any exception out of parse / query / token construction;
 *   F2  a step exceeding STEP_BUDGET_MS — the hang case, which in an editor is
 *       indistinguishable from a frozen window;
 *   F3  root node type other than `source_file` — total tree collapse;
 *   F4  whole-document colour loss: tokens over the settled (non-edited) region
 *       falling to zero, or below COLOUR_FLOOR of the best seen so far.
 *
 * And one meta-assertion, because a fixture that never reaches a broken state
 * proves nothing: at least MIN_ERROR_STEPS of the steps must actually produce
 * an ERROR tree.
 */

const STEP_BUDGET_MS = 2000;
const COLOUR_FLOOR = 0.6;
const MIN_ERROR_STEPS = 20;

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const source = readFileSync(new URL('./fixtures/ZZDAEMON.m', import.meta.url), 'utf8');

let hl: MHighlighter;
before(async () => {
  hl = await MHighlighter.create(repoRoot);
});
after(() => hl?.dispose());

interface Recorder {
  steps: number;
  errorSteps: number;
  /** Best token count seen PER measurement window — see the note on F4 below. */
  best: Map<number, number>;
  worstWholeDoc: { tokens: number; label: string };
  slowest: { ms: number; label: string };
}

/**
 * How F4 is measured, and why it takes two forms.
 *
 * While text is being appended (phases A and B) the meaningful question is
 * whether the lines ALREADY typed keep their colour, so the window is "lines
 * below N" and each window keeps its own high-water mark — comparing a 10-line
 * window against a 130-line window's best measures the window, not the
 * highlighter.
 *
 * Once the document is whole (phase C) the interesting failure is different and
 * bigger: a single unbalanced quote making the WHOLE file go dark. There the
 * measure is total tokens against the clean document's count.
 */
type ColourCheck = { settledLines: number } | { minTokens: number; cleanTokens: number };

/** One keystroke: apply the edit, re-highlight, check every invariant. */
function step(
  session: TypingSession,
  rec: Recorder,
  label: string,
  check: ColourCheck | undefined,
): void {
  const started = performance.now();
  let tokens: SemanticToken[];
  try {
    tokens = session.tokens(); // F1 — any throw fails the test here
  } catch (err) {
    assert.fail(`F1 exception at ${label}: ${(err as Error).stack}`);
  }
  const elapsed = performance.now() - started;

  rec.steps += 1;
  if (elapsed > rec.slowest.ms) rec.slowest = { ms: elapsed, label };
  assert.ok(elapsed < STEP_BUDGET_MS, `F2 hang at ${label}: ${elapsed.toFixed(0)} ms`);
  assert.equal(session.rootType, 'source_file', `F3 tree collapse at ${label}`);
  if (session.hasError) rec.errorSteps += 1;

  if (check === undefined) return;

  if ('settledLines' in check) {
    if (check.settledLines <= 0) return;
    const settled = tokens.filter((t) => t.line < check.settledLines).length;
    const best = Math.max(rec.best.get(check.settledLines) ?? 0, settled);
    rec.best.set(check.settledLines, best);
    assert.ok(settled > 0, `F4 colour loss at ${label}: 0 tokens on the settled lines`);
    assert.ok(
      settled >= best * COLOUR_FLOOR,
      `F4 colour collapse at ${label}: ${settled} tokens on lines <${check.settledLines}, ` +
        `best for that window was ${best} (floor ${COLOUR_FLOOR})`,
    );
    return;
  }

  if (tokens.length < rec.worstWholeDoc.tokens)
    rec.worstWholeDoc = { tokens: tokens.length, label };
  assert.ok(
    tokens.length >= check.minTokens,
    `F4 whole-document colour loss at ${label}: ${tokens.length} tokens, ` +
      `clean document has ${check.cleanTokens} (floor ${COLOUR_FLOOR} => ${check.minTokens})`,
  );
}

test('R1: a full typing session over a real routine never crashes, hangs, or goes dark', () => {
  const rec: Recorder = {
    steps: 0,
    errorSteps: 0,
    best: new Map(),
    worstWholeDoc: { tokens: Number.POSITIVE_INFINITY, label: '-' },
    slowest: { ms: 0, label: '-' },
  };

  // The phase-C floor, measured from a cold parse of the clean routine.
  const cleanSession = hl.open(source);
  const cleanTokens = cleanSession.tokens().length;
  cleanSession.dispose();
  const wholeDoc = { minTokens: Math.floor(cleanTokens * COLOUR_FLOOR), cleanTokens };

  const session = hl.open('');

  try {
    // ---- Phase A: type the routine in, line by line ------------------------
    // The routine ends with a newline; dropping the empty trailing element keeps
    // "type every line, then compare to the file" exact rather than off by one.
    const lines = source.replace(/\n$/, '').split('\n');
    let typed = '';
    for (const [i, line] of lines.entries()) {
      const chunk = `${line}\n`;
      session.replace(typed.length, typed.length, chunk);
      typed += chunk;
      // Lines before the one just completed are "settled": nothing being typed
      // on them, so their colour must not evaporate.
      step(session, rec, `A:line ${i + 1}/${lines.length}`, { settledLines: Math.max(0, i - 1) });
    }
    assert.equal(session.text, typed, 'session text drifted from what was typed');

    // ---- Phase B: retype one dense line character by character --------------
    // Line-at-a-time typing hides the states an editor spends most of its time
    // in: a half-written token. This walks one real line through every one.
    const target = lines.findIndex((l) => l.includes('"') && l.includes('$'));
    assert.ok(target > 0, 'fixture has no line with both a string and an intrinsic');
    const targetLine = lines[target] as string;
    const lineStart = lines.slice(0, target).reduce((n, l) => n + l.length + 1, 0);

    session.replace(lineStart, lineStart + targetLine.length, '');
    step(session, rec, 'B:cleared line', { settledLines: target });
    for (let i = 0; i < targetLine.length; i++) {
      const ch = targetLine[i] as string;
      session.replace(lineStart + i, lineStart + i, ch);
      step(session, rec, `B:char ${i + 1}/${targetLine.length} (${JSON.stringify(ch)})`, {
        settledLines: target,
      });
    }
    assert.equal(session.text, source, 'char-by-char retype did not restore the routine');

    // ---- Phase C: deliberate breakage, each held for several steps ----------
    // Every one of these is a state a user reaches by pressing one key.
    const breakages: Array<{ label: string; find: string; replace: string }> = [
      { label: 'unterminated string (deleted a closing quote)', find: '"', replace: '' },
      { label: 'unmatched open paren', find: ' set ', replace: ' set ((( ' },
      { label: 'dangling caret (routine ref half-typed)', find: '^', replace: '' },
      { label: 'half-typed intrinsic', find: '$', replace: '$$$' },
      { label: 'stray command keyword mid-expression', find: '=', replace: '= quit ' },
      { label: 'unbalanced quote AND paren together', find: ' ;', replace: ' ;")(' },
    ];
    for (const b of breakages) {
      const at = session.text.indexOf(b.find);
      assert.ok(at > 0, `fixture no longer contains ${JSON.stringify(b.find)}`);
      const before = session.text;
      session.replace(at, at + b.find.length, b.replace);
      step(session, rec, `C:${b.label}`, wholeDoc);
      // ...and a few more keystrokes while broken, which is the realistic case:
      // users keep typing through an invalid state, they don't pause to fix it.
      for (let k = 0; k < 3; k++) {
        session.replace(at + b.replace.length + k, at + b.replace.length + k, 'X');
        step(session, rec, `C:${b.label} +${k + 1} keystroke`, wholeDoc);
      }
      session.replace(0, session.text.length, before); // repair by undo
      step(session, rec, `C:${b.label} repaired`, wholeDoc);
    }

    // ---- Recovery: after all that, we are exactly where a cold parse is -----
    assert.equal(session.text, source, 'session text drifted after the breakage phase');
    const fresh = hl.open(source);
    try {
      assert.deepEqual(
        session.tokens(),
        fresh.tokens(),
        'incremental parsing left the tree in a state a cold parse disagrees with',
      );
      assert.equal(session.hasError, false, 'repaired document should parse clean again');
    } finally {
      fresh.dispose();
    }

    // ---- Meta: the session really did visit broken states -------------------
    assert.ok(
      rec.errorSteps >= MIN_ERROR_STEPS,
      `only ${rec.errorSteps} of ${rec.steps} steps produced an ERROR tree — ` +
        'this fixture is not exercising error recovery, so it proves nothing',
    );
    console.log(
      `R1 typing session: ${rec.steps} steps, ${rec.errorSteps} with ERROR trees, ` +
        `worst whole-document token count ${rec.worstWholeDoc.tokens}/${cleanTokens} ` +
        `(${rec.worstWholeDoc.label}), ` +
        `slowest step ${rec.slowest.ms.toFixed(1)} ms (${rec.slowest.label})`,
    );
  } finally {
    session.dispose();
  }
});
