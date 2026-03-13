/**
 * Copyright (c) 2025-2026 Concret.io
 *
 * Licensed under the MIT License. See LICENSE file in the project root for details.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { RESPONSE_TEMP_FILE } from '../editor/MarkdownEditorProvider';
import { getActiveWebviewPanel, getActiveDocument } from '../activeWebview';

export interface Proposal {
  id: string;
  original: string;
  replacement: string;
  context_before: string | null;
  context_after: string | null;
}

/**
 * A VS Code WebviewPanel that displays a proposed text replacement side-by-side
 * with the original, rendered as WYSIWYG via the same webview.js bundle.
 */
export class ProposalPanel {
  static currentPanel: ProposalPanel | undefined;

  static show(context: vscode.ExtensionContext, proposal: Proposal) {
    const doc = getActiveDocument();
    const sourcePanel = getActiveWebviewPanel();
    const filename = doc ? path.basename(doc.uri.fsPath) : 'document';

    if (ProposalPanel.currentPanel) {
      ProposalPanel.currentPanel._update(proposal, filename, doc, sourcePanel);
      ProposalPanel.currentPanel._panel.reveal(vscode.ViewColumn.Beside);
      return;
    }
    new ProposalPanel(context, proposal, filename, doc, sourcePanel);
  }

  private _panel: vscode.WebviewPanel;
  private _proposal: Proposal;
  private _context: vscode.ExtensionContext;
  private _sourceDocument: vscode.TextDocument | undefined;
  private _sourcePanel: vscode.WebviewPanel | undefined;

  private constructor(
    context: vscode.ExtensionContext,
    proposal: Proposal,
    filename: string,
    sourceDocument?: vscode.TextDocument,
    sourcePanel?: vscode.WebviewPanel
  ) {
    this._context = context;
    this._proposal = proposal;
    this._sourceDocument = sourceDocument;
    this._sourcePanel = sourcePanel;

    this._panel = vscode.window.createWebviewPanel(
      'markdownForHumansProposal',
      `Proposed Change \u2014 ${filename}`,
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist')],
      }
    );

    ProposalPanel.currentPanel = this;

    this._panel.onDidDispose(
      () => {
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
    proposal: Proposal,
    filename: string,
    sourceDocument?: vscode.TextDocument,
    sourcePanel?: vscode.WebviewPanel
  ) {
    this._proposal = proposal;
    if (sourceDocument) {
      this._sourceDocument = sourceDocument;
    }
    if (sourcePanel) {
      this._sourcePanel = sourcePanel;
    }
    this._panel.title = `Proposed Change \u2014 ${filename}`;
    // Re-send proposal data if webview is already ready
    this._panel.webview.postMessage({
      type: 'proposalInit',
      ...proposal,
      colors: this._getColors(),
    });
    // Scroll main editor to original
    this._scrollMainEditor();
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
      // Webview signals it is initialized; send the proposal data and colors
      this._panel.webview.postMessage({
        type: 'proposalInit',
        ...this._proposal,
        colors: this._getColors(),
      });
      // Scroll and select in main editor
      this._scrollMainEditor();
      return;
    }

    if (msg.type === 'proposalResponse') {
      const { status, replacement } = msg as { status: string; replacement: string | null };

      let appliedStatus = status;

      if (status === 'accept' && replacement) {
        // Apply the replacement directly to the file so Claude Code doesn't need to
        const applied = await this._applyReplacement(replacement);
        appliedStatus = applied ? 'applied' : 'accept';
        // Also copy to clipboard as backup
        await vscode.env.clipboard.writeText(replacement);
      } else if (status === 'timeout' && replacement) {
        await vscode.env.clipboard.writeText(replacement);
      }

      // Write response file for MCP server to read
      try {
        fs.writeFileSync(
          RESPONSE_TEMP_FILE,
          JSON.stringify({
            id: this._proposal.id,
            status: appliedStatus,
            replacement: replacement ?? null,
          }),
          'utf8'
        );
      } catch (err) {
        console.warn('[MD4H] Failed to write response temp file:', err);
      }

      this._panel.dispose();
    }
  }

  /**
   * Apply the replacement to the active document directly, replacing the original text.
   * Normalizes non-breaking spaces so the match works even if the file contains \u00a0.
   * Returns true if the edit was applied successfully.
   */
  private async _applyReplacement(replacement: string): Promise<boolean> {
    const doc = this._sourceDocument;
    if (!doc) {
      console.warn('[MD4H] _applyReplacement: no source document');
      return false;
    }

    const original = this._proposal.original;
    const rawContent = doc.getText();

    // Try exact match first, then with \u00a0 normalized
    let matchIndex = rawContent.indexOf(original);
    let contentToSearch = rawContent;

    if (matchIndex === -1) {
      contentToSearch = rawContent.replace(/\u00a0/g, ' ');
      matchIndex = contentToSearch.indexOf(original);
    }

    if (matchIndex === -1) {
      // If there are multiple candidates with context scoring, use context
      const { context_before, context_after } = this._proposal;
      if (context_before || context_after) {
        let bestIdx = -1;
        let bestScore = -1;
        let searchFrom = 0;
        while (true) {
          const idx = contentToSearch.indexOf(original, searchFrom);
          if (idx === -1) break;
          let score = 0;
          if (context_before) {
            const before = contentToSearch.slice(Math.max(0, idx - context_before.length), idx);
            score += commonSuffixLength(before, context_before);
          }
          if (context_after) {
            const after = contentToSearch.slice(
              idx + original.length,
              idx + original.length + context_after.length
            );
            score += commonPrefixLength(after, context_after);
          }
          if (score > bestScore) {
            bestScore = score;
            bestIdx = idx;
          }
          searchFrom = idx + 1;
        }
        matchIndex = bestIdx;
      }
    }

    if (matchIndex === -1) {
      vscode.window.showWarningMessage(
        '[MD4H] Could not locate original text in file — replacement not applied. Text was copied to clipboard.'
      );
      return false;
    }

    // Build new content by splicing replacement in place of original
    // Use rawContent offsets (matchIndex came from normalized copy but length is same for \u00a0 → space)
    const newContent =
      rawContent.slice(0, matchIndex) +
      replacement +
      rawContent.slice(matchIndex + original.length);

    const edit = new vscode.WorkspaceEdit();
    const fullRange = new vscode.Range(doc.positionAt(0), doc.positionAt(rawContent.length));
    edit.replace(doc.uri, fullRange, newContent);

    try {
      const success = await vscode.workspace.applyEdit(edit);
      if (!success) {
        vscode.window.showWarningMessage(
          '[MD4H] Failed to apply replacement — text was copied to clipboard.'
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
        type: 'scrollAndSelect',
        original: this._proposal.original,
        context_before: this._proposal.context_before,
        context_after: this._proposal.context_after,
      });
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

function commonSuffixLength(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[a.length - 1 - i] === b[b.length - 1 - i]) i++;
  return i;
}

function commonPrefixLength(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

function getNonce() {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
