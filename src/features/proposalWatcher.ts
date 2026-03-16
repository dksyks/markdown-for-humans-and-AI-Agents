/**
 * Copyright (c) 2025-2026 Concret.io
 *
 * Licensed under the MIT License. See LICENSE file in the project root for details.
 */

declare const __BUILD_TIME__: string;
const BUILD_TAG = `[MD4H ${__BUILD_TIME__}]`;

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  getEditorHostInstanceId,
  getOpenWebviews,
  hasOpenWebviewForDocument,
} from '../activeWebview';
import { PROPOSAL_TEMP_FILE } from '../editor/MarkdownEditorProvider';
import { ProposalPanel, ProposalRequest } from './proposalPanel';
import { findProposalMatch } from './proposalReplacement';

export function readPendingProposal(
  proposalFilePath: string = PROPOSAL_TEMP_FILE
): ProposalRequest | null {
  if (!fs.existsSync(proposalFilePath)) return null;

  const data = JSON.parse(fs.readFileSync(proposalFilePath, 'utf8')) as ProposalRequest;
  if (!data.id) return null;
  if (!Array.isArray(data.proposals) && (!data.original || (!Array.isArray(data.options) || data.options.length === 0))) {
    return null;
  }
  if (Array.isArray(data.proposals) && data.proposals.length === 0) {
    return null;
  }

  return data;
}

export function consumePendingProposal(
  proposalId: string,
  proposalFilePath: string = PROPOSAL_TEMP_FILE
): boolean {
  if (!fs.existsSync(proposalFilePath)) {
    return false;
  }

  try {
    const data = JSON.parse(fs.readFileSync(proposalFilePath, 'utf8')) as ProposalRequest;
    if (data.id !== proposalId) {
      return false;
    }
    fs.unlinkSync(proposalFilePath);
    return true;
  } catch {
    return false;
  }
}

export function shouldHandleProposal(proposal: ProposalRequest): boolean {
  const instanceMatch =
    !proposal.source_instance_id || proposal.source_instance_id === getEditorHostInstanceId();
  const fileMatch = !proposal.file || hasOpenWebviewForDocument(proposal.file);

  if (!instanceMatch) {
    return false;
  }

  if (proposal.file) {
    return fileMatch;
  }

  return getOpenWebviews().some(({ document }) =>
    doesDocumentMatchProposal(document.getText(), proposal)
  );
}

function doesDocumentMatchProposal(fullMarkdown: string, proposal: ProposalRequest): boolean {
  const primaryProposal = Array.isArray(proposal.proposals) && proposal.proposals.length > 0
    ? proposal.proposals[0]
    : proposal;

  return (
    !!primaryProposal.original &&
    findProposalMatch(fullMarkdown, {
      original: primaryProposal.original,
      replacement: primaryProposal.options?.[0]?.replacement ?? '',
      context_before: primaryProposal.context_before,
      context_after: primaryProposal.context_after,
    }) !== null
  );
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
      if (!shouldHandleProposal(data)) return;
      if (!consumePendingProposal(data.id)) return;
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
    console.warn(`${BUILD_TAG} proposalWatcher: fs.watch unavailable, changes will not be detected automatically`, err);
  }

  check(); // Check on startup in case a proposal was written before extension activated

  return new vscode.Disposable(() => {
    try { watcher?.close(); } catch {}
  });
}
