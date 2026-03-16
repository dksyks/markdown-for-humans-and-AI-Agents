import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  getEditorHostInstanceId,
  registerWebviewPanel,
  resetActiveWebviewStateForTests,
} from '../../activeWebview';
import {
  consumePendingProposal,
  readPendingProposal,
  shouldHandleProposal,
} from '../../features/proposalWatcher';
import type { ProposalRequest } from '../../features/proposalPanel';

describe('pending proposal file handling', () => {
  beforeEach(() => {
    resetActiveWebviewStateForTests();
  });

  it('returns the proposal without deleting the temp file during read', () => {
    const proposalFilePath = path.join(
      os.tmpdir(),
      `md4h-proposal-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
    );

    fs.writeFileSync(
      proposalFilePath,
      JSON.stringify({
        id: 'proposal-1',
        original: '**Note:** Test',
        options: [{ replacement: 'Note: Test' }],
        context_before: null,
        context_after: null,
      }),
      'utf8'
    );

    const proposal = readPendingProposal(proposalFilePath);

    expect(proposal).toEqual({
      id: 'proposal-1',
      original: '**Note:** Test',
      options: [{ replacement: 'Note: Test' }],
      context_before: null,
      context_after: null,
    });
    expect(fs.existsSync(proposalFilePath)).toBe(true);
  });

  it('retains routing metadata used to target the correct window', () => {
    const proposalFilePath = path.join(
      os.tmpdir(),
      `md4h-proposal-routing-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
    );

    fs.writeFileSync(
      proposalFilePath,
      JSON.stringify({
        id: 'proposal-2',
        file: '/workspace/docs/target.md',
        source_instance_id: 'window-2',
        original: 'Old text',
        options: [{ replacement: 'New text' }],
        context_before: 'Before',
        context_after: 'After',
      }),
      'utf8'
    );

    const proposal = readPendingProposal(proposalFilePath);

    expect(proposal).toEqual({
      id: 'proposal-2',
      file: '/workspace/docs/target.md',
      source_instance_id: 'window-2',
      original: 'Old text',
      options: [{ replacement: 'New text' }],
      context_before: 'Before',
      context_after: 'After',
    });
  });

  it('returns a queued proposal batch without deleting the temp file during read', () => {
    const proposalFilePath = path.join(
      os.tmpdir(),
      `md4h-proposal-batch-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
    );

    fs.writeFileSync(
      proposalFilePath,
      JSON.stringify({
        id: 'batch-1',
        file: '/workspace/docs/target.md',
        source_instance_id: 'window-2',
        proposals: [
          {
            original: 'Old text',
            replacement: 'New text',
            context_before: 'Before',
            context_after: 'After',
          },
          {
            original: 'Second old text',
            replacement: 'Second new text',
            context_before: null,
            context_after: null,
          },
        ],
      }),
      'utf8'
    );

    const proposal = readPendingProposal(proposalFilePath);

    expect(proposal).toEqual({
      id: 'batch-1',
      file: '/workspace/docs/target.md',
      source_instance_id: 'window-2',
      proposals: [
        {
          original: 'Old text',
          replacement: 'New text',
          context_before: 'Before',
          context_after: 'After',
        },
        {
          original: 'Second old text',
          replacement: 'Second new text',
          context_before: null,
          context_after: null,
        },
      ],
    });
    expect(fs.existsSync(proposalFilePath)).toBe(true);
  });

  it('consumes the temp file only for the matching proposal id', () => {
    const proposalFilePath = path.join(
      os.tmpdir(),
      `md4h-proposal-consume-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
    );

    fs.writeFileSync(
      proposalFilePath,
      JSON.stringify({
        id: 'proposal-3',
        original: 'Old text',
        options: [{ replacement: 'New text' }],
        context_before: null,
        context_after: null,
      }),
      'utf8'
    );

    expect(consumePendingProposal('other-id', proposalFilePath)).toBe(false);
    expect(fs.existsSync(proposalFilePath)).toBe(true);
    expect(consumePendingProposal('proposal-3', proposalFilePath)).toBe(true);
    expect(fs.existsSync(proposalFilePath)).toBe(false);
  });
});

describe('shouldHandleProposal', () => {
  beforeEach(() => {
    resetActiveWebviewStateForTests();
  });

  function registerDocument(filePath: string) {
    const panel = {
      webview: { postMessage: jest.fn() },
    } as unknown;
    const document = {
      uri: { fsPath: filePath },
      getText: () => '',
    } as unknown;

    registerWebviewPanel(panel as never, document as never);
  }

  function registerDocumentWithText(filePath: string, text: string) {
    const panel = {
      webview: { postMessage: jest.fn() },
    } as unknown;
    const document = {
      uri: { fsPath: filePath },
      getText: () => text,
    } as unknown;

    registerWebviewPanel(panel as never, document as never);
  }

  function buildProposal(overrides: Partial<ProposalRequest> = {}): ProposalRequest {
    return {
      id: 'proposal-1',
      file: '/workspace/docs/target.md',
      source_instance_id: getEditorHostInstanceId(),
      original: 'Old text',
      options: [{ replacement: 'New text' }],
      context_before: null,
      context_after: null,
      ...overrides,
    };
  }

  it('rejects proposals for files that are not open in Markdown for Humans in this window', () => {
    registerDocument('/workspace/docs/other.md');

    expect(shouldHandleProposal(buildProposal())).toBe(false);
  });

  it('rejects proposals written by a different extension host instance', () => {
    registerDocument('/workspace/docs/target.md');

    expect(
      shouldHandleProposal(
        buildProposal({
          source_instance_id: 'other-window',
        })
      )
    ).toBe(false);
  });

  it('accepts proposals for the matching open file from this extension host instance', () => {
    registerDocument('/workspace/docs/target.md');

    expect(shouldHandleProposal(buildProposal())).toBe(true);
  });

  it('accepts proposal batches for the matching open file from this extension host instance', () => {
    registerDocument('/workspace/docs/target.md');

    expect(
      shouldHandleProposal(
        buildProposal({
          proposals: [
            {
              original: 'Old text',
              options: [{ replacement: 'New text' }],
              context_before: null,
              context_after: null,
            },
          ],
        })
      )
    ).toBe(true);
  });

  it('rejects an unscoped proposal when this window only has unrelated markdown open', () => {
    registerDocumentWithText('/workspace/docs/todo.md', '- [ ] Review drafting notes');

    expect(
      shouldHandleProposal(
        buildProposal({
          file: undefined,
          original:
            'Each Beneficiary is responsible for investing assets held in the Personal Accounts.',
          options: [{
            replacement:
              'Each Beneficiary is responsible for investing assets held in the Personal Accounts and related subaccounts.',
          }],
        })
      )
    ).toBe(false);
  });

  it('accepts an unscoped proposal when an open document in this window contains the target text', () => {
    registerDocumentWithText(
      '/workspace/docs/initial-trust.md',
      [
        '#### Investment Treatment',
        '',
        '- Each Beneficiary is responsible for investing assets held in the Personal Accounts.',
      ].join('\n')
    );

    expect(
      shouldHandleProposal(
        buildProposal({
          file: undefined,
          original: 'Each Beneficiary is responsible for investing assets held in the Personal Accounts.',
          options: [{
            replacement:
              'Each Beneficiary is responsible for investing assets held in the Personal Accounts and related subaccounts.',
          }],
        })
      )
    ).toBe(true);
  });
});
