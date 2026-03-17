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
  selection_request_id?: string;
  id?: string;
  file?: string | null;
  instance_id?: string | null;
  source_instance_id?: string | null;
  original: string;
  context_before: string | null;
  context_after: string | null;
  headings_before?: string[] | null;
}

function getSelectionRevealRequestId(request: SelectionRevealRequest): string | null {
  return request.selection_request_id ?? request.id ?? null;
}

function getSelectionRevealInstanceId(request: SelectionRevealRequest): string | null {
  return request.instance_id ?? request.source_instance_id ?? null;
}

export function readPendingSelectionRevealRequest(
  requestFilePath: string = SELECTION_REVEAL_TEMP_FILE
): SelectionRevealRequest | null {
  if (!fs.existsSync(requestFilePath)) return null;

  const data = JSON.parse(fs.readFileSync(requestFilePath, 'utf8')) as SelectionRevealRequest;
  if (!getSelectionRevealRequestId(data)) return null;

  return data;
}

export function consumePendingSelectionRevealRequest(
  requestId: string,
  requestFilePath: string = SELECTION_REVEAL_TEMP_FILE
): boolean {
  if (!fs.existsSync(requestFilePath)) {
    return false;
  }

  try {
    const data = JSON.parse(fs.readFileSync(requestFilePath, 'utf8')) as SelectionRevealRequest;
    if (getSelectionRevealRequestId(data) !== requestId) {
      return false;
    }
    fs.unlinkSync(requestFilePath);
    return true;
  } catch {
    return false;
  }
}

export function shouldHandleSelectionRevealRequest(request: SelectionRevealRequest): boolean {
  const instanceMatch =
    !getSelectionRevealInstanceId(request) ||
    getSelectionRevealInstanceId(request) === getEditorHostInstanceId();
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
  const selectionRequestId = getSelectionRevealRequestId(request);
  if (!selectionRequestId) {
    return false;
  }
  const targetContext = resolveSelectionRevealTarget(request);
  const targetPanel = targetContext?.panel ?? getActiveWebviewPanel();

  if (!targetPanel) {
    writeSelectionRevealResponse(
      {
        selection_request_id: selectionRequestId,
        id: selectionRequestId,
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

  scheduleSelectionRevealPosts(
    targetPanel,
    request,
    responseFilePath,
    targetContext?.document.uri.fsPath ?? null,
    selectionRequestId
  );
  return true;
}

function scheduleSelectionRevealPosts(
  targetPanel: vscode.WebviewPanel,
  request: SelectionRevealRequest,
  responseFilePath: string,
  resolvedFilePath: string | null,
  selectionRequestId: string
): void {
  const delays = [0, 50, 150];
  let pendingAttempts = delays.length;
  let delivered = false;

  for (const delay of delays) {
    setTimeout(() => {
      if (delivered) {
        return;
      }

      try {
        const postResult = targetPanel.webview.postMessage({
          type: 'scrollAndSelect',
          request_id: selectionRequestId,
          original: request.original,
          context_before: request.context_before,
          context_after: request.context_after,
          headings_before: request.headings_before ?? null,
        });

        void Promise.resolve(postResult)
          .then(result => {
            if (result !== false) {
              delivered = true;
              return;
            }

            pendingAttempts -= 1;
            if (pendingAttempts === 0) {
              writeSelectionRevealResponse(
                {
                  selection_request_id: selectionRequestId,
                  id: selectionRequestId,
                  status: 'error',
                  error: 'Markdown for Humans did not accept the reveal request message.',
                  file: request.file ?? resolvedFilePath,
                },
                responseFilePath
              );
            }
          })
          .catch(error => {
            pendingAttempts -= 1;
            if (pendingAttempts === 0) {
              writeSelectionRevealResponse(
                {
                  selection_request_id: selectionRequestId,
                  id: selectionRequestId,
                  status: 'error',
                  error: `Failed to deliver reveal request to the Markdown for Humans webview: ${String(error)}`,
                  file: request.file ?? resolvedFilePath,
                },
                responseFilePath
              );
            }
          });
      } catch (error) {
        pendingAttempts -= 1;
        if (pendingAttempts === 0) {
          writeSelectionRevealResponse(
            {
              selection_request_id: selectionRequestId,
              id: selectionRequestId,
              status: 'error',
              error: `Failed to deliver reveal request to the Markdown for Humans webview: ${String(error)}`,
              file: request.file ?? resolvedFilePath,
            },
            responseFilePath
          );
        }
      }
    }, delay);
  }
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
    selection_request_id: string;
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
    console.warn(`${BUILD_TAG} Failed to write selection reveal response temp file:`, error);
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
      const selectionRequestId = getSelectionRevealRequestId(data);
      if (!selectionRequestId || selectionRequestId === lastId) return;
      if (!shouldHandleSelectionRevealRequest(data)) return;
      if (!consumePendingSelectionRevealRequest(selectionRequestId)) return;
      lastId = selectionRequestId;
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
      `${BUILD_TAG} selectionRevealWatcher: fs.watch unavailable, changes will not be detected automatically`,
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
