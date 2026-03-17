import * as fs from 'fs';
import { MarkdownEditorProvider, SELECTION_REVEAL_RESPONSE_TEMP_FILE } from '../../editor/MarkdownEditorProvider';
import * as vscode from 'vscode';

jest.mock('vscode', () => ({
  window: {
    showErrorMessage: jest.fn(),
    showInformationMessage: jest.fn(),
  },
  workspace: {
    getWorkspaceFolder: jest.fn(),
    workspaceFolders: undefined,
    getConfiguration: jest.fn(() => ({
      get: jest.fn((_key: string, defaultValue?: unknown) => defaultValue),
      update: jest.fn(),
    })),
    onDidChangeTextDocument: jest.fn(),
    onDidChangeConfiguration: jest.fn(),
    applyEdit: jest.fn(),
    fs: {
      stat: jest.fn(),
      readFile: jest.fn(),
      writeFile: jest.fn(),
      createDirectory: jest.fn(),
      delete: jest.fn(),
      rename: jest.fn(),
    },
  },
  Uri: {
    file: jest.fn((p: string) => ({ fsPath: p, scheme: 'file' })),
    joinPath: jest.fn((base: { fsPath: string }, ...parts: string[]) => ({
      fsPath: [base.fsPath, ...parts].join('/'),
      scheme: 'file',
    })),
  },
  commands: {
    executeCommand: jest.fn(),
  },
  ViewColumn: {
    Beside: 2,
  },
  TreeItem: class TreeItem {},
  TreeItemCollapsibleState: {
    None: 0,
    Collapsed: 1,
    Expanded: 2,
  },
  ThemeIcon: class ThemeIcon {},
  ThemeColor: class ThemeColor {},
  EventEmitter: class EventEmitter<T> {
    public event = jest.fn();
    fire = jest.fn((_data?: T) => {});
    dispose = jest.fn();
  },
  Range: jest.fn(),
  Position: jest.fn(),
  WorkspaceEdit: jest.fn(),
  ConfigurationTarget: {
    Global: 1,
  },
}));

describe('selectionRevealResult handling', () => {
  const originalResponsePath = SELECTION_REVEAL_RESPONSE_TEMP_FILE;

  beforeEach(() => {
    jest.resetModules();
    if (fs.existsSync(originalResponsePath)) {
      fs.unlinkSync(originalResponsePath);
    }
  });

  afterEach(() => {
    if (fs.existsSync(originalResponsePath)) {
      fs.unlinkSync(originalResponsePath);
    }
  });

  it('writes a selection reveal response file when the webview confirms reveal status', () => {
    const provider = new MarkdownEditorProvider({
      extensionUri: vscode.Uri.file('/extension'),
      subscriptions: [],
    } as unknown as vscode.ExtensionContext);

    const document = {
      uri: { fsPath: '/workspace/docs/target.md' },
    } as unknown as vscode.TextDocument;

    (
      provider as unknown as {
        handleWebviewMessage: (
          message: { type: string; [key: string]: unknown },
          doc: vscode.TextDocument,
          webview: vscode.Webview
        ) => void;
      }
    ).handleWebviewMessage(
      {
        type: 'selectionRevealResult',
        id: 'reveal-ack-1',
        status: 'error',
        error:
          'The file is open in Markdown for Humans, but the requested selection could not be found. The file contents may have changed, or the provided context may not match.',
        debug: {
          phase: 'resolveProposalSelectionTarget',
        },
      },
      document,
      { postMessage: jest.fn() } as unknown as vscode.Webview
    );

    const response = JSON.parse(fs.readFileSync(originalResponsePath, 'utf8'));
    expect(response).toEqual({
      selection_request_id: 'reveal-ack-1',
      id: 'reveal-ack-1',
      status: 'error',
      file: '/workspace/docs/target.md',
      error:
        'The file is open in Markdown for Humans, but the requested selection could not be found. The file contents may have changed, or the provided context may not match.',
      debug: {
        phase: 'resolveProposalSelectionTarget',
      },
    });
  });
});
