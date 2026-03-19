/**
 * Copyright (c) 2025-2026 Concret.io
 *
 * Licensed under the MIT License. See LICENSE file in the project root for details.
 */

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { getEditorMarkdownForSync } from '../utils/markdownSerialization';

const LINE_NUMBERS_PLUGIN_KEY = new PluginKey('lineNumbers');

/** Module-level document filename, set by editor.ts on document load */
let documentFilename = '';

/**
 * Set the document filename for line-copy feature.
 */
export function setDocumentFilename(name: string): void {
  documentFilename = name;
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
            if (!tr.docChanged && !tr.getMeta('lineNumbersRefresh')) {
              return oldDecorations;
            }
            return buildDecorations(tr.doc, editor);
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
    while (i < lines.length) {
      const line = lines[i];
      if (line.trim() === '') {
        if (i + 1 < lines.length && (lines[i + 1].match(/^(\s{2,}|\t)/) || lines[i + 1].match(/^(\s*[-*+]|\s*\d+[.)]\s|\s*- \[)/))) {
          count++; i++; continue;
        }
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

    // Set CSS variable for dynamic gutter width based on line count
    const digits = String(totalLines).length;
    const gutterChars = 2 + 1 + 1 + digits + 1;
    const gutterWidth = Math.max(4, gutterChars * 0.65);
    const editorEl = document.querySelector('.markdown-editor') as HTMLElement | null;
    if (editorEl) {
      editorEl.style.setProperty('--gutter-width', `${gutterWidth}em`);
    }

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
      } else {
        // Standard widget for non-table nodes
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
