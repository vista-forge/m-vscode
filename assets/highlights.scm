; tree-sitter-m highlight queries.
;
; Maps parse-tree node types to standard tree-sitter highlight scope
; names so editor themes (Helix, nvim-treesitter, VS Code via the
; experimental tree-sitter API) can colour M source consistently with
; other languages.
;
; Scope names follow the conventions documented at
; https://docs.helix-editor.com/themes.html#scopes — they are also the
; ones nvim-treesitter expects. Editor-specific overrides should
; happen in a downstream queries/highlights.scm placed alongside the
; theme, not by patching this file.
;
; Per AD-03, downstream tooling that needs *standard_status*
; (ANSI vs YDB-extension vs IRIS-extension vs multi-vendor-ext) joins
; against src/grammar-metadata.json via lib/stamp.js — that information
; is intentionally out of band so editors don't have to express it as a
; highlight scope.

; ---------- Comments and strings ----------
(comment) @comment
(string) @string

; ---------- Numbers ----------
(number) @number

; ---------- Keywords ----------
; All commands (SET / KILL / FOR / IF / DO / GOTO / Z* extensions, etc.)
; share the @keyword scope. M has ~80 commands and editor themes don't
; typically distinguish control-flow vs assignment for M the way they
; do for C/Python — keep the highlight uniform and let the linter /
; AD-03 metadata expose finer distinctions when consumers need them.
(command_keyword) @keyword

; ---------- Built-in functions and special variables ----------
(intrinsic_function_keyword) @function.builtin
(special_variable_keyword) @variable.builtin
(vendor_sv_extension) @variable.builtin

; ---------- Function calls ----------
; Extrinsic call: $$LABEL[^RTN][(args)] — the label and routine are
; identifiers / numbers / indirection inside the extrinsic_function.
; Highlight the whole node territory as a function call by tagging
; the leading identifier or number; tighter editor-specific scope can
; refine if desired.
(extrinsic_function (identifier) @function)
(extrinsic_function (number) @function)

; DO/GOTO into an entry reference: D LABEL^RTN — same shape, the
; first identifier is the local label, the routine identifier is the
; module. Both shown as @function so navigation themes pick them up.
(entry_reference (identifier) @function)
(entry_reference (number) @function)

; Numeric local-label call: D 12(args)
(numeric_label_call (number) @function)

; ---------- Labels (line definition site) ----------
; Routine label at column 0 — the line's own label, not a target.
(line (label) @label)

; ---------- Variables ----------
(local_variable (identifier) @variable)
(global_variable) @variable

; By-reference parameters: `.VAR`
(by_reference (identifier) @variable.parameter)

; Formal parameters: `(A,B,C)` after a label.
(formals (identifier) @variable.parameter)

; ---------- Operators and punctuation ----------
(operator) @operator
(pattern_letter) @constant.builtin

; Format-control characters in WRITE: `!`, `#`, `?N`, `*expr`.
(format_control) @punctuation.special
(format_tab) @punctuation.special

; ---------- Indirection marker ----------
; `@expr` — the `@` is itself the marker.
"@" @operator

; ---------- Postconditionals ----------
; `:cond` after a command or per-argument.
(postconditional) @keyword.operator
(argument_postconditional) @keyword.operator

; ---------- Dot-block depth markers ----------
; The leading `.`/`..`/`. .` on a continuation line.
(dot_block_prefix) @punctuation.special
