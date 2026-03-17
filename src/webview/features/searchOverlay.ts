/**
 * Copyright (c) 2025-2026 Concret.io
 *
 * Licensed under the MIT License. See LICENSE file in the project root for details.
 */

declare const __BUILD_TIME__: string;
const BUILD_TAG = `[MD4H ${__BUILD_TIME__}]`;

import { Editor } from '@tiptap/core';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { Plugin, PluginKey } from '@tiptap/pm/state';

/**
 * Search Overlay - In-document search for Markdown for Humans
 *
 * Provides a search experience with:
 * - Real-time match highlighting
 * - Navigation between matches (next/previous)
 * - Visual match counter
 * - Case-sensitive toggle (Aa)
 * - Wildcard mode toggle (*) — supports * and ? globs
 * - Regex mode toggle (.*) — full JS regex syntax
 * - Hover popovers explaining wildcard/regex syntax
 * - Right-gutter minimap of match positions
 * - Keyboard shortcuts (Enter: next, Shift+Enter: previous, Escape: close)
 */

// Plugin key for search decorations
const searchPluginKey = new PluginKey('search-highlight');

// Search state
let searchOverlayElement: HTMLElement | null = null;
let gutterElement: HTMLElement | null = null;
let isVisible = false;
let savedSelection: { from: number; to: number } | null = null;
let matchesLimitHit = false; // true when findMatches stopped at the cap
let currentQuery = '';
let currentMatches: Array<{ from: number; to: number }> = [];
let currentMatchIndex = -1;
let searchPlugin: Plugin | null = null;

// Search mode state
let isCaseSensitive = false;
let isWildcardMode = false;
let isRegexMode = false;

// Replace state
let isReplaceVisible = false;

const isOverlayInDom = () =>
  Boolean(searchOverlayElement && document.body.contains(searchOverlayElement));

// ─── Search Plugin ────────────────────────────────────────────────────────────

function createSearchPlugin(): Plugin {
  return new Plugin({
    key: searchPluginKey,
    state: {
      init() {
        return DecorationSet.empty;
      },
      apply(tr, oldState) {
        const searchMeta = tr.getMeta(searchPluginKey);
        if (searchMeta !== undefined) {
          return searchMeta;
        }
        return oldState.map(tr.mapping, tr.doc);
      },
    },
    props: {
      decorations(state) {
        return this.getState(state);
      },
    },
  });
}

function ensureSearchPlugin(editor: Editor) {
  const existingPlugin = editor.state.plugins.find(p => p.spec.key === searchPluginKey);
  if (!existingPlugin) {
    searchPlugin = createSearchPlugin();
    editor.registerPlugin(searchPlugin);
  }
}

// ─── Match Finding ────────────────────────────────────────────────────────────

/**
 * Convert a wildcard pattern (* = any sequence, ? = any char) to a RegExp.
 */
function wildcardToRegex(pattern: string, caseSensitive: boolean): RegExp | null {
  try {
    // Escape all regex special chars except * and ?
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    // Convert * -> .* and ? -> .
    const regexStr = escaped.replace(/\*/g, '.*').replace(/\?/g, '.');
    return new RegExp(regexStr, caseSensitive ? 'g' : 'gi');
  } catch {
    return null;
  }
}

/**
 * Build the RegExp for the current search mode.
 * Returns null if the pattern is invalid (regex mode only).
 */
function buildRegex(query: string): RegExp | null {
  if (!query) return null;
  try {
    if (isRegexMode) {
      return new RegExp(query, isCaseSensitive ? 'g' : 'gi');
    }
    if (isWildcardMode) {
      return wildcardToRegex(query, isCaseSensitive);
    }
    // Plain text: escape everything
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(escaped, isCaseSensitive ? 'g' : 'gi');
  } catch {
    return null;
  }
}

export function findMatches(
  editor: Editor,
  query: string,
  limit = MAX_HIGHLIGHT_DECORATIONS
): Array<{ from: number; to: number }> {
  if (!query || query.length === 0) return [];

  const regex = buildRegex(query);
  if (!regex) return []; // invalid pattern

  const matches: Array<{ from: number; to: number }> = [];
  const doc = editor.state.doc;

  doc.descendants((node, pos) => {
    if (matches.length >= limit) return false; // stop traversal early
    if (node.isText && node.text) {
      regex.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = regex.exec(node.text)) !== null) {
        if (m[0].length === 0) {
          regex.lastIndex++;
          continue;
        }
        matches.push({ from: pos + m.index, to: pos + m.index + m[0].length });
        if (matches.length >= limit) break;
      }
    }
    return true;
  });

  matchesLimitHit = matches.length >= limit;
  return matches;
}

/**
 * Returns true if the current query is an invalid regex (regex mode only).
 */
function isInvalidPattern(query: string): boolean {
  if (!isRegexMode || !query) return false;
  try {
    new RegExp(query);
    return false;
  } catch {
    return true;
  }
}

// ─── Decorations ─────────────────────────────────────────────────────────────

// Max decorations to render — beyond this the ProseMirror transaction becomes too slow
const MAX_HIGHLIGHT_DECORATIONS = 500;

function applySearchDecorations(
  editor: Editor,
  matches: Array<{ from: number; to: number }>,
  activeIndex: number
) {
  try {
    // Always include the active match; fill remaining budget from the start
    const toDecorate: Array<{ match: { from: number; to: number }; index: number }> = [];
    if (activeIndex >= 0 && activeIndex < matches.length) {
      toDecorate.push({ match: matches[activeIndex], index: activeIndex });
    }
    let budget = MAX_HIGHLIGHT_DECORATIONS - toDecorate.length;
    for (let i = 0; i < matches.length && budget > 0; i++) {
      if (i !== activeIndex) {
        toDecorate.push({ match: matches[i], index: i });
        budget--;
      }
    }

    const decorations: Decoration[] = toDecorate.map(({ match, index }) =>
      Decoration.inline(match.from, match.to, {
        class: index === activeIndex ? 'search-match search-match-active' : 'search-match',
      })
    );

    const decorationSet =
      decorations.length > 0
        ? DecorationSet.create(editor.state.doc, decorations)
        : DecorationSet.empty;

    editor.view.dispatch(editor.state.tr.setMeta(searchPluginKey, decorationSet));
  } catch (error) {
    console.warn(`${BUILD_TAG} Skipping search decorations:`, error);
  }
}

function clearSearchDecorations(editor: Editor) {
  try {
    editor.view.dispatch(editor.state.tr.setMeta(searchPluginKey, DecorationSet.empty));
  } catch {
    // Safe no-op
  }
}

// ─── Scrolling ────────────────────────────────────────────────────────────────

function scrollToMatch(editor: Editor, match: { from: number; to: number }) {
  const shouldRefocusInput = isVisible;

  editor.commands.setTextSelection({ from: match.from, to: match.to });

  try {
    editor.view.dispatch(editor.state.tr.scrollIntoView());
  } catch {
    // ignore
  }

  const coords = editor.view.coordsAtPos(match.from);
  if (coords) {
    const domAtPos = editor.view.domAtPos(match.from);
    const node = domAtPos?.node as Node | null;
    const element =
      (node?.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement | null)) ||
      null;

    if (element && typeof element.scrollIntoView === 'function') {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      const y = coords.top + window.scrollY - window.innerHeight * 0.3;
      window.scrollTo({ top: y, behavior: 'smooth' });
    }
  }

  if (shouldRefocusInput) {
    const replaceInput = searchOverlayElement?.querySelector('.search-overlay-replace-input') as HTMLInputElement | null;
    const activeIsReplace = document.activeElement === replaceInput;
    if (isReplaceVisible && activeIsReplace) {
      replaceInput?.focus();
    } else {
      focusSearchInput(false);
    }
  }
}

// ─── Counter ──────────────────────────────────────────────────────────────────

function updateMatchCounter(searchInput: HTMLInputElement) {
  const counter = searchOverlayElement?.querySelector('.search-overlay-counter') as HTMLElement;
  if (!counter) return;

  if (isRegexMode && isInvalidPattern(currentQuery)) {
    counter.textContent = 'Invalid expression';
    counter.classList.add('no-results');
    searchInput.classList.add('no-results');
  } else if (currentMatches.length === 0 && currentQuery.length > 0) {
    counter.textContent = 'No results';
    counter.classList.add('no-results');
    searchInput.classList.add('no-results');
  } else if (currentMatches.length > 0) {
    const total = matchesLimitHit ? `${currentMatches.length}+` : `${currentMatches.length}`;
    counter.textContent = `${currentMatchIndex + 1} of ${total}`;
    counter.classList.remove('no-results');
    searchInput.classList.remove('no-results');
  } else {
    counter.textContent = '';
    counter.classList.remove('no-results');
    searchInput.classList.remove('no-results');
  }
}

// ─── Gutter ───────────────────────────────────────────────────────────────────

function createGutter(): HTMLElement {
  const gutter = document.createElement('div');
  gutter.className = 'search-gutter';
  gutter.setAttribute('aria-hidden', 'true');
  document.body.appendChild(gutter);
  gutterElement = gutter;
  return gutter;
}

function updateGutter(editor: Editor) {
  if (!gutterElement) return;

  gutterElement.innerHTML = '';
  if (currentMatches.length === 0) return;

  // Snapshot state at call time so the rAF closure uses consistent values
  const matches = currentMatches.slice();
  const activeIndex = currentMatchIndex;
  const totalHeight = document.documentElement.scrollHeight;
  if (totalHeight <= 0) return;

  // Defer all coordsAtPos / DOM work to after the browser has painted
  requestAnimationFrame(() => {
    if (!gutterElement) return;
    gutterElement.innerHTML = '';

    matches.forEach((match, index) => {
      let matchTop: number | null = null;
      try {
        const coords = editor.view.coordsAtPos(match.from);
        if (coords) matchTop = coords.top + window.scrollY;
      } catch {
        // skip
      }
      if (matchTop === null) return;

      const topPct = (matchTop / totalHeight) * 100;

      const tick = document.createElement('div');
      tick.className =
        index === activeIndex
          ? 'search-gutter-tick search-gutter-tick-active'
          : 'search-gutter-tick';
      tick.style.top = `${topPct}%`;
      tick.title = `Match ${index + 1} of ${matches.length}`;

      tick.addEventListener('mousedown', e => {
        e.preventDefault();
        currentMatchIndex = index;
        applySearchDecorations(editor, currentMatches, currentMatchIndex);
        scrollToMatch(editor, currentMatches[currentMatchIndex]);
        const searchInput = searchOverlayElement?.querySelector(
          '.search-overlay-input'
        ) as HTMLInputElement | null;
        if (searchInput) updateMatchCounter(searchInput);
        updateGutter(editor);
      });

      gutterElement!.appendChild(tick);
    });
  });
}

// Debounced version for use during typing — avoids triggering on every keystroke
let gutterDebounceTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleGutterUpdate(editor: Editor, delay = 150) {
  if (gutterDebounceTimer) clearTimeout(gutterDebounceTimer);
  gutterDebounceTimer = setTimeout(() => {
    gutterDebounceTimer = null;
    updateGutter(editor);
  }, delay);
}

// Debounced search — used by the input listener to avoid blocking on every keystroke
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSearch(editor: Editor, query: string, delay = 200) {
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer);

  // If query is empty, clear immediately — no point waiting
  if (!query) {
    currentQuery = '';
    currentMatches = [];
    currentMatchIndex = -1;
    matchesLimitHit = false;
    clearSearchDecorations(editor);
    const searchInput = searchOverlayElement?.querySelector(
      '.search-overlay-input'
    ) as HTMLInputElement | null;
    if (searchInput) updateMatchCounter(searchInput);
    hideGutter();
    return;
  }

  // Track the latest query so performSearch can bail if superseded
  currentQuery = query;

  // All heavy work (findMatches, applySearchDecorations) deferred — input stays responsive
  searchDebounceTimer = setTimeout(() => {
    searchDebounceTimer = null;
    performSearch(editor, query);
  }, delay);
}

function showGutter(editor: Editor) {
  if (!gutterElement) createGutter();
  gutterElement!.classList.add('visible');
  updateGutter(editor);
}

function hideGutter() {
  if (gutterDebounceTimer) {
    clearTimeout(gutterDebounceTimer);
    gutterDebounceTimer = null;
  }
  if (!gutterElement) return;
  gutterElement.classList.remove('visible');
  gutterElement.innerHTML = '';
}

// ─── Core Search ─────────────────────────────────────────────────────────────

function performSearch(editor: Editor, query: string) {
  // Yield to the browser first so any pending paint (typed character) completes
  // before the CPU-heavy work starts
  requestAnimationFrame(() => {
    // Bail if query changed while we were waiting
    if (query !== currentQuery && currentQuery !== '') return;

    currentQuery = query;

    // Don't update matches on invalid regex — just show the error state
    if (isRegexMode && isInvalidPattern(query)) {
      currentMatches = [];
      currentMatchIndex = -1;
      clearSearchDecorations(editor);
      const searchInput = searchOverlayElement?.querySelector(
        '.search-overlay-input'
      ) as HTMLInputElement | null;
      if (searchInput) updateMatchCounter(searchInput);
      scheduleGutterUpdate(editor);
      return;
    }

    currentMatches = findMatches(editor, query);

    // Start at the first match at or after the pre-search cursor position
    const anchorPos = savedSelection?.from ?? 0;
    let wrapped = false;
    if (currentMatches.length === 0) {
      currentMatchIndex = -1;
    } else {
      currentMatchIndex = currentMatches.findIndex(m => m.from >= anchorPos);
      if (currentMatchIndex === -1) {
        currentMatchIndex = 0;
        wrapped = true;
      }
    }

    applySearchDecorations(editor, currentMatches, currentMatchIndex);

    const searchInput = searchOverlayElement?.querySelector(
      '.search-overlay-input'
    ) as HTMLInputElement | null;
    if (searchInput) updateMatchCounter(searchInput);

    if (currentMatches.length > 0) {
      scrollToMatch(editor, currentMatches[currentMatchIndex]);
      if (wrapped) setWrapIndicator('Wrapped to top');
    }

    showGutter(editor);
  });
}

function goToNextMatch(editor: Editor) {
  if (currentMatches.length === 0) return;
  currentMatchIndex = (currentMatchIndex + 1) % currentMatches.length;
  applySearchDecorations(editor, currentMatches, currentMatchIndex);
  scrollToMatch(editor, currentMatches[currentMatchIndex]);
  const searchInput = searchOverlayElement?.querySelector(
    '.search-overlay-input'
  ) as HTMLInputElement | null;
  if (searchInput) updateMatchCounter(searchInput);
  updateGutter(editor);
}

function goToPreviousMatch(editor: Editor) {
  if (currentMatches.length === 0) return;
  currentMatchIndex = (currentMatchIndex - 1 + currentMatches.length) % currentMatches.length;
  applySearchDecorations(editor, currentMatches, currentMatchIndex);
  scrollToMatch(editor, currentMatches[currentMatchIndex]);
  const searchInput = searchOverlayElement?.querySelector(
    '.search-overlay-input'
  ) as HTMLInputElement | null;
  if (searchInput) updateMatchCounter(searchInput);
  updateGutter(editor);
}

// ─── Popover ──────────────────────────────────────────────────────────────────

type PopoverRow = { pattern: string; desc: string };

function createHoverPopover(title: string, rows: PopoverRow[]): HTMLElement {
  const popover = document.createElement('div');
  popover.className = 'search-mode-popover';

  const heading = document.createElement('div');
  heading.className = 'search-mode-popover-title';
  heading.textContent = title;
  popover.appendChild(heading);

  const table = document.createElement('table');
  table.className = 'search-mode-popover-table';
  rows.forEach(({ pattern, desc }) => {
    const tr = document.createElement('tr');
    const tdPat = document.createElement('td');
    tdPat.className = 'search-mode-popover-pattern';
    tdPat.textContent = pattern;
    const tdDesc = document.createElement('td');
    tdDesc.className = 'search-mode-popover-desc';
    tdDesc.textContent = desc;
    tr.appendChild(tdPat);
    tr.appendChild(tdDesc);
    table.appendChild(tr);
  });
  popover.appendChild(table);

  return popover;
}

function attachPopover(btn: HTMLButtonElement, popover: HTMLElement) {
  let showTimeout: ReturnType<typeof setTimeout> | null = null;
  let hideTimeout: ReturnType<typeof setTimeout> | null = null;

  const show = () => {
    if (hideTimeout) { clearTimeout(hideTimeout); hideTimeout = null; }
    showTimeout = setTimeout(() => {
      document.body.appendChild(popover);
      const rect = btn.getBoundingClientRect();
      popover.style.left = `${rect.left}px`;
      popover.style.top = `${rect.bottom + 6}px`;
      popover.classList.add('visible');
    }, 400);
  };

  const hide = () => {
    if (showTimeout) { clearTimeout(showTimeout); showTimeout = null; }
    hideTimeout = setTimeout(() => {
      popover.classList.remove('visible');
      if (popover.parentNode) popover.parentNode.removeChild(popover);
    }, 100);
  };

  btn.addEventListener('mouseenter', show);
  btn.addEventListener('mouseleave', hide);
  popover.addEventListener('mouseenter', () => {
    if (hideTimeout) { clearTimeout(hideTimeout); hideTimeout = null; }
  });
  popover.addEventListener('mouseleave', hide);
}

// ─── Toggle Buttons ───────────────────────────────────────────────────────────

function createToggleButton(label: string, ariaLabel: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'search-overlay-btn search-mode-toggle';
  btn.textContent = label;
  btn.setAttribute('aria-label', ariaLabel);
  btn.setAttribute('aria-pressed', 'false');
  return btn;
}

function updateToggleStates(
  caseSensitiveBtn: HTMLButtonElement,
  wildcardBtn: HTMLButtonElement,
  regexBtn: HTMLButtonElement,
  searchInput: HTMLInputElement
) {
  caseSensitiveBtn.classList.toggle('active', isCaseSensitive);
  caseSensitiveBtn.setAttribute('aria-pressed', String(isCaseSensitive));

  wildcardBtn.classList.toggle('active', isWildcardMode);
  wildcardBtn.setAttribute('aria-pressed', String(isWildcardMode));

  regexBtn.classList.toggle('active', isRegexMode);
  regexBtn.setAttribute('aria-pressed', String(isRegexMode));

  // Tint the input wrapper when a pattern mode is active
  const wrapper = searchInput.closest('.search-overlay-input-wrapper') as HTMLElement | null;
  if (wrapper) {
    wrapper.classList.toggle('search-mode-active', isWildcardMode || isRegexMode);
  }
}

// ─── Replace ──────────────────────────────────────────────────────────────────

function getReplaceInput(): HTMLInputElement | null {
  return searchOverlayElement?.querySelector(
    '.search-overlay-replace-input'
  ) as HTMLInputElement | null;
}

const REPLACE_PAUSE_MS = 350;

function replaceCurrentMatch(editor: Editor): void {
  if (currentMatchIndex < 0 || currentMatches.length === 0) return;
  const match = currentMatches[currentMatchIndex];
  const replaceInputEl = getReplaceInput();
  const replacement = replaceInputEl?.value ?? '';

  // Record breadcrumb at the replacement site before applying
  window.dispatchEvent(new CustomEvent('navRecordPosition', { detail: { pos: match.from, immediate: true } }));

  // Apply the replacement
  const { tr } = editor.state;
  if (replacement.length > 0) {
    tr.replaceWith(match.from, match.to, editor.schema.text(replacement));
  } else {
    tr.delete(match.from, match.to);
  }
  editor.view.dispatch(tr);

  // Re-find matches after the edit
  const newMatches = findMatches(editor, currentQuery);
  currentMatches = newMatches;

  // Advance to the next match after the replaced position
  const nextPos = match.from + replacement.length;
  let nextIndex = newMatches.findIndex(m => m.from >= nextPos);
  if (nextIndex === -1) nextIndex = newMatches.length > 0 ? 0 : -1; // wrap
  currentMatchIndex = nextIndex;

  applySearchDecorations(editor, currentMatches, currentMatchIndex);
  const searchInput = searchOverlayElement?.querySelector('.search-overlay-input') as HTMLInputElement | null;
  if (searchInput) updateMatchCounter(searchInput);

  // Pause so user sees the replacement, then scroll to next match
  if (currentMatchIndex >= 0) {
    setTimeout(() => {
      scrollToMatch(editor, currentMatches[currentMatchIndex]);
      updateGutter(editor);
    }, REPLACE_PAUSE_MS);
  } else {
    updateGutter(editor);
  }
}

let wrapIndicatorTimer: ReturnType<typeof setTimeout> | null = null;

function setWrapIndicator(text: string) {
  const el = searchOverlayElement?.querySelector('.search-overlay-counter') as HTMLElement | null;
  if (!el) return;
  if (wrapIndicatorTimer !== null) { clearTimeout(wrapIndicatorTimer); wrapIndicatorTimer = null; }
  if (text) {
    el.textContent = text;
    wrapIndicatorTimer = setTimeout(() => {
      wrapIndicatorTimer = null;
      const searchInput = searchOverlayElement?.querySelector('.search-overlay-input') as HTMLInputElement | null;
      if (searchInput) updateMatchCounter(searchInput);
    }, 1500);
  }
}

function setReplaceCounter(text: string) {
  const el = searchOverlayElement?.querySelector('.search-overlay-replace-counter') as HTMLElement | null;
  if (el) el.textContent = text;
}

function replaceAllMatches(editor: Editor): void {
  if (currentMatches.length === 0) return;
  setReplaceCounter('');
  // Record breadcrumb at current position before replacing all
  window.dispatchEvent(new CustomEvent('navRecordPosition', { detail: { pos: editor.state.selection.from, immediate: true } }));
  const count = currentMatches.length;
  const replacement = getReplaceInput()?.value ?? '';
  // Replace in reverse order to preserve positions
  const matches = [...currentMatches].reverse();
  const { tr } = editor.state;
  for (const match of matches) {
    if (replacement.length > 0) {
      tr.replaceWith(match.from, match.to, editor.schema.text(replacement));
    } else {
      tr.delete(match.from, match.to);
    }
  }
  editor.view.dispatch(tr);
  performSearch(editor, currentQuery);
  setReplaceCounter(`${count} replaced`);
  setTimeout(() => setReplaceCounter(''), 3000);
}

// ─── Overlay Creation ─────────────────────────────────────────────────────────

export function createSearchOverlay(editor: Editor): HTMLElement {
  const overlay = document.createElement('div');
  overlay.className = 'search-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-label', 'Find in document');
  overlay.setAttribute('aria-modal', 'false');

  const panel = document.createElement('div');
  panel.className = 'search-overlay-panel';

  // ── Chevron (expand/collapse replace row) ──
  const chevronBtn = document.createElement('button');
  chevronBtn.className = 'search-overlay-btn search-overlay-chevron';
  chevronBtn.setAttribute('aria-label', 'Toggle replace');
  chevronBtn.setAttribute('aria-expanded', 'false');
  chevronBtn.innerHTML = '<span class="codicon codicon-chevron-right"></span>';
  chevronBtn.title = 'Toggle replace (Ctrl+H)';

  // ── Find row ──
  const findRow = document.createElement('div');
  findRow.className = 'search-overlay-find-row';

  // ── Input wrapper ──
  const inputWrapper = document.createElement('div');
  inputWrapper.className = 'search-overlay-input-wrapper';

  const searchIcon = document.createElement('span');
  searchIcon.className = 'search-overlay-icon codicon codicon-search';
  searchIcon.setAttribute('aria-hidden', 'true');

  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.className = 'search-overlay-input';
  searchInput.placeholder = 'Find in document...';
  searchInput.setAttribute('aria-label', 'Search query');
  searchInput.spellcheck = false;

  const counter = document.createElement('span');
  counter.className = 'search-overlay-counter';
  counter.setAttribute('aria-live', 'polite');

  inputWrapper.appendChild(searchIcon);
  inputWrapper.appendChild(searchInput);
  inputWrapper.appendChild(counter);

  // ── Toggle buttons (Aa, *, .*) ──
  const toggleWrapper = document.createElement('div');
  toggleWrapper.className = 'search-overlay-toggles';

  const caseSensitiveBtn = createToggleButton('Aa', 'Match case');
  caseSensitiveBtn.title = 'Match case';

  const wildcardBtn = createToggleButton('*', 'Wildcard search');
  const wildcardPopover = createHoverPopover('Wildcard Search', [
    { pattern: '*', desc: 'any sequence of characters' },
    { pattern: '?', desc: 'any single character' },
    { pattern: '\\*', desc: 'literal asterisk' },
    { pattern: '\\?', desc: 'literal question mark' },
  ]);
  attachPopover(wildcardBtn, wildcardPopover);

  const regexBtn = createToggleButton('.*', 'Regular expression search');
  const regexPopover = createHoverPopover('Regular Expression Search', [
    { pattern: '.', desc: 'any character' },
    { pattern: '* + ?', desc: 'quantifiers (greedy)' },
    { pattern: '^ $', desc: 'start / end of text node' },
    { pattern: '[abc]', desc: 'character class' },
    { pattern: '[^abc]', desc: 'negated class' },
    { pattern: '\\d \\w \\s', desc: 'digit, word, space' },
    { pattern: '(a|b)', desc: 'alternation' },
    { pattern: '\\b', desc: 'word boundary' },
  ]);
  attachPopover(regexBtn, regexPopover);

  // Toggle handlers
  caseSensitiveBtn.addEventListener('mousedown', e => {
    e.preventDefault();
    isCaseSensitive = !isCaseSensitive;
    updateToggleStates(caseSensitiveBtn, wildcardBtn, regexBtn, searchInput);
    performSearch(editor, searchInput.value);
    searchInput.focus();
  });

  wildcardBtn.addEventListener('mousedown', e => {
    e.preventDefault();
    isWildcardMode = !isWildcardMode;
    if (isWildcardMode) isRegexMode = false;
    updateToggleStates(caseSensitiveBtn, wildcardBtn, regexBtn, searchInput);
    performSearch(editor, searchInput.value);
    searchInput.focus();
  });

  regexBtn.addEventListener('mousedown', e => {
    e.preventDefault();
    isRegexMode = !isRegexMode;
    if (isRegexMode) isWildcardMode = false;
    updateToggleStates(caseSensitiveBtn, wildcardBtn, regexBtn, searchInput);
    performSearch(editor, searchInput.value);
    searchInput.focus();
  });

  toggleWrapper.appendChild(caseSensitiveBtn);
  toggleWrapper.appendChild(wildcardBtn);
  toggleWrapper.appendChild(regexBtn);

  // ── Nav + close buttons ──
  const buttonWrapper = document.createElement('div');
  buttonWrapper.className = 'search-overlay-buttons';

  const prevBtn = document.createElement('button');
  prevBtn.className = 'search-overlay-btn';
  prevBtn.innerHTML = '<span class="codicon codicon-arrow-up"></span>';
  prevBtn.title = 'Previous match (Ctrl+Shift+Enter)';
  prevBtn.setAttribute('aria-label', 'Previous match');
  prevBtn.onclick = e => {
    e.preventDefault();
    goToPreviousMatch(editor);
    searchInput.focus();
  };

  const nextBtn = document.createElement('button');
  nextBtn.className = 'search-overlay-btn';
  nextBtn.innerHTML = '<span class="codicon codicon-arrow-down"></span>';
  nextBtn.title = 'Next match (Ctrl+Enter)';
  nextBtn.setAttribute('aria-label', 'Next match');
  nextBtn.onclick = e => {
    e.preventDefault();
    goToNextMatch(editor);
    searchInput.focus();
  };

  const closeBtn = document.createElement('button');
  closeBtn.className = 'search-overlay-btn search-overlay-close';
  closeBtn.innerHTML = '<span class="codicon codicon-close"></span>';
  closeBtn.title = 'Close (Escape)';
  closeBtn.setAttribute('aria-label', 'Close search');
  closeBtn.onclick = () => hideSearchOverlay(editor);

  buttonWrapper.appendChild(prevBtn);
  buttonWrapper.appendChild(nextBtn);
  buttonWrapper.appendChild(closeBtn);

  const findActions = document.createElement('div');
  findActions.className = 'search-overlay-find-actions';
  findActions.appendChild(toggleWrapper);
  findActions.appendChild(buttonWrapper);

  findRow.appendChild(inputWrapper);
  findRow.appendChild(findActions);

  // ── Replace row ──
  const replaceRow = document.createElement('div');
  replaceRow.className = 'search-overlay-replace-row';

  const replaceInputWrapper = document.createElement('div');
  replaceInputWrapper.className = 'search-overlay-input-wrapper';

  const replaceIcon = document.createElement('span');
  replaceIcon.className = 'search-overlay-icon codicon codicon-replace';
  replaceIcon.setAttribute('aria-hidden', 'true');

  const replaceInput = document.createElement('input');
  replaceInput.type = 'text';
  replaceInput.className = 'search-overlay-replace-input';
  replaceInput.placeholder = 'Replace with...';
  replaceInput.setAttribute('aria-label', 'Replace with');
  replaceInput.spellcheck = false;

  const replaceCounter = document.createElement('span');
  replaceCounter.className = 'search-overlay-replace-counter';
  replaceCounter.setAttribute('aria-live', 'polite');

  replaceInputWrapper.appendChild(replaceIcon);
  replaceInputWrapper.appendChild(replaceInput);
  replaceInputWrapper.appendChild(replaceCounter);

  const replaceBtn = document.createElement('button');
  replaceBtn.className = 'search-overlay-btn search-overlay-replace-btn';
  replaceBtn.textContent = 'Replace';
  replaceBtn.title = 'Replace current match (Enter)';
  replaceBtn.setAttribute('aria-label', 'Replace');
  replaceBtn.onclick = e => {
    e.preventDefault();
    replaceCurrentMatch(editor);
  };

  const replaceAllBtn = document.createElement('button');
  replaceAllBtn.className = 'search-overlay-btn search-overlay-replace-btn';
  replaceAllBtn.textContent = 'All';
  replaceAllBtn.title = 'Replace all matches (Ctrl+Shift+H)';
  replaceAllBtn.setAttribute('aria-label', 'Replace all');
  replaceAllBtn.onclick = e => {
    e.preventDefault();
    replaceAllMatches(editor);
    searchInput.focus();
  };

  const replaceActions = document.createElement('div');
  replaceActions.className = 'search-overlay-replace-actions';
  replaceActions.appendChild(replaceBtn);
  replaceActions.appendChild(replaceAllBtn);

  replaceRow.appendChild(replaceInputWrapper);
  replaceRow.appendChild(replaceActions);

  // ── Chevron toggle logic ──
  const updateChevron = () => {
    isReplaceVisible = !isReplaceVisible;
    chevronBtn.setAttribute('aria-expanded', String(isReplaceVisible));
    chevronBtn.innerHTML = isReplaceVisible
      ? '<span class="codicon codicon-chevron-down"></span>'
      : '<span class="codicon codicon-chevron-right"></span>';
    replaceRow.classList.toggle('visible', isReplaceVisible);
    if (isReplaceVisible) {
      setTimeout(() => replaceInput.focus(), 0);
    } else {
      searchInput.focus();
    }
  };

  chevronBtn.addEventListener('mousedown', e => {
    e.preventDefault();
    updateChevron();
  });

  // ── Assemble panel ──
  const rows = document.createElement('div');
  rows.className = 'search-overlay-rows';
  rows.appendChild(findRow);
  rows.appendChild(replaceRow);

  panel.appendChild(chevronBtn);
  panel.appendChild(rows);
  overlay.appendChild(panel);

  // ── Input events ──
  searchInput.addEventListener('input', () => {
    setReplaceCounter('');
    scheduleSearch(editor, searchInput.value);
  });

  searchInput.addEventListener('keydown', (e: KeyboardEvent) => {
    const isMod = e.metaKey || e.ctrlKey;

    if (isMod && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      e.stopPropagation();
      searchInput.select();
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      hideSearchOverlay(editor);
    } else if (e.key === 'Enter' && !isMod) {
      e.preventDefault();
      if (e.shiftKey) {
        goToPreviousMatch(editor);
      } else {
        goToNextMatch(editor);
      }
    } else if (e.key === 'Tab' && !e.shiftKey && isReplaceVisible) {
      e.preventDefault();
      replaceInput.focus();
    } else if (isMod && e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey) goToPreviousMatch(editor);
      else goToNextMatch(editor);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      goToNextMatch(editor);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      goToPreviousMatch(editor);
    }
  });

  replaceInput.addEventListener('keydown', (e: KeyboardEvent) => {
    const isMod = e.metaKey || e.ctrlKey;
    if (e.key === 'Escape') {
      e.preventDefault();
      hideSearchOverlay(editor);
    } else if (e.key === 'Tab' && e.shiftKey) {
      e.preventDefault();
      searchInput.focus();
    } else if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      searchInput.focus();
    } else if (e.key === 'Enter' && !isMod) {
      e.preventDefault();
      e.stopPropagation();
      replaceCurrentMatch(editor);
    } else if (isMod && e.shiftKey && e.key === 'H') {
      e.preventDefault();
      e.stopPropagation();
      replaceAllMatches(editor);
      searchInput.focus();
    }
  });

  overlay.addEventListener('keydown', (e: KeyboardEvent) => {
    if (document.activeElement === searchInput) return;
    if (document.activeElement === replaceInput) return;
    if (e.key !== 'Tab') e.stopPropagation();
  });

  document.body.appendChild(overlay);
  searchOverlayElement = overlay;

  return overlay;
}

// ─── Focus ────────────────────────────────────────────────────────────────────

function focusSearchInput(selectText = true) {
  const searchInput = searchOverlayElement?.querySelector(
    '.search-overlay-input'
  ) as HTMLInputElement | null;
  if (!searchInput) return;
  searchInput.focus();
  if (selectText) searchInput.select();
}

// ─── Show / Hide / Toggle ─────────────────────────────────────────────────────

export function showSearchOverlay(editor: Editor, openReplace = false): void {
  ensureSearchPlugin(editor);

  if (!isOverlayInDom()) {
    searchOverlayElement = null;
    createSearchOverlay(editor);
  }

  if (!searchOverlayElement) return;

  const { from, to } = editor.state.selection;
  savedSelection = { from, to };
  window.dispatchEvent(new CustomEvent('navRecordPosition', { detail: { pos: from, immediate: true } }));

  const selectedText = editor.state.doc.textBetween(from, to, ' ');

  searchOverlayElement.classList.add('visible');
  isVisible = true;

  // Sync replace row visibility
  if (openReplace && !isReplaceVisible) {
    isReplaceVisible = true;
    const chevron = searchOverlayElement.querySelector('.search-overlay-chevron');
    const replaceRow = searchOverlayElement.querySelector('.search-overlay-replace-row');
    if (chevron) {
      chevron.setAttribute('aria-expanded', 'true');
      chevron.innerHTML = '<span class="codicon codicon-chevron-down"></span>';
    }
    if (replaceRow) replaceRow.classList.add('visible');
  }

  showGutter(editor);

  const searchInput = searchOverlayElement.querySelector(
    '.search-overlay-input'
  ) as HTMLInputElement;
  if (searchInput && selectedText && selectedText.length > 0 && selectedText.length < 100) {
    searchInput.value = selectedText;
    performSearch(editor, selectedText);
  }

  if (openReplace && isReplaceVisible) {
    const replaceInput = searchOverlayElement?.querySelector(
      '.search-overlay-replace-input'
    ) as HTMLInputElement | null;
    replaceInput?.focus();
  } else {
    focusSearchInput();
  }
}

export function hideSearchOverlay(editor: Editor, restorePosition = false): void {
  if (!searchOverlayElement) return;

  searchOverlayElement.classList.remove('visible');
  isVisible = false;

  hideGutter();

  if (searchDebounceTimer) { clearTimeout(searchDebounceTimer); searchDebounceTimer = null; }

  currentQuery = '';
  currentMatches = [];
  currentMatchIndex = -1;

  clearSearchDecorations(editor);

  const searchInput = searchOverlayElement.querySelector(
    '.search-overlay-input'
  ) as HTMLInputElement | null;
  if (searchInput) {
    searchInput.value = '';
    searchInput.classList.remove('no-results');
  }

  const counter = searchOverlayElement.querySelector('.search-overlay-counter') as HTMLElement | null;
  if (counter) {
    counter.textContent = '';
    counter.classList.remove('no-results');
  }

  if (restorePosition && savedSelection) {
    try {
      editor.commands.setTextSelection(savedSelection);
    } catch {
      // ignore
    }
  }

  editor.commands.focus();
  // Record final landing position as breadcrumb
  window.dispatchEvent(new CustomEvent('navRecordPosition', { detail: { pos: editor.state.selection.from, immediate: true } }));
}

export function toggleSearchOverlay(editor: Editor): void {
  if (isVisible) {
    hideSearchOverlay(editor, true);
    showSearchOverlay(editor, false);
  } else {
    showSearchOverlay(editor, false);
  }
}

export function toggleReplaceOverlay(editor: Editor): void {
  if (!isVisible) {
    // Overlay not open — open it with replace row expanded
    showSearchOverlay(editor, true);
    return;
  }
  // Overlay already open — toggle the replace row like clicking the chevron
  if (!searchOverlayElement) return;
  isReplaceVisible = !isReplaceVisible;
  const chevron = searchOverlayElement.querySelector('.search-overlay-chevron');
  const replaceRow = searchOverlayElement.querySelector('.search-overlay-replace-row');
  if (chevron) {
    chevron.setAttribute('aria-expanded', String(isReplaceVisible));
    chevron.innerHTML = isReplaceVisible
      ? '<span class="codicon codicon-chevron-down"></span>'
      : '<span class="codicon codicon-chevron-right"></span>';
  }
  if (replaceRow) replaceRow.classList.toggle('visible', isReplaceVisible);
  if (isReplaceVisible) {
    setTimeout(() => {
      const replaceInput = searchOverlayElement?.querySelector('.search-overlay-replace-input') as HTMLInputElement | null;
      replaceInput?.focus();
    }, 50);
  } else {
    focusSearchInput();
  }
}

// ─── Public accessors ─────────────────────────────────────────────────────────

export function isSearchVisible(): boolean {
  return isVisible;
}

export function getCurrentMatches(): Array<{ from: number; to: number }> {
  return currentMatches;
}

export function getCurrentMatchIndex(): number {
  return currentMatchIndex;
}

export function searchNext(editor: Editor): void {
  goToNextMatch(editor);
}

export function searchPrev(editor: Editor): void {
  goToPreviousMatch(editor);
}

export function replaceAll(editor: Editor): void {
  replaceAllMatches(editor);
  const searchInput = searchOverlayElement?.querySelector('.search-overlay-input') as HTMLInputElement | null;
  if (searchInput) searchInput.focus();
}
