/**
 * Copyright (c) 2025-2026 Concret.io
 *
 * Licensed under the MIT License. See LICENSE file in the project root for details.
 */

import * as vscode from 'vscode';

let activeWebviewPanel: vscode.WebviewPanel | undefined;
let activeDocument: vscode.TextDocument | undefined;

function setActiveContext(isActive: boolean) {
  vscode.commands.executeCommand('setContext', 'markdownForHumans.isActive', isActive);
}

export function setActiveWebviewPanel(panel: vscode.WebviewPanel | undefined, document?: vscode.TextDocument) {
  activeWebviewPanel = panel;
  activeDocument = document;
  setActiveContext(!!panel);
}

export function getActiveWebviewPanel(): vscode.WebviewPanel | undefined {
  return activeWebviewPanel;
}

export function getActiveDocument(): vscode.TextDocument | undefined {
  return activeDocument;
}
