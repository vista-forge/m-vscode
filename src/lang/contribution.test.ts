import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { isMumpsFile, MUMPS_ALIASES, MUMPS_EXTENSIONS, MUMPS_LANGUAGE_ID } from './contribution.ts';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('isMumpsFile', () => {
  const cases: { name: string; path: string; want: boolean }[] = [
    { name: 'plain .m routine', path: 'ZZTEST.m', want: true },
    { name: 'IRIS .mac source', path: '/src/ZZTEST.mac', want: true },
    { name: 'IRIS .int intermediate', path: 'C:\\src\\ZZTEST.int', want: true },
    { name: 'uppercase extension', path: 'ZZTEST.M', want: true },
    { name: 'not an M file', path: 'README.md', want: false },
    { name: 'no extension', path: 'Makefile', want: false },
    { name: 'extension-like substring only', path: 'model.ts', want: false },
    { name: 'dotfile named .m is not an M file', path: '.m', want: false },
  ];
  for (const tc of cases) {
    it(tc.name, () => {
      assert.equal(isMumpsFile(tc.path), tc.want);
    });
  }
});

describe('package.json language contribution', () => {
  const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
    contributes: {
      languages: {
        id: string;
        aliases: string[];
        extensions: string[];
        configuration: string;
      }[];
    };
    activationEvents: string[];
  };
  const langs = pkg.contributes.languages;

  it('registers exactly one language', () => {
    assert.equal(langs.length, 1);
  });

  it('registers the mumps language id (D2)', () => {
    assert.equal(langs[0]?.id, MUMPS_LANGUAGE_ID);
  });

  it('declares the same aliases the source of truth declares', () => {
    assert.deepEqual(langs[0]?.aliases, [...MUMPS_ALIASES]);
  });

  it('declares the same extensions the source of truth declares', () => {
    assert.deepEqual(langs[0]?.aliases && langs[0]?.extensions, [...MUMPS_EXTENSIONS]);
  });

  it('points at a language-configuration file that exists and parses', () => {
    const rel = langs[0]?.configuration;
    assert.equal(rel, './language-configuration.json');
    const cfg = JSON.parse(readFileSync(join(repoRoot, 'language-configuration.json'), 'utf8')) as {
      comments: { lineComment: string };
    };
    assert.equal(cfg.comments.lineComment, ';');
  });

  it('activates on the mumps language', () => {
    assert.ok(pkg.activationEvents.includes(`onLanguage:${MUMPS_LANGUAGE_ID}`));
  });
});
