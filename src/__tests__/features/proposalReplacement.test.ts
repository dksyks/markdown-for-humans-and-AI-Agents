import { applyProposalReplacement, findProposalMatch } from '../../features/proposalReplacement';

describe('proposalReplacement', () => {
  it('finds an inline match when the serialized selection splits around bold text', () => {
    const fullMarkdown =
      'Any **shortfall** between such proportionate fair market value and the amount actually returned—whether due to gift, below-market sale, or diversion of proceeds—shall be deemed a Misappropriation of Trust funds.';
    const serializedSelection =
      'Any \n\n**shortfall**\n\n between such proportionate fair market value and the amount actually returned—whether due to gift, below-market sale, or diversion of proceeds—shall be deemed a Misappropriation of Trust funds.';

    const match = findProposalMatch(fullMarkdown, {
      original: serializedSelection,
      replacement:
        'Any shortfall between such proportionate fair market value and the amount actually returned—whether due to gift, below-market sale, or diversion of proceeds—shall be deemed a Misappropriation of Trust funds.',
      context_before: null,
      context_after: null,
    });

    expect(match).toEqual({
      index: 0,
      matchedText: fullMarkdown,
    });
  });

  it('applies a replacement when the document uses non-breaking spaces', () => {
    const fullMarkdown =
      'Any **shortfall** between such proportionate fair market value and the amount actually returned—whether due to gift, below-market sale, or diversion of proceeds—shall be deemed a Misappropriation of Trust funds.\u00a0';
    const serializedSelection =
      'Any \n\n**shortfall**\n\n between such proportionate fair market value and the amount actually returned—whether due to gift, below-market sale, or diversion of proceeds—shall be deemed a Misappropriation of Trust funds. ';

    const result = applyProposalReplacement(fullMarkdown, {
      original: serializedSelection,
      replacement:
        'Any shortfall between such proportionate fair market value and the amount actually returned—whether due to gift, below-market sale, or diversion of proceeds—shall be deemed a Misappropriation of Trust funds.',
      context_before: null,
      context_after: null,
    });

    expect(result).toEqual({
      index: 0,
      matchedText: fullMarkdown,
      newContent:
        'Any shortfall between such proportionate fair market value and the amount actually returned—whether due to gift, below-market sale, or diversion of proceeds—shall be deemed a Misappropriation of Trust funds.',
    });
  });

  it('finds an inline match when the serialized selection splits around italic text', () => {
    const fullMarkdown = 'The beneficiary must act in *good faith* when making disclosures.';
    const serializedSelection =
      'The beneficiary must act in \n\n*good faith*\n\n when making disclosures.';

    const match = findProposalMatch(fullMarkdown, {
      original: serializedSelection,
      replacement: 'The beneficiary must act in good faith when making disclosures.',
      context_before: null,
      context_after: null,
    });

    expect(match).toEqual({
      index: 0,
      matchedText: fullMarkdown,
    });
  });

  it('finds an inline match when the serialized selection splits around inline code', () => {
    const fullMarkdown = 'The `surviving spouse` must remain unmarried.';
    const serializedSelection = 'The \n\n`surviving spouse`\n\n must remain unmarried.';

    const match = findProposalMatch(fullMarkdown, {
      original: serializedSelection,
      replacement: 'The surviving spouse must remain unmarried.',
      context_before: null,
      context_after: null,
    });

    expect(match).toEqual({
      index: 0,
      matchedText: fullMarkdown,
    });
  });

  it('finds an inline match when the serialized selection splits around strikethrough text', () => {
    const fullMarkdown = 'This transfer is ~~not~~ no longer permitted.';
    const serializedSelection = 'This transfer is \n\n~~not~~\n\n no longer permitted.';

    const match = findProposalMatch(fullMarkdown, {
      original: serializedSelection,
      replacement: 'This transfer is no longer permitted.',
      context_before: null,
      context_after: null,
    });

    expect(match).toEqual({
      index: 0,
      matchedText: fullMarkdown,
    });
  });

  it('finds an inline match when the serialized selection splits around link text', () => {
    const fullMarkdown =
      'See [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) for the format.';
    const serializedSelection =
      'See \n\n[Keep a Changelog](https://keepachangelog.com/en/1.0.0/)\n\n for the format.';

    const match = findProposalMatch(fullMarkdown, {
      original: serializedSelection,
      replacement: 'See Keep a Changelog for the format.',
      context_before: null,
      context_after: null,
    });

    expect(match).toEqual({
      index: 0,
      matchedText: fullMarkdown,
    });
  });

  it('finds an inline match when the serialized selection splits around combined marks', () => {
    const fullMarkdown = 'The trustee must act in ***good faith*** at all times.';
    const serializedSelection =
      'The trustee must act in \n\n***good faith***\n\n at all times.';

    const match = findProposalMatch(fullMarkdown, {
      original: serializedSelection,
      replacement: 'The trustee must act in good faith at all times.',
      context_before: null,
      context_after: null,
    });

    expect(match).toEqual({
      index: 0,
      matchedText: fullMarkdown,
    });
  });
});
