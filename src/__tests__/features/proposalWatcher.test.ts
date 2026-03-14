import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  getEditorHostInstanceId,
  registerWebviewPanel,
  resetActiveWebviewStateForTests,
} from '../../activeWebview';
import { readPendingProposal, shouldHandleProposal } from '../../features/proposalWatcher';
import type { Proposal } from '../../features/proposalPanel';

describe('readPendingProposal', () => {
  beforeEach(() => {
    resetActiveWebviewStateForTests();
  });

  it('returns the proposal and deletes the temp file after reading it', () => {
    const proposalFilePath = path.join(
      os.tmpdir(),
      `md4h-proposal-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
    );

    fs.writeFileSync(
      proposalFilePath,
      JSON.stringify({
        id: 'proposal-1',
        original: '**Note:** Test',
        replacement: 'Note: Test',
        context_before: null,
        context_after: null,
      }),
      'utf8'
    );

    const proposal = readPendingProposal(proposalFilePath);

    expect(proposal).toEqual({
      id: 'proposal-1',
      original: '**Note:** Test',
      replacement: 'Note: Test',
      context_before: null,
      context_after: null,
    });
    expect(fs.existsSync(proposalFilePath)).toBe(false);
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
        replacement: 'New text',
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
      replacement: 'New text',
      context_before: 'Before',
      context_after: 'After',
    });
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
    } as unknown;

    registerWebviewPanel(panel as never, document as never);
  }

  function buildProposal(overrides: Partial<Proposal> = {}): Proposal {
    return {
      id: 'proposal-1',
      file: '/workspace/docs/target.md',
      source_instance_id: getEditorHostInstanceId(),
      original: 'Old text',
      replacement: 'New text',
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
});
