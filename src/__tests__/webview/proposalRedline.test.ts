import {
  renderProposalRedlineHtml,
} from '../../webview/utils/proposalRedline';

describe('proposalRedline', () => {
  it('renders word-level redlines for simple prose changes', () => {
    const html = renderProposalRedlineHtml(
      'This agreement becomes effective on January 1, 2024.',
      'This agreement becomes effective on January 15, 2024.'
    );

    expect(html).toContain('<p>');
    expect(html).toContain('This agreement becomes effective on January ');
    expect(html).toContain('proposal-redline-removed');
    expect(html).toContain('proposal-redline-added');
    expect(html).toContain('>1</span>');
    expect(html).toContain('>15</span>');
    expect(html).toContain(', 2024.');
  });

  it('does not re-diff unchanged punctuation with neighboring word edits', () => {
    const html = renderProposalRedlineHtml(
      'This sentence ends here, clearly.',
      'This statement ends here, clearly.'
    );

    expect(html).toContain('proposal-redline-added');
    expect(html).toContain('proposal-redline-removed');
    expect(html).toContain('here, clearly.');
    expect(html).not.toContain('>here,</span>');
    expect(html).not.toContain('>clearly.</span>');
  });

  it('keeps shared trailing words out of duplicated delete and insert edges', () => {
    const html = renderProposalRedlineHtml(
      'open, welcoming, and community.',
      'inclusive, diverse, or thriving community.'
    );

    const removedIndex = html.indexOf('proposal-redline-removed');
    const addedIndex = html.indexOf('proposal-redline-added');

    expect(removedIndex).toBeGreaterThanOrEqual(0);
    expect(addedIndex).toBeGreaterThan(removedIndex);
    expect(html).toContain('>open, welcoming, and</span>');
    expect(html).toContain('inclusive, diverse, or thriving');
    expect(html).not.toContain('>open, welcoming, and community.</span>');
    expect(html).not.toContain('>inclusive, diverse, or thriving community.</span>');
    expect(html).toContain('</span>community.');
    expect(html).toContain('community.');
  });

  it('renders partial heading-line selections as headings when inline context includes heading markers', () => {
    const html = renderProposalRedlineHtml(
      'Accounts ',
      'Financial Accounts ',
      {
        displayContextBefore: '# ',
        displayContextAfter: 'and Their Relationships',
      }
    );

    expect(html).toContain('<h1>');
    expect(html).toContain('proposal-redline-added');
    expect(html).toContain('Financial');
    expect(html).toContain('Accounts');
    expect(html).toContain('and Their Relationships');
    expect(html).not.toContain('<p><span class="proposal-context-ghost"># ');
    expect(html).not.toContain('proposal-context-ghost"> </span>');
  });

  it('renders partial unordered-list selections as list items when inline context includes a list marker', () => {
    const html = renderProposalRedlineHtml(
      "member's",
      "Member's",
      {
        displayContextBefore: '- The removed ',
        displayContextAfter:
          ' Trust Accounts come under the control of the Committee\n- Any subsequent distributions shall be made by the Committee as then constituted.',
      }
    );

    expect(html).toContain('<ul class="proposal-redline-list"><li>');
    expect(html).toContain('proposal-redline-removed');
    expect(html).toContain('proposal-redline-added');
    expect(html).toContain('Trust Accounts come under the control of the Committee');
    expect(html).toContain('<div class="proposal-context-ghost"><ul>');
    expect(html).toContain('Any subsequent distributions shall be made by the Committee as then constituted.');
    expect(html).not.toContain('<p><span class="proposal-context-ghost">- The removed ');
    expect(html).not.toContain('Trust Accounts come under the control of the Committee<br>- Any subsequent');
  });

  it('renders partial ordered-list selections with the original list number preserved', () => {
    const html = renderProposalRedlineHtml(
      'committee members',
      'Committee Members',
      {
        displayContextBefore: [
          '1. The Beneficiary must be Disbursement Eligible.',
          '2. Prior to voting to approve, each Committee member shall make a good-faith effort to determine that the applicable eligibility criteria, category requirements, and limitations have been satisfied.',
          '3. For any Beneficiary to receive a transfer, the majority of Committee Members (excluding the requesting Beneficiary if the requesting Beneficiary is on the Committee) must approve.',
          '4. The ',
        ].join('\n'),
        displayContextAfter: [
          ' may approve Qualified Spending in any amount up to the applicable category-specific and aggregate limits set forth in Section 06. Qualified Taxes may be approved up to the incremental tax amounts permitted under Section 07.',
          '5. All committee members (excluding the requesting Beneficiary if the requesting Beneficiary is on the committee) participate in approvals, regardless of whether they are Disbursement Ineligible themselves or have entered their Post-Stewardship Years.',
        ].join('\n'),
      }
    );

    expect(html).toContain('<ol class="proposal-redline-list" start="4"><li value="4">');
    expect(html).toContain('proposal-redline-removed');
    expect(html).toContain('proposal-redline-added');
    expect(html).toContain('may approve Qualified Spending in any amount up to the applicable category-specific and aggregate limits set forth in Section 06.');
    expect(html).toContain('<div class="proposal-context-ghost"><ol>');
    expect(html).toContain('<div class="proposal-context-ghost"><ol start="5">');
    expect(html).not.toContain('<ol class="proposal-redline-list"><li>');
  });

  it('preserves heading presentation while redlining the heading text', () => {
    const html = renderProposalRedlineHtml('## Project Goals', '## Implementation Plan');
    const removedIndex = html.indexOf('proposal-redline-removed');
    const addedIndex = html.indexOf('proposal-redline-added');

    expect(html).toContain('<h2>');
    expect(removedIndex).toBeGreaterThanOrEqual(0);
    expect(addedIndex).toBeGreaterThan(removedIndex);
    expect(html).toContain('Project Goals');
    expect(html).toContain('Implementation Plan');
    expect(html).not.toContain('## Project Goals');
    expect(html).not.toContain('## Implementation Plan');
  });

  it('renders structural block replacements as inline review blocks instead of cards', () => {
    const html = renderProposalRedlineHtml(
      '| Name | Value |\n| --- | --- |\n| A | 1 |',
      'The configuration values are now documented in prose.'
    );

    expect(html).toContain('proposal-redline-structural');
    expect(html).toContain('proposal-redline-removed');
    expect(html).toContain('<table>');
    expect(html).toContain('proposal-redline-added');
    expect(html).toContain('data-change-kind="removed"');
    expect(html).toContain('The configuration values are now documented in prose.');
    expect(html).not.toContain('proposal-redline-block-removed');
    expect(html).not.toContain('proposal-redline-block-added');
  });

  it('renders github comment blocks through the markdown for humans html path', () => {
    const html = renderProposalRedlineHtml(
      '> [!COMMENT]\n> Original internal note.',
      '> [!COMMENT]\n> Revised internal note.'
    );

    expect(html).toContain('data-alert-type="COMMENT"');
    expect(html).toContain('github-alert-comment');
    expect(html).toContain('github-alert-label');
    expect(html).toContain('proposal-redline-added');
    expect(html).toContain('proposal-redline-removed');
  });

  it('renders changed inline markdown as formatted html instead of raw markdown', () => {
    const html = renderProposalRedlineHtml(
      'Use **bold** text, *emphasis*, and ~~old wording~~ here.',
      'Use **strong** text, *clearer emphasis*, and ~~revised wording~~ here.'
    );

    expect(html).toContain('<strong>');
    expect(html).toContain('<em>');
    expect(html).toContain('<s>');
    expect(html).toContain('proposal-redline-added');
    expect(html).toContain('proposal-redline-removed');
    expect(html).not.toContain('**strong**');
    expect(html).not.toContain('*clearer emphasis*');
    expect(html).not.toContain('~~revised wording~~');
  });

  it('renders unmatched prose blocks as fully added and removed prose instead of cards', () => {
    const html = renderProposalRedlineHtml(
      'Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu.',
      'Mercury venus earth mars jupiter saturn uranus neptune pluto ceres makemake haumea.'
    );

    expect(html).toContain('proposal-redline-added');
    expect(html).toContain('proposal-redline-removed');
    expect(html).not.toContain('proposal-redline-block-removed');
    expect(html).not.toContain('proposal-redline-block-added');
  });

  it('keeps moderate paragraph rewrites inline for the contributor covenant sentence', () => {
    const html = renderProposalRedlineHtml(
      'We as members, contributors, and leaders pledge to make participation in our community a harassment-free experience for everyone, regardless of age, body size, visible or invisible disability, ethnicity, sex characteristics, gender identity and expression, level of experience, education, socio-economic status, nationality, personal appearance, race, religion, or sexual identity and orientation.',
      'As members, contributors, and leaders, we pledge to make participation in our community a harassment-free experience for everyone, regardless of age, body size, visible or invisible disability, ethnicity, sex characteristics, gender identity or expression, level of experience, education, socioeconomic status, nationality, personal appearance, race, religion, sexual identity, or sexual orientation.'
    );

    expect(html).toContain('<p>');
    expect(html).toContain('proposal-redline-added');
    expect(html).toContain('proposal-redline-removed');
    expect(html).not.toContain('proposal-redline-block-removed');
    expect(html).not.toContain('proposal-redline-block-added');
  });

  it('keeps paired multi-paragraph prose edits inline', () => {
    const html = renderProposalRedlineHtml(
      [
        'The trust becomes irrevocable on the settlor\'s death.',
        '',
        'The trustee may distribute income quarterly to the beneficiary.',
      ].join('\n'),
      [
        'The trust becomes irrevocable upon the settlor\'s death.',
        '',
        'The trustee must distribute income quarterly to the beneficiary.',
      ].join('\n')
    );

    expect((html.match(/proposal-redline-added/g) ?? []).length).toBeGreaterThan(1);
    expect((html.match(/proposal-redline-removed/g) ?? []).length).toBeGreaterThan(1);
    expect(html).not.toContain('proposal-redline-block-removed');
    expect(html).not.toContain('proposal-redline-block-added');
  });

  it('keeps a paragraph split inline when both new paragraphs match the original prose', () => {
    const html = renderProposalRedlineHtml(
      'The trustee shall provide an annual accounting to the beneficiary and retain copies of all supporting records for at least three years.',
      [
        'The trustee shall provide an annual accounting to the beneficiary.',
        '',
        'The trustee shall retain copies of all supporting records for at least three years.',
      ].join('\n')
    );

    expect(html).toContain('proposal-redline-added');
    expect(html).toContain('proposal-redline-removed');
    expect(html).not.toContain('proposal-redline-block-removed');
    expect(html).not.toContain('proposal-redline-block-added');
  });

  it('preserves unchanged prose between separate inline change groups', () => {
    const html = renderProposalRedlineHtml(
      'Instances of abusive, harassing, or otherwise unacceptable behavior may be reported to the community leaders responsible for enforcement at [support@concret.io](mailto:support@concret.io). All complaints will be reviewed and investigated promptly and fairly.',
      'Instances of abusive, harassing, or otherwise unacceptable behavior should be reported to the community leaders responsible for enforcement at [support@concret.io](mailto:support@concret.io). All complaints will be reviewed promptly and handled fairly.'
    );

    expect(html).toContain('proposal-redline-added');
    expect(html).toContain('proposal-redline-removed');
    expect(html).toContain('community leaders responsible for enforcement');
    expect(html).toContain('href="mailto:support@concret.io"');
    expect(html).toContain('All complaints will be reviewed');
    expect(html).toContain('promptly and');
  });

  it('escapes html inside diffed text segments', () => {
    const html = renderProposalRedlineHtml(
      'Use <script>alert(1)</script> carefully.',
      'Use <script>alert(2)</script> carefully.'
    );

    expect(html).toContain('&lt;script&gt;alert(');
    expect(html).toContain(')&lt;/script&gt;');
    expect(html).toContain('>1</span>');
    expect(html).toContain('>2</span>');
    expect(html).not.toContain('<script>alert(1)</script>');
  });

  it('diffs inside a shared outer bold wrapper instead of replacing the whole bold span', () => {
    const html = renderProposalRedlineHtml(
      '**satisfies the account access requirements of Section 02, satisfies the reporting requirements of Section 14 (including the timely submission of a complete year-end report), and, if applicable, submits a Spousal Waiver required under Section 13 with the immediately preceding year-end review.**',
      '**satisfies the account access requirements of Section 02, satisfies the reporting requirements of Section 14 (including the timely submission of a complete year-end report), and, if applicable, submits a Spousal Waiver required under Section 13 with the immediately preceding Year-end Review.**'
    );

    expect(html).toContain('<strong>');
    expect(html).toContain('proposal-redline-removed');
    expect(html).toContain('proposal-redline-added');
    expect(html).toContain('>year-end review</span>');
    expect(html).toContain('>Year-end Review</span>');
    expect(html).not.toContain(
      '<span class="proposal-redline-removed">satisfies the account access requirements of Section 02'
    );
    expect(html).not.toContain(
      '<span class="proposal-redline-added">satisfies the account access requirements of Section 02'
    );
  });

  it('diffs inside a shared bold wrapper split across inline context before and after', () => {
    const html = renderProposalRedlineHtml(
      'satisfies the account access requirements of Section 02, satisfies the reporting requirements of Section 14 (including the timely submission of a complete year-end report), and, if applicable, submits a Spousal Waiver required under Section 13 with the immediately preceding year-end review.',
      'satisfies the account access requirements of Section 02, satisfies the reporting requirements of Section 14 (including the timely submission of a complete year-end report), and, if applicable, submits a Spousal Waiver required under Section 13 with the immediately preceding Year-end Review.',
      {
        displayContextBefore: '- For each calendar year, a Beneficiary\'s Stewardship Score shall increase by one (1) if the Beneficiary neither receives nor approves any Excess Disbursements, has no Misappropriation of Trust funds detected as the Beneficiary, voted for no Advance Approvals that resulted in a Misappropriation, **',
        displayContextAfter: '** This score increase applies regardless of whether the Beneficiary was Disbursement Eligible during that year.',
      }
    );

    expect(html).toContain('<ul class="proposal-redline-list"><li><span class="proposal-context-ghost">');
    expect(html).toContain('proposal-redline-removed');
    expect(html).toContain('proposal-redline-added');
    expect(html).toContain('>year-end review</span>');
    expect(html).toContain('>Year-end Review</span>');
    expect(html).toContain('that resulted in a Misappropriation, </span><strong>');
    expect(html).toContain(
      '</strong><span class="proposal-context-ghost"> This score increase applies regardless of whether the Beneficiary was Disbursement Eligible during that year.</span>'
    );
    expect(html).not.toContain('proposal-context-ghost">**');
    expect(html).not.toContain('** This score increase');
    expect(html).not.toContain(
      '<strong><span class="proposal-context-ghost">For each calendar year'
    );
    expect(html).not.toContain(
      '<span class="proposal-redline-removed">satisfies the account access requirements of Section 02'
    );
    expect(html).not.toContain(
      '<span class="proposal-redline-added">satisfies the account access requirements of Section 02'
    );
  });
});
