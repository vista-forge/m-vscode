import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { statusMessage } from './status.ts';

describe('statusMessage', () => {
  const cases: {
    name: string;
    input: Parameters<typeof statusMessage>[0];
    want: string;
  }[] = [
    {
      name: 'no active file',
      input: { version: '0.1.0', activeFile: undefined },
      want: 'M Language Tools 0.1.0 — active. No file open.',
    },
    {
      name: 'active M routine',
      input: { version: '0.1.0', activeFile: '/src/ZZTEST.m' },
      want: 'M Language Tools 0.1.0 — active. ZZTEST.m: M language (mumps).',
    },
    {
      name: 'active IRIS .int file',
      input: { version: '0.2.1', activeFile: 'ZZTEST.int' },
      want: 'M Language Tools 0.2.1 — active. ZZTEST.int: M language (mumps).',
    },
    {
      name: 'active non-M file',
      input: { version: '0.1.0', activeFile: '/src/README.md' },
      want: 'M Language Tools 0.1.0 — active. README.md: not an M file.',
    },
  ];
  for (const tc of cases) {
    it(tc.name, () => {
      assert.equal(statusMessage(tc.input), tc.want);
    });
  }
});
