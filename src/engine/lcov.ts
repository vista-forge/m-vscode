/**
 * LCOV tracefile parser — just enough of the format for `m coverage --lcov`.
 *
 * `m coverage` emits `TN:`/`SF:`/`DA:`/`LF:`/`LH:`/`end_of_record`. Everything
 * else in LCOV (functions, branches) has no M analogue and is ignored rather
 * than half-supported. Malformed rows are dropped, never coerced — a NaN line
 * number renders as a gutter on line 0, which is worse than no gutter.
 */

export interface LineHit {
  line: number;
  hits: number;
}

export interface CoverageRecord {
  file: string;
  lines: LineHit[];
  summary: { covered: number; total: number };
}

export function parseLcov(text: string): CoverageRecord[] {
  const records: CoverageRecord[] = [];
  let file: string | undefined;
  let lines: LineHit[] = [];
  let declaredFound: number | undefined;
  let declaredHit: number | undefined;

  const flush = (): void => {
    if (file === undefined) return;
    const counted = {
      covered: lines.filter((l) => l.hits > 0).length,
      total: lines.length,
    };
    records.push({
      file,
      lines,
      summary:
        declaredFound !== undefined && declaredHit !== undefined
          ? { covered: declaredHit, total: declaredFound }
          : counted,
    });
    file = undefined;
    lines = [];
    declaredFound = undefined;
    declaredHit = undefined;
  };

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === 'end_of_record') {
      flush();
      continue;
    }
    const sep = line.indexOf(':');
    if (sep < 0) continue;
    const tag = line.slice(0, sep);
    const value = line.slice(sep + 1);

    switch (tag) {
      case 'SF': {
        flush();
        if (value !== '') file = value;
        break;
      }
      case 'DA': {
        const [l, h] = value.split(',');
        const lineNo = Number(l);
        const hits = Number(h);
        if (!Number.isInteger(lineNo) || lineNo <= 0 || !Number.isFinite(hits)) break;
        lines.push({ line: lineNo, hits });
        break;
      }
      case 'LF': {
        const n = Number(value);
        if (Number.isFinite(n)) declaredFound = n;
        break;
      }
      case 'LH': {
        const n = Number(value);
        if (Number.isFinite(n)) declaredHit = n;
        break;
      }
      default:
        break;
    }
  }
  flush();
  return records;
}
