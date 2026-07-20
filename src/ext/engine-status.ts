/**
 * The engine status-bar chip, fed by `m vista status`.
 *
 * Honesty rules, enforced in `src/engine/status.ts` and asserted there:
 *  - the chip exists from activation and starts as an explicit **unknown**,
 *    never blank (a blank chip reads as "fine");
 *  - a probe that could not run, or could not be understood, stays unknown;
 *  - only a probe that came back running AND healthy is green.
 *
 * Probing is on demand plus a slow poll — not per keystroke: every probe is a
 * real driver round-trip that competes for the engine.
 */

import * as vscode from 'vscode';
import { runStatus } from '../engine/engine.js';
import { engineLabel } from '../engine/settings.js';
import { type StatusChip, unknownChip } from '../engine/status.js';
import { engineCwd, readEngineSettings } from './engine-settings.js';

const POLL_MS = 60_000;

export function registerEngineStatus(context: vscode.ExtensionContext): void {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
  item.command = 'mVscode.checkEngine';
  context.subscriptions.push(item);

  const apply = (chip: StatusChip): void => {
    item.text = chip.text;
    item.tooltip = chip.tooltip;
    item.backgroundColor =
      chip.health === 'down' ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;
    item.show();
  };

  apply(unknownChip(engineLabel(readEngineSettings()), 'not probed yet'));

  let inFlight = false;
  const probe = async (): Promise<StatusChip> => {
    const settings = readEngineSettings();
    if (inFlight) return unknownChip(engineLabel(settings), 'a probe is already running');
    inFlight = true;
    try {
      const chip = await runStatus(settings, { cwd: engineCwd() });
      apply(chip);
      return chip;
    } finally {
      inFlight = false;
    }
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('mVscode.checkEngine', async () => {
      const chip = await probe();
      // The command is the "tell me now" path, so it also SAYS the answer
      // rather than only repainting a chip the user may not be looking at.
      void vscode.window.showInformationMessage(chip.tooltip);
    }),
  );

  const timer = setInterval(() => void probe(), POLL_MS);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });

  void probe();
}
