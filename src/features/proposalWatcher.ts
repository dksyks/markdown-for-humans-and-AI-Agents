/**
 * Copyright (c) 2025-2026 Concret.io
 *
 * Licensed under the MIT License. See LICENSE file in the project root for details.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { PROPOSAL_TEMP_FILE } from '../editor/MarkdownEditorProvider';
import { Proposal, ProposalPanel } from './proposalPanel';

export function readPendingProposal(proposalFilePath: string = PROPOSAL_TEMP_FILE): Proposal | null {
  if (!fs.existsSync(proposalFilePath)) return null;

  const data = JSON.parse(fs.readFileSync(proposalFilePath, 'utf8')) as Proposal;
  if (!data.id) return null;

  try {
    fs.unlinkSync(proposalFilePath);
  } catch {
    // Ignore cleanup failures; the proposal has already been read.
  }

  return data;
}

/**
 * Watch for incoming proposals written by the MCP server.
 * When a new proposal appears (new id), opens the ProposalPanel.
 */
export function startProposalWatcher(context: vscode.ExtensionContext): vscode.Disposable {
  let lastId: string | null = null;

  const check = () => {
    try {
      const data = readPendingProposal();
      if (!data) return;
      if (!data.id || data.id === lastId) return;
      lastId = data.id;
      ProposalPanel.show(context, data);
    } catch {
      // Ignore parse errors (file may be mid-write)
    }
  };

  let watcher: fs.FSWatcher | undefined;
  try {
    watcher = fs.watch(path.dirname(PROPOSAL_TEMP_FILE), (_event, filename) => {
      if (filename && filename.includes('Proposal')) check();
    });
  } catch (err) {
    console.warn('[MD4H] proposalWatcher: fs.watch unavailable, changes will not be detected automatically', err);
  }

  check(); // Check on startup in case a proposal was written before extension activated

  return new vscode.Disposable(() => {
    try { watcher?.close(); } catch {}
  });
}
