/**
 * Extract the capture names a tree-sitter query file declares.
 *
 * This exists so the capture-mapping coverage gate is derived from the SHIPPED
 * query rather than a hand-kept list: a hand-kept list drifts silently, and the
 * symptom of drift (a capture with no mapping) is invisible — the text simply
 * renders uncoloured, exactly as if the theme had chosen not to colour it.
 *
 * Two shapes in the real `highlights.scm` defeat a naive `/@[\w.]+/` scan, so
 * both are stripped before scanning:
 *   - line comments: `; \`@expr\` — the \`@\` is itself the marker.`
 *   - string literals: `"@" @operator` (the pattern matches a literal `@` node)
 */
export function captureNamesInQuery(scm: string): string[] {
  const stripped = stripStringsAndComments(scm);
  const names = new Set<string>();
  for (const match of stripped.matchAll(/@([A-Za-z_][A-Za-z0-9_.]*)/g)) {
    names.add(match[1] as string);
  }
  return [...names];
}

/**
 * Blank out string literals first, then `;` comments — in that order, so a `;`
 * inside a literal does not start a comment and an `@` inside a literal is not
 * seen as a capture. Characters are replaced with spaces rather than removed so
 * nothing else in the text shifts.
 */
function stripStringsAndComments(scm: string): string {
  const out = [...scm];
  let inString = false;
  let inComment = false;
  for (let i = 0; i < out.length; i++) {
    const ch = out[i] as string;
    if (inComment) {
      if (ch === '\n') inComment = false;
      else out[i] = ' ';
      continue;
    }
    if (inString) {
      out[i] = ' ';
      if (ch === '\\') {
        if (i + 1 < out.length) out[++i] = ' ';
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out[i] = ' ';
    } else if (ch === ';') {
      inComment = true;
      out[i] = ' ';
    }
  }
  return out.join('');
}
