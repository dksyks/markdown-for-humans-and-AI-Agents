import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readPendingProposal } from '../../features/proposalWatcher';

describe('readPendingProposal', () => {
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
});
