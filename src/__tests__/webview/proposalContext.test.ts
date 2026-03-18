import {
  buildProposalEditableMarkdown,
  detectProposalInlineBlockContext,
  detectProposalInlineWrapperContext,
  extractProposalReplacementFromEditableMarkdown,
  normalizeProposalReplacementForContext,
} from '../../webview/utils/proposalContext';

describe('proposalContext', () => {
  it('detects ordered list context from partial inline selection context', () => {
    expect(
      detectProposalInlineBlockContext(
        [
          '1. The Beneficiary must be Disbursement Eligible.',
          '2. Prior to voting to approve, each Committee member shall make a good-faith effort to determine that the applicable eligibility criteria, category requirements, and limitations have been satisfied.',
          '3. For any Beneficiary to receive a transfer, the majority of Committee Members (excluding the requesting Beneficiary if the requesting Beneficiary is on the Committee) must approve.',
          '4. The ',
        ].join('\n'),
        'committee members',
        ' may approve Qualified Spending in any amount up to the applicable category-specific and aggregate limits set forth in Section 06.'
      )
    ).toEqual({
      kind: 'orderedListItem',
      indent: '',
      orderedStart: 4,
    });
  });

  it('preserves the original ordered-list number when proposal serialization falls back to 1', () => {
    expect(
      normalizeProposalReplacementForContext(
        '4. The committee members may approve Qualified Spending.',
        '1. The Committee Members may approve Qualified Spending.',
        '',
        ''
      )
    ).toBe('4. The Committee Members may approve Qualified Spending.');
  });

  it('does not add an ordered-list marker for partial inline selections inside an ordered list', () => {
    expect(
      normalizeProposalReplacementForContext(
        'committee members',
        'Committee Members',
        '4. The ',
        ' may approve Qualified Spending.'
      )
    ).toBe('Committee Members');
  });

  it('restores nested sub-bullet indentation for a partial selection inside a parent unordered list item', () => {
    expect(
      normalizeProposalReplacementForContext(
        [
          'If the Beneficiary is a committee member,',
          "  - she still participates in approving other committee members' transfers and disbursements",
          '  - she still suffers scoring penalties if they vote to approve Excess Disbursements',
        ].join('\n'),
        [
          'If the Beneficiary is a Committee Member,',
          '',
          "- she still participates in approving other Committee Members' transfers and disbursements",
          '- she still suffers scoring penalties if they vote to approve Excess Disbursements',
        ].join('\n'),
        '- ',
        '\n- Stewardship Score may increase at the end of the year if there are no Excess Disbursements or misappropriations'
      )
    ).toBe(
      [
        'If the Beneficiary is a Committee Member,',
        "  - she still participates in approving other Committee Members' transfers and disbursements",
        '  - she still suffers scoring penalties if they vote to approve Excess Disbursements',
      ].join('\n')
    );
  });

  it('detects a shared bold wrapper split across context before and after', () => {
    expect(
      detectProposalInlineWrapperContext(
        'that resulted in a Misappropriation, **',
        'satisfies the account access requirements of Section 02, satisfies the reporting requirements of Section 14 (including the timely submission of a complete year-end report), and, if applicable, submits a Spousal Waiver required under Section 13 with the immediately preceding year-end review.',
        '** This score increase applies regardless of whether the Beneficiary was Disbursement Eligible during that year.'
      )
    ).toEqual({ kind: 'strong' });
  });

  it('builds contextual heading markdown for the proposal editor instead of using styling hacks', () => {
    expect(
      buildProposalEditableMarkdown(
        'Accounts ',
        'Financial Accounts ',
        '# ',
        'and Their Relationships'
      )
    ).toBe('# Financial Accounts ');
  });

  it('extracts the replacement fragment from contextual heading markdown', () => {
    expect(
      extractProposalReplacementFromEditableMarkdown(
        'Accounts ',
        '# Financial Accounts ',
        '# ',
        'and Their Relationships'
      )
    ).toBe('Financial Accounts ');
  });

  it('builds real bold markdown for proposal editor content when wrapper context is split across before and after', () => {
    expect(
      buildProposalEditableMarkdown(
        'year-end review',
        'Year-end Review',
        'the immediately preceding **',
        '**.'
      )
    ).toBe('**Year-end Review**');
  });

  it('extracts the replacement fragment from wrapped proposal editor markdown', () => {
    expect(
      extractProposalReplacementFromEditableMarkdown(
        'year-end review',
        '**Year-end Review**',
        'the immediately preceding **',
        '**.'
      )
    ).toBe('Year-end Review');
  });

  it('extracts the replacement fragment from contextual list-item markdown even when the editor serialization adds a trailing newline', () => {
    expect(
      extractProposalReplacementFromEditableMarkdown(
        'satisfies the account access requirements of Section 02, satisfies the reporting requirements of Section 14 (including the timely submission of a complete year-end report), and, if applicable, submits a Spousal Waiver required under Section 13 with the immediately preceding year-end review.',
        '- **satisfies the account access requirements of Section 02, satisfies the reporting requirements of Section 14 (including the timely submission of a complete year-end report), and, if applicable, submits a Spousal Waiver required under Section 13 with the immediately preceding Year-end Review.**\n',
        '- For each calendar year, a Beneficiary\'s Stewardship Score shall increase by one (1) if the Beneficiary neither receives nor approves any Excess Disbursements, has no Misappropriation of Trust funds detected as the Beneficiary, voted for no Advance Approvals that resulted in a Misappropriation, **',
        '** This score increase applies regardless of whether the Beneficiary was Disbursement Eligible during that year.'
      )
    ).toBe(
      'satisfies the account access requirements of Section 02, satisfies the reporting requirements of Section 14 (including the timely submission of a complete year-end report), and, if applicable, submits a Spousal Waiver required under Section 13 with the immediately preceding Year-end Review.'
    );
  });
});
