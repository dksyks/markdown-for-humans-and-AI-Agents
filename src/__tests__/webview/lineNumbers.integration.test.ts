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
import { GitHubAlerts } from '../../webview/extensions/githubAlerts';
import { MarkdownParagraph } from '../../webview/extensions/markdownParagraph';
import { OrderedListMarkdownFix } from '../../webview/extensions/orderedListMarkdownFix';
import { __testing as lineNumberTesting, LineNumbers, markdownLineToPos } from '../../webview/extensions/lineNumbers';
import { getEditorMarkdownForSync } from '../../webview/utils/markdownSerialization';

function createTestEditor(): Editor {
  const element = document.createElement('div');
  document.body.appendChild(element);

  return new Editor({
    element,
    extensions: [
      GitHubAlerts,
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
    lineNumberTesting.resetLineNumberPluginState();
    window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    }) as typeof window.requestAnimationFrame;
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    lineNumberTesting.resetLineNumberPluginState();
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
      const parentLinePos = markdownLineToPos(editor, 3);
      const nextLinePos = markdownLineToPos(editor, 5);

      expect(selection.from).toBeGreaterThanOrEqual(parentLinePos);
      expect(selection.from).toBeLessThan(nextLinePos);
      expect(selection.to).toBeLessThan(nextLinePos);
    } finally {
      editor.destroy();
    }
  });

  it('keeps later gutter labels visible while typing inside a GitHub alert before the deferred refresh', () => {
    const editor = createTestEditor();

    try {
      editor.commands.setContent(
        [
          '> [!COMMENT]',
          '> Draft note',
          '',
          'After alert paragraph',
        ].join('\n'),
        { contentType: 'markdown' }
      );

      jest.advanceTimersByTime(800);

      const initialLabels = Array.from(document.querySelectorAll('.line-number-gutter .gutter-line-num'))
        .map(node => node.textContent);
      expect(initialLabels).toEqual(expect.arrayContaining(['L1', 'L2', 'L4']));

      const alertContentPos = markdownLineToPos(editor, 2);
      expect(alertContentPos).toBeGreaterThan(0);

      editor.commands.setTextSelection(alertContentPos);
      editor.commands.insertContent('x');

      const labelsWhileTyping = Array.from(document.querySelectorAll('.line-number-gutter .gutter-line-num'))
        .map(node => node.textContent);
      expect(labelsWhileTyping).toEqual(expect.arrayContaining(['L1', 'L2', 'L4']));
    } finally {
      editor.destroy();
    }
  });

  it('does not schedule a deferred line-number rebuild after ordinary inline typing', () => {
    const editor = createTestEditor();

    try {
      editor.commands.setContent(
        [
          'alpha',
          '',
          'beta',
          '',
          'gamma',
        ].join('\n'),
        { contentType: 'markdown' }
      );

      jest.advanceTimersByTime(800);

      const buildCountBeforeTyping = lineNumberTesting.getLineNumberBuildCount();
      const betaPos = markdownLineToPos(editor, 3);
      expect(betaPos).toBeGreaterThan(0);

      editor.commands.setTextSelection(betaPos + 1);
      editor.commands.insertContent('x');

      expect(lineNumberTesting.isLineNumberRefreshScheduled()).toBe(false);

      jest.advanceTimersByTime(800);

      expect(lineNumberTesting.getLineNumberBuildCount()).toBe(buildCountBeforeTyping);
    } finally {
      editor.destroy();
    }
  });

  it('does not require a second undo after waiting following an inline delete', () => {
    const editor = createTestEditor();

    try {
      editor.commands.setContent(
        [
          'abc',
          '',
          'After paragraph',
        ].join('\n'),
        { contentType: 'markdown' }
      );

      jest.advanceTimersByTime(800);

      const lineOnePos = markdownLineToPos(editor, 1);
      expect(lineOnePos).toBeGreaterThan(0);

      editor.commands.setTextSelection({ from: lineOnePos + 1, to: lineOnePos + 2 });
      editor.commands.deleteSelection();

      expect(getEditorMarkdownForSync(editor)).toContain('ac');

      jest.advanceTimersByTime(800);

      editor.commands.undo();

      expect(getEditorMarkdownForSync(editor)).toContain('abc');
    } finally {
      editor.destroy();
    }
  });

  it('does not schedule a deferred line-number rebuild after deleting inline heading text', () => {
    const editor = createTestEditor();

    try {
      editor.commands.setContent(
        [
          '# Heading text',
          '',
          'After paragraph',
        ].join('\n'),
        { contentType: 'markdown' }
      );

      jest.advanceTimersByTime(800);

      const buildCountBeforeDelete = lineNumberTesting.getLineNumberBuildCount();
      const headingPos = markdownLineToPos(editor, 1);
      expect(headingPos).toBeGreaterThan(0);

      editor.commands.setTextSelection({ from: headingPos + 1, to: headingPos + 8 });
      editor.commands.deleteSelection();

      expect(lineNumberTesting.isLineNumberRefreshScheduled()).toBe(false);

      jest.advanceTimersByTime(800);

      expect(lineNumberTesting.getLineNumberBuildCount()).toBe(buildCountBeforeDelete);
      expect(editor.state.selection.from).toBe(editor.state.selection.to);
    } finally {
      editor.destroy();
    }
  });

  it('preserves unchanged prefix gutter widgets when a later line-number refresh rebuilds the suffix', () => {
    const editor = createTestEditor();

    try {
      editor.commands.setContent(
        [
          'alpha',
          '',
          'beta',
          '',
          'gamma',
        ].join('\n'),
        { contentType: 'markdown' }
      );

      jest.advanceTimersByTime(800);

      const firstLineWidget = Array.from(document.querySelectorAll('.line-number-gutter')).find(
        node => node.textContent?.includes('L1')
      ) as HTMLElement | undefined;
      expect(firstLineWidget).toBeTruthy();

      const betaPos = markdownLineToPos(editor, 3);
      expect(betaPos).toBeGreaterThan(0);

      editor.commands.setTextSelection(betaPos + 1);
      editor.commands.insertContent({ type: 'hardBreak' });

      jest.advanceTimersByTime(800);

      const refreshedFirstLineWidget = Array.from(document.querySelectorAll('.line-number-gutter')).find(
        node => node.textContent?.includes('L1')
      ) as HTMLElement | undefined;
      const refreshedLabels = Array.from(document.querySelectorAll('.line-number-gutter .gutter-line-num'))
        .map(node => node.textContent);

      expect(refreshedFirstLineWidget).toBe(firstLineWidget);
      expect(refreshedLabels).toEqual(expect.arrayContaining(['L1', 'L3', 'L6']));
    } finally {
      editor.destroy();
    }
  });

  it('rebuilds the visible gutter first and then fills the rest in background chunks', () => {
    const editor = createTestEditor();
    const originalInnerHeight = window.innerHeight;

    try {
      editor.commands.setContent(
        Array.from({ length: 18 }, (_, index) => `paragraph ${index + 1}`).join('\n\n'),
        { contentType: 'markdown' }
      );

      jest.advanceTimersByTime(800);

      Object.defineProperty(window, 'innerHeight', {
        configurable: true,
        value: 120,
      });

      Array.from(editor.view.dom.children).forEach((child, index) => {
        Object.defineProperty(child, 'getBoundingClientRect', {
          configurable: true,
          value: () => ({
            top: index * 160,
            left: 0,
            right: 200,
            bottom: index * 160 + 40,
            width: 200,
            height: 40,
            x: 0,
            y: index * 160,
            toJSON: () => ({}),
          }),
        });
      });

      const firstParagraphPos = markdownLineToPos(editor, 1);
      expect(firstParagraphPos).toBeGreaterThan(0);

      editor.commands.setTextSelection(firstParagraphPos + 1);
      editor.commands.insertContent({ type: 'hardBreak' });

      jest.advanceTimersByTime(500);

      expect(lineNumberTesting.getLastLineNumberBuildStats()).toEqual(
        expect.objectContaining({
          refreshMode: 'visible',
        })
      );
      expect(lineNumberTesting.getLastLineNumberBuildStats().rebuiltBlocks).toBeLessThan(
        lineNumberTesting.getLastLineNumberBuildStats().totalBlocks
      );

      jest.advanceTimersByTime(20);

      expect(lineNumberTesting.getLastLineNumberBuildStats()).toEqual(
        expect.objectContaining({
          refreshMode: 'chunk',
        })
      );
    } finally {
      Object.defineProperty(window, 'innerHeight', {
        configurable: true,
        value: originalInnerHeight,
      });
      editor.destroy();
    }
  });

  it('rebuilds only the affected suffix on later structural refreshes', () => {
    const editor = createTestEditor();

    try {
      editor.commands.setContent(
        [
          'alpha',
          '',
          'beta',
          '',
          'gamma',
          '',
          'delta',
        ].join('\n'),
        { contentType: 'markdown' }
      );

      jest.advanceTimersByTime(800);

      const betaPos = markdownLineToPos(editor, 3);
      expect(betaPos).toBeGreaterThan(0);

      editor.commands.setTextSelection(betaPos + 1);
      editor.commands.insertContent({ type: 'hardBreak' });
      jest.advanceTimersByTime(800);

      const deltaPos = markdownLineToPos(editor, 8);
      expect(deltaPos).toBeGreaterThan(0);
      editor.commands.setTextSelection(deltaPos + 1);
      editor.commands.insertContent({ type: 'hardBreak' });
      expect(lineNumberTesting.isLineNumberRefreshScheduled()).toBe(true);

      jest.advanceTimersByTime(800);

      expect(lineNumberTesting.getLastLineNumberBuildStats()).toEqual(
        expect.objectContaining({
          cutoffOffset: expect.any(Number),
        })
      );
      expect(lineNumberTesting.getLastLineNumberBuildStats().preservedDecorations).toBeGreaterThan(0);
      expect(lineNumberTesting.getLastLineNumberBuildStats().rebuiltBlocks).toBeLessThan(
        lineNumberTesting.getLastLineNumberBuildStats().totalBlocks
      );
    } finally {
      editor.destroy();
    }
  });
});
