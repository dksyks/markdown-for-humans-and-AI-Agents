/**
 * Copyright (c) 2025-2026 Concret.io
 *
 * Licensed under the MIT License. See LICENSE file in the project root for details.
 */

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { getEditorMarkdownForSync } from '../utils/markdownSerialization';
import { editorDisplaySettings } from '../BubbleMenuView';

const LINE_NUMBERS_PLUGIN_KEY = new PluginKey('lineNumbers');

/** Module-level document filename, set by editor.ts on document load */
let documentFilename = '';

/** Cached total line count for gutter width recalculation */
let cachedTotalLines = 0;

/**
 * Recalculate and apply the --gutter-width CSS variable based on which
 * decorations are currently enabled and the document line count.
 */
export function updateGutterWidth(totalLines?: number): void {
  if (totalLines !== undefined) cachedTotalLines = totalLines;
  const digits = String(cachedTotalLines || 1).length;

  const showHeading = editorDisplaySettings.showHeadingGutter !== false;
  const showLines = editorDisplaySettings.showLineNumbers === true;

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
              if (editor?.view) {
                editor.view.dispatch(
                  editor.state.tr.setMeta('lineNumbersRefresh', true)
                );
              }
            }, 200);
            return DecorationSet.empty;
          },
          apply(tr, oldDecorations) {
            if (tr.getMeta('lineNumbersRefresh')) {
              return buildDecorations(tr.doc, editor);
            }
            if (tr.docChanged) {
              if (lineNumberRebuildTimeout) {
                clearTimeout(lineNumberRebuildTimeout);
              }
              lineNumberRebuildTimeout = setTimeout(() => {
                lineNumberRebuildTimeout = null;
                if (editor?.view) {
                  editor.view.dispatch(
                    editor.state.tr.setMeta('lineNumbersRefresh', true)
                  );
                }
              }, 500);
              return oldDecorations;
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

/**
 * Find the markdown line for the Nth list item within a list block.
 * Returns 0-based line index, or -1 if not found.
 */
function findListItemLine(
  listType: string,
  itemIndex: number,
  lines: string[],
  listStartLine: number
): number {
  const pattern = listType === 'bulletList'
    ? /^\s*[-*+] /
    : listType === 'orderedList'
      ? /^\s*\d+[.)]\s/
      : /^\s*- \[/;

  let found = 0;
  for (let i = listStartLine; i < lines.length; i++) {
    if (lines[i].trim() === '') continue;
    // Stop if we hit a non-list, non-continuation line
    if (!pattern.test(lines[i]) && !/^(\s{2,}|\t)/.test(lines[i])) break;
    if (pattern.test(lines[i])) {
      if (found === itemIndex) return i;
      found++;
    }
  }
  return -1;
}

/**
 * Given a ProseMirror position, return the 1-based markdown source line number.
 * Returns -1 if the position cannot be mapped.
 */
export function posToMarkdownLine(editor: any, pos: number): number {
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

    const nodeEnd = offset + node.nodeSize;
    const contentLineIndex = findBlockLine(node, lines, lineIndex);

    if (pos >= offset && pos < nodeEnd) {
      result = contentLineIndex >= 0 ? contentLineIndex + 1 : -1;
      return;
    }

    const countFrom = Math.max(lineIndex, contentLineIndex >= 0 ? contentLineIndex : lineIndex);
    const blockLines = countBlockLines(node, lines, countFrom);
    lineIndex = countFrom + blockLines;
  });

  return result;
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
      result = offset + 1; // +1 to get inside the node content
      return;
    }

    lineIndex = blockEndLine;
  });

  return result;
}

/**
 * Build decorations for all top-level blocks.
 */
function buildDecorations(doc: any, editor: any): DecorationSet {
  try {
    const markdown = getEditorMarkdownForSync(editor);

    // If serializer isn't ready yet (returns empty), bail out and schedule retry
    if (!markdown || markdown.length === 0) {

      setTimeout(() => {
        if (editor?.view) {
          editor.view.dispatch(
            editor.state.tr.setMeta('lineNumbersRefresh', true)
          );
        }
      }, 300);
      return DecorationSet.empty;
    }

    const lines = markdown.split('\n');
    const totalLines = lines.length;

    // Set CSS variable for dynamic gutter width based on line count and active decorations
    updateGutterWidth(totalLines);

    const decorations: Decoration[] = [];
    let lineIndex = 0;

    doc.forEach((node: any, offset: number) => {
      const typeName = node.type.name;
      const headingLevel = typeName === 'heading' ? node.attrs?.level : null;

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
      let contentLineIndex = findBlockLine(node, lines, lineIndex);
      if (contentLineIndex < 0) {
        // Fallback: skip blanks from current position
        contentLineIndex = lineIndex;
        while (contentLineIndex < lines.length && lines[contentLineIndex].trim() === '') {
          contentLineIndex++;
        }
      }

      const lineNum = contentLineIndex + 1; // 1-based

      // Helper: build a gutter span for a given line number
      const createGutterSpan = (ln: number, hLevel: number | null, selFrom: number, selTo: number): HTMLElement => {
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
            editor.commands.setTextSelection({ from: selFrom, to: selTo });
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
        const rowInfos: { lineNum: number; selFrom: number; selTo: number }[] = [];
        let ri = 0;
        tableNode.forEach((row: any, rowOff: number) => {
          const rl = ri === 0 ? lineNum : lineNum + ri + 1;
          const rowAbsStart = tableOffset + 1 + rowOff + 1;
          const rowAbsEnd = tableOffset + 1 + rowOff + row.nodeSize - 1;
          rowInfos.push({ lineNum: rl, selFrom: rowAbsStart, selTo: rowAbsEnd });
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
            const tableEl = wrapper.nextElementSibling?.querySelector('table');
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
        }, { side: -1, key: `ln-table-${offset}` });

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
            positionGitHubAlertSpans(wrapper, blockEl, spans);
          });

          return wrapper;
        }, { side: -1, key: `ln-alert-${offset}` });

        decorations.push(widget);
      } else if (typeName === 'blockquote') {
        // Single-anchor pattern: one widget with per-line absolute spans
        // Count the > lines in the markdown for this block
        const alertLineInfos: { lineNum: number; selFrom: number; selTo: number }[] = [];
        let childIdx = 0;
        node.forEach((child: any, childOff: number) => {
          const childAbsStart = offset + 1 + childOff + 1;
          const childAbsEnd = offset + 1 + childOff + child.nodeSize - 1;
          const childLine = contentLineIndex + childIdx;
          const childLineNum = childLine < lines.length ? childLine + 1 : lineNum + childIdx;
          alertLineInfos.push({ lineNum: childLineNum, selFrom: childAbsStart, selTo: childAbsEnd });
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
        }, { side: -1, key: `ln-alert-${offset}` });

        decorations.push(widget);
      } else if (typeName === 'bulletList' || typeName === 'orderedList' || typeName === 'taskList') {
        // Single-anchor pattern (like tables): one widget with per-item absolute spans
        const itemInfos: { lineNum: number; selFrom: number; selTo: number }[] = [];
        let itemIdx = 0;
        node.forEach((listItem: any, itemOff: number) => {
          const itemAbsStart = offset + 1 + itemOff + 1; // into listItem content
          const itemAbsEnd = offset + 1 + itemOff + listItem.nodeSize - 1;
          const itemLine = findListItemLine(typeName, itemIdx, lines, contentLineIndex);
          const itemLineNum = itemLine >= 0 ? itemLine + 1 : lineNum + itemIdx;
          itemInfos.push({ lineNum: itemLineNum, selFrom: itemAbsStart, selTo: itemAbsEnd });
          itemIdx++;
        });

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
            const wrapperRect = wrapper.getBoundingClientRect();
            const items = listEl.querySelectorAll(':scope > li');
            items.forEach((li: Element, i: number) => {
              if (i < spans.length) {
                const liRect = li.getBoundingClientRect();
                spans[i].style.top = `${liRect.top - wrapperRect.top}px`;
                spans[i].style.visibility = '';
              }
            });
          });

          return wrapper;
        }, { side: -1, key: `ln-list-${offset}` });

        decorations.push(widget);
      } else {
        // Standard widget for non-table, non-list nodes
        const selFrom = offset + 1;
        const selTo = offset + node.nodeSize - 1;
        const widget = Decoration.widget(offset + 1, () => {
          return createGutterSpan(lineNum, headingLevel, selFrom, selTo);
        }, { side: -1, key: `ln-${offset}` });

        decorations.push(widget);
      }

      // Advance lineIndex past this block.
      // Start counting from contentLineIndex to correctly skip all block lines.
      const countFrom = Math.max(lineIndex, contentLineIndex);
      const blockLines = countBlockLines(node, lines, countFrom);
      lineIndex = countFrom + blockLines;
    });

    return DecorationSet.create(doc, decorations);
  } catch {
    return DecorationSet.empty;
  }
}

/**
 * Reposition all absolutely-positioned gutter spans inside .line-number-table-anchor
 * elements. Called when editor width changes (nav pane, source view, window resize).
 */
export function repositionGutterDecorations(): void {
  const anchors = document.querySelectorAll('.line-number-table-anchor');
  anchors.forEach(wrapper => {
    const sibling = wrapper.nextElementSibling;
    if (!sibling) return;
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
      children = sibling.querySelectorAll(':scope > li');
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
