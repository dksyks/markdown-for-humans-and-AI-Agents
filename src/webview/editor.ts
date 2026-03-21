/**
 * Copyright (c) 2025-2026 Concret.io
 *
 * Licensed under the MIT License. See LICENSE file in the project root for details.
 */

// Import CSS files (esbuild will bundle these)
import './editor.css';

declare const __BUILD_TIME__: string;
const BUILD_TAG = `[MD4H ${__BUILD_TIME__}]`;
const SELECTION_DEBUG_LOGS = false;
import './codicon.css';

import { Editor } from '@tiptap/core';
import { Extension } from '@tiptap/core';
import { NodeSelection, Plugin, PluginKey } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { TableKit } from '@tiptap/extension-table';
import { ListKit } from '@tiptap/extension-list';
import Link from '@tiptap/extension-link';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { CustomImage } from './extensions/customImage';
import { lowlight } from 'lowlight';
import { Mermaid } from './extensions/mermaid';
import { IndentedImageCodeBlock } from './extensions/indentedImageCodeBlock';
import { SpaceFriendlyImagePaths } from './extensions/spaceFriendlyImagePaths';
import { TabIndentation } from './extensions/tabIndentation';
import { GitHubAlerts } from './extensions/githubAlerts';
import { ImageEnterSpacing } from './extensions/imageEnterSpacing';
import { MarkdownParagraph } from './extensions/markdownParagraph';
import { OrderedListMarkdownFix } from './extensions/orderedListMarkdownFix';
import { LineNumbers, setDocumentFilename, posToMarkdownLine, markdownLineToPos, installGutterResizeObserver } from './extensions/lineNumbers';
import { createFormattingToolbar, createTableMenu, updateToolbarStates, updateDisplaySettings } from './BubbleMenuView';
import { getEditorMarkdownForSync } from './utils/markdownSerialization';
import {
  setupImageDragDrop,
  hasPendingImageSaves,
  getPendingImageCount,
} from './features/imageDragDrop';
import { toggleTocOverlay, setTocPanelWidth, showTocOverlay, isTocVisible, updateActiveHeading, refreshTocList } from './features/tocOverlay';
import { toggleSearchOverlay, toggleReplaceOverlay, isSearchVisible, searchNext, searchPrev, replaceAll } from './features/searchOverlay';
import { showLinkDialog } from './features/linkDialog';
import { processPasteContent, parseFencedCode } from './utils/pasteHandler';
import { copySelectionAsMarkdown, getRangeAsMarkdown, getSelectionAsMarkdown } from './utils/copyMarkdown';
import { shouldAutoLink } from './utils/linkValidation';
import { buildOutlineFromEditor } from './utils/outline';
import { scrollToHeading, scrollToPos } from './utils/scrollToHeading';
import { collectExportContent, getDocumentTitle } from './utils/exportContent';
import { renderProposalRedlineHtml, renderMarkdownHtml } from './utils/proposalRedline';

interface ResizeSelectionAnchor {
  pos: number;
  top: number;
  left: number;
  scrollTop: number;
  editorWidth: number | null;
}
import {
  buildProposalEditableMarkdown,
  extractProposalReplacementFromEditableMarkdown,
  normalizeProposalReplacementForContext,
} from './utils/proposalContext';
import { applyColors, updateColorSettingsPanel, DEFAULT_COLORS } from './features/colorSettings';
import { resolveSelectionMatch } from './utils/selectionMatching';
import {
  calculateProposalRevealScrollTop,
  calculateProposalRevealBottomPadding,
  findRenderedBlockSequence,
  findTextBlockSequence,
  getNormalizedSelectionBlocks,
  getProposalRevealTopPadding,
  buildPinnedBlockRanges,
  resolvePinnedTextRange,
  resolvePinnedBlockElementAtPos,
  resolvePinnedBlockElements,
  resolveTextRangeWithinTextBlock,
} from './utils/pinnedSelection';

// Helper function for slug generation (same as in linkDialog)
function generateHeadingSlug(text: string, existingSlugs: Set<string>): string {
  const slug = text
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  let finalSlug = slug;
  let counter = 1;
  while (existingSlugs.has(finalSlug)) {
    finalSlug = `${slug}-${counter}`;
    counter++;
  }

  existingSlugs.add(finalSlug);
  return finalSlug;
}
import {
  handleImageResized,
  showResizeModalAfterDownload,
  showImageResizeModal,
} from './features/imageResizeModal';
import {
  clearImageMetadataCache,
  updateImageMetadataDimensions,
  getCachedImageMetadata,
} from './features/imageMetadata';
// Import rename dialog to register global function
import './features/imageRenameDialog';

// Import common languages for syntax highlighting
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import sql from 'highlight.js/lib/languages/sql';
import java from 'highlight.js/lib/languages/java';
import go from 'highlight.js/lib/languages/go';
import rust from 'highlight.js/lib/languages/rust';

// Register languages with lowlight
lowlight.registerLanguage('javascript', javascript);
lowlight.registerLanguage('typescript', typescript);
lowlight.registerLanguage('python', python);
lowlight.registerLanguage('bash', bash);
lowlight.registerLanguage('json', json);
lowlight.registerLanguage('markdown', markdown);
lowlight.registerLanguage('css', css);
lowlight.registerLanguage('html', xml);
lowlight.registerLanguage('xml', xml);
lowlight.registerLanguage('sql', sql);
lowlight.registerLanguage('java', java);
lowlight.registerLanguage('go', go);
lowlight.registerLanguage('rust', rust);

// VS Code API type definitions
type VsCodeApi = {
  postMessage: (message: unknown) => void;
  getState: () => unknown;
  setState: (state: unknown) => void;
};

declare const acquireVsCodeApi: () => VsCodeApi;
declare const __MD4H_BUILD_STAMP__: string;
declare const __IS_DEV_BUILD__: boolean;
// Extended window interface for MD4H globals
declare global {
  interface Window {
    vscode?: VsCodeApi;
    resolveImagePath?: (relativePath: string) => Promise<string>;
    getImageReferences?: (imagePath: string) => Promise<unknown>;
    checkImageRename?: (oldPath: string, newName: string) => Promise<unknown>;
    setupImageResize?: (
      img: HTMLImageElement,
      editorInstance?: Editor,
      vscodeApi?: VsCodeApi
    ) => void;
    skipResizeWarning?: boolean;
    imagePath?: string;
    imagePathBase?: string;
    _imageCacheBust?: Map<string, number>;
    _workspaceCheckCallbacks?: Map<string, (result: unknown) => void>;
  }
}

const vscode = acquireVsCodeApi();

// Make vscode API available globally for toolbar buttons
window.vscode = vscode;

function ensureBuildStampBadge() {
  if (document.getElementById('md4h-build-stamp')) {
    return;
  }

  const badge = document.createElement('div');
  badge.id = 'md4h-build-stamp';
  badge.className = 'md4h-build-stamp';
  badge.textContent = __MD4H_BUILD_STAMP__;
  document.body.appendChild(badge);
}

let editor: Editor | null = null;
let isUpdating = false; // Prevent feedback loops
let formattingToolbar: HTMLElement;
let tableMenu: HTMLElement;
let updateTimeout: number | null = null;
let lastUserEditTime = 0; // Track when user last edited
let pendingInitialContent: string | null = null; // Content from host before editor is ready
let hasSentReadySignal = false;
let isDomReady = document.readyState !== 'loading';
let hasAutoOpenedNav = false; // Track if we've already auto-opened nav for this webview
let lastSyncedSourceLine = -1; // Debounce: only send syncSourceLine when line changes
let isSyncFromSource = false; // Loop guard: true when scrolling due to source editor sync
let isSourceViewOpen = false; // Track whether source view split is open
let sourceSyncRequestCounter = 0;

/** Check if source view is currently open (used by toolbar button) */
(window as any).isSourceVisible = () => isSourceViewOpen;
let outlineUpdateTimeout: number | null = null;
let pendingSelectionRevealMessage:
  | {
      type: 'scrollAndSelect' | 'selectProposalSelection' | 'revealCurrentProposalSelection';
      request_id?: string;
      original?: string;
      context_before?: string | null;
      context_after?: string | null;
      headings_before?: string[] | null;
    }
  | null = null;
let lastProposalSelectionTarget:
  | {
      key: string;
      selFrom: number;
      selTo: number;
      selectionKind?: 'text' | 'node';
    }
  | null = null;
const pinnedSelectionPluginKey = new PluginKey<{ from: number; to: number } | null>(
  'md4hPinnedSelection'
);
const PROPOSAL_TARGET_BLOCK_CLASS = 'md4h-proposal-target-block';
const PROPOSAL_TARGET_SPACER_ID = 'md4h-proposal-target-spacer';
const FORCED_SELECTED_NODE_CLASS = 'md4h-forced-selectednode';

// Hash-based sync deduplication (replaces unreliable ignoreNextUpdate boolean)
let lastSentContentHash: string | null = null;
let lastSentTimestamp = 0;

// Navigation history (back/forward through insertion points)
const NAV_HISTORY_MAX = 50;
let navBack: number[] = [];
let navForward: number[] = [];
let navLastRecorded: number | null = null;
let navDebounceTimer: number | null = null;
let navIsJumping = false; // suppress recording while we're performing a back/forward jump

function navRecordPosition(pos: number, immediate = false): void {
  if (navIsJumping) return;
  if (navDebounceTimer !== null) {
    clearTimeout(navDebounceTimer);
    navDebounceTimer = null;
  }
  const doRecord = () => {
    if (navLastRecorded !== null && Math.abs(pos - navLastRecorded) < 100) return;
    if (navLastRecorded !== null) {
      navBack.push(navLastRecorded);
      if (navBack.length > NAV_HISTORY_MAX) navBack.shift();
    }
    navLastRecorded = pos;
    navForward = [];
  };
  if (immediate) {
    doRecord();
  } else {
    navDebounceTimer = window.setTimeout(doRecord, 1000);
  }
}

/**
 * Simple hash function (djb2 algorithm) for content deduplication
 */
function hashString(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) + hash + str.charCodeAt(i);
  }
  return hash.toString(36);
}

function createPinnedSelectionPlugin() {
  return new Plugin<{ from: number; to: number } | null>({
    key: pinnedSelectionPluginKey,
    state: {
      init: () => null,
      apply(tr, value) {
        const nextValue = tr.getMeta(pinnedSelectionPluginKey);
        if (nextValue !== undefined) {
          return nextValue;
        }
        if (value && tr.docChanged) {
          const mappedFrom = tr.mapping.map(value.from);
          const mappedTo = tr.mapping.map(value.to);
          return mappedFrom < mappedTo ? { from: mappedFrom, to: mappedTo } : null;
        }
        return value;
      },
    },
  });
}

const PinnedSelectionExtension = Extension.create({
  name: 'md4hPinnedSelection',
  addProseMirrorPlugins() {
    return [createPinnedSelectionPlugin()];
  },
});

function clearProposalTargetHighlight() {
  document
    .querySelectorAll(`.${PROPOSAL_TARGET_BLOCK_CLASS}`)
    .forEach(element => element.classList.remove(PROPOSAL_TARGET_BLOCK_CLASS));
  document
    .querySelectorAll(`.${FORCED_SELECTED_NODE_CLASS}`)
    .forEach(element => element.classList.remove(FORCED_SELECTED_NODE_CLASS));
  document.getElementById(PROPOSAL_TARGET_SPACER_ID)?.remove();
  document.documentElement.style.removeProperty('--md4h-proposal-scroll-margin-top');
}

function syncForcedSelectedAlertClass(editor: Editor, from: number, to: number, enabled: boolean) {
  document
    .querySelectorAll(`.${FORCED_SELECTED_NODE_CLASS}`)
    .forEach(element => element.classList.remove(FORCED_SELECTED_NODE_CLASS));

  if (!enabled) {
    return;
  }

  const nodeDom = editor.view.nodeDOM(from);
  const startElement =
    nodeDom instanceof HTMLElement
      ? nodeDom
      : nodeDom instanceof Text
        ? nodeDom.parentElement
        : null;
  const contentElement =
    (startElement?.closest('.github-alert-content') as HTMLElement | null) ??
    (startElement?.closest('blockquote.github-alert')?.querySelector(
      '.github-alert-content'
    ) as HTMLElement | null) ??
    (resolvePinnedBlockElementAtPos(editor.view, from, to)?.closest(
      'blockquote.github-alert'
    )?.querySelector('.github-alert-content') as HTMLElement | null);
  if (contentElement instanceof HTMLElement) {
    contentElement.classList.add(FORCED_SELECTED_NODE_CLASS);
  }
}

function getScrollContainer(): HTMLElement {
  const scrollingElement = document.scrollingElement;
  if (scrollingElement instanceof HTMLElement) {
    return scrollingElement;
  }

  return document.documentElement;
}

function readWebviewSelectionViewportRect(): {
  top: number | null;
  bottom: number | null;
  left: number | null;
  height: number | null;
} {
  try {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return { top: null, bottom: null, left: null, height: null };
    }

    const range = selection.getRangeAt(0).cloneRange();
    if (range.collapsed) {
      const rects = range.getClientRects();
      const rect = rects.length > 0 ? rects[0] : range.getBoundingClientRect();
      return {
        top: Number.isFinite(rect.top) ? rect.top : null,
        bottom: Number.isFinite(rect.bottom) ? rect.bottom : null,
        left: Number.isFinite(rect.left) ? rect.left : null,
        height: Number.isFinite(rect.height) ? rect.height : null,
      };
    }

    const rect = range.getBoundingClientRect();
    return {
      top: Number.isFinite(rect.top) ? rect.top : null,
      bottom: Number.isFinite(rect.bottom) ? rect.bottom : null,
      left: Number.isFinite(rect.left) ? rect.left : null,
      height: Number.isFinite(rect.height) ? rect.height : null,
    };
  } catch {
    return { top: null, bottom: null, left: null, height: null };
  }
}

function readSourceSyncViewportRatio(editorInstance: Editor): number | null {
  try {
    const editorRoot = document.querySelector('#editor') as HTMLElement | null;
    const viewportRect = readWebviewSelectionViewportRect();
    const selectionViewportTop = viewportRect.top;
    const editorRect = editorRoot?.getBoundingClientRect() ?? null;
    const visibleTop = Math.max(0, editorRect?.top ?? 0);
    const visibleBottom = Math.min(window.innerHeight, editorRect?.bottom ?? window.innerHeight);
    const visibleHeight = visibleBottom - visibleTop;

    if (!Number.isFinite(selectionViewportTop) || visibleHeight <= 0) {
      return null;
    }

    if (selectionViewportTop < visibleTop - 32 || selectionViewportTop > visibleBottom + 32) {
      return null;
    }

    const ratio = (selectionViewportTop - visibleTop) / visibleHeight;
    if (!Number.isFinite(ratio)) {
      return null;
    }

    return Math.max(0, Math.min(1, ratio));
  } catch {
    return null;
  }
}

function postSourceSync(
  editorInstance: Editor,
  options: { force?: boolean; reason?: string } = {}
): void {
  const { from } = editorInstance.state.selection;
  const sourceLine = posToMarkdownLine(editorInstance, from);
  const reason = options.reason ?? 'unspecified';
  if (sourceLine <= 0) {
    return;
  }

  if (!options.force && sourceLine === lastSyncedSourceLine) {
    return;
  }

  lastSyncedSourceLine = sourceLine;
  const viewportRatio = readSourceSyncViewportRatio(editorInstance);
  const requestId = `webview-source-sync-${Date.now()}-${++sourceSyncRequestCounter}`;
  vscode.postMessage({
    type: 'syncSourceLine',
    requestId,
    reason,
    line: sourceLine,
    viewportRatio,
  });
}

function postSourceResizeSession(
  editorInstance: Editor,
  phase: 'start' | 'extend' | 'settled'
): void {
  const requestId = `webview-source-resize-${Date.now()}-${++sourceSyncRequestCounter}`;
  const sourceLine = posToMarkdownLine(editorInstance, editorInstance.state.selection.from);
  const viewportRatio = readSourceSyncViewportRatio(editorInstance);
  vscode.postMessage({
    type: 'sourceResizeSession',
    requestId,
    phase,
    line: sourceLine,
    viewportRatio,
  });
}

function setProposalTargetSpacer(height: number) {
  const existingSpacer = document.getElementById(PROPOSAL_TARGET_SPACER_ID);
  if (height <= 0) {
    existingSpacer?.remove();
    return;
  }

  const spacer = existingSpacer ?? document.createElement('div');
  spacer.id = PROPOSAL_TARGET_SPACER_ID;
  spacer.setAttribute('aria-hidden', 'true');
  spacer.style.pointerEvents = 'none';
  spacer.style.width = '100%';
  spacer.style.height = `${Math.ceil(height)}px`;

  if (!existingSpacer) {
    document.body.appendChild(spacer);
  }
}

function getRenderedEditorBlocks(): Array<{ element: HTMLElement; text: string }> {
  return Array.from(
    document.querySelectorAll(
      '.ProseMirror.markdown-editor :is(h1, h2, h3, h4, h5, h6, p, li, blockquote, pre)'
    )
  )
    .filter((node): node is HTMLElement => node instanceof HTMLElement)
    .filter(element => !element.closest('.github-alert-content') && !element.closest('.github-alert-header'))
    .map(element => ({
      element,
      text: element.matches('blockquote.github-alert')
        ? [
            (element.querySelector('.github-alert-label')?.textContent ?? '').trim(),
            (element.querySelector('.github-alert-content')?.textContent ?? '').trim(),
          ]
            .filter(Boolean)
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim()
        : (element.textContent ?? '').replace(/\s+/g, ' ').trim(),
    }))
    .filter(block => block.text.length > 0);
}

function resolveSelectionRangeFromRenderedBlocks(
  editor: Editor,
  selectedMarkdown: string,
  options?: {
    contextBefore?: string | null;
    contextAfter?: string | null;
  }
): { from: number; to: number; targetBlocks: HTMLElement[] } | null {
  const selectionBlocks = getNormalizedSelectionBlocks(selectedMarkdown);
  const renderedBlocks = getRenderedEditorBlocks();
  const fullHeadingSelection = reconstructHeadingSelection(
    selectedMarkdown,
    options?.contextBefore ?? null,
    options?.contextAfter ?? null
  );

  // When the selection is a heading (either starts with # markers, or context_before
  // ends with heading markers like "#### "), restrict matching to heading elements
  // first to avoid spurious matches against inline paragraph text that contains
  // the same words as the heading.
  const isHeadingSelection =
    /^#{1,6}\s/.test(selectedMarkdown.trimStart()) ||
    /^#{1,6}\s*$/.test((options?.contextBefore ?? '').trimEnd().split('\n').pop() ?? '');
  const headingOnlyBlocks = isHeadingSelection
    ? renderedBlocks.filter(b => /^h[1-6]$/i.test(b.element.tagName))
    : null;

  let matchedBlocks =
    headingOnlyBlocks && headingOnlyBlocks.length > 0
      ? findRenderedBlockSequence(
          headingOnlyBlocks,
          fullHeadingSelection ? [fullHeadingSelection.text] : selectionBlocks,
          {
            selectedText: fullHeadingSelection?.markdown ?? selectedMarkdown,
            contextBefore: options?.contextBefore ?? null,
            contextAfter: options?.contextAfter ?? null,
          }
        )
      : [];

  if (matchedBlocks.length === 0 && headingOnlyBlocks && headingOnlyBlocks.length > 0 && fullHeadingSelection) {
    matchedBlocks = findRenderedBlockSequence(headingOnlyBlocks, selectionBlocks, {
          selectedText: selectedMarkdown,
          contextBefore: options?.contextBefore ?? null,
          contextAfter: options?.contextAfter ?? null,
        });
  }

  if (matchedBlocks.length === 0) {
    matchedBlocks = findRenderedBlockSequence(renderedBlocks, selectionBlocks, {
      selectedText: selectedMarkdown,
      contextBefore: options?.contextBefore ?? null,
      contextAfter: options?.contextAfter ?? null,
    });
  }

  if (matchedBlocks.length === 0) {
    return null;
  }

  const firstBlock = matchedBlocks[0].element;
  const lastBlock = matchedBlocks[matchedBlocks.length - 1].element;
  let from = editor.view.posAtDOM(firstBlock, 0);
  let to = editor.view.posAtDOM(lastBlock, lastBlock.childNodes.length);
  if (typeof from !== 'number' || typeof to !== 'number') {
    return null;
  }

  // Refine `from` if the first selected block is a partial match within the first rendered block
  // (e.g. selection starts at "marriage." which is the end of a longer paragraph).
  const firstSelectedBlock = selectionBlocks[0];
  const firstMatchedText = matchedBlocks[0].text;
  if (firstSelectedBlock && firstMatchedText !== firstSelectedBlock) {
    const firstBlockNodeEnd = editor.view.posAtDOM(firstBlock, firstBlock.childNodes.length);
    const refined = resolveTextRangeWithinTextBlock(
      editor.state.doc,
      from,
      firstBlockNodeEnd,
      firstSelectedBlock,
      { contextBefore: options?.contextBefore ?? null, contextAfter: null }
    );
    if (refined) {
      from = refined.from;
    }
  }

  // Refine `to` if the last selected block is a partial match within the last rendered block.
  const lastSelectedBlock = selectionBlocks[selectionBlocks.length - 1];
  const lastMatchedText = matchedBlocks[matchedBlocks.length - 1].text;
  if (lastSelectedBlock && lastMatchedText !== lastSelectedBlock && lastBlock !== firstBlock) {
    const lastBlockStart = editor.view.posAtDOM(lastBlock, 0);
    const refined = resolveTextRangeWithinTextBlock(
      editor.state.doc,
      lastBlockStart,
      to,
      lastSelectedBlock,
      { contextBefore: null, contextAfter: options?.contextAfter ?? null }
    );
    if (refined) {
      to = refined.to;
    }
  }

  return {
    from,
    to,
    targetBlocks: matchedBlocks.map(block => block.element),
  };
}

function resolveSelectionRangeFromGitHubAlerts(
  editor: Editor,
  selectedMarkdown: string,
  options?: {
    contextBefore?: string | null;
    contextAfter?: string | null;
  }
): { from: number; to: number } | null {
  const alertMatch = selectedMarkdown.match(/^\s*>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION|COMMENT)\]/im);
  if (!alertMatch) {
    return null;
  }

  const selectionBlocks = getNormalizedSelectionBlocks(selectedMarkdown);
  const alertBlocks: Array<{ text: string; from: number; to: number }> = [];

  editor.state.doc.descendants((node, pos) => {
    if (node.type?.name !== 'githubAlert') {
      return true;
    }

    const alertType = String(node.attrs?.alertType ?? '').trim();
    const content = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
    const text = [alertType, content].filter(Boolean).join(' ').trim();
    if (!text) {
      return true;
    }

    alertBlocks.push({
      text,
      from: pos,
      to: pos + node.nodeSize,
    });

    return true;
  });

  const matchedBlocks = findTextBlockSequence(alertBlocks, selectionBlocks, {
    selectedText: selectedMarkdown,
    contextBefore: options?.contextBefore ?? null,
    contextAfter: options?.contextAfter ?? null,
  });
  if (matchedBlocks.length === 0) {
    return null;
  }

  return {
    from: matchedBlocks[0].from,
    to: matchedBlocks[matchedBlocks.length - 1].to,
  };
}

function resolveSelectionRangeFromTextBlocks(
  editor: Editor,
  selectedMarkdown: string,
  options?: {
    contextBefore?: string | null;
    contextAfter?: string | null;
  }
): { from: number; to: number } | null {
  const selectionBlocks = getNormalizedSelectionBlocks(selectedMarkdown);
  const fullHeadingSelection = reconstructHeadingSelection(
    selectedMarkdown,
    options?.contextBefore ?? null,
    options?.contextAfter ?? null
  );

  // Detect if the selection is a heading — either by leading # markers or by
  // context_before ending with a heading marker like "#### ".
  const isHeadingCtx =
    /^#{1,6}\s/.test(selectedMarkdown.trimStart()) ||
    /^#{1,6}\s*$/.test((options?.contextBefore ?? '').trimEnd().split('\n').pop() ?? '');

  const allTextBlocks: Array<{ text: string; from: number; to: number; isHeading: boolean }> = [];

  editor.state.doc.descendants((node, pos) => {
    if (!node.isTextblock) {
      return true;
    }

    const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (!text) {
      return true;
    }

    allTextBlocks.push({
      text,
      from: pos,
      to: pos + node.nodeSize,
      isHeading: node.type.name === 'heading',
    });

    return true;
  });

  // When the selection is a heading, try heading-only blocks first to avoid
  // matching inline mentions of the same text in paragraphs.
  const headingBlocks = allTextBlocks.filter(b => b.isHeading);
  const textBlocks = isHeadingCtx && headingBlocks.length > 0 ? headingBlocks : allTextBlocks;

  let matchedBlocks = findTextBlockSequence(
    textBlocks,
    fullHeadingSelection ? [fullHeadingSelection.text] : selectionBlocks,
    {
      selectedText: fullHeadingSelection?.markdown ?? selectedMarkdown,
      contextBefore: options?.contextBefore ?? null,
      contextAfter: options?.contextAfter ?? null,
    }
  );

  if (matchedBlocks.length === 0 && fullHeadingSelection) {
    matchedBlocks = findTextBlockSequence(textBlocks, selectionBlocks, {
      selectedText: selectedMarkdown,
      contextBefore: options?.contextBefore ?? null,
      contextAfter: options?.contextAfter ?? null,
    });
  }

  // If heading-only search found nothing, fall back to all blocks.
  if (matchedBlocks.length === 0 && textBlocks !== allTextBlocks) {
    matchedBlocks = findTextBlockSequence(allTextBlocks, selectionBlocks, {
      selectedText: selectedMarkdown,
      contextBefore: options?.contextBefore ?? null,
      contextAfter: options?.contextAfter ?? null,
    });
  }

  if (matchedBlocks.length === 0) {
    return null;
  }

  if (matchedBlocks.length === 1) {
    const inlineRange = resolveTextRangeWithinTextBlock(
      editor.state.doc,
      matchedBlocks[0].from,
      matchedBlocks[0].to,
      selectedMarkdown,
      {
        selectedText: selectedMarkdown,
        contextBefore: options?.contextBefore ?? null,
        contextAfter: options?.contextAfter ?? null,
      }
    );

    if (inlineRange) {
      return inlineRange;
    }
  }

  return {
    from: matchedBlocks[0].from,
    to: matchedBlocks[matchedBlocks.length - 1].to,
  };
}

function reconstructHeadingSelection(
  selectedMarkdown: string,
  contextBefore: string | null,
  contextAfter: string | null
): { markdown: string; text: string } | null {
  const before = (contextBefore ?? '').split('\n').pop() ?? '';
  const after = (contextAfter ?? '').split('\n')[0] ?? '';

  const combined = `${before}${selectedMarkdown}${after}`;
  const match = combined.match(/^(#{1,6})\s+(.*)$/);
  if (!match) {
    return null;
  }

  return {
    markdown: combined,
    text: match[2].replace(/\s+/g, ' ').trim(),
  };
}

function resolveProposalSelectionTarget(
  editor: Editor,
  original: string,
  ctxBefore: string | null,
  ctxAfter: string | null,
  headingsBefore?: string[] | null
) {
  const fullMarkdown = getEditorMarkdownForSync(editor);
  const gitHubAlertRange = resolveSelectionRangeFromGitHubAlerts(editor, original, {
    contextBefore: ctxBefore,
    contextAfter: ctxAfter,
  });
  const prefersRenderedRange = /^\s*>/m.test(original);
  const renderedRange = gitHubAlertRange
    ? null
    : prefersRenderedRange
    ? resolveSelectionRangeFromRenderedBlocks(editor, original, {
        contextBefore: ctxBefore,
        contextAfter: ctxAfter,
      })
    : null;
  const textBlockRange = gitHubAlertRange || renderedRange
    ? null
    : resolveSelectionRangeFromTextBlocks(editor, original, {
        contextBefore: ctxBefore,
        contextAfter: ctxAfter,
      });
  const fallbackRenderedRange =
    !renderedRange && !textBlockRange
      ? resolveSelectionRangeFromRenderedBlocks(editor, original, {
          contextBefore: ctxBefore,
          contextAfter: ctxAfter,
        })
      : null;
  const fallbackCandidates = Array.from(
    new Set([
      original,
      ...getNormalizedSelectionBlocks(original),
    ])
  ).filter(candidate => candidate.length > 0);

  const occurrences: number[] = [];
  for (const candidate of fallbackCandidates) {
    let searchIdx = 0;
    while (true) {
      const idx = fullMarkdown.indexOf(candidate, searchIdx);
      if (idx === -1) break;
      occurrences.push(idx);
      searchIdx = idx + 1;
    }
  }

  const effectiveRenderedRange = renderedRange ?? fallbackRenderedRange;

  if (!gitHubAlertRange && !textBlockRange && !effectiveRenderedRange && occurrences.length === 0) {
    return null;
  }

  let bestMarkdownIdx = occurrences[0] ?? 0;
  if (occurrences.length > 1 && (ctxBefore || ctxAfter || (headingsBefore && headingsBefore.length > 0))) {
    let bestScore = -1;
    for (const idx of occurrences) {
      let score = 0;
      if (ctxBefore) {
        const before = fullMarkdown.slice(Math.max(0, idx - ctxBefore.length), idx);
        score += commonSuffixLength(before, ctxBefore);
      }
      if (ctxAfter) {
        const after = fullMarkdown.slice(
          idx + original.length,
          idx + original.length + ctxAfter.length
        );
        score += commonPrefixLength(after, ctxAfter);
      }
      if (headingsBefore && headingsBefore.length > 0) {
        // Find the nearest heading before this occurrence and check if it
        // matches the closest expected heading (headingsBefore[0]).
        const textBefore = fullMarkdown.slice(0, idx);
        const headingMatches = [...textBefore.matchAll(/^#{1,6}\s+(.+)$/gm)];
        if (headingMatches.length > 0) {
          const nearestHeading = headingMatches[headingMatches.length - 1][1].trim();
          if (nearestHeading === headingsBefore[0].trim()) {
            score += 500;
          }
        }
      }
      if (score > bestScore) {
        bestScore = score;
        bestMarkdownIdx = idx;
      }
    }
  }
  const { from: selFrom, to: selTo } = gitHubAlertRange
    ? gitHubAlertRange
    : textBlockRange
    ? textBlockRange
    : effectiveRenderedRange
      ? effectiveRenderedRange
      : markdownIndexToPos(
          editor,
          bestMarkdownIdx,
          bestMarkdownIdx + fallbackCandidates[0].length
        );

  return {
    occurrences,
    bestMarkdownIdx,
    renderedRange: effectiveRenderedRange,
    textBlockRange,
    selFrom,
    selTo,
    resolutionMethod: gitHubAlertRange
      ? 'githubAlert'
      : textBlockRange
      ? 'textBlock'
      : effectiveRenderedRange
        ? 'renderedBlock'
        : 'markdownFallback',
  };
}

function getProposalSelectionKey(
  original: string,
  ctxBefore: string | null,
  ctxAfter: string | null
): string {
  return JSON.stringify([original, ctxBefore ?? '', ctxAfter ?? '']);
}

function revealProposalTarget(editor: Editor, from: number, to: number) {
  requestAnimationFrame(() => {
    try {
      const blockRanges = buildPinnedBlockRanges(editor.state.doc, from, to);
      const resolveLiveTargetBlocks = () => {
        const blockMatches = resolvePinnedBlockElements(editor.view, blockRanges);
        if (blockMatches.length > 0) {
          return blockMatches;
        }

        const directMatch = resolvePinnedBlockElementAtPos(editor.view, from, to);
        return directMatch ? [directMatch] : [];
      };
      const initialTargetBlocks = resolveLiveTargetBlocks();
      if (SELECTION_DEBUG_LOGS) {
        console.log(`${BUILD_TAG} revealProposalTarget: from=${from} to=${to} blockRanges=`, blockRanges, 'initialTargetBlocks=', initialTargetBlocks.map(b => b.tagName + ':' + b.textContent?.slice(0, 30)));
      }

      if (initialTargetBlocks.length === 0) {
        if (SELECTION_DEBUG_LOGS) {
          console.log(`${BUILD_TAG} revealProposalTarget: no blocks found, scrollToPos`);
        }
        scrollToPos(editor, from);
        return;
      }

      clearProposalTargetHighlight();

      requestAnimationFrame(() => {
        try {
          const targetBlocks = resolveLiveTargetBlocks();
          if (targetBlocks.length === 0) {
            if (SELECTION_DEBUG_LOGS) {
              console.log(`${BUILD_TAG} revealProposalTarget: no target blocks after relayout from=${from} to=${to}`);
            }
            scrollToPos(editor, from);
            return;
          }

          const firstTarget = targetBlocks[0];
          const lastTarget = targetBlocks[targetBlocks.length - 1];
          const toolbar = document.querySelector('.formatting-toolbar');
          const toolbarHeight = toolbar ? toolbar.getBoundingClientRect().height : 0;
          const proposalRevealTopPadding = getProposalRevealTopPadding(firstTarget.tagName);
          const topOffset = toolbarHeight + proposalRevealTopPadding;
          const bottomMargin = 12;

          targetBlocks.forEach(block => block.classList.add(PROPOSAL_TARGET_BLOCK_CLASS));
          if (SELECTION_DEBUG_LOGS) {
            console.log(
              `${BUILD_TAG} revealProposalTarget: applied highlight class to`,
              targetBlocks.map(
                block =>
                  `${block.tagName}:${(block.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 32)}`
              )
            );
          }
          document.documentElement.style.setProperty(
            '--md4h-proposal-scroll-margin-top',
            `${Math.ceil(topOffset)}px`
          );

          const scrollContainer = getScrollContainer();
          const firstBlockRect = firstTarget.getBoundingClientRect();
          const lastBlockRect = lastTarget.getBoundingClientRect();
          const desiredScrollTop = calculateProposalRevealScrollTop({
            currentScrollTop: scrollContainer.scrollTop,
            viewportHeight: window.innerHeight,
            firstTop: firstBlockRect.top,
            lastBottom: lastBlockRect.bottom,
            topOffset,
            bottomMargin,
          });
          const currentMaxScrollTop = Math.max(0, scrollContainer.scrollHeight - window.innerHeight);
          const bottomPadding = calculateProposalRevealBottomPadding({
            desiredScrollTop,
            currentMaxScrollTop,
            extraMargin: 24,
          });

          setProposalTargetSpacer(bottomPadding);
          scrollContainer.scrollTop = desiredScrollTop;
        } catch (error) {
          scrollToPos(editor, from);
        }
      });
    } catch (error) {
      scrollToPos(editor, from);
    }
  });
}

function findTextNodeBoundary(root: Node, forward: boolean): Text | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  if (forward) {
    return walker.nextNode() as Text | null;
  }

  let last: Text | null = null;
  let current = walker.nextNode() as Text | null;
  while (current) {
    last = current;
    current = walker.nextNode() as Text | null;
  }
  return last;
}

function resolveDomTextPoint(
  view: Editor['view'],
  pos: number,
  preferForward: boolean
): { node: Text; offset: number } | null {
  const domPoint = view.domAtPos(pos, preferForward ? 1 : -1);
  if (domPoint.node instanceof Text) {
    return {
      node: domPoint.node,
      offset: Math.max(0, Math.min(domPoint.offset, domPoint.node.textContent?.length ?? 0)),
    };
  }

  const container = domPoint.node;
  const childNodes = Array.from(container.childNodes);
  const directChild =
    preferForward
      ? childNodes[Math.min(domPoint.offset, childNodes.length - 1)] ?? null
      : childNodes[Math.max(0, domPoint.offset - 1)] ?? null;

  const textNode =
    (directChild ? findTextNodeBoundary(directChild, preferForward) : null) ??
    findTextNodeBoundary(container, preferForward);
  if (!textNode) {
    return null;
  }

  return {
    node: textNode,
    offset: preferForward ? 0 : textNode.textContent?.length ?? 0,
  };
}

function syncBrowserSelectionToRange(editor: Editor, from: number, to: number) {
  const selection = window.getSelection();
  if (!selection) {
    return;
  }

  const start = resolveDomTextPoint(editor.view, from, true);
  const end = resolveDomTextPoint(editor.view, to, false);
  if (!start || !end) {
    return;
  }

  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  selection.removeAllRanges();
  selection.addRange(range);
}

function applyProposalSelection(editor: Editor, from: number, to: number) {
  editor.commands.setTextSelection({ from, to });
  editor.view.dispatch(
    editor.state.tr.setMeta(pinnedSelectionPluginKey, {
      from,
      to,
    })
  );
  requestAnimationFrame(() => {
    syncBrowserSelectionToRange(editor, from, to);
  });
}

function applyProposalSelectionByKind(
  editor: Editor,
  from: number,
  to: number,
  kind: 'text' | 'node' = 'text'
) {
  if (kind === 'node') {
    const node = editor.state.doc.nodeAt(from);
    if (node && from + node.nodeSize === to) {
      editor.view.dispatch(
        editor.state.tr
          .setSelection(NodeSelection.create(editor.state.doc, from))
          .setMeta(pinnedSelectionPluginKey, null)
      );
      syncForcedSelectedAlertClass(editor, from, to, node.type?.name === 'githubAlert');
      return;
    }
  }

  syncForcedSelectedAlertClass(editor, from, to, false);
  applyProposalSelection(editor, from, to);
}

function focusEditorPreservingScroll(editor: Editor) {
  try {
    editor.view.focus();
  } catch (error) {
    console.warn(`${BUILD_TAG} Failed to focus editor during proposal reveal:`, error);
  }
}

function handleSelectionRevealMessage(
  editor: Editor,
  message:
    | {
        type: 'scrollAndSelect' | 'selectProposalSelection';
        request_id?: string;
        original: string;
        context_before: string | null;
        context_after: string | null;
        headings_before?: string[] | null;
      }
    | {
        type: 'revealCurrentProposalSelection';
      }
) {
  if (message.type === 'revealCurrentProposalSelection') {
    const pinnedRange = pinnedSelectionPluginKey.getState(editor.state);
    const activeRange: { selFrom: number; selTo: number; selectionKind?: 'text' | 'node' } | null =
      pinnedRange && pinnedRange.from < pinnedRange.to
        ? { selFrom: pinnedRange.from, selTo: pinnedRange.to }
        : !editor.state.selection.empty
          ? { selFrom: editor.state.selection.from, selTo: editor.state.selection.to }
          : null;
    const target = lastProposalSelectionTarget ?? activeRange;
    if (SELECTION_DEBUG_LOGS) {
      console.log(`${BUILD_TAG} revealCurrentProposalSelection: target=`, target, 'pinned=', pinnedRange, 'active=', activeRange);
    }
    if (!target) return;
    if ((target.selectionKind ?? 'text') !== 'node') {
      applyProposalSelectionByKind(
        editor,
        target.selFrom,
        target.selTo,
        target.selectionKind ?? 'text'
      );
      if (SELECTION_DEBUG_LOGS) {
        console.log(`${BUILD_TAG} revealCurrentProposalSelection: post-apply selection=`, {
          from: editor.state.selection.from,
          to: editor.state.selection.to,
          empty: editor.state.selection.empty,
          type: editor.state.selection.constructor?.name ?? 'unknown',
          pinned: pinnedSelectionPluginKey.getState(editor.state),
        });
      }
    }
    revealProposalTarget(editor, target.selFrom, target.selTo);
    return;
  }

  try {
    const { original, context_before: ctxBefore, context_after: ctxAfter, request_id: requestId } = message;
    const headingsBefore = 'headings_before' in message ? (message.headings_before ?? null) : null;
    const selectionKey = getProposalSelectionKey(original, ctxBefore, ctxAfter);
    const normalizedBlocks = getNormalizedSelectionBlocks(original);
    const target = resolveProposalSelectionTarget(editor, original, ctxBefore, ctxAfter, headingsBefore);
    if (!target) {
      if (message.type === 'scrollAndSelect' && requestId) {
        vscode.postMessage({
          type: 'selectionRevealResult',
          id: requestId,
          status: 'error',
          error:
            'The file is open in Markdown for Humans, but the requested selection could not be found. The file contents may have changed, or the provided context may not match.',
          debug: {
            phase: 'resolveProposalSelectionTarget',
            original_length: original.length,
            normalized_blocks: normalizedBlocks,
          },
        });
      }
      return;
    }
    const { selFrom, selTo, resolutionMethod, occurrences, bestMarkdownIdx } = target;
    if (SELECTION_DEBUG_LOGS) {
      console.log(`${BUILD_TAG} proposalSelection resolved: method=${resolutionMethod} from=${selFrom} to=${selTo}`);
    }
    lastProposalSelectionTarget = {
      key: selectionKey,
      selFrom,
      selTo,
      selectionKind: resolutionMethod === 'githubAlert' ? 'node' : 'text',
    };

    const visibleSelectionRange = resolvePinnedTextRange(editor.state.doc, selFrom, selTo) ?? {
      from: selFrom,
      to: selTo,
    };

    if (navLastRecorded !== null) navRecordPosition(navLastRecorded, true);
    navIsJumping = true;
    navLastRecorded = visibleSelectionRange.from;
    if (resolutionMethod !== 'githubAlert') {
      applyProposalSelectionByKind(
        editor,
        visibleSelectionRange.from,
        visibleSelectionRange.to,
        'text'
      );
    }
    if (message.type === 'scrollAndSelect' || message.type === 'selectProposalSelection') {
      revealProposalTarget(editor, selFrom, selTo);
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            focusEditorPreservingScroll(editor);
            const isAlert = resolutionMethod === 'githubAlert';
            applyProposalSelectionByKind(
              editor,
              isAlert ? selFrom : visibleSelectionRange.from,
              isAlert ? selTo : visibleSelectionRange.to,
              isAlert ? 'node' : 'text'
            );
          });
        });
    }
    if (message.type === 'scrollAndSelect' && requestId) {
      vscode.postMessage({
        type: 'selectionRevealResult',
        id: requestId,
        status: 'revealed',
        debug: {
          phase: 'completed',
          resolution_method: resolutionMethod,
          occurrences: occurrences.length,
          best_markdown_index: bestMarkdownIdx,
          selection_from: visibleSelectionRange.from,
          selection_to: visibleSelectionRange.to,
          normalized_blocks: normalizedBlocks,
        },
      });
    }
    navIsJumping = false;
  } catch (error) {
    if (message.type === 'scrollAndSelect' && message.request_id) {
      vscode.postMessage({
        type: 'selectionRevealResult',
        id: message.request_id,
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
        debug: {
          phase: 'exception',
          original_length: message.original.length,
          normalized_blocks: getNormalizedSelectionBlocks(message.original),
        },
      });
    }
  }
}
const signalReady = () => {
  if (hasSentReadySignal) return;
  vscode.postMessage({ type: 'ready' });
  hasSentReadySignal = true;
};

/**
 * Track content we're about to send to prevent echo updates
 */
const trackSentContent = (content: string) => {
  lastSentContentHash = hashString(content);
  lastSentTimestamp = Date.now();
};

/** Apply gutter display settings (heading labels, line numbers) */
const applyGutterSettings = (colors: Record<string, unknown>) => {
  const editorEl = document.querySelector('.markdown-editor') as HTMLElement | null;
  if (!editorEl) return;
  const showHeading = colors.showHeadingGutter !== false; // default true
  const showLines = colors.showLineNumbers === true; // default false
  editorEl.classList.toggle('hide-heading-gutter', !showHeading);
  editorEl.classList.toggle('show-line-numbers', showLines);
  updateDisplaySettings(colors);
  if (typeof colors.outlinePanelWidth === 'number') {
    setTocPanelWidth(colors.outlinePanelWidth);
  }
};

const pushOutlineUpdate = () => {
  if (!editor) return;
  try {
    const outline = buildOutlineFromEditor(editor);
    vscode.postMessage({ type: 'outlineUpdated', outline });
  } catch (error) {
    console.warn(`${BUILD_TAG} Failed to build outline:`, error);
  }
};

const scheduleOutlineUpdate = () => {
  if (outlineUpdateTimeout) {
    clearTimeout(outlineUpdateTimeout);
  }
  outlineUpdateTimeout = window.setTimeout(() => {
    pushOutlineUpdate();
    // Refresh navigation pane if visible (keeps heading text in sync)
    if (editor && isTocVisible()) {
      refreshTocList(editor);
    }
    outlineUpdateTimeout = null;
  }, 250);
};

// Global function for resolving image paths (used by CustomImage extension)
const uriResolveCallbacks = new Map<string, (uri: string) => void>();
window.resolveImagePath = function (relativePath: string): Promise<string> {
  return new Promise(resolve => {
    const requestId = `resolve-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    uriResolveCallbacks.set(requestId, resolve);
    vscode.postMessage({
      type: 'resolveImageUri',
      requestId,
      relativePath,
    });
  });
};

type ImageReferenceMatch = { line: number; text: string };
type ImageReferencesPayload = {
  requestId: string;
  imagePath: string;
  currentFileCount: number;
  otherFiles: Array<{ fsPath: string; matches: ImageReferenceMatch[] }>;
  error?: string;
};

const imageReferencesCallbacks = new Map<string, (payload: ImageReferencesPayload) => void>();
window.getImageReferences = function (imagePath: string): Promise<unknown> {
  return new Promise(resolve => {
    const requestId = `refs-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    imageReferencesCallbacks.set(requestId, resolve as (payload: ImageReferencesPayload) => void);
    vscode.postMessage({
      type: 'getImageReferences',
      requestId,
      imagePath,
    });
  });
};

type ImageRenameCheckPayload = {
  requestId: string;
  exists: boolean;
  newFilename: string;
  newPath: string;
  error?: string;
};

const imageRenameCheckCallbacks = new Map<string, (payload: ImageRenameCheckPayload) => void>();
window.checkImageRename = function (oldPath: string, newName: string): Promise<unknown> {
  return new Promise(resolve => {
    const requestId = `renamecheck-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    imageRenameCheckCallbacks.set(requestId, resolve as (payload: ImageRenameCheckPayload) => void);
    vscode.postMessage({
      type: 'checkImageRename',
      requestId,
      oldPath,
      newName,
    });
  });
};

// Global function for setting up image resize (used by CustomImage extension)
window.setupImageResize = function (
  img: HTMLImageElement,
  editorInstance?: Editor,
  vscodeApi?: VsCodeApi
): void {
  const editorToUse = editorInstance || editor;
  if (!editorToUse) {
    console.warn(`${BUILD_TAG} setupImageResize called before editor is ready`);
    return;
  }

  const apiToUse = vscodeApi || vscode;
  void showImageResizeModal(img, editorToUse, apiToUse).catch(error => {
    console.error(`${BUILD_TAG} Failed to open image resize modal:`, error);
    apiToUse.postMessage({
      type: 'showError',
      message: 'Failed to open the image resize dialog. Please reload the editor and try again.',
    });
  });
};

/**
 * Immediately send update (used for save shortcuts)
 */
function immediateUpdate() {
  if (!editor) return;

  try {
    // Clear any pending debounced update
    if (updateTimeout) {
      clearTimeout(updateTimeout);
      updateTimeout = null;
    }

    const markdown = getEditorMarkdownForSync(editor);
    trackSentContent(markdown);

    console.log(`${BUILD_TAG} Immediate save triggered`);

    // Send edit first
    vscode.postMessage({
      type: 'edit',
      content: markdown,
    });

    // Then tell VS Code to save the file
    setTimeout(() => {
      vscode.postMessage({
        type: 'save',
      });
    }, 50); // Small delay to ensure edit is processed first
  } catch (error) {
    console.error(`${BUILD_TAG} Error in immediate save:`, error);
  }
}

/**
 * Debounced update with error handling
 * Prevents sync while images are being saved to avoid race conditions
 */
function debouncedUpdate(markdown: string) {
  if (updateTimeout) {
    clearTimeout(updateTimeout);
  }

  updateTimeout = window.setTimeout(() => {
    try {
      // Check if any images are currently being saved
      if (hasPendingImageSaves()) {
        const count = getPendingImageCount();
        console.log(`${BUILD_TAG} Delaying document sync - ${count} image(s) still being saved`);
        // Reschedule the update to check again
        debouncedUpdate(markdown);
        return;
      }

      // Track content hash to detect and ignore echo updates
      trackSentContent(markdown);

      vscode.postMessage({
        type: 'edit',
        content: markdown,
      });
    } catch (error) {
      console.error(`${BUILD_TAG} Error sending update:`, error);
    }
  }, 500);
}

// TODO: Re-implement code block language badges feature
// This feature was causing TipTap to not render due to DOM manipulation conflicts
// Need to find a way to add language badges without interfering with TipTap's rendering

/*
// Supported languages for code blocks
const CODE_BLOCK_LANGUAGES = [
  { value: 'plaintext', label: 'Plain Text' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'python', label: 'Python' },
  { value: 'bash', label: 'Bash' },
  { value: 'json', label: 'JSON' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'css', label: 'CSS' },
  { value: 'html', label: 'HTML' },
  { value: 'sql', label: 'SQL' },
  { value: 'java', label: 'Java' },
  { value: 'go', label: 'Go' },
  { value: 'rust', label: 'Rust' },
];

function setupCodeBlockLanguageBadges(editorInstance: Editor) {
  // Implementation commented out - was interfering with TipTap rendering
}
*/

/**
 * Initialize TipTap editor with error handling
 */
function initializeEditor(initialContent: string) {
  try {
    if (editor) {
      console.warn(`${BUILD_TAG} Editor already initialized, skipping re-init`);
      return;
    }

    const editorElement = document.querySelector('#editor') as HTMLElement;
    if (!editorElement) {
      console.error(`${BUILD_TAG} Editor element not found`);
      return;
    }

    console.log(`${BUILD_TAG} Initializing editor...`);
    const editorInstance = new Editor({
      element: editorElement,
      extensions: [
        // Mermaid must be before CodeBlockLowlight to intercept mermaid code blocks
        Mermaid,
        // Must be before CodeBlockLowlight to intercept indented "code" tokens containing images
        IndentedImageCodeBlock,
        // Fallback: treat standalone image lines with spaces in the path as images.
        SpaceFriendlyImagePaths,
        // GitHubAlerts must be before StarterKit to intercept alert blockquotes
        GitHubAlerts,
        StarterKit.configure({
          heading: {
            levels: [1, 2, 3, 4, 5, 6],
          },
          paragraph: false, // Disable default paragraph, using MarkdownParagraph instead
          codeBlock: false, // Disable default CodeBlock, using CodeBlockLowlight instead
          // ListKit is registered separately to support task lists; disable StarterKit's list
          // extensions to avoid duplicate names (which can break markdown parsing, e.g. `1)` lists).
          bulletList: false,
          orderedList: false,
          listItem: false,
          listKeymap: false,
          // Disable StarterKit's Link - we configure our own with shouldAutoLink validation
          link: false,
          // In Tiptap v3, 'history' was renamed to 'undoRedo'
          undoRedo: {
            depth: 100,
          },
        }),
        MarkdownParagraph, // Custom paragraph with empty-paragraph filtering in renderMarkdown
        CodeBlockLowlight.configure({
          lowlight,
          HTMLAttributes: {
            class: 'code-block-highlighted',
          },
          defaultLanguage: 'plaintext',
          enableTabIndentation: true, // Enable Tab key for indentation
          tabSize: 2, // 2 spaces per tab (cleaner for markdown code blocks)
        }),
        Markdown.configure({
          markedOptions: {
            gfm: true, // GitHub Flavored Markdown for tables, task lists
            breaks: true, // Preserve single newlines as <br>
          },
        }),
        TableKit.configure({
          table: {
            resizable: true,
            HTMLAttributes: {
              class: 'markdown-table',
            },
          },
        }),
        ListKit.configure({
          orderedList: false,
          taskItem: {
            nested: true,
          },
        }),
        OrderedListMarkdownFix,
        TabIndentation, // Enable Tab/Shift+Tab for list indentation
        ImageEnterSpacing, // Handle Enter key around images and gap cursor
        Link.configure({
          openOnClick: false,
          HTMLAttributes: {
            class: 'markdown-link',
          },
          shouldAutoLink,
        }),
        CustomImage.configure({
          allowBase64: true, // Allow base64 for preview
          HTMLAttributes: {
            class: 'markdown-image',
          },
        }),
        PinnedSelectionExtension,
        LineNumbers,
      ],
      // Don't pass content here - we'll set it after init with contentType: 'markdown'
      editorProps: {
        attributes: {
          class: 'markdown-editor',
          spellcheck: 'true',
        },
        // Prevent default image drop handling - let our custom handler manage it
        handleDrop: (_view, event, _slice, _moved) => {
          const dt = event.dataTransfer;
          if (!dt) return false;

          // Case 1: Actual image files (from desktop/finder)
          if (dt.files && dt.files.length > 0) {
            const hasImages = Array.from(dt.files).some(f => f.type.startsWith('image/'));
            if (hasImages) {
              return true; // Prevent default, our DOM handler will manage it
            }
          }

          // Case 2: VS Code file explorer drops (passes URI as text)
          // Check for text/uri-list or text/plain containing image paths
          const uriList = dt.getData('text/uri-list') || dt.getData('text/plain') || '';
          if (uriList) {
            const isImagePath = /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i.test(uriList);
            if (isImagePath) {
              // This is a file path drop from VS Code - prevent TipTap's default
              // Our DOM handler will process it
              return true;
            }
          }

          return false; // Allow default for non-image drops
        },
      },
      onUpdate: ({ editor }) => {
        if (isUpdating) return;

        try {
          // Track when user last edited
          lastUserEditTime = Date.now();

          const markdown = getEditorMarkdownForSync(editor);
          debouncedUpdate(markdown);
          scheduleOutlineUpdate();
        } catch (error) {
          console.error(`${BUILD_TAG} Error in onUpdate:`, error);
        }
      },
      onSelectionUpdate: ({ editor }) => {
        try {
          const { from, empty } = editor.state.selection;
          vscode.postMessage({ type: 'selectionChange', pos: from });

          // Record navigation history: always debounce; record when cursor stops for 1s
          navRecordPosition(from);
          let selected = empty ? null : getSelectionAsMarkdown(editor);
          const fullMarkdown = getEditorMarkdownForSync(editor);
          let context_before: string | null = null;
          let context_after: string | null = null;
          if (selected) {
            const selectionContext = getPlainTextSelectionContext(editor);
            const resolvedMatch = resolveSelectionMatch(fullMarkdown, selected, selectionContext);
            if (resolvedMatch) {
              selected = resolvedMatch.selected;
              const idx = resolvedMatch.index;
              context_before = fullMarkdown.slice(Math.max(0, idx - 500), idx);
              context_after = fullMarkdown.slice(idx + selected.length, idx + selected.length + 500);
            }
          }
          if (selected && context_before === null && context_after === null) {
            const idx = fullMarkdown.indexOf(selected);
            if (idx !== -1) {
              context_before = fullMarkdown.slice(Math.max(0, idx - 500), idx);
              context_after = fullMarkdown.slice(idx + selected.length, idx + selected.length + 500);
            }
          }
          const headings_before = getHeadingsBeforeSelection(editor);
          vscode.postMessage({ type: 'selectionPush', selected, context_before, context_after, headings_before });

          // Update active heading highlight in navigation pane
          if (isTocVisible()) {
            updateActiveHeading(from, editor);
          }

          // Sync cursor position to source view (if open)
          // Only sync when MFH has focus (user is interacting with it, not passive update)
          if (isSourceViewOpen && !isSyncFromSource && document.hasFocus()) {
            postSourceSync(editor, { reason: 'mfhSelectionUpdate' });
          }
        } catch (error) {
          console.warn(`${BUILD_TAG} Selection update failed:`, error);
        }
      },
      onCreate: () => {
        console.log(`${BUILD_TAG} Editor created successfully`);
      },
      onDestroy: () => {
        console.log(`${BUILD_TAG} Editor destroyed`);
      },
    });

    editor = editorInstance;

    // Set initial content as markdown (Tiptap v3 requires explicit contentType)
    if (initialContent) {
      // Prevent onUpdate from firing during initialization - this was causing
      // documents with frontmatter to be marked dirty even without user edits
      isUpdating = true;
      // Suppress nav recording during setContent (cursor lands at end of doc)
      navIsJumping = true;
      editor.commands.setContent(initialContent, { contentType: 'markdown' });
      // Move cursor to start of document and seed nav history from there
      editor.commands.focus('start');
      navIsJumping = false;
      navLastRecorded = 1;
      isUpdating = false;
    }

    // Create and insert formatting toolbar at top
    formattingToolbar = createFormattingToolbar(editorInstance);
    const editorContainer = document.querySelector('#editor') as HTMLElement;
    if (editorContainer && editorContainer.parentElement) {
      editorContainer.parentElement.insertBefore(formattingToolbar, editorContainer);
    }

    // Create gutter click shield — absorbs clicks on empty gutter space
    // so they don't reach ProseMirror and cause focus loss
    const gutterShield = document.createElement('div');
    gutterShield.className = 'gutter-shield';
    editorElement.insertBefore(gutterShield, editorElement.firstChild);
    // Prevent the browser from blurring the editor when clicking on the shield.
    // Without this, clicking any non-focusable element automatically blurs the editor.
    gutterShield.addEventListener('mousedown', (e) => { e.preventDefault(); });

    // Reposition gutter decorations when editor width changes
    installGutterResizeObserver();

    const editorRoot = document.querySelector('#editor') as HTMLElement | null;
    const scrollContainer = getScrollContainer();
    let lastStableResizeAnchor: ResizeSelectionAnchor | null = null;
    let resizeSessionActive = false;
    let resizeSessionTimeoutId: number | null = null;
    let scrollCaptureFrameId: number | null = null;
    let suppressAnchorCapture = false;
    let lastObservedEditorWidth = editorRoot?.offsetWidth ?? 0;

    const readCurrentResizeAnchor = (): ResizeSelectionAnchor | null => {
      try {
        const pos = editorInstance.state.selection.head;
        const coords = editorInstance.view.coordsAtPos(pos);
        return {
          pos,
          top: coords.top,
          left: coords.left,
          scrollTop: scrollContainer.scrollTop,
          editorWidth: editorRoot?.offsetWidth ?? null,
        };
      } catch {
        return null;
      }
    };

    const captureStableResizeAnchor = () => {
      if (suppressAnchorCapture || resizeSessionActive) {
        return;
      }
      const anchor = readCurrentResizeAnchor();
      if (anchor) {
        lastStableResizeAnchor = anchor;
      }
    };

    const releaseAnchorCaptureSuppression = () => {
      requestAnimationFrame(() => {
        suppressAnchorCapture = false;
      });
    };

    const applyResizePreservation = () => {
      if (!resizeSessionActive || !lastStableResizeAnchor) {
        return;
      }

      const currentAnchor = readCurrentResizeAnchor();
      if (!currentAnchor) {
        return;
      }

      const delta = currentAnchor.top - lastStableResizeAnchor.top;
      if (Math.abs(delta) <= 1) {
        return;
      }

      suppressAnchorCapture = true;
      scrollContainer.scrollTop += delta;
      releaseAnchorCaptureSuppression();
    };

    const scheduleResizePreservation = () => {
      applyResizePreservation();
      requestAnimationFrame(() => {
        applyResizePreservation();
      });
      window.setTimeout(() => {
        applyResizePreservation();
      }, 80);
    };

    const beginOrExtendResizeSession = () => {
      if (!resizeSessionActive) {
        resizeSessionActive = true;
      }

      scheduleResizePreservation();

      if (resizeSessionTimeoutId !== null) {
        window.clearTimeout(resizeSessionTimeoutId);
      }
      resizeSessionTimeoutId = window.setTimeout(() => {
        applyResizePreservation();
        resizeSessionActive = false;
        resizeSessionTimeoutId = null;
        captureStableResizeAnchor();
        if (isSourceViewOpen) {
          postSourceResizeSession(editorInstance, 'settled');
        }
      }, 180);
    };

    const handleWindowScroll = () => {
      if (resizeSessionActive || suppressAnchorCapture) {
        return;
      }
      if (scrollCaptureFrameId !== null) {
        return;
      }
      scrollCaptureFrameId = window.requestAnimationFrame(() => {
        scrollCaptureFrameId = null;
        captureStableResizeAnchor();
      });
    };
    window.addEventListener('scroll', handleWindowScroll, { passive: true });

    const resizePreservationObserver =
      typeof ResizeObserver === 'undefined' || !editorRoot
        ? null
        : new ResizeObserver(() => {
          const newWidth = editorRoot.offsetWidth;
          if (newWidth === lastObservedEditorWidth) {
            return;
          }

          lastObservedEditorWidth = newWidth;
          beginOrExtendResizeSession();
        });
    resizePreservationObserver?.observe(editorRoot ?? editorElement);

    editorInstance.on('selectionUpdate', () => {
      captureStableResizeAnchor();
    });
    captureStableResizeAnchor();

    // Track editor focus state for toolbar and keep toolbar enabled while interacting with it
    const editorDom = editorInstance.view.dom;
    editorDom.addEventListener('focus', () => {
      window.dispatchEvent(new CustomEvent('editorFocusChange', { detail: { focused: true } }));
    });
    editorDom.addEventListener('blur', (event: FocusEvent) => {
      const relatedTarget = event.relatedTarget as HTMLElement | null;
      const stayingInToolbar = Boolean(relatedTarget && formattingToolbar?.contains(relatedTarget));

      if (stayingInToolbar) {
        return;
      }

      // relatedTarget can be null; wait a tick to see where focus actually lands
      setTimeout(() => {
        const activeElement = document.activeElement as HTMLElement | null;
        if (activeElement && formattingToolbar?.contains(activeElement)) {
          return;
        }
        window.dispatchEvent(new CustomEvent('editorFocusChange', { detail: { focused: false } }));
      }, 0);
    });

    // When the webview panel gains focus (user clicks on MFH side),
    // auto-focus the editor so they can start typing immediately
    window.addEventListener('focus', () => {
      if (editorInstance && !editorInstance.isFocused) {
        setTimeout(() => {
          const active = document.activeElement;
          const isInNavPane = active?.closest('#toc-panel-wrapper');
          const isInToolbar = active?.closest('.formatting-toolbar');
          if (!isInNavPane && !isInToolbar) {
            editorInstance.commands.focus();
          }
        }, 50);
      }
    });

    const clearPinnedSelection = () => {
      editorInstance.view.dispatch(
        editorInstance.state.tr.setMeta(pinnedSelectionPluginKey, null)
      );
      clearProposalTargetHighlight();
    };
    editorDom.addEventListener('mousedown', clearPinnedSelection, true);
    editorDom.addEventListener('keydown', clearPinnedSelection, true);

    // Create table menu
    tableMenu = createTableMenu(editorInstance);

    // Setup image drag & drop handling
    setupImageDragDrop(editorInstance, vscode);

    // Initial outline push
    pushOutlineUpdate();
    try {
      const { from } = editorInstance.state.selection;
      vscode.postMessage({ type: 'selectionChange', pos: from });
    } catch (error) {
      console.warn(`${BUILD_TAG} Initial selection sync failed:`, error);
    }

    if (pendingSelectionRevealMessage) {
      const pendingMessage = pendingSelectionRevealMessage;
      pendingSelectionRevealMessage = null;
      requestAnimationFrame(() => {
        handleSelectionRevealMessage(
          editorInstance,
          pendingMessage as
            | {
                type: 'scrollAndSelect' | 'selectProposalSelection';
                original: string;
                context_before: string | null;
                context_after: string | null;
              }
            | {
                type: 'revealCurrentProposalSelection';
              }
        );
      });
    }

    // Setup code block language badges
    // TODO: Re-implement this feature without interfering with TipTap's DOM
    // setupCodeBlockLanguageBadges(editor);

    // Store handler references for cleanup on editor destroy
    const contextMenuHandler = (e: MouseEvent) => {
      try {
        const target = e.target as HTMLElement;
        const tableCell = target.closest('td, th');

        if (tableCell && editorInstance.isActive('table')) {
          e.preventDefault();
          tableMenu.style.display = 'block';
          tableMenu.style.position = 'fixed';
          tableMenu.style.left = `${e.clientX}px`;
          tableMenu.style.top = `${e.clientY}px`;
        } else {
          tableMenu.style.display = 'none';
        }
      } catch (error) {
        console.error(`${BUILD_TAG} Error in context menu:`, error);
      }
    };

    const documentClickHandler = () => {
      tableMenu.style.display = 'none';
    };

    // Handle keyboard shortcuts
    const keydownHandler = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey; // Cmd on Mac, Ctrl on Windows/Linux

      // Save shortcut - immediate save
      if (isMod && e.key === 's') {
        console.log(`${BUILD_TAG} *** SAVE SHORTCUT TRIGGERED ***`);
        e.preventDefault();
        e.stopPropagation();
        immediateUpdate();

        // Visual feedback - flash the document briefly
        document.body.style.opacity = '0.7';
        setTimeout(() => {
          document.body.style.opacity = '1';
        }, 100);

        return;
      }

      // Prevent VS Code from handling markdown formatting shortcuts
      // TipTap will handle these natively
      const formattingShortcuts = [
        'b', // Bold
        'i', // Italic
        'u', // Underline (some editors)
      ];

      if (isMod && formattingShortcuts.includes(e.key.toLowerCase())) {
        e.stopPropagation(); // Stop event from reaching VS Code
        console.log(`${BUILD_TAG} Intercepted Cmd+${e.key.toUpperCase()} for editor`);
        // TipTap will handle the formatting
        return;
      }

      // Intercept Cmd+K for link in markdown context
      if (isMod && e.key === 'k') {
        e.preventDefault();
        e.stopPropagation();
        console.log(`${BUILD_TAG} Link shortcut`);
        if (editor) {
          showLinkDialog(editor);
        }
        return;
      }

      // Intercept Cmd/Ctrl+F for in-document search
      if (isMod && e.key === 'f') {
        e.preventDefault();
        e.stopPropagation();
        if (editor) toggleSearchOverlay(editor);
        return;
      }

      // Intercept Cmd/Ctrl+H for find+replace toggle
      if (isMod && !e.shiftKey && e.key === 'h') {
        e.preventDefault();
        e.stopPropagation();
        if (editor) toggleReplaceOverlay(editor);
        return;
      }

      // Ctrl+Shift+H — replace all
      if (isMod && e.shiftKey && e.key === 'H' && isSearchVisible()) {
        e.preventDefault();
        e.stopPropagation();
        if (editor) replaceAll(editor);
        return;
      }

      // Ctrl+Enter / Ctrl+Shift+Enter — next/previous match when search is open
      if (isMod && e.key === 'Enter' && isSearchVisible()) {
        e.preventDefault();
        e.stopPropagation();
        if (editor) {
          if (e.shiftKey) searchPrev(editor);
          else searchNext(editor);
        }
        return;
      }
    };

    // Register handlers
    document.addEventListener('contextmenu', contextMenuHandler);
    document.addEventListener('click', documentClickHandler);
    // Use capture phase so our handler fires before ProseMirror processes keydown events
    document.addEventListener('keydown', keydownHandler, { capture: true });

    // Add link click handler for navigation
    const handleLinkClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const link = target.closest('.markdown-link') as HTMLAnchorElement;
      if (!link) return;

      const href = link.getAttribute('href');
      console.log('[MD4H Webview] Link clicked:', href);

      if (!href) {
        console.warn('[MD4H Webview] Link has no href attribute');
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      // External URLs
      if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('mailto:')) {
        console.log('[MD4H Webview] Sending openExternalLink message');
        const vscode = (window as any).vscode;
        if (vscode && typeof vscode.postMessage === 'function') {
          vscode.postMessage({
            type: 'openExternalLink',
            url: href,
          });
        } else {
          console.warn('[MD4H Webview] vscode.postMessage not available');
        }
        return;
      }

      // Anchor links (heading links)
      if (href.startsWith('#')) {
        console.log('[MD4H Webview] Handling anchor link:', href);
        const slug = href.slice(1);
        if (editorInstance) {
          // Find heading by slug
          const outline = buildOutlineFromEditor(editorInstance);
          const existingSlugs = new Set<string>();
          const headingMap = new Map<string, number>();

          outline.forEach(entry => {
            const headingSlug = generateHeadingSlug(entry.text, existingSlugs);
            headingMap.set(headingSlug, entry.pos);
          });

          const headingPos = headingMap.get(slug);
          if (headingPos !== undefined) {
            console.log('[MD4H Webview] Scrolling to heading at position:', headingPos);
            scrollToHeading(editorInstance, headingPos);
          } else {
            console.warn('[MD4H Webview] Heading not found for slug:', slug);
          }
        }
        return;
      }

      // Detect image files - handle separately
      if (/\.(png|jpe?g|gif|svg|webp|bmp|ico|tiff?)$/i.test(href)) {
        e.preventDefault();
        e.stopPropagation();

        console.log('[MD4H Webview] Image link clicked, sending openImage message');
        const vscode = (window as any).vscode;
        if (vscode && typeof vscode.postMessage === 'function') {
          vscode.postMessage({
            type: 'openImage',
            path: href,
          });
        } else {
          console.warn('[MD4H Webview] vscode.postMessage not available');
        }
        return;
      }

      // Local file links (non-image)
      console.log('[MD4H Webview] Sending openFileLink message');
      const vscode = (window as any).vscode;
      if (vscode && typeof vscode.postMessage === 'function') {
        vscode.postMessage({
          type: 'openFileLink',
          path: href,
        });
      } else {
        console.warn('[MD4H Webview] vscode.postMessage not available');
      }
    };

    // Add click handler to editor DOM
    editorInstance.view.dom.addEventListener('click', handleLinkClick);

    // Also handle links added dynamically by listening to editor updates
    const updateLinkHandlers = () => {
      const links = editorInstance.view.dom.querySelectorAll('.markdown-link');
      links.forEach(link => {
        if (!(link as any)._linkHandlerAdded) {
          (link as any)._linkHandlerAdded = true;
          // Handler is on parent, so this is just for marking
        }
      });
    };

    editorInstance.on('update', updateLinkHandlers);
    updateLinkHandlers(); // Initial call

    // Clean up listeners when editor is destroyed to prevent memory leaks
    editorInstance.on('destroy', () => {
      document.removeEventListener('contextmenu', contextMenuHandler);
      document.removeEventListener('click', documentClickHandler);
      document.removeEventListener('keydown', keydownHandler, { capture: true });
      editorInstance.view.dom.removeEventListener('click', handleLinkClick);
      window.removeEventListener('scroll', handleWindowScroll);
      resizePreservationObserver?.disconnect();
      if (resizeSessionTimeoutId !== null) {
        window.clearTimeout(resizeSessionTimeoutId);
      }
      if (scrollCaptureFrameId !== null) {
        window.cancelAnimationFrame(scrollCaptureFrameId);
      }
      console.log(`${BUILD_TAG} Editor destroyed, global listeners cleaned up`);
    });

    console.log(`${BUILD_TAG} Editor initialization complete`);
  } catch (error) {
    console.error(`${BUILD_TAG} Fatal error initializing editor:`, error);
    const editorElement = document.querySelector('#editor') as HTMLElement;
    if (editorElement) {
      editorElement.innerHTML = `
        <div style="color: red; padding: 20px; font-family: monospace;">
          <h3>Error Loading Editor</h3>
          <p>${error instanceof Error ? error.message : 'Unknown error'}</p>
          <p>Please check the Debug Console for details.</p>
        </div>
      `;
    }
  }
}

/**
 * Count the length of the common suffix between two strings.
 * Used to score context matches when locating a selection in the document.
 */
function commonSuffixLength(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[a.length - 1 - i] === b[b.length - 1 - i]) i++;
  return i;
}

/**
 * Count the length of the common prefix between two strings.
 */
function commonPrefixLength(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

/**
 * Convert markdown character indices (startChar, endChar) to ProseMirror positions.
 * Walks the document text nodes accumulating character counts.
 * Returns { from, to } as ProseMirror positions, or { from: 1, to: 1 } if not found.
 */
function markdownIndexToPos(
  editor: Editor,
  startChar: number,
  endChar: number
): { from: number; to: number } {
  // Rebuild the markdown text from the document, tracking cumulative char offset
  // and the corresponding ProseMirror position for each character.
  let charCount = 0;
  let fromPos: number | null = null;
  let toPos: number | null = null;

  editor.state.doc.descendants((node, pos) => {
    if (fromPos !== null && toPos !== null) return false;

    if (node.isText && node.text) {
      const textLen = node.text.length;
      // Check if startChar falls within this text node
      if (fromPos === null && charCount + textLen > startChar) {
        fromPos = pos + (startChar - charCount);
      }
      // Check if endChar falls within or at end of this text node
      if (fromPos !== null && toPos === null && charCount + textLen >= endChar) {
        toPos = pos + (endChar - charCount);
      }
      charCount += textLen;
    }
    return true;
  });

  if (fromPos === null) return { from: 1, to: 1 };
  return { from: fromPos, to: toPos ?? fromPos };
}

/**
 * Get the last N headings before the current selection, closest first.
 */
function getHeadingsBeforeSelection(editor: Editor, count = 5): string[] {
  const { from } = editor.state.selection;
  const headings: string[] = [];

  editor.state.doc.nodesBetween(0, from, node => {
    if (node.type.name === 'heading') {
      const prefix = '#'.repeat(node.attrs.level as number);
      headings.push(`${prefix} ${node.textContent}`);
    }
    return true;
  });

  return headings.slice(-count).reverse();
}

function getPlainTextSelectionContext(
  editor: Editor,
  maxChars = 200
): { contextBefore: string; contextAfter: string } {
  const { from, to } = editor.state.selection;
  return {
    contextBefore: editor.state.doc.textBetween(Math.max(0, from - maxChars), from, '\n', '\n'),
    contextAfter: editor.state.doc.textBetween(to, to + maxChars, '\n', '\n'),
  };
}

/**
 * Handle messages from extension
 */
window.addEventListener('message', (event: MessageEvent) => {
  try {
    const message = event.data;

    switch (message.type) {
      case 'update':
        // Store skipResizeWarning setting if present
        if (typeof message.skipResizeWarning === 'boolean') {
          (window as any).skipResizeWarning = message.skipResizeWarning;
        }
        // Store imagePath setting if present
        if (typeof message.imagePath === 'string') {
          (window as any).imagePath = message.imagePath;
        }
        if (typeof message.imagePathBase === 'string') {
          (window as any).imagePathBase = message.imagePathBase;
        }
        // Apply color settings if present
        if (message.colors && typeof message.colors === 'object') {
          (window as any).md4hColors = message.colors;
          applyColors({ ...DEFAULT_COLORS, ...(message.colors as object) });
          applyGutterSettings(message.colors as Record<string, unknown>);
        }
        // Set document filename for line-copy feature
        if (typeof message.fileName === 'string') {
          setDocumentFilename(message.fileName);
        }
        // Initialize editor with first payload to seed undo history correctly
        if (!editor) {
          if (isDomReady) {
            initializeEditor(message.content);
          } else {
            pendingInitialContent = message.content;
          }
        } else {
          updateEditorContent(message.content);
        }

        // Auto-open navigation pane (once per webview lifecycle)
        if (!hasAutoOpenedNav) {
          const colors = message.colors as Record<string, unknown> | undefined;
          if (colors?.showNavigationPane) {
            const mdContent = (message.content as string) || '';
            const hasHeadings = /^#{1,6} /m.test(mdContent);
            if (hasHeadings) {
              hasAutoOpenedNav = true;
              // Defer until editor is initialized
              const checkEditor = setInterval(() => {
                if (editor) {
                  clearInterval(checkEditor);
                  if (!isTocVisible()) {
                    showTocOverlay(editor);
                    updateToolbarStates();
                  }
                }
              }, 100);
              setTimeout(() => clearInterval(checkEditor), 5000);
            }
          }
        }
        break;
      case 'getOutline': {
        pushOutlineUpdate();
        if (editor) {
          const { from } = editor.state.selection;
          vscode.postMessage({ type: 'selectionChange', pos: from });
        }
        break;
      }
      case 'getSelection': {
        if (editor) {
          const { empty } = editor.state.selection;
          let selected = empty ? null : getSelectionAsMarkdown(editor);
          const fullMarkdown = getEditorMarkdownForSync(editor);
          let context_before: string | null = null;
          let context_after: string | null = null;
          if (selected && !empty) {
            const selectionContext = getPlainTextSelectionContext(editor);
            const resolvedMatch = resolveSelectionMatch(fullMarkdown, selected, selectionContext);
            if (resolvedMatch) {
              selected = resolvedMatch.selected;
              const idx = resolvedMatch.index;
              context_before = fullMarkdown.slice(Math.max(0, idx - 500), idx);
              context_after = fullMarkdown.slice(idx + selected.length, idx + selected.length + 500);
            }
          }
          if (selected && !empty && context_before === null && context_after === null) {
            const idx = fullMarkdown.indexOf(selected);
            if (idx !== -1) {
              context_before = fullMarkdown.slice(Math.max(0, idx - 500), idx);
              context_after = fullMarkdown.slice(idx + selected.length, idx + selected.length + 500);
            }
          }
          const headings_before = getHeadingsBeforeSelection(editor);
          vscode.postMessage({ type: 'selectionResult', selected, context_before, context_after, headings_before });
        } else {
          vscode.postMessage({ type: 'selectionResult', selected: null, context_before: null, context_after: null, headings_before: [] });
        }
        break;
      }
      case 'syncFromSourceLine': {
        // Source editor cursor moved — scroll MFH to match without stealing focus
        if (!editor) break;
        const syncLine = message.line as number;
        if (typeof syncLine !== 'number' || syncLine < 1) break;
        const syncPos = markdownLineToPos(editor, syncLine);
        if (syncPos > 0) {
          isSyncFromSource = true;
          scrollToPos(editor, syncPos, true); // scroll without focus
          setTimeout(() => { isSyncFromSource = false; }, 300);
        }
        break;
      }
      case 'requestCurrentLine': {
        // Extension host requests the current cursor line and viewport anchor.
        if (!editor) break;
        postSourceSync(editor, { force: true, reason: 'requestCurrentLine' });
        break;
      }
      case 'sourceViewClosed':
        // Extension host notifies that source editor was closed externally
        isSourceViewOpen = false;
        updateToolbarStates();
        break;
      case 'settingsUpdate':
        // Update skipResizeWarning setting
        if (typeof message.skipResizeWarning === 'boolean') {
          (window as any).skipResizeWarning = message.skipResizeWarning;
        }
        // Update imagePath setting
        if (typeof message.imagePath === 'string') {
          (window as any).imagePath = message.imagePath;
        }
        if (typeof message.imagePathBase === 'string') {
          (window as any).imagePathBase = message.imagePathBase;
        }
        // Apply color settings if present
        if (message.colors && typeof message.colors === 'object') {
          (window as any).md4hColors = message.colors;
          applyColors({ ...DEFAULT_COLORS, ...(message.colors as object) });
          applyGutterSettings(message.colors as Record<string, unknown>);
          updateColorSettingsPanel(message.colors as object);
        }
        break;
      case 'imageResized': {
        // Handle image resize completion
        if (message.success && message.imagePath && message.backupPath) {
          const timestamp = (message.timestamp as number) || Date.now();
          const newImagePath = message.newImagePath as string | undefined;
          const newWidth = message.newWidth as number | undefined;
          const newHeight = message.newHeight as number | undefined;

          // Cache-bust image reloads (especially important when the NodeView is recreated).
          const cacheBustMap =
            ((window as any)._imageCacheBust as Map<string, number> | undefined) ??
            new Map<string, number>();
          (window as any)._imageCacheBust = cacheBustMap;
          if (typeof message.imagePath === 'string') {
            cacheBustMap.set(message.imagePath, timestamp);
          }
          if (typeof newImagePath === 'string') {
            cacheBustMap.set(newImagePath, timestamp);
          }

          // Find the image element by path
          const images = document.querySelectorAll('.markdown-image');
          for (const img of images) {
            const imgElement = img as HTMLImageElement;
            const imgPath =
              imgElement.getAttribute('data-markdown-src') || imgElement.getAttribute('src') || '';
            if (imgPath === message.imagePath || imgPath.endsWith(message.imagePath)) {
              // Get old metadata before clearing cache
              const oldMetadata = getCachedImageMetadata(imgPath);

              // Clear metadata cache for both old and new paths
              clearImageMetadataCache(imgPath);
              if (newImagePath && newImagePath !== imgPath) {
                clearImageMetadataCache(newImagePath);
              }

              // Immediately update metadata cache with new dimensions if provided
              // This ensures correct dimensions are shown even before image fully loads
              if (newWidth !== undefined && newHeight !== undefined) {
                const metadataPath =
                  newImagePath && newImagePath !== imgPath ? newImagePath : imgPath;
                updateImageMetadataDimensions(
                  metadataPath,
                  { width: newWidth, height: newHeight },
                  oldMetadata
                );
              }

              handleImageResized(message.backupPath, imgElement);

              // Update TipTap node attributes if new path is provided (includes dimensions)
              if (newImagePath && editor) {
                // Find the wrapper and get position from it (imgElement is inside wrapper)
                const wrapper = imgElement.closest('.image-wrapper');
                if (wrapper) {
                  // Get position from wrapper (the actual ProseMirror node)
                  const pos = editor.view.posAtDOM(wrapper, 0);
                  if (pos !== undefined && pos !== null) {
                    // Get the node at this position
                    const node = editor.state.doc.nodeAt(pos);
                    if (node && node.type.name === 'image') {
                      // Update image node attributes with new path (includes dimensions)
                      // This will trigger onUpdate automatically, which syncs markdown
                      editor
                        .chain()
                        .setNodeSelection(pos)
                        .updateAttributes('image', {
                          src: newImagePath,
                          'markdown-src': newImagePath,
                        })
                        .run();
                    }
                  }
                }
              }

              // Update DOM attributes
              if (newImagePath) {
                imgElement.setAttribute('data-markdown-src', newImagePath);
              }

              // Force image reload with cache-busting to show resized version
              // The image file has been overwritten, but browser may have cached the old version
              const currentSrc = imgElement.src;
              if (currentSrc && !currentSrc.includes('?t=')) {
                // Add timestamp query parameter to force reload
                const separator = currentSrc.includes('?') ? '&' : '?';
                imgElement.src = `${currentSrc}${separator}t=${timestamp}`;
              } else {
                // Already has timestamp, replace it
                imgElement.src = currentSrc.replace(/[?&]t=\d+/, `?t=${timestamp}`);
              }
              break;
            }
          }
        }
        break;
      }
      case 'imageUndoResized':
      case 'imageRedoResized':
        // Image undo/redo completed - image file already updated by extension
        // Just refresh the image src to show updated version
        if (message.success && message.imagePath) {
          const timestamp = Date.now();
          const images = document.querySelectorAll('.markdown-image');
          for (const img of images) {
            const imgElement = img as HTMLImageElement;
            const imgPath =
              imgElement.getAttribute('data-markdown-src') || imgElement.getAttribute('src') || '';
            if (imgPath === message.imagePath || imgPath.endsWith(message.imagePath)) {
              // Clear metadata cache to force fresh fetch with updated dimensions
              clearImageMetadataCache(imgPath);

              // Force image reload with cache-busting
              const currentSrc = imgElement.src;
              if (currentSrc) {
                const separator = currentSrc.includes('?') ? '&' : '?';
                imgElement.src = currentSrc.split(/[?&]t=/)[0] + `${separator}t=${timestamp}`;
              }
              break;
            }
          }
        }
        break;
      case 'imageWorkspaceCheck': {
        // Response to checkImageInWorkspace request
        const requestId = message.requestId as string;
        const callbacks = (window as any)._workspaceCheckCallbacks;
        if (callbacks && callbacks.has(requestId)) {
          const callback = callbacks.get(requestId);
          callback({
            inWorkspace: message.inWorkspace as boolean,
            absolutePath: message.absolutePath as string | undefined,
          });
          callbacks.delete(requestId);
        }
        break;
      }
      case 'imageReferences': {
        const requestId = message.requestId as string;
        const callback = imageReferencesCallbacks.get(requestId);
        if (callback) {
          callback(message as ImageReferencesPayload);
          imageReferencesCallbacks.delete(requestId);
        }
        break;
      }
      case 'imageRenameCheck': {
        const requestId = message.requestId as string;
        const callback = imageRenameCheckCallbacks.get(requestId);
        if (callback) {
          callback(message as ImageRenameCheckPayload);
          imageRenameCheckCallbacks.delete(requestId);
        }
        break;
      }
      case 'imageMetadata': {
        // Response to getImageMetadata request
        const requestId = message.requestId as string;
        const metadata = message.metadata;
        const callbacks = (window as any)._metadataCallbacks;
        if (callbacks && callbacks.has(requestId)) {
          const callback = callbacks.get(requestId);

          // Check if we already have cached metadata with dimensions (e.g., from resize)
          const imagePath = metadata?.path;
          const cachedMetadata = imagePath ? getCachedImageMetadata(imagePath) : null;
          const preservedDimensions =
            cachedMetadata &&
            cachedMetadata.dimensions.width > 0 &&
            cachedMetadata.dimensions.height > 0
              ? cachedMetadata.dimensions
              : null;

          // If metadata has dimensions 0x0, try to get from img element or use preserved dimensions
          if (metadata && metadata.dimensions && metadata.dimensions.width === 0) {
            // First, try to use preserved dimensions from cache (set during resize)
            if (preservedDimensions) {
              metadata.dimensions = preservedDimensions;
            } else {
              // Fall back to getting dimensions from img element
              const images = document.querySelectorAll('.markdown-image');
              for (const img of images) {
                const imgElement = img as HTMLImageElement;
                const imgPath =
                  imgElement.getAttribute('data-markdown-src') ||
                  imgElement.getAttribute('src') ||
                  '';
                // Match by exact path or if one ends with the other (handles relative path variations)
                if (
                  imgPath === imagePath ||
                  imgPath.endsWith(imagePath) ||
                  imagePath.endsWith(imgPath)
                ) {
                  // Prefer naturalWidth/naturalHeight (actual image file dimensions)
                  // These reflect the actual resized image dimensions after resize
                  const width = imgElement.naturalWidth || imgElement.width || 0;
                  const height = imgElement.naturalHeight || imgElement.height || 0;

                  if (width > 0 && height > 0) {
                    metadata.dimensions = {
                      width,
                      height,
                    };
                  }
                  break;
                }
              }
            }
          } else if (preservedDimensions && metadata) {
            // If we have preserved dimensions and metadata already has dimensions, prefer preserved (more recent)
            metadata.dimensions = preservedDimensions;
          }

          callback(metadata);
          callbacks.delete(requestId);
        }
        break;
      }
      case 'localImageCopied': {
        // Local image copied to workspace - update TipTap node and show resize modal
        if (!editor) break;

        const relativePath = message.relativePath as string;
        const originalPath = message.originalPath as string;

        // Find the image element in DOM first (more reliable than searching doc)
        const images = document.querySelectorAll('.markdown-image');
        let imgElement: HTMLImageElement | null = null;

        for (const img of images) {
          const element = img as HTMLImageElement;
          const imgSrc =
            element.getAttribute('data-markdown-src') || element.getAttribute('src') || '';
          // Check if this matches the original path (could be relative or absolute)
          if (
            imgSrc === originalPath ||
            imgSrc.includes(originalPath) ||
            originalPath.includes(imgSrc)
          ) {
            imgElement = element;
            break;
          }
        }

        if (!imgElement) {
          console.warn(`${BUILD_TAG} Could not find image element for local image copy`);
          break;
        }

        // Get position from DOM element
        const pos = editor.view.posAtDOM(imgElement, 0);

        if (pos === undefined || pos === null) {
          console.warn(`${BUILD_TAG} Could not find position for image in editor`);
          break;
        }

        // Get the node at this position
        const node = editor.state.doc.nodeAt(pos);

        if (!node || node.type.name !== 'image') {
          console.warn(`${BUILD_TAG} Node at position ${pos} is not an image: ${node?.type.name}`);
          break;
        }

        // Update image node attributes using updateAttributes (safer than setNodeMarkup)
        try {
          editor
            .chain()
            .setNodeSelection(pos)
            .updateAttributes('image', {
              src: relativePath,
              'markdown-src': relativePath,
            })
            .run();

          // Update DOM attributes
          imgElement.setAttribute('data-markdown-src', relativePath);
          imgElement.setAttribute('src', relativePath);

          // Clear pending copy flags
          delete (imgElement as any)._pendingDownloadPlaceholderId;

          // If this image was pending resize after copy, show resize modal now
          if ((imgElement as any)._pendingResizeAfterDownload) {
            delete (imgElement as any)._pendingResizeAfterDownload;

            // Wait for image to load, then show resize modal
            const showModalAfterLoad = () => {
              if (editor && imgElement) {
                showResizeModalAfterDownload(imgElement, editor, vscode);
              }
            };

            if (imgElement.complete) {
              showModalAfterLoad();
            } else {
              imgElement.addEventListener('load', showModalAfterLoad, { once: true });

              // Request resolution for the new local path
              if ((window as any).resolveImagePath) {
                (window as any).resolveImagePath(relativePath).then((webviewUri: string) => {
                  if (imgElement) {
                    imgElement.src = webviewUri;
                    imgElement.setAttribute('data-markdown-src', relativePath);
                  }
                });
              } else {
                const newSrc = relativePath.startsWith('./') ? relativePath : `./${relativePath}`;
                imgElement.src = newSrc;
                imgElement.setAttribute('data-markdown-src', relativePath);
              }
            }
          }
        } catch (error) {
          console.error(`${BUILD_TAG} Failed to update image node after copy:`, error);
        }
        break;
      }
      case 'localImageCopyError': {
        // Local image copy failed
        const error = message.error as string;
        console.error(`${BUILD_TAG} Local image copy failed:`, error);
        // Error already shown by extension, just clean up any pending state
        const images = document.querySelectorAll('.markdown-image');
        for (const img of images) {
          const imgElement = img as HTMLImageElement;
          if ((imgElement as any)._pendingDownloadPlaceholderId === message.placeholderId) {
            delete (imgElement as any)._pendingDownloadPlaceholderId;
            delete (imgElement as any)._pendingResizeAfterDownload;
          }
        }
        break;
      }
      case 'imageUriResolved': {
        // Handle image URI resolution response
        const callback = uriResolveCallbacks.get(message.requestId);
        if (callback) {
          callback(message.webviewUri);
          uriResolveCallbacks.delete(message.requestId);
        }
        break;
      }
      case 'navigateToHeading': {
        if (!editor) return;
        const pos = message.pos as number;
        // Record current position immediately before jumping
        if (navLastRecorded !== null) {
          navRecordPosition(navLastRecorded, true);
        }
        scrollToHeading(editor, pos);
        break;
      }
      case 'selectProposalSelection':
      case 'scrollAndSelect': {
        if (!editor) {
          pendingSelectionRevealMessage = message as {
            type: 'scrollAndSelect' | 'selectProposalSelection';
            request_id?: string;
            original: string;
            context_before: string | null;
            context_after: string | null;
            headings_before?: string[] | null;
          };
          break;
        }
        handleSelectionRevealMessage(editor, message as {
          type: 'scrollAndSelect' | 'selectProposalSelection';
          request_id?: string;
          original: string;
          context_before: string | null;
          context_after: string | null;
          headings_before?: string[] | null;
        });
        break;
      }
      case 'revealCurrentProposalSelection': {
        if (!editor) {
          pendingSelectionRevealMessage = { type: 'revealCurrentProposalSelection' };
          break;
        }
        handleSelectionRevealMessage(editor, { type: 'revealCurrentProposalSelection' });
        break;
      }
      case 'clearProposalTargetHighlight': {
        clearProposalTargetHighlight();
        lastProposalSelectionTarget = null;
        if (editor) {
          editor.view.dispatch(editor.state.tr.setMeta(pinnedSelectionPluginKey, null));
        }
        break;
      }
      case 'navigateBack': {
        if (!editor || navBack.length === 0) return;
        const dest = navBack.pop()!;
        if (navLastRecorded !== null) navForward.push(navLastRecorded);
        navIsJumping = true;
        navLastRecorded = dest;
        scrollToPos(editor, dest);
        navIsJumping = false;
        break;
      }
      case 'navigateForward': {
        if (!editor || navForward.length === 0) return;
        const dest = navForward.pop()!;
        if (navLastRecorded !== null) navBack.push(navLastRecorded);
        navIsJumping = true;
        navLastRecorded = dest;
        scrollToPos(editor, dest);
        navIsJumping = false;
        break;
      }
      case 'fileSearchResults': {
        import('./features/linkDialog').then(({ handleFileSearchResults }) => {
          const results = message.results as Array<{ filename: string; path: string }>;
          const requestId = message.requestId as number;
          handleFileSearchResults(results, requestId);
        });
        break;
      }
      default:
        console.warn(`${BUILD_TAG} Unknown message type:`, message.type);
    }
  } catch (error) {
    console.error(`${BUILD_TAG} Error handling message:`, error);
  }
});

/**
 * Update editor content from document with cursor preservation
 */
function updateEditorContent(markdown: string) {
  if (!editor) {
    console.error(`${BUILD_TAG} Editor not initialized`);
    return;
  }

  try {
    // Hash-based deduplication: skip if this is content we just sent
    const incomingHash = hashString(markdown);
    if (incomingHash === lastSentContentHash) {
      // Also check timestamp to allow legitimate identical content after a delay
      const timeSinceLastSend = Date.now() - lastSentTimestamp;
      if (timeSinceLastSend < 2000) {
        console.log(`${BUILD_TAG} Ignoring update (matches content we just sent)`);
        return;
      }
    }

    // Don't update if user edited recently (within 2 seconds)
    const timeSinceLastEdit = Date.now() - lastUserEditTime;
    if (timeSinceLastEdit < 2000) {
      console.log(`${BUILD_TAG} Skipping update - user recently edited (${timeSinceLastEdit}ms ago)`);
      return;
    }

    isUpdating = true;

    const startTime = performance.now();
    const docSize = markdown.length;

    console.log(`${BUILD_TAG} Updating content (${docSize} chars)...`);

    // Skip if content is already in sync
    const currentMarkdown = getEditorMarkdownForSync(editor);
    if (currentMarkdown === markdown) {
      console.log(`${BUILD_TAG} Update skipped (content unchanged)`);
      return;
    }

    // Save cursor position
    const { from, to } = editor.state.selection;
    console.log(`${BUILD_TAG} Saving cursor position: ${from}-${to}`);

    // Set content
    editor.commands.setContent(markdown, { contentType: 'markdown' });

    // Restore cursor position
    try {
      editor.commands.setTextSelection({ from, to });
      console.log(`${BUILD_TAG} Restored cursor position: ${from}-${to}`);
    } catch {
      console.warn(`${BUILD_TAG} Could not restore exact cursor position, using safe position`);
      // If exact position fails, move to end of document
      const endPos = editor.state.doc.content.size;
      editor.commands.setTextSelection(Math.min(from, endPos));
    }

    pushOutlineUpdate();

    const duration = performance.now() - startTime;
    console.log(`${BUILD_TAG} Content updated in ${duration.toFixed(2)}ms`);

    if (duration > 1000) {
      console.warn(`${BUILD_TAG} Slow update: ${duration.toFixed(2)}ms for ${docSize} chars`);
    }
  } catch (error) {
    console.error(`${BUILD_TAG} Error updating content:`, error);
    console.error(`${BUILD_TAG} Document size:`, markdown.length, 'chars');
  } finally {
    isUpdating = false;
  }
}

// Initialize when DOM is ready and content is available
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    isDomReady = true;
    if (__IS_DEV_BUILD__) ensureBuildStampBadge();
    if (document.getElementById('proposal-root')) {
      initializeProposalMode();
    } else {
      signalReady();
      if (!editor && pendingInitialContent !== null) {
        initializeEditor(pendingInitialContent);
        pendingInitialContent = null;
      }
    }
  });
} else {
  isDomReady = true;
  if (__IS_DEV_BUILD__) ensureBuildStampBadge();
  if (document.getElementById('proposal-root')) {
    initializeProposalMode();
  } else {
    signalReady();
    if (!editor && pendingInitialContent !== null) {
      initializeEditor(pendingInitialContent);
      pendingInitialContent = null;
    }
  }
}

// Handle find from toolbar button
window.addEventListener('openFind', () => {
  if (editor) {
    toggleSearchOverlay(editor);
  }
});

// Handle Go Back / Go Forward from toolbar dropdown
window.addEventListener('navigateBack', () => {
  if (!editor || navBack.length === 0) return;
  const dest = navBack.pop()!;
  if (navLastRecorded !== null) navForward.push(navLastRecorded);
  navIsJumping = true;
  navLastRecorded = dest;
  scrollToPos(editor, dest);
  navIsJumping = false;
});

window.addEventListener('navigateForward', () => {
  if (!editor || navForward.length === 0) return;
  const dest = navForward.pop()!;
  if (navLastRecorded !== null) navBack.push(navLastRecorded);
  navIsJumping = true;
  navLastRecorded = dest;
  scrollToPos(editor, dest);
  navIsJumping = false;
});

window.addEventListener('navRecordPosition', (e: Event) => {
  const { pos, immediate } = (e as CustomEvent<{ pos: number; immediate: boolean }>).detail;
  navRecordPosition(pos, immediate ?? false);
});

// Handle custom event for TOC toggle from toolbar button
window.addEventListener('toggleTocOutline', () => {
  if (editor) {
    toggleTocOverlay(editor);
    updateToolbarStates();
  }
});

// Handle copy as markdown from toolbar button
window.addEventListener('copyAsMarkdown', () => {
  if (!editor) return;
  copySelectionAsMarkdown(editor);
});

// Intercept copy and cut to put clean markdown on the clipboard.
// TipTap's default copy puts its internal HTML on the clipboard, which loses
// alert metadata (data-alert-type). By writing markdown ourselves we ensure
// round-trip fidelity for alerts and other custom nodes.
document.addEventListener(
  'copy',
  (event: ClipboardEvent) => {
    if (!editor || editor.state.selection.empty) return;
    const proposalNodeRange =
      lastProposalSelectionTarget?.selectionKind === 'node'
        ? lastProposalSelectionTarget
        : null;
    const markdown = proposalNodeRange
      ? getRangeAsMarkdown(editor, proposalNodeRange.selFrom, proposalNodeRange.selTo)
      : getSelectionAsMarkdown(editor);
    if (!markdown) return;
    event.preventDefault();
    event.clipboardData?.setData('text/plain', markdown);
  },
  true
);

document.addEventListener(
  'cut',
  (event: ClipboardEvent) => {
    if (!editor || editor.state.selection.empty) return;
    const proposalNodeRange =
      lastProposalSelectionTarget?.selectionKind === 'node'
        ? lastProposalSelectionTarget
        : null;
    const markdown = proposalNodeRange
      ? getRangeAsMarkdown(editor, proposalNodeRange.selFrom, proposalNodeRange.selTo)
      : getSelectionAsMarkdown(editor);
    if (!markdown) return;
    event.preventDefault();
    event.clipboardData?.setData('text/plain', markdown);
    if (proposalNodeRange) {
      editor.view.dispatch(
        editor.state.tr
          .delete(proposalNodeRange.selFrom, proposalNodeRange.selTo)
          .setMeta(pinnedSelectionPluginKey, null)
      );
      lastProposalSelectionTarget = null;
    } else {
      editor.commands.deleteSelection();
    }
  },
  true
);

// Handle toggle source view from toolbar button
window.addEventListener('openSourceView', () => {
  if (isSourceViewOpen) {
    console.log(`${BUILD_TAG} Closing source view...`);
    vscode.postMessage({ type: 'closeSourceView' });
    isSourceViewOpen = false;
  } else {
    console.log(`${BUILD_TAG} Opening source view...`);
    vscode.postMessage({ type: 'openSourceView' });
    isSourceViewOpen = true;
  }
  updateToolbarStates();
});

// Handle settings button from toolbar -> open VS Code settings UI
window.addEventListener('openExtensionSettings', () => {
  vscode.postMessage({ type: 'openExtensionSettings' });
});

// Handle export document from toolbar button
window.addEventListener('exportDocument', async (event: Event) => {
  if (!editor) return;

  const customEvent = event as CustomEvent;
  const format = customEvent.detail?.format || 'pdf';

  console.log(`${BUILD_TAG} Exporting document as ${format}...`);

  try {
    // Collect content and convert Mermaid to PNG
    const exportData = await collectExportContent(editor);
    const title = getDocumentTitle(editor);

    // Send to extension for export
    vscode.postMessage({
      type: 'exportDocument',
      format,
      html: exportData.html,
      mermaidImages: exportData.mermaidImages,
      title,
    });
  } catch (error) {
    console.error(`${BUILD_TAG} Export failed:`, error);
    vscode.postMessage({
      type: 'showError',
      message: 'Failed to prepare document for export. See console for details.',
    });
  }
});

// Handle paste - convert markdown to HTML for proper TipTap rendering
// Must use capture phase to intercept BEFORE TipTap's default handling
document.addEventListener(
  'paste',
  (event: ClipboardEvent) => {
    if (!editor) return;

    const clipboardData = event.clipboardData;
    if (!clipboardData) return;

    // If cursor is inside a code block, handle specially
    if (editor.isActive('codeBlock')) {
      event.preventDefault();
      event.stopPropagation();

      const plainText = clipboardData.getData('text/plain') || '';

      // Check if pasted content is a fenced code block
      const fenced = parseFencedCode(plainText);
      const codeToInsert = fenced ? fenced.content : plainText;

      // Insert as plain text (TipTap will handle it correctly in code block)
      editor.commands.insertContent(codeToInsert);
      return;
    }

    const result = processPasteContent(clipboardData);

    // Images handled by imageDragDrop - don't interfere
    if (result.isImage) {
      return;
    }

    // If we need to convert content (rich HTML or markdown), intercept early
    if (result.wasConverted && result.content && result.isHtml) {
      event.preventDefault();
      event.stopPropagation();
      // Insert HTML - TipTap parses it into proper nodes (tables, lists, etc.)
      editor.commands.insertContent(result.content);
    }
    // Otherwise: default paste behavior for plain text
  },
  true // Capture phase - runs BEFORE TipTap's handlers
);

// Global error handler
window.addEventListener('error', event => {
  console.error(`${BUILD_TAG} Uncaught error:`, event.error);
});

window.addEventListener('unhandledrejection', event => {
  console.error(`${BUILD_TAG} Unhandled promise rejection:`, event.reason);
});

// Testing hooks (not used in production UI)
export const __testing = {
  setMockEditor(mockEditor: any) {
    editor = mockEditor;
  },
  updateEditorContentForTests(markdown: string) {
    return updateEditorContent(markdown);
  },
  trackSentContentForTests(content: string) {
    trackSentContent(content);
  },
  getLastSentContentHash() {
    return lastSentContentHash;
  },
  resetSyncState() {
    lastSentContentHash = null;
    lastSentTimestamp = 0;
  },
};

// ---------------------------------------------------------------------------
// Proposal mode
// Activated when the webview HTML contains #proposal-root instead of #editor.
// Renders a read-only redline review above an editable proposed TipTap instance,
// plus Accept / Edit / Cancel buttons and a countdown timer.
// ---------------------------------------------------------------------------

const PROPOSAL_PENDING_HANDOFF_MS = 110 * 1000; // hand off before common 120s MCP client timeout

function initializeProposalMode() {
  const root = document.getElementById('proposal-root');
  if (!root) return;

  // Inject styles once
  const styleEl = document.createElement('style');
  styleEl.textContent = `
    body { margin: 0; padding: 0; overflow-y: auto; }
    .proposal-layout { display: flex; flex-direction: column; min-height: 100vh; padding: 8px; box-sizing: border-box; gap: 6px; overflow-x: hidden; }
    .proposal-section { display: flex; flex-direction: column; flex: 0 0 auto; min-height: 0; }
    .proposal-section-redline { flex: 0 0 auto; }
    .proposal-section-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; }
    .proposal-label-redline { opacity: 0.6; }
    /* Wrap provides the border/scroll container; extra left padding for heading ::before labels */
    .proposal-pane-wrap { flex: 1; overflow: auto; border: 1px solid var(--vscode-widget-border, #444); border-radius: 3px; min-height: 0; padding-left: 2.5em; box-sizing: border-box; }
    .proposal-border-editing { border-color: #2980b9; }
    .proposal-pane-wrap-review { background: color-mix(in srgb, var(--vscode-editor-background) 90%, var(--vscode-panel-border, #444) 10%); }
    .proposal-redline-wrap,
    .proposal-edit-wrap {
      overflow: auto;
      min-height: 0;
      box-sizing: border-box;
    }
    /* Override .markdown-editor defaults that don't fit inside the wrap */
    .proposal-pane.markdown-editor { margin: 6px 16px 6px 0; padding-left: 0; min-height: 2em; }
    .proposal-review-pane.markdown-editor { margin: 6px 16px 6px 0; padding-left: 0; min-height: 2em; pointer-events: none; }
    .proposal-review-pane > :first-child { margin-top: 0; }
    .proposal-review-pane > :last-child { margin-bottom: 0; }
    .proposal-redline-added { background: color-mix(in srgb, var(--vscode-diffEditor-insertedTextBackground, rgba(46, 160, 67, 0.25)) 88%, transparent); color: inherit; border-radius: 3px; padding: 0 0.08em; }
    .proposal-redline-removed { background: color-mix(in srgb, var(--vscode-diffEditor-removedTextBackground, rgba(248, 81, 73, 0.18)) 92%, transparent); color: inherit; text-decoration: line-through; text-decoration-thickness: 2px; text-decoration-color: color-mix(in srgb, var(--vscode-errorForeground, #f85149) 78%, transparent); border-radius: 3px; padding: 0 0.08em; }
    .proposal-redline-list { margin: 0 0 1em 0; padding-left: 1.4em; }
    .proposal-redline-task-list { list-style: none; padding-left: 0; }
    .proposal-redline-task-list label { display: inline-flex; align-items: flex-start; gap: 0.5em; }
    .proposal-redline-task-list input { margin: 0.2em 0 0; }
    .proposal-redline-structural { border-radius: 6px; margin: 0 0 12px; padding: 2px 6px; }
    .proposal-redline-structural.proposal-redline-added { background: color-mix(in srgb, var(--vscode-diffEditor-insertedLineBackground, rgba(46, 160, 67, 0.08)) 88%, transparent); }
    .proposal-redline-structural.proposal-redline-removed { background: color-mix(in srgb, var(--vscode-diffEditor-removedLineBackground, rgba(248, 81, 73, 0.08)) 88%, transparent); }
    .proposal-redline-structural-content > :first-child { margin-top: 0; }
    .proposal-redline-structural-content > :last-child { margin-bottom: 0; }
    .proposal-redline-structural.proposal-redline-removed .proposal-redline-structural-content > * {
      text-decoration: line-through;
      text-decoration-thickness: 2px;
      text-decoration-color: color-mix(in srgb, var(--vscode-errorForeground, #f85149) 78%, transparent);
    }
    .proposal-redline-block { border-radius: 6px; margin: 0 0 12px; padding: 2px 6px; }
    .proposal-redline-block-removed { background: color-mix(in srgb, var(--vscode-diffEditor-removedLineBackground, rgba(248, 81, 73, 0.08)) 88%, transparent); }
    .proposal-redline-block-added { background: color-mix(in srgb, var(--vscode-diffEditor-insertedLineBackground, rgba(46, 160, 67, 0.08)) 88%, transparent); }
    .proposal-redline-block-content > :first-child { margin-top: 0; }
    .proposal-redline-block-content > :last-child { margin-bottom: 0; }
    .proposal-redline-block-removed .proposal-redline-block-content > * {
      text-decoration: line-through;
      text-decoration-thickness: 2px;
      text-decoration-color: color-mix(in srgb, var(--vscode-errorForeground, #f85149) 78%, transparent);
    }
    .proposal-review-pane .github-alert { pointer-events: none; }
    .proposal-redline-empty { opacity: 0.7; font-style: italic; }
    .proposal-context-ghost { opacity: 0.35; pointer-events: none; }
    /* Multi-option layout */
    .proposal-option-section { display: flex; flex-direction: column; flex: 0 0 auto; min-height: 0; transition: opacity 0.15s; }
    .proposal-option-section.proposal-option-inactive { opacity: 0.35; }
    .proposal-option-title-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
    .proposal-option-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #2980b9; }
    .proposal-option-accept { padding: 4px 12px; border: 1px solid var(--vscode-button-border, transparent); border-radius: 2px; cursor: pointer; font-size: 13px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
    .proposal-option-accept:hover { background: var(--vscode-button-hoverBackground); }
    .proposal-justification-section { flex: 0 0 auto; margin-top: 4px; margin-bottom: 6px; overflow: hidden; }
    .proposal-justification-body {
      padding: 4px 8px 4px 1em;
      border: 1px solid var(--vscode-widget-border, #444);
      border-radius: 3px;
      background: color-mix(in srgb, var(--vscode-editor-background) 90%, var(--vscode-panel-border, #444) 10%);
      box-sizing: border-box;
      overflow: auto;
      min-height: 0;
    }
    .proposal-justification-content { overflow: visible; }
    .proposal-actions { display: flex; align-items: center; gap: 6px; padding: 4px 0; flex-shrink: 0; }
    .proposal-btn { padding: 4px 12px; border: 1px solid var(--vscode-button-border, transparent); border-radius: 2px; cursor: pointer; font-size: 13px; background: var(--vscode-button-secondaryBackground, #3a3d41); color: var(--vscode-button-secondaryForeground, #ccc); }
    .proposal-btn:hover { background: var(--vscode-button-secondaryHoverBackground, #45494e); }
    .proposal-btn-primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
    .proposal-btn-primary:hover { background: var(--vscode-button-hoverBackground); }
    .proposal-btn-timer { margin-left: auto; min-width: 72px; }
    .proposal-btn-timer.expiring { color: var(--vscode-errorForeground, #f44); border-color: var(--vscode-errorForeground, #f44); }
    .proposal-btn-timer.resume-ready { color: var(--vscode-textLink-foreground, #3794ff); border-color: var(--vscode-textLink-foreground, #3794ff); }
  `;
  document.head.appendChild(styleEl);

  // Shared TipTap extensions (same as main editor minus persistence-related ones)
  const sharedExtensions = [
    StarterKit,
    Markdown,
    TableKit,
    ListKit,
    Link,
    TabIndentation,
    GitHubAlerts,
    MarkdownParagraph,
    OrderedListMarkdownFix,
  ];

  // --- State ---
  let currentOriginalMarkdown = '';
  let currentDisplayContextBefore = '';
  let currentDisplayContextAfter = '';
  // proposedEditors[i] corresponds to options[i]
  const proposedEditors: Editor[] = [];
  let activeEditorIndex = 0;

  // These are populated after buildLayout() based on msg.options count
  let reviewEl: HTMLElement;
  let redlineTitleEl: HTMLElement;
  let numOptions = 1;
  let optionSections: HTMLElement[] = [];
  let acceptBtns: HTMLButtonElement[] = [];
  let cancelBtn: HTMLButtonElement;
  let skipRemainingBtn: HTMLButtonElement | null = null;
  let rejectBtn: HTMLButtonElement | null = null;
  let timerBtn: HTMLButtonElement;

  // --- Timer state ---
  let handoffTimeout: ReturnType<typeof setTimeout> | null = null;
  let hasPendingHandoff = false;
  let hasCopiedResumePrompt = false;

  const centerActiveRedlineChange = () => {
    const redlineWrap = root?.querySelector('.proposal-redline-wrap') as HTMLElement | null;
    if (!redlineWrap || !reviewEl) return;

    const changeInlineTarget = reviewEl.querySelector(
      '.proposal-redline-added, .proposal-redline-removed, .proposal-redline-block-added, .proposal-redline-block-removed, .proposal-redline-structural.proposal-redline-added, .proposal-redline-structural.proposal-redline-removed'
    ) as HTMLElement | null;
    const changeTarget = (changeInlineTarget?.closest('h1, h2, h3, h4, h5, h6, p, li, blockquote, table, pre') as HTMLElement | null)
      ?? changeInlineTarget;

    if (!changeTarget) {
      redlineWrap.scrollTop = 0;
      return;
    }

    const targetTop = changeTarget.offsetTop;
    const targetHeight = changeTarget.offsetHeight;
    redlineWrap.scrollTop = Math.max(0, targetTop - (redlineWrap.clientHeight - targetHeight) / 2);
  };

  // --- Render redline from the active editor ---
  const renderReviewPane = () => {
    const activeEditor = proposedEditors[activeEditorIndex];
    if (!activeEditor || !reviewEl) return;
    const editedMarkdown = getEditorMarkdownForSync(activeEditor);
    const extractedReplacement = extractProposalReplacementFromEditableMarkdown(
      currentOriginalMarkdown,
      editedMarkdown,
      currentDisplayContextBefore,
      currentDisplayContextAfter
    );
    const replacementMarkdown = normalizeProposalReplacementForContext(
      currentOriginalMarkdown,
      extractedReplacement,
      currentDisplayContextBefore,
      currentDisplayContextAfter
    );
    const redlineHtml = renderProposalRedlineHtml(
      currentOriginalMarkdown,
      replacementMarkdown,
      {
        displayContextBefore: currentDisplayContextBefore || undefined,
        displayContextAfter: currentDisplayContextAfter || undefined,
      }
    );
    reviewEl.innerHTML = redlineHtml;
    if (redlineTitleEl) {
      const suffix = numOptions > 1 ? ` — Option ${activeEditorIndex + 1}` : '';
      redlineTitleEl.textContent = `Redlined Proposal${suffix}`;
    }
    requestAnimationFrame(() => {
      centerActiveRedlineChange();
      setTimeout(() => centerActiveRedlineChange(), 0);
      setTimeout(() => centerActiveRedlineChange(), 50);
    });
  };

  // --- Opacity: dim all option sections except the active one ---
  const updateOptionOpacity = () => {
    optionSections.forEach((section, i) => {
      section.classList.toggle('proposal-option-inactive', i !== activeEditorIndex);
    });
  };

  const activateOption = (index: number, focusEditor = false) => {
    activeEditorIndex = index;
    renderReviewPane();
    updateOptionOpacity();
    updateToolbarStates();
    if (focusEditor) {
      proposedEditors[index]?.commands.focus();
      window.dispatchEvent(new CustomEvent('editorFocusChange', { detail: { focused: true } }));
    }
  };

  // --- Response handler (shared by Accept buttons and skip buttons) ---
  const handleProposalResponse = (status: 'accept' | 'skip' | 'reject' | 'skipped', optionIndex?: number) => {
    if (handoffTimeout) { clearTimeout(handoffTimeout); handoffTimeout = null; }
    const normalizedStatus = status === 'skip' ? 'skipped' : status === 'reject' ? 'rejected' : status;
    const resolvedIndex = optionIndex ?? activeEditorIndex;
    const editedMarkdown = getEditorMarkdownForSync(proposedEditors[resolvedIndex]);
    const extractedReplacement = extractProposalReplacementFromEditableMarkdown(
      currentOriginalMarkdown,
      editedMarkdown,
      currentDisplayContextBefore,
      currentDisplayContextAfter
    );
    const replacementMd = normalizedStatus === 'skipped' || normalizedStatus === 'rejected'
      ? null
      : normalizeProposalReplacementForContext(
          currentOriginalMarkdown,
          extractedReplacement,
          currentDisplayContextBefore,
          currentDisplayContextAfter
        );
    vscode.postMessage({
      type: 'proposalResponse',
      status: normalizedStatus,
      replacement: replacementMd,
      selected_option_index: normalizedStatus === 'skipped' ? null : resolvedIndex,
    });
  };

  // --- Timer helpers ---
  const updateTimerButtonForPendingHandoff = () => {
    timerBtn.textContent = hasCopiedResumePrompt ? 'Copied: resume' : 'Resume Conversation';
    timerBtn.title = 'When you finish editing, return to chat and type: resume';
    timerBtn.classList.add('resume-ready');
  };

  const notifyPendingHandoff = () => {
    if (hasPendingHandoff) return;
    hasPendingHandoff = true;
    hasCopiedResumePrompt = false;
    updateTimerButtonForPendingHandoff();
    vscode.postMessage({ type: 'proposalPending' });
  };

  const startHandoffTimer = () => {
    if (handoffTimeout) clearTimeout(handoffTimeout);
    handoffTimeout = setTimeout(() => {
      handoffTimeout = null;
      if (!hasPendingHandoff) notifyPendingHandoff();
    }, PROPOSAL_PENDING_HANDOFF_MS);
  };

  // --- Build dynamic layout from options array ---
  interface OptionData { replacement: string; justification?: string | null; }

  const buildLayout = (options: OptionData[], hasRemaining = false) => {
    // Destroy any previous editors
    proposedEditors.forEach(ed => ed.destroy());
    proposedEditors.length = 0;
    optionSections.length = 0;
    acceptBtns.length = 0;
    activeEditorIndex = 0;

    const multiOption = options.length > 1;

    // Build option section HTML strings
    const optionSectionsHtml = options.map((_, i) => `
      <div class="proposal-option-section" id="proposal-option-section-${i}">
        <div class="proposal-justification-section" id="proposal-just-section-${i}" style="display:none">
          <div class="proposal-justification-label">Justification${multiOption ? ` \u2014 Option ${i + 1}` : ''}</div>
          <div class="proposal-justification-body">
            <div class="proposal-justification-content proposal-review-pane markdown-editor" id="proposal-just-content-${i}"></div>
          </div>
        </div>
        <div class="proposal-option-title-row">
          <div class="proposal-section-label proposal-label-editing">Editable Proposal${multiOption ? ` \u2014 Option ${i + 1}` : ''}</div>
          <button class="proposal-option-accept" id="proposal-accept-${i}" title="Apply option ${i + 1} to the document">Accept</button>
        </div>
        <div id="proposal-toolbar-mount-${i}"></div>
        <div class="proposal-pane-wrap proposal-edit-wrap" style="border:1px solid #2980b9; border-radius:3px; padding-left:2.5em;">
          <div id="proposal-proposed-${i}" class="proposal-pane proposal-pane-proposed markdown-editor"></div>
        </div>
      </div>
    `).join('');

    root!.innerHTML = `
      <div class="proposal-layout">
        <div class="proposal-section proposal-section-redline">
          <div id="proposal-redline-title" class="proposal-section-label proposal-label-redline">Redlined Proposal</div>
          <div class="proposal-pane-wrap proposal-pane-wrap-review proposal-redline-wrap">
            <div id="proposal-review" class="proposal-review-pane markdown-editor"></div>
          </div>
        </div>
        ${optionSectionsHtml}
        <div class="proposal-actions">
          <button id="proposal-cancel" class="proposal-btn" title="${multiOption ? 'Skip these proposal options without making changes.' : 'Skip this proposal and make no changes.'}">${multiOption ? 'Skip These' : 'Skip This'}</button>
          ${hasRemaining ? '<button id="proposal-skip-remaining" class="proposal-btn" title="Skip this proposal and all remaining proposals and make no more changes.">Skip Remaining</button>' : ''}
          <button id="proposal-reject" class="proposal-btn" title="${multiOption ? 'Decline these proposal options as no change is wanted.' : 'Decline this proposal as no change is wanted.'}">${multiOption ? 'Reject These' : 'Reject This'}</button>
          <button id="proposal-timer" class="proposal-btn proposal-btn-timer" title="Review in progress">Review in progress</button>
        </div>
      </div>
    `;

    // Grab stable DOM refs
    reviewEl = document.getElementById('proposal-review')!;
    redlineTitleEl = document.getElementById('proposal-redline-title')!;
    numOptions = options.length;
    cancelBtn = document.getElementById('proposal-cancel') as HTMLButtonElement;
    skipRemainingBtn = document.getElementById('proposal-skip-remaining') as HTMLButtonElement | null;
    rejectBtn = document.getElementById('proposal-reject') as HTMLButtonElement | null;
    timerBtn = document.getElementById('proposal-timer') as HTMLButtonElement;

    cancelBtn.addEventListener('click', () => handleProposalResponse('skip'));
    rejectBtn?.addEventListener('click', () => handleProposalResponse('reject'));
    skipRemainingBtn?.addEventListener('click', () => {
      if (handoffTimeout) { clearTimeout(handoffTimeout); handoffTimeout = null; }
      vscode.postMessage({ type: 'proposalSkipRemaining' });
    });
    timerBtn.addEventListener('click', () => {
      if (!hasPendingHandoff) return;
      hasCopiedResumePrompt = true;
      updateTimerButtonForPendingHandoff();
      vscode.postMessage({ type: 'copyResumePrompt' });
    });

    // Create one TipTap editor per option
    options.forEach((opt, i) => {
      const proposedEl = document.getElementById(`proposal-proposed-${i}`)!;
      const mountEl = document.getElementById(`proposal-toolbar-mount-${i}`)!;
      const section = document.getElementById(`proposal-option-section-${i}`) as HTMLElement;
      optionSections.push(section);

      const editor = new Editor({
        element: proposedEl,
        extensions: sharedExtensions,
        editable: true,
        content: '',
        onUpdate: () => {
          if (activeEditorIndex === i) renderReviewPane();
        },
        onFocus: () => {
          activateOption(i);
          window.dispatchEvent(new CustomEvent('editorFocusChange', { detail: { focused: true } }));
        },
        onBlur: () => {
          window.dispatchEvent(new CustomEvent('editorFocusChange', { detail: { focused: false } }));
        },
      });
      proposedEditors.push(editor);

      // Attach toolbar to this option's mount
      const toolbar = createFormattingToolbar(editor);
      mountEl.appendChild(toolbar);
      toolbar.addEventListener('mousedown', e => {
        e.preventDefault();
        activateOption(i, true);
      });

      // Accept button
      const acceptBtn = document.getElementById(`proposal-accept-${i}`) as HTMLButtonElement;
      acceptBtns.push(acceptBtn);
      acceptBtn.addEventListener('click', () => handleProposalResponse('accept', i));

      editor.commands.setContent(
        buildProposalEditableMarkdown(
          currentOriginalMarkdown,
          opt.replacement ?? '',
          currentDisplayContextBefore,
          currentDisplayContextAfter
        ),
        { contentType: 'markdown' }
      );

      // Justification
      const justSection = document.getElementById(`proposal-just-section-${i}`) as HTMLElement;
      const justContent = document.getElementById(`proposal-just-content-${i}`) as HTMLElement;
      if (opt.justification) {
        justContent.innerHTML = renderMarkdownHtml(opt.justification);
        justSection.style.display = '';
      }

      section.addEventListener('mousedown', event => {
        const target = event.target as HTMLElement | null;
        if (!target) return;
        if (target.closest('.proposal-option-accept')) return;
        if (target.closest('.proposal-pane-wrap-review')) return;
        activateOption(i);
      });
    });

    const applyPanelHeights = () => {
      const redlineWrap = root!.querySelector<HTMLElement>('.proposal-redline-wrap');
      const editWraps = Array.from(root!.querySelectorAll<HTMLElement>('.proposal-edit-wrap'));
      const justBodies = Array.from(root!.querySelectorAll<HTMLElement>('.proposal-justification-body'));
      const actionsEl = root!.querySelector<HTMLElement>('.proposal-actions');

      if (!redlineWrap || editWraps.length === 0) return;

      // Clear previous constraints
      redlineWrap.style.maxHeight = '';
      editWraps.forEach(w => { w.style.maxHeight = ''; });
      justBodies.forEach(b => { b.style.maxHeight = ''; b.style.overflow = ''; });

      // Measure natural justification body heights (unconstrained)
      const totalJustNaturalHeight = justBodies.reduce((s, b) => s + b.scrollHeight, 0);

      // Fixed chrome: actions bar + label/toolbar per section + gaps + padding
      const actionsHeight = actionsEl?.offsetHeight ?? 40;
      const numSections = 1 + editWraps.length; // redline + options
      const chromePerSection = 28; // label row
      const toolbarHeight = editWraps.length * 34; // toolbar per edit section only
      const gaps = numSections * 6;
      const padding = 16;
      const fixedChrome = actionsHeight + numSections * chromePerSection + toolbarHeight + gaps + padding;

      // Budget for scrollable panel bodies
      const budget = Math.max(100, window.innerHeight - fixedChrome - totalJustNaturalHeight);
      const maxPerPanel = Math.floor(budget / numSections);
      const cappedHeight = Math.max(66, maxPerPanel);

      redlineWrap.style.maxHeight = `${cappedHeight}px`;
      redlineWrap.style.overflow = 'auto';
      editWraps.forEach(w => {
        w.style.maxHeight = `${cappedHeight}px`;
        w.style.overflow = 'auto';
      });
      // Let justification bodies show fully (no max-height constraint)
    };

    const schedulePanelHeightPasses = () => {
      requestAnimationFrame(() => {
        applyPanelHeights();
        updateOptionOpacity();
        centerActiveRedlineChange();
      });
      setTimeout(() => {
        applyPanelHeights();
        updateOptionOpacity();
        centerActiveRedlineChange();
      }, 0);
      setTimeout(() => {
        applyPanelHeights();
        updateOptionOpacity();
        centerActiveRedlineChange();
      }, 50);
    };

    schedulePanelHeightPasses();
    window.addEventListener('resize', applyPanelHeights, { passive: true });
  };

  // --- Handle proposalInit from extension ---
  window.addEventListener('message', (event: MessageEvent) => {
    const msg = event.data;
    if (msg.type === 'resumePromptCopied') {
      hasCopiedResumePrompt = true;
      updateTimerButtonForPendingHandoff();
      return;
    }
    if (msg.type !== 'proposalInit') return;

    // Apply color settings if provided (same as main editor settingsUpdate)
    if (msg.colors && typeof msg.colors === 'object') {
      (window as any).md4hColors = msg.colors;
      applyColors({ ...DEFAULT_COLORS, ...(msg.colors as object) });
    }

    currentOriginalMarkdown = msg.original ?? '';
    currentDisplayContextBefore = msg.displayContextBefore ?? '';
    currentDisplayContextAfter = msg.displayContextAfter ?? '';

    // options: array of {replacement, justification?}; fall back to legacy single replacement
    const rawOptions: OptionData[] = Array.isArray(msg.options) && msg.options.length > 0
      ? msg.options.slice(0, 3)
      : [{ replacement: msg.replacement ?? '', justification: msg.justification ?? null }];

    const hasRemaining = typeof msg.queueTotal === 'number' && typeof msg.queueIndex === 'number'
      && msg.queueIndex < msg.queueTotal - 1;
    buildLayout(rawOptions, hasRemaining);
    // Render after setContent rAF fires so redline reflects actual content
    requestAnimationFrame(() => {
      renderReviewPane();
      updateToolbarStates();
    });

    // Reset timer
    hasPendingHandoff = false;
    hasCopiedResumePrompt = false;
    timerBtn.textContent = 'Review in progress';
    timerBtn.classList.remove('resume-ready');
    timerBtn.title = 'Review in progress';
    startHandoffTimer();
  });

  // Signal ready to extension host
  vscode.postMessage({ type: 'proposalReady' });
}


