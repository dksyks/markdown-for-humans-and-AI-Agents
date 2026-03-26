/** @jest-environment jsdom */

const buildLineToPositionMapMock = jest.fn((_editor?: unknown) => new Map([[35, { from: 350, to: 360 }]]));
const scrollToPosMock = jest.fn();
const getEditorMarkdownForSyncMock = jest.fn((_editor?: unknown) => '');

jest.mock('@tiptap/core', () => ({
  Editor: jest.fn().mockImplementation(({ element, content }) => {
    let currentContent = typeof content === 'string' ? content : '';
    const dom = document.createElement('div');
    element.appendChild(dom);
    return {
      view: { dom },
      commands: {
        setContent: jest.fn((value: string) => {
          currentContent = value;
        }),
        clearContent: jest.fn(() => {
          currentContent = '';
        }),
        setTextSelection: jest.fn(),
        focus: jest.fn(),
      },
      getText: jest.fn(() => currentContent),
      destroy: jest.fn(),
    };
  }),
}));

jest.mock('@tiptap/starter-kit', () => ({ __esModule: true, default: {} }));
jest.mock('@tiptap/markdown', () => ({ Markdown: {} }));
jest.mock('../../webview/extensions/lineNumbers', () => ({
  buildLineToPositionMap: (editor: unknown) => buildLineToPositionMapMock(editor),
}));
jest.mock('../../webview/BubbleMenuView', () => ({
  createFormattingToolbar: jest.fn(() => document.createElement('div')),
}));
jest.mock('../../webview/utils/scrollToHeading', () => ({
  scrollToPos: (editor: unknown, pos: number, noFocus?: boolean, center?: boolean) =>
    scrollToPosMock(editor, pos, noFocus, center),
}));
jest.mock('../../webview/utils/markdownSerialization', () => ({
  getEditorMarkdownForSync: (editor: unknown) => getEditorMarkdownForSyncMock(editor),
}));

describe('plan overlay validation warning', () => {
  let initializePlanOverlay: typeof import('../../webview/planOverlay').initializePlanOverlay;
  let destroyPlanOverlay: typeof import('../../webview/planOverlay').destroyPlanOverlay;
  let postMessageMock: jest.Mock;

  beforeEach(async () => {
    jest.resetModules();
    document.body.innerHTML = `
      <div id="host">
        <div class="formatting-toolbar"></div>
        <div id="editor" class="markdown-editor" style="margin-left: 0px;"></div>
      </div>
    `;
    buildLineToPositionMapMock.mockClear();
    scrollToPosMock.mockClear();
    getEditorMarkdownForSyncMock.mockClear();
    getEditorMarkdownForSyncMock.mockReturnValue('');
    postMessageMock = jest.fn();

    window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    }) as typeof requestAnimationFrame;

    const mod = await import('../../webview/planOverlay');
    initializePlanOverlay = mod.initializePlanOverlay;
    destroyPlanOverlay = mod.destroyPlanOverlay;
  });

  afterEach(() => {
    destroyPlanOverlay();
    document.body.innerHTML = '';
  });

  it('renders the submit-too-soon warning in the button row, left of the action buttons', () => {
    const mainEditor = {
      commands: {
        setTextSelection: jest.fn(),
        focus: jest.fn(),
      },
    };

    initializePlanOverlay(
      {
        id: 'plan-1',
        file: 'C:\\test.md',
        proposed_replacements: [
          {
            range: { start: 35, end: 35 },
            proposed_change: 'Review this line.',
          },
        ],
      },
      mainEditor as never,
      { postMessage: postMessageMock },
      jest.fn()
    );

    const submitButton = Array.from(document.querySelectorAll('.plan-btn')).find(
      button => button.textContent === 'Submit'
    ) as HTMLButtonElement | undefined;
    expect(submitButton).toBeTruthy();

    submitButton?.click();

    const warning = document.querySelector('.plan-validation-warning') as HTMLElement | null;
    expect(warning).toBeTruthy();
    expect(warning?.textContent).toContain("Please respond to 35 or click 'No Response'");

    const warningRegion = warning?.parentElement as HTMLElement | null;
    expect(warningRegion?.classList.contains('plan-validation-region')).toBe(true);
    expect(warningRegion?.parentElement?.classList.contains('plan-buttons')).toBe(true);
    expect(postMessageMock).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'planResponse' }));
  });

  it('clears the warning when the user addresses the row', () => {
    const mainEditor = {
      commands: {
        setTextSelection: jest.fn(),
        focus: jest.fn(),
      },
    };

    initializePlanOverlay(
      {
        id: 'plan-2',
        file: 'C:\\test.md',
        proposed_replacements: [
          {
            range: { start: 35, end: 35 },
            proposed_change: 'Review this line.',
          },
        ],
      },
      mainEditor as never,
      { postMessage: postMessageMock },
      jest.fn()
    );

    const submitButton = Array.from(document.querySelectorAll('.plan-btn')).find(
      button => button.textContent === 'Submit'
    ) as HTMLButtonElement | undefined;
    const noResponseButton = Array.from(document.querySelectorAll('.plan-btn')).find(
      button => button.textContent === 'No Response'
    ) as HTMLButtonElement | undefined;

    submitButton?.click();
    expect(document.querySelector('.plan-validation-warning')).toBeTruthy();

    noResponseButton?.click();

    expect(document.querySelector('.plan-validation-warning')).toBeNull();
  });
});
