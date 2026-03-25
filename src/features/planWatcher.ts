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
  hasOpenWebviewForDocument,
} from '../activeWebview';
import { PLAN_TEMP_FILE } from '../editor/MarkdownEditorProvider';
import { PlanPanel, PlanRequest } from './planPanel';

export function readPendingPlan(
  planFilePath: string = PLAN_TEMP_FILE
): PlanRequest | null {
  if (!fs.existsSync(planFilePath)) return null;

  const data = JSON.parse(fs.readFileSync(planFilePath, 'utf8')) as PlanRequest;
  if (!data.id) return null;
  if (!Array.isArray(data.proposed_replacements) || data.proposed_replacements.length === 0) {
    return null;
  }

  return data;
}

export function consumePendingPlan(
  planId: string,
  planFilePath: string = PLAN_TEMP_FILE
): boolean {
  if (!fs.existsSync(planFilePath)) {
    return false;
  }

  try {
    const data = JSON.parse(fs.readFileSync(planFilePath, 'utf8')) as PlanRequest;
    if (data.id !== planId) {
      return false;
    }
    fs.unlinkSync(planFilePath);
    return true;
  } catch {
    return false;
  }
}

export function shouldHandlePlan(plan: PlanRequest): boolean {
  const instanceMatch =
    !plan.source_instance_id || plan.source_instance_id === getEditorHostInstanceId();

  if (!instanceMatch) {
    return false;
  }

  if (plan.file) {
    return hasOpenWebviewForDocument(plan.file);
  }

  // Without a file, we can't route the plan to a specific editor
  return false;
}

/**
 * Watch for incoming plan review requests written by the MCP server.
 * When a new plan appears (new id), opens the PlanPanel overlay.
 */
export function startPlanWatcher(context: vscode.ExtensionContext): vscode.Disposable {
  let lastId: string | null = null;

  const check = () => {
    try {
      const data = readPendingPlan();
      if (!data) return;
      if (!data.id || data.id === lastId) return;
      if (!shouldHandlePlan(data)) return;
      if (!consumePendingPlan(data.id)) return;
      lastId = data.id;
      PlanPanel.show(context, data);
    } catch {
      // Ignore parse errors (file may be mid-write)
    }
  };

  let watcher: fs.FSWatcher | undefined;
  try {
    watcher = fs.watch(path.dirname(PLAN_TEMP_FILE), (_event, filename) => {
      if (filename && filename.includes('Plan')) check();
    });
  } catch (err) {
    console.warn(`${BUILD_TAG} planWatcher: fs.watch unavailable, changes will not be detected automatically`, err);
  }

  check(); // Check on startup in case a plan was written before extension activated

  return new vscode.Disposable(() => {
    try { watcher?.close(); } catch {}
  });
}
