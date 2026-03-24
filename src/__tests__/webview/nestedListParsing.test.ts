/** @jest-environment jsdom */

import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { ListKit } from '@tiptap/extension-list';
import { MarkdownParagraph } from '../../webview/extensions/markdownParagraph';
import { OrderedListMarkdownFix } from '../../webview/extensions/orderedListMarkdownFix';

function createTestEditor(): Editor {
  const element = document.createElement('div');
  document.body.appendChild(element);

  return new Editor({
    element,
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3, 4, 5, 6],
        },
        paragraph: false,
        codeBlock: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        listKeymap: false,
        undoRedo: {
          depth: 100,
        },
      }),
      MarkdownParagraph,
      Markdown.configure({
        markedOptions: {
          gfm: true,
          breaks: true,
        },
      }),
      ListKit.configure({
        orderedList: false,
        taskItem: {
          nested: true,
        },
      }),
      OrderedListMarkdownFix,
    ],
    editorProps: {
      attributes: {
        class: 'markdown-editor',
        spellcheck: 'true',
      },
    },
  });
}

describe('nested list parsing', () => {
  it('parses the reported two-space-indented inner bullets as nested list items', () => {
    const editor = createTestEditor();

    try {
      editor.commands.setContent(
        [
          'Disbursement Ineligibility lasts for an entire calendar year.  While Disbursement Ineligible:',
          '',
          '- The Beneficiary shall not receive any disbursements from the Trust',
          '- Trust account values, however, continue to change with the market',
          '- If the Beneficiary is a Committee Member,',
          "  - she still participates in approving other Committee Members' transfers and disbursements",
          "  - she still suffers scoring penalties if they vote to approve Excess Disbursements",
          "- The Beneficiary's event record continues to be maintained, and the Stewardship Score may change as provided in Section 12, even while Disbursement Ineligible",
          '- The year does NOT, however, count for a year as a Good Steward and the Beneficiary does NOT advance in the 25-year Stewardship Progression',
        ].join('\n'),
        { contentType: 'markdown' }
      );

      expect(editor.getHTML()).toContain('<ul>');
      expect(editor.getHTML()).toContain("<li><p>If the Beneficiary is a Committee Member,</p><ul>");

      const json = editor.getJSON() as any;
      const outerList = json.content?.[1];
      expect(outerList?.type).toBe('bulletList');
      const committeeItem = outerList?.content?.[2];
      expect(committeeItem?.type).toBe('listItem');
      expect(committeeItem?.content?.[1]?.type).toBe('bulletList');
      expect(committeeItem?.content?.[1]?.content).toHaveLength(2);
    } finally {
      editor.destroy();
    }
  });
});
