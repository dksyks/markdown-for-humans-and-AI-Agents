import * as vscode from 'vscode';
import {
  buildSourceSelectionSyncPayload,
  MarkdownEditorProvider,
} from '../../editor/MarkdownEditorProvider';

type TestDocument = {
  uri: { toString: () => string };
  lineCount: number;
};

function createDocument(lineCount = 200): TestDocument {
  return {
    uri: {
      toString: () => 'file://test.md',
    },
    lineCount,
  };
}

describe('buildSourceSelectionSyncPayload', () => {
  it('builds a 1-based collapsed selection payload from the active source cursor', () => {
    const selection = new vscode.Selection(
      new vscode.Position(6, 4),
      new vscode.Position(6, 4)
    );

    expect(buildSourceSelectionSyncPayload(selection)).toEqual({
      type: 'syncFromSourceSelection',
      activeLine: 7,
      startLine: 7,
      endLine: 7,
      isEmpty: true,
      viewportRatio: null,
    });
  });

  it('treats a trailing whole-line source selection end as inclusive of the previous line', () => {
    const selection = new vscode.Selection(
      new vscode.Position(2, 0),
      new vscode.Position(5, 0)
    );

    expect(buildSourceSelectionSyncPayload(selection)).toEqual({
      type: 'syncFromSourceSelection',
      activeLine: 5,
      startLine: 3,
      endLine: 5,
      isEmpty: false,
      viewportRatio: null,
    });
  });

  it('includes the source viewport ratio when provided', () => {
    const selection = new vscode.Selection(
      new vscode.Position(10, 2),
      new vscode.Position(10, 2)
    );

    expect(buildSourceSelectionSyncPayload(selection, 0.375)).toEqual({
      type: 'syncFromSourceSelection',
      activeLine: 11,
      startLine: 11,
      endLine: 11,
      isEmpty: true,
      viewportRatio: 0.375,
    });
  });
});

describe('MarkdownEditorProvider source sync alignment', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    (vscode.window as unknown as { visibleTextEditors: unknown[] }).visibleTextEditors = [];
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('reveals the source selection at a matching viewport band when a ratio is provided', () => {
    const provider = new MarkdownEditorProvider({} as vscode.ExtensionContext);
    const document = createDocument(200);
    const revealRange = jest.fn();
    const sourceEditor = {
      document: {
        uri: document.uri,
        lineCount: 200,
      },
      visibleRanges: [
        new vscode.Range(
          new vscode.Position(10, 0),
          new vscode.Position(30, 0)
        ),
      ],
      selection: null as unknown as vscode.Selection,
      revealRange,
    };

    (vscode.window as unknown as { visibleTextEditors: unknown[] }).visibleTextEditors = [sourceEditor];

    (
      provider as unknown as {
        handleWebviewMessage: (
          message: { type: string; [key: string]: unknown },
          document: vscode.TextDocument,
          webview: vscode.Webview
        ) => void;
      }
    ).handleWebviewMessage(
      { type: 'syncSourceLine', line: 80, viewportRatio: 0.5 },
      document as unknown as vscode.TextDocument,
      {} as vscode.Webview
    );

    jest.runAllTimers();

    expect((sourceEditor.selection as vscode.Selection).active.line).toBe(79);
    expect(revealRange).toHaveBeenCalledWith(
      expect.objectContaining({
        start: expect.objectContaining({ line: 69 }),
        end: expect.objectContaining({ line: 69 }),
      }),
      vscode.TextEditorRevealType.AtTop
    );
  });

  it('falls back to centering when no viewport ratio is available', () => {
    const provider = new MarkdownEditorProvider({} as vscode.ExtensionContext);
    const document = createDocument(200);
    const revealRange = jest.fn();
    const sourceEditor = {
      document: {
        uri: document.uri,
        lineCount: 200,
      },
      visibleRanges: [],
      selection: null as unknown as vscode.Selection,
      revealRange,
    };

    (vscode.window as unknown as { visibleTextEditors: unknown[] }).visibleTextEditors = [sourceEditor];

    (
      provider as unknown as {
        handleWebviewMessage: (
          message: { type: string; [key: string]: unknown },
          document: vscode.TextDocument,
          webview: vscode.Webview
        ) => void;
      }
    ).handleWebviewMessage(
      { type: 'syncSourceLine', line: 40 },
      document as unknown as vscode.TextDocument,
      {} as vscode.Webview
    );

    jest.runAllTimers();

    expect((sourceEditor.selection as vscode.Selection).active.line).toBe(39);
    expect(revealRange).toHaveBeenCalledWith(
      expect.objectContaining({
        start: expect.objectContaining({ line: 39 }),
        end: expect.objectContaining({ line: 39 }),
      }),
      vscode.TextEditorRevealType.InCenterIfOutsideViewport
    );
  });

  it('applies a whole-line selection range when MFH sends a source selection sync', () => {
    const provider = new MarkdownEditorProvider({} as vscode.ExtensionContext);
    const document = createDocument(200);
    const revealRange = jest.fn();
    const sourceEditor = {
      document: {
        uri: document.uri,
        lineCount: 200,
        lineAt: (line: number) => ({ text: `line-${line}` }),
      },
      visibleRanges: [
        new vscode.Range(
          new vscode.Position(10, 0),
          new vscode.Position(30, 0)
        ),
      ],
      selection: null as unknown as vscode.Selection,
      revealRange,
    };

    (vscode.window as unknown as { visibleTextEditors: unknown[] }).visibleTextEditors = [sourceEditor];

    (
      provider as unknown as {
        handleWebviewMessage: (
          message: { type: string; [key: string]: unknown },
          document: vscode.TextDocument,
          webview: vscode.Webview
        ) => void;
      }
    ).handleWebviewMessage(
      {
        type: 'syncSourceSelection',
        activeLine: 12,
        startLine: 10,
        endLine: 12,
        isEmpty: false,
        viewportRatio: 0.5,
      },
      document as unknown as vscode.TextDocument,
      {} as vscode.Webview
    );

    jest.runAllTimers();

    expect(sourceEditor.selection.start.line).toBe(9);
    expect(sourceEditor.selection.start.character).toBe(0);
    expect(sourceEditor.selection.end.line).toBe(12);
    expect(sourceEditor.selection.end.character).toBe(0);
    expect(sourceEditor.selection.active.line).toBe(9);
  });

  it('compensates when AtTop reveal lands above the desired logical line during resize preservation', () => {
    const provider = new MarkdownEditorProvider({} as vscode.ExtensionContext);
    const document = createDocument(200);
    const selection = {
      anchor: new vscode.Position(73, 0),
      active: new vscode.Position(74, 0),
      start: new vscode.Position(73, 0),
      end: new vscode.Position(74, 0),
      isEmpty: false,
    } as unknown as vscode.Selection;
    const sourceEditor = {
      document: {
        uri: document.uri,
        lineCount: 200,
      },
      visibleRanges: [
        new vscode.Range(
          new vscode.Position(69, 0),
          new vscode.Position(85, 155)
        ),
      ],
      selection,
      selections: [selection],
      revealRange: jest.fn((range: vscode.Range) => {
        if (range.start.line === 70) {
          sourceEditor.visibleRanges = [
            new vscode.Range(
              new vscode.Position(67, 285),
              new vscode.Position(84, 0)
            ),
          ];
          return;
        }

        if (range.start.line === 73) {
          sourceEditor.visibleRanges = [
            new vscode.Range(
              new vscode.Position(70, 0),
              new vscode.Position(87, 0)
            ),
          ];
        }
      }),
    };

    const documentUri = document.uri.toString();
    const session = (
      provider as unknown as {
        getSourceResizeSession: (uri: string) => {
          active: boolean;
          anchor: {
            activeLine: number;
            selectionStartLine: number;
            selectionEndLine: number;
            visibleStartLine: number;
            visibleEndLine: number;
            visibleLineCount: number;
            viewportRatio: number;
            selectionIsEmpty: boolean;
          } | null;
          applying: boolean;
          lastRequestId: string | null;
          lastPhase: string | null;
          requestedLine: number | null;
          requestedViewportRatio: number | null;
        };
        applySourceResizePreservation: (
          document: vscode.TextDocument,
          sourceEditor: vscode.TextEditor,
          trigger: string
        ) => void;
      }
    ).getSourceResizeSession(documentUri);

    session.active = true;
    session.anchor = {
      activeLine: 74,
      selectionStartLine: 73,
      selectionEndLine: 74,
      visibleStartLine: 69,
      visibleEndLine: 85,
      visibleLineCount: 16,
      viewportRatio: 0.3125,
      selectionIsEmpty: false,
    };
    session.lastRequestId = 'resize-test';
    session.lastPhase = 'settled';
    session.requestedLine = 75;
    session.requestedViewportRatio = 0.2457528365285773;

    (
      provider as unknown as {
        applySourceResizePreservation: (
          document: vscode.TextDocument,
          sourceEditor: vscode.TextEditor,
          trigger: string
        ) => void;
      }
    ).applySourceResizePreservation(
      document as unknown as vscode.TextDocument,
      sourceEditor as unknown as vscode.TextEditor,
      'sourceResizeSession:settled'
    );

    jest.runAllTimers();

    expect(sourceEditor.revealRange).toHaveBeenCalledTimes(2);
    expect(sourceEditor.revealRange).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        start: expect.objectContaining({ line: 70 }),
        end: expect.objectContaining({ line: 70 }),
      }),
      vscode.TextEditorRevealType.AtTop
    );
    expect(sourceEditor.revealRange).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        start: expect.objectContaining({ line: 73 }),
        end: expect.objectContaining({ line: 73 }),
      }),
      vscode.TextEditorRevealType.AtTop
    );
    expect(sourceEditor.visibleRanges[0].start.line).toBe(70);
  });

  it('uses the requested MFH line instead of a trailing whole-line source selection end during resize preservation', () => {
    const provider = new MarkdownEditorProvider({} as vscode.ExtensionContext);
    const document = createDocument(200);
    const selection = {
      anchor: new vscode.Position(87, 0),
      active: new vscode.Position(88, 0),
      start: new vscode.Position(87, 0),
      end: new vscode.Position(88, 0),
      isEmpty: false,
    } as unknown as vscode.Selection;
    const sourceEditor = {
      document: {
        uri: document.uri,
        lineCount: 200,
      },
      visibleRanges: [
        new vscode.Range(
          new vscode.Position(79, 299),
          new vscode.Position(91, 86)
        ),
      ],
      selection,
      selections: [selection],
      revealRange: jest.fn(),
    };

    const documentUri = document.uri.toString();
    const session = (
      provider as unknown as {
        getSourceResizeSession: (uri: string) => {
          active: boolean;
          anchor: {
            activeLine: number;
            selectionStartLine: number;
            selectionEndLine: number;
            visibleStartLine: number;
            visibleEndLine: number;
            visibleLineCount: number;
            viewportRatio: number;
            selectionIsEmpty: boolean;
          } | null;
          applying: boolean;
          lastRequestId: string | null;
          lastPhase: string | null;
          requestedLine: number | null;
          requestedViewportRatio: number | null;
        };
        applySourceResizePreservation: (
          document: vscode.TextDocument,
          sourceEditor: vscode.TextEditor,
          trigger: string
        ) => void;
      }
    ).getSourceResizeSession(documentUri);

    session.active = true;
    session.anchor = {
      activeLine: 87,
      selectionStartLine: 87,
      selectionEndLine: 88,
      visibleStartLine: 79,
      visibleEndLine: 91,
      visibleLineCount: 12,
      viewportRatio: 0.6666666666666666,
      selectionIsEmpty: false,
    };
    session.lastRequestId = 'resize-requested-line-test';
    session.lastPhase = 'settled';
    session.requestedLine = 86;
    session.requestedViewportRatio = 0.16496568749308105;

    (
      provider as unknown as {
        applySourceResizePreservation: (
          document: vscode.TextDocument,
          sourceEditor: vscode.TextEditor,
          trigger: string
        ) => void;
      }
    ).applySourceResizePreservation(
      document as unknown as vscode.TextDocument,
      sourceEditor as unknown as vscode.TextEditor,
      'sourceResizeSession:debounced'
    );

    expect(sourceEditor.revealRange).toHaveBeenCalledWith(
      expect.objectContaining({
        start: expect.objectContaining({ line: 83 }),
        end: expect.objectContaining({ line: 83 }),
      }),
      vscode.TextEditorRevealType.AtTop
    );
  });

  it('recomputes the second resize correction from the post-reveal visible line count', () => {
    const provider = new MarkdownEditorProvider({} as vscode.ExtensionContext);
    const document = createDocument(600);
    const selection = {
      anchor: new vscode.Position(448, 0),
      active: new vscode.Position(449, 0),
      start: new vscode.Position(448, 0),
      end: new vscode.Position(449, 0),
      isEmpty: false,
    } as unknown as vscode.Selection;
    const sourceEditor = {
      document: {
        uri: document.uri,
        lineCount: 600,
      },
      visibleRanges: [
        new vscode.Range(
          new vscode.Position(420, 0),
          new vscode.Position(456, 22)
        ),
      ],
      selection,
      selections: [selection],
      revealRange: jest.fn((range: vscode.Range) => {
        if (range.start.line === 425) {
          sourceEditor.visibleRanges = [
            new vscode.Range(
              new vscode.Position(421, 67),
              new vscode.Position(458, 65)
            ),
          ];
          return;
        }

        if (range.start.line === 424) {
          sourceEditor.visibleRanges = [
            new vscode.Range(
              new vscode.Position(424, 0),
              new vscode.Position(460, 70)
            ),
          ];
        }
      }),
    };

    const documentUri = document.uri.toString();
    const session = (
      provider as unknown as {
        getSourceResizeSession: (uri: string) => {
          active: boolean;
          anchor: {
            activeLine: number;
            selectionStartLine: number;
            selectionEndLine: number;
            visibleStartLine: number;
            visibleEndLine: number;
            visibleLineCount: number;
            viewportRatio: number;
            selectionIsEmpty: boolean;
          } | null;
          applying: boolean;
          lastRequestId: string | null;
          lastPhase: string | null;
          requestedLine: number | null;
          requestedViewportRatio: number | null;
        };
        applySourceResizePreservation: (
          document: vscode.TextDocument,
          sourceEditor: vscode.TextEditor,
          trigger: string
        ) => void;
      }
    ).getSourceResizeSession(documentUri);

    session.active = true;
    session.anchor = {
      activeLine: 448,
      selectionStartLine: 448,
      selectionEndLine: 449,
      visibleStartLine: 420,
      visibleEndLine: 456,
      visibleLineCount: 36,
      viewportRatio: 28 / 36,
      selectionIsEmpty: false,
    };
    session.lastRequestId = 'resize-recompute-test';
    session.lastPhase = 'settled';
    session.requestedLine = 449;
    session.requestedViewportRatio = 0.6356364453566551;

    (
      provider as unknown as {
        applySourceResizePreservation: (
          document: vscode.TextDocument,
          sourceEditor: vscode.TextEditor,
          trigger: string
        ) => void;
      }
    ).applySourceResizePreservation(
      document as unknown as vscode.TextDocument,
      sourceEditor as unknown as vscode.TextEditor,
      'sourceResizeSession:debounced'
    );

    jest.runAllTimers();

    expect(sourceEditor.revealRange).toHaveBeenCalledTimes(2);
    expect(sourceEditor.revealRange).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        start: expect.objectContaining({ line: 425 }),
        end: expect.objectContaining({ line: 425 }),
      }),
      vscode.TextEditorRevealType.AtTop
    );
    expect(sourceEditor.revealRange).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        start: expect.objectContaining({ line: 424 }),
        end: expect.objectContaining({ line: 424 }),
      }),
      vscode.TextEditorRevealType.AtTop
    );
  });
});
