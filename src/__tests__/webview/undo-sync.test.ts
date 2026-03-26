/** @jest-environment jsdom */

/**
 * Regression tests for webview undo/redo guards.
 *
 * We avoid initializing TipTap by mocking document.readyState as "loading"
 * so initializeEditor is never invoked during module import.
 */

// Mock TipTap and related heavy dependencies to avoid DOM requirements
jest.mock('@tiptap/core', () => ({
  Editor: jest.fn(),
  Extension: { create: (config: unknown) => config },
}));
jest.mock('@tiptap/starter-kit', () => ({ __esModule: true, default: { configure: () => ({}) } }));
jest.mock('@tiptap/markdown', () => ({ Markdown: { configure: () => ({}) } }));
jest.mock('lowlight', () => ({ __esModule: true, lowlight: { registerLanguage: jest.fn() } }));
jest.mock('@tiptap/extension-table', () => ({
  __esModule: true,
  TableKit: { configure: () => ({}) },
}));
jest.mock('@tiptap/extension-list', () => ({
  __esModule: true,
  ListKit: { configure: () => ({}) },
  OrderedList: { extend: (config: unknown) => config },
}));
jest.mock('@tiptap/extension-link', () => ({
  __esModule: true,
  default: { configure: () => ({}) },
}));
jest.mock('@tiptap/extension-code-block-lowlight', () => ({
  __esModule: true,
  default: { configure: () => ({}) },
}));
jest.mock('./../../webview/extensions/customImage', () => ({
  CustomImage: { configure: () => ({}) },
}));
jest.mock('./../../webview/extensions/mermaid', () => ({ Mermaid: {} }));
jest.mock('./../../webview/extensions/tabIndentation', () => ({ TabIndentation: {} }));
jest.mock('./../../webview/extensions/imageEnterSpacing', () => ({ ImageEnterSpacing: {} }));
jest.mock('./../../webview/extensions/markdownParagraph', () => ({ MarkdownParagraph: {} }));
jest.mock('./../../webview/extensions/githubAlerts', () => ({ GitHubAlert: {} }));
jest.mock('./../../webview/BubbleMenuView', () => ({
  createFormattingToolbar: () => ({}),
  createTableMenu: () => ({}),
  openGotoLineInput: jest.fn(() => false),
  setVisibleGotoLineInputValue: jest.fn(() => false),
  updateToolbarStates: jest.fn(),
}));
jest.mock('./../../webview/features/imageDragDrop', () => ({
  setupImageDragDrop: jest.fn(),
  hasPendingImageSaves: jest.fn(() => false),
  getPendingImageCount: jest.fn(() => 0),
}));
jest.mock('./../../webview/features/tocOverlay', () => ({ toggleTocOverlay: jest.fn() }));
jest.mock('./../../webview/features/searchOverlay', () => ({
  toggleSearchOverlay: jest.fn(),
  toggleReplaceOverlay: jest.fn(),
  isSearchVisible: jest.fn(() => false),
  hideSearchOverlay: jest.fn(),
  focusVisibleSearchInput: jest.fn(),
  searchNext: jest.fn(),
  searchPrev: jest.fn(),
  replaceAll: jest.fn(),
  consumePendingSelectionNavigationHistorySuppression: jest.fn(() => false),
}));
jest.mock('./../../webview/utils/exportContent', () => ({
  collectExportContent: jest.fn(),
  getDocumentTitle: jest.fn(),
}));
jest.mock('./../../webview/utils/pasteHandler', () => ({
  processPasteContent: jest.fn(() => ({ isImage: false, wasConverted: false, content: '' })),
}));
jest.mock('./../../webview/utils/copyMarkdown', () => ({ copySelectionAsMarkdown: jest.fn() }));
jest.mock('./../../webview/utils/outline', () => ({ buildOutlineFromEditor: jest.fn(() => []) }));
jest.mock('./../../webview/utils/scrollToHeading', () => ({ scrollToHeading: jest.fn() }));

const posToMarkdownLineMock: jest.Mock<any, any> = jest.fn(() => 1);
const markdownLineToSelectionRangeMock: jest.Mock<any, any> = jest.fn(
  (editor: any) => editor?.state?.doc?.lineRange ?? null
);

jest.mock('./../../webview/extensions/lineNumbers', () => ({
  LineNumbers: {},
  setDocumentFilename: jest.fn(),
  posToMarkdownLine: (editor: unknown, pos: unknown) => posToMarkdownLineMock(editor, pos),
  markdownLineToPos: jest.fn(() => 1),
  markdownLineToSelectionRange: (editor: unknown, line: unknown) =>
    markdownLineToSelectionRangeMock(editor, line),
  installGutterResizeObserver: jest.fn(),
}));

type TestingModule = {
  resetSyncState: () => void;
  setMockEditor: (editor: unknown) => void;
  trackSentContentForTests: (content: string) => void;
  updateEditorContentForTests: (content: string) => void;
  selectionIsInEmptyParagraphForTests: (editor: unknown) => boolean;
};

describe('webview undo/redo guards', () => {
  let testing: TestingModule;
  const originalReadyStateDescriptor = Object.getOwnPropertyDescriptor(document, 'readyState');

  const setupModule = async () => {
    jest.resetModules();

    Object.defineProperty(document, 'readyState', {
      configurable: true,
      value: 'loading',
    });
    (
      global as unknown as {
        acquireVsCodeApi: () => {
          postMessage: jest.Mock;
          getState: jest.Mock;
          setState: jest.Mock;
        };
      }
    ).acquireVsCodeApi = jest.fn(() => ({
      postMessage: jest.fn(),
      getState: jest.fn(),
      setState: jest.fn(),
    }));
    window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    }) as typeof requestAnimationFrame;

    const mod = await import('../../webview/editor');
    testing = mod.__testing;
  };

  beforeEach(async () => {
    await setupModule();
    testing.resetSyncState();
    posToMarkdownLineMock.mockClear();
    posToMarkdownLineMock.mockReturnValue(1);
    markdownLineToSelectionRangeMock.mockClear();
    markdownLineToSelectionRangeMock.mockImplementation((editor: any) => editor?.state?.doc?.lineRange ?? null);
  });

  afterAll(() => {
    if (originalReadyStateDescriptor) {
      Object.defineProperty(document, 'readyState', originalReadyStateDescriptor);
    }
  });

  it('skips update when content matches recently sent hash', () => {
    const mockEditor = {
      getMarkdown: jest.fn().mockReturnValue('old'),
      state: { selection: { from: 0, to: 0 }, doc: { content: { size: 0 } } },
      commands: { setContent: jest.fn(), setTextSelection: jest.fn() },
    };

    testing.setMockEditor(mockEditor);
    // Track content we "sent" - this should cause the update to be skipped
    testing.trackSentContentForTests('new');

    testing.updateEditorContentForTests('new');

    expect(mockEditor.commands.setContent).not.toHaveBeenCalled();
  });

  it('skips update when content is unchanged', () => {
    const mockEditor = {
      getMarkdown: jest.fn().mockReturnValue('same'),
      state: { selection: { from: 1, to: 1 }, doc: { content: { size: 10 } } },
      commands: { setContent: jest.fn(), setTextSelection: jest.fn() },
    };

    testing.setMockEditor(mockEditor);

    testing.updateEditorContentForTests('same');

    expect(mockEditor.commands.setContent).not.toHaveBeenCalled();
  });

  it('applies update when content changes', () => {
    const mockEditor = {
      getMarkdown: jest.fn().mockReturnValue('old'),
      state: { selection: { from: 2, to: 4 }, doc: { content: { size: 5 }, lineRange: null } },
      commands: { setContent: jest.fn(), setTextSelection: jest.fn() },
    };

    testing.setMockEditor(mockEditor);

    testing.updateEditorContentForTests('new content');

    // @tiptap/markdown v3 requires contentType option
    expect(mockEditor.commands.setContent).toHaveBeenCalledWith('new content', {
      contentType: 'markdown',
    });
    expect(mockEditor.commands.setTextSelection).toHaveBeenCalledWith({ from: 2, to: 4 });
  });

  it('clamps a collapsed caret to the end of the same line when that line is trimmed', () => {
    const mockEditor = {
      getMarkdown: jest.fn().mockReturnValue('Heading '),
      state: {
        selection: { from: 5, to: 5 },
        doc: { content: { size: 8 }, lineRange: { from: 1, to: 5 } },
      },
      commands: {
        setContent: jest.fn(() => {
          mockEditor.state.doc = { content: { size: 7 }, lineRange: { from: 1, to: 4 } };
        }),
        setTextSelection: jest.fn(),
      },
    };

    testing.setMockEditor(mockEditor);

    testing.updateEditorContentForTests('Heading');

    expect(mockEditor.commands.setContent).toHaveBeenCalledWith('Heading', {
      contentType: 'markdown',
    });
    expect(mockEditor.commands.setTextSelection).toHaveBeenCalledWith(4);
  });

  it('treats a collapsed caret in an empty paragraph as a deferred-sync state', () => {
    const mockEditor = {
      state: {
        selection: {
          empty: true,
          $from: {
            parent: {
              type: { name: 'paragraph' },
              textContent: '',
              content: { size: 0, firstChild: undefined },
            },
          },
        },
      },
    };

    expect(testing.selectionIsInEmptyParagraphForTests(mockEditor as never)).toBe(true);
  });
});
