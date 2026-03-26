/**
 * Copyright (c) 2025-2026 Concret.io
 *
 * Licensed under the MIT License. See LICENSE file in the project root for details.
 */

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { getEditorMarkdownForSync } from '../utils/markdownSerialization';
import { editorDisplaySettings } from '../displaySettings';

const LINE_NUMBERS_PLUGIN_KEY = new PluginKey('lineNumbers');

/** Module-level document filename, set by editor.ts on document load */
let documentFilename = '';

/** Cached total line count for gutter width recalculation */
let cachedTotalLines = 0;

type MarkdownLineMappingInfo = {
  pos: number;
  lineNum: number;
  topLevelType: string | null;
  topLevelOffset: number | null;
  contentLineNum: number | null;
  strategy: string;
  childType?: string;
  childIndex?: number;
  itemIndex?: number;
  rowIndex?: number;
};

type ResolvedListItemEntry = {
  lineNum: number;
  selFrom: number;
  selTo: number;
  depth: number;
};

type LineNumberRefreshMode = 'visible' | 'chunk' | 'full';

type TopLevelBlockInfo = {
  node: any;
  offset: number;
  typeName: string;
  headingLevel: number | null;
  contentLineIndex: number;
  lineNum: number;
  blockLines: number;
  shouldSkipDecoration: boolean;
  domIndex: number;
};

const LINE_NUMBER_VISIBLE_BUFFER_PX = 320;
const LINE_NUMBER_BACKGROUND_CHUNK_SIZE = 80;

/**
 * Recalculate and apply the --gutter-width CSS variable based on which
 * decorations are currently enabled and the document line count.
 */
export function updateGutterWidth(totalLines?: number): void {
  if (totalLines !== undefined) cachedTotalLines = totalLines;
  const digits = String(cachedTotalLines || 1).length;

  const showHeading = editorDisplaySettings.showHeadingGutter !== false;
  const showLines = editorDisplaySettings.showDocumentLineNumbers === true;

  /** these are used to calculate the gutter width - the get the right value but the calculation is not quite right 
   * It is all based upon how the gutter decorations are done so perhaps it doesn't matter how the individual 
   * values are arrived at (as long as they work)
  */
  const headingWidth = showHeading ? 2 * 0.6 : 0;
  const spaceBetweenWidth = (showHeading && showLines) ? 0.6 : 0;
  const lineWidth = showLines ? (1 + digits) * 0.4 : 0;
  const rightPadding = (showHeading ? 0.9 : 0) + (showLines ? 0.4 : 0);
  const gutterWidth = rightPadding + headingWidth + spaceBetweenWidth + lineWidth;

  const editorEl = document.querySelector('.markdown-editor') as HTMLElement | null;
  if (editorEl) {
    editorEl.style.setProperty('--gutter-width', `${gutterWidth}em`);
  }
}

/**
 * Set the document filename for line-copy feature.
 */
export function setDocumentFilename(name: string): void {
  documentFilename = name;
}

function countTextLineBreaks(text: string | null | undefined): number {
  if (!text) {
    return 0;
  }
  return (text.match(/\n/g) || []).length;
}

function countAlertChildLines(node: any): number {
  const typeName = node.type?.name;
  if (typeName === 'bulletList' || typeName === 'orderedList' || typeName === 'taskList') {
    let itemCount = 0;
    node.forEach(() => {
      itemCount++;
    });
    return Math.max(1, itemCount);
  }

  let explicitBreakCount = 0;
  if (typeof node.descendants === 'function') {
    node.descendants((child: any) => {
      if (child.type?.name === 'hardBreak') {
        explicitBreakCount++;
      } else if (typeof child.text === 'string') {
        explicitBreakCount += countTextLineBreaks(child.text);
      }
    });
  }
  return Math.max(1, explicitBreakCount + 1);
}

function buildGitHubAlertLineInfos(
  node: any,
  offset: number,
  startLineIndex: number,
  lines: string[]
): Array<{ lineNum: number; selFrom: number; selTo: number }> {
  const blockLineCount = countBlockLines(node, lines, startLineIndex);
  const contentLineCount = Math.max(0, blockLineCount - 1);
  const infos: Array<{ lineNum: number; selFrom: number; selTo: number }> = [
    { lineNum: startLineIndex + 1, selFrom: offset + 1, selTo: offset + 1 },
  ];

  const contentInfos: Array<{ lineNum: number; selFrom: number; selTo: number }> = [];
  node.forEach((child: any, childOff: number) => {
    const childAbsStart = offset + 1 + childOff + 1;
    const childAbsEnd = offset + 1 + childOff + child.nodeSize - 1;
    const lineCount = countAlertChildLines(child);
    for (let i = 0; i < lineCount && contentInfos.length < contentLineCount; i++) {
      contentInfos.push({
        lineNum: startLineIndex + 2 + contentInfos.length,
        selFrom: childAbsStart,
        selTo: childAbsEnd,
      });
    }
  });

  const fallbackSelFrom = offset + 1;
  const fallbackSelTo = offset + node.nodeSize - 1;
  while (contentInfos.length < contentLineCount) {
    contentInfos.push({
      lineNum: startLineIndex + 2 + contentInfos.length,
      selFrom: fallbackSelFrom,
      selTo: fallbackSelTo,
    });
  }

  return infos.concat(contentInfos);
}

function getRangeTopForTextNode(node: Text, offset: number): number | null {
  const range = document.createRange();
  const start = Math.min(offset, node.data.length);
  const end = Math.min(start + 1, node.data.length);
  range.setStart(node, start);
  if (end > start) {
    range.setEnd(node, end);
  } else {
    range.collapse(true);
  }
  const firstRect = range.getClientRects()[0];
  const rect = firstRect ?? range.getBoundingClientRect();
  return Number.isFinite(rect.top) ? rect.top : null;
}

function getFirstRenderablePositionInNode(
  node: Node
): { kind: 'text'; node: Text; offset: number } | { kind: 'element'; node: Element } | null {
  if (node.nodeType === Node.TEXT_NODE) {
    const textNode = node as Text;
    return textNode.data.length > 0 ? { kind: 'text', node: textNode, offset: 0 } : null;
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return null;
  }

  const element = node as Element;
  if (element.tagName === 'BR') {
    return null;
  }

  for (const child of Array.from(element.childNodes)) {
    const result = getFirstRenderablePositionInNode(child);
    if (result) {
      return result;
    }
  }

  return { kind: 'element', node: element };
}

function getNextNodeWithinBoundary(node: Node, boundary: Element): Node | null {
  let current: Node | null = node;
  while (current && current !== boundary) {
    if (current.nextSibling) {
      return current.nextSibling;
    }
    current = current.parentNode;
  }
  return null;
}

function getTopForFirstRenderablePositionAfterNode(node: Node, boundary: Element): number | null {
  let current = getNextNodeWithinBoundary(node, boundary);
  while (current) {
    const position = getFirstRenderablePositionInNode(current);
    if (position) {
      if (position.kind === 'text') {
        return getRangeTopForTextNode(position.node, position.offset);
      }
      const rect = position.node.getBoundingClientRect();
      return Number.isFinite(rect.top) ? rect.top : null;
    }
    current = getNextNodeWithinBoundary(current, boundary);
  }
  return null;
}

function getEstimatedLineHeight(element: Element, logicalLineCount: number): number {
  const style = getComputedStyle(element);
  const parsedLineHeight = Number.parseFloat(style.lineHeight);
  if (Number.isFinite(parsedLineHeight)) {
    return parsedLineHeight;
  }

  const rect = element.getBoundingClientRect();
  if (logicalLineCount > 0 && rect.height > 0) {
    return rect.height / logicalLineCount;
  }
  return rect.height || 0;
}

function countExplicitLineBreaksInDom(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) {
    return countTextLineBreaks(node.textContent);
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return 0;
  }

  const element = node as Element;
  if (element.tagName === 'BR') {
    return 1;
  }

  return Array.from(element.childNodes).reduce((sum, child) => sum + countExplicitLineBreaksInDom(child), 0);
}

function normalizeLogicalLineTop(
  top: number | null,
  tops: number[],
  estimatedLineHeight: number
): number | null {
  if (top === null && tops.length > 0) {
    return tops[tops.length - 1] + estimatedLineHeight;
  }

  if (top !== null && tops.length > 0 && Math.abs(top - tops[tops.length - 1]) <= 1) {
    return tops[tops.length - 1] + estimatedLineHeight;
  }

  return top;
}

function collectLogicalLineTops(
  node: Node,
  tops: number[],
  estimatedLineHeight: number,
  boundary: Element
): void {
  if (node.nodeType === Node.TEXT_NODE) {
    const textNode = node as Text;
    for (let i = 0; i < textNode.data.length; i++) {
      if (textNode.data[i] !== '\n') {
        continue;
      }
      const top = normalizeLogicalLineTop(
        getRangeTopForTextNode(textNode, i + 1),
        tops,
        estimatedLineHeight
      );
      if (top !== null) {
        tops.push(top);
      }
    }
    return;
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return;
  }

  const element = node as Element;
  if (element.tagName === 'BR') {
    const top = normalizeLogicalLineTop(
      getTopForFirstRenderablePositionAfterNode(element, boundary),
      tops,
      estimatedLineHeight
    );
    if (top !== null) {
      tops.push(top);
    }
    return;
  }

  Array.from(element.childNodes).forEach(child =>
    collectLogicalLineTops(child, tops, estimatedLineHeight, boundary)
  );
}

function getLogicalLineTopsForElement(blockEl: Element): number[] {
  if (blockEl.tagName === 'UL' || blockEl.tagName === 'OL') {
    return Array.from(blockEl.querySelectorAll(':scope > li')).map(item => item.getBoundingClientRect().top);
  }

  const blockRect = blockEl.getBoundingClientRect();
  const explicitLineBreakCount = countExplicitLineBreaksInDom(blockEl);
  const logicalLineCount = explicitLineBreakCount + 1;
  const estimatedLineHeight = getEstimatedLineHeight(blockEl, logicalLineCount);
  const tops: number[] = [blockRect.top];

  Array.from(blockEl.childNodes).forEach(child =>
    collectLogicalLineTops(child, tops, estimatedLineHeight, blockEl)
  );

  return tops;
}

function getGitHubAlertLineTops(blockEl: Element): number[] {
  const tops: number[] = [];
  const header = blockEl.querySelector(':scope > .github-alert-header');
  if (header) {
    tops.push(header.getBoundingClientRect().top);
  }

  const contentChildren = Array.from(blockEl.querySelectorAll(':scope > .github-alert-content > *'));
  contentChildren.forEach(child => {
    tops.push(...getLogicalLineTopsForElement(child));
  });

  return tops;
}

function positionGitHubAlertSpans(wrapper: Element, blockEl: Element, spans: HTMLElement[]): void {
  const wrapperRect = wrapper.getBoundingClientRect();
  const tops = getGitHubAlertLineTops(blockEl);

  tops.forEach((top, index) => {
    if (index < spans.length) {
      spans[index].style.top = `${top - wrapperRect.top}px`;
      spans[index].style.visibility = '';
    }
  });

  for (let i = tops.length; i < spans.length; i++) {
    spans[i].style.visibility = 'hidden';
  }
}

function syncAnchorExtent(wrapper: Element, sibling: Element): void {
  const wrapperEl = wrapper as HTMLElement;
  void sibling;
  wrapperEl.style.removeProperty('height');
  wrapperEl.style.removeProperty('margin-bottom');
}

/**
 * Show a brief toast notification at the bottom of the screen.
 */
function showToast(message: string): void {
  const toast = document.createElement('div');
  toast.className = 'line-copy-toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => toast.remove(), 300);
  }, 1700);
}

/**
 * TipTap extension that displays markdown source line numbers in the editor gutter.
 */
/** Timeout handle for deferred line number rebuilds */
let lineNumberRebuildTimeout: ReturnType<typeof setTimeout> | null = null;
let lineNumberBackgroundFillTimeout: ReturnType<typeof setTimeout> | null = null;
let gutterRepositionFrame: number | null = null;
let pendingLineNumberRefreshCutoff: number | null = null;
let lineNumberBuildCount = 0;
let lastLineNumberBuildStats: {
  cutoffOffset: number | null;
  refreshMode: LineNumberRefreshMode;
  rebuiltBlocks: number;
  totalBlocks: number;
  preservedDecorations: number;
} = {
  cutoffOffset: null,
  refreshMode: 'full',
  rebuiltBlocks: 0,
  totalBlocks: 0,
  preservedDecorations: 0,
};

function cancelPendingBackgroundLineNumberFill(): void {
  if (lineNumberBackgroundFillTimeout) {
    clearTimeout(lineNumberBackgroundFillTimeout);
    lineNumberBackgroundFillTimeout = null;
  }
}

function dispatchLineNumbersRefresh(
  editor: any,
  options?: {
    cutoffOffset?: number | null;
    refreshMode?: LineNumberRefreshMode;
    chunkStartIndex?: number;
  }
): void {
  if (!editor?.view) {
    return;
  }

  const refreshMode = options?.refreshMode ?? 'visible';
  const tr = editor.state.tr
    .setMeta('lineNumbersRefresh', true)
    .setMeta('lineNumbersRefreshMode', refreshMode)
    .setMeta('addToHistory', false);

  if (typeof options?.cutoffOffset === 'number') {
    tr.setMeta('lineNumbersRefreshCutoff', options.cutoffOffset);
  }

  if (refreshMode === 'chunk' && typeof options?.chunkStartIndex === 'number') {
    tr.setMeta('lineNumbersRefreshChunkStart', options.chunkStartIndex);
  }

  editor.view.dispatch(tr);
}

function scheduleBackgroundLineNumberChunk(
  editor: any,
  cutoffOffset: number | undefined,
  chunkStartIndex: number
): void {
  cancelPendingBackgroundLineNumberFill();
  lineNumberBackgroundFillTimeout = setTimeout(() => {
    lineNumberBackgroundFillTimeout = null;
    dispatchLineNumbersRefresh(editor, {
      cutoffOffset,
      refreshMode: 'chunk',
      chunkStartIndex,
    });
  }, 16);
}

function contentAffectsLineNumberMapping(content: any): boolean {
  let affectsMapping = false;

  const visitNode = (node: any): void => {
    if (!node || affectsMapping) {
      return;
    }

    if (node.isText) {
      if (typeof node.text === 'string' && node.text.includes('\n')) {
        affectsMapping = true;
      }
      return;
    }

    if (node.type?.name === 'hardBreak' || node.isBlock) {
      affectsMapping = true;
      return;
    }

    if (typeof node.forEach === 'function') {
      node.forEach((child: any) => visitNode(child));
      return;
    }

    if (node.content && typeof node.content.forEach === 'function') {
      node.content.forEach((child: any) => visitNode(child));
    }
  };

  if (content && typeof content.forEach === 'function') {
    content.forEach((child: any) => visitNode(child));
  }

  return affectsMapping;
}

function changedRangeAffectsLineNumberMapping(doc: any, from: number, to: number): boolean {
  if (from >= to) {
    return false;
  }

  try {
    return contentAffectsLineNumberMapping(doc.slice(from, to).content);
  } catch {
    return true;
  }
}

function transactionAffectsLineNumberMapping(tr: any, oldState: any): boolean {
  if (!tr.docChanged || !oldState?.doc) {
    return false;
  }

  for (const step of tr.steps) {
    if (contentAffectsLineNumberMapping(step?.slice?.content)) {
      return true;
    }

    const stepMap = step?.getMap?.();
    if (!stepMap || typeof stepMap.forEach !== 'function') {
      return true;
    }

    let affectsMapping = false;
    stepMap.forEach((oldStart: number, oldEnd: number, _newStart: number, _newEnd: number) => {
      if (affectsMapping) {
        return;
      }

      if (changedRangeAffectsLineNumberMapping(oldState.doc, oldStart, oldEnd)) {
        affectsMapping = true;
      }
    });

    if (affectsMapping) {
      return true;
    }
  }

  return false;
}

function mapPendingRefreshCutoff(tr: any): void {
  if (pendingLineNumberRefreshCutoff === null) {
    return;
  }

  pendingLineNumberRefreshCutoff = tr.mapping.map(pendingLineNumberRefreshCutoff, -1);
}

function findRefreshCutoffOffset(doc: any, pos: number): number {
  const maxPos = Math.max(0, doc.content.size);
  const boundedPos = Math.min(Math.max(0, pos), maxPos);

  let previousOffset = 0;
  let firstOffset: number | null = null;
  let result: number | null = null;

  doc.forEach((node: any, offset: number) => {
    if (result !== null) {
      return;
    }

    if (firstOffset === null) {
      firstOffset = offset;
      previousOffset = offset;
    }

    const end = offset + node.nodeSize;
    if (boundedPos <= end) {
      result = offset > (firstOffset ?? 0) ? previousOffset : offset;
      return;
    }

    previousOffset = offset;
  });

  return result ?? previousOffset ?? firstOffset ?? 0;
}

function getTransactionRefreshCutoffOffset(tr: any): number {
  let cutoff: number | null = null;

  for (const step of tr.steps) {
    const stepMap = step?.getMap?.();
    if (!stepMap || typeof stepMap.forEach !== 'function') {
      return 0;
    }

    stepMap.forEach((_oldStart: number, _oldEnd: number, newStart: number) => {
      const nextCutoff = findRefreshCutoffOffset(tr.doc, newStart);
      cutoff = cutoff === null ? nextCutoff : Math.min(cutoff, nextCutoff);
    });
  }

  return cutoff ?? 0;
}

function scheduleGutterReposition(): void {
  if (gutterRepositionFrame !== null) {
    cancelAnimationFrame(gutterRepositionFrame);
  }

  gutterRepositionFrame = window.requestAnimationFrame(() => {
    gutterRepositionFrame = null;
    repositionGutterDecorations();
  });
}

function shouldSkipLineNumberDecoration(node: any): boolean {
  if (node.type?.name !== 'paragraph') {
    return false;
  }

  const text = node.textContent || '';
  return (
    text.trim() === '' &&
    (!node.content ||
      node.content.size === 0 ||
      (node.content.size === 1 && node.content.firstChild?.type?.name === 'hardBreak'))
  );
}

function collectTopLevelBlockInfos(doc: any, lines: string[]): TopLevelBlockInfo[] {
  const blockInfos: TopLevelBlockInfo[] = [];
  let lineIndex = 0;
  let domIndex = 0;

  doc.forEach((node: any, offset: number) => {
    const typeName = node.type.name;
    const headingLevel = typeName === 'heading' ? node.attrs?.level : null;
    const shouldSkipDecoration = shouldSkipLineNumberDecoration(node);

    let contentLineIndex = findBlockLine(node, lines, lineIndex);
    if (contentLineIndex < 0) {
      contentLineIndex = lineIndex;
      while (contentLineIndex < lines.length && lines[contentLineIndex].trim() === '') {
        contentLineIndex++;
      }
    }

    const lineNum = contentLineIndex + 1;
    const countFrom = Math.max(lineIndex, contentLineIndex);
    const blockLines = countBlockLines(node, lines, countFrom);

    blockInfos.push({
      node,
      offset,
      typeName,
      headingLevel,
      contentLineIndex,
      lineNum,
      blockLines,
      shouldSkipDecoration,
      domIndex,
    });

    lineIndex = countFrom + blockLines;
    domIndex++;
  });

  return blockInfos;
}

function getVisibleBlockRange(
  editor: any,
  totalTopLevelBlocks: number
): { startIndex: number; endIndex: number } | null {
  const editorDom = editor?.view?.dom as HTMLElement | null;
  if (!editorDom) {
    return null;
  }

  const blockElements = Array.from(editorDom.children).filter(
    (child): child is HTMLElement =>
      child instanceof HTMLElement && !child.classList.contains('line-number-table-anchor')
  );

  if (!blockElements.length) {
    return null;
  }

  const visibleTop = -LINE_NUMBER_VISIBLE_BUFFER_PX;
  const visibleBottom = window.innerHeight + LINE_NUMBER_VISIBLE_BUFFER_PX;
  const blockCount = Math.min(totalTopLevelBlocks, blockElements.length);
  let startIndex = -1;
  let endIndex = -1;

  for (let i = 0; i < blockCount; i++) {
    const rect = blockElements[i].getBoundingClientRect();
    if (rect.bottom >= visibleTop && rect.top <= visibleBottom) {
      if (startIndex < 0) {
        startIndex = i;
      }
      endIndex = i;
    }
  }

  if (startIndex < 0 || endIndex < 0) {
    return null;
  }

  return {
    startIndex: Math.max(0, startIndex - 2),
    endIndex: Math.min(totalTopLevelBlocks - 1, endIndex + 2),
  };
}

function selectBlocksToBuild(
  editor: any,
  blockInfos: TopLevelBlockInfo[],
  refreshMode: LineNumberRefreshMode,
  cutoffOffset?: number,
  chunkStartIndex = 0
): {
  selectedInfos: TopLevelBlockInfo[];
  totalDecoratedBlocks: number;
  nextChunkStartIndex: number | null;
} {
  const decoratedInfos = blockInfos.filter(info => !info.shouldSkipDecoration);
  const eligibleInfos =
    typeof cutoffOffset === 'number'
      ? decoratedInfos.filter(info => info.offset >= cutoffOffset)
      : decoratedInfos;

  if (refreshMode === 'full' || eligibleInfos.length === 0) {
    return {
      selectedInfos: eligibleInfos,
      totalDecoratedBlocks: decoratedInfos.length,
      nextChunkStartIndex: null,
    };
  }

  if (refreshMode === 'chunk') {
    const selectedInfos = eligibleInfos.slice(
      chunkStartIndex,
      chunkStartIndex + LINE_NUMBER_BACKGROUND_CHUNK_SIZE
    );
    const nextChunkStart =
      chunkStartIndex + selectedInfos.length < eligibleInfos.length
        ? chunkStartIndex + selectedInfos.length
        : null;

    return {
      selectedInfos,
      totalDecoratedBlocks: decoratedInfos.length,
      nextChunkStartIndex: nextChunkStart,
    };
  }

  const visibleRange = getVisibleBlockRange(editor, blockInfos.length);
  if (!visibleRange) {
    return {
      selectedInfos: eligibleInfos,
      totalDecoratedBlocks: decoratedInfos.length,
      nextChunkStartIndex: null,
    };
  }

  const selectedVisibleInfos = eligibleInfos.filter(
    info =>
      info.domIndex >= visibleRange.startIndex &&
      info.domIndex <= visibleRange.endIndex
  );

  const selectedInfos =
    selectedVisibleInfos.length > 0
      ? selectedVisibleInfos
      : eligibleInfos.slice(0, LINE_NUMBER_BACKGROUND_CHUNK_SIZE);

  return {
    selectedInfos,
    totalDecoratedBlocks: decoratedInfos.length,
    nextChunkStartIndex: selectedInfos.length < eligibleInfos.length ? 0 : null,
  };
}

export const LineNumbers = Extension.create({
  name: 'lineNumbers',

  addProseMirrorPlugins() {
    const editor = this.editor;

    return [
      new Plugin({
        key: LINE_NUMBERS_PLUGIN_KEY,
        state: {
          init() {
            // Don't build on init — markdown serializer isn't ready yet.
            // Schedule a deferred refresh once the editor is fully loaded.
            setTimeout(() => {
              dispatchLineNumbersRefresh(editor, {
                cutoffOffset: pendingLineNumberRefreshCutoff,
                refreshMode: 'visible',
              });
              pendingLineNumberRefreshCutoff = null;
            }, 200);
            return DecorationSet.empty;
          },
          apply(tr, oldDecorations, oldState) {
            if (tr.getMeta('lineNumbersRefresh')) {
              const refreshCutoffMeta = tr.getMeta('lineNumbersRefreshCutoff');
              const refreshCutoff =
                typeof refreshCutoffMeta === 'number' && refreshCutoffMeta > 0
                  ? refreshCutoffMeta
                  : undefined;
              const refreshModeMeta = tr.getMeta('lineNumbersRefreshMode');
              const refreshMode: LineNumberRefreshMode =
                refreshModeMeta === 'chunk' || refreshModeMeta === 'full'
                  ? refreshModeMeta
                  : 'visible';
              const chunkStartMeta = tr.getMeta('lineNumbersRefreshChunkStart');
              const chunkStartIndex =
                typeof chunkStartMeta === 'number' && chunkStartMeta >= 0 ? chunkStartMeta : 0;
              return buildDecorations(tr.doc, editor, oldDecorations, {
                cutoffOffset: refreshCutoff,
                refreshMode,
                chunkStartIndex,
              });
            }
            if (tr.docChanged) {
              cancelPendingBackgroundLineNumberFill();
              mapPendingRefreshCutoff(tr);

              if (transactionAffectsLineNumberMapping(tr, oldState)) {
                const transactionCutoff = getTransactionRefreshCutoffOffset(tr);
                pendingLineNumberRefreshCutoff =
                  pendingLineNumberRefreshCutoff === null
                    ? transactionCutoff
                    : Math.min(pendingLineNumberRefreshCutoff, transactionCutoff);

                if (lineNumberRebuildTimeout) {
                  clearTimeout(lineNumberRebuildTimeout);
                }
                lineNumberRebuildTimeout = setTimeout(() => {
                  lineNumberRebuildTimeout = null;
                  dispatchLineNumbersRefresh(editor, {
                    cutoffOffset: pendingLineNumberRefreshCutoff,
                    refreshMode: 'visible',
                  });
                  pendingLineNumberRefreshCutoff = null;
                }, 500);
              }

              scheduleGutterReposition();
              return oldDecorations.map(tr.mapping, tr.doc);
            }
            // Keep existing decorations until an explicit deferred refresh runs.
            return oldDecorations;
          },
        },
        props: {
          decorations(state) {
            return LINE_NUMBERS_PLUGIN_KEY.getState(state) as DecorationSet;
          },
        },
      }),
    ];
  },
});

/**
 * Find the markdown line number for a given ProseMirror node by searching
 * for a signature pattern from the current search position.
 *
 * Returns the 0-based line index, or -1 if not found.
 */
function findBlockLine(
  node: any,
  lines: string[],
  searchFrom: number
): number {
  const typeName = node.type.name;
  const headingLevel = typeName === 'heading' ? node.attrs?.level : null;

  if (headingLevel) {
    const prefix = '#'.repeat(headingLevel) + ' ';
    for (let i = searchFrom; i < lines.length; i++) {
      if (lines[i].startsWith(prefix)) return i;
    }
  } else if (typeName === 'codeBlock') {
    for (let i = searchFrom; i < lines.length; i++) {
      if (lines[i].match(/^(`{3,}|~{3,})/) || lines[i].startsWith('    ') || lines[i].startsWith('\t')) {
        return i;
      }
    }
  } else if (typeName === 'bulletList') {
    for (let i = searchFrom; i < lines.length; i++) {
      if (lines[i].match(/^\s*[-*+] /)) return i;
    }
  } else if (typeName === 'orderedList') {
    for (let i = searchFrom; i < lines.length; i++) {
      if (lines[i].match(/^\s*\d+[.)]\s/)) return i;
    }
  } else if (typeName === 'taskList') {
    for (let i = searchFrom; i < lines.length; i++) {
      if (lines[i].match(/^\s*- \[/)) return i;
    }
  } else if (typeName === 'blockquote') {
    for (let i = searchFrom; i < lines.length; i++) {
      if (lines[i].startsWith('>') && !lines[i].match(/^> \[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION|COMMENT)\]/i)) {
        return i;
      }
    }
  } else if (typeName === 'githubAlert') {
    for (let i = searchFrom; i < lines.length; i++) {
      if (lines[i].match(/^> \[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION|COMMENT)\]/i)) return i;
    }
  } else if (typeName === 'table') {
    for (let i = searchFrom; i < lines.length; i++) {
      if (lines[i].includes('|')) return i;
    }
  } else if (typeName === 'horizontalRule') {
    for (let i = searchFrom; i < lines.length; i++) {
      if (lines[i].match(/^(-{3,}|\*{3,}|_{3,})\s*$/)) return i;
    }
  } else {
    // Paragraph or other: just find the next non-blank line.
    // Text content matching is unreliable because markdown formatting
    // marks (***bold***, _italic_, etc.) break plain-text searches.
    for (let i = searchFrom; i < lines.length; i++) {
      if (lines[i].trim() !== '') return i;
    }
  }

  return -1;
}

/**
 * Count how many markdown lines a block occupies (for advancing past it).
 */
function countBlockLines(node: any, lines: string[], startLine: number): number {
  const typeName = node.type.name;
  let count = 0;
  let i = startLine;

  // Skip leading blank lines
  while (i < lines.length && lines[i].trim() === '') {
    count++;
    i++;
  }

  if (i >= lines.length) return Math.max(count, 1);

  if (typeName === 'codeBlock') {
    if (lines[i]?.match(/^(`{3,}|~{3,})/)) {
      const fence = lines[i].match(/^(`{3,}|~{3,})/)![0];
      count++; i++;
      while (i < lines.length && !lines[i].startsWith(fence)) { count++; i++; }
      if (i < lines.length) { count++; i++; }
    } else {
      while (i < lines.length && (lines[i].startsWith('    ') || lines[i].startsWith('\t') || lines[i].trim() === '')) {
        count++; i++;
      }
    }
  } else if (typeName === 'heading') {
    count++;
  } else if (typeName === 'table') {
    while (i < lines.length && lines[i].trim() !== '' && lines[i].includes('|')) {
      count++; i++;
    }
  } else if (typeName === 'bulletList' || typeName === 'orderedList' || typeName === 'taskList') {
    const itemPattern = typeName === 'bulletList'
      ? /^\s*[-*+] /
      : typeName === 'orderedList'
        ? /^\s*\d+[.)]\s/
        : /^\s*- \[/;
    while (i < lines.length) {
      const line = lines[i];
      if (line.trim() === '') {
        // Blank line: continue only if next line is a list item or indented continuation
        if (i + 1 < lines.length && (itemPattern.test(lines[i + 1]) || /^(\s{2,}|\t)/.test(lines[i + 1]))) {
          count++; i++; continue;
        }
        break;
      }
      // Non-blank: must be a list item or indented continuation to belong to this list
      if (!itemPattern.test(line) && !/^(\s{2,}|\t)/.test(line)) {
        break;
      }
      count++; i++;
    }
  } else if (typeName === 'blockquote' || typeName === 'githubAlert') {
    while (i < lines.length && lines[i].startsWith('>')) {
      count++; i++;
    }
  } else if (typeName === 'horizontalRule') {
    count++;
  } else {
    while (i < lines.length && lines[i].trim() !== '') {
      count++; i++;
    }
  }

  return Math.max(count, 1);
}

function isListNodeType(typeName: string | null | undefined): boolean {
  return typeName === 'bulletList' || typeName === 'orderedList' || typeName === 'taskList';
}

function getMarkdownListLineInfo(line: string): { listType: string; indent: number } | null {
  const expandedLine = line.replace(/\t/g, '    ');

  let match = expandedLine.match(/^(\s*)- \[[ xX]\]\s+/);
  if (match) {
    return {
      listType: 'taskList',
      indent: match[1].length,
    };
  }

  match = expandedLine.match(/^(\s*)\d+[.)]\s+/);
  if (match) {
    return {
      listType: 'orderedList',
      indent: match[1].length,
    };
  }

  match = expandedLine.match(/^(\s*)[-*+]\s+/);
  if (match) {
    return {
      listType: 'bulletList',
      indent: match[1].length,
    };
  }

  return null;
}

function findNextMarkdownListLine(
  lines: string[],
  startLine: number,
  endLine: number,
  listType?: string,
  indent?: number | null
): { lineIndex: number; indent: number } | null {
  for (let i = startLine; i < endLine; i++) {
    const lineInfo = getMarkdownListLineInfo(lines[i]);
    if (!lineInfo) {
      continue;
    }
    if (listType && lineInfo.listType !== listType) {
      continue;
    }
    if (indent !== undefined && indent !== null && lineInfo.indent !== indent) {
      continue;
    }
    return {
      lineIndex: i,
      indent: lineInfo.indent,
    };
  }

  return null;
}

function collectResolvedListItemEntries(
  listNode: any,
  listOffset: number,
  lines: string[],
  listStartLine: number
): ResolvedListItemEntry[] {
  const entries: ResolvedListItemEntry[] = [];
  const listEndLine = Math.min(lines.length, listStartLine + countBlockLines(listNode, lines, listStartLine));

  const getListItemSelectionRange = (listItem: any, itemOffset: number): { from: number; to: number } => {
    const fallbackRange = {
      from: itemOffset + 1,
      to: itemOffset + listItem.nodeSize - 1,
    };

    if (typeof listItem?.forEach !== 'function') {
      return fallbackRange;
    }

    let firstNestedListStart: number | null = null;
    listItem.forEach((child: any, childOff: number) => {
      if (firstNestedListStart !== null || !isListNodeType(child.type?.name)) {
        return;
      }
      firstNestedListStart = itemOffset + 1 + childOff;
    });

    if (firstNestedListStart === null) {
      return fallbackRange;
    }

    return {
      from: fallbackRange.from,
      to: Math.max(fallbackRange.from, firstNestedListStart - 1),
    };
  };

  const appendEntries = (
    node: any,
    offset: number,
    searchStartLine: number,
    searchEndLine: number,
    depth: number
  ): number => {
    const directItems: Array<{ node: any; offset: number }> = [];
    node.forEach((listItem: any, itemOff: number) => {
      directItems.push({
        node: listItem,
        offset: offset + 1 + itemOff,
      });
    });

    let cursor = searchStartLine;
    let expectedIndent: number | null = null;

    directItems.forEach(({ node: listItem, offset: itemOffset }, index) => {
      const directMatch = findNextMarkdownListLine(
        lines,
        cursor,
        searchEndLine,
        node.type?.name,
        expectedIndent
      );
      const fallbackMatch = directMatch
        ?? findNextMarkdownListLine(lines, cursor, searchEndLine);
      const fallbackLineIndex = Math.min(searchEndLine - 1, Math.max(searchStartLine, cursor + index));
      const lineIndex = fallbackMatch?.lineIndex ?? fallbackLineIndex;

      if (directMatch && expectedIndent === null) {
        expectedIndent = directMatch.indent;
      }

      const selectionRange = getListItemSelectionRange(listItem, itemOffset);

      entries.push({
        lineNum: lineIndex + 1,
        selFrom: selectionRange.from,
        selTo: selectionRange.to,
        depth,
      });

      cursor = lineIndex + 1;

      if (typeof listItem.forEach === 'function') {
        listItem.forEach((child: any, childOff: number) => {
          if (!isListNodeType(child.type?.name)) {
            return;
          }
          cursor = appendEntries(child, itemOffset + 1 + childOff, cursor, searchEndLine, depth + 1);
        });
      }
    });

    return cursor;
  };

  appendEntries(listNode, listOffset, listStartLine, listEndLine, 0);
  return entries;
}

function findDeepestResolvedListItemEntryForPos(
  entries: ResolvedListItemEntry[],
  pos: number
): ResolvedListItemEntry | null {
  let matchedEntry: ResolvedListItemEntry | null = null;

  for (const entry of entries) {
    if (pos < entry.selFrom || pos > entry.selTo) {
      continue;
    }
    if (!matchedEntry || entry.depth >= matchedEntry.depth) {
      matchedEntry = entry;
    }
  }

  return matchedEntry;
}

function findSequentialListItemLineForPos(
  node: any,
  offset: number,
  pos: number,
  firstLineNum: number
): { lineNum: number; itemIndex: number } | null {
  let itemIndex = 0;
  let matched: { lineNum: number; itemIndex: number } | null = null;

  node.forEach((listItem: any, itemOff: number) => {
    if (matched) return;
    const itemAbsStart = offset + 1 + itemOff + 1;
    const itemAbsEnd = offset + 1 + itemOff + listItem.nodeSize - 1;
    if (pos >= itemAbsStart && pos <= itemAbsEnd) {
      matched = {
        lineNum: firstLineNum + itemIndex,
        itemIndex,
      };
      return;
    }
    itemIndex++;
  });

  return matched;
}

function findSequentialQuoteChildLineForPos(
  node: any,
  offset: number,
  pos: number,
  firstContentLineNum: number,
  isGitHubAlert: boolean
): {
  lineNum: number;
  strategy: string;
  childType?: string;
  childIndex?: number;
  itemIndex?: number;
} | null {
  let childLineNum = firstContentLineNum;
  let childIndex = 0;
  let matched: {
    lineNum: number;
    strategy: string;
    childType?: string;
    childIndex?: number;
    itemIndex?: number;
  } | null = null;

  node.forEach((child: any, childOff: number) => {
    if (matched) return;

    const childType = child.type?.name ?? 'unknown';
    const childOffset = offset + 1 + childOff;
    const childAbsStart = childOffset + 1;
    const childAbsEnd = childOffset + child.nodeSize - 1;

    if (pos >= childAbsStart && pos <= childAbsEnd) {
      if (childType === 'bulletList' || childType === 'orderedList' || childType === 'taskList') {
        const itemMatch = findSequentialListItemLineForPos(child, childOffset, pos, childLineNum);
        if (itemMatch) {
          matched = {
            lineNum: itemMatch.lineNum,
            strategy: isGitHubAlert ? 'githubAlertChildListItem' : 'blockquoteChildListItem',
            childType,
            childIndex,
            itemIndex: itemMatch.itemIndex,
          };
          return;
        }
      }

      matched = {
        lineNum: childLineNum,
        strategy: isGitHubAlert ? 'githubAlertChild' : 'blockquoteChild',
        childType,
        childIndex,
      };
      return;
    }

    childLineNum += countAlertChildLines(child);
    childIndex++;
  });

  return matched;
}

function findNestedMarkdownLineForPos(
  node: any,
  offset: number,
  pos: number,
  contentLineIndex: number,
  lines: string[]
): {
  lineNum: number;
  strategy: string;
  childType?: string;
  childIndex?: number;
  itemIndex?: number;
  rowIndex?: number;
} | null {
  if (contentLineIndex < 0 || typeof node?.forEach !== 'function') {
    return null;
  }

  const typeName = node.type.name;
  const lineNum = contentLineIndex + 1;

  if (typeName === 'table') {
    let rowIndex = 0;
    let matchedLine: {
      lineNum: number;
      strategy: string;
      rowIndex?: number;
    } | null = null;
    node.forEach((row: any, rowOff: number) => {
      if (matchedLine) return;
      const rowAbsStart = offset + 1 + rowOff + 1;
      const rowAbsEnd = offset + 1 + rowOff + row.nodeSize - 1;
      if (pos >= rowAbsStart && pos <= rowAbsEnd) {
        matchedLine = {
          lineNum: rowIndex === 0 ? lineNum : lineNum + rowIndex + 1,
          strategy: 'tableRow',
          rowIndex,
        };
        return;
      }
      rowIndex++;
    });
    return matchedLine;
  }

  if (typeName === 'bulletList' || typeName === 'orderedList' || typeName === 'taskList') {
    const entries = collectResolvedListItemEntries(node, offset, lines, contentLineIndex);
    const matchedEntry = findDeepestResolvedListItemEntryForPos(entries, pos);
    if (!matchedEntry) {
      return null;
    }
    return {
      lineNum: matchedEntry.lineNum,
      strategy: matchedEntry.depth > 0 ? 'nestedListItem' : 'topLevelListItem',
    };
  }

  if (typeName === 'blockquote') {
    return findSequentialQuoteChildLineForPos(node, offset, pos, lineNum, false);
  }

  if (typeName === 'githubAlert') {
    return findSequentialQuoteChildLineForPos(node, offset, pos, lineNum + 1, true);
  }

  return null;
}

function resolveMarkdownLineMapping(editor: any, pos: number): MarkdownLineMappingInfo {
  const markdown = getEditorMarkdownForSync(editor);
  if (!markdown) {
    return {
      pos,
      lineNum: -1,
      topLevelType: null,
      topLevelOffset: null,
      contentLineNum: null,
      strategy: 'missingMarkdown',
    };
  }

  const lines = markdown.split('\n');
  const doc = editor.state.doc;
  let lineIndex = 0;
  let mapping: MarkdownLineMappingInfo = {
    pos,
    lineNum: -1,
    topLevelType: null,
    topLevelOffset: null,
    contentLineNum: null,
    strategy: 'unmapped',
  };

  doc.forEach((node: any, offset: number) => {
    if (mapping.lineNum !== -1) return;

    const typeName = node.type.name;
    if (typeName === 'paragraph') {
      const text = node.textContent || '';
      if (text.trim() === '' && (!node.content || node.content.size === 0 ||
          (node.content.size === 1 && node.content.firstChild?.type?.name === 'hardBreak'))) {
        return;
      }
    }

    const nodeEnd = offset + node.nodeSize;
    const contentLineIndex = findBlockLine(node, lines, lineIndex);

    if (pos >= offset && pos < nodeEnd) {
      const nestedMatch = findNestedMarkdownLineForPos(node, offset, pos, contentLineIndex, lines);
      mapping = {
        pos,
        lineNum:
          nestedMatch?.lineNum ?? (contentLineIndex >= 0 ? contentLineIndex + 1 : -1),
        topLevelType: typeName,
        topLevelOffset: offset,
        contentLineNum: contentLineIndex >= 0 ? contentLineIndex + 1 : null,
        strategy: nestedMatch?.strategy ?? 'topLevelBlock',
        childType: nestedMatch?.childType,
        childIndex: nestedMatch?.childIndex,
        itemIndex: nestedMatch?.itemIndex,
        rowIndex: nestedMatch?.rowIndex,
      };
      return;
    }

    const countFrom = Math.max(lineIndex, contentLineIndex >= 0 ? contentLineIndex : lineIndex);
    const blockLines = countBlockLines(node, lines, countFrom);
    lineIndex = countFrom + blockLines;
  });

  return mapping;
}

/**
 * Given a ProseMirror position, return the 1-based markdown source line number.
 * Returns -1 if the position cannot be mapped.
 */
export function posToMarkdownLine(editor: any, pos: number): number {
  return resolveMarkdownLineMapping(editor, pos).lineNum;
}

function findNearestInlineSelectionPos(doc: any, pos: number): number {
  const maxPos = Math.max(1, doc.nodeSize - 2);
  const boundedPos = Math.min(Math.max(1, pos), maxPos);

  try {
    if (doc.resolve(boundedPos).parent.inlineContent) {
      return boundedPos;
    }
  } catch {
    return boundedPos;
  }

  for (let delta = 1; delta <= maxPos; delta++) {
    const forward = boundedPos + delta;
    if (forward <= maxPos) {
      try {
        if (doc.resolve(forward).parent.inlineContent) {
          return forward;
        }
      } catch {
        // Ignore invalid probe positions
      }
    }

    const backward = boundedPos - delta;
    if (backward >= 1) {
      try {
        if (doc.resolve(backward).parent.inlineContent) {
          return backward;
        }
      } catch {
        // Ignore invalid probe positions
      }
    }
  }

  return boundedPos;
}

/**
 * Given a 1-based markdown line number, return the ProseMirror position
 * of the block that contains that line. Returns -1 if not found.
 */
export function markdownLineToPos(editor: any, targetLine: number): number {
  const markdown = getEditorMarkdownForSync(editor);
  if (!markdown) return -1;
  const lines = markdown.split('\n');
  const doc = editor.state.doc;
  let lineIndex = 0;
  let result = -1;

  doc.forEach((node: any, offset: number) => {
    if (result !== -1) return;

    const typeName = node.type.name;
    if (typeName === 'paragraph') {
      const text = node.textContent || '';
      if (text.trim() === '' && (!node.content || node.content.size === 0 ||
          (node.content.size === 1 && node.content.firstChild?.type?.name === 'hardBreak'))) {
        return;
      }
    }

    const contentLineIndex = findBlockLine(node, lines, lineIndex);
    const countFrom = Math.max(lineIndex, contentLineIndex >= 0 ? contentLineIndex : lineIndex);
    const blockLines = countBlockLines(node, lines, countFrom);
    const blockEndLine = countFrom + blockLines;

    const target0 = targetLine - 1; // 0-based
    if (contentLineIndex >= 0 && target0 >= contentLineIndex && target0 < blockEndLine) {
      if (isListNodeType(typeName)) {
        const matchedEntry = collectResolvedListItemEntries(node, offset, lines, countFrom)
          .find(entry => entry.lineNum === targetLine);
        if (matchedEntry) {
          result = matchedEntry.selFrom;
          return;
        }
      }

      result = offset + 1; // +1 to get inside the node content
      return;
    }

    lineIndex = blockEndLine;
  });

  return result;
}

/**
 * Given a 1-based markdown line number, return the top-level block selection
 * range that contains that line. Returns null if not found.
 */
export function markdownLineToSelectionRange(
  editor: any,
  targetLine: number
): { from: number; to: number } | null {
  const markdown = getEditorMarkdownForSync(editor);
  if (!markdown) return null;
  const lines = markdown.split('\n');
  const doc = editor.state.doc;
  let lineIndex = 0;
  let result: { from: number; to: number } | null = null;

  doc.forEach((node: any, offset: number) => {
    if (result) return;

    const typeName = node.type.name;
    if (typeName === 'paragraph') {
      const text = node.textContent || '';
      if (
        text.trim() === '' &&
        (!node.content ||
          node.content.size === 0 ||
          (node.content.size === 1 && node.content.firstChild?.type?.name === 'hardBreak'))
      ) {
        return;
      }
    }

    const contentLineIndex = findBlockLine(node, lines, lineIndex);
    const countFrom = Math.max(lineIndex, contentLineIndex >= 0 ? contentLineIndex : lineIndex);
    const blockLines = countBlockLines(node, lines, countFrom);
    const blockEndLine = countFrom + blockLines;
    const target0 = targetLine - 1;

    if (contentLineIndex >= 0 && target0 >= contentLineIndex && target0 < blockEndLine) {
      if (isListNodeType(typeName)) {
        const matchedEntry = collectResolvedListItemEntries(node, offset, lines, countFrom)
          .find(entry => entry.lineNum === targetLine);
        if (matchedEntry) {
          result = {
            from: matchedEntry.selFrom,
            to: matchedEntry.selTo,
          };
          return;
        }
      }

      const from = offset + 1;
      const to = Math.max(from, offset + node.nodeSize - 1);
      result = { from, to };
      return;
    }

    lineIndex = blockEndLine;
  });

  return result;
}

/**
 * Build a complete map from 1-based markdown line numbers to ProseMirror
 * selection ranges. Uses the same node-walking and blank-line-skipping
 * logic as the gutter decoration builder, so it handles all node types
 * reliably (headings, paragraphs, lists, tables, etc.).
 */
export function buildLineToPositionMap(
  editor: any
): Map<number, { from: number; to: number }> {
  const map = new Map<number, { from: number; to: number }>();
  const markdown = getEditorMarkdownForSync(editor);
  if (!markdown) return map;

  const lines = markdown.split('\n');
  const doc = editor.state.doc;
  let lineIndex = 0;

  doc.forEach((node: any, offset: number) => {
    const typeName = node.type.name;

    // Skip empty paragraphs — they have no corresponding markdown line
    if (typeName === 'paragraph') {
      const text = node.textContent || '';
      if (text.trim() === '' && (!node.content || node.content.size === 0 ||
          (node.content.size === 1 && node.content.firstChild?.type?.name === 'hardBreak'))) {
        return;
      }
    }

    // Find the line number using pattern matching, with blank-line-skipping fallback
    let contentLineIndex = findBlockLine(node, lines, lineIndex);
    if (contentLineIndex < 0) {
      contentLineIndex = lineIndex;
      while (contentLineIndex < lines.length && lines[contentLineIndex].trim() === '') {
        contentLineIndex++;
      }
    }

    const lineNum = contentLineIndex + 1; // 1-based
    const selFrom = offset + 1;
    const selTo = Math.max(selFrom, offset + node.nodeSize - 1);

    // For lists, add per-item entries
    if (isListNodeType(typeName)) {
      const entries = collectResolvedListItemEntries(node, offset, lines, contentLineIndex);
      for (const entry of entries) {
        map.set(entry.lineNum, { from: entry.selFrom, to: entry.selTo });
      }
    } else if (typeName === 'table') {
      // Add per-row entries
      let ri = 0;
      node.forEach((row: any, rowOff: number) => {
        const rl = ri === 0 ? lineNum : lineNum + ri + 1;
        const rowAbsStart = offset + 1 + rowOff + 1;
        const rowAbsEnd = offset + 1 + rowOff + row.nodeSize - 1;
        map.set(rl, { from: rowAbsStart, to: rowAbsEnd });
        ri++;
      });
    } else {
      // Standard block: map the line number to the block's selection range
      map.set(lineNum, { from: selFrom, to: selTo });
    }

    // Advance lineIndex past this block
    const countFrom = Math.max(lineIndex, contentLineIndex);
    const blockLines = countBlockLines(node, lines, countFrom);
    lineIndex = countFrom + blockLines;
  });

  return map;
}

/**
 * Build decorations for all top-level blocks.
 */
function buildDecorations(
  doc: any,
  editor: any,
  oldDecorations?: DecorationSet,
  options?: {
    cutoffOffset?: number;
    refreshMode?: LineNumberRefreshMode;
    chunkStartIndex?: number;
  }
): DecorationSet {
  try {
    const markdown = getEditorMarkdownForSync(editor);

    // If serializer isn't ready yet (returns empty), bail out and schedule retry
    if (!markdown || markdown.length === 0) {

      setTimeout(() => {
        dispatchLineNumbersRefresh(editor, { refreshMode: 'visible' });
      }, 300);
      return oldDecorations ?? DecorationSet.empty;
    }

    const lines = markdown.split('\n');
    const totalLines = lines.length;
    const refreshMode = options?.refreshMode ?? 'full';
    const cutoffOffset = options?.cutoffOffset;

    // Set CSS variable for dynamic gutter width based on line count and active decorations
    updateGutterWidth(totalLines);

    const blockInfos = collectTopLevelBlockInfos(doc, lines);
    const {
      selectedInfos,
      totalDecoratedBlocks,
      nextChunkStartIndex,
    } = selectBlocksToBuild(
      editor,
      blockInfos,
      refreshMode,
      cutoffOffset,
      options?.chunkStartIndex ?? 0
    );

    const decorations: Decoration[] = [];

    selectedInfos.forEach(({ node, offset, typeName, headingLevel, contentLineIndex, lineNum }) => {

      // Skip empty paragraphs — they are stripped from serialized markdown
      // by stripEmptyDocParagraphsFromJson, so they have no corresponding line
      if (typeName === 'paragraph') {
        const text = node.textContent || '';
        if (text.trim() === '' && (!node.content || node.content.size === 0 ||
            (node.content.size === 1 && node.content.firstChild?.type?.name === 'hardBreak'))) {
          return; // skip — no decoration for empty paragraphs
        }
      }


      // Find the line number using pattern matching

      // Helper: build a gutter span for a given line number
      const createGutterSpan = (
        ln: number,
        hLevel: number | null,
        selFrom: number,
        _selTo: number
      ): HTMLElement => {
        const span = document.createElement('span');
        span.className = 'line-number-gutter';
        if (hLevel) {
          span.classList.add(`gutter-level-${hLevel}`);
          const label = document.createElement('span');
          label.className = 'gutter-heading-label';
          label.textContent = `H${hLevel}`;
          span.appendChild(label);
        }
        const numSpan = document.createElement('span');
        numSpan.className = 'gutter-line-num';
        numSpan.textContent = `L${ln}`;
        span.appendChild(numSpan);

        span.title = `Click to copy line ${ln} info to clipboard`;

        span.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();

          const freshMarkdown = getEditorMarkdownForSync(editor);
          const freshLines = freshMarkdown.split('\n');
          const lineText = (ln - 1) < freshLines.length ? freshLines[ln - 1] : '';

          const fname = documentFilename || 'document';
          const copyText = `Line ${ln} in ${fname}: ${lineText}`;

          if (navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(copyText).then(() => {
              showToast(`Line ${ln} copied to clipboard`);
            }).catch(() => {
              showToast('Copy failed');
            });
          }

          try {
            const freshSelection = markdownLineToSelectionRange(editor, ln);
            const canUseFreshSelection = Boolean(
              freshSelection &&
              editor.state.doc.resolve(freshSelection.from).parent.inlineContent &&
              editor.state.doc.resolve(Math.max(freshSelection.to - 1, freshSelection.from)).parent.inlineContent
            );
            if (canUseFreshSelection && freshSelection) {
              editor.commands.setTextSelection(freshSelection);
            } else {
              const freshPos = markdownLineToPos(editor, ln);
              editor.commands.setTextSelection(
                findNearestInlineSelectionPos(editor.state.doc, freshPos > 0 ? freshPos : selFrom)
              );
            }
            editor.commands.focus();
          } catch {
            // Ignore selection errors
          }
        });

        return span;
      };

      if (typeName === 'table') {
        // Tables are wrapped in .tableWrapper with overflow-x:auto, which clips
        // anything positioned outside the table bounds. So we place a single
        // zero-height anchor div BEFORE the tableWrapper, containing a gutter
        // span for each row. After rendering, we measure each <tr>'s position
        // and align the spans vertically.
        const tableOffset = offset;
        const tableNode = node;

        // Collect row info
        const rowInfos: Array<{ lineNum: number; selFrom: number; selTo: number }> = [];
        let ri = 0;
        tableNode.forEach((row: any, rowOff: number) => {
          const rl = ri === 0 ? lineNum : lineNum + ri + 1;
          const rowAbsStart = tableOffset + 1 + rowOff + 1;
          const rowAbsEnd = tableOffset + 1 + rowOff + row.nodeSize - 1;
          rowInfos.push({
            lineNum: rl,
            selFrom: rowAbsStart,
            selTo: rowAbsEnd,
          });
          ri++;
        });

        const widget = Decoration.widget(offset, () => {
          const wrapper = document.createElement('div');
          wrapper.className = 'line-number-table-anchor';

          const spans: HTMLElement[] = [];
          for (const info of rowInfos) {
            const span = createGutterSpan(info.lineNum, null, info.selFrom, info.selTo);
            span.style.position = 'absolute';
            // Initially hidden until we measure positions
            span.style.visibility = 'hidden';
            wrapper.appendChild(span);
            spans.push(span);
          }

          // After DOM rendering, measure <tr> positions and align gutter spans
          requestAnimationFrame(() => {
            const siblingEl = wrapper.nextElementSibling as Element | null;
            if (!siblingEl) return;
            syncAnchorExtent(wrapper, siblingEl);
            const tableEl = siblingEl.querySelector('table');
            if (!tableEl) return;
            const wrapperRect = wrapper.getBoundingClientRect();
            const rows = tableEl.querySelectorAll('tr');
            rows.forEach((tr, i) => {
              if (i < spans.length) {
                const trRect = tr.getBoundingClientRect();
                spans[i].style.top = `${trRect.top - wrapperRect.top}px`;
                spans[i].style.visibility = '';
              }
            });
          });

          return wrapper;
        }, { side: -1, key: `ln-table-${offset}`, blockStartDelta: 0 });

        decorations.push(widget);
      } else if (typeName === 'githubAlert') {
        const alertLineInfos = buildGitHubAlertLineInfos(node, offset, contentLineIndex, lines);

        const widget = Decoration.widget(offset, () => {
          const wrapper = document.createElement('div');
          wrapper.className = 'line-number-table-anchor';

          const spans: HTMLElement[] = [];
          for (const info of alertLineInfos) {
            const span = createGutterSpan(info.lineNum, null, info.selFrom, info.selTo);
            span.style.position = 'absolute';
            span.style.visibility = 'hidden';
            wrapper.appendChild(span);
            spans.push(span);
          }

          requestAnimationFrame(() => {
            const blockEl = wrapper.nextElementSibling;
            if (!blockEl) return;
            syncAnchorExtent(wrapper, blockEl);
            positionGitHubAlertSpans(wrapper, blockEl, spans);
          });

          return wrapper;
        }, { side: -1, key: `ln-alert-${offset}`, blockStartDelta: 0 });

        decorations.push(widget);
      } else if (typeName === 'blockquote') {
        // Single-anchor pattern: one widget with per-line absolute spans
        // Count the > lines in the markdown for this block
        const alertLineInfos: Array<{ lineNum: number; selFrom: number; selTo: number }> = [];
        let childIdx = 0;
        node.forEach((child: any, childOff: number) => {
          const childAbsStart = offset + 1 + childOff + 1;
          const childAbsEnd = offset + 1 + childOff + child.nodeSize - 1;
          const childLine = contentLineIndex + childIdx;
          const childLineNum = childLine < lines.length ? childLine + 1 : lineNum + childIdx;
          alertLineInfos.push({
            lineNum: childLineNum,
            selFrom: childAbsStart,
            selTo: childAbsEnd,
          });
          childIdx++;
        });

        const widget = Decoration.widget(offset, () => {
          const wrapper = document.createElement('div');
          wrapper.className = 'line-number-table-anchor';

          const spans: HTMLElement[] = [];
          for (const info of alertLineInfos) {
            const span = createGutterSpan(info.lineNum, null, info.selFrom, info.selTo);
            span.style.position = 'absolute';
            span.style.visibility = 'hidden';
            wrapper.appendChild(span);
            spans.push(span);
          }

          requestAnimationFrame(() => {
            const blockEl = wrapper.nextElementSibling;
            if (!blockEl) return;
            syncAnchorExtent(wrapper, blockEl);
            const wrapperRect = wrapper.getBoundingClientRect();
            const children = Array.from(blockEl.querySelectorAll(':scope > *'));
            let spanIdx = 0;
            children.forEach((child: Element) => {
              if (spanIdx < spans.length) {
                const childRect = child.getBoundingClientRect();
                spans[spanIdx].style.top = `${childRect.top - wrapperRect.top}px`;
                spans[spanIdx].style.visibility = '';
                spanIdx++;
              }
            });
          });

          return wrapper;
        }, { side: -1, key: `ln-alert-${offset}`, blockStartDelta: 0 });

        decorations.push(widget);
      } else if (typeName === 'bulletList' || typeName === 'orderedList' || typeName === 'taskList') {
        // Single-anchor pattern (like tables): one widget with per-item absolute spans
        const itemInfos = collectResolvedListItemEntries(node, offset, lines, contentLineIndex)
          .map(({ lineNum, selFrom, selTo }) => ({
            lineNum,
            selFrom,
            selTo,
          }));

        const widget = Decoration.widget(offset, () => {
          const wrapper = document.createElement('div');
          wrapper.className = 'line-number-table-anchor';

          const spans: HTMLElement[] = [];
          for (const info of itemInfos) {
            const span = createGutterSpan(info.lineNum, null, info.selFrom, info.selTo);
            span.style.position = 'absolute';
            span.style.visibility = 'hidden';
            wrapper.appendChild(span);
            spans.push(span);
          }

          requestAnimationFrame(() => {
            const listEl = wrapper.nextElementSibling;
            if (!listEl) return;
            syncAnchorExtent(wrapper, listEl);
            const wrapperRect = wrapper.getBoundingClientRect();
            const items = listEl.querySelectorAll('li');
            items.forEach((li: Element, i: number) => {
              if (i < spans.length) {
                const liRect = li.getBoundingClientRect();
                spans[i].style.top = `${liRect.top - wrapperRect.top}px`;
                spans[i].style.visibility = '';
              }
            });
          });

          return wrapper;
        }, { side: -1, key: `ln-list-${offset}`, blockStartDelta: 0 });

        decorations.push(widget);
      } else {
        // Standard widget for non-table, non-list nodes
        const selFrom = offset + 1;
        const selTo = offset + node.nodeSize - 1;
        const widget = Decoration.widget(offset + 1, () => {
          return createGutterSpan(lineNum, headingLevel, selFrom, selTo);
        }, { side: -1, key: `ln-${offset}`, blockStartDelta: 1 });

        decorations.push(widget);
      }

    });

    const selectedOffsets = new Set(selectedInfos.map(info => info.offset));
    let preservedDecorations = 0;
    if (oldDecorations) {
      const preservedPrefix = oldDecorations.find().filter(decoration => {
        const blockStartDelta =
          typeof decoration.spec?.blockStartDelta === 'number' ? decoration.spec.blockStartDelta : 0;
        const currentBlockStart = decoration.from - blockStartDelta;
        return !selectedOffsets.has(currentBlockStart);
      });
      preservedDecorations = preservedPrefix.length;
      const decorationSet = DecorationSet.create(doc, preservedPrefix.concat(decorations));
      lineNumberBuildCount++;
      lastLineNumberBuildStats = {
        cutoffOffset: cutoffOffset ?? null,
        refreshMode,
        rebuiltBlocks: decorations.length,
        totalBlocks: totalDecoratedBlocks,
        preservedDecorations,
      };
      if (nextChunkStartIndex !== null) {
        scheduleBackgroundLineNumberChunk(editor, cutoffOffset, nextChunkStartIndex);
      }
      return decorationSet;
    }

    const decorationSet = DecorationSet.create(doc, decorations);
    lineNumberBuildCount++;
    lastLineNumberBuildStats = {
      cutoffOffset: cutoffOffset ?? null,
      refreshMode,
      rebuiltBlocks: decorations.length,
      totalBlocks: totalDecoratedBlocks,
      preservedDecorations: 0,
    };
    if (nextChunkStartIndex !== null) {
      scheduleBackgroundLineNumberChunk(editor, cutoffOffset, nextChunkStartIndex);
    }
    return decorationSet;
  } catch {
    return DecorationSet.empty;
  }
}

export const __testing = {
  getLineNumberBuildCount(): number {
    return lineNumberBuildCount;
  },
  getLastLineNumberBuildStats(): {
    cutoffOffset: number | null;
    refreshMode: LineNumberRefreshMode;
    rebuiltBlocks: number;
    totalBlocks: number;
    preservedDecorations: number;
  } {
    return { ...lastLineNumberBuildStats };
  },
  isLineNumberRefreshScheduled(): boolean {
    return lineNumberRebuildTimeout !== null;
  },
  resetLineNumberPluginState(): void {
    if (lineNumberRebuildTimeout) {
      clearTimeout(lineNumberRebuildTimeout);
      lineNumberRebuildTimeout = null;
    }
    cancelPendingBackgroundLineNumberFill();
    if (gutterRepositionFrame !== null) {
      cancelAnimationFrame(gutterRepositionFrame);
      gutterRepositionFrame = null;
    }
    pendingLineNumberRefreshCutoff = null;
    lineNumberBuildCount = 0;
    lastLineNumberBuildStats = {
      cutoffOffset: null,
      refreshMode: 'full',
      rebuiltBlocks: 0,
      totalBlocks: 0,
      preservedDecorations: 0,
    };
  },
};

/**
 * Reposition all absolutely-positioned gutter spans inside .line-number-table-anchor
 * elements. Called when editor width changes (nav pane, source view, window resize).
 */
export function repositionGutterDecorations(): void {
  const anchors = document.querySelectorAll('.line-number-table-anchor');
  anchors.forEach(wrapper => {
    const sibling = wrapper.nextElementSibling;
    if (!sibling) return;
    syncAnchorExtent(wrapper, sibling);
    const spans = wrapper.querySelectorAll('.line-number-gutter') as NodeListOf<HTMLElement>;

    // Determine what kind of sibling this is and get the child elements to align to
    let children: NodeListOf<Element> | Element[];
    const table = sibling.querySelector('table');
    if (table) {
      children = table.querySelectorAll('tr');
    } else if (sibling.classList.contains('github-alert')) {
      positionGitHubAlertSpans(wrapper, sibling, Array.from(spans));
      return;
    } else if (sibling.tagName === 'UL' || sibling.tagName === 'OL') {
      children = sibling.querySelectorAll('li');
    } else {
      // blockquote / githubAlert: direct children
      children = sibling.querySelectorAll(':scope > *');
    }

    const wrapperRect = wrapper.getBoundingClientRect();
    children.forEach((child: Element, i: number) => {
      if (i < spans.length) {
        const childRect = child.getBoundingClientRect();
        spans[i].style.top = `${childRect.top - wrapperRect.top}px`;
      }
    });
  });
}

/**
 * Set up a ResizeObserver on the editor element to reposition gutter decorations
 * when the editor width changes (due to nav pane, source view, or window resize).
 */
let resizeObserverInstalled = false;
export function installGutterResizeObserver(): void {
  if (resizeObserverInstalled) return;
  const editorEl = document.querySelector('#editor') as HTMLElement;
  if (!editorEl) return;

  let lastWidth = editorEl.offsetWidth;
  const observer = new ResizeObserver(() => {
    const newWidth = editorEl.offsetWidth;
    if (newWidth !== lastWidth) {
      lastWidth = newWidth;
      repositionGutterDecorations();
    }
  });
  observer.observe(editorEl);
  resizeObserverInstalled = true;
}
