/**
 * Copyright (c) 2025-2026 Concret.io
 *
 * Licensed under the MIT License. See LICENSE file in the project root for details.
 */

import type { Editor, JSONContent } from '@tiptap/core';

type MarkdownManager = {
  serialize?: (json: JSONContent) => string;
};

function isMeaningfulInlineNode(node: JSONContent): boolean {
  if (!node || typeof node.type !== 'string') return false;

  if (node.type === 'hardBreak' || node.type === 'hard_break') return false;

  if (node.type === 'text') {
    const text = typeof node.text === 'string' ? node.text : '';
    return text.trim().length > 0;
  }

  return true;
}

function isEmptyParagraph(node: JSONContent): boolean {
  if (node.type !== 'paragraph') return false;

  const content = node.content;
  if (!Array.isArray(content) || content.length === 0) return true;

  return !content.some(isMeaningfulInlineNode);
}

export function stripEmptyDocParagraphsFromJson(doc: JSONContent): JSONContent {
  if (doc.type !== 'doc' || !Array.isArray(doc.content)) {
    return doc;
  }

  const nextContent = doc.content.filter(child => !isEmptyParagraph(child));

  return {
    ...doc,
    content: nextContent,
  };
}

/**
 * Fix trailing spaces inside marked text nodes in the TipTap JSON tree.
 *
 * When a user double-clicks a word to select it, the selection often includes
 * the trailing space. Applying a mark (bold, italic, etc.) then includes that
 * space inside the mark. TipTap serializes this as e.g. **word ** which is
 * invalid markdown. This function trims trailing spaces from marked text nodes
 * and moves them to the following text node (or inserts a new one), keeping
 * the space in the document but outside the mark.
 */
function fixTrailingSpacesInMarks(node: JSONContent): JSONContent {
  if (!Array.isArray(node.content) || node.content.length === 0) {
    return node;
  }

  const newContent: JSONContent[] = [];

  for (let i = 0; i < node.content.length; i++) {
    const child = node.content[i];

    // Recurse into block nodes
    if (Array.isArray(child.content)) {
      newContent.push(fixTrailingSpacesInMarks(child));
      continue;
    }

    // Only process marked text nodes
    if (child.type !== 'text' || !Array.isArray(child.marks) || child.marks.length === 0) {
      newContent.push(child);
      continue;
    }

    const text = typeof child.text === 'string' ? child.text : '';
    const trimmed = text.trimEnd();
    const trailingSpaces = text.slice(trimmed.length);

    if (!trailingSpaces) {
      newContent.push(child);
      continue;
    }

    // Push the marked node without trailing spaces
    newContent.push({ ...child, text: trimmed });

    // Move trailing spaces to the next sibling if it's an unmarked text node,
    // otherwise insert a new unmarked text node with the spaces.
    const next = node.content[i + 1];
    if (next && next.type === 'text' && (!next.marks || next.marks.length === 0)) {
      // Prepend spaces to next sibling — skip it in the loop and push modified version
      newContent.push({ ...next, text: trailingSpaces + (next.text ?? '') });
      i++; // skip next since we've consumed it
    } else {
      newContent.push({ type: 'text', text: trailingSpaces });
    }
  }

  return { ...node, content: newContent };
}

export function getEditorMarkdownForSync(editor: Editor): string {
  const editorUnknown = editor as unknown as {
    markdown?: MarkdownManager;
    storage?: {
      markdown?: MarkdownManager;
    };
    getMarkdown?: () => string;
  };

  const markdownManager = editorUnknown.markdown || editorUnknown.storage?.markdown;

  const getFallbackMarkdown = (): string => {
    const getMarkdown = editorUnknown.getMarkdown;
    if (typeof getMarkdown === 'function') {
      return getMarkdown.call(editor);
    }
    return '';
  };

  if (!markdownManager?.serialize || typeof editor.getJSON !== 'function') {
    return getFallbackMarkdown();
  }

  try {
    const json = editor.getJSON();
    const withFixedMarks = fixTrailingSpacesInMarks(json);
    const normalizedJson = stripEmptyDocParagraphsFromJson(withFixedMarks);
    return markdownManager.serialize(normalizedJson);
  } catch {
    return getFallbackMarkdown();
  }
}
