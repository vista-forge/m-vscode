/**
 * Source of truth for the P4 manifest surface.
 *
 * `package.json`'s `contributes` block is a projection of these constants, and
 * `manifest.test.ts` red-gates the drift. Same pattern as `src/lang/
 * contribution.ts` for the language registration (ruling D2).
 */

/** Command ids the extension host registers for the engine features. */
export const ENGINE_COMMANDS = ['mVscode.executeSelection', 'mVscode.checkEngine'] as const;

export type EngineCommand = (typeof ENGINE_COMMANDS)[number];

/** Contributed defaults for the engine settings, as the code resolves them. */
export const ENGINE_SETTING_DEFAULTS = {
  'mLanguageTools.engine': 'ydb',
  'mLanguageTools.docker': '',
  'mLanguageTools.namespace': '',
  'mLanguageTools.engine.lockWaitSeconds': 30,
} as const;
