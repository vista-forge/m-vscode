# Use ./node_modules/.bin tools, not whatever happens to be on PATH —
# protects against parent direnvs hijacking with the wrong version.
NPM := npm
BIN := ./node_modules/.bin

.PHONY: install hooks test test-watch test-cov lint format fix typecheck audit vuln check build bundle release-bundle verify-bundle vsix vsix-verify release clean push pull log docs-gate sync-wasm check-wasm

install:
	$(NPM) install
	$(MAKE) hooks

hooks:
	$(BIN)/simple-git-hooks

test:
	$(NPM) run test

test-watch:
	$(NPM) run test:watch

test-cov:
	$(NPM) run test:cov

lint:
	$(NPM) run lint

format:
	$(NPM) run format

fix:
	$(NPM) run fix

typecheck:
	$(NPM) run typecheck

# audit is an alias for vuln (kept for muscle memory / CLAUDE.md). The gate is
# the OFFLINE shared scan (de-GitHub OPTION A; npm audit's registry call is
# gone from gate time).
audit: vuln

vuln:
	bash ../.github/scripts/vuln-scan.sh .

# Vendor the tree-sitter-m editor artifacts. CONSUME, NEVER REBUILD: the
# artifact and its drift gate live upstream (`make wasm` in tree-sitter-m).
# Running `tree-sitter build` here would recreate the very divergence that
# gate exists to prevent.
sync-wasm:
	node scripts/sync-wasm.mjs

# The vendored copy is intact AND not stale. Runs first in `check`, because
# everything downstream colours M by whatever this says is current.
check-wasm:
	node scripts/check-wasm.mjs

check: check-wasm lint typecheck test-cov vuln bundle verify-bundle docs-gate

build:
	$(NPM) run build

bundle:
	$(NPM) run bundle

# The RELEASE bundle — no --sourcemap. `bundle` (above) keeps the source map
# for dev/debug (extension-host breakpoints resolve to TS, e.g. F5); the
# packaged .vsix must not carry one (a 1.6 MB source map was the dominant
# entry in a 591 KB package). `npm run vsix` (below) ALWAYS rebuilds via this
# same `bundle:release` script too — `vsce package` runs the `vscode:prepublish`
# lifecycle hook (`package.json`) unconditionally before packaging, so a plain
# `make vsix` right after `make check`/`make bundle` still ships map-free.
# This target exists to make that rebuild explicit/inspectable outside
# packaging, and to `rm -f` a stale map left on disk by a prior dev bundle
# (esbuild without --sourcemap does not delete one that is already there, and
# `files: ["dist", ...]` in package.json would ship whatever it finds).
release-bundle:
	$(NPM) run bundle:release
	rm -f dist/extension.cjs.map

# Prove the packaged bundle is self-contained: an unbundled runtime dep would
# ship a .vsix that installs cleanly and then does nothing (see scripts/).
verify-bundle:
	node scripts/verify-bundle.mjs

vsix:
	$(NPM) run vsix

# Package, then READ the package: assert the bundle and the language
# configuration actually made it past the `files` allow-list.
vsix-verify: vsix
	unzip -l m-vscode-*.vsix | grep -q 'extension/dist/extension.cjs'
	unzip -l m-vscode-*.vsix | grep -q 'extension/language-configuration.json'
	unzip -p m-vscode-*.vsix extension/dist/extension.cjs | grep -q 'LanguageClient'
# The grammar, its query, and web-tree-sitter's runtime must be INSIDE the
# archive — a filtered-out asset fails silently at runtime (uncoloured M, no
# error anywhere), so assert the packaged bytes, not the source tree.
	unzip -l m-vscode-*.vsix | grep -q 'extension/dist/assets/tree-sitter-m.wasm'
	unzip -l m-vscode-*.vsix | grep -q 'extension/dist/assets/highlights.scm'
	unzip -l m-vscode-*.vsix | grep -q 'extension/dist/assets/tree-sitter.wasm'
	unzip -p m-vscode-*.vsix extension/dist/assets/tree-sitter-m.wasm | \
	  sha256sum | grep -q "$$(python3 -c "import json;print(json.load(open('assets/tree-sitter-m.wasm.json'))['artifact_sha256'])")"
# A released package must not carry a source map (see release-bundle above).
# `vscode:prepublish` already forces this on every `npm run vsix`, but assert
# the packaged bytes anyway — a regression here (e.g. `vscode:prepublish`
# drifting back to `bundle`) would otherwise ship silently.
	@if unzip -l m-vscode-*.vsix | grep -q 'dist/extension.cjs.map'; then \
	  echo 'vsix-verify: FAILED — packaged .vsix contains a source map (dist/extension.cjs.map); run `make release-bundle` (drops --sourcemap) before packaging a release'; \
	  exit 1; \
	fi
	@echo 'vsix-verify: OK — bundle, language configuration, and grammar assets present; grammar sha matches the upstream manifest; no source map shipped.'

# Reproducible release build: clean floor, install from lockfile, run the
# FULL gate (proves the tree is release-worthy), then rebuild the bundle
# WITHOUT a source map, package it, and verify what actually shipped.
# Offline throughout (npm ci is the only network step, same as `install`);
# never a dependency of `check` — packaging is not a gate.
release: clean
	$(NPM) ci
	$(MAKE) hooks
	$(MAKE) check
	$(MAKE) release-bundle
	$(MAKE) verify-bundle
	$(MAKE) vsix-verify
	@echo "release: OK — $$(ls m-vscode-*.vsix) ready to review and commit"

clean:
	rm -rf dist coverage .nyc_output *.tsbuildinfo

# Append a dated entry to docs/changelog.md.
# Usage: make log MSG="what changed and why"
log:
	@if [ -z "$(MSG)" ]; then echo 'usage: make log MSG="..."'; exit 1; fi
	@printf '\n## %s\n\n%s\n' "$$(date -u +%Y-%m-%d)" "$(MSG)" >> docs/changelog.md
	@echo "appended to docs/changelog.md"

pull:
	git pull origin main

push: check
	git push origin main

docs-gate: ## offline docs link+layout gate (de-GitHub D-1 — replaces the docs-validate.yml cloud workflow)
	python3 ../.github/scripts/link-check.py $(wildcard docs) $(wildcard README.md) $(wildcard CLAUDE.md)
	@if [ -d docs ]; then python3 ../.github/scripts/layout-check.py docs; else echo "docs-gate: no docs/ tree — layout gate not applicable (printed, not silent)"; fi
