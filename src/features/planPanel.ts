/**
 * Copyright (c) 2025-2026 Concret.io
 *
 * Licensed under the MIT License. See LICENSE file in the project root for details.
 *
 * PlanPanel manages plan review sessions. Unlike ProposalPanel (which creates a
 * separate VS Code webview panel), PlanPanel injects an overlay into the existing
 * editor webview via postMessage. The overlay lets the user review proposed changes
 * with reasoning and provide per-range comments without modifying the document.
 */

declare const __BUILD_TIME__: string;
const BUILD_TAG = `[MD4H ${__BUILD_TIME__}]`;

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { PLAN_STATE_DIR, PLAN_RESPONSE_TEMP_FILE } from '../editor/MarkdownEditorProvider';
import {
  getOpenWebviewForDocument,
} from '../activeWebview';

const PLAN_INTERNAL_ERROR = 'The plan review could not be started due to an internal error. Please ensure the file is open in Markdown for Humans and try again.';
const PLAN_FILE_NOT_FOUND_ERROR = 'The target file is not open in Markdown for Humans. Please open it and try again.';
const PLAN_PENDING_HANDOFF_MS = 110_000;

// --- Public interfaces ---

export interface PlanRange {
  start: number;
  end: number;
}

export interface PlanReplacement {
  range: PlanRange;
  proposed_change: string;
}

export interface PlanRequest {
  id: string;
  file?: string | null;
  source_instance_id?: string | null;
  proposed_replacements: PlanReplacement[];
}

export interface PlanResult {
  status: 'commented' | 'no_response' | 'skipped' | 'accepted' | 'rejected';
  range: PlanRange;
  proposed_change: string;
  user_comment: string | null;
}

// --- Internal interfaces ---

interface PlanStatePayload {
  id: string;
  file: string | null;
  status: string;
  message?: string;
  error_type?: string | null;
  error?: string | null;
  sequential_replacement_plan_session_id?: string;
  progress?: {
    current: number;
    total: number;
  };
  results?: PlanResult[];
}

// --- PlanPanel class ---

export class PlanPanel {
  static currentPanel: PlanPanel | undefined;

  private _requestId: string;
  private _file: string | null;
  private _replacements: PlanReplacement[];
  private _results: PlanResult[];
  private _sourcePanel: vscode.WebviewPanel | undefined;
  private _hasPendingHandoff: boolean;
  private _pendingTimer: ReturnType<typeof setTimeout> | undefined;
  private _disposed: boolean;

  private constructor(
    request: PlanRequest,
    sourcePanel: vscode.WebviewPanel
  ) {
    this._requestId = request.id;
    this._file = request.file ?? null;
    this._replacements = request.proposed_replacements;
    this._results = [];
    this._sourcePanel = sourcePanel;
    this._hasPendingHandoff = false;
    this._disposed = false;

    PlanPanel.currentPanel = this;

    // Set context for keybindings
    vscode.commands.executeCommand('setContext', 'markdownForHumans.planOverlayActive', true);

    this._clearPlanState();

    // Send planInit to the editor webview
    sourcePanel.webview.postMessage({
      type: 'planInit',
      id: this._requestId,
      file: this._file,
      proposed_replacements: this._replacements,
    });

    // Start pending handoff timer
    this._pendingTimer = setTimeout(() => {
      this._handlePendingHandoff();
    }, PLAN_PENDING_HANDOFF_MS);
  }

  static show(context: vscode.ExtensionContext, request: PlanRequest) {
    try {
      if (!request.file) {
        PlanPanel._writeImmediateError(
          request,
          'plan_internal_error',
          PLAN_INTERNAL_ERROR
        );
        return;
      }

      const webviewInfo = getOpenWebviewForDocument(request.file);
      if (!webviewInfo) {
        PlanPanel._writeImmediateError(
          request,
          'plan_file_not_found',
          PLAN_FILE_NOT_FOUND_ERROR
        );
        return;
      }

      if (PlanPanel.currentPanel) {
        PlanPanel.currentPanel.dispose();
      }

      const panel = new PlanPanel(request, webviewInfo.panel);

      // Listen for messages from the editor webview
      const messageHandler = webviewInfo.panel.webview.onDidReceiveMessage(
        msg => panel._handleMessage(msg)
      );

      // Listen for panel disposal
      const disposeHandler = webviewInfo.panel.onDidDispose(() => {
        panel.dispose();
      });

      context.subscriptions.push(messageHandler, disposeHandler);
    } catch (err) {
      console.warn(`${BUILD_TAG} Failed to open plan review:`, err);
      PlanPanel._writeImmediateError(
        request,
        'plan_internal_error',
        PLAN_INTERNAL_ERROR
      );
    }
  }

  private _handleMessage(msg: any) {
    if (this._disposed) return;

    if (msg.type === 'planReady') {
      this._writePlanState(this._buildReadyPayload());
      return;
    }

    if (msg.type === 'planResponse') {
      // Full submission from the overlay
      const results = msg.results as PlanResult[];
      this._results = results;

      if (this._pendingTimer) {
        clearTimeout(this._pendingTimer);
        this._pendingTimer = undefined;
      }

      try {
        const payload = this._buildResponsePayload('completed');
        this._writeResponsePayload(payload);
        this._writePlanState(payload);
      } catch (err) {
        console.warn(`${BUILD_TAG} Failed to write plan response:`, err);
      }

      this.dispose();
      return;
    }

    if (msg.type === 'planSkipAll') {
      // Mark all replacements as skipped
      this._results = this._replacements.map(r => ({
        status: 'skipped' as const,
        range: r.range,
        proposed_change: r.proposed_change,
        user_comment: null,
      }));

      if (this._pendingTimer) {
        clearTimeout(this._pendingTimer);
        this._pendingTimer = undefined;
      }

      try {
        const payload = this._buildResponsePayload('completed');
        this._writeResponsePayload(payload);
        this._writePlanState(payload);
      } catch (err) {
        console.warn(`${BUILD_TAG} Failed to write plan skip-all response:`, err);
      }

      this.dispose();
      return;
    }

    if (msg.type === 'planPending') {
      this._handlePendingHandoff();
      return;
    }
  }

  private _handlePendingHandoff() {
    if (this._hasPendingHandoff || this._disposed) return;

    this._hasPendingHandoff = true;
    const payload = this._buildPendingPayload();

    try {
      this._writeResponsePayload(payload);
      this._writePlanState(payload);
    } catch (err) {
      console.warn(`${BUILD_TAG} Failed to write pending plan state:`, err);
    }
  }

  private _buildResponsePayload(finalStatus: string): PlanStatePayload {
    return {
      id: this._requestId,
      file: this._file,
      status: finalStatus,
      results: this._results,
    };
  }

  private _buildPendingPayload(): PlanStatePayload {
    return {
      id: this._requestId,
      file: this._file,
      status: 'pending',
      message: 'The plan review is still open in Markdown for Humans. Finish reviewing there, then in the conversation type "resume".',
      sequential_replacement_plan_session_id: this._requestId,
      progress: {
        current: this._results.length,
        total: this._replacements.length,
      },
      results: this._results,
    };
  }

  private _buildReadyPayload(): PlanStatePayload {
    return {
      id: this._requestId,
      file: this._file,
      status: 'ready',
    };
  }

  private _writeResponsePayload(payload: object) {
    fs.mkdirSync(path.dirname(PLAN_RESPONSE_TEMP_FILE), { recursive: true });
    fs.writeFileSync(PLAN_RESPONSE_TEMP_FILE, JSON.stringify(payload, null, 2), 'utf8');
  }

  private _writePlanState(payload: PlanStatePayload) {
    try {
      fs.mkdirSync(PLAN_STATE_DIR, { recursive: true });
      fs.writeFileSync(
        PlanPanel._getPlanStateFilePath(this._requestId),
        JSON.stringify(payload, null, 2),
        'utf8'
      );
    } catch (err) {
      console.warn(`${BUILD_TAG} Failed to write plan state file:`, err);
    }
  }

  private _clearPlanState() {
    try {
      const filePath = PlanPanel._getPlanStateFilePath(this._requestId);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch {
      // ignore
    }
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;

    if (this._pendingTimer) {
      clearTimeout(this._pendingTimer);
      this._pendingTimer = undefined;
    }

    // Clear context for keybindings
    vscode.commands.executeCommand('setContext', 'markdownForHumans.planOverlayActive', false);

    // Tell the editor webview to destroy the overlay
    if (this._sourcePanel) {
      try {
        this._sourcePanel.webview.postMessage({ type: 'planDestroy' });
      } catch {
        // Panel may already be disposed
      }
    }

    PlanPanel.currentPanel = undefined;
  }

  static _getPlanStateFilePath(id: string): string {
    return path.join(PLAN_STATE_DIR, `${id}.json`);
  }

  private static _writeImmediateError(
    request: PlanRequest,
    errorType: string,
    error: string
  ) {
    const payload: PlanStatePayload = {
      id: request.id,
      file: request.file ?? null,
      status: 'error',
      message: error,
      error_type: errorType,
      error,
    };

    try {
      fs.mkdirSync(path.dirname(PLAN_RESPONSE_TEMP_FILE), { recursive: true });
      fs.writeFileSync(PLAN_RESPONSE_TEMP_FILE, JSON.stringify(payload, null, 2), 'utf8');
    } catch (err) {
      console.warn(`${BUILD_TAG} Failed to write immediate plan response:`, err);
    }

    try {
      fs.mkdirSync(PLAN_STATE_DIR, { recursive: true });
      fs.writeFileSync(
        PlanPanel._getPlanStateFilePath(request.id),
        JSON.stringify(payload, null, 2),
        'utf8'
      );
    } catch (err) {
      console.warn(`${BUILD_TAG} Failed to write immediate plan state:`, err);
    }
  }
}
