/**
 * Copyright (c) 2025-2026 Concret.io
 *
 * Licensed under the MIT License. See LICENSE file in the project root for details.
 *
 * Plan overlay UI injected into the main editor webview.
 * Displays proposed changes with reasoning, allows the user to review each range
 * and provide per-range comments without modifying the document.
 */

import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { buildLineToPositionMap } from './extensions/lineNumbers';
import { createFormattingToolbar } from './BubbleMenuView';
import { scrollToPos } from './utils/scrollToHeading';
import { getEditorMarkdownForSync } from './utils/markdownSerialization';

const PLAN_PENDING_HANDOFF_MS = 110 * 1000;

// --- Types ---

interface PlanRange {
  start: number;
  end: number;
}

interface PlanReplacement {
  range: PlanRange;
  proposed_change: string;
}

interface PlanInitData {
  id: string;
  file: string | null;
  proposed_replacements: PlanReplacement[];
}

interface PlanRowState {
  status: 'pending' | 'commented' | 'no_response' | 'accepted' | 'rejected';
  user_comment: string | null;
}

// --- Module state ---

let overlayEl: HTMLElement | null = null;
let spacerEl: HTMLElement | null = null;
let mainEditor: Editor | null = null;
let acceptBtnEl: HTMLButtonElement | null = null;
let rejectBtnEl: HTMLButtonElement | null = null;
let noResponseBtnEl: HTMLButtonElement | null = null;
let proposedChangeEditor: Editor | null = null;
let responseEditor: Editor | null = null;
let currentData: PlanInitData | null = null;
let rowStates: PlanRowState[] = [];
let selectedIndex = 0;
let pendingTimer: number | null = null;
let validationWarningTimer: number | null = null;
let validationWarningRegionEl: HTMLElement | null = null;
let vscodeApi: { postMessage: (msg: any) => void } | null = null;

// Navigation history references (set by initializePlanOverlay)
let navRecordFn: ((pos: number, immediate?: boolean) => void) | null = null;

// --- Public API ---

export function initializePlanOverlay(
  data: PlanInitData,
  editor: Editor,
  vsApi: { postMessage: (msg: any) => void },
  navRecord: (pos: number, immediate?: boolean) => void
): void {
  // Destroy any existing overlay
  destroyPlanOverlay();

  mainEditor = editor;
  currentData = data;
  vscodeApi = vsApi;
  navRecordFn = navRecord;
  selectedIndex = 0;
  rowStates = data.proposed_replacements.map(() => ({
    status: 'pending',
    user_comment: null,
  }));

  buildOverlay();

  // Start pending handoff timer
  pendingTimer = window.setTimeout(() => {
    vscodeApi?.postMessage({ type: 'planPending' });
  }, PLAN_PENDING_HANDOFF_MS);

  // Notify extension that the overlay is ready
  vscodeApi?.postMessage({ type: 'planReady' });

  // Select the first range
  selectRow(0);
}

export function destroyPlanOverlay(): void {
  if (pendingTimer !== null) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
  }
  if (validationWarningTimer !== null) {
    clearTimeout(validationWarningTimer);
    validationWarningTimer = null;
  }

  proposedChangeEditor?.destroy();
  proposedChangeEditor = null;
  responseEditor?.destroy();
  responseEditor = null;

  overlayEl?.remove();
  overlayEl = null;
  spacerEl?.remove();
  spacerEl = null;

  mainEditor = null;
  currentData = null;
  rowStates = [];
  selectedIndex = 0;
  validationWarningRegionEl = null;
  vscodeApi = null;
  navRecordFn = null;
}

export function selectNextRange(): void {
  if (!currentData) return;
  const next = (selectedIndex + 1) % currentData.proposed_replacements.length;
  selectRow(next);
}

export function selectPreviousRange(): void {
  if (!currentData) return;
  const prev = (selectedIndex - 1 + currentData.proposed_replacements.length) % currentData.proposed_replacements.length;
  selectRow(prev);
}

export function isPlanOverlayActive(): boolean {
  return overlayEl !== null;
}

// --- Build overlay DOM ---

function buildOverlay(): void {
  if (!currentData) return;

  const editorContainer = document.querySelector('.markdown-editor') || document.getElementById('editor');
  if (!editorContainer?.parentElement) return;

  overlayEl = document.createElement('div');
  overlayEl.className = 'plan-overlay';

  // --- Range column (left) ---
  const rangeColumnWrap = document.createElement('div');
  rangeColumnWrap.className = 'plan-range-column-wrap';

  const rangeLabel = document.createElement('div');
  rangeLabel.className = 'plan-section-label';
  rangeLabel.textContent = 'Ranges';
  rangeColumnWrap.appendChild(rangeLabel);

  const rangeColumn = document.createElement('div');
  rangeColumn.className = 'plan-range-column';

  currentData.proposed_replacements.forEach((replacement, index) => {
    const row = document.createElement('div');
    row.className = 'plan-range-row';
    row.dataset.index = String(index);

    const label = replacement.range.start === replacement.range.end
      ? `${replacement.range.start}`
      : `${replacement.range.start}-${replacement.range.end}`;
    row.textContent = label;

    row.addEventListener('click', () => selectRow(index));
    rangeColumn.appendChild(row);
  });

  rangeColumnWrap.appendChild(rangeColumn);

  // --- Right side ---
  const rightSide = document.createElement('div');
  rightSide.className = 'plan-right-side';

  // Proposed change pane (top, read-only)
  const proposedLabel = document.createElement('div');
  proposedLabel.className = 'plan-section-label';
  proposedLabel.textContent = 'Proposed Change';

  const proposedPaneWrap = document.createElement('div');
  proposedPaneWrap.className = 'plan-proposed-change';

  const proposedEditorEl = document.createElement('div');
  proposedEditorEl.className = 'plan-proposed-editor markdown-editor';
  proposedPaneWrap.appendChild(proposedEditorEl);

  const proposedExtensions = [StarterKit, Markdown];
  proposedChangeEditor = new Editor({
    element: proposedEditorEl,
    extensions: proposedExtensions,
    editable: false,
    content: '',
  });

  // Response pane (bottom, editable)
  const responseLabel = document.createElement('div');
  responseLabel.className = 'plan-section-label';
  responseLabel.textContent = 'Your Response';

  const responsePaneWrap = document.createElement('div');
  responsePaneWrap.className = 'plan-response';

  const responseEditorEl = document.createElement('div');
  responseEditorEl.className = 'plan-response-editor markdown-editor';
  responsePaneWrap.appendChild(responseEditorEl);

  const responseExtensions = [StarterKit, Markdown];
  responseEditor = new Editor({
    element: responseEditorEl,
    extensions: responseExtensions,
    editable: true,
    content: '',
  });

  // Create toolbar for response editor (formatting buttons only)
  const toolbar = createFormattingToolbar(responseEditor, { filter: 'formatting-only' });
  toolbar.classList.add('plan-response-toolbar');

  // Dispatch editorFocusChange so the toolbar stays enabled while the response editor is focused
  const responseDom = responseEditor.view.dom;
  responseDom.addEventListener('focus', () => {
    window.dispatchEvent(new CustomEvent('editorFocusChange', { detail: { focused: true } }));
  });
  responseDom.addEventListener('blur', (event: FocusEvent) => {
    const relatedTarget = event.relatedTarget as HTMLElement | null;
    // Stay "focused" if moving to toolbar or any other element within the overlay
    const stayingInOverlay = Boolean(relatedTarget && overlayEl?.contains(relatedTarget));
    if (stayingInOverlay) return;
    setTimeout(() => {
      const activeElement = document.activeElement as HTMLElement | null;
      if (activeElement && overlayEl?.contains(activeElement)) return;
      window.dispatchEvent(new CustomEvent('editorFocusChange', { detail: { focused: false } }));
    }, 0);
  });

  // --- Buttons ---
  const buttonBar = document.createElement('div');
  buttonBar.className = 'plan-buttons';

  validationWarningRegionEl = document.createElement('div');
  validationWarningRegionEl.className = 'plan-validation-region';
  validationWarningRegionEl.setAttribute('aria-live', 'polite');
  buttonBar.appendChild(validationWarningRegionEl);

  const acceptBtn = document.createElement('button');
  acceptBtn.className = 'plan-btn plan-btn-secondary';
  acceptBtn.textContent = 'Accept';
  acceptBtn.title = 'Accept this proposed change (subject to comments)';
  acceptBtn.addEventListener('click', () => handleAcceptReject('accepted'));
  acceptBtnEl = acceptBtn;

  const rejectBtn = document.createElement('button');
  rejectBtn.className = 'plan-btn plan-btn-secondary';
  rejectBtn.textContent = 'Reject';
  rejectBtn.title = 'Reject this proposed change (subject to comments)';
  rejectBtn.addEventListener('click', () => handleAcceptReject('rejected'));
  rejectBtnEl = rejectBtn;

  const noResponseBtn = document.createElement('button');
  noResponseBtn.className = 'plan-btn plan-btn-secondary';
  noResponseBtn.textContent = 'No Response';
  noResponseBtn.title = 'Make no response to this proposed change';
  noResponseBtn.addEventListener('click', handleNoComment);
  noResponseBtnEl = noResponseBtn;

  const nextChangeBtn = document.createElement('button');
  nextChangeBtn.className = 'plan-btn plan-btn-secondary';
  nextChangeBtn.textContent = 'Next Change';
  nextChangeBtn.title = 'Move to the next proposed change';
  nextChangeBtn.addEventListener('click', () => selectNextRange());

  const skipRemainingBtn = document.createElement('button');
  skipRemainingBtn.className = 'plan-btn plan-btn-secondary';
  skipRemainingBtn.textContent = 'Skip Remaining';
  skipRemainingBtn.title = 'Skip all unreviewed ranges and submit';
  skipRemainingBtn.addEventListener('click', handleSkipAll);

  const submitBtn = document.createElement('button');
  submitBtn.className = 'plan-btn plan-btn-primary';
  submitBtn.textContent = 'Submit';
  submitBtn.title = 'Submit all responses';
  submitBtn.addEventListener('click', handleSubmit);

  buttonBar.appendChild(acceptBtn);
  buttonBar.appendChild(rejectBtn);
  buttonBar.appendChild(noResponseBtn);
  buttonBar.appendChild(nextChangeBtn);
  buttonBar.appendChild(skipRemainingBtn);
  buttonBar.appendChild(submitBtn);

  // --- Assemble right side ---
  rightSide.appendChild(proposedLabel);
  rightSide.appendChild(proposedPaneWrap);
  rightSide.appendChild(responseLabel);
  rightSide.appendChild(toolbar);
  rightSide.appendChild(responsePaneWrap);
  rightSide.appendChild(buttonBar);

  // --- Assemble overlay ---
  overlayEl.appendChild(rangeColumnWrap);
  overlayEl.appendChild(rightSide);

  // Position overlay below the main formatting toolbar and to the right of the nav pane
  const mainToolbar = document.querySelector('.formatting-toolbar');
  const mainToolbarHeight = mainToolbar ? mainToolbar.getBoundingClientRect().height : 0;
  overlayEl.style.top = `${mainToolbarHeight}px`;

  const editorElement = document.querySelector('#editor') as HTMLElement;
  const editorMarginLeft = editorElement ? parseInt(editorElement.style.marginLeft || '0', 10) : 0;
  overlayEl.style.left = `${editorMarginLeft}px`;
  overlayEl.style.width = `calc(100% - ${editorMarginLeft}px)`;

  // Insert at top of editor area
  editorContainer.parentElement.insertBefore(overlayEl, editorContainer);

  // Add spacer to push content below the fixed overlay
  spacerEl = document.createElement('div');
  spacerEl.className = 'plan-overlay-spacer';
  editorContainer.parentElement.insertBefore(spacerEl, editorContainer);

  // Size the spacer to match the overlay height once it renders
  requestAnimationFrame(() => {
    if (overlayEl && spacerEl) {
      spacerEl.style.height = `${overlayEl.getBoundingClientRect().height}px`;
    }
  });

  // Keyboard navigation for range column
  rangeColumn.tabIndex = 0;
  rangeColumn.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectNextRange();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectPreviousRange();
    }
  });
}

// --- Row selection ---

function selectRow(index: number): void {
  if (!currentData || index < 0 || index >= currentData.proposed_replacements.length) return;

  // Save current response before switching
  saveCurrentResponse();

  selectedIndex = index;
  const replacement = currentData.proposed_replacements[index];

  // Update range column highlight
  const rows = overlayEl?.querySelectorAll('.plan-range-row');
  rows?.forEach((row, i) => {
    row.classList.toggle('plan-range-row-selected', i === index);
  });

  // Update status indicators
  rows?.forEach((row, i) => {
    row.classList.toggle('plan-range-row-commented', rowStates[i]?.status === 'commented');
    row.classList.toggle('plan-range-row-no-comment', rowStates[i]?.status === 'no_response');
    row.classList.toggle('plan-range-row-accepted', rowStates[i]?.status === 'accepted');
    row.classList.toggle('plan-range-row-rejected', rowStates[i]?.status === 'rejected');
  });

  // Update proposed change pane
  if (proposedChangeEditor) {
    proposedChangeEditor.commands.setContent(replacement.proposed_change, { contentType: 'markdown' });
  }

  // Restore response for this row
  if (responseEditor) {
    const savedComment = rowStates[index]?.user_comment;
    if (savedComment) {
      responseEditor.commands.setContent(savedComment, { contentType: 'markdown' });
    } else {
      responseEditor.commands.clearContent();
    }
  }

  // Scroll the main editor to the target lines
  scrollToRange(replacement.range);

  // Highlight previously-clicked action button
  updateActionButtonHighlights(rowStates[index]?.status ?? 'pending');
}

function saveCurrentResponse(): void {
  if (!responseEditor || !currentData) return;
  const markdown = getEditorMarkdownForSync(responseEditor) ?? responseEditor.getText();
  const trimmed = markdown.trim();

  if (rowStates[selectedIndex]) {
    // Save comment text regardless of status
    if (trimmed) {
      rowStates[selectedIndex].user_comment = trimmed;
      // Only upgrade to 'commented' if still pending
      if (rowStates[selectedIndex].status === 'pending') {
        rowStates[selectedIndex].status = 'commented';
      }
    }
    // If no text and still pending, leave as pending
  }
}

/** Find the nearest mapped line within a range, searching outward from target toward bound. */
function findNearestMappedLine(
  lineMap: Map<number, { from: number; to: number }>,
  target: number,
  bound: number
): { from: number; to: number } | null {
  if (lineMap.has(target)) return lineMap.get(target)!;
  // Search toward bound
  const step = bound > target ? 1 : -1;
  for (let line = target + step; step > 0 ? line <= bound : line >= bound; line += step) {
    if (lineMap.has(line)) return lineMap.get(line)!;
  }
  return null;
}

function scrollToRange(range: PlanRange): void {
  if (!mainEditor) return;

  // Build complete line→position map using gutter-matching logic
  const lineMap = buildLineToPositionMap(mainEditor);

  // Find positions for the start and end lines, searching nearby lines as fallback
  const startPos = findNearestMappedLine(lineMap, range.start, range.end);
  const endPos = findNearestMappedLine(lineMap, range.end, range.start);

  if (!startPos && !endPos) return;

  const from = startPos ? startPos.from : endPos!.from;
  const to = endPos ? endPos.to : startPos!.to;

  // Push to navigation history
  if (navRecordFn) {
    navRecordFn(from, true);
  }

  // Scroll to center without stealing focus from the overlay
  scrollToPos(mainEditor, from, true, true);

  // Apply selection and focus the editor so the selection is visible
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (!mainEditor) return;
      mainEditor.commands.setTextSelection({ from, to });
      mainEditor.commands.focus();
    });
  });
}

// --- Helpers ---

function updateActionButtonHighlights(status: string): void {
  acceptBtnEl?.classList.toggle('plan-btn-active', status === 'accepted');
  rejectBtnEl?.classList.toggle('plan-btn-active', status === 'rejected');
  noResponseBtnEl?.classList.toggle('plan-btn-active', status === 'no_response');
}

function updateRowStatusIndicators(): void {
  const rows = overlayEl?.querySelectorAll('.plan-range-row');
  rows?.forEach((row, i) => {
    row.classList.toggle('plan-range-row-commented', rowStates[i]?.status === 'commented');
    row.classList.toggle('plan-range-row-no-comment', rowStates[i]?.status === 'no_response');
    row.classList.toggle('plan-range-row-accepted', rowStates[i]?.status === 'accepted');
    row.classList.toggle('plan-range-row-rejected', rowStates[i]?.status === 'rejected');
  });
}

// --- Button handlers ---

function handleAcceptReject(action: 'accepted' | 'rejected'): void {
  if (!currentData) return;
  clearValidationWarning();

  // Save any typed comment first
  saveCurrentResponse();

  if (rowStates[selectedIndex]) {
    rowStates[selectedIndex].status = action;
    // Keep user_comment if they typed one
  }

  // Update status indicators
  updateRowStatusIndicators();
  updateActionButtonHighlights(action);

  // Advance to next row
  selectNextRange();
}

function handleNoComment(): void {
  if (!currentData) return;
  clearValidationWarning();

  // Mark current row as no_response
  if (rowStates[selectedIndex]) {
    rowStates[selectedIndex].status = 'no_response';
    rowStates[selectedIndex].user_comment = null;
  }

  // Clear response editor
  if (responseEditor) {
    responseEditor.commands.clearContent();
  }

  // Update status indicator
  const rows = overlayEl?.querySelectorAll('.plan-range-row');
  if (rows?.[selectedIndex]) {
    rows[selectedIndex].classList.add('plan-range-row-no-comment');
    rows[selectedIndex].classList.remove('plan-range-row-commented');
  }

  // Advance to next row
  if (selectedIndex < currentData.proposed_replacements.length - 1) {
    selectRow(selectedIndex + 1);
  }
}

function handleSkipAll(): void {
  if (!currentData) return;
  clearValidationWarning();

  // Save current response first
  saveCurrentResponse();

  // Preserve reviewed rows, mark pending as skipped
  const results = currentData.proposed_replacements.map((r, i) => ({
    status: rowStates[i]?.status === 'pending' ? 'skipped' as const :
            rowStates[i]?.status as 'commented' | 'no_response' | 'accepted' | 'rejected',
    range: r.range,
    proposed_change: r.proposed_change,
    user_comment: rowStates[i]?.user_comment ?? null,
  }));

  if (pendingTimer !== null) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
  }

  vscodeApi?.postMessage({ type: 'planResponse', results });
  destroyPlanOverlay();
}

function handleSubmit(): void {
  if (!currentData) return;
  clearValidationWarning();

  // Save current response first
  saveCurrentResponse();

  // Check for uncommented rows
  const uncommented: number[] = [];
  rowStates.forEach((state, i) => {
    if (state.status === 'pending') {
      uncommented.push(i);
    }
  });

  if (uncommented.length > 0) {
    // Show warning and navigate to first uncommented row
    const lineLabels = uncommented.map(i => {
      const r = currentData!.proposed_replacements[i].range;
      return r.start === r.end ? `${r.start}` : `${r.start}-${r.end}`;
    }).join(', ');

    showValidationWarning(`Please respond to ${lineLabels} or click 'No Response'`);
    selectRow(uncommented[0]);
    return;
  }

  // All rows have been addressed — submit
  const results = currentData.proposed_replacements.map((r, i) => ({
    status: rowStates[i].status as 'commented' | 'no_response' | 'accepted' | 'rejected',
    range: r.range,
    proposed_change: r.proposed_change,
    user_comment: rowStates[i].user_comment,
  }));

  if (pendingTimer !== null) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
  }

  vscodeApi?.postMessage({ type: 'planResponse', results });
  destroyPlanOverlay();
}

function showValidationWarning(message: string): void {
  clearValidationWarning();

  if (!validationWarningRegionEl) {
    return;
  }

  const toast = document.createElement('div');
  toast.className = 'plan-validation-warning';
  toast.textContent = message;
  toast.setAttribute('role', 'alert');
  toast.setAttribute('aria-atomic', 'true');

  validationWarningRegionEl.replaceChildren(toast);

  validationWarningTimer = window.setTimeout(() => {
    clearValidationWarning();
  }, 5000);
}

function clearValidationWarning(): void {
  if (validationWarningTimer !== null) {
    clearTimeout(validationWarningTimer);
    validationWarningTimer = null;
  }

  validationWarningRegionEl?.replaceChildren();
}
