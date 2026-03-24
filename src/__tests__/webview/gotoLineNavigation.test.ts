/** @jest-environment jsdom */

const markdownLineToPosMock = jest.fn();
const scrollToPosMock = jest.fn();
const getEditorMarkdownForSyncMock = jest.fn((_editor?: unknown) => 'one\ntwo\nthree');

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
jest.mock('./../../webview/extensions/orderedListMarkdownFix', () => ({ OrderedListMarkdownFix: {} }));
jest.mock('./../../webview/extensions/indentedImageCodeBlock', () => ({ IndentedImageCodeBlock: {} }));
jest.mock('./../../webview/extensions/spaceFriendlyImagePaths', () => ({ SpaceFriendlyImagePaths: {} }));
jest.mock('./../../webview/extensions/lineNumbers', () => ({
  LineNumbers: {},
  setDocumentFilename: jest.fn(),
  posToMarkdownLine: jest.fn(),
  markdownLineToPos: (...args: unknown[]) => markdownLineToPosMock(...args),
  markdownLineToSelectionRange: jest.fn(),
  installGutterResizeObserver: jest.fn(),
}));
jest.mock('./../../webview/BubbleMenuView', () => ({
  createFormattingToolbar: () => ({}),
  createTableMenu: () => ({}),
  openGotoLineInput: jest.fn(() => false),
  setVisibleGotoLineInputValue: jest.fn((value: string) => {
    const input = document.querySelector('.toolbar-dropdown-input') as HTMLInputElement | null;
    if (!input) {
      return false;
    }
    input.value = value;
    return true;
  }),
  updateToolbarStates: jest.fn(),
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
  hideSearchOverlay: jest.fn(),
  focusVisibleSearchInput: jest.fn(),
  searchNext: jest.fn(),
  searchPrev: jest.fn(),
  replaceAll: jest.fn(),
  consumePendingSelectionNavigationHistorySuppression: jest.fn(() => false),
}));
jest.mock('./../../webview/features/linkDialog', () => ({ showLinkDialog: jest.fn() }));
jest.mock('./../../webview/utils/pasteHandler', () => ({
  processPasteContent: jest.fn(() => ({ isImage: false, wasConverted: false, content: '' })),
  parseFencedCode: jest.fn(),
}));
jest.mock('./../../webview/utils/copyMarkdown', () => ({
  copySelectionAsMarkdown: jest.fn(),
  getRangeAsMarkdown: jest.fn(),
  getSelectionAsMarkdown: jest.fn(() => null),
}));
jest.mock('./../../webview/utils/linkValidation', () => ({ shouldAutoLink: jest.fn(() => false) }));
jest.mock('./../../webview/utils/outline', () => ({ buildOutlineFromEditor: jest.fn(() => []) }));
jest.mock('./../../webview/utils/scrollToHeading', () => ({
  scrollToHeading: jest.fn(),
  scrollToPos: (...args: unknown[]) => scrollToPosMock(...args),
}));
jest.mock('./../../webview/utils/markdownSerialization', () => ({
  getEditorMarkdownForSync: (editor: unknown) => getEditorMarkdownForSyncMock(editor),
}));
jest.mock('./../../webview/utils/exportContent', () => ({
  collectExportContent: jest.fn(),
  getDocumentTitle: jest.fn(),
}));
jest.mock('./../../webview/utils/proposalRedline', () => ({
  renderProposalRedlineHtml: jest.fn(),
  renderMarkdownHtml: jest.fn(),
}));
jest.mock('./../../webview/displaySettings', () => ({
  updateDisplaySettings: jest.fn(),
  editorDisplaySettings: {
    showHeadingGutter: true,
    showDocumentLineNumbers: false,
    showNavigationLineNumbers: false,
  },
}));
jest.mock('./../../webview/utils/proposalContext', () => ({
  buildProposalEditableMarkdown: jest.fn(),
  extractProposalReplacementFromEditableMarkdown: jest.fn(),
  normalizeProposalReplacementForContext: jest.fn(),
}));
jest.mock('./../../webview/features/colorSettings', () => ({
  applyColors: jest.fn(),
  updateColorSettingsPanel: jest.fn(),
  DEFAULT_COLORS: {},
}));
jest.mock('./../../webview/utils/selectionMatching', () => ({ resolveSelectionMatch: jest.fn() }));
jest.mock('./../../webview/utils/pinnedSelection', () => ({
  calculateProposalRevealScrollTop: jest.fn(),
  calculateProposalRevealBottomPadding: jest.fn(),
  findRenderedBlockSequence: jest.fn(),
  findTextBlockSequence: jest.fn(),
  getNormalizedSelectionBlocks: jest.fn(),
  getProposalRevealTopPadding: jest.fn(),
  buildPinnedBlockRanges: jest.fn(),
  resolvePinnedTextRange: jest.fn(),
  resolvePinnedBlockElementAtPos: jest.fn(),
  resolvePinnedBlockElements: jest.fn(),
  resolveTextRangeWithinTextBlock: jest.fn(),
}));
jest.mock('./../../webview/features/imageResizeModal', () => ({
  handleImageResized: jest.fn(),
  showResizeModalAfterDownload: jest.fn(),
  showImageResizeModal: jest.fn(),
}));
jest.mock('./../../webview/features/imageMetadata', () => ({
  clearImageMetadataCache: jest.fn(),
  updateImageMetadataDimensions: jest.fn(),
  getCachedImageMetadata: jest.fn(),
}));
jest.mock('./../../webview/features/imageRenameDialog', () => ({}));

type GotoLineTestingModule = {
  setMockEditor: (editor: unknown) => void;
  resetNavigationHistoryForTests: () => void;
  getNavigationHistoryForTests: () => {
    back: number[];
    forward: number[];
    lastRecorded: number | null;
  };
  goToMarkdownLineForTests: (lineNumber: number) => boolean;
};

describe('webview goto line navigation', () => {
  let testing: GotoLineTestingModule;
  const originalReadyStateDescriptor = Object.getOwnPropertyDescriptor(document, 'readyState');

  beforeEach(async () => {
    jest.resetModules();
    markdownLineToPosMock.mockReset();
    scrollToPosMock.mockReset();
    getEditorMarkdownForSyncMock.mockReset();
    getEditorMarkdownForSyncMock.mockReturnValue('one\ntwo\nthree');
    document.body.innerHTML = '';

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
    testing = mod.__testing as unknown as GotoLineTestingModule;
    testing.resetNavigationHistoryForTests();
  });

  afterAll(() => {
    if (originalReadyStateDescriptor) {
      Object.defineProperty(document, 'readyState', originalReadyStateDescriptor);
    }
  });

  it('maps a markdown line number to a centered, no-focus scroll and records the position left', () => {
    const editor = {
      state: {
        selection: { from: 25 },
      },
    };
    testing.setMockEditor(editor);
    getEditorMarkdownForSyncMock.mockReturnValue(Array.from({ length: 50 }, (_, index) => `line ${index + 1}`).join('\n'));
    markdownLineToPosMock.mockReturnValue(250);

    expect(testing.goToMarkdownLineForTests(42)).toBe(true);
    expect(markdownLineToPosMock).toHaveBeenCalledWith(editor, 42);
    expect(scrollToPosMock).toHaveBeenCalledWith(editor, 250, true, true);
    expect(testing.getNavigationHistoryForTests()).toEqual({
      back: [25],
      forward: [],
      lastRecorded: 250,
    });
  });

  it('falls back to the closest previous mappable line when the requested line does not map', () => {
    const editor = {
      state: {
        selection: { from: 25 },
      },
    };
    testing.setMockEditor(editor);
    getEditorMarkdownForSyncMock.mockReturnValue('l1\nl2\nl3\nl4');
    markdownLineToPosMock.mockImplementation((_editor, lineNumber: number) => {
      if (lineNumber === 4) return -1;
      if (lineNumber === 3) return 175;
      return -1;
    });

    expect(testing.goToMarkdownLineForTests(4)).toBe(true);
    expect(markdownLineToPosMock.mock.calls).toEqual([
      [editor, 4],
      [editor, 3],
    ]);
    expect(scrollToPosMock).toHaveBeenCalledWith(editor, 175, true, true);
    expect(document.querySelector('.goto-line-warning-toast')).toBeNull();
  });

  it('ignores invalid or unmapped goto line requests', () => {
    const editor = {
      state: {
        selection: { from: 25 },
      },
    };
    testing.setMockEditor(editor);
    markdownLineToPosMock.mockReturnValue(-1);

    expect(testing.goToMarkdownLineForTests(0)).toBe(false);
    expect(testing.goToMarkdownLineForTests(99)).toBe(false);
    expect(scrollToPosMock).not.toHaveBeenCalled();
    expect(testing.getNavigationHistoryForTests()).toEqual({
      back: [],
      forward: [],
      lastRecorded: null,
    });
  });

  it('shows a warning toast when the requested line is outside the document range', () => {
    const editor = {
      state: {
        selection: { from: 25 },
      },
    };
    testing.setMockEditor(editor);
    getEditorMarkdownForSyncMock.mockReturnValue('line 1\nline 2\nline 3');
    const gotoInput = document.createElement('input');
    gotoInput.className = 'toolbar-dropdown-input';
    gotoInput.value = '200';
    document.body.appendChild(gotoInput);

    expect(testing.goToMarkdownLineForTests(200)).toBe(false);
    expect(scrollToPosMock).not.toHaveBeenCalled();

    const warningToast = document.querySelector('.goto-line-warning-toast') as HTMLElement | null;
    expect(warningToast).toBeTruthy();
    expect(warningToast?.textContent).toContain('outside document range 1-3');
    expect(gotoInput.value).toBe('3');
  });
});
