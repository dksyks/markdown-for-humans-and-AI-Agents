import * as vscode from 'vscode';
import { ProposalPanel } from '../../features/proposalPanel';

describe('ProposalPanel', () => {
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
});
