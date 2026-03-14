import { resolveSelectionMatch } from '../../webview/utils/selectionMatching';

describe('resolveSelectionMatch', () => {
  it('returns the exact match when the serialized selection already matches the document', () => {
    const fullMarkdown = '**Note:** This is a sentence.';
    const result = resolveSelectionMatch(fullMarkdown, '**Note:** This is a sentence.');

    expect(result).toEqual({
      selected: '**Note:** This is a sentence.',
      index: 0,
    });
  });

  it('collapses serializer-introduced paragraph breaks for inline content', () => {
    const fullMarkdown =
      '**Note:** This is the ONLY changelog file. Use this content for GitHub releases.';
    const serializedSelection =
      '**Note:**\n\n This is the ONLY changelog file. Use this content for GitHub releases.';

    const result = resolveSelectionMatch(fullMarkdown, serializedSelection);

    expect(result).toEqual({
      selected: fullMarkdown,
      index: 0,
    });
  });

  it('returns null when no candidate matches the document', () => {
    const result = resolveSelectionMatch('Alpha beta gamma', 'Completely different text');
    expect(result).toBeNull();
  });

  it('matches when the document contains non-breaking spaces but the selection uses regular spaces', () => {
    const fullMarkdown = '**Market Participation.** Disbursement\u00a0Eligible.';
    const serializedSelection = '**Market Participation.** Disbursement Eligible.';

    const result = resolveSelectionMatch(fullMarkdown, serializedSelection);

    expect(result).toEqual({
      selected: fullMarkdown,
      index: 0,
    });
  });

  it('collapses serializer-introduced paragraph breaks before punctuation in inline content', () => {
    const fullMarkdown =
      '**Community Impact**: A serious violation of community standards, including sustained inappropriate behavior.';
    const serializedSelection =
      '**Community Impact**\n\n: A serious violation of community standards, including sustained inappropriate behavior.';

    const result = resolveSelectionMatch(fullMarkdown, serializedSelection);

    expect(result).toEqual({
      selected: fullMarkdown,
      index: 0,
    });
  });

  it('collapses serializer-introduced paragraph breaks around inline links', () => {
    const fullMarkdown =
      'This Code of Conduct is adapted from the [Contributor Covenant](https://www.contributor-covenant.org), version 2.1.';
    const serializedSelection =
      'This Code of Conduct is adapted from the \n\n[Contributor Covenant](https://www.contributor-covenant.org)\n\n, version 2.1.';

    const result = resolveSelectionMatch(fullMarkdown, serializedSelection);

    expect(result).toEqual({
      selected: fullMarkdown,
      index: 0,
    });
  });

  it('collapses serializer-introduced paragraph breaks around inline links followed by another link', () => {
    const fullMarkdown =
      'This Code of Conduct is adapted from the [Contributor Covenant](https://www.contributor-covenant.org), version 2.1, available at [https://www.contributor-covenant.org/version/2/1/code_of_conduct.html](https://www.contributor-covenant.org/version/2/1/code_of_conduct.html).';
    const serializedSelection =
      'This Code of Conduct is adapted from the \n\n[Contributor Covenant](https://www.contributor-covenant.org)\n\n, version 2.1, available at \n\n[https://www.contributor-covenant.org/version/2/1/code_of_conduct.html](https://www.contributor-covenant.org/version/2/1/code_of_conduct.html).';

    const result = resolveSelectionMatch(fullMarkdown, serializedSelection);

    expect(result).toEqual({
      selected: fullMarkdown,
      index: 0,
    });
  });

  it('expands truncated link labels back to the full source link when the href matches', () => {
    const fullMarkdown =
      'This Code of Conduct is adapted from the [Contributor Covenant](https://www.contributor-covenant.org), version 2.1, available at [https://www.contributor-covenant.org/version/2/1/code_of_conduct.html](https://www.contributor-covenant.org/version/2/1/code_of_conduct.html)';
    const serializedSelection =
      'This Code of Conduct is adapted from the \n\n[Contributor Covenant](https://www.contributor-covenant.org)\n\n, version 2.1, available at \n\n[https://www.con](https://www.contributor-covenant.org/version/2/1/code_of_conduct.html)';

    const result = resolveSelectionMatch(fullMarkdown, serializedSelection);

    expect(result).toEqual({
      selected: fullMarkdown,
      index: 0,
    });
  });

  it('prefers the repeated occurrence whose surrounding context matches the live selection', () => {
    const fullMarkdown = [
      '# Contributor Covenant Code of Conduct',
      '',
      '## Scope',
      '',
      'This Code of Conduct applies within all community spaces.',
      '',
      '## Attribution',
      '',
      'This Code of Conduct is adapted from the Contributor Covenant.',
    ].join('\n');

    const result = resolveSelectionMatch(fullMarkdown, 'Code of Conduct', {
      contextBefore: 'This ',
      contextAfter: ' applies within all community spaces.',
    });

    expect(result).toEqual({
      selected: 'Code of Conduct',
      index: fullMarkdown.indexOf('Code of Conduct', fullMarkdown.indexOf('## Scope')),
    });
  });
});
