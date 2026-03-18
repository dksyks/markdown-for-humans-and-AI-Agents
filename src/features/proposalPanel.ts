/**
 * Copyright (c) 2025-2026 Concret.io
 *
 * Licensed under the MIT License. See LICENSE file in the project root for details.
 */

declare const __BUILD_TIME__: string;
const BUILD_TAG = `[MD4H ${__BUILD_TIME__}]`;

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { PROPOSAL_STATE_DIR, RESPONSE_TEMP_FILE } from '../editor/MarkdownEditorProvider';
import {
  getActiveDocument,
  getActiveWebviewPanel,
  getOpenWebviews,
  getOpenWebviewForDocument,
} from '../activeWebview';
import { applyProposalReplacement } from './proposalReplacement';
import { findProposalMatch } from './proposalReplacement';

const PROPOSAL_SELECTION_NOT_FOUND_ERROR =
  'The file is open in Markdown for Humans, but the selection for the proposal could not be found. The file contents may have changed, or the provided context may not match.';
const PROPOSAL_INTERNAL_ERROR =
  'The file is open in Markdown for Humans, but the proposal could not be completed due to an internal extension error.';

export interface ProposalOption {
  replacement: string;
  justification?: string | null;
}

export interface Proposal {
  original: string;
  options: ProposalOption[];
  context_before: string | null;
  context_after: string | null;
  headings_before?: string[] | null;
}

export interface ProposalBatchRequest {
  id: string;
  file?: string | null;
  source_instance_id?: string | null;
  proposals: Proposal[];
}

export interface ProposalRequest extends Proposal {
  id: string;
  file?: string | null;
  source_instance_id?: string | null;
  proposals?: Proposal[];
}

interface ProposalResult {
  original: string;
  context_before: string | null;
  context_after: string | null;
  headings_before?: string[] | null;
  status: string;
  replacement: string | null;
  selected_option_index?: number | null;
}

interface ProposalStatePayload {
  id: string;
  file: string | null;
  review_kind: 'single' | 'sequential';
  status: string;
  message?: string;
  error_type?: string | null;
  error?: string | null;
  propose_single_replacement_session_id?: string;
  propose_sequential_replacements_session_id?: string;
  original?: string;
  context_before?: string | null;
  context_after?: string | null;
  headings_before?: string[] | null;
  replacement?: string | null;
  selected_option_index?: number | null;
  progress?: {
    current: number;
    total: number;
  };
  results?: Array<{
      status: string;
      original: string;
      context_before: string | null;
      context_after: string | null;
      headings_before?: string[] | null;
      replacement: string | null;
      selected_option_index?: number | null;
  }>;
}

/**
 * A VS Code WebviewPanel that displays a WYSIWYG redline review above an
 * editable proposed replacement via the same webview.js bundle.
 */
export class ProposalPanel {
  static currentPanel: ProposalPanel | undefined;

  static show(context: vscode.ExtensionContext, request: ProposalRequest) {
    try {
      const sourceContext = resolveProposalSourceContext(request);
      const doc = sourceContext.document;
      const sourcePanel = sourceContext.panel;

      if (!doc) {
        ProposalPanel._writeImmediateError(
          request,
          null,
          'proposal_internal_error',
          PROPOSAL_INTERNAL_ERROR
        );
        return;
      }

      if (!doesDocumentMatchProposal(doc.getText(), request)) {
        ProposalPanel._writeImmediateError(
          request,
          doc,
          'proposal_selection_not_found',
          PROPOSAL_SELECTION_NOT_FOUND_ERROR
        );
        return;
      }

      const filename = doc.uri.fsPath
        ? path.basename(doc.uri.fsPath)
        : request.file
          ? path.basename(request.file)
          : 'document';

      if (ProposalPanel.currentPanel) {
        ProposalPanel.currentPanel._update(request, filename, doc, sourcePanel);
        ProposalPanel.currentPanel._panel.reveal(vscode.ViewColumn.Beside, true);
        return;
      }
      new ProposalPanel(context, request, filename, doc, sourcePanel);
    } catch (err) {
      console.warn(`${BUILD_TAG} Failed to open proposal review panel:`, err);
      ProposalPanel._writeImmediateError(
        request,
        null,
        'proposal_internal_error',
        PROPOSAL_INTERNAL_ERROR
      );
    }
  }

  private _panel: vscode.WebviewPanel;
  private _proposal: Proposal;
  private _requestId: string;
  private _proposalQueue: Proposal[];
  private _proposalIndex: number;
  private _proposalResults: ProposalResult[];
  private _context: vscode.ExtensionContext;
  private _sourceDocument: vscode.TextDocument | undefined;
  private _sourcePanel: vscode.WebviewPanel | undefined;
  private _hasPendingHandoff: boolean;

  private constructor(
    context: vscode.ExtensionContext,
    request: ProposalRequest,
    filename: string,
    sourceDocument?: vscode.TextDocument,
    sourcePanel?: vscode.WebviewPanel
  ) {
    this._context = context;
    this._requestId = request.id;
    this._proposalQueue = normalizeProposalQueue(request);
    this._proposalIndex = 0;
    this._proposalResults = [];
    this._proposal = this._proposalQueue[0];
    this._sourceDocument = sourceDocument;
    this._sourcePanel = sourcePanel;
    this._hasPendingHandoff = false;
    this._clearProposalState();

    this._panel = vscode.window.createWebviewPanel(
      'markdownForHumansProposal',
      `Proposed Change \u2014 ${filename}`,
      {
        viewColumn: vscode.ViewColumn.Beside,
        preserveFocus: true,
      },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist')],
      }
    );

    ProposalPanel.currentPanel = this;

    this._panel.onDidDispose(
      () => {
        this._clearMainEditorHighlight();
        ProposalPanel.currentPanel = undefined;
      },
      null,
      context.subscriptions
    );

    this._panel.webview.html = this._getHtml();

    this._panel.webview.onDidReceiveMessage(
      msg => this._handleMessage(msg),
      null,
      context.subscriptions
    );
  }

  private _update(
    request: ProposalRequest,
    filename: string,
    sourceDocument?: vscode.TextDocument,
    sourcePanel?: vscode.WebviewPanel
  ) {
    this._requestId = request.id;
    this._proposalQueue = normalizeProposalQueue(request);
    this._proposalIndex = 0;
    this._proposalResults = [];
    this._proposal = this._proposalQueue[0];
    this._hasPendingHandoff = false;
    this._clearProposalState();
    if (sourceDocument) {
      this._sourceDocument = sourceDocument;
    }
    if (sourcePanel) {
      this._sourcePanel = sourcePanel;
    }
    this._panel.title = `Proposed Change \u2014 ${filename}`;
    this._panel.webview.postMessage({
      type: 'proposalInit',
      ...this._proposal,
      ...this._getDisplayContext(),
      colors: this._getColors(),
      queueTotal: this._proposalQueue.length,
      queueIndex: this._proposalIndex,
    });
    this._scrollMainEditorWithRetries();
  }

  private _getColors(): object {
    const config = vscode.workspace.getConfiguration();
    return {
      h1: config.get<string>('markdownForHumans.colors.h1', '#1560c1'),
      h2: config.get<string>('markdownForHumans.colors.h2', '#1560c1'),
      h3: config.get<string>('markdownForHumans.colors.h3', '#1560c1'),
      h4: config.get<string>('markdownForHumans.colors.h4', '#1560c1'),
      h5: config.get<string>('markdownForHumans.colors.h5', '#1560c1'),
      h6: config.get<string>('markdownForHumans.colors.h6', '#1560c1'),
      bold: config.get<string>('markdownForHumans.colors.bold', '#bc0101'),
      italic: config.get<string>('markdownForHumans.colors.italic', '#248a57'),
      boldItalic: config.get<string>('markdownForHumans.colors.boldItalic', '#ff7300'),
      labelOpacity: config.get<number>('markdownForHumans.colors.labelOpacity', 0.1),
    };
  }

  private _getDisplayContext(): { displayContextBefore: string; displayContextAfter: string } {
    const doc = this._sourceDocument;
    if (!doc) {
      return { displayContextBefore: '', displayContextAfter: '' };
    }
    const fullMarkdown = doc.getText();
    const match = findProposalMatch(fullMarkdown, {
      original: this._proposal.original,
      replacement: this._proposal.options[0]?.replacement ?? '',
      context_before: this._proposal.context_before,
      context_after: this._proposal.context_after,
    });
    if (!match) {
      return { displayContextBefore: '', displayContextAfter: '' };
    }
    return extractDisplayContext(fullMarkdown, match.index, match.matchedText.length);
  }

  private async _handleMessage(msg: any) {
    if (msg.type === 'proposalReady') {
      this._writeProposalState(this._buildReadyPayload());
      this._panel.webview.postMessage({
        type: 'proposalInit',
        ...this._proposal,
        ...this._getDisplayContext(),
        colors: this._getColors(),
        queueTotal: this._proposalQueue.length,
        queueIndex: this._proposalIndex,
      });
      this._scrollMainEditorWithRetries();
      return;
    }

    if (msg.type === 'proposalResponse') {
      const { status, replacement, selected_option_index } = msg as { status: string; replacement: string | null; selected_option_index?: number | null };

      let appliedStatus = status;

      if (status === 'accept' && replacement) {
        const applied = await this._applyReplacement(replacement);
        const optionIndex = selected_option_index ?? 0;
        const originalOptionReplacement = this._proposal.options[optionIndex]?.replacement ?? '';
        const unchanged = replacement === originalOptionReplacement;
        appliedStatus = applied ? 'applied' : (unchanged ? 'accept_unchanged' : 'accept_changed');
        if (!applied) {
          await vscode.env.clipboard.writeText(replacement);
        }
      } else if (status === 'timeout' && replacement) {
        await vscode.env.clipboard.writeText(replacement);
      }

      this._proposalResults.push({
        ...this._proposal,
        status: appliedStatus,
        replacement: replacement ?? null,
        selected_option_index: selected_option_index ?? null,
      });

      if (this._shouldAdvanceToNextProposal(appliedStatus)) {
        this._proposalIndex += 1;
        this._proposal = this._proposalQueue[this._proposalIndex];
        if (this._hasPendingHandoff) {
          this._writeProposalState(this._buildPendingPayload());
        }
        this._panel.webview.postMessage({
          type: 'proposalInit',
          ...this._proposal,
          ...this._getDisplayContext(),
          colors: this._getColors(),
          queueTotal: this._proposalQueue.length,
          queueIndex: this._proposalIndex,
        });
        this._scrollMainEditorWithRetries();
        return;
      }

      try {
        const payload = this._buildResponsePayload(appliedStatus);
        this._writeResponsePayload(payload);
        this._writeProposalState(payload);
      } catch (err) {
        console.warn(`${BUILD_TAG} Failed to write response temp file:`, err);
      }

      this._panel.dispose();
      return;
    }

    if (msg.type === 'proposalSkipRemaining') {
      // Mark current proposal as skipped
      this._proposalResults.push({
        ...this._proposal,
        status: 'skipped',
        replacement: null,
        selected_option_index: null,
      });
      // Mark all remaining proposals as skipped
      for (let i = this._proposalIndex + 1; i < this._proposalQueue.length; i++) {
        this._proposalResults.push({
          ...this._proposalQueue[i],
          status: 'skipped',
          replacement: null,
          selected_option_index: null,
        });
      }
      try {
        const payload = this._buildResponsePayload('skipped');
        this._writeResponsePayload(payload);
        this._writeProposalState(payload);
      } catch (err) {
        console.warn(`${BUILD_TAG} Failed to write skip-remaining response:`, err);
      }
      this._panel.dispose();
      return;
    }

    if (msg.type === 'proposalPending') {
      if (this._hasPendingHandoff) {
        return;
      }

      this._hasPendingHandoff = true;
      const payload = this._buildPendingPayload();

      try {
        this._writeResponsePayload(payload);
        this._writeProposalState(payload);
      } catch (err) {
        console.warn(`${BUILD_TAG} Failed to write pending proposal state:`, err);
      }
      await this._copyResumePromptForPendingHandoff();
      return;
    }

    if (msg.type === 'copyResumePrompt') {
      await vscode.env.clipboard.writeText('resume');
    }
  }

  private async _copyResumePromptForPendingHandoff(): Promise<void> {
    try {
      await vscode.env.clipboard.writeText('resume');
      this._panel.webview.postMessage({ type: 'resumePromptCopied' });
      void vscode.window.showInformationMessage(
        'Copied "resume" to the clipboard. Finish reviewing in Markdown for Humans, then paste it into the conversation.'
      );
    } catch {
      // Preserve the current behavior if clipboard copy fails.
    }
  }

  private _shouldAdvanceToNextProposal(status: string): boolean {
    return status !== 'timeout' && this._proposalIndex < this._proposalQueue.length - 1;
  }

  private _buildResponsePayload(finalStatus: string): ProposalStatePayload {
    if (this._proposalQueue.length === 1) {
      return {
        id: this._requestId,
        file: this._sourceDocument?.uri.fsPath ?? null,
        review_kind: 'single',
        original: this._proposal.original,
        context_before: this._proposal.context_before,
        context_after: this._proposal.context_after,
        headings_before: this._proposal.headings_before ?? null,
        status: finalStatus,
        replacement: this._proposalResults[0]?.replacement ?? null,
        selected_option_index: this._proposalResults[0]?.selected_option_index ?? null,
      };
    }

    return {
      id: this._requestId,
      file: this._sourceDocument?.uri.fsPath ?? null,
      review_kind: 'sequential',
      status: finalStatus === 'timeout' ? 'timeout' : 'completed',
      results: this._proposalResults.map(result => ({
        status: result.status,
        original: result.original,
        context_before: result.context_before,
        context_after: result.context_after,
        headings_before: result.headings_before ?? null,
        replacement: result.replacement,
        selected_option_index: result.selected_option_index ?? null,
      })),
    };
  }

  private _buildPendingPayload(): ProposalStatePayload {
    const basePayload: ProposalStatePayload = {
      id: this._requestId,
      file: this._sourceDocument?.uri.fsPath ?? null,
      review_kind: this._proposalQueue.length === 1 ? 'single' : 'sequential',
      status: 'pending',
      message: 'The proposal review is still open in Markdown for Humans. Finish reviewing there, then in the conversation type "resume".',
      progress: {
        current: this._proposalIndex + 1,
        total: this._proposalQueue.length,
      },
    };

    if (this._proposalQueue.length === 1) {
      return {
        ...basePayload,
        propose_single_replacement_session_id: this._requestId,
        original: this._proposal.original,
        context_before: this._proposal.context_before,
        context_after: this._proposal.context_after,
        headings_before: this._proposal.headings_before ?? null,
        replacement: null,
        selected_option_index: null,
      };
    }

    return {
      ...basePayload,
      propose_sequential_replacements_session_id: this._requestId,
      results: this._proposalResults.map(result => ({
        status: result.status,
        original: result.original,
        context_before: result.context_before,
        context_after: result.context_after,
        headings_before: result.headings_before ?? null,
        replacement: result.replacement,
        selected_option_index: result.selected_option_index ?? null,
      })),
    };
  }

  private _buildReadyPayload(): ProposalStatePayload {
    return {
      id: this._requestId,
      file: this._sourceDocument?.uri.fsPath ?? null,
      review_kind: this._proposalQueue.length === 1 ? 'single' : 'sequential',
      status: 'ready',
      original: this._proposal.original,
      context_before: this._proposal.context_before,
      context_after: this._proposal.context_after,
      headings_before: this._proposal.headings_before ?? null,
      replacement: null,
      selected_option_index: null,
    };
  }

  private _writeResponsePayload(payload: object) {
    fs.mkdirSync(path.dirname(RESPONSE_TEMP_FILE), { recursive: true });
    fs.writeFileSync(RESPONSE_TEMP_FILE, JSON.stringify(payload, null, 2), 'utf8');
  }

  private _writeProposalState(payload: ProposalStatePayload) {
    try {
      fs.mkdirSync(PROPOSAL_STATE_DIR, { recursive: true });
      fs.writeFileSync(
        ProposalPanel._getProposalStateFilePath(this._requestId),
        JSON.stringify(payload, null, 2),
        'utf8'
      );
    } catch (err) {
      console.warn(`${BUILD_TAG} Failed to write proposal state file:`, err);
    }
  }

  static _getProposalStateFilePath(id: string): string {
    return path.join(PROPOSAL_STATE_DIR, `${id}.json`);
  }

  private _clearProposalState() {
    try {
      fs.unlinkSync(ProposalPanel._getProposalStateFilePath(this._requestId));
    } catch {}
  }

  private static _writeImmediateError(
    request: ProposalRequest,
    sourceDocument: vscode.TextDocument | null,
    errorType: string,
    error: string
  ) {
    const queue = normalizeProposalQueue(request);
    const primaryProposal = queue[0];
    if (!primaryProposal) {
      return;
    }

    const payload: ProposalStatePayload = {
      id: request.id,
      file: sourceDocument?.uri.fsPath ?? request.file ?? null,
      review_kind: queue.length === 1 ? 'single' : 'sequential',
      status: 'error',
      message: error,
      error_type: errorType,
      error,
      original: primaryProposal.original,
      context_before: primaryProposal.context_before,
      context_after: primaryProposal.context_after,
      headings_before: primaryProposal.headings_before ?? null,
      replacement: null,
      selected_option_index: null,
    };

    try {
      fs.mkdirSync(path.dirname(RESPONSE_TEMP_FILE), { recursive: true });
      fs.writeFileSync(RESPONSE_TEMP_FILE, JSON.stringify(payload, null, 2), 'utf8');
    } catch (err) {
      console.warn(`${BUILD_TAG} Failed to write immediate proposal response:`, err);
    }

    try {
      fs.mkdirSync(PROPOSAL_STATE_DIR, { recursive: true });
      fs.writeFileSync(
        ProposalPanel._getProposalStateFilePath(request.id),
        JSON.stringify(payload, null, 2),
        'utf8'
      );
    } catch (err) {
      console.warn(`${BUILD_TAG} Failed to write immediate proposal state:`, err);
    }
  }

  private async _applyReplacement(replacement: string): Promise<boolean> {
    const doc = this._sourceDocument;
    if (!doc) {
      console.warn(`${BUILD_TAG} _applyReplacement: no source document`);
      return false;
    }

    const rawContent = doc.getText();
    const appliedReplacement = applyProposalReplacement(rawContent, {
      original: this._proposal.original,
      replacement,
      context_before: this._proposal.context_before,
      context_after: this._proposal.context_after,
    });

    if (!appliedReplacement) {
      vscode.window.showWarningMessage(
        `${BUILD_TAG} Could not locate original text in file \u2014 replacement not applied. Text was copied to clipboard.`
      );
      return false;
    }

    const edit = new vscode.WorkspaceEdit();
    const fullRange = new vscode.Range(doc.positionAt(0), doc.positionAt(rawContent.length));
    edit.replace(doc.uri, fullRange, appliedReplacement.newContent);

    try {
      const success = await vscode.workspace.applyEdit(edit);
      if (!success) {
        vscode.window.showWarningMessage(
          `${BUILD_TAG} Failed to apply replacement \u2014 text was copied to clipboard.`
        );
      }
      return success;
    } catch (err) {
      console.warn(`${BUILD_TAG} _applyReplacement error:`, err);
      return false;
    }
  }

  private _scrollMainEditor() {
    const mainPanel = this._sourcePanel;
    if (mainPanel) {
      mainPanel.webview.postMessage({
        type: 'selectProposalSelection',
        original: this._proposal.original,
        context_before: this._proposal.context_before,
        context_after: this._proposal.context_after,
        headings_before: this._proposal.headings_before ?? null,
      });
    }
  }

  private _revealMainEditorSelection() {
    const mainPanel = this._sourcePanel;
    if (mainPanel) {
      mainPanel.webview.postMessage({
        type: 'revealCurrentProposalSelection',
      });
    }
  }

  private _clearMainEditorHighlight() {
    const mainPanel = this._sourcePanel;
    if (mainPanel) {
      mainPanel.webview.postMessage({ type: 'clearProposalTargetHighlight' });
    }
  }

  private _scrollMainEditorWithRetries() {
    this._scrollMainEditor();

    // Opening the proposal panel beside the editor resizes the main webview.
    // Re-apply the selection on the final retry so visible highlighting survives layout changes.
    for (const delay of [100, 250]) {
      setTimeout(() => this._revealMainEditorSelection(), delay);
    }
    setTimeout(() => this._scrollMainEditor(), 500);
  }

  private _getHtml(): string {
    const webview = this._panel.webview;
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._context.extensionUri, 'dist', 'webview.js')
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._context.extensionUri, 'dist', 'webview.css')
    );
    const nonce = getNonce();

    return /* html */ `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta http-equiv="Content-Security-Policy"
              content="default-src 'none';
                       style-src ${webview.cspSource} 'unsafe-inline';
                       script-src 'nonce-${nonce}';
                       connect-src ${webview.cspSource};
                       font-src ${webview.cspSource};
                       img-src ${webview.cspSource} https: data: blob:;">
        <link href="${styleUri}" rel="stylesheet">
        <title>Proposed Change</title>
      </head>
      <body>
        <div id="proposal-root"></div>
        <script nonce="${nonce}" src="${scriptUri}"></script>
      </body>
      </html>
    `;
  }
}

function resolveProposalSourceContext(proposal: ProposalRequest): {
  document: vscode.TextDocument | undefined;
  panel: vscode.WebviewPanel | undefined;
} {
  if (proposal.file) {
    const matched = getOpenWebviewForDocument(proposal.file);
    if (matched) {
      return matched;
    }
  }

  const primaryProposal =
    Array.isArray(proposal.proposals) && proposal.proposals.length > 0
      ? proposal.proposals[0]
      : proposal;

  if (primaryProposal.original) {
    for (const openWebview of getOpenWebviews()) {
      const match = findProposalMatch(openWebview.document.getText(), {
        original: primaryProposal.original,
        replacement: primaryProposal.options[0]?.replacement ?? '',
        context_before: primaryProposal.context_before,
        context_after: primaryProposal.context_after,
      });

      if (match) {
        return openWebview;
      }
    }
  }

  return {
    document: getActiveDocument(),
    panel: getActiveWebviewPanel(),
  };
}

function doesDocumentMatchProposal(fullMarkdown: string, proposal: ProposalRequest): boolean {
  const primaryProposal =
    Array.isArray(proposal.proposals) && proposal.proposals.length > 0
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

function normalizeProposalQueue(request: ProposalRequest): Proposal[] {
  if (Array.isArray(request.proposals) && request.proposals.length > 0) {
    return request.proposals;
  }

  return [
    {
      original: request.original,
      options: (request.options ?? []).slice(0, 3),
      context_before: request.context_before,
      context_after: request.context_after,
      headings_before: request.headings_before ?? null,
    },
  ];
}

function getNonce() {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

const DISPLAY_CONTEXT_MIN_CHARS = 400; // ~5 lines at 80 chars each

/**
 * Extract display context from the full document around a matched selection.
 *
 * Before: go back at least DISPLAY_CONTEXT_MIN_CHARS, extend to paragraph
 * start (blank-line boundary), then include any contiguous headings above.
 *
 * After: go forward at least DISPLAY_CONTEXT_MIN_CHARS, extend to paragraph
 * end (blank-line boundary).
 */
export function extractDisplayContext(
  fullMarkdown: string,
  matchIndex: number,
  matchLength: number
): { displayContextBefore: string; displayContextAfter: string } {
  const normalized = fullMarkdown.replace(/\r\n/g, '\n');
  // matchIndex and matchLength are in fullMarkdown-space; convert to normalized-space
  // by subtracting the number of \r characters that were removed before each position.
  const selStart = fullMarkdown.slice(0, matchIndex).replace(/\r\n/g, '\n').length;
  const selEnd = fullMarkdown.slice(0, matchIndex + matchLength).replace(/\r\n/g, '\n').length;

  // --- context before ---
  let beforeStart = Math.max(0, selStart - DISPLAY_CONTEXT_MIN_CHARS);

  // Extend back to start of paragraph (find preceding blank line or doc start)
  const lastBlankBefore = normalized.lastIndexOf('\n\n', beforeStart);
  if (lastBlankBefore !== -1) {
    beforeStart = lastBlankBefore + 2;
  } else {
    beforeStart = 0;
  }

  // Walk further back to include any contiguous heading lines above
  const linesBefore = normalized.slice(0, beforeStart).split('\n');
  let li = linesBefore.length - 1;
  // skip trailing blank lines at the boundary
  while (li >= 0 && linesBefore[li].trim() === '') {
    li -= 1;
  }
  // consume heading lines (and blank lines between them)
  while (li >= 0) {
    if (/^#{1,6}\s/.test(linesBefore[li].trim())) {
      li -= 1;
      while (li >= 0 && linesBefore[li].trim() === '') {
        li -= 1;
      }
    } else {
      break;
    }
  }
  // li+1 is the first heading line index; recalculate beforeStart from there
  const headingLineStart = li + 1;
  if (headingLineStart < linesBefore.length) {
    const charsBeforeHeadings = linesBefore.slice(0, headingLineStart).join('\n');
    beforeStart = headingLineStart > 0 ? charsBeforeHeadings.length + 1 : 0;
  }

  const displayContextBefore = normalized.slice(beforeStart, selStart);

  // --- context after ---
  let afterEnd = Math.min(normalized.length, selEnd + DISPLAY_CONTEXT_MIN_CHARS);

  // Extend forward to end of paragraph
  const nextBlankAfter = normalized.indexOf('\n\n', afterEnd);
  afterEnd = nextBlankAfter !== -1 ? nextBlankAfter : normalized.length;

  const displayContextAfter = normalized.slice(selEnd, afterEnd);

  return { displayContextBefore, displayContextAfter };
}
