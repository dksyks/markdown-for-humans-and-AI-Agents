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
});
