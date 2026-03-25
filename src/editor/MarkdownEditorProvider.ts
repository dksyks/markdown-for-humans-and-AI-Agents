/**
 * Copyright (c) 2025-2026 Concret.io
 *
 * Licensed under the MIT License. See LICENSE file in the project root for details.
 */

declare const __BUILD_TIME__: string;
const BUILD_TAG = `[MD4H ${__BUILD_TIME__}]`;
const SOURCE_SELECTION_SYNC_DEBUG_LOGS = true;

import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { outlineViewProvider } from '../features/outlineView';
import {
  getActiveDocument,
  getActiveWebviewPanel,
  getEditorHostInstanceId,
  markWebviewPanelActive,
  registerWebviewPanel,
  setActiveWebviewPanel,
  unregisterWebviewPanel,
} from '../activeWebview';
import { buildResizeBackupLocation, resolveBackupPathWithCollisionDetection } from './imageBackups';

export const PROPOSAL_TEMP_FILE = path.join(os.tmpdir(), 'MarkdownForHumans-Proposal.json');
export const PLAN_TEMP_FILE = path.join(os.tmpdir(), 'MarkdownForHumans-Plan.json');
export const SELECTION_REVEAL_TEMP_FILE = path.join(
  os.tmpdir(),
  'MarkdownForHumans-SelectionReveal.json'
);
export const ACTIVE_INSTANCE_TEMP_FILE = path.join(
  os.tmpdir(),
  'MarkdownForHumans-ActiveInstance.json'
);
export const INSTANCE_TEMP_DIR_PREFIX = 'MarkdownForHumans-';

interface SourceViewportAnchor {
  activeLine: number;
  selectionStartLine: number;
  selectionEndLine: number;
  visibleStartLine: number;
  visibleEndLine: number;
  visibleLineCount: number;
  viewportRatio: number;
  selectionIsEmpty: boolean;
}

interface SourceResizeSessionState {
  active: boolean;
  anchor: SourceViewportAnchor | null;
  timeoutId: ReturnType<typeof setTimeout> | null;
  applying: boolean;
  lastRequestId: string | null;
  lastPhase: string | null;
  requestedLine: number | null;
  requestedViewportRatio: number | null;
}

export interface SourceSelectionSyncPayload {
  type: 'syncFromSourceSelection';
  activeLine: number;
  startLine: number;
  endLine: number;
  isEmpty: boolean;
  viewportRatio?: number | null;
}

interface SyncSourceSelectionMessage {
  type: 'syncSourceSelection';
  activeLine: number;
  startLine: number;
  endLine: number;
  isEmpty: boolean;
  viewportRatio?: number | null;
  requestId?: string | null;
  reason?: string | null;
}

function getInclusiveSourceSelectionEndLine(selection: vscode.Selection): number {
  if (selection.isEmpty) {
    return selection.end.line;
  }

  if (selection.end.character === 0 && selection.end.line > selection.start.line) {
    return selection.end.line - 1;
  }

  return selection.end.line;
}

export function getEffectiveSourceSelectionLine(selection: vscode.Selection): number {
  if (selection.isEmpty) {
    return selection.active.line;
  }

  if (selection.end.character === 0 && selection.end.line > selection.start.line) {
    return selection.end.line - 1;
  }

  return selection.active.line;
}

export function buildSourceSelectionSyncPayload(
  selection: vscode.Selection,
  viewportRatio: number | null = null
): SourceSelectionSyncPayload {
  return {
    type: 'syncFromSourceSelection',
    activeLine: getEffectiveSourceSelectionLine(selection) + 1,
    startLine: selection.start.line + 1,
    endLine: getInclusiveSourceSelectionEndLine(selection) + 1,
    isEmpty: selection.isEmpty,
    viewportRatio,
  };
}

function logSourceSelectionSync(message: string, data?: unknown): void {
  if (!SOURCE_SELECTION_SYNC_DEBUG_LOGS) {
    return;
  }
  if (data === undefined) {
    console.log(`${BUILD_TAG} [source->MFH] ${message}`);
    return;
  }
  console.log(`${BUILD_TAG} [source->MFH] ${message}`, data);
}

function getDocumentPathLike(document: vscode.TextDocument): string {
  const uriFsPath = (document.uri as { fsPath?: unknown }).fsPath;
  if (typeof uriFsPath === 'string' && uriFsPath.length > 0) {
    return uriFsPath;
  }

  if (typeof document.fileName === 'string' && document.fileName.length > 0) {
    return document.fileName;
  }

  const uriPath = (document.uri as { path?: unknown }).path;
  if (typeof uriPath === 'string' && uriPath.length > 0) {
    return uriPath;
  }

  const uriString = document.uri.toString();
  const normalizedUri = uriString.replace(/^[a-z]+:(\/\/)?/i, '');
  return normalizedUri || 'document';
}

function getDocumentDisplayName(document: vscode.TextDocument): string {
  if (document.uri.scheme === 'untitled') {
    return 'Untitled';
  }

  return path.basename(getDocumentPathLike(document)) || 'document';
}

function createNoopDisposable(): vscode.Disposable {
  return { dispose() {} } as vscode.Disposable;
}

export function getInstanceTempDir(instanceId: string = getEditorHostInstanceId()): string {
  return path.join(os.tmpdir(), `${INSTANCE_TEMP_DIR_PREFIX}${instanceId}`);
}

export const SELECTION_TEMP_FILE = getSelectionTempFilePath();
export const RESPONSE_TEMP_FILE = getResponseTempFilePath();
export const PROPOSAL_STATE_DIR = getProposalStateDir();
export const PLAN_RESPONSE_TEMP_FILE = getPlanResponseTempFilePath();
export const PLAN_STATE_DIR = getPlanStateDir();
export const SELECTION_REVEAL_RESPONSE_TEMP_FILE = getSelectionRevealResponseTempFilePath();

export function getSelectionTempFilePath(instanceId: string = getEditorHostInstanceId()): string {
  return path.join(getInstanceTempDir(instanceId), 'Selection.json');
}

function encodeSelectionFilePath(documentPath: string): string {
  return crypto.createHash('sha256').update(documentPath, 'utf8').digest('hex').slice(0, 32);
}

export function getSelectionStateFilePathForDocument(
  documentPath: string,
  instanceId: string = getEditorHostInstanceId()
): string {
  return path.join(
    getInstanceTempDir(instanceId),
    `Selection-${encodeSelectionFilePath(documentPath)}.json`
  );
}

export function getResponseTempFilePath(instanceId: string = getEditorHostInstanceId()): string {
  return path.join(getInstanceTempDir(instanceId), 'Response.json');
}

export function getProposalStateDir(instanceId: string = getEditorHostInstanceId()): string {
  return path.join(getInstanceTempDir(instanceId), 'ProposalState');
}

export function getPlanResponseTempFilePath(instanceId: string = getEditorHostInstanceId()): string {
  return path.join(getInstanceTempDir(instanceId), 'PlanResponse.json');
}

export function getPlanStateDir(instanceId: string = getEditorHostInstanceId()): string {
  return path.join(getInstanceTempDir(instanceId), 'PlanState');
}

export function getSelectionRevealResponseTempFilePath(
  instanceId: string = getEditorHostInstanceId()
): string {
  return path.join(getInstanceTempDir(instanceId), 'SelectionRevealResponse.json');
}

function ensureInstanceTempDir(instanceId: string = getEditorHostInstanceId()): string {
  const dir = getInstanceTempDir(instanceId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeSelectionToTempFile(data: object): void {
  try {
    ensureInstanceTempDir();
    fs.writeFileSync(getSelectionTempFilePath(), JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.warn(`${BUILD_TAG} Failed to write selection temp file:`, err);
  }
}

function writeSelectionStateForDocument(documentPath: string, data: object): void {
  try {
    ensureInstanceTempDir();
    fs.writeFileSync(
      getSelectionStateFilePathForDocument(documentPath),
      JSON.stringify(data, null, 2),
      'utf8'
    );
  } catch (err) {
    console.warn(`${BUILD_TAG} Failed to write selection state file for ${documentPath}:`, err);
  }
}

function buildSelectionPayload(
  documentPath: string,
  message: {
    type?: unknown;
    selected?: unknown;
    context_before?: unknown;
    context_after?: unknown;
    headings_before?: unknown;
  }
): {
  instance_id: string;
  file: string;
  selected: string | null;
  context_before: string | null;
  context_after: string | null;
  headings_before: string[];
} {
  return {
    instance_id: getEditorHostInstanceId(),
    file: documentPath,
    selected: (message.selected as string | null | undefined) ?? null,
    context_before: (message.context_before as string | null | undefined) ?? null,
    context_after: (message.context_after as string | null | undefined) ?? null,
    headings_before: Array.isArray(message.headings_before)
      ? (message.headings_before as string[])
      : [],
  };
}

function writeSelectionRevealResponse(data: object): void {
  try {
    ensureInstanceTempDir();
    fs.writeFileSync(
      getSelectionRevealResponseTempFilePath(),
      JSON.stringify(data, null, 2),
      'utf8'
    );
  } catch (err) {
    console.warn(`${BUILD_TAG} Failed to write selection reveal response temp file:`, err);
  }
}

function clearFileIfExistsWithDebug(filePath: string, reason: string): void {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`${BUILD_TAG} Removed stale temp file (${reason}): ${filePath}`);
    }
  } catch (err) {
    console.warn(`${BUILD_TAG} Failed to remove stale temp file (${reason}): ${filePath}`, err);
  }
}

function readSelectionTempFile(): {
  instance_id?: string | null;
  file?: string | null;
} | null {
  try {
    const filePath = getSelectionTempFilePath();
    if (!fs.existsSync(filePath)) {
      return null;
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function clearSelectionTempFileIfMatches(documentPath: string): void {
  const selection = readSelectionTempFile();
  if (!selection) {
    return;
  }

  if (
    selection.instance_id === getEditorHostInstanceId() &&
    selection.file === documentPath
  ) {
    clearFileIfExistsWithDebug(getSelectionTempFilePath(), `dispose ${documentPath}`);
  }
}

function clearSelectionStateFileForDocument(documentPath: string): void {
  clearFileIfExistsWithDebug(
    getSelectionStateFilePathForDocument(documentPath),
    `dispose state ${documentPath}`
  );
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: any) {
    return error?.code === 'EPERM';
  }
}

function writeActiveInstanceMetadata(filePath: string | null): void {
  try {
    fs.writeFileSync(
      ACTIVE_INSTANCE_TEMP_FILE,
      JSON.stringify(
        {
          instance_id: getEditorHostInstanceId(),
          file: filePath,
          pid: process.pid,
          updated_at: Date.now(),
        },
        null,
        2
      ),
      'utf8'
    );
  } catch (err) {
    console.warn(`${BUILD_TAG} Failed to write active instance temp file:`, err);
  }
}

export function cleanupStaleMcpMetadataOnActivate(): void {
  console.log(`${BUILD_TAG} Checking temp metadata on activate for instance ${getEditorHostInstanceId()}`);
  try {
    for (const entry of fs.readdirSync(os.tmpdir(), { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith(INSTANCE_TEMP_DIR_PREFIX)) {
        continue;
      }

      const instanceId = entry.name.slice(INSTANCE_TEMP_DIR_PREFIX.length);
      const pid = Number.parseInt(instanceId.split('-')[0] ?? '', 10);
      if (Number.isFinite(pid) && !isPidAlive(pid)) {
        const staleDir = path.join(os.tmpdir(), entry.name);
        fs.rmSync(staleDir, { recursive: true, force: true });
        console.log(`${BUILD_TAG} Removed stale instance temp directory: ${staleDir}`);
      }
    }
  } catch {}

  ensureInstanceTempDir();
  writeActiveInstanceMetadata(null);
}

/**
 * Parse an image filename to extract source prefix
 * Returns the source prefix (dropped_ or pasted_) if present, or null
 */
export function parseImageSourcePrefix(filename: string): string | null {
  // Check for source prefix: dropped_ or pasted_
  const sourcePattern = /^(dropped_|pasted_)/;
  const match = filename.match(sourcePattern);
  return match ? match[1] : null;
}

/**
 * Build an image filename from components, optionally including a dimensions suffix.
 *
 * Note: manual renames should use `buildImageFilenameForUserRename()` instead so we
 * don't auto-add dimensions or source prefixes based on config.
 *
 * @deprecated Use `buildImageFilenameForUserRename()` for rename and
 *             `updateFilenameDimensions()` for resize flows.
 */
export function buildImageFilenameForRename(
  sourcePrefix: string | null,
  name: string,
  dimensions: { width: number; height: number } | null,
  extension: string,
  includeDimensions: boolean
): string {
  const source = sourcePrefix || '';
  if (!includeDimensions || !dimensions) {
    return `${source}${name}.${extension}`;
  }
  return `${source}${name}_${dimensions.width}x${dimensions.height}px.${extension}`;
}

/**
 * Build an image filename for a user-initiated rename.
 *
 * Rules:
 * - Do not auto-add dimensions.
 * - Do not auto-add or preserve a `dropped_`/`pasted_` prefix.
 * - Treat the user-provided name as authoritative.
 *
 * @param userProvidedName - The new name from the rename dialog (without extension)
 * @param extension - File extension (with or without leading dot)
 */
export function buildImageFilenameForUserRename(
  userProvidedName: string,
  extension: string
): string {
  const normalizedExtension = extension.startsWith('.') ? extension.slice(1) : extension;
  const dot = normalizedExtension ? '.' : '';
  return `${userProvidedName}${dot}${normalizedExtension}`;
}

/**
 * Update dimensions in an image filename while preserving other components.
 *
 * When `includeDimensions` is enabled:
 * - Keep any existing `dropped_`/`pasted_` prefix.
 * - Add/update the `{width}x{height}px` suffix (and remove legacy timestamp formats).
 *
 * When `includeDimensions` is disabled:
 * - Strip BOTH the `dropped_`/`pasted_` prefix and the `{width}x{height}px` suffix.
 * - Keep the base name and extension.
 */
export function updateFilenameDimensions(
  filename: string,
  newWidth: number,
  newHeight: number,
  includeDimensions: boolean = true
): string {
  const extWithDot = path.extname(filename);
  const filenameWithoutExt = extWithDot ? filename.slice(0, -extWithDot.length) : filename;

  const sourcePrefix = parseImageSourcePrefix(filename) || '';
  const filenameWithoutPrefix = sourcePrefix
    ? filenameWithoutExt.slice(sourcePrefix.length)
    : filenameWithoutExt;

  // Old pattern with timestamp: {name}_{timestamp}_{width}x{height}px
  const oldTimestampMatch = filenameWithoutPrefix.match(/^(.+?)_\d{13}_(\d+)x(\d+)px$/);
  if (oldTimestampMatch) {
    const coreName = oldTimestampMatch[1];
    if (!includeDimensions) {
      return `${coreName}${extWithDot}`;
    }
    return `${sourcePrefix}${coreName}_${newWidth}x${newHeight}px${extWithDot}`;
  }

  // New pattern (no timestamp): {name}_{width}x{height}px
  const newPatternMatch = filenameWithoutPrefix.match(/^(.+?)_(\d+)x(\d+)px$/);
  if (newPatternMatch) {
    const coreName = newPatternMatch[1];
    if (!includeDimensions) {
      return `${coreName}${extWithDot}`;
    }
    return `${sourcePrefix}${coreName}_${newWidth}x${newHeight}px${extWithDot}`;
  }

  // Legacy format without dimensions: {name}-{timestamp}
  const legacyMatch = filenameWithoutPrefix.match(/^(.+?)-\d{13}$/);
  if (legacyMatch) {
    const coreName = legacyMatch[1];
    if (!includeDimensions) {
      return `${coreName}${extWithDot}`;
    }
    return `${sourcePrefix}${coreName}_${newWidth}x${newHeight}px${extWithDot}`;
  }

  // Unparseable filename.
  // If dimensions are disabled, still strip any existing source prefix and keep the name.
  if (!includeDimensions) {
    return `${filenameWithoutPrefix}${extWithDot}`;
  }

  // Append dimensions to filename when enabled.
  return `${sourcePrefix}${filenameWithoutPrefix}_${newWidth}x${newHeight}px${extWithDot}`;
}

/**
 * Custom Text Editor Provider for Markdown files
 * Provides WYSIWYG editing using TipTap in a webview
 */
export class MarkdownEditorProvider implements vscode.CustomTextEditorProvider {
  // Track pending edits to avoid feedback loops
  // Key: document URI, Value: timestamp of last edit from webview
  private pendingEdits = new Map<string, number>();
  // Remember last content sent from the webview so we can skip redundant updates
  private lastWebviewContent = new Map<string, string>();
  // Pending resolve for getSelection requests
  private pendingSelectionResolve: ((result: string) => void) | undefined;
  // Loop guard for bidirectional source sync
  _isSyncFromWebview = false;
  private pendingSourceAlignmentTimers = new Map<string, Array<ReturnType<typeof setTimeout>>>();
  private latestSourceSyncContext = new Map<string, Record<string, unknown>>();
  private sourceResizeSessions = new Map<string, SourceResizeSessionState>();
  private pendingSourceOpenSync = new Set<string>();

  public static register(context: vscode.ExtensionContext): { disposable: vscode.Disposable; provider: MarkdownEditorProvider } {
    const provider = new MarkdownEditorProvider(context);
    const disposable = vscode.window.registerCustomEditorProvider(
      'markdownForHumans.editor',
      provider,
      {
        webviewOptions: {
          retainContextWhenHidden: true,
          enableFindWidget: true,
        },
        supportsMultipleEditorsPerDocument: false,
      }
    );
    return { disposable, provider };
  }

  constructor(private readonly context: vscode.ExtensionContext) {}

  private getSourceEditor(document: vscode.TextDocument): vscode.TextEditor | undefined {
    return vscode.window.visibleTextEditors.find(
      ed => ed.document.uri.toString() === document.uri.toString()
    );
  }

  private clearPendingSourceAlignmentTimers(documentUri: string): void {
    const timers = this.pendingSourceAlignmentTimers.get(documentUri);
    if (!timers) {
      return;
    }

    timers.forEach(timer => clearTimeout(timer));
    this.pendingSourceAlignmentTimers.delete(documentUri);
  }

  private getSourceResizeSession(documentUri: string): SourceResizeSessionState {
    const existing = this.sourceResizeSessions.get(documentUri);
    if (existing) {
      return existing;
    }

    const created: SourceResizeSessionState = {
      active: false,
      anchor: null,
      timeoutId: null,
      applying: false,
      lastRequestId: null,
      lastPhase: null,
      requestedLine: null,
      requestedViewportRatio: null,
    };
    this.sourceResizeSessions.set(documentUri, created);
    return created;
  }

  private clearSourceResizeSession(documentUri: string, _reason: string): void {
    const session = this.sourceResizeSessions.get(documentUri);
    if (!session) {
      return;
    }

    if (session.timeoutId !== null) {
      clearTimeout(session.timeoutId);
      session.timeoutId = null;
    }

    session.active = false;
    session.applying = false;
    session.lastRequestId = null;
    session.lastPhase = null;
    session.requestedLine = null;
    session.requestedViewportRatio = null;
  }

  private captureSourceViewportAnchor(sourceEditor: vscode.TextEditor): SourceViewportAnchor | null {
    const primaryVisibleRange = sourceEditor.visibleRanges[0];
    if (!primaryVisibleRange) {
      return null;
    }

    const selection = sourceEditor.selection;
    const visibleStartLine = primaryVisibleRange.start.line;
    const visibleEndLine = primaryVisibleRange.end.line;
    const visibleLineCount = Math.max(1, visibleEndLine - visibleStartLine);
    const activeLine = getEffectiveSourceSelectionLine(selection);
    const viewportRatio = Math.min(
      1,
      Math.max(0, (activeLine - visibleStartLine) / visibleLineCount)
    );

    return {
      activeLine,
      selectionStartLine: selection.start.line,
      selectionEndLine: selection.end.line,
      visibleStartLine,
      visibleEndLine,
      visibleLineCount,
      viewportRatio,
      selectionIsEmpty: selection.isEmpty,
    };
  }

  private noteSourceViewportAnchor(
    documentUri: string,
    sourceEditor: vscode.TextEditor,
    _reason: string
  ): void {
    const session = this.getSourceResizeSession(documentUri);
    const anchor = this.captureSourceViewportAnchor(sourceEditor);
    if (!anchor) {
      return;
    }

    session.anchor = anchor;
  }

  private computeCurrentSourceViewportRatio(
    sourceEditor: vscode.TextEditor
  ): { ratio: number; visibleLineCount: number } | null {
    const primaryVisibleRange = sourceEditor.visibleRanges[0];
    if (!primaryVisibleRange) {
      return null;
    }

    const visibleLineCount = Math.max(1, primaryVisibleRange.end.line - primaryVisibleRange.start.line);
    const effectiveLine = getEffectiveSourceSelectionLine(sourceEditor.selection);
    const ratio = Math.min(
      1,
      Math.max(0, (effectiveLine - primaryVisibleRange.start.line) / visibleLineCount)
    );

    return { ratio, visibleLineCount };
  }

  private fineTuneSourceViewportWithWrappedScroll(
    sourceEditor: vscode.TextEditor,
    targetViewportRatio: number | null
  ): void {
    if (typeof targetViewportRatio !== 'number' || !Number.isFinite(targetViewportRatio)) {
      return;
    }

    if (vscode.window.activeTextEditor !== sourceEditor) {
      return;
    }

    const currentViewport = this.computeCurrentSourceViewportRatio(sourceEditor);
    if (!currentViewport) {
      return;
    }

    const deltaRatio = currentViewport.ratio - targetViewportRatio;
    const scrollValue = Math.min(
      12,
      Math.max(0, Math.round(Math.abs(deltaRatio) * currentViewport.visibleLineCount))
    );

    if (scrollValue < 1) {
      return;
    }

    void vscode.commands.executeCommand('editorScroll', {
      to: deltaRatio > 0 ? 'down' : 'up',
      by: 'wrappedLine',
      value: scrollValue,
      revealCursor: false,
    });
  }

  private revealSourceTopLineWithCorrection(
    sourceEditor: vscode.TextEditor,
    targetTopLine: number,
    context: {
      documentUri: string;
      requestId: string | null;
      reason: string | null;
      trigger: string;
      targetSelectionLine?: number | null;
      targetViewportRatio?: number | null;
      onSettled?: (finalTopLine: number | null) => void;
    }
  ): void {
    const clampedInitialTopLine = Math.max(
      0,
      Math.min(sourceEditor.document.lineCount - 1, targetTopLine)
    );

    const applyReveal = (requestedTopLine: number, remainingCorrections: number): void => {
      const clampedRequestedTopLine = Math.max(
        0,
        Math.min(sourceEditor.document.lineCount - 1, requestedTopLine)
      );
      const topPos = new vscode.Position(clampedRequestedTopLine, 0);
      sourceEditor.revealRange(
        new vscode.Range(topPos, topPos),
        vscode.TextEditorRevealType.AtTop
      );

      setTimeout(() => {
        const primaryVisibleRange = sourceEditor.visibleRanges[0];
        const actualTopLine = primaryVisibleRange?.start.line ?? null;
        const actualVisibleLineCount = primaryVisibleRange
          ? Math.max(1, primaryVisibleRange.end.line - primaryVisibleRange.start.line)
          : null;
        if (
          remainingCorrections > 0 &&
          actualTopLine !== null &&
          actualTopLine !== clampedRequestedTopLine
        ) {
          let correctedTopLine: number | null = null;

          if (
            typeof context.targetSelectionLine === 'number' &&
            Number.isFinite(context.targetSelectionLine) &&
            typeof context.targetViewportRatio === 'number' &&
            Number.isFinite(context.targetViewportRatio) &&
            actualVisibleLineCount !== null
          ) {
            const recomputedTopLine = Math.max(
              0,
              Math.min(
                sourceEditor.document.lineCount - 1,
                context.targetSelectionLine -
                  Math.round(context.targetViewportRatio * actualVisibleLineCount)
              )
            );

            if (recomputedTopLine !== actualTopLine) {
              correctedTopLine = recomputedTopLine;
            }
          }

          if (
            correctedTopLine === null ||
            correctedTopLine === clampedRequestedTopLine
          ) {
            const correctionDelta = clampedRequestedTopLine - actualTopLine;
            const deltaCorrectedTopLine = Math.max(
              0,
              Math.min(sourceEditor.document.lineCount - 1, clampedRequestedTopLine + correctionDelta)
            );

            if (deltaCorrectedTopLine !== clampedRequestedTopLine) {
              correctedTopLine = deltaCorrectedTopLine;
            }
          }

          if (correctedTopLine !== null && correctedTopLine !== clampedRequestedTopLine) {
            applyReveal(correctedTopLine, remainingCorrections - 1);
            return;
          }
        }

        context.onSettled?.(actualTopLine);
      }, 30);
    };

    applyReveal(clampedInitialTopLine, 1);
  }

  private applySourceResizePreservation(
    document: vscode.TextDocument,
    sourceEditor: vscode.TextEditor,
    trigger: string
  ): void {
    const documentUri = document.uri.toString();
    const session = this.getSourceResizeSession(documentUri);
    if (session.applying) {
      return;
    }

    const primaryVisibleRange = sourceEditor.visibleRanges[0];
    if (!primaryVisibleRange) {
      return;
    }

    if (
      typeof session.requestedLine !== 'number' ||
      !Number.isFinite(session.requestedLine) ||
      typeof session.requestedViewportRatio !== 'number' ||
      !Number.isFinite(session.requestedViewportRatio)
    ) {
      return;
    }

    const targetViewportRatio = session.requestedViewportRatio;
    const targetSelectionLine = Math.max(
      0,
      Math.min(sourceEditor.document.lineCount - 1, session.requestedLine - 1)
    );
    const currentVisibleLineCount = Math.max(1, primaryVisibleRange.end.line - primaryVisibleRange.start.line);
    const desiredTopLine = Math.max(
      0,
      Math.min(
        sourceEditor.document.lineCount - 1,
        targetSelectionLine - Math.round(targetViewportRatio * currentVisibleLineCount)
      )
    );
    const currentTopLine = primaryVisibleRange.start.line;

    if (currentTopLine === desiredTopLine) {
      return;
    }

    session.applying = true;
    this.revealSourceTopLineWithCorrection(sourceEditor, desiredTopLine, {
      documentUri,
      requestId: session.lastRequestId,
      reason: session.lastPhase,
      trigger,
      targetSelectionLine,
      targetViewportRatio,
      onSettled: () => {
        session.applying = false;
        this.noteSourceViewportAnchor(documentUri, sourceEditor, `${trigger}:postApply`);
      },
    });
  }

  private handleSourceResizeSessionMessage(
    document: vscode.TextDocument,
    requestId: string | null,
    phase: 'start' | 'extend' | 'settled',
    line: number | null,
    viewportRatio: number | null
  ): void {
    const documentUri = document.uri.toString();
    const session = this.getSourceResizeSession(documentUri);
    const sourceEditor = this.getSourceEditor(document);

    if (!sourceEditor) {
      return;
    }

    if (this.pendingSourceOpenSync.has(documentUri)) {
      return;
    }

    session.lastRequestId = requestId;
    session.lastPhase = phase;
    if (typeof line === 'number') {
      session.requestedLine = line;
    }
    if (typeof viewportRatio === 'number' && Number.isFinite(viewportRatio)) {
      session.requestedViewportRatio = viewportRatio;
    }

    if (phase !== 'settled') {
      return;
    }

    if (session.timeoutId !== null) {
      clearTimeout(session.timeoutId);
    }
    session.timeoutId = setTimeout(() => {
      session.timeoutId = null;
      const latestSourceEditor = this.getSourceEditor(document);
      if (!latestSourceEditor) {
        return;
      }
      this.applySourceResizePreservation(document, latestSourceEditor, 'sourceResizeSession:debounced');
    }, 120);
  }

  private computeSourceRevealTopLine(
    sourceEditor: vscode.TextEditor,
    line: number,
    viewportRatio: number | null
  ): number | null {
    if (typeof viewportRatio !== 'number' || !Number.isFinite(viewportRatio)) {
      return null;
    }

    const primaryVisibleRange = sourceEditor.visibleRanges[0];
    if (!primaryVisibleRange) {
      return null;
    }

    const visibleLineCount = Math.max(1, primaryVisibleRange.end.line - primaryVisibleRange.start.line);
    const clampedRatio = Math.min(1, Math.max(0, viewportRatio));
    const desiredLineOffset = Math.round(clampedRatio * visibleLineCount);
    const targetTopLine = (line - 1) - desiredLineOffset;

    return Math.max(0, Math.min(sourceEditor.document.lineCount - 1, targetTopLine));
  }

  private buildWholeLineSourceSelection(
    sourceEditor: vscode.TextEditor,
    startLine: number,
    endLine: number
  ): vscode.Selection {
    const clampedStartLine = Math.max(1, Math.min(startLine, sourceEditor.document.lineCount));
    const clampedEndLine = Math.max(
      clampedStartLine,
      Math.min(endLine, sourceEditor.document.lineCount)
    );
    const selectionStart = new vscode.Position(clampedStartLine - 1, 0);

    if (clampedEndLine < sourceEditor.document.lineCount) {
      return new vscode.Selection(new vscode.Position(clampedEndLine, 0), selectionStart);
    }

    const lastLineText = sourceEditor.document.lineAt(clampedEndLine - 1).text;
    return new vscode.Selection(
      new vscode.Position(clampedEndLine - 1, lastLineText.length),
      selectionStart
    );
  }

  private alignSourceEditorViewport(
    sourceEditor: vscode.TextEditor,
    selectionPayload:
      | number
      | {
          activeLine: number;
          startLine: number;
          endLine: number;
          isEmpty: boolean;
        },
    viewportRatio: number | null,
    requestId: string | null,
    reason: string | null,
    passLabel: string
  ): void {
    const normalizedSelection =
      typeof selectionPayload === 'number'
        ? {
            activeLine: selectionPayload,
            startLine: selectionPayload,
            endLine: selectionPayload,
            isEmpty: true,
          }
        : selectionPayload;
    const clampedLine = Math.max(
      1,
      Math.min(normalizedSelection.activeLine, sourceEditor.document.lineCount)
    );
    const clampedStartLine = Math.max(
      1,
      Math.min(normalizedSelection.startLine, sourceEditor.document.lineCount)
    );
    const clampedEndLine = Math.max(
      clampedStartLine,
      Math.min(normalizedSelection.endLine, sourceEditor.document.lineCount)
    );
    sourceEditor.selection = this.buildWholeLineSourceSelection(
      sourceEditor,
      clampedStartLine,
      clampedEndLine
    );

    const targetTopLine = this.computeSourceRevealTopLine(sourceEditor, clampedLine, viewportRatio);
    if (targetTopLine !== null) {
      this.revealSourceTopLineWithCorrection(sourceEditor, targetTopLine, {
        documentUri: sourceEditor.document.uri.toString(),
        requestId,
        reason,
        trigger: `alignSourceEditorViewport:${passLabel}`,
        targetSelectionLine: clampedLine - 1,
        targetViewportRatio: viewportRatio,
        onSettled: () => {
          if (passLabel === '180ms') {
            this.fineTuneSourceViewportWithWrappedScroll(sourceEditor, viewportRatio);
          }
        },
      });
      return;
    }

    sourceEditor.revealRange(
      new vscode.Range(sourceEditor.selection.active, sourceEditor.selection.active),
      vscode.TextEditorRevealType.InCenterIfOutsideViewport
    );
    if (passLabel === '180ms') {
      setTimeout(() => {
        this.fineTuneSourceViewportWithWrappedScroll(sourceEditor, viewportRatio);
      }, 30);
    }
  }

  private scheduleSourceAlignment(
    document: vscode.TextDocument,
    selectionPayload:
      | number
      | {
          activeLine: number;
          startLine: number;
          endLine: number;
          isEmpty: boolean;
        },
    viewportRatio: number | null,
    requestId: string | null,
    reason: string | null
  ): void {
    const documentUri = document.uri.toString();
    this.clearPendingSourceAlignmentTimers(documentUri);
    const normalizedSelection =
      typeof selectionPayload === 'number'
        ? {
            activeLine: selectionPayload,
            startLine: selectionPayload,
            endLine: selectionPayload,
            isEmpty: true,
          }
        : selectionPayload;
    this.latestSourceSyncContext.set(documentUri, {
      requestId,
      reason,
      selectionPayload: normalizedSelection,
      line: normalizedSelection.activeLine,
      viewportRatio,
      receivedAt: Date.now(),
    });
    const delays = [0, 75, 180];
    const timers = delays.map(delay =>
      setTimeout(() => {
        const sourceEditor = this.getSourceEditor(document);
        if (!sourceEditor) {
          return;
        }
        this.alignSourceEditorViewport(
          sourceEditor,
          normalizedSelection,
          viewportRatio,
          requestId,
          reason,
          `${delay}ms`
        );
      }, delay)
    );
    this.pendingSourceAlignmentTimers.set(documentUri, timers);
  }

  /**
   * Get the document directory for file-based documents, or workspace folder for untitled files
   * Returns null if document is untitled and has no workspace
   */
  private getDocumentDirectory(document: vscode.TextDocument): string | null {
    if (document.uri.scheme === 'file') {
      return path.dirname(document.uri.fsPath);
    }
    // For untitled files, getWorkspaceFolder may not work reliably
    // So we check workspaceFolders first, then fall back to getWorkspaceFolder
    if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
      // For untitled files, use the first workspace folder if available
      return vscode.workspace.workspaceFolders[0].uri.fsPath;
    }
    // Fallback: try getWorkspaceFolder (might work in some cases)
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (workspaceFolder) {
      return workspaceFolder.uri.fsPath;
    }
    return null;
  }

  /**
   * Get the workspace folder path that contains the document, when available.
   *
   * For untitled documents, falls back to the first workspace folder.
   */
  private getWorkspaceFolderPath(document: vscode.TextDocument): string | null {
    const direct = vscode.workspace.getWorkspaceFolder(document.uri);
    if (direct) {
      return direct.uri.fsPath;
    }

    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      return null;
    }

    if (document.uri.scheme === 'untitled') {
      return folders[0].uri.fsPath;
    }

    if (document.uri.scheme === 'file') {
      const docPath = document.uri.fsPath;
      const containing = [...folders]
        .sort((a, b) => b.uri.fsPath.length - a.uri.fsPath.length)
        .find(
          folder =>
            docPath === folder.uri.fsPath || docPath.startsWith(folder.uri.fsPath + path.sep)
        );
      return containing?.uri.fsPath ?? null;
    }

    return null;
  }

  /**
   * Get base path for image operations
   * Returns workspace folder or document directory if available, otherwise home directory
   * This enables absolute paths to work even without workspace
   */
  private getImageBasePath(document: vscode.TextDocument): string | null {
    const docDir = this.getDocumentDirectory(document);
    if (docDir) {
      return docDir;
    }
    // For untitled files without workspace, use user's home directory
    // This allows absolute paths to work
    return os.homedir();
  }

  /**
   * Read editor display settings from VS Code configuration.
   */
  private getDisplaySettings(): Record<string, unknown> {
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
      labelOpacity: config.get<number>('markdownForHumans.colors.labelOpacity', 0.10),
      showHeadingGutter: config.get<boolean>('markdownForHumans.showHeadingGutter', true),
      showDocumentLineNumbers: config.get<boolean>(
        'markdownForHumans.showDocumentLineNumbers',
        false
      ),
      showNavigationLineNumbers: config.get<boolean>(
        'markdownForHumans.showNavigationLineNumbers',
        false
      ),
      showNavigationPane: config.get<boolean>('markdownForHumans.showNavigationPane', false),
      outlinePanelWidth: config.get<number>('markdownForHumans.outlinePanelWidth', 220),
    };
  }

  /**
   * Get the base directory where new images should be saved.
   *
   * This is separate from `getImageBasePath()` (which is used to resolve
   * existing markdown image links relative to the markdown file).
   */
  private getImageStorageBasePath(document: vscode.TextDocument): string | null {
    const config = vscode.workspace.getConfiguration();
    const imagePathBase = config.get<string>(
      'markdownForHumans.imagePathBase',
      'relativeToDocument'
    );

    // Untitled docs: default to workspace-level saves when possible (we don't know
    // the final markdown file directory yet).
    if (document.uri.scheme === 'untitled') {
      return this.getWorkspaceFolderPath(document) ?? this.getImageBasePath(document);
    }

    if (imagePathBase === 'workspaceFolder') {
      return this.getWorkspaceFolderPath(document) ?? this.getImageBasePath(document);
    }

    // Default: relativeToDocument
    return (
      this.getDocumentDirectory(document) ?? this.getWorkspaceFolderPath(document) ?? os.homedir()
    );
  }

  /**
   * Called when our custom editor is opened
   */
  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    const documentPathLike = getDocumentPathLike(document);

    // Setup webview options
    // Allow loading resources from extension and the workspace folder containing the document
    let workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    // For untitled files, getWorkspaceFolder may not work, so check workspaceFolders
    if (
      !workspaceFolder &&
      document.uri.scheme === 'untitled' &&
      vscode.workspace.workspaceFolders &&
      vscode.workspace.workspaceFolders.length > 0
    ) {
      workspaceFolder = vscode.workspace.workspaceFolders[0];
    }
    const localResourceRoots = [this.context.extensionUri];

    if (workspaceFolder) {
      localResourceRoots.push(workspaceFolder.uri);
      // Also include parent directory to allow access to sibling directories
      // This enables markdown files to reference images in ../sibling-folder/
      const workspaceParent = path.dirname(workspaceFolder.uri.fsPath);
      if (workspaceParent && workspaceParent !== workspaceFolder.uri.fsPath) {
        localResourceRoots.push(vscode.Uri.file(workspaceParent));
      }
    } else if (document.uri.scheme === 'file') {
      // If not in a workspace but is a file, allow the document's directory
      localResourceRoots.push(vscode.Uri.file(path.dirname(document.uri.fsPath)));
    } else {
      // For untitled files without workspace, include home directory to allow absolute path image resolution
      localResourceRoots.push(vscode.Uri.file(os.homedir()));
    }

    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots,
    };

    // Show warning dialog for untitled files without workspace
    // Re-check workspaceFolder here since we may have updated it above
    const finalWorkspaceFolder =
      workspaceFolder ||
      (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
        ? vscode.workspace.workspaceFolders[0]
        : undefined);
    if (document.uri.scheme === 'untitled' && !finalWorkspaceFolder) {
      const imageBasePath = this.getImageBasePath(document);
      if (imageBasePath) {
        vscode.window.showInformationMessage(
          `You are working without a workspace. Images will be saved to: ${imageBasePath}`
        );
      }
    }

    // Set webview HTML
    webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);
    // Update webview when document changes
    const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(e => {
      if (e.document.uri.toString() === document.uri.toString()) {
        this.updateWebview(document, webviewPanel.webview);
      }
    });

    // Handle messages from webview
    webviewPanel.webview.onDidReceiveMessage(
      e => this.handleWebviewMessage(e, document, webviewPanel.webview),
      null,
      this.context.subscriptions
    );

    // Track this editor so proposal routing can find the correct document in this window.
    registerWebviewPanel(webviewPanel, document);
    setActiveWebviewPanel(webviewPanel, document);
    writeActiveInstanceMetadata(documentPathLike);
    const initialSelectionPayload = buildSelectionPayload(documentPathLike, {});
    writeSelectionToTempFile(initialSelectionPayload);
    writeSelectionStateForDocument(documentPathLike, initialSelectionPayload);

    // Send initial content to webview
    this.updateWebview(document, webviewPanel.webview);

    // Listen for configuration changes and update webview
    const configChangeSubscription = vscode.workspace.onDidChangeConfiguration(e => {
      if (
        e.affectsConfiguration('markdownForHumans.imageResize.skipWarning') ||
        e.affectsConfiguration('markdownForHumans.imagePath') ||
        e.affectsConfiguration('markdownForHumans.imagePathBase') ||
        e.affectsConfiguration('markdownForHumans.colors') ||
        e.affectsConfiguration('markdownForHumans.showHeadingGutter') ||
        e.affectsConfiguration('markdownForHumans.showDocumentLineNumbers') ||
        e.affectsConfiguration('markdownForHumans.showNavigationLineNumbers') ||
        e.affectsConfiguration('markdownForHumans.showNavigationPane') ||
        e.affectsConfiguration('markdownForHumans.outlinePanelWidth')
      ) {
        const config = vscode.workspace.getConfiguration();
        const skipWarning = config.get<boolean>('markdownForHumans.imageResize.skipWarning', false);
        const imagePath = config.get<string>('markdownForHumans.imagePath', 'images');
        const imagePathBase = config.get<string>(
          'markdownForHumans.imagePathBase',
          'relativeToDocument'
        );
        webviewPanel.webview.postMessage({
          type: 'settingsUpdate',
          skipResizeWarning: skipWarning,
          imagePath: imagePath,
          imagePathBase: imagePathBase,
          displaySettings: this.getDisplaySettings(),
        });
      }
    });

    webviewPanel.onDidChangeViewState(() => {
      if (webviewPanel.active) {
        markWebviewPanelActive(webviewPanel);
        writeActiveInstanceMetadata(documentPathLike);
        webviewPanel.webview.postMessage({ type: 'getSelection' });
        webviewPanel.webview.postMessage({ type: 'getOutline' });
      } else if (getActiveWebviewPanel() === webviewPanel) {
        setActiveWebviewPanel(undefined);
      }
    });

    // Source-to-MFH cursor sync: when cursor moves in the source text editor,
    // tell the webview so it can scroll to the corresponding block.
    let lastSourceSyncSelectionKey = '';
    const selectionSyncSubscription =
      typeof vscode.window.onDidChangeTextEditorSelection === 'function'
        ? vscode.window.onDidChangeTextEditorSelection(e => {
            if (e.textEditor.document.uri.toString() !== document.uri.toString()) return;
            if (this._isSyncFromWebview) return;
            // Only sync from the editor the user is actively interacting with
            if (e.textEditor !== vscode.window.activeTextEditor) return;
            const selection = e.textEditor.selection ?? e.selections[0];
            if (!selection) return;
            const viewportRatio = this.computeCurrentSourceViewportRatio(e.textEditor)?.ratio ?? null;
            const payload = buildSourceSelectionSyncPayload(selection, viewportRatio);
            const selectionKey =
              `${payload.activeLine}:${payload.startLine}:${payload.endLine}:${payload.isEmpty}:${payload.viewportRatio ?? 'null'}`;
            logSourceSelectionSync('selection event', {
              document: document.uri.toString(),
              selectionKey,
              anchor: {
                line: selection.anchor.line + 1,
                character: selection.anchor.character,
              },
              active: {
                line: selection.active.line + 1,
                character: selection.active.character,
              },
              start: {
                line: selection.start.line + 1,
                character: selection.start.character,
              },
              end: {
                line: selection.end.line + 1,
                character: selection.end.character,
              },
              payload,
            });
            this.noteSourceViewportAnchor(document.uri.toString(), e.textEditor, 'sourceSelectionEvent');
            if (selectionKey === lastSourceSyncSelectionKey) {
              logSourceSelectionSync('selection event deduped', { selectionKey });
              return;
            }
            lastSourceSyncSelectionKey = selectionKey;
            logSourceSelectionSync('posting selection payload to webview', payload);
            webviewPanel.webview.postMessage(payload);
          })
        : createNoopDisposable();

    const visibleRangesSub =
      typeof vscode.window.onDidChangeTextEditorVisibleRanges === 'function'
        ? vscode.window.onDidChangeTextEditorVisibleRanges(e => {
            if (e.textEditor.document.uri.toString() !== document.uri.toString()) return;
            this.noteSourceViewportAnchor(document.uri.toString(), e.textEditor, 'sourceVisibleRangesEvent');
          })
        : createNoopDisposable();

    // Detect when source editor is closed externally (user closes the tab)
    const visibleEditorsSub =
      typeof vscode.window.onDidChangeVisibleTextEditors === 'function'
        ? vscode.window.onDidChangeVisibleTextEditors(editors => {
            const sourceStillOpen = editors.some(
              ed => ed.document.uri.toString() === document.uri.toString()
            );
            if (!sourceStillOpen) {
              webviewPanel.webview.postMessage({ type: 'sourceViewClosed' });
            }
          })
        : createNoopDisposable();

    // Cleanup
    webviewPanel.onDidDispose(() => {
      changeDocumentSubscription.dispose();
      configChangeSubscription.dispose();
      selectionSyncSubscription.dispose();
      visibleRangesSub.dispose();
      visibleEditorsSub.dispose();
      this.clearPendingSourceAlignmentTimers(document.uri.toString());
      this.clearSourceResizeSession(document.uri.toString(), 'dispose');
      this.latestSourceSyncContext.delete(document.uri.toString());
      this.pendingSourceOpenSync.delete(document.uri.toString());
      // Clean up pending edits tracking for this document
      this.pendingEdits.delete(document.uri.toString());
      this.lastWebviewContent.delete(document.uri.toString());
      clearSelectionTempFileIfMatches(documentPathLike);
      clearSelectionStateFileForDocument(documentPathLike);
      unregisterWebviewPanel(webviewPanel);
    });
  }

  /**
   * Send document content to webview
   * Skips update if it's from a recent webview edit (avoid feedback loop)
   */
  private updateWebview(document: vscode.TextDocument, webview: vscode.Webview) {
    const docUri = document.uri.toString();
    const lastEditTime = this.pendingEdits.get(docUri);
    const currentContent = document.getText();

    // Skip update if content matches what we already sent from the webview
    const lastSentContent = this.lastWebviewContent.get(docUri);
    if (lastSentContent !== undefined && lastSentContent === currentContent) {
      return;
    }

    // Skip update if this change came from webview within last 100ms
    // This prevents feedback loops while allowing external Git changes to sync
    if (lastEditTime && Date.now() - lastEditTime < 100) {
      return;
    }

    // Transform content for webview (wrap frontmatter in code block)
    const transformedContent = this.wrapFrontmatterForWebview(currentContent);

    // Remember the ORIGINAL content (what we expect back from webview after unwrapping)
    // This prevents false dirty state when webview sends back unwrapped frontmatter
    this.lastWebviewContent.set(docUri, currentContent);

    // Get skip warning setting
    const config = vscode.workspace.getConfiguration();
    const skipWarning = config.get<boolean>('markdownForHumans.imageResize.skipWarning', false);
    const imagePath = config.get<string>('markdownForHumans.imagePath', 'images');
    const imagePathBase = config.get<string>(
      'markdownForHumans.imagePathBase',
      'relativeToDocument'
    );

    // Extract filename for webview display
    const fileName = getDocumentDisplayName(document);

    webview.postMessage({
      type: 'update',
      content: transformedContent,
      skipResizeWarning: skipWarning,
      imagePath: imagePath,
      imagePathBase: imagePathBase,
      displaySettings: this.getDisplaySettings(),
      fileName,
    });
  }

  /**
   * Handle messages from webview
   */
  private handleWebviewMessage(
    message: { type: string; [key: string]: unknown },
    document: vscode.TextDocument,
    webview: vscode.Webview
  ) {
    const documentPathLike = getDocumentPathLike(document);

    switch (message.type) {
      case 'edit':
        // Fire-and-forget: errors are handled inside applyEdit and shown to user
        void this.applyEdit(message.content as string, document);
        break;
      case 'save':
        // Trigger VS Code's save command
        vscode.commands.executeCommand('workbench.action.files.save');
        break;
      case 'ready': {
        // Webview is ready, send initial content and settings
        this.updateWebview(document, webview);
        // Also send settings separately
        const config = vscode.workspace.getConfiguration();
        const skipWarning = config.get<boolean>('markdownForHumans.imageResize.skipWarning', false);
        const imagePath = config.get<string>('markdownForHumans.imagePath', 'images');
        const imagePathBase = config.get<string>(
          'markdownForHumans.imagePathBase',
          'relativeToDocument'
        );
        webview.postMessage({
          type: 'settingsUpdate',
          skipResizeWarning: skipWarning,
          imagePath: imagePath,
          imagePathBase: imagePathBase,
          displaySettings: this.getDisplaySettings(),
        });
        break;
      }
      case 'outlineUpdated': {
        const outline = (message.outline || []) as any[];
        outlineViewProvider.setOutline(outline as any);
        break;
      }
      case 'selectionChange': {
        const pos = message.pos as number | undefined;
        outlineViewProvider.setActiveSelection(typeof pos === 'number' ? pos : null);
        break;
      }
      case 'selectionPush': {
        const selectionPayload = buildSelectionPayload(documentPathLike, message);
        writeSelectionToTempFile(selectionPayload);
        writeSelectionStateForDocument(documentPathLike, selectionPayload);
        writeActiveInstanceMetadata(documentPathLike);
        break;
      }
      case 'saveImage':
        this.handleSaveImage(message, document, webview);
        break;
      case 'handleWorkspaceImage':
        void this.handleWorkspaceImage(message, document, webview);
        break;
      case 'resolveImageUri':
        this.handleResolveImageUri(message, document, webview);
        break;
      case 'openSourceView':
        // Open the source file in a split view with VS Code's default text editor
        void (async () => {
          const documentUri = document.uri.toString();
          this.clearPendingSourceAlignmentTimers(documentUri);
          this.clearSourceResizeSession(documentUri, 'openSourceView');
          this.latestSourceSyncContext.delete(documentUri);
          this.pendingSourceOpenSync.add(documentUri);
          await vscode.commands.executeCommand(
            'vscode.openWith',
            document.uri,
            'default',
            vscode.ViewColumn.Beside
          );
          // Request current cursor line plus viewport anchor from the webview.
          setTimeout(() => {
            webview.postMessage({ type: 'requestCurrentLine' });
          }, 300);
        })();
        break;
      case 'sourceResizeSession': {
        const requestId =
          typeof message.requestId === 'string' ? message.requestId : null;
        const phase =
          message.phase === 'start' || message.phase === 'extend' || message.phase === 'settled'
            ? message.phase
            : null;
        const line = typeof message.line === 'number' ? message.line : null;
        const viewportRatio =
          typeof message.viewportRatio === 'number' ? message.viewportRatio : null;
        if (!phase) {
          break;
        }
        this.handleSourceResizeSessionMessage(document, requestId, phase, line, viewportRatio);
        break;
      }
      case 'closeSourceView': {
        // Close the source text editor for this document
        this.pendingSourceOpenSync.delete(document.uri.toString());
        this.clearSourceResizeSession(document.uri.toString(), 'closeSourceView');
        const sourceTab = vscode.window.tabGroups.all
          .flatMap(g => g.tabs)
          .find(tab =>
            tab.input instanceof vscode.TabInputText &&
            tab.input.uri.toString() === document.uri.toString()
          );
        if (sourceTab) {
          void vscode.window.tabGroups.close(sourceTab);
        }
        break;
      }
      case 'syncSourceSelection': {
        const syncMessage = message as unknown as SyncSourceSelectionMessage;
        const activeLine = syncMessage.activeLine;
        const startLine =
          typeof syncMessage.startLine === 'number' ? syncMessage.startLine : activeLine;
        const endLine =
          typeof syncMessage.endLine === 'number' ? syncMessage.endLine : startLine;
        const isEmpty =
          typeof syncMessage.isEmpty === 'boolean' ? syncMessage.isEmpty : startLine === endLine;
        const viewportRatio =
          typeof syncMessage.viewportRatio === 'number' ? syncMessage.viewportRatio : null;
        const requestId =
          typeof syncMessage.requestId === 'string' ? syncMessage.requestId : null;
        const reason =
          typeof syncMessage.reason === 'string' ? syncMessage.reason : null;
        if (typeof activeLine !== 'number' || activeLine < 1) break;
        if (typeof startLine !== 'number' || startLine < 1) break;
        if (typeof endLine !== 'number' || endLine < 1) break;
        this.pendingSourceOpenSync.delete(document.uri.toString());
        this._isSyncFromWebview = true;
        this.scheduleSourceAlignment(
          document,
          {
            activeLine,
            startLine: Math.min(startLine, endLine),
            endLine: Math.max(startLine, endLine),
            isEmpty,
          },
          viewportRatio,
          requestId,
          reason
        );
        setTimeout(() => {
          this._isSyncFromWebview = false;
        }, 300);
        break;
      }
      case 'syncSourceLine': {
        // MFH cursor moved — sync source text editor cursor to the same line
        const line = message.line as number;
        const viewportRatio =
          typeof message.viewportRatio === 'number' ? message.viewportRatio : null;
        const requestId =
          typeof message.requestId === 'string' ? message.requestId : null;
        const reason =
          typeof message.reason === 'string' ? message.reason : null;
        if (typeof line !== 'number' || line < 1) break;
        this.pendingSourceOpenSync.delete(document.uri.toString());
        this._isSyncFromWebview = true;
        this.scheduleSourceAlignment(document, line, viewportRatio, requestId, reason);
        setTimeout(() => {
          this._isSyncFromWebview = false;
        }, 300);
        break;
      }
      case 'openExtensionSettings':
        vscode.commands.executeCommand(
          'workbench.action.openSettings',
          'markdownForHumans'
        );
        break;
      case 'exportDocument':
        this.handleExportDocument(message, document);
        break;
      case 'showError':
        vscode.window.showErrorMessage(message.message as string);
        break;
      case 'resizeImage':
        this.handleResizeImage(message, document, webview);
        break;
      case 'undoResize':
        this.handleUndoResize(message, document, webview);
        break;
      case 'redoResize':
        this.handleRedoResize(message, document, webview);
        break;
      case 'updateSetting':
        this.handleUpdateSetting(message, webview);
        break;
      case 'checkImageInWorkspace':
        this.handleCheckImageInWorkspace(message, document, webview);
        break;
      case 'copyLocalImageToWorkspace':
        this.handleCopyLocalImageToWorkspace(message, document, webview);
        break;
      case 'renameImage':
        this.handleRenameImage(message, document, webview);
        break;
      case 'checkImageRename':
        void this.handleCheckImageRename(message, document, webview);
        break;
      case 'getImageReferences':
        void this.handleGetImageReferences(message, document, webview);
        break;
      case 'openFileAtLocation':
        void this.handleOpenFileAtLocation(message);
        break;
      case 'getImageMetadata':
        this.handleGetImageMetadata(message, document, webview);
        break;
      case 'revealImageInOS':
        this.handleRevealImageInOS(message, document);
        break;
      case 'revealImageInExplorer':
        this.handleRevealImageInExplorer(message, document);
        break;
      case 'searchFiles':
        void this.handleSearchFiles(message, webview);
        break;
      case 'openExternalLink':
        void this.handleOpenExternalLink(message);
        break;
      case 'openFileLink':
        void this.handleOpenFileLink(message, document);
        break;
      case 'openImage':
        void this.handleOpenImage(message, document);
        break;
      case 'selectionResult': {
        const selectionResult = buildSelectionPayload(documentPathLike, message);
        writeSelectionToTempFile(selectionResult);
        writeSelectionStateForDocument(documentPathLike, selectionResult);
        writeActiveInstanceMetadata(documentPathLike);
        if (this.pendingSelectionResolve) {
          this.pendingSelectionResolve(JSON.stringify(selectionResult));
          this.pendingSelectionResolve = undefined;
        }
        break;
      }
      case 'selectionRevealResult': {
        writeSelectionRevealResponse({
          selection_request_id: message.id,
          id: message.id,
          status: message.status === 'revealed' ? 'revealed' : 'error',
          file: documentPathLike,
          ...(message.error ? { error: message.error } : {}),
          ...(message.debug ? { debug: message.debug } : {}),
        });
        break;
      }
    }
  }

  public async getSelection(): Promise<string> {
    const panel = getActiveWebviewPanel();
    const document = getActiveDocument();
    if (!panel || !document) {
      return JSON.stringify({ selected: null, error: 'No active Markdown for Humans editor' });
    }
    return new Promise(resolve => {
      this.pendingSelectionResolve = resolve;
      panel.webview.postMessage({ type: 'getSelection' });
      setTimeout(() => {
        if (this.pendingSelectionResolve) {
          const timedOutSelectionResult = {
            instance_id: getEditorHostInstanceId(),
            file: getDocumentPathLike(document),
            selected: null,
          };
          this.pendingSelectionResolve(JSON.stringify(timedOutSelectionResult));
          this.pendingSelectionResolve = undefined;
        }
      }, 2000);
    });
  }

  /**
   * Handle document export request from webview
   */
  private async handleExportDocument(
    message: { type: string; [key: string]: unknown },
    document: vscode.TextDocument
  ): Promise<void> {
    const format = message.format as string;
    const html = message.html as string;
    const mermaidImages = message.mermaidImages as any[];
    const title = message.title as string;

    // Import dynamically to avoid loading heavy dependencies on startup
    const { exportDocument } = await import('../features/documentExport');

    await exportDocument(format, html, mermaidImages, title, document);
  }

  /**
   * Resolve a relative image path to a webview URI
   *
   * Normalizes URL-encoded paths (e.g. `Hero%20Image.png`) before resolving
   * so that images with spaces or special characters in filenames work correctly.
   */
  private handleResolveImageUri(
    message: { type: string; [key: string]: unknown },
    document: vscode.TextDocument,
    webview: vscode.Webview
  ): void {
    const rawRelativePath = message.relativePath as string;
    const requestId = message.requestId as string;

    // Normalize the path (decode URL-encoded segments like %20 → space)
    const relativePath = normalizeImagePath(rawRelativePath);

    // Resolve relative to document base path
    const basePath = this.getImageBasePath(document);
    if (!basePath) {
      webview.postMessage({
        type: 'imageUriResolved',
        requestId,
        webviewUri: '',
        relativePath: rawRelativePath,
        error: 'Cannot resolve image path: no base directory available',
      });
      return;
    }
    const absolutePath = path.resolve(basePath, relativePath);
    const fileUri = vscode.Uri.file(absolutePath);

    // Convert to webview URI
    const webviewUri = webview.asWebviewUri(fileUri);

    webview.postMessage({
      type: 'imageUriResolved',
      requestId,
      webviewUri: webviewUri.toString(),
      relativePath: rawRelativePath, // Return original path for consistency
    });
  }

  /**
   * Check if relative path is valid (doesn't contain absolute path)
   * Works on both Windows and Mac/Linux
   */
  private isValidRelativePath(relativePath: string): boolean {
    // On Windows, path.relative() can produce paths like "../../../../c:/Users/..."
    // when paths don't share a common root. Check for drive letters.
    const windowsAbsolutePattern = /[a-zA-Z]:/;

    // On Unix/Mac, path.relative() can produce paths starting with "/"
    // when paths don't share a common root. Check for leading slash.
    const unixAbsolutePattern = /^\/[^/]/;

    // Also check if path.isAbsolute() returns true (Node.js built-in, cross-platform)
    return (
      !windowsAbsolutePattern.test(relativePath) &&
      !unixAbsolutePattern.test(relativePath) &&
      !path.isAbsolute(relativePath)
    );
  }

  /**
   * Check if source is within workspace/document directory (cross-platform)
   */
  private isWithinWorkspace(sourcePath: string, basePath: string): boolean {
    const normalizedSource = path.normalize(sourcePath);
    const normalizedBase = path.normalize(basePath);

    // On Windows, ensure case-insensitive comparison
    // On Mac/Linux, case-sensitive comparison
    const sourceLower =
      process.platform === 'win32' ? normalizedSource.toLowerCase() : normalizedSource;
    const baseLower = process.platform === 'win32' ? normalizedBase.toLowerCase() : normalizedBase;

    return sourceLower.startsWith(baseLower + path.sep) || sourceLower === baseLower;
  }

  /**
   * Handle workspace image drop (from VS Code file explorer)
   * Computes relative path from document to the image, or copies image if outside workspace
   */
  private async handleWorkspaceImage(
    message: { type: string; [key: string]: unknown },
    document: vscode.TextDocument,
    webview: vscode.Webview
  ): Promise<void> {
    const sourcePath = message.sourcePath as string;
    const fileName = message.fileName as string;
    const insertPosition = message.insertPosition as number | undefined;

    console.log(`${BUILD_TAG} Handling workspace image: ${sourcePath}`);

    // Get the document base path
    const basePath = this.getImageBasePath(document);
    if (!basePath) {
      console.error(`${BUILD_TAG} Cannot compute relative path: no base directory available`);
      return;
    }

    // Normalize paths for comparison
    const normalizedSource = path.normalize(sourcePath);
    const normalizedBase = path.normalize(basePath);

    // Check if image is within workspace/document directory
    const withinWorkspace = this.isWithinWorkspace(normalizedSource, normalizedBase);

    // Compute relative path from document base to image
    let relativePath = path.relative(normalizedBase, normalizedSource);

    // Ensure forward slashes for markdown compatibility
    relativePath = relativePath.replace(/\\/g, '/');

    // Validate the relative path
    const isValidPath = this.isValidRelativePath(relativePath);

    // If path is invalid or image is outside workspace, copy it to workspace
    if (!isValidPath || !withinWorkspace) {
      console.log(`${BUILD_TAG} Image is outside workspace or has invalid path, copying to workspace...`);

      try {
        // Read the source image
        const sourceUri = vscode.Uri.file(normalizedSource);
        const imageData = await vscode.workspace.fs.readFile(sourceUri);

        // Get save location
        const saveBasePath = this.getImageStorageBasePath(document);
        if (!saveBasePath) {
          const errorMessage = 'Cannot copy image: no base directory available';
          vscode.window.showErrorMessage(errorMessage);
          return;
        }

        const config = vscode.workspace.getConfiguration();
        const imageFolderName = config.get<string>('markdownForHumans.imagePath', 'images');
        const imagesDir = path.join(saveBasePath, imageFolderName);

        // Create folder if needed
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(imagesDir));

        // Generate filename from source
        const sourceFilename = path.basename(normalizedSource);
        const parsedName = path.parse(sourceFilename);
        const baseFilename = parsedName.name || 'image';
        const extension = parsedName.ext || '';

        let finalFilename = sourceFilename;
        let targetPath = path.join(imagesDir, finalFilename);
        let targetUri = vscode.Uri.file(targetPath);

        const fileExists = async (uri: vscode.Uri): Promise<boolean> => {
          try {
            await vscode.workspace.fs.stat(uri);
            return true;
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (message.includes('ENOENT') || message.includes('FileNotFound')) {
              return false;
            }
            throw error;
          }
        };

        // Handle filename collisions
        if (await fileExists(targetUri)) {
          let foundAvailableName = false;
          for (let suffix = 2; suffix < 1000; suffix += 1) {
            finalFilename = `${baseFilename}-${suffix}${extension}`;
            targetPath = path.join(imagesDir, finalFilename);
            targetUri = vscode.Uri.file(targetPath);
            if (!(await fileExists(targetUri))) {
              foundAvailableName = true;
              break;
            }
          }
          if (!foundAvailableName) {
            throw new Error(
              `Cannot copy image: too many existing files matching "${baseFilename}-N${extension}"`
            );
          }
        }

        // Copy file to workspace
        await vscode.workspace.fs.writeFile(targetUri, imageData);

        // Calculate relative path for markdown
        const markdownDir =
          document.uri.scheme === 'file' ? path.dirname(document.uri.fsPath) : saveBasePath;
        let copiedRelativePath = path.relative(markdownDir, targetPath).replace(/\\/g, '/');
        if (!copiedRelativePath.startsWith('..') && !copiedRelativePath.startsWith('./')) {
          copiedRelativePath = './' + copiedRelativePath;
        }

        console.log(`${BUILD_TAG} Image copied to workspace. Path: ${copiedRelativePath}`);

        // Extract alt text from filename (remove extension)
        const altText = fileName.replace(/\.[^.]+$/, '');

        // Send message to webview to insert the image with relative path
        // Use insertWorkspaceImage message type for consistency
        webview.postMessage({
          type: 'insertWorkspaceImage',
          relativePath: copiedRelativePath,
          altText,
          insertPosition,
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`${BUILD_TAG} Failed to copy workspace image: ${errorMessage}`);
        vscode.window.showErrorMessage(`Failed to copy image: ${errorMessage}`);
      }
      return;
    }

    // Image is within workspace and path is valid - use relative path directly
    // Add ./ prefix if it doesn't start with .. (going up directories)
    if (!relativePath.startsWith('..') && !relativePath.startsWith('./')) {
      relativePath = './' + relativePath;
    }

    console.log(`${BUILD_TAG} Computed relative path: ${relativePath}`);

    // Extract alt text from filename (remove extension)
    const altText = fileName.replace(/\.[^.]+$/, '');

    // Send the markdown image syntax back to webview
    webview.postMessage({
      type: 'insertWorkspaceImage',
      relativePath,
      altText,
      insertPosition,
    });
  }

  /**
   * Handle image save from webview
   * Saves the image to the workspace and returns the relative path
   */
  private async handleSaveImage(
    message: { type: string; [key: string]: unknown },
    document: vscode.TextDocument,
    webview: vscode.Webview
  ): Promise<void> {
    const placeholderId = message.placeholderId as string;
    const name = message.name as string;
    const data = message.data as number[];
    const mimeType = message.mimeType as string;

    // Use user-selected folder from confirmation dialog
    const imageFolderName = (message.targetFolder as string) || 'images';

    // Resolve where to save new images (may be doc-relative or workspace-level).
    const saveBasePath = this.getImageStorageBasePath(document);
    if (!saveBasePath) {
      const errorMessage = 'Cannot save image: no base directory available';
      vscode.window.showErrorMessage(errorMessage);
      webview.postMessage({
        type: 'imageError',
        placeholderId,
        error: errorMessage,
      });
      return;
    }
    const imagesDir = path.join(saveBasePath, imageFolderName);

    console.log(`${BUILD_TAG} Saving image "${name}" to folder: ${imagesDir}`);

    try {
      // Create folder if needed
      await vscode.workspace.fs.createDirectory(vscode.Uri.file(imagesDir));

      // Save image (collision-safe: never overwrite silently)
      const parsedName = path.parse(name);
      const baseFilename = parsedName.name || 'image';
      const extension = parsedName.ext || '';

      let finalFilename = name;
      let imagePath = path.join(imagesDir, finalFilename);
      let imageUri = vscode.Uri.file(imagePath);

      const fileExists = async (uri: vscode.Uri): Promise<boolean> => {
        try {
          await vscode.workspace.fs.stat(uri);
          return true;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          // Treat not-found as available; unknown errors should abort to avoid accidental overwrites.
          if (message.includes('ENOENT') || message.includes('FileNotFound')) {
            return false;
          }
          throw error;
        }
      };

      if (await fileExists(imageUri)) {
        let foundAvailableName = false;
        for (let suffix = 2; suffix < 1000; suffix += 1) {
          finalFilename = `${baseFilename}-${suffix}${extension}`;
          imagePath = path.join(imagesDir, finalFilename);
          imageUri = vscode.Uri.file(imagePath);
          if (!(await fileExists(imageUri))) {
            foundAvailableName = true;
            break;
          }
        }
        if (!foundAvailableName) {
          throw new Error(
            `Cannot save image: too many existing files matching "${baseFilename}-N${extension}"`
          );
        }
      }

      await vscode.workspace.fs.writeFile(imageUri, new Uint8Array(data));

      // Markdown link should always be relative to the markdown file directory (portable in git).
      const markdownDir =
        document.uri.scheme === 'file' ? path.dirname(document.uri.fsPath) : saveBasePath;
      let relativePath = path.relative(markdownDir, imagePath).replace(/\\/g, '/');

      if (!relativePath.startsWith('..') && !relativePath.startsWith('./')) {
        relativePath = './' + relativePath;
      }

      console.log(`${BUILD_TAG} Image saved successfully. Path: ${relativePath}`);

      webview.postMessage({
        type: 'imageSaved',
        placeholderId,
        newSrc: relativePath, // Use relative path (markdown-friendly)
      });

      // Log success (mimeType used for potential future validation)
      if (mimeType) {
        // Image type validation could be added here
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`Failed to save image: ${errorMessage}`);
      webview.postMessage({
        type: 'imageError',
        placeholderId,
        error: errorMessage,
      });
    }
  }

  /**
   * Handle image resize request from webview
   * Backs up the original image, then overwrites the original file in-place.
   */
  private async handleResizeImage(
    message: { type: string; [key: string]: unknown },
    document: vscode.TextDocument,
    webview: vscode.Webview
  ): Promise<void> {
    const imagePath = message.imagePath as string;
    const absolutePathFromMessage = message.absolutePath as string | undefined;
    const newWidth = message.newWidth as number;
    const newHeight = message.newHeight as number;
    const originalWidth = message.originalWidth as number | undefined;
    const originalHeight = message.originalHeight as number | undefined;
    const imageData = message.imageData as string; // base64 data URL

    console.log(`${BUILD_TAG} Resizing image: ${imagePath} to ${newWidth}x${newHeight}`);

    try {
      // If absolute path provided (edit in place), use it directly
      // Otherwise resolve relative to document
      let absolutePath: string;
      let imageUri: vscode.Uri;

      if (absolutePathFromMessage) {
        // Editing in place (image outside workspace)
        absolutePath = absolutePathFromMessage;
        imageUri = vscode.Uri.file(absolutePath);
      } else {
        // Normal case: resolve relative to document base path
        const basePath = this.getImageBasePath(document);
        if (!basePath) {
          throw new Error('Cannot resolve image path: no base directory available');
        }
        const normalizedPath = normalizeImagePath(imagePath);
        absolutePath = path.resolve(basePath, normalizedPath);
        imageUri = vscode.Uri.file(absolutePath);
      }

      // Check if image exists
      try {
        await vscode.workspace.fs.stat(imageUri);
      } catch {
        throw new Error(`Image not found: ${imagePath}`);
      }

      // Copy original to backup (workspace-scoped; never write backups next to external files)
      const originalData = await vscode.workspace.fs.readFile(imageUri);
      const basePath = this.getImageBasePath(document);
      if (!basePath) {
        throw new Error('Cannot compute backup path: no base directory available');
      }

      const backupWorkspaceRoot = this.getWorkspaceFolderPath(document) ?? basePath;
      const backupLocation = buildResizeBackupLocation({
        backupWorkspaceRoot,
        imageAbsolutePath: absolutePath,
        oldWidth: typeof originalWidth === 'number' && originalWidth > 0 ? originalWidth : newWidth,
        oldHeight:
          typeof originalHeight === 'number' && originalHeight > 0 ? originalHeight : newHeight,
        now: new Date(),
      });

      // Ensure backup root directory exists (flat structure - single directory)
      await vscode.workspace.fs.createDirectory(vscode.Uri.file(backupLocation.backupDir));

      // Resolve backup path with collision detection
      const finalBackupPath = await resolveBackupPathWithCollisionDetection(
        backupLocation.backupFilePath
      );

      await vscode.workspace.fs.writeFile(vscode.Uri.file(finalBackupPath), originalData);
      console.log(`${BUILD_TAG} Backup created: ${finalBackupPath}`);

      // Convert base64 data URL to buffer
      const base64Data = imageData.split(',')[1]; // Remove data:image/png;base64, prefix
      const buffer = Buffer.from(base64Data, 'base64');

      // Overwrite the original file in place (path remains unchanged).
      await vscode.workspace.fs.writeFile(imageUri, buffer);
      console.log(`${BUILD_TAG} Image resized in-place: ${absolutePath}`);

      const relativeBackupPath = path.relative(basePath, finalBackupPath).replace(/\\/g, '/');
      const normalizedBackupPath =
        relativeBackupPath.startsWith('..') || relativeBackupPath.startsWith('./')
          ? relativeBackupPath
          : `./${relativeBackupPath}`;

      webview.postMessage({
        type: 'imageResized',
        success: true,
        imagePath,
        backupPath: normalizedBackupPath,
        newWidth, // Pass new dimensions so metadata can be updated immediately
        newHeight,
        timestamp: Date.now(), // Cache-busting
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`${BUILD_TAG} Failed to resize image: ${errorMessage}`);
      vscode.window.showErrorMessage(`Failed to resize image: ${errorMessage}`);
      webview.postMessage({
        type: 'imageResized',
        success: false,
        error: errorMessage,
      });
    }
  }

  /**
   * Handle undo resize request from webview
   * Restores image from backup
   */
  private async handleUndoResize(
    message: { type: string; [key: string]: unknown },
    document: vscode.TextDocument,
    webview: vscode.Webview
  ): Promise<void> {
    const imagePath = message.imagePath as string;
    const backupPath = message.backupPath as string;

    console.log(`${BUILD_TAG} Undoing resize: restoring ${imagePath} from ${backupPath}`);

    try {
      // Resolve paths using base path
      const basePath = this.getImageBasePath(document);
      if (!basePath) {
        throw new Error('Cannot resolve image path: no base directory available');
      }
      const normalizedImagePath = normalizeImagePath(imagePath);
      const normalizedBackupPath = normalizeImagePath(backupPath);
      const absoluteImagePath = path.resolve(basePath, normalizedImagePath);
      const absoluteBackupPath = path.resolve(basePath, normalizedBackupPath);

      const imageUri = vscode.Uri.file(absoluteImagePath);
      const backupUri = vscode.Uri.file(absoluteBackupPath);

      // Check if backup exists
      try {
        await vscode.workspace.fs.stat(backupUri);
      } catch {
        throw new Error(`Backup not found: ${backupPath}`);
      }

      // Restore from backup
      const backupData = await vscode.workspace.fs.readFile(backupUri);
      await vscode.workspace.fs.writeFile(imageUri, backupData);
      console.log(`${BUILD_TAG} Image restored from backup`);

      webview.postMessage({
        type: 'imageUndoResized',
        success: true,
        imagePath,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`${BUILD_TAG} Failed to undo resize: ${errorMessage}`);
      vscode.window.showErrorMessage(`Failed to undo resize: ${errorMessage}`);
      webview.postMessage({
        type: 'imageUndoResized',
        success: false,
        error: errorMessage,
      });
    }
  }

  /**
   * Handle redo resize request from webview
   * Reapplies resize operation
   */
  private async handleRedoResize(
    message: { type: string; [key: string]: unknown },
    document: vscode.TextDocument,
    webview: vscode.Webview
  ): Promise<void> {
    const imagePath = message.imagePath as string;
    const newWidth = message.newWidth as number;
    const newHeight = message.newHeight as number;
    const imageData = message.imageData as string;

    console.log(`${BUILD_TAG} Redoing resize: ${imagePath} to ${newWidth}x${newHeight}`);

    try {
      // Resolve image path using base path
      const basePath = this.getImageBasePath(document);
      if (!basePath) {
        throw new Error('Cannot resolve image path: no base directory available');
      }
      const normalizedPath = normalizeImagePath(imagePath);
      const absolutePath = path.resolve(basePath, normalizedPath);
      const imageUri = vscode.Uri.file(absolutePath);

      // Convert base64 to buffer
      const base64Data = imageData.split(',')[1];
      const buffer = Buffer.from(base64Data, 'base64');

      // Save resized image
      await vscode.workspace.fs.writeFile(imageUri, buffer);
      console.log(`${BUILD_TAG} Image resize redone successfully`);

      webview.postMessage({
        type: 'imageRedoResized',
        success: true,
        imagePath,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`${BUILD_TAG} Failed to redo resize: ${errorMessage}`);
      vscode.window.showErrorMessage(`Failed to redo resize: ${errorMessage}`);
      webview.postMessage({
        type: 'imageRedoResized',
        success: false,
        error: errorMessage,
      });
    }
  }

  /**
   * Compute image reference counts across the workspace for UI previews.
   *
   * Returns:
   * - currentFileCount: number of occurrences in the current document
   * - otherFiles: list of other markdown files referencing the same image (with line numbers)
   */
  private async handleGetImageReferences(
    message: { type: string; [key: string]: unknown },
    document: vscode.TextDocument,
    webview: vscode.Webview
  ): Promise<void> {
    const requestId = message.requestId as string;
    const imagePath = message.imagePath as string;

    try {
      const basePath = this.getImageBasePath(document);
      if (!basePath) {
        throw new Error('Cannot resolve image base path');
      }

      const normalizedTargetPath = normalizeImagePath(imagePath);
      const absoluteTargetPath = path.resolve(basePath, normalizedTargetPath);
      const normalizedAbsoluteTarget = path.normalize(absoluteTargetPath);

      const fileDir = document.uri.scheme === 'file' ? path.dirname(document.uri.fsPath) : basePath;

      const imageRefRegex = /!\[([^\]]*)\]\(([^)]+)\)|<img[^>]+src=["']([^"']+)["']/g;
      const currentFileMatches: Array<{ line: number; text: string }> = [];
      const lines = document.getText().split('\n');

      lines.forEach((line, index) => {
        imageRefRegex.lastIndex = 0;
        let match;
        while ((match = imageRefRegex.exec(line)) !== null) {
          const ref = match[2] || match[3];
          if (!ref) continue;

          const normalizedRefPath = normalizeImagePath(ref);
          const absoluteRefPath = path.isAbsolute(normalizedRefPath)
            ? normalizedRefPath
            : path.resolve(fileDir, normalizedRefPath);
          if (path.normalize(absoluteRefPath) === normalizedAbsoluteTarget) {
            currentFileMatches.push({ line: index, text: line });
          }
        }
      });

      const allReferences = await this.findImageReferences(imagePath, basePath);
      const otherFiles =
        document.uri.scheme === 'file'
          ? allReferences.filter(ref => ref.file.fsPath !== document.uri.fsPath)
          : allReferences;

      webview.postMessage({
        type: 'imageReferences',
        requestId,
        imagePath,
        currentFileCount: currentFileMatches.length,
        otherFiles: otherFiles.map(ref => ({
          fsPath: ref.file.fsPath,
          matches: ref.matches,
        })),
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`${BUILD_TAG} Failed to compute image references: ${errorMessage}`);
      webview.postMessage({
        type: 'imageReferences',
        requestId,
        imagePath,
        currentFileCount: 0,
        otherFiles: [],
        error: errorMessage,
      });
    }
  }

  private async handleOpenFileAtLocation(message: {
    type: string;
    [key: string]: unknown;
  }): Promise<void> {
    const fsPath = message.fsPath as string;
    const line = message.line as number | undefined;
    const openToSide = (message.openToSide as boolean) ?? false;

    try {
      if (!fsPath) {
        throw new Error('Missing fsPath');
      }

      const uri = vscode.Uri.file(fsPath);
      const doc = await vscode.workspace.openTextDocument(uri);

      const zeroBasedLine = typeof line === 'number' && line > 0 ? line - 1 : 0;
      const position = new vscode.Position(zeroBasedLine, 0);
      const selection = new vscode.Range(position, position);

      await vscode.window.showTextDocument(doc, {
        viewColumn: openToSide ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active,
        selection,
        preserveFocus: false,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`${BUILD_TAG} Failed to open file: ${errorMessage}`);
      vscode.window.showErrorMessage(`Failed to open file: ${errorMessage}`);
    }
  }

  /**
   * Find all markdown files that reference an image
   */
  private async findImageReferences(
    oldImagePath: string,
    basePath: string
  ): Promise<Array<{ file: vscode.Uri; matches: Array<{ line: number; text: string }> }>> {
    // Find all markdown files
    const markdownFiles = await vscode.workspace.findFiles('**/*.md', null, 1000);

    const results: Array<{ file: vscode.Uri; matches: Array<{ line: number; text: string }> }> = [];

    // Normalize the old path for comparison
    const normalizedOldPath = normalizeImagePath(oldImagePath);
    const absoluteOldPath = path.resolve(basePath, normalizedOldPath);

    for (const file of markdownFiles) {
      try {
        const doc = await vscode.workspace.openTextDocument(file);
        const text = doc.getText();
        const lines = text.split('\n');

        // Match markdown image syntax: ![alt](path) and <img src="path">
        const imageRefRegex = /!\[([^\]]*)\]\(([^)]+)\)|<img[^>]+src=["']([^"']+)["']/g;
        const matches: Array<{ line: number; text: string }> = [];

        lines.forEach((line, index) => {
          let match;
          // Reset regex lastIndex for each line
          imageRefRegex.lastIndex = 0;
          while ((match = imageRefRegex.exec(line)) !== null) {
            const imagePath = match[2] || match[3]; // Markdown or HTML syntax
            if (!imagePath) continue;

            // Normalize the path from the markdown file
            const fileDir = path.dirname(file.fsPath);
            const normalizedRefPath = normalizeImagePath(imagePath);
            let absoluteRefPath: string;

            // Handle different path formats
            if (path.isAbsolute(normalizedRefPath)) {
              absoluteRefPath = normalizedRefPath;
            } else if (normalizedRefPath.startsWith('./') || normalizedRefPath.startsWith('../')) {
              absoluteRefPath = path.resolve(fileDir, normalizedRefPath);
            } else {
              // Relative path without ./ prefix
              absoluteRefPath = path.resolve(fileDir, normalizedRefPath);
            }

            // Normalize paths for comparison (handle different separators)
            const normalizedAbsoluteOld = path.normalize(absoluteOldPath);
            const normalizedAbsoluteRef = path.normalize(absoluteRefPath);

            // Check if paths match (same file)
            if (normalizedAbsoluteOld === normalizedAbsoluteRef) {
              matches.push({ line: index, text: line });
            }
          }
        });

        if (matches.length > 0) {
          results.push({ file, matches });
        }
      } catch (error) {
        // Skip files that can't be read
        console.warn(`${BUILD_TAG} Failed to read file ${file.fsPath}: ${error}`);
      }
    }

    return results;
  }

  /**
   * Update image references in markdown files
   */
  private async updateImageReferences(
    references: Array<{ file: vscode.Uri; matches: Array<{ line: number; text: string }> }>,
    oldFilename: string,
    newFilename: string
  ): Promise<number> {
    const edit = new vscode.WorkspaceEdit();
    let filesUpdated = 0;

    for (const { file, matches } of references) {
      try {
        const doc = await vscode.workspace.openTextDocument(file);
        const text = doc.getText();
        const lines = text.split('\n');

        // Escape filename for regex
        const escapedOldFilename = oldFilename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        // Match the filename when preceded by / or ( and followed by ) or " or '
        // This ensures we only replace in path contexts, not random text
        const imagePathRegex = new RegExp(`([(/])${escapedOldFilename}([)"'])`, 'g');

        let updated = false;
        const updatedLines = lines.map((line, index) => {
          // Only update lines that have matches
          if (matches.some(m => m.line === index)) {
            const updatedLine = line.replace(imagePathRegex, `$1${newFilename}$2`);
            if (updatedLine !== line) {
              updated = true;
              return updatedLine;
            }
          }
          return line;
        });

        if (updated) {
          const updatedText = updatedLines.join('\n');
          edit.replace(file, new vscode.Range(0, 0, doc.lineCount, 0), updatedText);
          filesUpdated++;
        }
      } catch (error) {
        console.warn(`${BUILD_TAG} Failed to update file ${file.fsPath}: ${error}`);
      }
    }

    if (filesUpdated > 0) {
      await vscode.workspace.applyEdit(edit);
    }

    return filesUpdated;
  }

  private async handleCheckImageRename(
    message: { type: string; [key: string]: unknown },
    document: vscode.TextDocument,
    webview: vscode.Webview
  ): Promise<void> {
    const requestId = message.requestId as string;
    const oldPath = message.oldPath as string;
    const newName = message.newName as string;

    try {
      const basePath = this.getImageBasePath(document);
      if (!basePath) {
        throw new Error('Cannot resolve image path: no base directory available');
      }

      const normalizedOldPath = normalizeImagePath(oldPath);
      const absoluteOldPath = path.resolve(basePath, normalizedOldPath);
      const oldUri = vscode.Uri.file(absoluteOldPath);

      // Ensure the source exists
      await vscode.workspace.fs.stat(oldUri);

      const oldExt = path.extname(absoluteOldPath);
      const newFilename = buildImageFilenameForUserRename(newName, oldExt);

      const oldDir = path.dirname(absoluteOldPath);
      const absoluteNewPath = path.join(oldDir, newFilename);
      const newUri = vscode.Uri.file(absoluteNewPath);

      let exists = false;
      try {
        await vscode.workspace.fs.stat(newUri);
        exists = true;
      } catch {
        exists = false;
      }

      const relativeNewPath = path.relative(basePath, absoluteNewPath).replace(/\\/g, '/');
      const normalizedNewPath = relativeNewPath.startsWith('.')
        ? relativeNewPath
        : `./${relativeNewPath}`;

      webview.postMessage({
        type: 'imageRenameCheck',
        requestId,
        exists,
        newFilename,
        newPath: normalizedNewPath,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`${BUILD_TAG} Failed to check rename target: ${errorMessage}`);
      webview.postMessage({
        type: 'imageRenameCheck',
        requestId,
        exists: false,
        newFilename: '',
        newPath: '',
        error: errorMessage,
      });
    }
  }

  /**
   * Handle image rename request from webview
   * Renames the file and updates references in markdown files across workspace
   */
  private async handleRenameImage(
    message: { type: string; [key: string]: unknown },
    document: vscode.TextDocument,
    webview: vscode.Webview
  ): Promise<void> {
    const oldPath = message.oldPath as string;
    const newName = message.newName as string;
    const updateAllReferences = (message.updateAllReferences as boolean) ?? true;
    const allowOverwrite = (message.allowOverwrite as boolean) ?? false;

    console.log(`${BUILD_TAG} Renaming image: ${oldPath} to ${newName}`);

    try {
      // Resolve the old path
      const basePath = this.getImageBasePath(document);
      if (!basePath) {
        throw new Error('Cannot resolve image path: no base directory available');
      }

      const normalizedOldPath = normalizeImagePath(oldPath);
      const absoluteOldPath = path.resolve(basePath, normalizedOldPath);
      const oldUri = vscode.Uri.file(absoluteOldPath);

      // Check if old file exists
      try {
        await vscode.workspace.fs.stat(oldUri);
      } catch {
        throw new Error(`Image not found: ${oldPath}`);
      }

      // Get old filename (used for reference updates)
      const oldFilename = path.basename(absoluteOldPath);

      // Build new filename for manual rename:
      // - Respect the user's chosen name (no auto-dimensions, no auto prefix)
      const oldExt = path.extname(absoluteOldPath);
      const newFilename = buildImageFilenameForUserRename(newName, oldExt);

      const oldDir = path.dirname(absoluteOldPath);
      const absoluteNewPath = path.join(oldDir, newFilename);
      const newUri = vscode.Uri.file(absoluteNewPath);

      // Check if new file already exists
      let targetExists = false;
      try {
        await vscode.workspace.fs.stat(newUri);
        targetExists = true;
      } catch {
        targetExists = false;
      }

      if (targetExists && !allowOverwrite) {
        throw new Error(`File already exists: ${newFilename}`);
      }

      // Find all references if updating all files
      let references: Array<{ file: vscode.Uri; matches: Array<{ line: number; text: string }> }> =
        [];
      if (updateAllReferences) {
        references = await this.findImageReferences(oldPath, basePath);
      }

      if (targetExists && allowOverwrite) {
        try {
          await vscode.workspace.fs.delete(newUri, { useTrash: true });
        } catch (error) {
          console.warn(`${BUILD_TAG} Could not move existing file to trash, deleting directly: ${error}`);
          await vscode.workspace.fs.delete(newUri);
        }
      }

      // Rename the file
      await vscode.workspace.fs.rename(oldUri, newUri);
      console.log(`${BUILD_TAG} File renamed to: ${newFilename}`);

      // Calculate new relative path for markdown
      const newRelativePath = path.relative(basePath, absoluteNewPath).replace(/\\/g, '/');
      const normalizedNewPath = newRelativePath.startsWith('.')
        ? newRelativePath
        : `./${newRelativePath}`;

      // Update references
      let filesUpdated = 0;
      if (updateAllReferences && references.length > 0) {
        filesUpdated = await this.updateImageReferences(references, oldFilename, newFilename);
      } else {
        // Update only current document
        const docText = document.getText();
        const escapedOldFilename = oldFilename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const imagePathRegex = new RegExp(`([(/])${escapedOldFilename}([)"'])`, 'g');
        const updatedText = docText.replace(imagePathRegex, `$1${newFilename}$2`);

        if (updatedText !== docText) {
          const edit = new vscode.WorkspaceEdit();
          edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), updatedText);
          await vscode.workspace.applyEdit(edit);
          filesUpdated = 1;
        }
      }

      // Notify webview of success
      webview.postMessage({
        type: 'imageRenamed',
        success: true,
        oldPath,
        newPath: normalizedNewPath,
        filesUpdated,
      });

      if (filesUpdated > 1) {
        vscode.window.showInformationMessage(
          `Image renamed to ${newFilename} (updated ${filesUpdated} files)`
        );
      } else {
        vscode.window.showInformationMessage(`Image renamed to ${newFilename}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`${BUILD_TAG} Failed to rename image: ${errorMessage}`);
      vscode.window.showErrorMessage(`Failed to rename image: ${errorMessage}`);
      webview.postMessage({
        type: 'imageRenamed',
        success: false,
        error: errorMessage,
      });
    }
  }

  /**
   * Check if image is in workspace
   */
  private async handleCheckImageInWorkspace(
    message: { type: string; [key: string]: unknown },
    document: vscode.TextDocument,
    webview: vscode.Webview
  ): Promise<void> {
    const imagePath = message.imagePath as string;
    const requestId = message.requestId as string;

    try {
      // Resolve image path relative to document base path
      const basePath = this.getImageBasePath(document);
      if (!basePath) {
        webview.postMessage({
          type: 'imageWorkspaceCheck',
          requestId,
          inWorkspace: false,
          absolutePath: undefined,
        });
        return;
      }
      const normalizedPath = normalizeImagePath(imagePath);
      const absolutePath = path.resolve(basePath, normalizedPath);

      // Check if file exists
      const imageUri = vscode.Uri.file(absolutePath);
      let fileExists = false;
      try {
        await vscode.workspace.fs.stat(imageUri);
        fileExists = true;
      } catch {
        fileExists = false;
      }

      // Check if path is within workspace
      // For untitled files, getWorkspaceFolder may not work, so check workspaceFolders first
      let workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
      if (
        !workspaceFolder &&
        document.uri.scheme === 'untitled' &&
        vscode.workspace.workspaceFolders &&
        vscode.workspace.workspaceFolders.length > 0
      ) {
        workspaceFolder = vscode.workspace.workspaceFolders[0];
      }

      let inWorkspace = false;

      if (workspaceFolder && fileExists) {
        const workspacePath = workspaceFolder.uri.fsPath;
        // Check if absolute path is within workspace
        inWorkspace =
          absolutePath.startsWith(workspacePath + path.sep) || absolutePath === workspacePath;
      }

      webview.postMessage({
        type: 'imageWorkspaceCheck',
        requestId,
        inWorkspace,
        absolutePath: fileExists ? absolutePath : undefined,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`${BUILD_TAG} Failed to check image in workspace: ${errorMessage}`);
      webview.postMessage({
        type: 'imageWorkspaceCheck',
        requestId,
        inWorkspace: false,
        absolutePath: undefined,
      });
    }
  }

  /**
   * Get image metadata (file size, dimensions, last modified, etc.)
   */
  private async handleGetImageMetadata(
    message: { type: string; [key: string]: unknown },
    document: vscode.TextDocument,
    webview: vscode.Webview
  ): Promise<void> {
    const imagePath = message.imagePath as string;
    const requestId = message.requestId as string;

    try {
      // Resolve image path relative to document base path
      const basePath = this.getImageBasePath(document);
      if (!basePath) {
        webview.postMessage({
          type: 'imageMetadata',
          requestId,
          metadata: null,
        });
        return;
      }

      const normalizedPath = normalizeImagePath(imagePath);
      const absolutePath = path.resolve(basePath, normalizedPath);
      const imageUri = vscode.Uri.file(absolutePath);

      // Check if file exists
      let fileStat: vscode.FileStat;
      try {
        fileStat = await vscode.workspace.fs.stat(imageUri);
      } catch {
        webview.postMessage({
          type: 'imageMetadata',
          requestId,
          metadata: null,
        });
        return;
      }

      // Get image dimensions (requires reading the file)
      // For now, we'll use file size and last modified
      // Dimensions would require image decoding which is expensive
      // We can get dimensions from the img element in the webview instead
      const filename = path.basename(absolutePath);
      const relativePath = path.relative(basePath, absolutePath).replace(/\\/g, '/');
      const normalizedRelativePath = relativePath.startsWith('.')
        ? relativePath
        : `./${relativePath}`;

      webview.postMessage({
        type: 'imageMetadata',
        requestId,
        metadata: {
          filename,
          size: fileStat.size,
          dimensions: { width: 0, height: 0 }, // Will be filled by webview from img element
          lastModified: fileStat.mtime,
          path: normalizedRelativePath,
        },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`${BUILD_TAG} Failed to get image metadata: ${errorMessage}`);
      webview.postMessage({
        type: 'imageMetadata',
        requestId,
        metadata: null,
      });
    }
  }

  /**
   * Handle reveal image in OS file manager (Finder/Explorer)
   */
  private async handleRevealImageInOS(
    message: { type: string; [key: string]: unknown },
    document: vscode.TextDocument
  ): Promise<void> {
    const imagePath = message.imagePath as string;

    try {
      // Check if image is external (http/https/data URI)
      if (
        imagePath.startsWith('http://') ||
        imagePath.startsWith('https://') ||
        imagePath.startsWith('data:')
      ) {
        vscode.window.showErrorMessage('Cannot reveal external images in file manager');
        return;
      }

      // Resolve image path relative to document base path
      const basePath = this.getImageBasePath(document);
      if (!basePath) {
        vscode.window.showErrorMessage('Cannot reveal image: no base directory available');
        return;
      }

      const normalizedPath = normalizeImagePath(imagePath);
      const absolutePath = path.resolve(basePath, normalizedPath);
      const fileUri = vscode.Uri.file(absolutePath);

      // Check if file exists
      try {
        await vscode.workspace.fs.stat(fileUri);
      } catch {
        vscode.window.showErrorMessage(`Image not found: ${imagePath}`);
        return;
      }

      // Reveal file in OS file manager
      await vscode.commands.executeCommand('revealFileInOS', fileUri);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`${BUILD_TAG} Failed to reveal image in OS: ${errorMessage}`);
      vscode.window.showErrorMessage(`Failed to reveal image: ${errorMessage}`);
    }
  }

  /**
   * Handle reveal image in VS Code Explorer
   */
  private async handleRevealImageInExplorer(
    message: { type: string; [key: string]: unknown },
    document: vscode.TextDocument
  ): Promise<void> {
    const imagePath = message.imagePath as string;

    try {
      // Check if image is external (http/https/data URI)
      if (
        imagePath.startsWith('http://') ||
        imagePath.startsWith('https://') ||
        imagePath.startsWith('data:')
      ) {
        vscode.window.showErrorMessage('Cannot reveal external images in Explorer');
        return;
      }

      // Resolve image path relative to document base path
      const basePath = this.getImageBasePath(document);
      if (!basePath) {
        vscode.window.showErrorMessage('Cannot reveal image: no base directory available');
        return;
      }

      const normalizedPath = normalizeImagePath(imagePath);
      const absolutePath = path.resolve(basePath, normalizedPath);
      const fileUri = vscode.Uri.file(absolutePath);

      // Check if file exists
      try {
        await vscode.workspace.fs.stat(fileUri);
      } catch {
        vscode.window.showErrorMessage(`Image not found: ${imagePath}`);
        return;
      }

      // Reveal file in VS Code Explorer
      await vscode.commands.executeCommand('revealInExplorer', fileUri);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`${BUILD_TAG} Failed to reveal image in Explorer: ${errorMessage}`);
      vscode.window.showErrorMessage(`Failed to reveal image: ${errorMessage}`);
    }
  }

  /**
   * File extension categories for filtering
   */
  private readonly FILE_CATEGORIES = {
    md: ['.md', '.markdown'],
    images: ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp', '.ico'],
    code: [
      '.js',
      '.ts',
      '.jsx',
      '.tsx',
      '.py',
      '.java',
      '.cpp',
      '.c',
      '.h',
      '.go',
      '.rs',
      '.rb',
      '.php',
      '.swift',
      '.kt',
      '.cs',
      '.sh',
      '.bash',
      '.zsh',
      '.fish',
    ],
    config: ['.json', '.xml', '.yaml', '.yml', '.toml', '.ini', '.conf', '.config', '.properties'],
  };

  /**
   * Handle file search request from webview
   */
  private async handleSearchFiles(
    message: { type: string; [key: string]: unknown },
    webview: vscode.Webview
  ): Promise<void> {
    try {
      const query = (message.query as string) || '';
      const filters = (message.filters as {
        all?: boolean;
        md?: boolean;
        images?: boolean;
        code?: boolean;
        config?: boolean;
      }) || { all: true };
      const requestId = (message.requestId as number) || 0;

      console.log(`${BUILD_TAG} File search request:`, { query, filters, requestId });

      if (!query || query.trim().length < 1) {
        console.log(`${BUILD_TAG} Empty query, returning empty results`);
        webview.postMessage({
          type: 'fileSearchResults',
          results: [],
          requestId,
        });
        return;
      }

      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders || workspaceFolders.length === 0) {
        console.warn(`${BUILD_TAG} No workspace folders found`);
        webview.postMessage({
          type: 'fileSearchResults',
          results: [],
          requestId,
        });
        return;
      }

      // More permissive exclude pattern - only exclude truly unnecessary directories
      const excludePattern =
        '{**/node_modules/**,**/.git/**,**/.vscode/**,**/dist/**,**/build/**,**/.next/**,**/coverage/**}';
      console.log(`${BUILD_TAG} Searching files with pattern:`, excludePattern);

      // Increase max results to ensure we have enough files to search through
      const allFiles = await vscode.workspace.findFiles('**/*', excludePattern, 10000);
      console.log(`${BUILD_TAG} Found`, allFiles.length, 'files total');

      let filteredFiles = allFiles;
      if (!filters.all) {
        const allowedExtensions = new Set<string>();
        if (filters.md) {
          this.FILE_CATEGORIES.md.forEach(ext => allowedExtensions.add(ext));
        }
        if (filters.images) {
          this.FILE_CATEGORIES.images.forEach(ext => allowedExtensions.add(ext));
        }
        if (filters.code) {
          this.FILE_CATEGORIES.code.forEach(ext => allowedExtensions.add(ext));
        }
        if (filters.config) {
          this.FILE_CATEGORIES.config.forEach(ext => allowedExtensions.add(ext));
        }

        filteredFiles = allFiles.filter(uri => {
          const ext = path.extname(uri.fsPath).toLowerCase();
          return allowedExtensions.has(ext);
        });
        console.log(`${BUILD_TAG} After filter:`, filteredFiles.length, 'files');
      }

      const queryLower = query.toLowerCase().trim();
      const queryParts = queryLower.split(/\s+/).filter(p => p.length > 0);

      // Enhanced matching: search by filename, path, and individual query parts
      const matchingFiles = filteredFiles.filter(uri => {
        const filename = path.basename(uri.fsPath);
        const filenameLower = filename.toLowerCase();
        const relativePath = this.getRelativePath(uri, workspaceFolders[0].uri);
        const pathLower = relativePath.toLowerCase();

        // Primary match: filename contains query
        if (filenameLower.includes(queryLower)) {
          return true;
        }

        // Secondary match: path contains query
        if (pathLower.includes(queryLower)) {
          return true;
        }

        // Tertiary match: all query parts appear in filename or path
        if (queryParts.length > 1) {
          const allPartsMatch = queryParts.every(
            part => filenameLower.includes(part) || pathLower.includes(part)
          );
          if (allPartsMatch) {
            return true;
          }
        }

        // Match filename without extension
        const filenameWithoutExt = path.parse(filename).name.toLowerCase();
        if (filenameWithoutExt.includes(queryLower)) {
          return true;
        }

        return false;
      });

      console.log(`${BUILD_TAG} Found`, matchingFiles.length, 'matching files');

      // Sort results: exact filename matches first, then path matches, then partial matches
      const sortedFiles = matchingFiles.sort((a, b) => {
        const aFilename = path.basename(a.fsPath).toLowerCase();
        const bFilename = path.basename(b.fsPath).toLowerCase();
        const aPath = this.getRelativePath(a, workspaceFolders[0].uri).toLowerCase();
        const bPath = this.getRelativePath(b, workspaceFolders[0].uri).toLowerCase();

        // Exact filename match gets highest priority
        const aExactMatch = aFilename === queryLower;
        const bExactMatch = bFilename === queryLower;
        if (aExactMatch && !bExactMatch) return -1;
        if (!aExactMatch && bExactMatch) return 1;

        // Filename starts with query gets second priority
        const aStartsWith = aFilename.startsWith(queryLower);
        const bStartsWith = bFilename.startsWith(queryLower);
        if (aStartsWith && !bStartsWith) return -1;
        if (!aStartsWith && bStartsWith) return 1;

        // Filename contains query gets third priority
        const aFilenameContains = aFilename.includes(queryLower);
        const bFilenameContains = bFilename.includes(queryLower);
        if (aFilenameContains && !bFilenameContains) return -1;
        if (!aFilenameContains && bFilenameContains) return 1;

        // Path contains query gets fourth priority
        const aPathContains = aPath.includes(queryLower);
        const bPathContains = bPath.includes(queryLower);
        if (aPathContains && !bPathContains) return -1;
        if (!aPathContains && bPathContains) return 1;

        // Alphabetical by filename
        return aFilename.localeCompare(bFilename);
      });

      const results = sortedFiles.slice(0, 20).map(uri => {
        const filename = path.basename(uri.fsPath);
        const relativePath = this.getRelativePath(uri, workspaceFolders[0].uri);
        return {
          filename,
          path: relativePath,
        };
      });

      console.log(`${BUILD_TAG} Sending`, results.length, 'results to webview');
      webview.postMessage({
        type: 'fileSearchResults',
        results,
        requestId,
      });
    } catch (error) {
      console.error(`${BUILD_TAG} Error searching files:`, error);
      const requestId = (message.requestId as number) || 0;
      webview.postMessage({
        type: 'fileSearchResults',
        results: [],
        requestId,
        error: 'Failed to search files',
      });
    }
  }

  /**
   * Get relative path from workspace root
   */
  private getRelativePath(fileUri: vscode.Uri, workspaceUri: vscode.Uri): string {
    const filePath = fileUri.fsPath;
    const workspacePath = workspaceUri.fsPath;

    if (filePath.startsWith(workspacePath)) {
      let relative = path.relative(workspacePath, filePath);
      relative = relative.replace(/\\/g, '/');
      return relative;
    }

    return path.basename(filePath);
  }

  /**
   * Handle external link navigation (open in browser)
   */
  private async handleOpenExternalLink(message: {
    type: string;
    [key: string]: unknown;
  }): Promise<void> {
    try {
      const url = (message.url as string) || '';
      console.log(`${BUILD_TAG} handleOpenExternalLink called with URL:`, url);

      if (!url) {
        console.warn(`${BUILD_TAG} No URL provided for external link`);
        return;
      }

      // Validate URL format
      if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('mailto:')) {
        console.warn(`${BUILD_TAG} Invalid external URL format:`, url);
        return;
      }

      console.log(`${BUILD_TAG} Opening external link:`, url);
      await vscode.env.openExternal(vscode.Uri.parse(url));
      console.log(`${BUILD_TAG} Successfully opened external link`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`${BUILD_TAG} Failed to open external link:`, errorMessage, error);
      vscode.window.showErrorMessage(`Failed to open link: ${errorMessage}`);
    }
  }

  /**
   * Handle image link navigation (open image in VS Code preview)
   */
  private async handleOpenImage(
    message: { type: string; [key: string]: unknown },
    document: vscode.TextDocument
  ): Promise<void> {
    const imagePath = String(message.path || '');
    if (!imagePath) {
      console.warn(`${BUILD_TAG} No image path provided`);
      return;
    }

    console.log(`${BUILD_TAG} handleOpenImage called with path:`, imagePath);

    // Normalize path: remove ./ prefix if present for path resolution
    const normalizedPath = imagePath.startsWith('./') ? imagePath.slice(2) : imagePath;

    // Try document-relative first
    let baseDir: string | undefined;
    if (document.uri.scheme === 'file') {
      baseDir = path.dirname(document.uri.fsPath);
    } else {
      baseDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    }

    if (!baseDir) {
      console.error(`${BUILD_TAG} Cannot resolve image path: no base directory`);
      vscode.window.showWarningMessage('Cannot resolve image path');
      return;
    }

    let imageFullPath = path.resolve(baseDir, normalizedPath);
    let imageUri = vscode.Uri.file(imageFullPath);
    console.log(`${BUILD_TAG} Trying document-relative path:`, imageFullPath);

    // Check if file exists at document-relative path
    let fileExists = false;
    try {
      await vscode.workspace.fs.stat(imageUri);
      fileExists = true;
      console.log(`${BUILD_TAG} Image found at document-relative path`);
    } catch {
      console.log(`${BUILD_TAG} Image not found at document-relative path, trying workspace root`);

      // Fallback: try workspace root
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (workspaceFolder) {
        const workspacePath = workspaceFolder.uri.fsPath;
        imageFullPath = path.resolve(workspacePath, normalizedPath);
        imageUri = vscode.Uri.file(imageFullPath);
        console.log(`${BUILD_TAG} Trying workspace-relative path:`, imageFullPath);

        try {
          await vscode.workspace.fs.stat(imageUri);
          fileExists = true;
          console.log(`${BUILD_TAG} Image found at workspace-relative path`);
        } catch {
          console.log(`${BUILD_TAG} Image not found at workspace-relative path either`);
        }
      }
    }

    if (!fileExists) {
      const errorMsg = `Image not found: ${imagePath}`;
      console.error(`${BUILD_TAG}`, errorMsg);
      vscode.window.showErrorMessage(errorMsg);
      return;
    }

    try {
      console.log(`${BUILD_TAG} Opening image:`, imageUri.fsPath);
      await vscode.commands.executeCommand('vscode.open', imageUri);
      console.log(`${BUILD_TAG} Successfully opened image`);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(`${BUILD_TAG} Failed to open image:`, errorMessage, err);
      vscode.window.showErrorMessage(`Failed to open image: ${errorMessage}`);
    }
  }

  /**
   * Handle file link navigation (open file in VS Code)
   */
  private async handleOpenFileLink(
    message: { type: string; [key: string]: unknown },
    document: vscode.TextDocument
  ): Promise<void> {
    try {
      const filePath = (message.path as string) || '';
      console.log(`${BUILD_TAG} handleOpenFileLink called with path:`, filePath);

      if (!filePath) {
        console.warn(`${BUILD_TAG} No path provided for file link`);
        return;
      }

      // Resolve relative path from current document
      const basePath = path.dirname(document.uri.fsPath);

      // Normalize path: remove ./ prefix if present for path resolution
      const normalizedFilePath = filePath.startsWith('./') ? filePath.slice(2) : filePath;
      const absolutePath = path.resolve(basePath, normalizedFilePath);
      let fileUri = vscode.Uri.file(absolutePath);
      console.log(`${BUILD_TAG} Resolved file URI (document-relative):`, fileUri.fsPath);

      // Check if file exists
      let fileExists = false;
      try {
        await vscode.workspace.fs.stat(fileUri);
        fileExists = true;
        console.log(`${BUILD_TAG} File exists (document-relative):`, fileUri.fsPath);
      } catch {
        // File doesn't exist, try to find it in workspace
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
          // Try relative to workspace root
          const workspacePath = workspaceFolders[0].uri.fsPath;
          // Use normalized path (already normalized above)
          const workspaceFileUri = vscode.Uri.file(path.resolve(workspacePath, normalizedFilePath));
          console.log(`${BUILD_TAG} Trying workspace-relative path:`, workspaceFileUri.fsPath);
          try {
            await vscode.workspace.fs.stat(workspaceFileUri);
            fileUri = workspaceFileUri;
            fileExists = true;
            console.log(`${BUILD_TAG} File exists (workspace-relative):`, fileUri.fsPath);
          } catch {
            // Not found in workspace either
            console.log(`${BUILD_TAG} File not found in workspace-relative path`);
          }
        }
      }

      if (!fileExists) {
        // File not found, show error
        vscode.window.showWarningMessage(`File not found: ${filePath}`);
        console.warn(`${BUILD_TAG} File not found:`, filePath);
        return;
      }

      // Check if file is an image
      const imageExtensions = [
        '.png',
        '.jpg',
        '.jpeg',
        '.gif',
        '.svg',
        '.webp',
        '.bmp',
        '.ico',
        '.tiff',
        '.tif',
      ];
      const fileExtension = path.extname(fileUri.fsPath).toLowerCase();
      const isImage = imageExtensions.includes(fileExtension);
      console.log(`${BUILD_TAG} File extension:`, fileExtension, '| Is image:', isImage);

      if (isImage) {
        // For image files, use vscode.open command directly
        // This automatically opens images in VS Code's image preview
        console.log(`${BUILD_TAG} Attempting to open image file with vscode.open command`);
        try {
          await vscode.commands.executeCommand('vscode.open', fileUri);
          console.log(`${BUILD_TAG} Successfully opened image file:`, fileUri.fsPath);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.error(`${BUILD_TAG} Failed to open image file:`, errorMessage, error);
          vscode.window.showErrorMessage(`Failed to open image file: ${errorMessage}`);
        }
      } else {
        // For text files, use openTextDocument
        console.log(`${BUILD_TAG} Attempting to open text file with openTextDocument`);
        try {
          const doc = await vscode.workspace.openTextDocument(fileUri);
          await vscode.window.showTextDocument(doc);
          console.log(`${BUILD_TAG} Successfully opened file link:`, fileUri.fsPath);
        } catch (error) {
          // If it's not a text file, try vscode.open command as fallback
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.log(`${BUILD_TAG} openTextDocument failed, error:`, errorMessage);
          if (errorMessage.includes('Binary') || errorMessage.includes('binary')) {
            console.log(`${BUILD_TAG} File is binary, trying vscode.open command as fallback`);
            try {
              await vscode.commands.executeCommand('vscode.open', fileUri);
              console.log(`${BUILD_TAG} Opened binary file using vscode.open command`);
            } catch (fallbackError) {
              console.error(`${BUILD_TAG} Failed to open file:`, fallbackError);
              vscode.window.showErrorMessage(`Failed to open file: ${errorMessage}`);
            }
          } else {
            throw error;
          }
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`${BUILD_TAG} Failed to open file link:`, errorMessage, error);
      vscode.window.showErrorMessage(`Failed to open file: ${errorMessage}`);
    }
  }

  /**
   * Copy local image (outside workspace) to workspace
   */
  private async handleCopyLocalImageToWorkspace(
    message: { type: string; [key: string]: unknown },
    document: vscode.TextDocument,
    webview: vscode.Webview
  ): Promise<void> {
    const absolutePath = message.absolutePath as string;
    const placeholderId = message.placeholderId as string;
    const targetFolder = (message.targetFolder as string) || 'images';

    console.log(`${BUILD_TAG} Copying local image to workspace: ${absolutePath}`);

    try {
      // Read the source image
      const sourceUri = vscode.Uri.file(absolutePath);
      const imageData = await vscode.workspace.fs.readFile(sourceUri);

      const saveBasePath = this.getImageStorageBasePath(document);
      if (!saveBasePath) {
        const errorMessage = 'Cannot copy image: no base directory available';
        vscode.window.showErrorMessage(errorMessage);
        webview.postMessage({
          type: 'localImageCopyError',
          placeholderId,
          error: errorMessage,
        });
        return;
      }
      const imagesDir = path.join(saveBasePath, targetFolder);

      // Create folder if needed
      await vscode.workspace.fs.createDirectory(vscode.Uri.file(imagesDir));

      // Generate filename from source
      const sourceFilename = path.basename(absolutePath);
      const parsedName = path.parse(sourceFilename);
      const baseFilename = parsedName.name || 'image';
      const extension = parsedName.ext || '';

      let finalFilename = sourceFilename;
      let targetPath = path.join(imagesDir, finalFilename);
      let targetUri = vscode.Uri.file(targetPath);

      const fileExists = async (uri: vscode.Uri): Promise<boolean> => {
        try {
          await vscode.workspace.fs.stat(uri);
          return true;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (message.includes('ENOENT') || message.includes('FileNotFound')) {
            return false;
          }
          throw error;
        }
      };

      if (await fileExists(targetUri)) {
        let foundAvailableName = false;
        for (let suffix = 2; suffix < 1000; suffix += 1) {
          finalFilename = `${baseFilename}-${suffix}${extension}`;
          targetPath = path.join(imagesDir, finalFilename);
          targetUri = vscode.Uri.file(targetPath);
          if (!(await fileExists(targetUri))) {
            foundAvailableName = true;
            break;
          }
        }
        if (!foundAvailableName) {
          throw new Error(
            `Cannot copy image: too many existing files matching "${baseFilename}-N${extension}"`
          );
        }
      }

      // Copy file to workspace
      await vscode.workspace.fs.writeFile(targetUri, imageData);

      // Calculate relative path for markdown
      const markdownDir =
        document.uri.scheme === 'file' ? path.dirname(document.uri.fsPath) : saveBasePath;
      let relativePath = path.relative(markdownDir, targetPath).replace(/\\/g, '/');
      if (!relativePath.startsWith('..') && !relativePath.startsWith('./')) {
        relativePath = './' + relativePath;
      }

      console.log(`${BUILD_TAG} Local image copied successfully. Path: ${relativePath}`);

      webview.postMessage({
        type: 'localImageCopied',
        placeholderId,
        relativePath,
        originalPath: absolutePath, // For finding the image node
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`${BUILD_TAG} Failed to copy local image: ${errorMessage}`);
      vscode.window.showErrorMessage(`Failed to copy image: ${errorMessage}`);
      webview.postMessage({
        type: 'localImageCopyError',
        placeholderId,
        error: errorMessage,
      });
    }
  }

  /**
   * Handle setting update request from webview
   */
  private async handleUpdateSetting(
    message: { type: string; [key: string]: unknown },
    webview: vscode.Webview
  ): Promise<void> {
    const key = message.key as string;
    const value = message.value as unknown;

    try {
      const config = vscode.workspace.getConfiguration();
      await config.update(key, value, vscode.ConfigurationTarget.Global);

      // Immediately notify webview of the setting change
      // This ensures the setting takes effect right away without waiting for next update
      const skipWarning = config.get<boolean>('markdownForHumans.imageResize.skipWarning', false);
      const imagePath = config.get<string>('markdownForHumans.imagePath', 'images');
      const imagePathBase = config.get<string>(
        'markdownForHumans.imagePathBase',
        'relativeToDocument'
      );
      webview.postMessage({
        type: 'settingsUpdate',
        skipResizeWarning: skipWarning,
        imagePath: imagePath,
        imagePathBase: imagePathBase,
        displaySettings: this.getDisplaySettings(),
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`${BUILD_TAG} Failed to update setting: ${errorMessage}`);
    }
  }

  /**
   * Apply edits from webview to TextDocument
   * Marks the edit with a timestamp to prevent feedback loops
   *
   * @param content - Markdown content from webview (may include wrapped frontmatter)
   * @param document - Target VS Code document to update
   * @returns Promise resolving to true if edit succeeded, false otherwise
   * @throws Never - errors are caught and shown to user
   */
  private async applyEdit(content: string, document: vscode.TextDocument): Promise<boolean> {
    // Skip if content unchanged (avoid redundant edits)
    const unwrappedContent = this.unwrapFrontmatterFromWebview(content);
    if (unwrappedContent === document.getText()) {
      return true;
    }

    // Mark this edit to prevent feedback loop
    const docUri = document.uri.toString();
    this.pendingEdits.set(docUri, Date.now());
    this.lastWebviewContent.set(docUri, unwrappedContent);

    const edit = new vscode.WorkspaceEdit();

    // Replace entire document content
    const fullRange = new vscode.Range(
      document.positionAt(0),
      document.positionAt(document.getText().length)
    );

    edit.replace(document.uri, fullRange, unwrappedContent);

    try {
      const success = await vscode.workspace.applyEdit(edit);
      if (!success) {
        const errorMsg = 'Failed to save changes. The file may be read-only or locked.';
        vscode.window.showErrorMessage(errorMsg);
        console.error(`${BUILD_TAG} applyEdit failed:`, { uri: docUri });
      }
      return success;
    } catch (error) {
      const errorMsg =
        error instanceof Error
          ? `Failed to save changes: ${error.message}`
          : 'Failed to save changes: Unknown error';
      vscode.window.showErrorMessage(errorMsg);
      console.error(`${BUILD_TAG} applyEdit exception:`, error);
      return false;
    }
  }

  /**
   * Wrap YAML frontmatter in a fenced code block for webview rendering.
   * Returns original content when no frontmatter is present.
   */
  private wrapFrontmatterForWebview(content: string): string {
    const match = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/);
    if (!match) return content;

    const usesCrLf = match[0].includes('\r\n');
    const newline = usesCrLf ? '\r\n' : '\n';
    const frontmatterBlock = match[0].replace(/\s+$/, ''); // keep delimiters
    const body = content.slice(match[0].length);

    const pieces = ['```yaml', frontmatterBlock, '```'];
    if (body.length > 0) {
      // Ensure exactly one blank line between fenced block and body
      const trimmedBody =
        body.startsWith('\n') || body.startsWith('\r\n') ? body.replace(/^\r?\n/, '') : body;
      pieces.push('', trimmedBody);
    }

    return pieces.join(newline);
  }

  /**
   * Unwrap a fenced frontmatter code block back to YAML delimiters.
   * If no wrapped frontmatter is detected, returns the original content.
   */
  private unwrapFrontmatterFromWebview(content: string): string {
    if (!content.startsWith('```')) return content;

    const usesCrLf = content.includes('\r\n');
    const newline = usesCrLf ? '\r\n' : '\n';
    const lines = content.split(newline);

    const firstLine = lines[0].trim().toLowerCase();
    if (firstLine !== '```yaml' && firstLine !== '```yml' && firstLine !== '```json') {
      return content;
    }

    const closingIndex = lines.findIndex((line, idx) => idx > 0 && line.trim() === '```');
    if (closingIndex === -1) return content;

    const insideLines = lines.slice(1, closingIndex);
    // Expect inside to start with '---'
    if (insideLines.length === 0 || insideLines[0].trim() !== '---') {
      return content;
    }

    const frontmatterSection = insideLines.join(newline);
    const bodyLines = lines.slice(closingIndex + 1);
    const body = bodyLines.join(newline);

    const separator = body.length > 0 ? newline : '';
    return frontmatterSection + separator + body;
  }

  /**
   * Generate HTML for webview
   */
  private getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview.js')
    );

    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview.css')
    );

    // Use a nonce for security
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
        <title>Markdown for Humans</title>
      </head>
      <body>
        <div id="editor"></div>
        <script nonce="${nonce}" src="${scriptUri}"></script>
      </body>
      </html>
    `;
  }
}

function getNonce() {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

/**
 * Normalize an image path by URL-decoding each path segment.
 *
 * Handles paths like:
 * - `images/Hero%20Image.png` → `images/Hero Image.png`
 * - `../assets/My%20Diagram%201.png` → `../assets/My Diagram 1.png`
 * - `./screenshots/test.png` → `./screenshots/test.png` (unchanged)
 *
 * This makes the editor tolerant of URL-encoded paths commonly found in
 * markdown imported from web tools, GitHub, or static site generators.
 *
 * @param imagePath - The raw image path from markdown src attribute
 * @returns Normalized path with URL-encoded segments decoded
 */
export function normalizeImagePath(imagePath: string): string {
  // Don't touch remote URLs, data URIs, or already-resolved webview URIs
  if (
    imagePath.startsWith('http://') ||
    imagePath.startsWith('https://') ||
    imagePath.startsWith('data:') ||
    imagePath.startsWith('vscode-webview://')
  ) {
    return imagePath;
  }

  // Handle file:// URIs by stripping the scheme and decoding
  if (imagePath.startsWith('file://')) {
    try {
      return decodeURIComponent(imagePath.replace('file://', ''));
    } catch {
      return imagePath.replace('file://', '');
    }
  }

  // Split on forward slashes, decode each segment, rejoin
  // This preserves directory structure while decoding %20, %23, etc.
  return imagePath
    .split('/')
    .map(segment => {
      if (segment === '' || segment === '.' || segment === '..') {
        return segment;
      }
      try {
        return decodeURIComponent(segment);
      } catch {
        // If decoding fails (malformed %), return segment as-is
        return segment;
      }
    })
    .join('/');
}
