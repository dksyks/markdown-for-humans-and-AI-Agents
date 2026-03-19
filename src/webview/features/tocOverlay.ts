/**
 * Copyright (c) 2025-2026 Concret.io
 *
 * Licensed under the MIT License. See LICENSE file in the project root for details.
 */

import { Editor } from '@tiptap/core';
import { buildOutlineFromEditor } from '../utils/outline';
import { scrollToHeading } from '../utils/scrollToHeading';

/**
 * TOC Panel state
 */
let tocWrapperElement: HTMLElement | null = null;
let tocResizeHandle: HTMLElement | null = null;
let isVisible = false;
let panelWidth = 220; // default width in px
const MIN_PANEL_WIDTH = 120;
const MAX_PANEL_WIDTH = 500;

/**
 * Update the editor's left margin to account for the fixed-position nav panel,
 * and position the panel below the toolbar.
 */
function updateEditorMargin(): void {
  const editorElement = document.querySelector('#editor') as HTMLElement;
  if (!editorElement) return;
  editorElement.style.marginLeft = isVisible ? panelWidth + 'px' : '';

  // Position wrapper below the toolbar
  if (tocWrapperElement) {
    const toolbar = document.querySelector('.formatting-toolbar') as HTMLElement;
    const toolbarHeight = toolbar ? toolbar.offsetHeight : 0;
    tocWrapperElement.style.setProperty('--toc-top', toolbarHeight + 'px');
  }
}

/**
 * Create the fixed left-side TOC panel and wrap the editor in a flex layout.
 * The header is a separate element from the scrollable list so it can never scroll.
 */
export function createTocPanel(editor: Editor): HTMLElement {
  const editorElement = document.querySelector('#editor') as HTMLElement;
  if (!editorElement) {
    throw new Error('Editor element not found');
  }

  // Create flex layout wrapper if it doesn't exist
  let appLayout = document.getElementById('app-layout');
  if (!appLayout) {
    appLayout = document.createElement('div');
    appLayout.id = 'app-layout';
    editorElement.parentNode!.insertBefore(appLayout, editorElement);
    appLayout.appendChild(editorElement);
  }

  // Create outer wrapper — this is the visible container that gets width/background/border
  const wrapper = document.createElement('div');
  wrapper.id = 'toc-panel-wrapper';
  wrapper.style.width = panelWidth + 'px';

  // Create header — direct child of wrapper, outside the scrollable panel
  const header = document.createElement('div');
  header.className = 'toc-panel-header';
  header.innerHTML = `
    <span class="toc-panel-title">Navigation</span>
    <button class="toc-panel-close" aria-label="Close navigation" title="Close (Esc)">×</button>
  `;

  const closeBtn = header.querySelector('.toc-panel-close') as HTMLElement;
  closeBtn.onclick = () => hideTocOverlay(editor);

  // Create panel body — contains only the scrollable list and resize handle
  const panel = document.createElement('div');
  panel.className = 'toc-panel';

  // Create list container
  const listContainer = document.createElement('div');
  listContainer.className = 'toc-panel-list';
  listContainer.setAttribute('role', 'list');

  // Create resize handle
  const resizeHandle = document.createElement('div');
  resizeHandle.className = 'toc-panel-resize-handle';
  tocResizeHandle = resizeHandle;

  // Assemble: panel holds list + resize handle
  panel.appendChild(listContainer);
  panel.appendChild(resizeHandle);

  // Assemble: wrapper holds header + panel
  wrapper.appendChild(header);
  wrapper.appendChild(panel);

  // Prevent scroll events from propagating to the main editor
  // when at the top/bottom boundary of the list
  panel.addEventListener('wheel', (e: WheelEvent) => {
    const el = listContainer;
    const atTop = el.scrollTop <= 0 && e.deltaY < 0;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight && e.deltaY > 0;
    if (atTop || atBottom) {
      e.preventDefault();
    }
  }, { passive: false });

  // Insert wrapper before editor in the flex layout
  appLayout.insertBefore(wrapper, editorElement);

  // Set up resize dragging (resizes the wrapper)
  setupResizeDrag(resizeHandle, wrapper);

  // Handle Esc key to close
  const handleKeydown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && isVisible) {
      e.preventDefault();
      hideTocOverlay(editor);
    }
  };
  document.addEventListener('keydown', handleKeydown);

  tocWrapperElement = wrapper;
  return wrapper;
}

/**
 * Set up mouse drag resizing for the panel.
 */
function setupResizeDrag(handle: HTMLElement, panel: HTMLElement) {
  let startX = 0;
  let startWidth = 0;

  const onMouseMove = (e: MouseEvent) => {
    const delta = e.clientX - startX;
    const newWidth = Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, startWidth + delta));
    panelWidth = newWidth;
    panel.style.width = newWidth + 'px';
    updateEditorMargin();
  };

  const onMouseUp = () => {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';

    // Persist width
    const vscodeApi = (window as any).vscode;
    if (vscodeApi) {
      vscodeApi.postMessage({
        type: 'updateSetting',
        key: 'markdownForHumans.outlinePanelWidth',
        value: panelWidth,
      });
    }
  };

  handle.addEventListener('mousedown', (e: MouseEvent) => {
    e.preventDefault();
    startX = e.clientX;
    startWidth = panelWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });
}

/**
 * Render the TOC list items
 */
function renderTocList(editor: Editor, listContainer: HTMLElement): void {
  const outline = buildOutlineFromEditor(editor);

  listContainer.innerHTML = '';

  if (outline.length === 0) {
    const emptyMessage = document.createElement('div');
    emptyMessage.className = 'toc-panel-empty';
    emptyMessage.innerHTML = `
      <p>No headings yet.</p>
      <p class="toc-panel-empty-hint">Add <code># Heading</code> to see your document outline.</p>
    `;
    listContainer.appendChild(emptyMessage);
    return;
  }

  outline.forEach((entry, index) => {
    const item = document.createElement('button');
    item.className = `toc-panel-item toc-panel-level-${entry.level}`;
    item.setAttribute('role', 'listitem');
    item.setAttribute('data-pos', String(entry.pos));
    item.setAttribute('tabindex', '0');

    const textContent = document.createElement('span');
    textContent.className = 'toc-panel-item-text';
    textContent.textContent = entry.text || '(Untitled)';

    item.appendChild(textContent);

    item.onclick = () => {
      scrollToHeading(editor, entry.pos);
    };

    item.onkeydown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        scrollToHeading(editor, entry.pos);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        const nextItem = listContainer.children[index + 1] as HTMLElement;
        if (nextItem) nextItem.focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prevItem = listContainer.children[index - 1] as HTMLElement;
        if (prevItem) prevItem.focus();
      }
    };

    listContainer.appendChild(item);
  });
}

/**
 * Show the TOC panel
 */
export function showTocOverlay(editor: Editor): void {
  if (!tocWrapperElement) {
    createTocPanel(editor);
  }

  if (!tocWrapperElement) return;

  const listContainer = tocWrapperElement.querySelector('.toc-panel-list') as HTMLElement;
  if (listContainer) {
    renderTocList(editor, listContainer);
  }

  tocWrapperElement.classList.add('visible');
  isVisible = true;
  updateEditorMargin();

  // Persist nav pane open state
  const vscodeApi = (window as any).vscode;
  if (vscodeApi) {
    vscodeApi.postMessage({
      type: 'updateSetting',
      key: 'markdownForHumans.showNavigationPane',
      value: true,
    });
  }

  requestAnimationFrame(() => {
    const firstItem = tocWrapperElement?.querySelector('.toc-panel-item') as HTMLElement;
    if (firstItem) {
      firstItem.focus();
    }
  });
}

/**
 * Hide the TOC panel
 */
export function hideTocOverlay(editor: Editor, restorePosition = true): void {
  if (!tocWrapperElement) return;

  tocWrapperElement.classList.remove('visible');
  isVisible = false;
  updateEditorMargin();

  // Persist nav pane closed state
  const vscodeApi = (window as any).vscode;
  if (vscodeApi) {
    vscodeApi.postMessage({
      type: 'updateSetting',
      key: 'markdownForHumans.showNavigationPane',
      value: false,
    });
  }

  editor.commands.focus();
}

/**
 * Toggle the TOC panel
 */
export function toggleTocOverlay(editor: Editor): void {
  if (isVisible) {
    hideTocOverlay(editor);
  } else {
    showTocOverlay(editor);
  }
}

/**
 * Check if TOC panel is visible
 */
export function isTocVisible(): boolean {
  return isVisible;
}

/**
 * Set the panel width (e.g., from persisted settings)
 */
export function setTocPanelWidth(width: number): void {
  panelWidth = Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, width));
  if (tocWrapperElement) {
    tocWrapperElement.style.width = panelWidth + 'px';
    updateEditorMargin();
  }
}

/**
 * Refresh the TOC list if the panel is visible (e.g., after heading text changes).
 */
export function refreshTocList(editor: Editor): void {
  if (!isVisible || !tocWrapperElement) return;
  const listContainer = tocWrapperElement.querySelector('.toc-panel-list') as HTMLElement;
  if (listContainer) {
    renderTocList(editor, listContainer);
  }
}

/**
 * Highlight the heading in the navigation pane that contains the cursor position.
 * If the cursor is not inside a heading, highlights the nearest preceding heading.
 */
export function updateActiveHeading(cursorPos: number, editor: Editor): void {
  if (!isVisible || !tocWrapperElement) return;

  const outline = buildOutlineFromEditor(editor);
  let activePos: number | null = null;

  // Find the heading whose section contains the cursor
  for (let i = outline.length - 1; i >= 0; i--) {
    if (outline[i].sectionStart <= cursorPos) {
      activePos = outline[i].pos;
      break;
    }
  }

  // Update the DOM: toggle .toc-active class
  const items = tocWrapperElement.querySelectorAll('.toc-panel-item');
  items.forEach(item => {
    const pos = Number(item.getAttribute('data-pos'));
    const isActive = pos === activePos;
    item.classList.toggle('toc-active', isActive);
    if (isActive) {
      (item as HTMLElement).scrollIntoView({ block: 'nearest' });
    }
  });
}
