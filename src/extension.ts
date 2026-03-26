/**
 * Copyright (c) 2025-2026 Concret.io
 *
 * Licensed under the MIT License. See LICENSE file in the project root for details.
 */

import * as vscode from 'vscode';
import {
  cleanupStaleMcpMetadataOnActivate,
  MarkdownEditorProvider,
  updateFocusedInstanceMetadataForCurrentWindow,
} from './editor/MarkdownEditorProvider';
import { WordCountFeature } from './features/wordCount';
import { getActiveWebviewPanel } from './activeWebview';
import { outlineViewProvider } from './features/outlineView';
import { startProposalWatcher } from './features/proposalWatcher';
import { startPlanWatcher } from './features/planWatcher';
import { startSelectionRevealWatcher } from './features/selectionRevealWatcher';

export function activate(context: vscode.ExtensionContext) {
  cleanupStaleMcpMetadataOnActivate();

  // Register the custom editor provider
  const { disposable, provider } = MarkdownEditorProvider.register(context);
  context.subscriptions.push(disposable);

  if (vscode.window.state.focused) {
    updateFocusedInstanceMetadataForCurrentWindow();
  }

  context.subscriptions.push(
    vscode.window.onDidChangeWindowState(state => {
      if (state.focused) {
        updateFocusedInstanceMetadataForCurrentWindow();
      }
    })
  );

  // Clear active context when switching to non-markdown-for-humans editors
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(editor => {
      // Custom editors appear as undefined in activeTextEditor, so if we get a text editor here, disable context
      if (editor && editor.document.languageId !== 'markdown') {
        // If a regular text editor is active, clear our active context
        // Note: markdown languageId for default text editor; webview handled via view state events
        vscode.commands.executeCommand('setContext', 'markdownForHumans.isActive', false);
      }
    })
  );

  // Register outline tree view provider (Explorer)
  const outlineTreeView = vscode.window.createTreeView('markdownForHumansOutline', {
    treeDataProvider: outlineViewProvider,
    showCollapseAll: true,
  });
  outlineViewProvider.setTreeView(outlineTreeView);
  outlineViewProvider.setShowNavigationLineNumbers(
    vscode.workspace
      .getConfiguration()
      .get<boolean>('markdownForHumans.showNavigationLineNumbers', false)
  );
  context.subscriptions.push(outlineTreeView);
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('markdownForHumans.showNavigationLineNumbers')) {
        outlineViewProvider.setShowNavigationLineNumbers(
          vscode.workspace
            .getConfiguration()
            .get<boolean>('markdownForHumans.showNavigationLineNumbers', false)
        );
      }
    })
  );

  // Initialize Word Count feature
  const wordCount = new WordCountFeature();
  wordCount.activate(context);

  // Watch for incoming AI proposals (Plan Selection feature)
  context.subscriptions.push(startProposalWatcher(context));
  context.subscriptions.push(startPlanWatcher(context));
  context.subscriptions.push(startSelectionRevealWatcher());

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('markdownForHumans.openFile', async (uri?: vscode.Uri) => {
      let targetUri = uri;

      const activeEditor = vscode.window.activeTextEditor;

      // If no URI passed (e.g. run from command palette), prefer the active markdown editor
      if (!targetUri && activeEditor && activeEditor.document.languageId === 'markdown') {
        const document = activeEditor.document;

        // Support both file and untitled schemes
        if (document.uri.scheme === 'file' || document.uri.scheme === 'untitled') {
          targetUri = document.uri;
        }
      }

      // If we still don't have a URI, ask user to pick a file
      if (!targetUri) {
        const uris = await vscode.window.showOpenDialog({
          canSelectMany: false,
          filters: {
            Markdown: ['md', 'markdown'],
          },
        });
        if (uris && uris[0]) {
          targetUri = uris[0];
        }
      }

      if (targetUri) {
        await vscode.commands.executeCommand(
          'vscode.openWith',
          targetUri,
          'markdownForHumans.editor'
        );
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('markdownForHumans.toggleSource', () => {
      // This will be handled by the webview
      vscode.window.activeTextEditor?.show();
    })
  );

  // Register word count detailed stats command
  context.subscriptions.push(
    vscode.commands.registerCommand('markdownForHumans.showDetailedStats', () => {
      wordCount.showDetailedStats();
    })
  );

  // Register TOC outline toggle command (Option 2 - TOC Overlay)
  context.subscriptions.push(
    vscode.commands.registerCommand('markdownForHumans.toggleTocOutlineView', () => {
      const panel = getActiveWebviewPanel();
      if (panel) {
        panel.webview.postMessage({ type: 'toggleTocOutlineView' });
      }
    })
  );

  // Navigate to heading from outline tree
  context.subscriptions.push(
    vscode.commands.registerCommand('markdownForHumans.navigateToHeading', (pos: number) => {
      const panel = getActiveWebviewPanel();
      if (panel) {
        panel.webview.postMessage({ type: 'navigateToHeading', pos });
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('markdownForHumans.outline.revealCurrent', () => {
      outlineViewProvider.revealActive(outlineTreeView);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('markdownForHumans.outline.filter', () => {
      outlineViewProvider.showFilterInput();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('markdownForHumans.outline.clearFilter', () => {
      outlineViewProvider.clearFilter();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('markdownForHumans.navigateBack', () => {
      const panel = getActiveWebviewPanel();
      if (panel) {
        panel.webview.postMessage({ type: 'navigateBack' });
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('markdownForHumans.navigateForward', () => {
      const panel = getActiveWebviewPanel();
      if (panel) {
        panel.webview.postMessage({ type: 'navigateForward' });
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('markdownForHumans.openGotoLine', () => {
      const panel = getActiveWebviewPanel();
      if (panel) {
        panel.webview.postMessage({ type: 'openGotoLine' });
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('markdownForHumans.planOverlay.nextRange', () => {
      const panel = getActiveWebviewPanel();
      if (panel) {
        panel.webview.postMessage({ type: 'planNextRange' });
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('markdownForHumans.planOverlay.previousRange', () => {
      const panel = getActiveWebviewPanel();
      if (panel) {
        panel.webview.postMessage({ type: 'planPreviousRange' });
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('markdownForHumans.getSelection', async () => {
      const result = await provider.getSelection();
      // Debug: open result in editor pane
      // const doc = await vscode.workspace.openTextDocument({ content: result, language: 'json' });
      // await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preview: true });
      return result;
    })
  );
}

export function deactivate() {
  // Cleanup handled by VS Code's subscription disposal
}
