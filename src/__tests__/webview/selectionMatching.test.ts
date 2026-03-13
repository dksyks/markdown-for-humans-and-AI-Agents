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
});
