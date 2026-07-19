# Use ./node_modules/.bin tools, not whatever happens to be on PATH —
# protects against parent direnvs hijacking with the wrong version.
NPM := npm
BIN := ./node_modules/.bin

.PHONY: install hooks test test-watch test-cov lint format fix typecheck audit vuln check build bundle vsix clean push pull log docs-gate

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

check: lint typecheck test-cov vuln bundle docs-gate

build:
	$(NPM) run build

bundle:
	$(NPM) run bundle

vsix:
	$(NPM) run vsix

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
