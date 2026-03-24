/** @jest-environment jsdom */

jest.mock('../../webview/displaySettings', () => ({
  editorDisplaySettings: {
    showHeadingGutter: true,
    showDocumentLineNumbers: true,
    showNavigationLineNumbers: false,
  },
}));

import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { ListKit } from '@tiptap/extension-list';
import { MarkdownParagraph } from '../../webview/extensions/markdownParagraph';
import { OrderedListMarkdownFix } from '../../webview/extensions/orderedListMarkdownFix';
import { LineNumbers, markdownLineToPos } from '../../webview/extensions/lineNumbers';

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
      LineNumbers,
    ],
    editorProps: {
      attributes: {
        class: 'markdown-editor show-line-numbers',
        spellcheck: 'true',
      },
    },
  });
}

describe('line number integration', () => {
  const originalRequestAnimationFrame = window.requestAnimationFrame;

  beforeEach(() => {
    jest.useFakeTimers();
    window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    }) as typeof window.requestAnimationFrame;
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    window.requestAnimationFrame = originalRequestAnimationFrame;
    document.body.innerHTML = '';
  });

  it('creates gutter labels for the reported nested inner bullets', () => {
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

      jest.advanceTimersByTime(800);

      const lineNumbers = Array.from(document.querySelectorAll('.line-number-gutter .gutter-line-num'))
        .map(node => node.textContent);

      expect(lineNumbers).toEqual(
        expect.arrayContaining(['L3', 'L4', 'L5', 'L6', 'L7', 'L8', 'L9'])
      );
    } finally {
      editor.destroy();
    }
  });

  it('clicking the parent list line does not select nested child list items', () => {
    const editor = createTestEditor();

    try {
      editor.commands.setContent(
        [
          'Forgone after-tax salary related to childbirth (limited to 40,000 per month after taxes):',
          '',
          '2. Forgone after-tax salary related to childbirth (limited to 40,000 per month after taxes):',
          '',
          '  - After-tax salary for a period not to exceed two (2) months prior to an anticipated birth, to the extent not otherwise paid (for example, as a workplace benefit), which period may be extended on a physician\'s order.',
          '  - After-tax salary for up to one (1) year following childbirth, to the extent not otherwise paid (for example, as a workplace benefit).',
        ].join('\n'),
        { contentType: 'markdown' }
      );

      jest.advanceTimersByTime(800);

      const label = Array.from(document.querySelectorAll('.line-number-gutter'))
        .find(node => node.textContent?.includes('L3'));
      expect(label).toBeDefined();

      label!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      const selection = editor.state.selection;
      const nextLinePos = markdownLineToPos(editor, 5);

      expect(selection.from).toBe(markdownLineToPos(editor, 3));
      expect(selection.to).toBeLessThan(nextLinePos);
    } finally {
      editor.destroy();
    }
  });
});
