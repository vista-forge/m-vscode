/**
 * The `.m-cli.toml` templates the one-click remedy writes — the only bytes
 * this extension ever puts into a user's project.
 *
 * Two shapes, deliberately: the m-stdlib shape for new/portable M, and the
 * vista-fileman shape for VistA-era code, where defaulting onto the modern
 * profile is an automatic A5 FAIL. Both pin `[fmt] rules = "identity"`:
 * `canonical` is a real rewrite of source (it renames case-inconsistent
 * identifiers), and nothing this extension writes on a user's behalf should
 * arm a rewrite of 40-year-old routines they have not asked for.
 *
 * `templates.e2e.test.ts` proves the real `m` accepts these bytes and selects
 * the advertised rules — a near-miss key is a HARD error in m-cli, so a wrong
 * template would leave a project worse off than unconfigured.
 */

export interface ProfileTemplate {
  id: string;
  /** Quick-pick label. */
  label: string;
  /** Quick-pick description — what this choice is FOR. */
  description: string;
  /** The `[lint] rules` value this template sets. */
  profile: string;
  /** The exact file contents written. */
  content: string;
}

const HEADER = `# m-cli project configuration — the one file \`m lint\`, \`m fmt\`, CI and the
# editor all read, so the diagnostics you see are the diagnostics that gate.
# Written by "M: Configure M Profile" (M Language Tools). Edit freely.
`;

export const PROFILE_TEMPLATES: readonly ProfileTemplate[] = [
  {
    id: 'modern',
    label: 'Modern M',
    description: 'New, portable M — the m-stdlib shape (lint: modern)',
    profile: 'modern',
    content: `${HEADER}
[lint]
rules = "modern"

[fmt]
rules = "identity"
`,
  },
  {
    id: 'vista',
    label: 'VistA-era M',
    description: 'Legacy VistA / FileMan routines — SAC rules, no rewriting (lint: vista)',
    profile: 'vista',
    content: `${HEADER}
[lint]
rules = "vista"

# identity, deliberately: canonical formatting REWRITES source, and legacy
# VistA routines are not code to reformat on the way past.
[fmt]
rules = "identity"
`,
  },
];

export function templateById(id: string): ProfileTemplate | undefined {
  return PROFILE_TEMPLATES.find((t) => t.id === id);
}
