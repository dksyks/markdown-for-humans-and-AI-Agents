import * as vscode from 'vscode';
import * as fs from 'fs';
import {
  markWebviewPanelActive,
  registerWebviewPanel,
  resetActiveWebviewStateForTests,
} from '../../activeWebview';
import { ProposalPanel } from '../../features/proposalPanel';
import { PROPOSAL_STATE_DIR, RESPONSE_TEMP_FILE } from '../../editor/MarkdownEditorProvider';

describe('ProposalPanel', () => {
  beforeEach(() => {
    resetActiveWebviewStateForTests();
    ProposalPanel.currentPanel = undefined;
  });

  afterEach(() => {
    jest.useRealTimers();
    if (fs.existsSync(RESPONSE_TEMP_FILE)) {
      fs.unlinkSync(RESPONSE_TEMP_FILE);
    }
    try {
      fs.rmSync(PROPOSAL_STATE_DIR, { recursive: true, force: true });
    } catch {}
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
      options: [{ replacement }],
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
      options: [{ replacement: '**Note:** Revised Test' }],
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
      headings_before: null,
    });
    expect(postMessage).toHaveBeenNthCalledWith(2, {
      type: 'revealCurrentProposalSelection',
    });
    expect(postMessage).toHaveBeenNthCalledWith(3, {
      type: 'revealCurrentProposalSelection',
    });
    expect(postMessage).toHaveBeenNthCalledWith(4, {
      type: 'revealCurrentProposalSelection',
    });

    jest.advanceTimersByTime(200);

    expect(postMessage).toHaveBeenCalledTimes(5);
    expect(postMessage).toHaveBeenNthCalledWith(5, {
      type: 'selectProposalSelection',
      original: '**Note:** Test',
      context_before: 'Before',
      context_after: 'After',
      headings_before: null,
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
      getText: () => 'Alpha document content',
    } as unknown as vscode.TextDocument;
    const betaDocument = {
      uri: vscode.Uri.file('/workspace/docs/beta.md'),
      getText: () => 'Old text',
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
        options: [{ replacement: 'New text' }],
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

  it('targets the matching document by content when proposal routing metadata is missing', () => {
    const todoPanel = {
      webview: { postMessage: jest.fn() },
    } as unknown as vscode.WebviewPanel;
    const trustPanel = {
      webview: { postMessage: jest.fn() },
    } as unknown as vscode.WebviewPanel;
    const todoDocument = {
      uri: vscode.Uri.file('/workspace/docs/todo.md'),
      getText: () => '- [ ] Review drafting notes',
    } as unknown as vscode.TextDocument;
    const trustDocument = {
      uri: vscode.Uri.file('/workspace/docs/initial-trust.md'),
      getText: () =>
        [
          '#### Investment Treatment',
          '',
          '- Each Beneficiary is responsible for investing assets held in the Personal Accounts.',
        ].join('\n'),
    } as unknown as vscode.TextDocument;

    registerWebviewPanel(todoPanel, todoDocument);
    registerWebviewPanel(trustPanel, trustDocument);
    markWebviewPanelActive(todoPanel);

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
        id: 'proposal-2',
        original: 'Each Beneficiary is responsible for investing assets held in the Personal Accounts.',
        options: [{
          replacement:
            'Each Beneficiary is responsible for investing assets held in the Personal Accounts and related subaccounts.',
        }],
        context_before: null,
        context_after: null,
      }
    );

    const currentPanel = ProposalPanel.currentPanel as unknown as {
      _sourceDocument: vscode.TextDocument;
      _sourcePanel: vscode.WebviewPanel;
    };

    expect(currentPanel._sourceDocument).toBe(trustDocument);
    expect(currentPanel._sourcePanel).toBe(trustPanel);
  });

  it('advances through queued proposals and writes one aggregated response at the end', async () => {
    if (fs.existsSync(RESPONSE_TEMP_FILE)) {
      fs.unlinkSync(RESPONSE_TEMP_FILE);
    }

    const sourceDocument = {
      uri: vscode.Uri.file('/test/CHANGELOG.md'),
      getText: jest.fn(() => 'Before\nOld text\nAfter'),
      positionAt: jest.fn((offset: number) => new vscode.Position(0, offset)),
    } as unknown as vscode.TextDocument;

    const proposalWebview = {
      postMessage: jest.fn(),
    };
    const proposalHostPanel = {
      webview: proposalWebview,
      dispose: jest.fn(),
    };

    const panel = Object.create(ProposalPanel.prototype) as Record<string, unknown>;
    panel._panel = proposalHostPanel;
    panel._requestId = 'batch-1';
    panel._proposal = {
      original: 'Old text',
      options: [{ replacement: 'New text' }],
      context_before: null,
      context_after: null,
    };
    panel._proposalQueue = [
      {
        original: 'Old text',
        options: [{ replacement: 'New text' }],
        context_before: null,
        context_after: null,
      },
      {
        original: 'Second old text',
        options: [{ replacement: 'Second new text' }],
        context_before: 'Section break',
        context_after: 'Conclusion',
      },
    ];
    panel._proposalResults = [];
    panel._proposalIndex = 0;
    panel._sourceDocument = sourceDocument;
    panel._sourcePanel = undefined;
    panel._scrollMainEditorWithRetries = jest.fn();

    await (panel._handleMessage as (msg: unknown) => Promise<void>)({
      type: 'proposalResponse',
      status: 'accept',
      replacement: 'New text',
    });

    expect(vscode.workspace.applyEdit).toHaveBeenCalledTimes(1);
    expect(proposalWebview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'proposalInit',
      original: 'Second old text',
      options: [{ replacement: 'Second new text' }],
      context_before: 'Section break',
      context_after: 'Conclusion',
      displayContextBefore: '',
      displayContextAfter: '',
      colors: expect.any(Object),
    }));
    expect(proposalHostPanel.dispose).not.toHaveBeenCalled();
    expect(fs.existsSync(RESPONSE_TEMP_FILE)).toBe(false);

    await (panel._handleMessage as (msg: unknown) => Promise<void>)({
      type: 'proposalResponse',
      status: 'cancelled',
      replacement: null,
    });

    expect(proposalHostPanel.dispose).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(RESPONSE_TEMP_FILE)).toBe(true);

    const payload = JSON.parse(fs.readFileSync(RESPONSE_TEMP_FILE, 'utf8')) as {
      id: string;
      status: string;
      results: Array<{ status: string; original: string; replacement: string | null }>;
    };
    expect(payload).toEqual({
      id: 'batch-1',
      file: '/test/CHANGELOG.md',
      review_kind: 'sequential',
      status: 'completed',
      results: [
        {
          status: 'applied',
          original: 'Old text',
          context_before: null,
          context_after: null,
          headings_before: null,
          replacement: 'New text',
          selected_option_index: null,
        },
        {
          status: 'cancelled',
          original: 'Second old text',
          context_before: 'Section break',
          context_after: 'Conclusion',
          headings_before: null,
          replacement: null,
          selected_option_index: null,
        },
      ],
    });
  });

  it('does not overwrite the clipboard when an accepted proposal is applied successfully', async () => {
    (vscode.env.clipboard.writeText as jest.Mock).mockClear();

    const proposalHostPanel = {
      dispose: jest.fn(),
    };

    const panel = Object.create(ProposalPanel.prototype) as Record<string, unknown>;
    panel._panel = proposalHostPanel;
    panel._requestId = 'clipboard-apply';
    panel._proposal = {
      original: 'Old text',
      options: [{ replacement: 'New text' }],
      context_before: null,
      context_after: null,
    };
    panel._proposalQueue = [
      {
        original: 'Old text',
        options: [{ replacement: 'New text' }],
        context_before: null,
        context_after: null,
      },
    ];
    panel._proposalResults = [];
    panel._proposalIndex = 0;
    panel._sourceDocument = {
      uri: vscode.Uri.file('/test/CHANGELOG.md'),
    } as unknown as vscode.TextDocument;
    panel._applyReplacement = jest.fn().mockResolvedValue(true);
    panel._buildResponsePayload = jest.fn().mockReturnValue({ id: 'clipboard-apply', status: 'applied' });
    panel._writeResponsePayload = jest.fn();
    panel._writeProposalState = jest.fn();

    await (panel._handleMessage as (msg: unknown) => Promise<void>)({
      type: 'proposalResponse',
      status: 'accept',
      replacement: 'New text',
      selected_option_index: 0,
    });

    expect(vscode.env.clipboard.writeText).not.toHaveBeenCalledWith('New text');
  });

  it('copies the accepted replacement to the clipboard when it was not applied', async () => {
    (vscode.env.clipboard.writeText as jest.Mock).mockClear();

    const proposalHostPanel = {
      dispose: jest.fn(),
    };

    const panel = Object.create(ProposalPanel.prototype) as Record<string, unknown>;
    panel._panel = proposalHostPanel;
    panel._requestId = 'clipboard-fallback';
    panel._proposal = {
      original: 'Old text',
      options: [{ replacement: 'New text' }],
      context_before: null,
      context_after: null,
    };
    panel._proposalQueue = [
      {
        original: 'Old text',
        options: [{ replacement: 'New text' }],
        context_before: null,
        context_after: null,
      },
    ];
    panel._proposalResults = [];
    panel._proposalIndex = 0;
    panel._sourceDocument = {
      uri: vscode.Uri.file('/test/CHANGELOG.md'),
    } as unknown as vscode.TextDocument;
    panel._applyReplacement = jest.fn().mockResolvedValue(false);
    panel._buildResponsePayload = jest.fn().mockReturnValue({ id: 'clipboard-fallback', status: 'accept_unchanged' });
    panel._writeResponsePayload = jest.fn();
    panel._writeProposalState = jest.fn();

    await (panel._handleMessage as (msg: unknown) => Promise<void>)({
      type: 'proposalResponse',
      status: 'accept',
      replacement: 'New text',
      selected_option_index: 0,
    });

    expect(vscode.env.clipboard.writeText).toHaveBeenCalledWith('New text');
  });

  it('writes a pending handoff response and keeps the panel open for single proposals', async () => {
    if (fs.existsSync(RESPONSE_TEMP_FILE)) {
      fs.unlinkSync(RESPONSE_TEMP_FILE);
    }

    const proposalHostPanel = {
      webview: {
        postMessage: jest.fn(),
      },
      dispose: jest.fn(),
    };

    const panel = Object.create(ProposalPanel.prototype) as Record<string, unknown>;
    panel._panel = proposalHostPanel;
    panel._requestId = 'pending-1';
    panel._proposal = {
      original: 'Old text',
      options: [{ replacement: 'New text' }],
      context_before: null,
      context_after: null,
    };
    panel._proposalQueue = [
      {
        original: 'Old text',
        options: [{ replacement: 'New text' }],
        context_before: null,
        context_after: null,
      },
    ];
    panel._proposalResults = [];
    panel._proposalIndex = 0;
    panel._sourceDocument = {
      uri: vscode.Uri.file('/test/CHANGELOG.md'),
    } as unknown as vscode.TextDocument;
    panel._hasPendingHandoff = false;

    await (panel._handleMessage as (msg: unknown) => Promise<void>)({
      type: 'proposalPending',
    });

    expect(proposalHostPanel.dispose).not.toHaveBeenCalled();
    expect(fs.existsSync(RESPONSE_TEMP_FILE)).toBe(true);

    const payload = JSON.parse(fs.readFileSync(RESPONSE_TEMP_FILE, 'utf8')) as {
      id: string;
      make_single_replacement_session_id: string;
      status: string;
      message: string;
      review_kind: string;
      progress: { current: number; total: number };
    };
    expect(payload).toEqual({
      id: 'pending-1',
      file: '/test/CHANGELOG.md',
      review_kind: 'single',
      status: 'pending',
      message: 'The proposal review is still open in Markdown for Humans. Finish reviewing there, then in the conversation type "resume".',
      progress: { current: 1, total: 1 },
      make_single_replacement_session_id: 'pending-1',
      original: 'Old text',
      context_before: null,
      context_after: null,
      headings_before: null,
      replacement: null,
      selected_option_index: null,
    });

    const stateFilePath = ProposalPanel._getProposalStateFilePath('pending-1');
    expect(fs.existsSync(stateFilePath)).toBe(true);
    expect(vscode.env.clipboard.writeText).toHaveBeenCalledWith('resume');
    expect(proposalHostPanel.webview.postMessage).toHaveBeenCalledWith({ type: 'resumePromptCopied' });
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      'Copied "resume" to the clipboard. Finish reviewing in Markdown for Humans, then paste it into the conversation.'
    );
  });

  it('falls back to the current pending-handoff behavior if auto-copying resume fails', async () => {
    if (fs.existsSync(RESPONSE_TEMP_FILE)) {
      fs.unlinkSync(RESPONSE_TEMP_FILE);
    }

    (vscode.env.clipboard.writeText as jest.Mock).mockRejectedValueOnce(new Error('clipboard failed'));

    const proposalHostPanel = {
      webview: {
        postMessage: jest.fn(),
      },
      dispose: jest.fn(),
    };

    const panel = Object.create(ProposalPanel.prototype) as Record<string, unknown>;
    panel._panel = proposalHostPanel;
    panel._requestId = 'pending-fallback';
    panel._proposal = {
      original: 'Old text',
      options: [{ replacement: 'New text' }],
      context_before: null,
      context_after: null,
    };
    panel._proposalQueue = [
      {
        original: 'Old text',
        options: [{ replacement: 'New text' }],
        context_before: null,
        context_after: null,
      },
    ];
    panel._proposalResults = [];
    panel._proposalIndex = 0;
    panel._sourceDocument = {
      uri: vscode.Uri.file('/test/CHANGELOG.md'),
    } as unknown as vscode.TextDocument;
    panel._hasPendingHandoff = false;

    await (panel._handleMessage as (msg: unknown) => Promise<void>)({
      type: 'proposalPending',
    });

    expect(proposalHostPanel.dispose).not.toHaveBeenCalled();
    expect(fs.existsSync(RESPONSE_TEMP_FILE)).toBe(true);
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
    expect(proposalHostPanel.webview.postMessage).not.toHaveBeenCalled();
  });
});
