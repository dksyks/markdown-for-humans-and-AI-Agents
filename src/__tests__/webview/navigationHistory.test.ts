/** @jest-environment jsdom */

/**
 * Regression tests for navigation history when in-document search is active.
 * We import the webview module without initializing TipTap and exercise the
 * navigation-history hook directly.
 */

const isSearchVisibleMock = jest.fn(() => false);
const consumeSearchNavSuppressionMock = jest.fn(() => false);

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
  markdownLineToPos: jest.fn(),
  markdownLineToSelectionRange: jest.fn(),
  installGutterResizeObserver: jest.fn(),
}));
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
  isSearchVisible: () => isSearchVisibleMock(),
  hideSearchOverlay: jest.fn(),
  focusVisibleSearchInput: jest.fn(),
  searchNext: jest.fn(),
  searchPrev: jest.fn(),
  replaceAll: jest.fn(),
  consumePendingSelectionNavigationHistorySuppression: () =>
    consumeSearchNavSuppressionMock(),
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
  scrollToPos: jest.fn(),
}));
jest.mock('./../../webview/utils/exportContent', () => ({
  collectExportContent: jest.fn(),
  getDocumentTitle: jest.fn(),
}));
jest.mock('./../../webview/utils/proposalRedline', () => ({
  renderProposalRedlineHtml: jest.fn(),
  renderMarkdownHtml: jest.fn(),
}));
jest.mock('./../../webview/displaySettings', () => ({ updateDisplaySettings: jest.fn() }));
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

type NavigationHistoryTestingModule = {
  resetNavigationHistoryForTests: () => void;
  getNavigationHistoryForTests: () => {
    back: number[];
    forward: number[];
    lastRecorded: number | null;
  };
  recordSelectionUpdateNavigationForTests: (pos: number) => void;
};

describe('webview navigation history with search', () => {
  let testing: NavigationHistoryTestingModule;
  const originalReadyStateDescriptor = Object.getOwnPropertyDescriptor(document, 'readyState');

  beforeEach(async () => {
    jest.resetModules();
    jest.useFakeTimers();
    isSearchVisibleMock.mockReset();
    isSearchVisibleMock.mockReturnValue(false);
    consumeSearchNavSuppressionMock.mockReset();
    consumeSearchNavSuppressionMock.mockReturnValue(false);

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
    testing = mod.__testing as unknown as NavigationHistoryTestingModule;
    testing.resetNavigationHistoryForTests();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  afterAll(() => {
    if (originalReadyStateDescriptor) {
      Object.defineProperty(document, 'readyState', originalReadyStateDescriptor);
    }
  });

  it('does not record selection-update breadcrumbs while search is visible', () => {
    testing.recordSelectionUpdateNavigationForTests(100);
    jest.advanceTimersByTime(1000);

    isSearchVisibleMock.mockReturnValue(true);
    testing.recordSelectionUpdateNavigationForTests(300);
    jest.advanceTimersByTime(1000);

    expect(testing.getNavigationHistoryForTests()).toEqual({
      back: [],
      forward: [],
      lastRecorded: 100,
    });
  });

  it('does not record the next selection-update breadcrumb when search closes and restores selection', () => {
    testing.recordSelectionUpdateNavigationForTests(100);
    jest.advanceTimersByTime(1000);

    consumeSearchNavSuppressionMock.mockReturnValueOnce(true);
    testing.recordSelectionUpdateNavigationForTests(260);
    jest.advanceTimersByTime(1000);

    expect(testing.getNavigationHistoryForTests()).toEqual({
      back: [],
      forward: [],
      lastRecorded: 100,
    });
  });

  it('records normal selection-update breadcrumbs when search is not involved', () => {
    testing.recordSelectionUpdateNavigationForTests(100);
    jest.advanceTimersByTime(1000);

    testing.recordSelectionUpdateNavigationForTests(260);
    jest.advanceTimersByTime(1000);

    expect(testing.getNavigationHistoryForTests()).toEqual({
      back: [100],
      forward: [],
      lastRecorded: 260,
    });
  });
});
