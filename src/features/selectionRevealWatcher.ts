/**
 * Copyright (c) 2025-2026 Concret.io
 *
 * Licensed under the MIT License. See LICENSE file in the project root for details.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  getActiveWebviewPanel,
  getEditorHostInstanceId,
  getOpenWebviews,
  getOpenWebviewForDocument,
  hasOpenWebviewForDocument,
} from '../activeWebview';
import {
  SELECTION_REVEAL_RESPONSE_TEMP_FILE,
  SELECTION_REVEAL_TEMP_FILE,
} from '../editor/MarkdownEditorProvider';
import { findProposalMatch } from './proposalReplacement';

export interface SelectionRevealRequest {
  id: string;
  file?: string | null;
  source_instance_id?: string | null;
  original: string;
  context_before: string | null;
  context_after: string | null;
}

export function readPendingSelectionRevealRequest(
  requestFilePath: string = SELECTION_REVEAL_TEMP_FILE
): SelectionRevealRequest | null {
  if (!fs.existsSync(requestFilePath)) return null;

  const data = JSON.parse(fs.readFileSync(requestFilePath, 'utf8')) as SelectionRevealRequest;
  if (!data.id) return null;

  try {
    fs.unlinkSync(requestFilePath);
  } catch {
    // Ignore cleanup failures; the request has already been read.
  }

  return data;
}

export function shouldHandleSelectionRevealRequest(request: SelectionRevealRequest): boolean {
  const instanceMatch =
    !request.source_instance_id || request.source_instance_id === getEditorHostInstanceId();
  const fileMatch = !request.file || hasOpenWebviewForDocument(request.file);

  if (!instanceMatch) {
    return false;
  }

  if (request.file) {
    return fileMatch;
  }

  return getOpenWebviews().length > 0;
}

export function processSelectionRevealRequest(
  request: SelectionRevealRequest,
  responseFilePath: string = SELECTION_REVEAL_RESPONSE_TEMP_FILE
): boolean {
  const targetContext = resolveSelectionRevealTarget(request);
  const targetPanel = targetContext?.panel ?? getActiveWebviewPanel();

  if (!targetPanel) {
    writeSelectionRevealResponse(
      {
        id: request.id,
        status: 'error',
        error: 'No matching Markdown for Humans editor is open.',
        file: request.file ?? null,
      },
      responseFilePath
    );
    return false;
  }

  if (typeof targetPanel.reveal === 'function') {
    targetPanel.reveal();
  }

  targetPanel.webview.postMessage({
    type: 'scrollAndSelect',
    original: request.original,
    context_before: request.context_before,
    context_after: request.context_after,
  });

  writeSelectionRevealResponse(
    {
      id: request.id,
      status: 'revealed',
      file: request.file ?? targetContext?.document.uri.fsPath ?? null,
    },
    responseFilePath
  );
  return true;
}

function resolveSelectionRevealTarget(request: SelectionRevealRequest): {
  panel: vscode.WebviewPanel;
  document: vscode.TextDocument;
} | null {
  if (request.file) {
    return getOpenWebviewForDocument(request.file) ?? null;
  }

  for (const openWebview of getOpenWebviews()) {
    const fullMarkdown = openWebview.document.getText();
    const match = findProposalMatch(fullMarkdown, {
      original: request.original,
      replacement: request.original,
      context_before: request.context_before,
      context_after: request.context_after,
    });

    if (match) {
      return openWebview;
    }
  }

  return null;
}

function writeSelectionRevealResponse(
  response: {
    id: string;
    status: 'revealed' | 'error';
    file: string | null;
    error?: string;
  },
  responseFilePath: string
): void {
  try {
    fs.writeFileSync(responseFilePath, JSON.stringify(response, null, 2), 'utf8');
  } catch (error) {
    console.warn('[MD4H] Failed to write selection reveal response temp file:', error);
  }
}

/**
 * Watch for incoming selection reveal requests written by the MCP server.
 * When a new request appears, scroll and select the matching range in the main editor.
 */
export function startSelectionRevealWatcher(): vscode.Disposable {
  let lastId: string | null = null;

  const check = () => {
    try {
      const data = readPendingSelectionRevealRequest();
      if (!data) return;
      if (!data.id || data.id === lastId) return;
      if (!shouldHandleSelectionRevealRequest(data)) return;
      lastId = data.id;
      processSelectionRevealRequest(data);
    } catch {
      // Ignore parse errors (file may be mid-write).
    }
  };

  let watcher: fs.FSWatcher | undefined;
  try {
    watcher = fs.watch(path.dirname(SELECTION_REVEAL_TEMP_FILE), (_event, filename) => {
      if (filename && filename.includes('SelectionReveal')) check();
    });
  } catch (err) {
    console.warn(
      '[MD4H] selectionRevealWatcher: fs.watch unavailable, changes will not be detected automatically',
      err
    );
  }

  check();

  return new vscode.Disposable(() => {
    try {
      watcher?.close();
    } catch {
      // Ignore watcher disposal errors during shutdown.
    }
  });
}
