import * as vscode from 'vscode';
import { ProposalPanel } from '../../features/proposalPanel';

describe('ProposalPanel', () => {
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
});
