/** @jest-environment jsdom */

describe('pinned selection ranges', () => {
  it('splits a multi-block selection into per-text-node ranges', async () => {
    const { buildPinnedSelectionRanges } = await import('../../webview/utils/pinnedSelection');
    const ranges = buildPinnedSelectionRanges(
      {
        nodesBetween(from: number, to: number, cb: (node: any, pos: number) => void) {
          const nodes = [
            { node: { isText: true, nodeSize: 12 }, pos: 1 },
            { node: { isText: true, nodeSize: 8 }, pos: 20 },
          ];
          for (const entry of nodes) {
            if (entry.pos < to && entry.pos + entry.node.nodeSize > from) {
              cb(entry.node, entry.pos);
            }
          }
        },
      } as any,
      5,
      24
    );

    expect(ranges).toEqual([
      { from: 5, to: 13 },
      { from: 20, to: 24 },
    ]);
  });

  it('resolves a block-aligned range to the first and last text positions', async () => {
    const { resolvePinnedTextRange } = await import('../../webview/utils/pinnedSelection');

    const range = resolvePinnedTextRange(
      {
        nodesBetween(from: number, to: number, cb: (node: any, pos: number) => void) {
          const nodes = [
            { node: { isText: true, nodeSize: 9 }, pos: 101 },
            { node: { isText: true, nodeSize: 14 }, pos: 120 },
          ];
          for (const entry of nodes) {
            if (entry.pos < to && entry.pos + entry.node.nodeSize > from) {
              cb(entry.node, entry.pos);
            }
          }
        },
      } as any,
      100,
      140
    );

    expect(range).toEqual({ from: 101, to: 134 });
  });

  it('captures intersecting text blocks for persistent block highlighting', async () => {
    const { buildPinnedBlockRanges } = await import('../../webview/utils/pinnedSelection');
    const ranges = buildPinnedBlockRanges(
      {
        nodesBetween(from: number, to: number, cb: (node: any, pos: number) => void) {
          const nodes = [
            { node: { isTextblock: true, nodeSize: 14 }, pos: 1 },
            { node: { isTextblock: true, nodeSize: 18 }, pos: 20 },
            { node: { isTextblock: false, nodeSize: 6 }, pos: 45 },
          ];
          for (const entry of nodes) {
            if (entry.pos < to && entry.pos + entry.node.nodeSize > from) {
              cb(entry.node, entry.pos);
            }
          }
        },
      } as any,
      5,
      30
    );

    expect(ranges).toEqual([
      { from: 1, to: 15 },
      { from: 20, to: 38 },
    ]);
  });

  it('resolves visible block elements from dom positions for proposal tinting', async () => {
    const { resolvePinnedBlockElements } = await import('../../webview/utils/pinnedSelection');

    document.body.innerHTML = `
      <div class="ProseMirror">
        <p id="first">First <strong>paragraph</strong></p>
        <blockquote><p id="quoted">Quoted text</p></blockquote>
      </div>
    `;

    const firstText = document.querySelector('#first strong')!.firstChild!;
    const quotedText = document.querySelector('#quoted')!.firstChild!;

    const elements = resolvePinnedBlockElements(
      {
        domAtPos(pos: number) {
          if (pos < 20) {
            return { node: firstText, offset: 0 };
          }
          return { node: quotedText, offset: 0 };
        },
      },
      [
        { from: 5, to: 10 },
        { from: 20, to: 30 },
      ]
    );

    expect(elements.map(element => element.id)).toEqual(['first', 'quoted']);
  });

  it('deduplicates repeated positions that map to the same rendered block', async () => {
    const { resolvePinnedBlockElements } = await import('../../webview/utils/pinnedSelection');

    document.body.innerHTML = `
      <div class="ProseMirror">
        <p id="single">Repeated block</p>
      </div>
    `;

    const textNode = document.querySelector('#single')!.firstChild!;

    const elements = resolvePinnedBlockElements(
      {
        domAtPos() {
          return { node: textNode, offset: 0 };
        },
      },
      [
        { from: 3, to: 8 },
        { from: 9, to: 12 },
      ]
    );

    expect(elements.map(element => element.id)).toEqual(['single']);
  });

  it('falls back from block boundary positions to positions inside the block', async () => {
    const { resolvePinnedBlockElementAtPos } = await import('../../webview/utils/pinnedSelection');

    document.body.innerHTML = `
      <div class="ProseMirror">
        <h3 id="heading">Heading text</h3>
      </div>
    `;

    const proseMirror = document.querySelector('.ProseMirror')!;
    const headingText = document.querySelector('#heading')!.firstChild!;

    const element = resolvePinnedBlockElementAtPos(
      {
        domAtPos(pos: number) {
          if (pos === 10) {
            return { node: proseMirror, offset: 0 };
          }
          return { node: headingText, offset: 0 };
        },
      },
      10,
      23
    );

    expect(element?.id).toBe('heading');
  });

  it('resolves the last block directly from the selection end position', async () => {
    const { resolvePinnedBlockElementAtPos } = await import('../../webview/utils/pinnedSelection');

    document.body.innerHTML = `
      <div class="ProseMirror">
        <p id="first">First block</p>
        <p id="last">Last block</p>
      </div>
    `;

    const firstText = document.querySelector('#first')!.firstChild!;
    const lastText = document.querySelector('#last')!.firstChild!;

    const element = resolvePinnedBlockElementAtPos(
      {
        domAtPos(pos: number) {
          if (pos >= 40) {
            return { node: lastText, offset: 0 };
          }
          return { node: firstText, offset: 0 };
        },
      },
      40,
      52
    );

    expect(element?.id).toBe('last');
  });

  it('centers the selection when the full target span fits in view', async () => {
    const { calculateProposalRevealScrollTop } = await import(
      '../../webview/utils/pinnedSelection'
    );

    expect(
      calculateProposalRevealScrollTop({
        currentScrollTop: 200,
        viewportHeight: 800,
        firstTop: 120,
        lastBottom: 520,
        topOffset: 40,
        bottomMargin: 16,
      })
    ).toBe(108);
  });

  it('keeps the selection end visible when a lower portion would otherwise be cut off', async () => {
    const { calculateProposalRevealScrollTop } = await import(
      '../../webview/utils/pinnedSelection'
    );

    expect(
      calculateProposalRevealScrollTop({
        currentScrollTop: 200,
        viewportHeight: 800,
        firstTop: 10,
        lastBottom: 760,
        topOffset: 40,
        bottomMargin: 16,
      })
    ).toBe(170);
  });

  it('biases toward showing the bottom of taller selections', async () => {
    const { calculateProposalRevealScrollTop } = await import(
      '../../webview/utils/pinnedSelection'
    );

    expect(
      calculateProposalRevealScrollTop({
        currentScrollTop: 200,
        viewportHeight: 800,
        firstTop: 120,
        lastBottom: 980,
        topOffset: 40,
        bottomMargin: 16,
      })
    ).toBe(280);
  });

  it('keeps fit-in-view multi-block selections vertically centered', async () => {
    const { calculateProposalRevealScrollTop } = await import(
      '../../webview/utils/pinnedSelection'
    );

    expect(
      calculateProposalRevealScrollTop({
        currentScrollTop: 1593.333251953125,
        viewportHeight: 1101,
        firstTop: 261.41925048828125,
        lastBottom: 720.2083129882812,
        topOffset: 72.8125,
        bottomMargin: 212.94000244140625,
      })
    ).toBeCloseTo(1603.711, 3);
  });

  it('adds temporary bottom padding when the desired reveal exceeds max scroll', async () => {
    const { calculateProposalRevealBottomPadding } = await import(
      '../../webview/utils/pinnedSelection'
    );

    expect(
      calculateProposalRevealBottomPadding({
        desiredScrollTop: 1200,
        currentMaxScrollTop: 900,
        extraMargin: 24,
      })
    ).toBe(324);
  });

  it('does not add bottom padding when the document can already scroll far enough', async () => {
    const { calculateProposalRevealBottomPadding } = await import(
      '../../webview/utils/pinnedSelection'
    );

    expect(
      calculateProposalRevealBottomPadding({
        desiredScrollTop: 900,
        currentMaxScrollTop: 1200,
        extraMargin: 24,
      })
    ).toBe(0);
  });

  it('uses larger reveal padding for larger heading blocks than for inline text', async () => {
    const { getProposalRevealTopPadding } = await import('../../webview/utils/pinnedSelection');

    expect(getProposalRevealTopPadding('H2')).toBeGreaterThan(getProposalRevealTopPadding('H4'));
    expect(getProposalRevealTopPadding('H4')).toBeGreaterThan(
      getProposalRevealTopPadding('SPAN')
    );
  });

  it('normalizes markdown blocks into rendered-text form', async () => {
    const { getNormalizedSelectionBlocks } = await import('../../webview/utils/pinnedSelection');

    expect(
      getNormalizedSelectionBlocks(
        '### 3. Temporary Ban\n\n**Community Impact**: A serious violation.\n\nSee [docs](https://example.com) and `code`.'
      )
    ).toEqual([
      '3. Temporary Ban',
      'Community Impact: A serious violation.',
      'See docs and code.',
    ]);
  });

  it('finds a contiguous rendered block sequence for a markdown selection', async () => {
    const { findRenderedBlockSequence } = await import('../../webview/utils/pinnedSelection');

    const matches = findRenderedBlockSequence(
      [
        { element: document.createElement('p'), text: '2. Warning' },
        { element: document.createElement('h3'), text: '3. Temporary Ban' },
        {
          element: document.createElement('p'),
          text: 'Community Impact: A serious violation of community standards.',
        },
        {
          element: document.createElement('p'),
          text: 'Consequence: A temporary ban from interaction with the community.',
        },
      ],
      [
        '3. Temporary Ban',
        'Community Impact: A serious violation of community standards.',
        'Consequence: A temporary ban from interaction with the community.',
      ]
    );

    expect(matches).toHaveLength(3);
    expect(matches[0].text).toBe('3. Temporary Ban');
    expect(matches[2].text).toContain('Consequence: A temporary ban');
  });

  it('finds a contiguous textblock sequence for a markdown selection', async () => {
    const { findTextBlockSequence } = await import('../../webview/utils/pinnedSelection');

    const matches = findTextBlockSequence(
      [
        { text: '2. Warning', from: 1, to: 10 },
        {
          text: 'Community Impact: A violation through a single incident or series of actions.',
          from: 11,
          to: 30,
        },
        {
          text: 'Consequence: A warning with consequences for continued behavior.',
          from: 31,
          to: 50,
        },
        { text: '3. Temporary Ban', from: 51, to: 60 },
        {
          text: 'Community Impact: A serious violation of community standards, including sustained inappropriate behavior.',
          from: 61,
          to: 80,
        },
        {
          text: 'Consequence: A temporary ban from any sort of interaction or public communication with the community.',
          from: 81,
          to: 100,
        },
      ],
      [
        '3. Temporary Ban',
        'Community Impact: A serious violation of community standards, including sustained inappropriate behavior.',
        'Consequence: A temporary ban from any sort of interaction or public communication with the community.',
      ]
    );

    expect(matches).toHaveLength(3);
    expect(matches[0].text).toBe('3. Temporary Ban');
    expect((matches[0] as { from: number }).from).toBe(51);
    expect((matches[2] as { to: number }).to).toBe(100);
  });

  it('prefers the context-matching repeated text block over the first occurrence', async () => {
    const { findTextBlockSequence } = await import('../../webview/utils/pinnedSelection');

    const matches = findTextBlockSequence(
      [
        { text: 'Contributor Covenant Code of Conduct', from: 1, to: 10 },
        { text: 'This Code of Conduct applies within all community spaces.', from: 11, to: 20 },
        {
          text: 'This Code of Conduct is adapted from the Contributor Covenant.',
          from: 21,
          to: 30,
        },
      ],
      ['Code of Conduct'],
      {
        selectedText: 'Code of Conduct',
        contextBefore: 'This ',
        contextAfter: ' is adapted from the Contributor Covenant.',
      }
    );

    expect(matches).toHaveLength(1);
    expect((matches[0] as { from: number }).from).toBe(21);
    expect(matches[0].text).toContain('is adapted from');
  });

  it('prefers the context-matching rendered block over the first occurrence', async () => {
    const { findRenderedBlockSequence } = await import('../../webview/utils/pinnedSelection');

    const title = document.createElement('h1');
    const scope = document.createElement('p');
    const attribution = document.createElement('p');
    title.textContent = 'Contributor Covenant Code of Conduct';
    scope.textContent = 'This Code of Conduct applies within all community spaces.';
    attribution.textContent = 'This Code of Conduct is adapted from the Contributor Covenant.';

    const matches = findRenderedBlockSequence(
      [
        { element: title, text: title.textContent! },
        { element: scope, text: scope.textContent! },
        { element: attribution, text: attribution.textContent! },
      ],
      ['Code of Conduct'],
      {
        selectedText: 'Code of Conduct',
        contextBefore: 'This ',
        contextAfter: ' is adapted from the Contributor Covenant.',
      }
    );

    expect(matches).toHaveLength(1);
    expect(matches[0].element).toBe(attribution);
  });

  it('resolves the exact inline range inside a matched text block', async () => {
    const { resolveTextRangeWithinTextBlock } = await import('../../webview/utils/pinnedSelection');

    const range = resolveTextRangeWithinTextBlock(
      {
        nodesBetween(from: number, to: number, cb: (node: any, pos: number) => void) {
          const nodes = [
            { node: { isText: true, text: 'This Code of Conduct applies within all community spaces.' }, pos: 101 },
          ];
          for (const entry of nodes) {
            if (entry.pos < to && entry.pos + entry.node.text.length > from) {
              cb(entry.node, entry.pos);
            }
          }
        },
      } as any,
      100,
      160,
      'Code of Conduct',
      {
        contextBefore: 'This ',
        contextAfter: ' applies within all community spaces.',
      }
    );

    expect(range).toEqual({ from: 106, to: 121 });
  });
});
