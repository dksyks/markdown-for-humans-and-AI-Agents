/**
 * Copyright (c) 2025-2026 Concret.io
 *
 * Licensed under the MIT License. See LICENSE file in the project root for details.
 */

declare const __BUILD_TIME__: string;
const BUILD_TAG = `[MD4H ${__BUILD_TIME__}]`;

import { Editor } from '@tiptap/core';

export function scrollToPos(editor: Editor, pos: number, noFocus = false, centerInViewport = false) {
  if (!noFocus) {
    editor.commands.setTextSelection(pos);
    editor.commands.focus();
  }

  requestAnimationFrame(() => {
    try {
      const view = editor.view;
      const domPos = view.domAtPos(pos);
      let node: Node = domPos.node;
      if (node.nodeType === Node.TEXT_NODE) {
        node = node.parentElement as HTMLElement;
      }
      const target = node as HTMLElement;

      const toolbar = document.querySelector('.formatting-toolbar');
      const toolbarHeight = toolbar ? toolbar.getBoundingClientRect().height : 0;
      const planOverlay = document.querySelector('.plan-overlay') as HTMLElement | null;
      let offset: number;
      if (planOverlay) {
        // Plan overlay is fixed below the toolbar — use its bottom edge as the offset
        const planRect = planOverlay.getBoundingClientRect();
        offset = planRect.top + planRect.height + 16;
      } else {
        offset = toolbarHeight + 16;
      }

      const scrollContainer = document.documentElement;
      const targetRect = target.getBoundingClientRect();
      const currentScrollTop = scrollContainer.scrollTop;

      if (centerInViewport) {
        const visibleTop = offset;
        const visibleBottomPadding = 16;
        const visibleHeight = Math.max(0, window.innerHeight - visibleTop - visibleBottomPadding);
        const desiredTop = visibleTop + visibleHeight / 2 - targetRect.height / 2;
        scrollContainer.scrollTop = currentScrollTop + targetRect.top - desiredTop;
        return;
      }

      // Only scroll if the target is obscured by the toolbar or out of view
      if (targetRect.top < offset) {
        scrollContainer.scrollTop = currentScrollTop + targetRect.top - offset;
      } else if (targetRect.bottom > window.innerHeight) {
        scrollContainer.scrollTop = currentScrollTop + targetRect.bottom - window.innerHeight + 16;
      }
    } catch (error) {
      console.warn(`${BUILD_TAG} Could not scroll to position:`, error);
    }
  });
}

export function scrollToHeading(editor: Editor, pos: number) {
  // pos is the node boundary (before the heading). pos+1 is inside the content.
  const contentPos = pos + 1;
  editor.commands.setTextSelection(contentPos);
  editor.commands.focus();

  // Scroll after DOM updates
  requestAnimationFrame(() => {
    try {
      const view = editor.view;
      const domPos = view.domAtPos(contentPos);

      let headingElement: Node;
      if (
        domPos.node.nodeType === Node.ELEMENT_NODE &&
        domPos.offset < domPos.node.childNodes.length
      ) {
        headingElement = domPos.node.childNodes[domPos.offset];
      } else {
        headingElement = domPos.node;
      }

      if (headingElement.nodeType === Node.TEXT_NODE) {
        headingElement = headingElement.parentElement as HTMLElement;
      }

      let target = headingElement as HTMLElement;
      let depth = 0;
      while (target && !target.matches?.('h1, h2, h3, h4, h5, h6')) {
        target = target.parentElement as HTMLElement;
        depth++;
        if (depth > 10) break;
      }

      if (target) {
        const toolbar = document.querySelector('.formatting-toolbar');
        const toolbarHeight = toolbar ? toolbar.getBoundingClientRect().height : 0;
        const offset = toolbarHeight + 16;

        const scrollContainer = document.documentElement;
        const targetRect = target.getBoundingClientRect();
        const scrollTop = scrollContainer.scrollTop + targetRect.top - offset;

        scrollContainer.scrollTop = scrollTop;
      }
    } catch (error) {
      console.warn('[Outline] Could not scroll to heading:', error);
    }
  });
}
