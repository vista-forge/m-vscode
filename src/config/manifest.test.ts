/**
 * The profile commands are a PROJECTION of the code, red-gated — same
 * discipline as `src/engine/manifest.test.ts`. A contributed command nothing
 * registers is a palette entry that fails when clicked; a registered command
 * nothing contributes is a remedy the user cannot reach, which for A5 means
 * the honest "no profile configured" surface with no way to act on it.
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { PROFILE_COMMANDS } from './contribution.ts';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
  contributes: { commands: Array<{ command: string; title: string }> };
};

describe('profile commands contribution', () => {
  const contributed = pkg.contributes.commands.map((c) => c.command);
  for (const id of PROFILE_COMMANDS) {
    it(`${id} is contributed`, () => {
      assert.ok(contributed.includes(id), `package.json does not contribute ${id}`);
    });
  }
});
