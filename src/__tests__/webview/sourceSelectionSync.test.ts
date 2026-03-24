/** @jest-environment jsdom */

export {};

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
jest.mock('./../../webview/extensions/githubAlerts', () => ({ GitHubAlerts: {} }));
jest.mock('./../../webview/extensions/lineNumbers', () => ({
  LineNumbers: {},
  setDocumentFilename: jest.fn(),
  posToMarkdownLine: jest.fn(() => 1),
  markdownLineToPos: jest.fn(),
  markdownLineToSelectionRange: jest.fn(),
  installGutterResizeObserver: jest.fn(),
}));
jest.mock('./../../webview/BubbleMenuView', () => ({
  createFormattingToolbar: () => ({}),
  createTableMenu: () => ({}),
  updateToolbarStates: jest.fn(),
  updateDisplaySettings: jest.fn(),
}));
jest.mock('./../../webview/features/imageDragDrop', () => ({
  setupImageDragDrop: jest.fn(),
  hasPendingImageSaves: jest.fn(() => false),
  getPendingImageCount: jest.fn(() => 0),
}));
jest.mock('./../../webview/features/tocOverlay', () => ({
  toggleTocOverlay: jest.fn(),
  setTocPanelWidth: jest.fn(),
  showTocOverlay: jest.fn(),
  isTocVisible: jest.fn(() => false),
  updateActiveHeading: jest.fn(),
  refreshTocList: jest.fn(),
}));
jest.mock('./../../webview/features/searchOverlay', () => ({
  toggleSearchOverlay: jest.fn(),
  toggleReplaceOverlay: jest.fn(),
  isSearchVisible: jest.fn(() => false),
  searchNext: jest.fn(),
  searchPrev: jest.fn(),
  replaceAll: jest.fn(),
}));
jest.mock('./../../webview/utils/exportContent', () => ({
  collectExportContent: jest.fn(),
  getDocumentTitle: jest.fn(),
}));
jest.mock('./../../webview/utils/pasteHandler', () => ({
  processPasteContent: jest.fn(() => ({ isImage: false, wasConverted: false, content: '' })),
  parseFencedCode: jest.fn(),
}));
jest.mock('./../../webview/utils/copyMarkdown', () => ({
  copySelectionAsMarkdown: jest.fn(),
  getRangeAsMarkdown: jest.fn(),
  getSelectionAsMarkdown: jest.fn(),
}));
jest.mock('./../../webview/utils/outline', () => ({ buildOutlineFromEditor: jest.fn(() => []) }));
jest.mock('./../../webview/utils/scrollToHeading', () => ({
  scrollToHeading: jest.fn(),
  scrollToPos: jest.fn(),
}));

type SourceSelectionSyncPayload = {
  activeLine: number;
  startLine: number;
  endLine: number;
  isEmpty: boolean;
  viewportRatio?: number | null;
};

type SourceSyncTestingModule = {
  resetSyncState: () => void;
  setMockEditor: (editor: unknown) => void;
  applySourceSelectionSyncForTests: (payload: SourceSelectionSyncPayload) => boolean;
  postSourceSyncForTests: (options?: { force?: boolean; reason?: string }) => void;
};

describe('webview source selection sync', () => {
  let testing: SourceSyncTestingModule;
  let markdownLineToPosMock: jest.Mock;
  let markdownLineToSelectionRangeMock: jest.Mock;
  let posToMarkdownLineMock: jest.Mock;
  let mockVsCodeApi: {
    postMessage: jest.Mock;
    getState: jest.Mock;
    setState: jest.Mock;
  };
  const originalReadyStateDescriptor = Object.getOwnPropertyDescriptor(document, 'readyState');

  const setupModule = async () => {
    jest.resetModules();

    Object.defineProperty(document, 'readyState', {
      configurable: true,
      value: 'loading',
    });
    mockVsCodeApi = {
      postMessage: jest.fn(),
      getState: jest.fn(),
      setState: jest.fn(),
    };
    (
      global as unknown as {
        acquireVsCodeApi: () => {
          postMessage: jest.Mock;
          getState: jest.Mock;
          setState: jest.Mock;
        };
      }
    ).acquireVsCodeApi = jest.fn(() => mockVsCodeApi);

    const lineNumbersModule = jest.requireMock('../../webview/extensions/lineNumbers') as {
      posToMarkdownLine: jest.Mock;
      markdownLineToPos: jest.Mock;
      markdownLineToSelectionRange: jest.Mock;
    };
    posToMarkdownLineMock = lineNumbersModule.posToMarkdownLine;
    markdownLineToPosMock = lineNumbersModule.markdownLineToPos;
    markdownLineToSelectionRangeMock = lineNumbersModule.markdownLineToSelectionRange;

    const mod = await import('../../webview/editor');
    testing = mod.__testing;
  };

  beforeEach(async () => {
    jest.useFakeTimers();
    await setupModule();
    testing.resetSyncState();
    posToMarkdownLineMock.mockReset();
    markdownLineToPosMock.mockReset();
    markdownLineToSelectionRangeMock.mockReset();
    mockVsCodeApi.postMessage.mockReset();
  });

  afterEach(() => {
    testing?.resetSyncState();
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  afterAll(() => {
    if (originalReadyStateDescriptor) {
      Object.defineProperty(document, 'readyState', originalReadyStateDescriptor);
    }
  });

  it('maps an empty source selection to a collapsed MFH cursor', () => {
    const mockEditor = {
      commands: {
        setTextSelection: jest.fn(),
      },
    };

    markdownLineToPosMock.mockReturnValue(70);
    testing.setMockEditor(mockEditor);

    const result = testing.applySourceSelectionSyncForTests({
      activeLine: 7,
      startLine: 7,
      endLine: 7,
      isEmpty: true,
    });

    expect(result).toBe(true);
    expect(mockEditor.commands.setTextSelection).toHaveBeenCalledWith(70);
    expect(markdownLineToSelectionRangeMock).not.toHaveBeenCalled();
  });

  it('maps a non-empty source selection to the corresponding MFH block range', () => {
    const mockEditor = {
      commands: {
        setTextSelection: jest.fn(),
      },
    };

    markdownLineToPosMock.mockReturnValue(130);
    markdownLineToSelectionRangeMock.mockImplementation((_editor: unknown, line: number) => {
      if (line === 10) {
        return { from: 100, to: 120 };
      }
      if (line === 12) {
        return { from: 130, to: 150 };
      }
      return null;
    });
    testing.setMockEditor(mockEditor);

    const result = testing.applySourceSelectionSyncForTests({
      activeLine: 12,
      startLine: 10,
      endLine: 12,
      isEmpty: false,
    });

    expect(result).toBe(true);
    expect(markdownLineToSelectionRangeMock).toHaveBeenNthCalledWith(1, mockEditor, 10);
    expect(markdownLineToSelectionRangeMock).toHaveBeenNthCalledWith(2, mockEditor, 12);
    expect(mockEditor.commands.setTextSelection).toHaveBeenCalledWith({
      from: 100,
      to: 150,
    });
  });

  it('posts a whole-line source selection payload for MFH selections', () => {
    const mockEditor = {
      state: {
        selection: {
          from: 100,
          to: 150,
          empty: false,
          head: 150,
        },
      },
    };

    posToMarkdownLineMock.mockImplementation((_editor: unknown, pos: number) => {
      if (pos === 100) {
        return 10;
      }
      if (pos === 149 || pos === 150) {
        return 12;
      }
      return -1;
    });
    testing.setMockEditor(mockEditor);

    testing.postSourceSyncForTests({ reason: 'test-selection' });

    expect(mockVsCodeApi.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'syncSourceSelection',
        reason: 'test-selection',
        activeLine: 12,
        startLine: 10,
        endLine: 12,
        isEmpty: false,
        viewportRatio: null,
      })
    );
  });
});
