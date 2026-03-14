/**
 * Copyright (c) 2025-2026 Concret.io
 *
 * Licensed under the MIT License. See LICENSE file in the project root for details.
 */

import * as vscode from 'vscode';

let activeWebviewPanel: vscode.WebviewPanel | undefined;
let activeDocument: vscode.TextDocument | undefined;
const editorHostInstanceId = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const openWebviews = new Map<vscode.WebviewPanel, vscode.TextDocument>();

function setActiveContext(isActive: boolean) {
  vscode.commands.executeCommand('setContext', 'markdownForHumans.isActive', isActive);
}

export function setActiveWebviewPanel(panel: vscode.WebviewPanel | undefined, document?: vscode.TextDocument) {
  if (panel && document) {
    openWebviews.set(panel, document);
  }
  activeWebviewPanel = panel;
  activeDocument = document;
  setActiveContext(!!panel);
}

export function registerWebviewPanel(panel: vscode.WebviewPanel, document: vscode.TextDocument): void {
  openWebviews.set(panel, document);
}

export function unregisterWebviewPanel(panel: vscode.WebviewPanel): void {
  openWebviews.delete(panel);
  if (activeWebviewPanel === panel) {
    activeWebviewPanel = undefined;
    activeDocument = undefined;
    setActiveContext(false);
  }
}

export function markWebviewPanelActive(panel: vscode.WebviewPanel): void {
  const document = openWebviews.get(panel);
  if (!document) {
    return;
  }

  activeWebviewPanel = panel;
  activeDocument = document;
  setActiveContext(true);
}

export function getActiveWebviewPanel(): vscode.WebviewPanel | undefined {
  return activeWebviewPanel;
}

export function getActiveDocument(): vscode.TextDocument | undefined {
  return activeDocument;
}

export function getOpenWebviewForDocument(filePath: string): {
  panel: vscode.WebviewPanel;
  document: vscode.TextDocument;
} | undefined {
  for (const [panel, document] of openWebviews.entries()) {
    if (document.uri.fsPath === filePath) {
      return { panel, document };
    }
  }
  return undefined;
}

export function hasOpenWebviewForDocument(filePath: string): boolean {
  return !!getOpenWebviewForDocument(filePath);
}

export function getEditorHostInstanceId(): string {
  return editorHostInstanceId;
}

export function resetActiveWebviewStateForTests(): void {
  openWebviews.clear();
  activeWebviewPanel = undefined;
  activeDocument = undefined;
}
