/**
 * Copyright (c) 2025-2026 Concret.io
 *
 * Licensed under the MIT License. See LICENSE file in the project root for details.
 *
 * @fileoverview Toolbar and menu components for the WYSIWYG markdown editor.
 * Provides:
 * - Compact formatting toolbar with Codicon icons
 * - Table context menu for row/column operations
 * - Dropdown menus for headings, code blocks, and diagrams
 *
 * @module BubbleMenuView
 */

declare const __BUILD_TIME__: string;
const BUILD_TAG = `[MD4H ${__BUILD_TIME__}]`;

import { MERMAID_TEMPLATES } from './mermaidTemplates';
import { showTableInsertDialog } from './features/tableInsert';
import { showLinkDialog } from './features/linkDialog';
import { showImageInsertDialog } from './features/imageInsertDialog';
import { showColorSettingsPanel } from './features/colorSettings';
import type { Editor } from '@tiptap/core';
import { isTocVisible } from './features/tocOverlay';
import { updateGutterWidth } from './extensions/lineNumbers';
import { editorDisplaySettings } from './displaySettings';

// Store reference to refresh function so it can be called externally
let toolbarRefreshFunction: (() => void) | null = null;

/**
 * Normalize selection and create a code block
 *
 * Strips all formatting (marks) from the selection, extracts plain text,
 * and replaces it with a single code block node.
 *
 * @param editor - TipTap editor instance
 * @param language - Programming language for syntax highlighting
 */
function setCodeBlockNormalized(editor: Editor, language: string): void {
  const { state } = editor;
  const { from, to, empty } = state.selection;

  // If already in a code block, just update the language
  if (editor.isActive('codeBlock')) {
    editor.chain().focus().updateAttributes('codeBlock', { language }).run();
    return;
  }

  // For empty selection, insert an empty code block and position cursor inside it
  if (empty) {
    // Use setCodeBlock which properly creates a code block and positions cursor inside
    // This ensures editor.isActive('codeBlock') returns true immediately after
    editor.chain().focus().setCodeBlock({ language }).run();
    return;
  }

  // Extract plain text from selection (strips all marks)
  // Use empty string as block separator to keep content on same line within selection
  const plainText = state.doc.textBetween(from, to, '\n');

  // Replace selection with a single code block containing the plain text
  editor
    .chain()
    .focus()
    .deleteRange({ from, to })
    .insertContent({
      type: 'codeBlock',
      attrs: { language },
      content: plainText
        ? [
            {
              type: 'text',
              text: plainText,
            },
          ]
        : undefined,
    })
    .run();
}

function insertGitHubAlert(editor: Editor, alertType: string): void {
  editor.commands.focus();
  editor.commands.insertContent({
    type: 'githubAlert',
    attrs: { alertType },
    content: [{ type: 'paragraph' }],
  });

  // TipTap places the caret after the inserted alert block by default.
  editor.commands.setTextSelection(Math.max(1, editor.state.selection.from - 2));
  editor.commands.focus();
}

// Track editor focus state
let isEditorFocused = false;
let focusChangeListener: ((e: Event) => void) | null = null;
let activeDropdownOwnerEditor: Editor | null = null;

type ToolbarIcon = {
  name?: string;
  fallback: string;
  badge?: string;
};

type ToolbarActionButton = {
  type: 'button';
  label: string;
  title?: string;
  action: () => void;
  isActive?: () => boolean;
  className?: string;
  icon: ToolbarIcon;
  requiresFocus?: boolean; // Whether this button requires editor focus to be enabled
};

type ToolbarDropdownActionItem = {
  type?: 'action';
  label: string;
  title?: string;
  action: () => void;
  icon?: ToolbarIcon;
  isEnabled?: () => boolean; // Function to check if item should be enabled
  isActive?: () => boolean; // Function to check if item should appear highlighted (toggle)
  noClose?: boolean; // If true, clicking this item does not close the dropdown
};

type ToolbarDropdownInputItem = {
  type: 'input';
  label: string;
  title?: string;
  placeholder?: string;
  inputAriaLabel?: string;
  isEnabled?: () => boolean;
  onSubmit: (value: string) => void;
};

type ToolbarDropdownSeparatorItem = { type: 'separator'; label: string };

type ToolbarDropdownItem =
  | ToolbarDropdownActionItem
  | ToolbarDropdownInputItem
  | ToolbarDropdownSeparatorItem;

type ToolbarDropdown = {
  type: 'dropdown';
  label: string;
  title?: string;
  className?: string;
  icon: ToolbarIcon;
  items: ToolbarDropdownItem[];
  requiresFocus?: boolean; // Whether this dropdown requires editor focus to be enabled
  isActive?: () => boolean; // Function to determine if dropdown should appear active
};

type ToolbarSeparator = { type: 'separator' };
type ToolbarHeadingWidget = { type: 'heading-widget' };

type ToolbarItem = ToolbarActionButton | ToolbarDropdown | ToolbarSeparator | ToolbarHeadingWidget;

let codiconCheckScheduled = false;
let documentClickListenerRegistered = false;
let documentKeydownListenerRegistered = false;
let headingWidgetUpdater: (() => void) | null = null;
const FLOATING_MENU_VIEWPORT_PADDING = 8;
const FLOATING_MENU_VERTICAL_OFFSET = 4;

function ensureCodiconFont() {
  if (codiconCheckScheduled) return;
  codiconCheckScheduled = true;

  if (!('fonts' in document) || typeof document.fonts?.load !== 'function') {
    document.documentElement.classList.add('codicon-fallback');
    return;
  }

  document.fonts
    .load('16px "codicon"')
    .then(() => {
      const available = document.fonts.check('16px "codicon"');
      if (!available) {
        document.documentElement.classList.add('codicon-fallback');
      } else {
        document.documentElement.classList.remove('codicon-fallback');
      }
    })
    .catch(() => {
      document.documentElement.classList.add('codicon-fallback');
    });
}

function createIconElement(icon: ToolbarIcon | undefined, baseClass: string): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = baseClass;
  span.setAttribute('aria-hidden', 'true');

  if (!icon) return span;

  if (icon.name) {
    span.classList.add('codicon', `codicon-${icon.name}`, 'uses-codicon');
  } else if (icon.fallback) {
    span.textContent = icon.fallback;
  }

  if (icon.fallback) {
    span.setAttribute('data-fallback', icon.fallback);
    if (!icon.name) {
      span.textContent = icon.fallback;
    }
  }

  if (icon.badge) {
    span.classList.add('heading-icon');
    span.setAttribute('data-badge', icon.badge);
  }

  return span;
}

function isToolbarDropdownSeparatorItem(
  item: ToolbarDropdownItem
): item is ToolbarDropdownSeparatorItem {
  return item.type === 'separator';
}

function isToolbarDropdownInputItem(item: ToolbarDropdownItem): item is ToolbarDropdownInputItem {
  return item.type === 'input';
}

function isToolbarDropdownActionItem(item: ToolbarDropdownItem): item is ToolbarDropdownActionItem {
  return !item.type || item.type === 'action';
}

function closeAllDropdowns(options: { blurActiveElement?: boolean; focusEditor?: boolean } = {}): boolean {
  const hadOpenDropdowns = (
    Array.from(document.querySelectorAll('.toolbar-dropdown-menu')).some(
      menu => (menu as HTMLElement).style.display === 'block'
    )
    || Array.from(document.querySelectorAll('.toolbar-overflow-menu')).some(menu =>
      (menu as HTMLElement).classList.contains('open')
    )
    || Array.from(document.querySelectorAll('.toolbar-overflow-submenu')).some(
      menu => (menu as HTMLElement).style.display === 'block'
    )
    || Array.from(document.querySelectorAll('.toolbar-dropdown button')).some(
      btn => (btn as HTMLElement).getAttribute('aria-expanded') === 'true'
    )
    || Array.from(document.querySelectorAll('.toolbar-overflow-trigger')).some(
      btn => (btn as HTMLElement).getAttribute('aria-expanded') === 'true'
    )
  );

  document.querySelectorAll('.toolbar-dropdown-menu').forEach(menu => {
    (menu as HTMLElement).style.display = 'none';
  });
  document.querySelectorAll('.toolbar-overflow-menu.open').forEach(menu => {
    (menu as HTMLElement).classList.remove('open');
  });
  document.querySelectorAll('.toolbar-overflow-submenu').forEach(s => {
    (s as HTMLElement).style.display = 'none';
  });
  document.querySelectorAll('.toolbar-dropdown button[aria-expanded="true"]').forEach(btn => {
    (btn as HTMLElement).setAttribute('aria-expanded', 'false');
  });
  document.querySelectorAll('.toolbar-overflow-trigger[aria-expanded="true"]').forEach(btn => {
    (btn as HTMLElement).setAttribute('aria-expanded', 'false');
  });

  if (options.blurActiveElement) {
    const activeElement = document.activeElement as HTMLElement | null;
    if (
      activeElement
      && (
        activeElement.closest('.formatting-toolbar')
        || activeElement.closest('.toolbar-dropdown-menu')
        || activeElement.closest('.toolbar-overflow-menu')
        || activeElement.closest('.toolbar-overflow-submenu')
      )
    ) {
      activeElement.blur();
    }
  }

  const editorToFocus = options.focusEditor && hadOpenDropdowns ? activeDropdownOwnerEditor : null;
  activeDropdownOwnerEditor = null;

  if (editorToFocus) {
    try {
      editorToFocus.commands.focus();
      window.dispatchEvent(new CustomEvent('editorFocusChange', { detail: { focused: true } }));
    } catch {
      // ignore focus restoration failures
    }
  }

  return hadOpenDropdowns;
}

function positionFloatingMenu(trigger: HTMLElement, menu: HTMLElement): void {
  const triggerRect = trigger.getBoundingClientRect();

  menu.style.top = `${triggerRect.bottom + FLOATING_MENU_VERTICAL_OFFSET}px`;
  menu.style.right = 'auto';
  menu.style.maxWidth = `calc(100vw - ${FLOATING_MENU_VIEWPORT_PADDING * 2}px)`;
  menu.style.visibility = 'hidden';
  menu.style.display = 'block';

  const measuredRect = menu.getBoundingClientRect();
  const measuredWidth = measuredRect.width || menu.offsetWidth || 0;
  const maxLeft = Math.max(
    FLOATING_MENU_VIEWPORT_PADDING,
    window.innerWidth - measuredWidth - FLOATING_MENU_VIEWPORT_PADDING
  );
  const left = Math.min(Math.max(FLOATING_MENU_VIEWPORT_PADDING, triggerRect.left), maxLeft);

  menu.style.left = `${Math.round(left)}px`;
  menu.style.visibility = '';
}

function isElementVisible(element: HTMLElement | null): boolean {
  if (!element || !element.isConnected) {
    return false;
  }

  let current: HTMLElement | null = element;
  while (current) {
    const styles = window.getComputedStyle(current);
    if (
      current.style.display === 'none'
      || styles.display === 'none'
      || styles.visibility === 'hidden'
      || current.hidden
    ) {
      return false;
    }
    current = current.parentElement;
  }

  return true;
}

function getVisibleGotoLineInput(): HTMLInputElement | null {
  const inputs = Array.from(document.querySelectorAll('.toolbar-dropdown-input')) as HTMLInputElement[];
  return inputs.find(input => isElementVisible(input)) ?? null;
}

function focusGotoLineInput(input: HTMLInputElement, selectText = true): void {
  try {
    input.focus({ preventScroll: true });
  } catch {
    input.focus();
  }
  if (selectText) {
    input.select();
  }
}

export function setVisibleGotoLineInputValue(value: string, selectText = true): boolean {
  const input = getVisibleGotoLineInput();
  if (!input) {
    return false;
  }
  input.value = value;
  focusGotoLineInput(input, selectText);
  return true;
}

export function openGotoLineInput(): boolean {
  const existingInput = getVisibleGotoLineInput();
  if (existingInput) {
    focusGotoLineInput(existingInput);
    return true;
  }

  const goButton = Array.from(
    document.querySelectorAll('.toolbar-dropdown > .toolbar-button[aria-label="Navigate insertion point history"]')
  ).find(button => isElementVisible(button as HTMLElement)) as HTMLButtonElement | undefined;

  if (goButton) {
    goButton.click();
    const openedInput = getVisibleGotoLineInput();
    if (openedInput) {
      focusGotoLineInput(openedInput);
      return true;
    }
  }

  const overflowTrigger = document.querySelector('.toolbar-overflow-trigger') as HTMLButtonElement | null;
  if (overflowTrigger && isElementVisible(overflowTrigger)) {
    if (overflowTrigger.getAttribute('aria-expanded') !== 'true') {
      overflowTrigger.click();
    }

    const goOverflowButton = Array.from(document.querySelectorAll('.toolbar-overflow-row-btn')).find(
      button => (button as HTMLButtonElement).title === 'Navigate insertion point history'
    ) as HTMLButtonElement | undefined;

    if (goOverflowButton && isElementVisible(goOverflowButton)) {
      goOverflowButton.click();
      const openedInput = getVisibleGotoLineInput();
      if (openedInput) {
        focusGotoLineInput(openedInput);
        return true;
      }
    }
  }

  return false;
}

function isToolbarMenuTarget(target: EventTarget | null): boolean {
  return Boolean(
    target instanceof HTMLElement
    && (
      target.closest('.toolbar-dropdown')
      || target.closest('.toolbar-dropdown-menu')
      || target.closest('.toolbar-overflow-menu')
      || target.closest('.toolbar-overflow-submenu')
    )
  );
}

function createDropdownInputRow(
  item: ToolbarDropdownInputItem
): { container: HTMLDivElement; input: HTMLInputElement } {
  const container = document.createElement('div');
  container.className = 'toolbar-dropdown-input-row';
  container.title = item.title || item.label;

  const label = document.createElement('label');
  label.className = 'toolbar-dropdown-input-label';
  label.textContent = item.label;

  const input = document.createElement('input');
  input.type = 'text';
  input.inputMode = 'numeric';
  input.className = 'toolbar-dropdown-input';
  input.placeholder = item.placeholder || 'Line';
  input.spellcheck = false;
  input.autocomplete = 'off';
  input.setAttribute('aria-label', item.inputAriaLabel || item.title || item.label);

  const stopMenuClose = (e: Event) => {
    e.stopPropagation();
  };

  container.addEventListener('mousedown', stopMenuClose);
  container.addEventListener('click', stopMenuClose);
  input.addEventListener('mousedown', stopMenuClose);
  input.addEventListener('click', stopMenuClose);

  input.addEventListener('input', () => {
    input.value = input.value.replace(/[^\d]/g, '');
  });

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      item.onSubmit(input.value);
      try {
        input.focus({ preventScroll: true });
      } catch {
        input.focus();
      }
      input.select();
      return;
    }

    if (e.key !== 'Escape') {
      e.stopPropagation();
    }
  });

  label.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    input.focus();
    input.select();
  });

  container.append(label, input);
  return { container, input };
}

/**
 * Update toolbar active states (can be called from outside)
 */
export function updateToolbarStates() {
  if (toolbarRefreshFunction) {
    toolbarRefreshFunction();
  }
}

/**
 * Create compact formatting toolbar with clean, minimal design.
 *
 * @param editor - TipTap editor instance
 * @returns HTMLElement containing the toolbar
 */
export function createFormattingToolbar(
  editor: Editor,
  options?: { filter?: 'formatting-only' }
): HTMLElement {
  ensureCodiconFont();

  const toolbar = document.createElement('div');
  toolbar.className = 'formatting-toolbar';

  // Inner container for all items — enables overflow detection
  const itemsContainer = document.createElement('div');
  itemsContainer.className = 'toolbar-items';

  const isMac = navigator.platform.toLowerCase().includes('mac');
  const modKeyLabel = isMac ? 'Cmd' : 'Ctrl';

  let buttons: ToolbarItem[] = [
    {
      type: 'button',
      label: 'Find',
      title: `Find in document (${modKeyLabel}+F)`,
      icon: { name: 'search', fallback: '🔍' },
      action: () => {
        window.dispatchEvent(new CustomEvent('openFind'));
      },
      isActive: () => false,
      className: 'find-button',
    },
    {
      type: 'dropdown',
      label: 'Go',
      title: 'Navigate insertion point history',
      icon: { name: 'history', fallback: '↺' },
      items: [
        {
          label: 'Go Back (Ctrl+Alt+Left)',
          action: () => {
            window.dispatchEvent(new CustomEvent('navigateBack'));
          },
        },
        {
          label: 'Go Forward (Ctrl+Alt+Right)',
          action: () => {
            window.dispatchEvent(new CustomEvent('navigateForward'));
          },
        },
        { type: 'separator', label: '────' },
        {
          type: 'input',
          label: 'Goto Line',
          title: 'Go to markdown source line (Ctrl+Alt+G)',
          placeholder: 'Line number',
          inputAriaLabel: 'Go to markdown source line number',
          onSubmit: value => {
            const lineNumber = Number.parseInt(value.trim(), 10);
            if (!Number.isFinite(lineNumber)) {
              return;
            }
            window.dispatchEvent(new CustomEvent('gotoLine', { detail: { lineNumber } }));
          },
        },
      ],
    },
    {
      type: 'button',
      label: 'Navigation',
      title: 'Show Navigation Pane',
      icon: { name: 'list-tree', fallback: 'TOC' },
      action: () => {
        window.dispatchEvent(new CustomEvent('toggleTocOutline'));
      },
      isActive: () => isTocVisible(),
      className: 'toc-button',
    },
    {
      type: 'button',
      label: 'Source',
      title: 'Toggle source view (split)',
      icon: { name: 'split-horizontal', fallback: '</>' },
      action: () => {
        window.dispatchEvent(new CustomEvent('openSourceView'));
      },
      isActive: () => (window as any).isSourceVisible?.() ?? false,
      className: 'source-button',
    },
    { type: 'separator' },
    {
      type: 'button',
      label: 'Copy MD',
      title: 'Copy selection as Markdown',
      icon: { name: 'copy', fallback: 'Copy' },
      action: () => {
        window.dispatchEvent(new CustomEvent('copyAsMarkdown'));
      },
      isActive: () => false,
      className: 'copy-button',
    },
    {
      type: 'dropdown',
      label: 'Export',
      title: 'Export document',
      icon: { name: 'export', fallback: 'Export' },
      items: [
        {
          label: 'Export as PDF',
          action: () => {
            window.dispatchEvent(new CustomEvent('exportDocument', { detail: { format: 'pdf' } }));
          },
        },
        {
          label: 'Export as Word',
          action: () => {
            window.dispatchEvent(new CustomEvent('exportDocument', { detail: { format: 'docx' } }));
          },
        },
      ],
    },
    { type: 'separator' },
    {
      type: 'button',
      label: 'Bold',
      title: `Toggle bold (${modKeyLabel}+B)`,
      icon: { name: 'bold', fallback: 'B' },
      action: () => editor.chain().focus().toggleBold().run(),
      isActive: () => editor.isActive('bold'),
      className: 'bold',
      requiresFocus: true,
    },
    {
      type: 'button',
      label: 'Italic',
      title: `Toggle italic (${modKeyLabel}+I)`,
      icon: { name: 'italic', fallback: 'I' },
      action: () => editor.chain().focus().toggleItalic().run(),
      isActive: () => editor.isActive('italic'),
      className: 'italic',
      requiresFocus: true,
    },
    {
      type: 'button',
      label: 'Strikethrough',
      title: 'Toggle strikethrough',
      icon: { name: 'strikethrough', fallback: 'S' },
      action: () => editor.chain().focus().toggleStrike().run(),
      isActive: () => editor.isActive('strike'),
      className: 'strike',
      requiresFocus: true,
    },
    {
      type: 'button',
      label: 'Inline code',
      title: 'Toggle inline code',
      icon: { name: 'code', fallback: '<>' },
      action: () => editor.chain().focus().toggleCode().run(),
      isActive: () => editor.isActive('code'),
      className: 'code-icon',
      requiresFocus: true,
    },
    { type: 'separator' },
    { type: 'heading-widget' },
    { type: 'separator' },
    {
      type: 'button',
      label: 'Bullet list',
      title: 'Toggle bullet list',
      icon: { name: 'list-unordered', fallback: '•' },
      action: () => editor.chain().focus().toggleBulletList().run(),
      isActive: () => editor.isActive('bulletList'),
      requiresFocus: true,
    },
    {
      type: 'button',
      label: 'Numbered list',
      title: 'Toggle numbered list',
      icon: { name: 'list-ordered', fallback: '1.' },
      action: () => editor.chain().focus().toggleOrderedList().run(),
      isActive: () => editor.isActive('orderedList'),
      requiresFocus: true,
    },
    {
      type: 'button',
      label: 'Task list',
      title: 'Toggle task list (checkboxes)',
      icon: { name: 'tasklist', fallback: '☐' },
      action: () => editor.chain().focus().toggleTaskList().run(),
      isActive: () => editor.isActive('taskList'),
      requiresFocus: true,
    },
    { type: 'separator' },
    {
      type: 'dropdown',
      label: 'Table',
      title: 'Insert and edit table',
      icon: { name: 'table', fallback: 'Tbl' },
      requiresFocus: true,
      isActive: () => editor.isActive('table'),
      items: [
        {
          label: 'Insert Table',
          icon: { name: 'add', fallback: '+' },
          action: () => showTableInsertDialog(editor),
          isEnabled: () => !editor.isActive('table'), // Only enabled when NOT in a table
        },
        {
          label: 'Add Column Before',
          icon: { name: 'arrow-left', fallback: '←' },
          action: () => editor.chain().focus().addColumnBefore().run(),
          isEnabled: () => editor.isActive('table'), // Only enabled when in a table
        },
        {
          label: 'Add Column After',
          icon: { name: 'arrow-right', fallback: '→' },
          action: () => editor.chain().focus().addColumnAfter().run(),
          isEnabled: () => editor.isActive('table'),
        },
        {
          label: 'Delete Column',
          icon: { name: 'remove', fallback: '×' },
          action: () => editor.chain().focus().deleteColumn().run(),
          isEnabled: () => editor.isActive('table'),
        },
        {
          label: 'Add Row Before',
          icon: { name: 'arrow-up', fallback: '↑' },
          action: () => editor.chain().focus().addRowBefore().run(),
          isEnabled: () => editor.isActive('table'),
        },
        {
          label: 'Add Row After',
          icon: { name: 'arrow-down', fallback: '↓' },
          action: () => editor.chain().focus().addRowAfter().run(),
          isEnabled: () => editor.isActive('table'),
        },
        {
          label: 'Delete Row',
          icon: { name: 'trash', fallback: '–' },
          action: () => editor.chain().focus().deleteRow().run(),
          isEnabled: () => editor.isActive('table'),
        },
        {
          label: 'Delete Table',
          icon: { name: 'trash', fallback: '✕' },
          action: () => editor.chain().focus().deleteTable().run(),
          isEnabled: () => editor.isActive('table'),
        },
      ],
    },
    {
      type: 'button',
      label: 'Quote',
      title: 'Toggle block quote',
      icon: { name: 'quote', fallback: '"' },
      action: () => editor.chain().focus().toggleBlockquote().run(),
      isActive: () => editor.isActive('blockquote'),
      requiresFocus: true,
    },
    {
      type: 'dropdown',
      label: 'Alert',
      title: 'Insert GitHub alert',
      icon: { name: 'info', fallback: '!' },
      requiresFocus: true,
      isActive: () => editor.isActive('githubAlert'),
      items: [
        {
          label: ' Note',
          icon: { name: 'info', fallback: 'ℹ' },
          action: () => insertGitHubAlert(editor, 'NOTE'),
        },
        {
          label: ' Tip',
          icon: { name: 'lightbulb', fallback: '💡' },
          action: () => insertGitHubAlert(editor, 'TIP'),
        },
        {
          label: ' Important',
          icon: { name: 'megaphone', fallback: '📢' },
          action: () => insertGitHubAlert(editor, 'IMPORTANT'),
        },
        {
          label: ' Warning',
          icon: { name: 'warning', fallback: '⚠' },
          action: () => insertGitHubAlert(editor, 'WARNING'),
        },
        {
          label: ' Caution',
          icon: { name: 'error', fallback: '🛑' },
          action: () => insertGitHubAlert(editor, 'CAUTION'),
        },
        {
          label: '──────────────────',
          action: () => {},
          isEnabled: () => false,
        },
        {
          label: ' Comment (editor only)',
          icon: { name: 'comment', fallback: '💬' },
          action: () => insertGitHubAlert(editor, 'COMMENT'),
        },
      ],
    },
    {
      type: 'dropdown',
      label: 'Code block',
      title: 'Insert code block',
      icon: { name: 'code', fallback: '{}' },
      requiresFocus: true,
      isActive: () => editor.isActive('codeBlock'),
      items: [
        {
          label: 'Plain Text',
          action: () => setCodeBlockNormalized(editor, 'plaintext'),
        },
        {
          label: 'JavaScript',
          action: () => setCodeBlockNormalized(editor, 'javascript'),
        },
        {
          label: 'TypeScript',
          action: () => setCodeBlockNormalized(editor, 'typescript'),
        },
        {
          label: 'Python',
          action: () => setCodeBlockNormalized(editor, 'python'),
        },
        {
          label: 'Bash',
          action: () => setCodeBlockNormalized(editor, 'bash'),
        },
        {
          label: 'JSON',
          action: () => setCodeBlockNormalized(editor, 'json'),
        },
        {
          label: 'Markdown',
          action: () => setCodeBlockNormalized(editor, 'markdown'),
        },
        {
          label: 'CSS',
          action: () => setCodeBlockNormalized(editor, 'css'),
        },
        {
          label: 'HTML',
          action: () => setCodeBlockNormalized(editor, 'html'),
        },
        {
          label: 'SQL',
          action: () => setCodeBlockNormalized(editor, 'sql'),
        },
        {
          label: 'Java',
          action: () => setCodeBlockNormalized(editor, 'java'),
        },
        {
          label: 'Go',
          action: () => setCodeBlockNormalized(editor, 'go'),
        },
        {
          label: 'Rust',
          action: () => setCodeBlockNormalized(editor, 'rust'),
        },
      ],
    },
    {
      type: 'button',
      label: 'Link',
      title: `Insert/edit link (${modKeyLabel}+K)`,
      icon: { name: 'link', fallback: '🔗' },
      action: () => showLinkDialog(editor),
      isActive: () => editor.isActive('link'),
      requiresFocus: true,
    },
    {
      type: 'button',
      label: 'Image',
      title: 'Insert image',
      icon: { name: 'file-media', fallback: '📷' },
      action: () => {
        // Get vscode API from window (set in editor.ts)
        const vscodeApi = window.vscode;
        if (vscodeApi && editor) {
          showImageInsertDialog(editor, vscodeApi).catch(error => {
            console.error(`${BUILD_TAG} Failed to show image insert dialog:`, error);
          });
        } else {
          console.warn(
            `${BUILD_TAG} Cannot show image insert dialog: vscode API or editor not available`
          );
        }
      },
      requiresFocus: false, // Can insert images even when not focused
    },
    {
      type: 'dropdown',
      label: 'Mermaid',
      title: 'Insert Mermaid diagram',
      icon: { name: 'pie-chart', fallback: 'Mer' },
      requiresFocus: true,
      items: MERMAID_TEMPLATES.map(template => ({
        label: template.label,
        action: () => {
          editor
            .chain()
            .focus()
            .insertContent(`\`\`\`mermaid\n${template.diagram}\n\`\`\``, {
              contentType: 'markdown',
            })
            .run();
        },
      })),
    },
    { type: 'separator' },
    {
      type: 'dropdown',
      label: 'Settings',
      title: 'Display and editor settings',
      icon: { name: 'gear', fallback: '⚙' },
      className: 'settings-dropdown',
      items: [
        {
          label: ' Heading Labels',
          title: 'Show H1-H6 labels in the document gutter beside headings.',
          action: () => {
            const next = !editorDisplaySettings.showHeadingGutter;
            editorDisplaySettings.showHeadingGutter = next;
            const editorEl = document.querySelector('.markdown-editor') as HTMLElement | null;
            if (editorEl) editorEl.classList.toggle('hide-heading-gutter', !next);
            const vscodeApi = (window as any).vscode;
            if (vscodeApi) vscodeApi.postMessage({ type: 'updateSetting', key: 'markdownForHumans.showHeadingGutter', value: next });
            updateGutterWidth();
          },
          isActive: () => editorDisplaySettings.showHeadingGutter,
          noClose: true,
        },
        {
          label: ' Document Line Numbers',
          title:
            'Show markdown source line numbers in the document gutter. Clicking a number selects that source line.',
          action: () => {
            const next = !editorDisplaySettings.showDocumentLineNumbers;
            editorDisplaySettings.showDocumentLineNumbers = next;
            const editorEl = document.querySelector('.markdown-editor') as HTMLElement | null;
            if (editorEl) editorEl.classList.toggle('show-line-numbers', next);
            const vscodeApi = (window as any).vscode;
            if (vscodeApi) {
              vscodeApi.postMessage({
                type: 'updateSetting',
                key: 'markdownForHumans.showDocumentLineNumbers',
                value: next,
              });
            }
            updateGutterWidth();
          },
          isActive: () => editorDisplaySettings.showDocumentLineNumbers,
          noClose: true,
        },
        {
          label: ' Navigation Line Numbers',
          title:
            'Show source line numbers before headings in the Navigation pane and Explorer outline.',
          action: () => {
            const next = !editorDisplaySettings.showNavigationLineNumbers;
            editorDisplaySettings.showNavigationLineNumbers = next;
            const vscodeApi = (window as any).vscode;
            if (vscodeApi) {
              vscodeApi.postMessage({
                type: 'updateSetting',
                key: 'markdownForHumans.showNavigationLineNumbers',
                value: next,
              });
            }
          },
          isActive: () => editorDisplaySettings.showNavigationLineNumbers,
          noClose: true,
        },
        {
          label: '──────────────────',
          action: () => {},
          isEnabled: () => false,
        },
        {
          label: ' Text Colors',
          title:
            'Adjust heading, bold, italic, and gutter-label colors used in the editor.',
          icon: { name: 'symbol-color', fallback: '🎨' },
          action: () => {
            showColorSettingsPanel();
          },
        },
        {
          label: '──────────────────',
          action: () => {},
          isEnabled: () => false,
        },
        {
          label: ' System Settings',
          title: 'Open the full Markdown for Humans settings in VS Code.',
          icon: { name: 'settings-gear', fallback: '⚙' },
          action: () => {
            window.dispatchEvent(new CustomEvent('openExtensionSettings'));
          },
        },
      ],
    },
  ];

  // When filter is 'formatting-only', keep only Bold through Mermaid (inclusive)
  if (options?.filter === 'formatting-only') {
    const boldIdx = buttons.findIndex(
      b => b.type === 'button' && (b as ToolbarActionButton).className === 'bold'
    );
    const mermaidIdx = buttons.findIndex(
      b => b.type === 'dropdown' && (b as ToolbarDropdown).label === 'Mermaid'
    );
    if (boldIdx >= 0 && mermaidIdx >= 0) {
      buttons = buttons.slice(boldIdx, mermaidIdx + 1);
      // Remove leading/trailing separators
      while (buttons.length > 0 && buttons[0].type === 'separator') buttons.shift();
      while (buttons.length > 0 && buttons[buttons.length - 1].type === 'separator') buttons.pop();
    }
  }

  const actionButtons: Array<{ config: ToolbarActionButton; element: HTMLButtonElement }> = [];
  const dropdownButtons: Array<{ config: ToolbarDropdown; element: HTMLButtonElement }> = [];
  const dropdownItems: Array<{ config: ToolbarDropdownActionItem; element: HTMLButtonElement }> = [];
  const dropdownInputs: Array<{ config: ToolbarDropdownInputItem; element: HTMLInputElement }> = [];
  // All fixed-position menus appended to body (to escape sticky/transform stacking contexts)
  const bodyMenus: HTMLElement[] = [];

  // Overflow item state tracking (populated by buildOverflowMenu)
  const overflowActionItems: Array<{ config: ToolbarActionButton; element: HTMLButtonElement }> = [];
  const overflowDropdownItems: Array<{ config: ToolbarDropdownActionItem; element: HTMLButtonElement }> = [];
  const overflowDropdownInputs: Array<{ config: ToolbarDropdownInputItem; element: HTMLInputElement }> = [];

  const refreshActiveStates = () => {
    // Update action buttons active and enabled states
    actionButtons.forEach(({ config, element }) => {
      const active = config.isActive ? config.isActive() : false;
      element.classList.toggle('active', Boolean(active));
      element.setAttribute('aria-pressed', String(Boolean(active)));

      // Check if button requires focus
      const enabled = config.requiresFocus ? isEditorFocused : true;
      element.disabled = !enabled;
      element.classList.toggle('disabled', !enabled);
      element.setAttribute('aria-disabled', String(!enabled));

      // Update title to explain why disabled
      if (!enabled && config.requiresFocus) {
        element.title = (config.title || config.label) + ' (Click in document to edit)';
      } else {
        element.title = config.title || config.label;
      }
    });

    // Update dropdown buttons enabled states
    dropdownButtons.forEach(({ config, element }) => {
      const active = config.isActive ? config.isActive() : false;
      element.classList.toggle('active', Boolean(active));
      element.setAttribute('aria-pressed', String(Boolean(active)));

      const enabled = config.requiresFocus ? isEditorFocused : true;
      element.disabled = !enabled;
      element.classList.toggle('disabled', !enabled);
      element.setAttribute('aria-disabled', String(!enabled));

      // Update title to explain why disabled
      if (!enabled && config.requiresFocus) {
        element.title = (config.title || config.label) + ' (Click in document to edit)';
      } else {
        element.title = config.title || config.label;
      }
    });

    // Update dropdown item disabled and active states
    dropdownItems.forEach(({ config, element }) => {
      const enabled = config.isEnabled ? config.isEnabled() : true;
      element.disabled = !enabled;
      element.classList.toggle('disabled', !enabled);
      element.setAttribute('aria-disabled', String(!enabled));
      if (config.isActive) {
        const active = config.isActive();
        // Don't highlight the whole item — only update the checkbox
        element.classList.remove('active');
        const cb = element.querySelector('.toolbar-dropdown-checkbox');
        if (cb) {
          cb.textContent = active ? '☑' : '☐';
          cb.classList.toggle('checked', active);
        }
      }
    });

    dropdownInputs.forEach(({ config, element }) => {
      const enabled = config.isEnabled ? config.isEnabled() : true;
      element.disabled = !enabled;
      element.setAttribute('aria-disabled', String(!enabled));
    });

    // Sync overflow action button states
    overflowActionItems.forEach(({ config, element }) => {
      const active = config.isActive ? config.isActive() : false;
      element.classList.toggle('active', Boolean(active));
      const enabled = config.requiresFocus ? isEditorFocused : true;
      element.disabled = !enabled;
      element.classList.toggle('disabled', !enabled);
    });

    // Sync overflow dropdown item states
    overflowDropdownItems.forEach(({ config, element }) => {
      const enabled = config.isEnabled ? config.isEnabled() : true;
      element.disabled = !enabled;
      element.classList.toggle('disabled', !enabled);
      if (config.isActive) {
        const active = config.isActive();
        const cb = element.querySelector('.toolbar-dropdown-checkbox');
        if (cb) {
          cb.textContent = active ? '☑' : '☐';
          cb.classList.toggle('checked', active);
        }
      }
    });

    overflowDropdownInputs.forEach(({ config, element }) => {
      const enabled = config.isEnabled ? config.isEnabled() : true;
      element.disabled = !enabled;
      element.setAttribute('aria-disabled', String(!enabled));
    });

    // Update heading widget
    headingWidgetUpdater?.();
  };

  buttons.forEach(btn => {
    if (btn.type === 'heading-widget') {
      // Level model: 1-6 = heading level, 7 = paragraph
      // displayedLevel persists when cursor leaves a heading/paragraph
      let displayedLevel = 1;

      const getCurrentLevel = (): number => {
        for (let l = 1; l <= 6; l++) {
          if (editor.isActive('heading', { level: l as any })) return l;
        }
        if (editor.isActive('paragraph')) return 7;
        return 0; // other node type (code block, etc.)
      };

      const applyLevel = (level: number) => {
        if (level === 7) {
          editor.chain().focus().setParagraph().run();
        } else {
          editor.chain().focus().setHeading({ level: level as any }).run();
        }
      };

      // Wrapper — single child of itemsContainer
      const headingWidget = document.createElement('div');
      headingWidget.className = 'toolbar-heading-widget';

      // Button 1: Hx/P — shows/applies current displayed level
      const hxBtn = document.createElement('button');
      hxBtn.type = 'button';
      hxBtn.className = 'toolbar-button toolbar-heading-hx';

      // Button 2: ↑ promote (smaller number = bigger heading; P→H6)
      const hUpBtn = document.createElement('button');
      hUpBtn.type = 'button';
      hUpBtn.className = 'toolbar-button';
      hUpBtn.title = 'Larger heading';
      hUpBtn.setAttribute('aria-label', 'Larger heading');
      hUpBtn.append(createIconElement({ name: 'arrow-up', fallback: '↑' }, 'toolbar-icon'));

      // Button 3: ↓ demote (larger number or P; H6→P)
      const hDownBtn = document.createElement('button');
      hDownBtn.type = 'button';
      hDownBtn.className = 'toolbar-button';
      hDownBtn.title = 'Smaller heading';
      hDownBtn.setAttribute('aria-label', 'Smaller heading');
      hDownBtn.append(createIconElement({ name: 'arrow-down', fallback: '↓' }, 'toolbar-icon'));

      // Button 4: dropdown H1-H6 + Paragraph
      const hdropContainer = document.createElement('div');
      hdropContainer.className = 'toolbar-dropdown';
      const hdropBtn = document.createElement('button');
      hdropBtn.type = 'button';
      hdropBtn.className = 'toolbar-button';
      hdropBtn.title = 'Heading level';
      hdropBtn.setAttribute('aria-label', 'Heading level');
      hdropBtn.setAttribute('aria-haspopup', 'true');
      hdropBtn.setAttribute('aria-expanded', 'false');
      hdropBtn.append(createIconElement({ name: 'text-size', fallback: 'H▾' }, 'toolbar-icon'));

      const hdropMenu = document.createElement('div');
      hdropMenu.className = 'toolbar-dropdown-menu';
      [1, 2, 3, 4, 5, 6].forEach(level => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'toolbar-dropdown-item';
        item.textContent = `Heading ${level} (H${level})`;
        item.onclick = e => {
          e.preventDefault();
          e.stopPropagation();
          applyLevel(level);
          hdropMenu.style.display = 'none';
          hdropBtn.setAttribute('aria-expanded', 'false');
          refreshActiveStates();
        };
        hdropMenu.appendChild(item);
      });
      // Separator then Paragraph
      const hdropSep = document.createElement('hr');
      hdropSep.className = 'toolbar-dropdown-sep';
      hdropMenu.appendChild(hdropSep);
      const pItem = document.createElement('button');
      pItem.type = 'button';
      pItem.className = 'toolbar-dropdown-item';
      pItem.textContent = 'Paragraph (P)';
      pItem.onclick = e => {
        e.preventDefault();
        e.stopPropagation();
        applyLevel(7);
        hdropMenu.style.display = 'none';
        hdropBtn.setAttribute('aria-expanded', 'false');
        refreshActiveStates();
      };
      hdropMenu.appendChild(pItem);

      hdropBtn.onclick = e => {
        e.preventDefault();
        e.stopPropagation();
        if (hdropBtn.disabled) return;
        const isVisible = hdropMenu.style.display === 'block';
        closeAllDropdowns();
        if (!isVisible) {
          activeDropdownOwnerEditor = editor;
          positionFloatingMenu(hdropBtn, hdropMenu);
          hdropBtn.setAttribute('aria-expanded', 'true');
        } else {
          hdropBtn.setAttribute('aria-expanded', 'false');
        }
      };

      hdropContainer.append(hdropBtn);
      document.body.appendChild(hdropMenu);
      bodyMenus.push(hdropMenu);

      // Hx/P click: apply displayed level
      hxBtn.onclick = e => {
        e.preventDefault();
        applyLevel(displayedLevel);
        refreshActiveStates();
      };

      // ↑ click: promote (smaller level number, wraps H1→P)
      hUpBtn.onclick = e => {
        e.preventDefault();
        const cur = getCurrentLevel();
        const base = cur > 0 ? cur : displayedLevel;
        const next = base <= 1 ? 7 : base - 1;
        applyLevel(next);
        refreshActiveStates();
      };

      // ↓ click: demote (larger level number, wraps P→H1)
      hDownBtn.onclick = e => {
        e.preventDefault();
        const cur = getCurrentLevel();
        const base = cur > 0 ? cur : displayedLevel;
        const next = base >= 7 ? 1 : base + 1;
        applyLevel(next);
        refreshActiveStates();
      };

      headingWidget.append(hxBtn, hUpBtn, hDownBtn, hdropContainer);
      itemsContainer.appendChild(headingWidget);

      // updateHeadingWidget — called from refreshActiveStates via headingWidgetUpdater
      const updateHeadingWidget = () => {
        const currentLevel = getCurrentLevel();
        const inKnownLevel = currentLevel > 0;
        if (inKnownLevel) displayedLevel = currentLevel;

        const label = displayedLevel === 7 ? 'P' : `H${displayedLevel}`;

        hxBtn.innerHTML = '';
        hxBtn.append(createIconElement({ fallback: label }, 'toolbar-icon'));
        hxBtn.title = displayedLevel === 7 ? 'Paragraph' : `Heading ${displayedLevel}`;
        hxBtn.setAttribute('aria-label', hxBtn.title);
        hxBtn.classList.toggle('active', inKnownLevel);

        const focused = isEditorFocused;

        // ↑↓ only disabled when editor not focused (circular cycling)
        hUpBtn.disabled = !focused;
        hUpBtn.classList.toggle('disabled', !focused);

        hDownBtn.disabled = !focused;
        hDownBtn.classList.toggle('disabled', !focused);

        hxBtn.disabled = !focused;
        hxBtn.classList.toggle('disabled', !focused);

        hdropBtn.disabled = !focused;
        hdropBtn.classList.toggle('disabled', !focused);
      };

      headingWidgetUpdater = updateHeadingWidget;
      return;
    }

    if (btn.type === 'separator') {
      const separator = document.createElement('div');
      separator.className = 'toolbar-separator';
      itemsContainer.appendChild(separator);
      return;
    }

    if (btn.type === 'dropdown') {
      const container = document.createElement('div');
      container.className = 'toolbar-dropdown';

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'toolbar-button' + (btn.className ? ` ${btn.className}` : '');
      button.title = btn.title || btn.label;
      button.setAttribute('aria-label', btn.title || btn.label);
      button.setAttribute('aria-haspopup', 'true');
      button.setAttribute('aria-expanded', 'false');

      const icon = createIconElement(btn.icon, 'toolbar-icon');

      const menu = document.createElement('div');
      menu.className = 'toolbar-dropdown-menu';
      menu.style.display = 'none';

      btn.items.forEach(item => {
        if (isToolbarDropdownInputItem(item)) {
          const { container: inputRow, input } = createDropdownInputRow(item);
          dropdownInputs.push({ config: item, element: input });
          menu.appendChild(inputRow);
          return;
        }

        if (isToolbarDropdownSeparatorItem(item)) {
          const hr = document.createElement('hr');
          hr.className = 'toolbar-dropdown-sep';
          menu.appendChild(hr);
          return;
        }

        // Render separators and custom controls
        if (/^─+$/.test(item.label.trim())) {
          const hr = document.createElement('hr');
          hr.className = 'toolbar-dropdown-sep';
          menu.appendChild(hr);
          return;
        }

        if (!isToolbarDropdownActionItem(item)) {
          return;
        }

        const menuItem = document.createElement('button');
        menuItem.type = 'button';
        menuItem.className = 'toolbar-dropdown-item';
        const menuItemTitle = item.title || item.label;
        menuItem.title = menuItemTitle;
        menuItem.setAttribute('aria-label', menuItemTitle);

        // For toggle items, show a checkbox indicator
        let checkboxSpan: HTMLSpanElement | null = null;
        if (item.isActive) {
          checkboxSpan = document.createElement('span');
          checkboxSpan.className = 'toolbar-dropdown-checkbox';
          checkboxSpan.textContent = item.isActive() ? '☑' : '☐';
          menuItem.append(checkboxSpan);
        }

        const text = document.createElement('span');
        text.textContent = item.label;

        if (item.icon) {
          const menuIcon = createIconElement(item.icon, 'toolbar-dropdown-icon');
          menuItem.append(menuIcon, text);
        } else {
          menuItem.append(text);
        }

        menuItem.onclick = e => {
          e.preventDefault();
          e.stopPropagation();

          // Don't execute action if disabled
          if (menuItem.disabled) {
            return;
          }

          item.action();
          if (!item.noClose) {
            menu.style.display = 'none';
            button.setAttribute('aria-expanded', 'false');
          }
          refreshActiveStates();
        };

        // Store reference to dropdown item for state updates
        dropdownItems.push({ config: item, element: menuItem });

        menu.appendChild(menuItem);
      });

      button.onclick = e => {
        e.preventDefault();
        e.stopPropagation();

        if (button.disabled) return;

        const isVisible = menu.style.display === 'block';
        closeAllDropdowns();

        if (!isVisible) {
          activeDropdownOwnerEditor = editor;
          refreshActiveStates();
          positionFloatingMenu(button, menu);
          button.setAttribute('aria-expanded', 'true');
        } else {
          button.setAttribute('aria-expanded', 'false');
        }
      };

      button.append(icon);
      container.append(button);
      document.body.appendChild(menu);
      bodyMenus.push(menu);

      // Store dropdown button for state updates
      dropdownButtons.push({ config: btn, element: button });

      itemsContainer.appendChild(container);
      return;
    }

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'toolbar-button' + (btn.className ? ` ${btn.className}` : '');
    button.title = btn.title || btn.label;
    button.setAttribute('aria-label', btn.title || btn.label);

    const icon = createIconElement(btn.icon, 'toolbar-icon');

    button.append(icon);

    button.onclick = e => {
      e.preventDefault();

      btn.action();
      refreshActiveStates();
    };

    actionButtons.push({ config: btn, element: button });
    itemsContainer.appendChild(button);
  });

  // ── Overflow button (⋯) ──────────────────────────────────────────────────────

  const overflowContainer = document.createElement('div');
  overflowContainer.className = 'toolbar-dropdown toolbar-overflow-dropdown';
  overflowContainer.style.display = 'none';

  const overflowTrigger = document.createElement('button');
  overflowTrigger.type = 'button';
  overflowTrigger.className = 'toolbar-button toolbar-overflow-trigger';
  overflowTrigger.title = 'More actions';
  overflowTrigger.setAttribute('aria-label', 'More actions');
  overflowTrigger.setAttribute('aria-haspopup', 'true');
  overflowTrigger.setAttribute('aria-expanded', 'false');
  overflowTrigger.innerHTML = '<span class="codicon codicon-ellipsis"></span>';

  const overflowMenu = document.createElement('div');
  overflowMenu.className = 'toolbar-overflow-menu';

  // Forward ref — assigned after buildOverflowMenu is defined below
  let buildOverflowMenuRef: (() => void) | null = null;

  overflowTrigger.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    const isOpen = overflowMenu.classList.contains('open');
    closeAllDropdowns();
    if (!isOpen) {
      activeDropdownOwnerEditor = editor;
      // Rebuild with fresh state before showing
      refreshActiveStates();
      buildOverflowMenuRef?.();
      positionFloatingMenu(overflowTrigger, overflowMenu);
      overflowMenu.classList.add('open');
      overflowTrigger.setAttribute('aria-expanded', 'true');
    } else {
      overflowTrigger.setAttribute('aria-expanded', 'false');
    }
  });

  overflowContainer.append(overflowTrigger);

  const subMenus: HTMLElement[] = [];

  const buildOverflowMenu = () => {
    overflowMenu.innerHTML = '';
    overflowActionItems.length = 0;
    overflowDropdownItems.length = 0;
    overflowDropdownInputs.length = 0;

    // Remove old sub-menus from body
    subMenus.forEach(m => m.parentNode?.removeChild(m));
    subMenus.length = 0;

    // Close any open sub-menus
    const closeSubMenus = () => {
      subMenus.forEach(m => { m.style.display = 'none'; });
    };

    const hiddenItems = Array.from(itemsContainer.children) as HTMLElement[];
    hiddenItems.forEach(item => {
      if (item.style.display !== 'none') return;
      if (item.classList.contains('toolbar-separator')) return;

      // Heading widget — render as Hx/P, ↑, ↓, and H1-H6+P submenu rows
      if (item.classList.contains('toolbar-heading-widget')) {
        const makeHeadingOverflowBtn = (label: string, title: string, action: () => void, disabled: boolean) => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'toolbar-button toolbar-overflow-row-btn';
          btn.title = title;
          btn.disabled = disabled;
          btn.classList.toggle('disabled', disabled);
          btn.append(createIconElement({ fallback: label }, 'toolbar-icon'));
          btn.onclick = e => {
            e.preventDefault();
            e.stopPropagation();
            if (!btn.disabled) {
              action();
              overflowMenu.classList.remove('open');
              overflowTrigger.setAttribute('aria-expanded', 'false');
            }
          };
          return btn;
        };

        // We need access to heading widget internals — call headingWidgetUpdater to get current state
        // Read displayedLevel from the hxBtn text content
        const hxBtnEl = item.querySelector('.toolbar-heading-hx') as HTMLButtonElement | null;
        const hxLabel = hxBtnEl?.textContent?.trim() ?? 'H1';
        const isP = hxLabel === 'P';
        const dispLevel = isP ? 7 : parseInt(hxLabel.replace('H', '')) || 1;
        const focused = isEditorFocused;

        const applyLevelAndClose = (level: number) => {
          if (level === 7) {
            editor.chain().focus().setParagraph().run();
          } else {
            editor.chain().focus().setHeading({ level: level as any }).run();
          }
          refreshActiveStates();
        };

        // Hx/P row
        const hxRow = makeHeadingOverflowBtn(hxLabel, isP ? 'Paragraph' : `Heading ${dispLevel}`, () => applyLevelAndClose(dispLevel), !focused);
        overflowMenu.appendChild(hxRow);

        // ↑ row
        const upDisabled = !focused || dispLevel <= 1;
        const upRow = makeHeadingOverflowBtn('↑', 'Larger heading', () => {
          const cur = dispLevel === 7 ? 7 : dispLevel;
          applyLevelAndClose(cur === 7 ? 6 : Math.max(1, cur - 1));
        }, upDisabled);
        overflowMenu.appendChild(upRow);

        // ↓ row
        const downDisabled = !focused || dispLevel >= 7;
        const downRow = makeHeadingOverflowBtn('↓', 'Smaller heading', () => {
          applyLevelAndClose(Math.min(7, dispLevel + 1));
        }, downDisabled);
        overflowMenu.appendChild(downRow);

        // Dropdown row → sub-menu with H1-H6 + P
        const dropRowBtn = document.createElement('button');
        dropRowBtn.type = 'button';
        dropRowBtn.className = 'toolbar-button toolbar-overflow-row-btn';
        dropRowBtn.title = 'Heading level';
        dropRowBtn.disabled = !focused;
        dropRowBtn.classList.toggle('disabled', !focused);
        dropRowBtn.append(createIconElement({ name: 'text-size', fallback: 'H▾' }, 'toolbar-icon'));

        const hSubMenu = document.createElement('div');
        hSubMenu.className = 'toolbar-overflow-submenu';
        hSubMenu.style.display = 'none';
        [1, 2, 3, 4, 5, 6].forEach(level => {
          const si = document.createElement('button');
          si.type = 'button';
          si.className = 'toolbar-dropdown-item';
          si.textContent = `Heading ${level} (H${level})`;
          si.onclick = e => { e.preventDefault(); e.stopPropagation(); applyLevelAndClose(level); };
          hSubMenu.appendChild(si);
        });
        const hSubSep = document.createElement('hr');
        hSubSep.className = 'toolbar-overflow-submenu-sep';
        hSubMenu.appendChild(hSubSep);
        const pSi = document.createElement('button');
        pSi.type = 'button';
        pSi.className = 'toolbar-dropdown-item';
        pSi.textContent = 'Paragraph (P)';
        pSi.onclick = e => { e.preventDefault(); e.stopPropagation(); applyLevelAndClose(7); };
        hSubMenu.appendChild(pSi);

        dropRowBtn.onclick = e => {
          e.preventDefault();
          e.stopPropagation();
          if (dropRowBtn.disabled) return;
          const isOpen = hSubMenu.style.display === 'block';
          closeSubMenus();
          if (!isOpen) {
            const menuRect = overflowMenu.getBoundingClientRect();
            const r = dropRowBtn.getBoundingClientRect();
            hSubMenu.style.top = r.top + 'px';
            hSubMenu.style.left = 'auto';
            hSubMenu.style.right = (window.innerWidth - menuRect.left - 8) + 'px';
            hSubMenu.style.display = 'block';
          }
        };

        document.body.appendChild(hSubMenu);
        subMenus.push(hSubMenu);

        const wrapper = document.createElement('div');
        wrapper.className = 'toolbar-overflow-icon-wrapper';
        wrapper.append(dropRowBtn);
        overflowMenu.appendChild(wrapper);
        return;
      }

      if (item.classList.contains('toolbar-dropdown')) {
        const origButton = item.querySelector('.toolbar-button') as HTMLButtonElement | null;
        const label = origButton?.title ?? origButton?.getAttribute('aria-label') ?? '';
        const dropConfig = buttons.find(b => b.type === 'dropdown' && (b.title ?? b.label) === label) as ToolbarDropdown | undefined;
        if (!dropConfig) return;

        // Row button: icon + label, opens sub-menu on click
        const rowBtn = document.createElement('button');
        rowBtn.type = 'button';
        rowBtn.className = 'toolbar-button toolbar-overflow-row-btn';
        rowBtn.title = dropConfig.title ?? dropConfig.label;
        rowBtn.append(createIconElement(dropConfig.icon, 'toolbar-icon'));
        const labelSpan = document.createElement('span');
        labelSpan.className = 'toolbar-overflow-row-label';
        labelSpan.textContent = dropConfig.label;
        rowBtn.append(labelSpan);

        const subMenu = document.createElement('div');
        subMenu.className = 'toolbar-overflow-submenu';
        subMenu.style.display = 'none';

        dropConfig.items.forEach(subItem => {
          if (isToolbarDropdownInputItem(subItem)) {
            const { container: inputRow, input } = createDropdownInputRow(subItem);
            overflowDropdownInputs.push({ config: subItem, element: input });
            subMenu.appendChild(inputRow);
            return;
          }

          if (isToolbarDropdownSeparatorItem(subItem)) {
            const hr = document.createElement('hr');
            hr.className = 'toolbar-overflow-submenu-sep';
            subMenu.appendChild(hr);
            return;
          }

          // Render dashes separator as a thin hr
          if (/^─+$/.test(subItem.label.trim())) {
            const hr = document.createElement('hr');
            hr.className = 'toolbar-overflow-submenu-sep';
            subMenu.appendChild(hr);
            return;
          }
          if (!isToolbarDropdownActionItem(subItem)) {
            return;
          }
          const mi = dropdownItems.find(d => d.config === subItem)?.element;
          const row = document.createElement('button');
          row.type = 'button';
          row.className = 'toolbar-dropdown-item';
          if (subItem.isActive) {
            const cb = document.createElement('span');
            cb.className = 'toolbar-dropdown-checkbox';
            cb.textContent = subItem.isActive() ? '☑' : '☐';
            row.appendChild(cb);
          }
          const rowText = document.createElement('span');
          rowText.textContent = subItem.label;
          row.appendChild(rowText);
          const enabled = subItem.isEnabled ? subItem.isEnabled() : true;
          row.disabled = !enabled;
          row.classList.toggle('disabled', !enabled);
          row.onclick = e => {
            e.preventDefault();
            e.stopPropagation();
            if (!row.disabled) {
              mi ? mi.click() : subItem.action();
              overflowMenu.classList.remove('open');
              overflowTrigger.setAttribute('aria-expanded', 'false');
            }
          };
          if (mi) overflowDropdownItems.push({ config: subItem, element: row });
          subMenu.appendChild(row);
        });

        rowBtn.onclick = e => {
          e.preventDefault();
          e.stopPropagation();
          if (rowBtn.disabled) return;
          const isOpen = subMenu.style.display === 'block';
          closeSubMenus();
          if (!isOpen) {
            const menuRect = overflowMenu.getBoundingClientRect();
            const r = rowBtn.getBoundingClientRect();
            subMenu.style.top = r.top + 'px';
            subMenu.style.left = 'auto';
            subMenu.style.right = (window.innerWidth - menuRect.left - 8) + 'px';
            subMenu.style.display = 'block';
          }
        };

        document.body.appendChild(subMenu);
        subMenus.push(subMenu);

        const wrapper = document.createElement('div');
        wrapper.className = 'toolbar-overflow-icon-wrapper';
        wrapper.append(rowBtn);
        overflowMenu.appendChild(wrapper);

      } else {
        const origBtn = item as HTMLButtonElement;
        const matchedBtn = actionButtons.find(b => b.element === origBtn);
        if (!matchedBtn) return;

        const rowBtn = document.createElement('button');
        rowBtn.type = 'button';
        rowBtn.className = 'toolbar-button toolbar-overflow-row-btn';
        rowBtn.title = matchedBtn.config.title ?? matchedBtn.config.label;
        rowBtn.append(createIconElement(matchedBtn.config.icon!, 'toolbar-icon'));
        const labelSpan = document.createElement('span');
        labelSpan.className = 'toolbar-overflow-row-label';
        labelSpan.textContent = matchedBtn.config.title ?? matchedBtn.config.label;
        rowBtn.append(labelSpan);

        const btnEnabled = matchedBtn.config.requiresFocus ? isEditorFocused : true;
        rowBtn.disabled = !btnEnabled;
        rowBtn.classList.toggle('disabled', !btnEnabled);

        rowBtn.onclick = e => {
          e.preventDefault();
          e.stopPropagation();
          if (!rowBtn.disabled) {
            origBtn.click();
            overflowMenu.classList.remove('open');
            overflowTrigger.setAttribute('aria-expanded', 'false');
          }
        };

        overflowActionItems.push({ config: matchedBtn.config, element: rowBtn });
        overflowMenu.appendChild(rowBtn);
      }
    });
  };

  buildOverflowMenuRef = buildOverflowMenu;

  // Measure the overflow button width once (it's constant)
  let overflowBtnWidth = 0;

  const updateOverflow = () => {
    const items = Array.from(itemsContainer.children) as HTMLElement[];
    const gap = parseFloat(getComputedStyle(itemsContainer).gap) || 4;

    // Measure overflow button width on first call
    if (overflowBtnWidth === 0) {
      overflowContainer.style.display = '';
      void overflowContainer.offsetWidth;
      overflowBtnWidth = overflowContainer.offsetWidth || 36;
      overflowContainer.style.display = 'none';
    }

    // Reset: show all items, hide overflow button
    items.forEach(item => (item.style.display = ''));
    overflowContainer.style.display = 'none';

    // Force reflow
    void toolbar.offsetWidth;

    // Available width = actual rendered toolbar width
    const toolbarStyle = getComputedStyle(toolbar);
    const available = toolbar.getBoundingClientRect().width
      - parseFloat(toolbarStyle.paddingLeft)
      - parseFloat(toolbarStyle.paddingRight);

    // Per-item right-edge positions relative to itemsContainer left edge
    // Using getBoundingClientRect for accuracy regardless of flex stretching
    const containerLeft = itemsContainer.getBoundingClientRect().left;
    const rightEdges = items.map(item => {
      const r = item.getBoundingClientRect();
      return r.right - containerLeft;
    });
    const totalWidth = rightEdges.length > 0 ? rightEdges[rightEdges.length - 1] : 0;

    if (totalWidth <= available) {
      // All items fit — no overflow needed
      overflowContainer.style.display = 'none';
      buildOverflowMenu();
      return;
    }

    // Overflow needed — show button and find cut-off point
    overflowContainer.style.display = '';
    const availableWithBtn = available - overflowBtnWidth - gap;
    let firstHiddenIndex = -1;

    for (let i = 0; i < items.length; i++) {
      if (rightEdges[i] > availableWithBtn) {
        firstHiddenIndex = i;
        break;
      }
    }

    // If all items still fit within availableWithBtn, hide only the last non-separator
    if (firstHiddenIndex === -1) {
      for (let i = items.length - 1; i >= 0; i--) {
        if (!items[i].classList.contains('toolbar-separator')) {
          firstHiddenIndex = i;
          break;
        }
      }
    }

    // Hide items from firstHiddenIndex onwards
    items.forEach((item, i) => {
      item.style.display = i >= firstHiddenIndex ? 'none' : '';
    });

    // Hide trailing separators among visible items
    for (let i = firstHiddenIndex - 1; i >= 0; i--) {
      if (items[i].classList.contains('toolbar-separator')) {
        items[i].style.display = 'none';
      } else {
        break;
      }
    }

    buildOverflowMenu();
    refreshActiveStates();
  };

  toolbar.appendChild(itemsContainer);
  toolbar.appendChild(overflowContainer);
  document.body.appendChild(overflowMenu);
  bodyMenus.push(overflowMenu);

  const resizeObserver =
    typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => updateOverflow());
  resizeObserver?.observe(toolbar);

  // Initial measurement after the toolbar is inserted into the DOM
  requestAnimationFrame(() => updateOverflow());

  toolbarRefreshFunction = refreshActiveStates;

  editor.on('selectionUpdate', refreshActiveStates);
  editor.on('update', refreshActiveStates);

  // Listen for editor focus changes
  const handleEditorFocusChange = (e: Event) => {
    const customEvent = e as CustomEvent<{ focused: boolean }>;
    isEditorFocused = customEvent.detail.focused;
    refreshActiveStates();
  };

  // Ensure we don't accumulate multiple listeners if toolbar is recreated
  if (focusChangeListener) {
    window.removeEventListener('editorFocusChange', focusChangeListener);
  }
  focusChangeListener = handleEditorFocusChange;
  window.addEventListener('editorFocusChange', handleEditorFocusChange);

  // Clean up listeners when editor is destroyed
  editor.on('destroy', () => {
    resizeObserver?.disconnect();
    if (activeDropdownOwnerEditor === editor) {
      activeDropdownOwnerEditor = null;
    }
    if (focusChangeListener) {
      window.removeEventListener('editorFocusChange', focusChangeListener);
      focusChangeListener = null;
    }
    if (typeof editor.off === 'function') {
      editor.off('selectionUpdate', refreshActiveStates);
      editor.off('update', refreshActiveStates);
    }
    // Remove all body-attached menus
    bodyMenus.forEach(m => m.parentNode?.removeChild(m));
    subMenus.forEach(m => m.parentNode?.removeChild(m));
  });

  refreshActiveStates();

  if (!documentClickListenerRegistered) {
    documentClickListenerRegistered = true;
    document.addEventListener('click', e => {
      if (isToolbarMenuTarget(e.target)) return;
      closeAllDropdowns();
    });
  }

  if (!documentKeydownListenerRegistered) {
    documentKeydownListenerRegistered = true;
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') {
        return;
      }
      if (!closeAllDropdowns({ blurActiveElement: true, focusEditor: true })) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    });
  }

  return toolbar;
}

/**
 * Position bubble menu near selection
 */
export function positionBubbleMenu(menu: HTMLElement) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    menu.style.display = 'none';
    return;
  }

  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();

  if (rect.width === 0 && rect.height === 0) {
    menu.style.display = 'none';
    return;
  }

  menu.style.display = 'flex';
  menu.style.position = 'fixed'; // Use fixed instead of absolute
  menu.style.left = `${rect.left + rect.width / 2}px`;
  menu.style.top = `${rect.top - 45}px`; // Position above selection
  menu.style.transform = 'translateX(-50%)'; // Center horizontally
}

/**
 * Create table context menu for row/column operations.
 *
 * @param editor - TipTap editor instance
 * @returns HTMLElement containing the context menu
 */
export function createTableMenu(editor: Editor): HTMLElement {
  const menu = document.createElement('div');
  menu.className = 'table-menu';
  menu.style.display = 'none';

  const items: Array<
    | { separator: true }
    | {
        label: string;
        action: () => void;
      }
  > = [
    {
      label: 'Add Row Before',
      action: () => editor.chain().focus().addRowBefore().run(),
    },
    {
      label: 'Add Row After',
      action: () => editor.chain().focus().addRowAfter().run(),
    },
    {
      label: 'Delete Row',
      action: () => editor.chain().focus().deleteRow().run(),
    },
    { separator: true },
    {
      label: 'Add Column Before',
      action: () => editor.chain().focus().addColumnBefore().run(),
    },
    {
      label: 'Add Column After',
      action: () => editor.chain().focus().addColumnAfter().run(),
    },
    {
      label: 'Delete Column',
      action: () => editor.chain().focus().deleteColumn().run(),
    },
    { separator: true },
    {
      label: 'Delete Table',
      action: () => editor.chain().focus().deleteTable().run(),
    },
  ];

  items.forEach(item => {
    if ('separator' in item) {
      const separator = document.createElement('div');
      separator.className = 'table-menu-separator';
      menu.appendChild(separator);
    } else {
      const menuItem = document.createElement('div');
      menuItem.className = 'table-menu-item';
      menuItem.textContent = item.label;
      menuItem.title = item.label;
      menuItem.setAttribute('aria-label', item.label);
      menuItem.onclick = () => {
        item.action();
        menu.style.display = 'none';
      };
      menu.appendChild(menuItem);
    }
  });

  document.body.appendChild(menu);
  return menu;
}
