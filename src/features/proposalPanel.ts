/**
 * Copyright (c) 2025-2026 Concret.io
 *
 * Licensed under the MIT License. See LICENSE file in the project root for details.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { RESPONSE_TEMP_FILE } from '../editor/MarkdownEditorProvider';
import {
  getActiveDocument,
  getActiveWebviewPanel,
  getOpenWebviewForDocument,
} from '../activeWebview';
import { applyProposalReplacement } from './proposalReplacement';

export interface Proposal {
  original: string;
  replacement: string;
  context_before: string | null;
  context_after: string | null;
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
  status: string;
  replacement: string | null;
}

/**
 * A VS Code WebviewPanel that displays a WYSIWYG redline review above an
 * editable proposed replacement via the same webview.js bundle.
 */
export class ProposalPanel {
  static currentPanel: ProposalPanel | undefined;

  static show(context: vscode.ExtensionContext, request: ProposalRequest) {
    const sourceContext = resolveProposalSourceContext(request);
    const doc = sourceContext.document;
    const sourcePanel = sourceContext.panel;
    const filename = doc?.uri.fsPath
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
      colors: this._getColors(),
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

  private async _handleMessage(msg: any) {
    if (msg.type === 'proposalReady') {
      this._panel.webview.postMessage({
        type: 'proposalInit',
        ...this._proposal,
        colors: this._getColors(),
      });
      this._scrollMainEditorWithRetries();
      return;
    }

    if (msg.type === 'proposalResponse') {
      const { status, replacement } = msg as { status: string; replacement: string | null };

      let appliedStatus = status;

      if (status === 'accept' && replacement) {
        const applied = await this._applyReplacement(replacement);
        appliedStatus = applied ? 'applied' : 'accept';
        await vscode.env.clipboard.writeText(replacement);
      } else if (status === 'timeout' && replacement) {
        await vscode.env.clipboard.writeText(replacement);
      }

      this._proposalResults.push({
        ...this._proposal,
        status: appliedStatus,
        replacement: replacement ?? null,
      });

      if (this._shouldAdvanceToNextProposal(appliedStatus)) {
        this._proposalIndex += 1;
        this._proposal = this._proposalQueue[this._proposalIndex];
        this._panel.webview.postMessage({
          type: 'proposalInit',
          ...this._proposal,
          colors: this._getColors(),
        });
        this._scrollMainEditorWithRetries();
        return;
      }

      try {
        fs.writeFileSync(
          RESPONSE_TEMP_FILE,
          JSON.stringify(this._buildResponsePayload(appliedStatus), null, 2),
          'utf8'
        );
      } catch (err) {
        console.warn('[MD4H] Failed to write response temp file:', err);
      }

      this._panel.dispose();
    }
  }

  private _shouldAdvanceToNextProposal(status: string): boolean {
    return status !== 'timeout' && this._proposalIndex < this._proposalQueue.length - 1;
  }

  private _buildResponsePayload(finalStatus: string) {
    if (this._proposalQueue.length === 1) {
      return {
        id: this._requestId,
        file: this._sourceDocument?.uri.fsPath ?? null,
        original: this._proposal.original,
        context_before: this._proposal.context_before,
        context_after: this._proposal.context_after,
        status: finalStatus,
        replacement: this._proposalResults[0]?.replacement ?? null,
      };
    }

    return {
      id: this._requestId,
      file: this._sourceDocument?.uri.fsPath ?? null,
      status: finalStatus === 'timeout' ? 'timeout' : 'completed',
      results: this._proposalResults.map(result => ({
        status: result.status,
        original: result.original,
        context_before: result.context_before,
        context_after: result.context_after,
        replacement: result.replacement,
      })),
    };
  }

  private async _applyReplacement(replacement: string): Promise<boolean> {
    const doc = this._sourceDocument;
    if (!doc) {
      console.warn('[MD4H] _applyReplacement: no source document');
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
        '[MD4H] Could not locate original text in file â€” replacement not applied. Text was copied to clipboard.'
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
          '[MD4H] Failed to apply replacement â€” text was copied to clipboard.'
        );
      }
      return success;
    } catch (err) {
      console.warn('[MD4H] _applyReplacement error:', err);
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
    // Apply the reveal only after layout settles; do not re-apply the selection.
    for (const delay of [100, 250, 500]) {
      setTimeout(() => this._revealMainEditorSelection(), delay);
    }
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

  return {
    document: getActiveDocument(),
    panel: getActiveWebviewPanel(),
  };
}

function normalizeProposalQueue(request: ProposalRequest): Proposal[] {
  if (Array.isArray(request.proposals) && request.proposals.length > 0) {
    return request.proposals;
  }

  return [
    {
      original: request.original,
      replacement: request.replacement,
      context_before: request.context_before,
      context_after: request.context_after,
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
