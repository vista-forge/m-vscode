/**
 * Test Explorer + coverage gutters, over `m test` and `m coverage`.
 *
 * Extension-host glue only: discovery is a glob, running is a shell-out to the
 * `m` CLI, and every decision with a rule in it (what a suite row means, what a
 * failure message says, how LCOV maps to lines) lives in `src/engine/*` as pure,
 * tested modules. This file owns no M knowledge and no transport.
 */

import * as vscode from 'vscode';
import { runCoverage, runTests } from '../engine/engine.js';
import { failureLine } from '../engine/failure.js';
import { caseOutcomes, suiteOutcome, unreportedSuites } from '../engine/report.js';
import { engineLabel } from '../engine/settings.js';
import { coveragePaths, isSuiteFile, suiteIdFor, suiteName } from '../engine/suites.js';
import { engineCwd, readEngineSettings } from './engine-settings.js';

const SUITE_GLOB = '**/*TST.m';

export function registerTesting(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
): vscode.TestController {
  const controller = vscode.tests.createTestController('mVscodeTests', 'M Tests');
  context.subscriptions.push(controller);

  const itemFor = (uri: vscode.Uri): vscode.TestItem => {
    const id = suiteIdFor(uri.fsPath);
    const existing = controller.items.get(id);
    if (existing) return existing;
    const item = controller.createTestItem(id, suiteName(uri.fsPath), uri);
    controller.items.add(item);
    return item;
  };

  const discover = async (): Promise<void> => {
    const found = await vscode.workspace.findFiles(SUITE_GLOB, '**/node_modules/**');
    const live = new Set<string>();
    for (const uri of found) {
      live.add(suiteIdFor(uri.fsPath));
      itemFor(uri);
    }
    for (const [id] of controller.items) {
      if (!live.has(id)) controller.items.delete(id);
    }
    // Discovery finding nothing is a legitimate state, but a SILENT empty tree
    // reads as "no tests" whichever the cause. Say which it is.
    output.appendLine(
      found.length === 0
        ? `M Tests: no \`*TST.m\` suites found in this workspace (searched ${SUITE_GLOB}).`
        : `M Tests: discovered ${found.length} suite(s).`,
    );
  };

  controller.refreshHandler = () => discover();

  const watcher = vscode.workspace.createFileSystemWatcher(SUITE_GLOB);
  context.subscriptions.push(watcher);
  watcher.onDidCreate((uri) => {
    if (isSuiteFile(uri.fsPath)) itemFor(uri);
  });
  watcher.onDidDelete((uri) => controller.items.delete(suiteIdFor(uri.fsPath)));

  const runHandler = async (
    request: vscode.TestRunRequest,
    token: vscode.CancellationToken,
    withCoverage: boolean,
  ): Promise<void> => {
    const settings = readEngineSettings();
    const label = engineLabel(settings);
    const run = controller.createTestRun(request);

    const included: vscode.TestItem[] = [];
    if (request.include) included.push(...request.include);
    else for (const [, item] of controller.items) included.push(item);

    if (included.length === 0) {
      // Never end a run with nothing said: an empty Test Explorer with a green
      // run bar is indistinguishable from "everything passed".
      const message = `M Tests: nothing to run — no \`*TST.m\` suites are known. Run "Refresh Tests", or check that this workspace contains suites.`;
      output.appendLine(message);
      void vscode.window.showWarningMessage(message);
      run.end();
      return;
    }

    for (const item of included) run.enqueued(item);

    const paths = included.map((i) => i.uri?.fsPath).filter((p): p is string => p !== undefined);
    const cwd = engineCwd(included[0]?.uri);
    const ac = new AbortController();
    token.onCancellationRequested(() => ac.abort());

    output.appendLine(`M Tests: running ${paths.length} suite(s) on ${label}…`);
    for (const item of included) run.started(item);

    const result = await runTests(settings, paths, { cwd, signal: ac.signal });

    if (result.kind === 'failed') {
      // The run did not produce a report. Every requested item is marked
      // errored with the SAME actionable message the notification carries —
      // an item left in "no result" is the silent failure we are avoiding.
      const line = failureLine(result.failure);
      output.appendLine(line);
      void vscode.window.showErrorMessage(line);
      for (const item of included) {
        run.errored(item, new vscode.TestMessage(line));
      }
      run.end();
      return;
    }

    const { report } = result;
    const bySuite = new Map(report.results.map((r) => [r.suite, r]));

    for (const item of included) {
      const name = item.uri ? suiteName(item.uri.fsPath) : item.label;
      const row = bySuite.get(name);
      if (!row) continue; // handled by the unreported sweep below

      const outcome = suiteOutcome(row);
      const messages = outcome.messages.map((m) => new vscode.TestMessage(m));

      // Per-`@TEST` children, when the runner orchestrated the suite.
      const cases = caseOutcomes(row);
      for (const c of cases) {
        const childId = `${item.id}::${c.label}`;
        let child = item.children.get(childId);
        if (!child) {
          child = controller.createTestItem(childId, c.label, item.uri);
          item.children.add(child);
        }
        run.started(child);
        if (c.state === 'passed') run.passed(child);
        else run.failed(child, new vscode.TestMessage(c.message ?? `${c.label} failed`));
      }

      if (outcome.state === 'passed') run.passed(item);
      else if (outcome.state === 'errored') run.errored(item, messages);
      else run.failed(item, messages);
    }

    const requested = included.map((i) => (i.uri ? suiteName(i.uri.fsPath) : i.label));
    const missing = new Set(unreportedSuites(requested, report));
    for (const item of included) {
      const name = item.uri ? suiteName(item.uri.fsPath) : item.label;
      if (!missing.has(name)) continue;
      run.errored(
        item,
        new vscode.TestMessage(
          `\`m test\` did not report a result for ${name}. It may not have been discovered as a suite — ` +
            'run `m test` in a terminal against this file to see why.',
        ),
      );
    }

    output.appendLine(
      `M Tests: ${report.passed} assertion(s) passed, ${report.failed} failed across ${report.suites} suite(s) on ${label}.`,
    );

    if (withCoverage) await addCoverage(run, settings, paths, cwd, ac.signal, output);

    run.end();
  };

  const runProfile = controller.createRunProfile(
    'Run',
    vscode.TestRunProfileKind.Run,
    (request, token) => runHandler(request, token, false),
    true,
  );
  context.subscriptions.push(runProfile);

  const coverageProfile = controller.createRunProfile(
    'Run with Coverage',
    vscode.TestRunProfileKind.Coverage,
    (request, token) => runHandler(request, token, true),
    true,
  );
  // Without this, VS Code shows a coverage PERCENTAGE and no gutters — the
  // per-line detail is fetched lazily and there is no error if nobody supplies
  // it. Same silent-failure shape as an unbundled asset.
  coverageProfile.loadDetailedCoverage = (_run, file) =>
    Promise.resolve(resolveCoverageDetail(file));
  context.subscriptions.push(coverageProfile);

  void discover();
  return controller;
}

/**
 * Attach coverage from a real `m coverage --lcov` run.
 *
 * Deliberately reported as a warning when it fails: a coverage run that quietly
 * adds nothing is indistinguishable from a file with no executable lines, so
 * the failure has to be louder than the absence.
 */
async function addCoverage(
  run: vscode.TestRun,
  settings: ReturnType<typeof readEngineSettings>,
  paths: string[],
  cwd: string,
  signal: AbortSignal,
  output: vscode.OutputChannel,
): Promise<void> {
  // The source root is not optional — see `coveragePaths`.
  const result = await runCoverage(settings, coveragePaths(paths, cwd), { cwd, signal });
  if (result.kind === 'failed') {
    const line = failureLine(result.failure);
    output.appendLine(line);
    void vscode.window.showWarningMessage(line);
    return;
  }
  for (const record of result.records) {
    const uri = vscode.Uri.file(record.file);
    const detail = record.lines.map(
      (l) => new vscode.StatementCoverage(l.hits, new vscode.Position(l.line - 1, 0)),
    );
    const file = new vscode.FileCoverage(
      uri,
      new vscode.TestCoverageCount(record.summary.covered, record.summary.total),
    );
    run.addCoverage(file);
    // VS Code asks for the per-line detail lazily; keep it on the object so the
    // gutters render without a second engine run.
    coverageDetails.set(file, detail);
  }
  output.appendLine(`M Tests: coverage attached for ${result.records.length} file(s).`);
}

/** Per-FileCoverage statement detail, resolved lazily by the controller. */
const coverageDetails = new WeakMap<vscode.FileCoverage, vscode.StatementCoverage[]>();

export function resolveCoverageDetail(file: vscode.FileCoverage): vscode.StatementCoverage[] {
  return coverageDetails.get(file) ?? [];
}
