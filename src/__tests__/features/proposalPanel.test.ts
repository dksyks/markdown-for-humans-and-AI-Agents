import * as vscode from 'vscode';
import {
  markWebviewPanelActive,
  registerWebviewPanel,
  resetActiveWebviewStateForTests,
} from '../../activeWebview';
import { ProposalPanel } from '../../features/proposalPanel';

describe('ProposalPanel', () => {
  beforeEach(() => {
    resetActiveWebviewStateForTests();
    ProposalPanel.currentPanel = undefined;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('applies the replacement using the captured source document even after active focus changes', async () => {
    const original = '**Fixed Auto-Linking Bug**';
    const replacement = '**Fixed Auto-Linking Behavior**';
    const rawContent = `Before\n${original}\nAfter`;

    const sourceDocument = {
      uri: vscode.Uri.file('/test/CHANGELOG.md'),
      getText: jest.fn(() => rawContent),
      positionAt: jest.fn((offset: number) => new vscode.Position(0, offset)),
    } as unknown as vscode.TextDocument;

    const panel = Object.create(ProposalPanel.prototype) as Record<string, unknown>;

    panel._proposal = {
      original,
      context_before: null,
      context_after: null,
    };
    panel._sourceDocument = sourceDocument;

    const success = await (panel._applyReplacement as (text: string) => Promise<boolean>)(
      replacement
    );

    expect(success).toBe(true);
    expect(vscode.workspace.applyEdit).toHaveBeenCalledTimes(1);

    const edit = (vscode.workspace.applyEdit as jest.Mock).mock
      .calls[0][0] as vscode.WorkspaceEdit & {
      replaces: Array<{ text: string }>;
    };
    expect(edit.replaces).toHaveLength(1);
    expect(edit.replaces[0].text).toBe(`Before\n${replacement}\nAfter`);
  });

  it('reposts scroll and selection after the proposal panel opens beside the editor', () => {
    jest.useFakeTimers();

    const postMessage = jest.fn();
    const panel = Object.create(ProposalPanel.prototype) as Record<string, unknown>;

    panel._proposal = {
      original: '**Note:** Test',
      context_before: 'Before',
      context_after: 'After',
    };
    panel._sourcePanel = {
      webview: {
        postMessage,
      },
    };

    (panel._scrollMainEditorWithRetries as () => void)();

    expect(postMessage).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(600);

    expect(postMessage).toHaveBeenCalledTimes(4);
    expect(postMessage).toHaveBeenNthCalledWith(1, {
      type: 'selectProposalSelection',
      original: '**Note:** Test',
      context_before: 'Before',
      context_after: 'After',
    });
    expect(postMessage).toHaveBeenNthCalledWith(2, {
      type: 'revealCurrentProposalSelection',
    });
    expect(postMessage).toHaveBeenNthCalledWith(4, {
      type: 'revealCurrentProposalSelection',
    });
  });

  it('targets the matching open Markdown for Humans document instead of an unrelated active editor', () => {
    const alphaPanel = {
      webview: { postMessage: jest.fn() },
    } as unknown as vscode.WebviewPanel;
    const betaPanel = {
      webview: { postMessage: jest.fn() },
    } as unknown as vscode.WebviewPanel;
    const alphaDocument = {
      uri: vscode.Uri.file('/workspace/docs/alpha.md'),
    } as unknown as vscode.TextDocument;
    const betaDocument = {
      uri: vscode.Uri.file('/workspace/docs/beta.md'),
    } as unknown as vscode.TextDocument;

    registerWebviewPanel(alphaPanel, alphaDocument);
    registerWebviewPanel(betaPanel, betaDocument);
    markWebviewPanelActive(alphaPanel);

    const proposalPanelWebview = {
      html: '',
      onDidReceiveMessage: jest.fn(),
      asWebviewUri: jest.fn((uri: vscode.Uri) => uri),
    };
    const proposalPanel = {
      webview: proposalPanelWebview,
      onDidDispose: jest.fn(),
      reveal: jest.fn(),
      title: '',
    } as unknown as vscode.WebviewPanel;

    (vscode.window.createWebviewPanel as jest.Mock).mockReturnValue(proposalPanel);

    ProposalPanel.show(
      {
        extensionUri: vscode.Uri.file('/extension'),
        subscriptions: [],
      } as unknown as vscode.ExtensionContext,
      {
        id: 'proposal-1',
        file: '/workspace/docs/beta.md',
        source_instance_id: 'window-1',
        original: 'Old text',
        replacement: 'New text',
        context_before: null,
        context_after: null,
      }
    );

    const currentPanel = ProposalPanel.currentPanel as unknown as {
      _sourceDocument: vscode.TextDocument;
      _sourcePanel: vscode.WebviewPanel;
    };

    expect(currentPanel._sourceDocument).toBe(betaDocument);
    expect(currentPanel._sourcePanel).toBe(betaPanel);
  });
});
