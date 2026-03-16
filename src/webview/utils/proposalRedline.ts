import MarkdownIt from 'markdown-it';
import { markdownToHtml } from './pasteHandler';

type BlockKind =
  | 'paragraph'
  | 'heading'
  | 'unorderedListItem'
  | 'orderedListItem'
  | 'taskListItem'
  | 'githubAlert'
  | 'blockquote'
  | 'table'
  | 'codeFence';

interface MarkdownBlock {
  kind: BlockKind;
  markdown: string;
  inlineMarkdown: string;
  alertType?: string;
  headingLevel?: number;
  orderedStart?: number;
  taskChecked?: boolean;
}

interface DiffPart {
  value: string;
  type: 'equal' | 'insert' | 'delete';
}

const inlineMarkdownRenderer = new MarkdownIt({
  html: false,
  breaks: true,
  linkify: true,
});

const MAX_INLINE_CHANGE_RUNS = 4;
const LONG_PARAGRAPH_TOKEN_THRESHOLD = 30;
const MAX_INLINE_CHANGE_RUNS_LONG_PARAGRAPH = 12;
const MAX_SHORT_PARAGRAPH_CHANGED_TOKEN_RATIO = 0.5;
const PROSE_PAIRING_SIMILARITY_THRESHOLD = 0.25;
const PREFER_INLINE_REVIEW_RENDERING = true;

/**
 * Render a WYSIWYG review HTML fragment that shows redlined differences between
 * the original markdown selection and the proposed replacement, optionally
 * surrounded by ghosted (low-opacity) context blocks from the source document.
 */
export function renderProposalRedlineHtml(
  originalMarkdown: string,
  replacementMarkdown: string,
  options?: { displayContextBefore?: string; displayContextAfter?: string }
): string {
  const originalBlocks = splitMarkdownBlocks(originalMarkdown);
  const replacementBlocks = splitMarkdownBlocks(replacementMarkdown);
  const operations = diffSequences(
    originalBlocks.map(block => block.markdown),
    replacementBlocks.map(block => block.markdown)
  );

  const fragments: string[] = [];
  let originalIndex = 0;
  let replacementIndex = 0;

  for (let i = 0; i < operations.length; i += 1) {
    const operation = operations[i];

    if (operation.type === 'equal') {
      fragments.push(renderMarkdownBlock(originalBlocks[originalIndex]));
      originalIndex += 1;
      replacementIndex += 1;
      continue;
    }

    if (operation.type === 'delete') {
      const removedBlocks: MarkdownBlock[] = [];
      while (i < operations.length && operations[i].type === 'delete') {
        removedBlocks.push(originalBlocks[originalIndex]);
        originalIndex += 1;
        i += 1;
      }

      const addedBlocks: MarkdownBlock[] = [];
      while (i < operations.length && operations[i].type === 'insert') {
        addedBlocks.push(replacementBlocks[replacementIndex]);
        replacementIndex += 1;
        i += 1;
      }

      i -= 1;
      fragments.push(...renderChangedBlockGroup(removedBlocks, addedBlocks));
      continue;
    }

    if (operation.type === 'insert') {
      const addedBlocks: MarkdownBlock[] = [];
      while (i < operations.length && operations[i].type === 'insert') {
        addedBlocks.push(replacementBlocks[replacementIndex]);
        replacementIndex += 1;
        i += 1;
      }

      i -= 1;
      fragments.push(...addedBlocks.map(block => renderStandaloneBlockChange(block, 'added')));
    }
  }

  if (fragments.length === 0 && !options?.displayContextBefore && !options?.displayContextAfter) {
    return '<p class="proposal-redline-empty">No proposed changes.</p>';
  }

  // Detect inline context: the context may contain complete block elements (headings,
  // paragraphs) followed/preceded by a partial paragraph snippet. Split on \n\n to
  // separate the complete blocks from the inline trailing/leading snippet.
  const contextBefore = options?.displayContextBefore ?? '';
  const contextAfter = options?.displayContextAfter ?? '';
  const beforeParts = contextBefore.split('\n\n');
  const afterParts = contextAfter.split('\n\n');
  // Trailing snippet of contextBefore (the partial paragraph continuation before the selection)
  const inlineBefore = beforeParts[beforeParts.length - 1];
  // Preceding complete blocks (headings, full paragraphs above the inline snippet)
  const precedingContext = beforeParts.slice(0, -1).join('\n\n');
  // Leading snippet of contextAfter (the partial paragraph continuation after the selection)
  const inlineAfter = afterParts[0];
  // Following complete blocks after the inline snippet
  const followingContext = afterParts.slice(1).join('\n\n');

  const isInlineContext =
    (inlineBefore || inlineAfter) &&
    fragments.length > 0 &&
    fragments.every(f => /^<p[ >]/.test(f.trimStart()));

  if (isInlineContext) {
    // Strip outer <p>...</p> from each fragment, then wrap everything in one paragraph.
    const innerHtml = fragments
      .map(f => f.trimStart().replace(/^<p[^>]*>/, '').replace(/<\/p>\s*$/, ''))
      .join('');
    const beforeHtml = inlineBefore
      ? `<span class="proposal-context-ghost">${renderInlineMarkdownSegment(inlineBefore)}</span>`
      : '';
    const afterHtml = inlineAfter
      ? `<span class="proposal-context-ghost">${renderInlineMarkdownSegment(inlineAfter)}</span>`
      : '';

    // Render any preceding complete blocks (e.g. headings) as ghost divs above
    const precedingFragments = precedingContext
      ? splitMarkdownBlocks(precedingContext).map(
          block => `<div class="proposal-context-ghost">${renderMarkdownBlock(block)}</div>`
        )
      : [];
    // Render any following complete blocks as ghost divs below
    const followingFragments = followingContext
      ? splitMarkdownBlocks(followingContext).map(
          block => `<div class="proposal-context-ghost">${renderMarkdownBlock(block)}</div>`
        )
      : [];

    return [...precedingFragments, `<p>${beforeHtml}${innerHtml}${afterHtml}</p>`, ...followingFragments].join('');
  }

  const beforeFragments = options?.displayContextBefore
    ? splitMarkdownBlocks(options.displayContextBefore).map(
        block => `<div class="proposal-context-ghost">${renderMarkdownBlock(block)}</div>`
      )
    : [];

  const afterFragments = options?.displayContextAfter
    ? splitMarkdownBlocks(options.displayContextAfter).map(
        block => `<div class="proposal-context-ghost">${renderMarkdownBlock(block)}</div>`
      )
    : [];

  const allFragments = [...beforeFragments, ...fragments, ...afterFragments];

  if (allFragments.length === 0) {
    return '<p class="proposal-redline-empty">No proposed changes.</p>';
  }

  return allFragments.join('');
}

function renderChangedBlockGroup(removedBlocks: MarkdownBlock[], addedBlocks: MarkdownBlock[]): string[] {
  if (removedBlocks.length === 1 && addedBlocks.length === 1) {
    const removedBlock = removedBlocks[0];
    const addedBlock = addedBlocks[0];

    if (canRenderInlineRedline(removedBlock, addedBlock)) {
      return [renderInlineRedlineBlock(removedBlock, addedBlock)];
    }
  }

  if (removedBlocks.length > 0 && addedBlocks.length > 0 && allBlocksAreInlineRenderable([
    ...removedBlocks,
    ...addedBlocks,
  ])) {
    return renderPairedProseBlockGroup(removedBlocks, addedBlocks);
  }

  if (PREFER_INLINE_REVIEW_RENDERING) {
    return [
      ...removedBlocks.map(block => renderStandaloneBlockChange(block, 'removed')),
      ...addedBlocks.map(block => renderStandaloneBlockChange(block, 'added')),
    ];
  }

  return [
    ...removedBlocks.map(block => renderBlockCard('removed', block)),
    ...addedBlocks.map(block => renderBlockCard('added', block)),
  ];
}

function renderPairedProseBlockGroup(removedBlocks: MarkdownBlock[], addedBlocks: MarkdownBlock[]): string[] {
  const matches = pairSimilarBlocks(removedBlocks, addedBlocks);
  const addedMatchByIndex = new Map<number, number>();
  for (const [removedIndex, addedIndex] of matches.entries()) {
    addedMatchByIndex.set(addedIndex, removedIndex);
  }

  const fragments: string[] = [];
  const renderedRemoved = new Set<number>();
  let removedIndex = 0;
  let addedIndex = 0;

  while (removedIndex < removedBlocks.length || addedIndex < addedBlocks.length) {
    const matchedRemovedIndex = addedMatchByIndex.get(addedIndex);
    if (matchedRemovedIndex !== undefined) {
      while (removedIndex < matchedRemovedIndex) {
        if (!matches.has(removedIndex)) {
          fragments.push(renderStandaloneInlineBlock(removedBlocks[removedIndex], 'removed'));
        }
        renderedRemoved.add(removedIndex);
        removedIndex += 1;
      }

      const removedBlock = removedBlocks[matchedRemovedIndex];
      const addedBlock = addedBlocks[addedIndex];
      fragments.push(renderInlineRedlineBlock(removedBlock, addedBlock));
      renderedRemoved.add(matchedRemovedIndex);
      removedIndex = matchedRemovedIndex + 1;
      addedIndex += 1;
      continue;
    }

    if (addedIndex < addedBlocks.length) {
      fragments.push(renderStandaloneInlineBlock(addedBlocks[addedIndex], 'added'));
      addedIndex += 1;
      continue;
    }

    if (removedIndex < removedBlocks.length && !renderedRemoved.has(removedIndex)) {
      fragments.push(renderStandaloneInlineBlock(removedBlocks[removedIndex], 'removed'));
    }
    removedIndex += 1;
  }

  return fragments;
}

function pairSimilarBlocks(removedBlocks: MarkdownBlock[], addedBlocks: MarkdownBlock[]): Map<number, number> {
  const candidates: Array<{ removedIndex: number; addedIndex: number; score: number }> = [];

  for (let removedIndex = 0; removedIndex < removedBlocks.length; removedIndex += 1) {
    for (let addedIndex = 0; addedIndex < addedBlocks.length; addedIndex += 1) {
      if (removedBlocks[removedIndex].kind !== addedBlocks[addedIndex].kind) {
        continue;
      }

      const score = calculateBlockSimilarity(removedBlocks[removedIndex], addedBlocks[addedIndex]);
      if (score >= PROSE_PAIRING_SIMILARITY_THRESHOLD) {
        candidates.push({ removedIndex, addedIndex, score });
      }
    }
  }

  candidates.sort((left, right) => right.score - left.score);

  const removedMatched = new Set<number>();
  const addedMatched = new Set<number>();
  const matches = new Map<number, number>();

  for (const candidate of candidates) {
    if (removedMatched.has(candidate.removedIndex) || addedMatched.has(candidate.addedIndex)) {
      continue;
    }

    removedMatched.add(candidate.removedIndex);
    addedMatched.add(candidate.addedIndex);
    matches.set(candidate.removedIndex, candidate.addedIndex);
  }

  return matches;
}

function calculateBlockSimilarity(left: MarkdownBlock, right: MarkdownBlock): number {
  const leftTokens = normalizeSimilarityTokens(left.inlineMarkdown);
  const rightTokens = normalizeSimilarityTokens(right.inlineMarkdown);

  if (leftTokens.length === 0 || rightTokens.length === 0) {
    return 0;
  }

  const rightCounts = new Map<string, number>();
  for (const token of rightTokens) {
    rightCounts.set(token, (rightCounts.get(token) ?? 0) + 1);
  }

  let overlap = 0;
  for (const token of leftTokens) {
    const count = rightCounts.get(token) ?? 0;
    if (count > 0) {
      overlap += 1;
      rightCounts.set(token, count - 1);
    }
  }

  return overlap / Math.max(leftTokens.length, rightTokens.length);
}

function normalizeSimilarityTokens(markdown: string): string[] {
  return markdown
    .toLowerCase()
    .replace(/[*_~`#[\]()!.,;:]/g, ' ')
    .match(/[a-z0-9]+/g) ?? [];
}

function canRenderInlineRedline(left: MarkdownBlock, right: MarkdownBlock): boolean {
  if (!(left.kind === right.kind && isInlineRenderableBlock(left))) {
    return false;
  }

  if (left.kind === 'githubAlert' && left.alertType !== right.alertType) {
    return false;
  }

  const metrics = measureInlineDiffComplexity(left.inlineMarkdown, right.inlineMarkdown);
  if (left.kind === 'paragraph') {
    const isLongParagraph = metrics.baselineTokenCount >= LONG_PARAGRAPH_TOKEN_THRESHOLD;
    const maxChangeRuns = isLongParagraph
      ? MAX_INLINE_CHANGE_RUNS_LONG_PARAGRAPH
      : MAX_INLINE_CHANGE_RUNS;

    if (metrics.changeRuns > maxChangeRuns) {
      return false;
    }

    if (!isLongParagraph && metrics.changedTokenRatio > MAX_SHORT_PARAGRAPH_CHANGED_TOKEN_RATIO) {
      return false;
    }

    return true;
  }

  return metrics.changeRuns <= MAX_INLINE_CHANGE_RUNS;
}

function allBlocksAreInlineRenderable(blocks: MarkdownBlock[]): boolean {
  return blocks.every(block => isInlineRenderableBlock(block));
}

function isInlineRenderableBlock(block: MarkdownBlock): boolean {
  return (
    block.kind === 'paragraph' ||
    block.kind === 'heading' ||
    block.kind === 'unorderedListItem' ||
    block.kind === 'orderedListItem' ||
    block.kind === 'taskListItem' ||
    block.kind === 'githubAlert' ||
    block.kind === 'blockquote'
  );
}

function renderInlineRedlineBlock(originalBlock: MarkdownBlock, replacementBlock: MarkdownBlock): string {
  const contentHtml = renderInlineDiffText(
    originalBlock.inlineMarkdown,
    replacementBlock.inlineMarkdown
  );

  switch (replacementBlock.kind) {
    case 'heading':
      return `<h${replacementBlock.headingLevel ?? 1}>${contentHtml}</h${replacementBlock.headingLevel ?? 1}>`;
    case 'unorderedListItem':
      return `<ul class="proposal-redline-list"><li>${contentHtml}</li></ul>`;
    case 'orderedListItem':
      return `<ol class="proposal-redline-list" start="${replacementBlock.orderedStart ?? 1}"><li>${contentHtml}</li></ol>`;
    case 'taskListItem': {
      const checked = replacementBlock.taskChecked ? ' checked' : '';
      return `<ul class="proposal-redline-list proposal-redline-task-list"><li><label><input type="checkbox" disabled${checked}> <span>${contentHtml}</span></label></li></ul>`;
    }
    case 'blockquote':
      return `<blockquote><p>${contentHtml}</p></blockquote>`;
    case 'githubAlert':
      return renderGitHubAlertHtml(contentHtml, replacementBlock.alertType ?? 'NOTE');
    case 'paragraph':
    default:
      return `<p>${contentHtml}</p>`;
  }
}

function renderInlineDiffText(originalText: string, replacementText: string): string {
  const parts = diffTextParts(originalText, replacementText);

  return parts
    .map(part => {
      const renderedValue = renderInlineMarkdownSegment(part.value);

      if (part.type === 'delete') {
        return `<span class="proposal-redline-removed">${renderedValue}</span>`;
      }

      if (part.type === 'insert') {
        return `<span class="proposal-redline-added">${renderedValue}</span>`;
      }

      return renderedValue;
    })
    .join('');
}

function renderStandaloneInlineBlock(
  block: MarkdownBlock,
  changeType: 'removed' | 'added'
): string {
  const contentHtml = `<span class="proposal-redline-${changeType}">${renderInlineMarkdownSegment(block.inlineMarkdown)}</span>`;

  switch (block.kind) {
    case 'heading':
      return `<h${block.headingLevel ?? 1}>${contentHtml}</h${block.headingLevel ?? 1}>`;
    case 'unorderedListItem':
      return `<ul class="proposal-redline-list"><li>${contentHtml}</li></ul>`;
    case 'orderedListItem':
      return `<ol class="proposal-redline-list" start="${block.orderedStart ?? 1}"><li>${contentHtml}</li></ol>`;
    case 'taskListItem': {
      const checked = block.taskChecked ? ' checked' : '';
      return `<ul class="proposal-redline-list proposal-redline-task-list"><li><label><input type="checkbox" disabled${checked}> <span>${contentHtml}</span></label></li></ul>`;
    }
    case 'blockquote':
      return `<blockquote><p>${contentHtml}</p></blockquote>`;
    case 'githubAlert':
      return renderGitHubAlertHtml(contentHtml, block.alertType ?? 'NOTE');
    case 'paragraph':
    default:
      return `<p>${contentHtml}</p>`;
  }
}

function renderStandaloneBlockChange(
  block: MarkdownBlock,
  changeType: 'removed' | 'added'
): string {
  if (isInlineRenderableBlock(block)) {
    return renderStandaloneInlineBlock(block, changeType);
  }

  if (PREFER_INLINE_REVIEW_RENDERING) {
    return `
      <div class="proposal-redline-structural proposal-redline-${changeType}" data-change-kind="${changeType}">
        <div class="proposal-redline-structural-content">${renderMarkdownBlock(block)}</div>
      </div>
    `;
  }

  return renderBlockCard(changeType, block);
}

function renderBlockCard(kind: 'removed' | 'added', block: MarkdownBlock): string {
  return `
    <div class="proposal-redline-block proposal-redline-block-${kind}" data-change-kind="${kind}">
      <div class="proposal-redline-block-content">${renderMarkdownBlock(block)}</div>
    </div>
  `;
}

function renderMarkdownBlock(block: MarkdownBlock): string {
  return enhanceRenderedReviewHtml(markdownToHtml(block.markdown));
}

export function renderMarkdownHtml(markdown: string): string {
  return splitMarkdownBlocks(markdown)
    .map(block => renderMarkdownBlock(block))
    .join('');
}

function renderInlineMarkdownSegment(markdown: string): string {
  if (!markdown) {
    return '';
  }

  return inlineMarkdownRenderer.renderInline(markdown);
}

function renderGitHubAlertHtml(contentHtml: string, alertType: string): string {
  const normalizedType = alertType.toUpperCase();
  const typeClass = normalizedType.toLowerCase();

  return `
    <blockquote data-alert-type="${normalizedType}" class="github-alert github-alert-${typeClass}">
      <div class="github-alert-header">
        <span class="github-alert-icon" aria-hidden="true"></span>
        <span class="github-alert-label">${normalizedType}</span>
      </div>
      <div class="github-alert-content">
        <p>${contentHtml}</p>
      </div>
    </blockquote>
  `;
}

function enhanceRenderedReviewHtml(html: string): string {
  return html.replace(
    /<blockquote\s+data-alert-type="([^"]+)"[^>]*>([\s\S]*?)<\/blockquote>/g,
    (_match, alertType: string, innerHtml: string) => renderGitHubAlertHtml(innerHtml.trim(), alertType)
  );
}

function splitMarkdownBlocks(markdown: string): MarkdownBlock[] {
  const normalized = markdown.replace(/\r\n/g, '\n').trim();
  if (!normalized) {
    return [];
  }

  const lines = normalized.split('\n');
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (/^(```|~~~)/.test(line.trim())) {
      const fenceMarker = line.trim().slice(0, 3);
      const codeLines = [line];
      index += 1;
      while (index < lines.length) {
        codeLines.push(lines[index]);
        if (lines[index].trim().startsWith(fenceMarker)) {
          index += 1;
          break;
        }
        index += 1;
      }
      blocks.push({
        kind: 'codeFence',
        markdown: codeLines.join('\n'),
        inlineMarkdown: codeLines.join('\n'),
      });
      continue;
    }

    if (/^#{1,6}\s+/.test(line)) {
      const match = /^(#{1,6})\s+(.*)$/.exec(line);
      if (match) {
        blocks.push({
          kind: 'heading',
          markdown: line,
          inlineMarkdown: match[2],
          headingLevel: match[1].length,
        });
      }
      index += 1;
      continue;
    }

    if (/^\s*[-*+]\s+\[[ xX]\]\s+/.test(line)) {
      const match = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/.exec(line);
      if (match) {
        blocks.push({
          kind: 'taskListItem',
          markdown: line,
          inlineMarkdown: match[2],
          taskChecked: match[1].toLowerCase() === 'x',
        });
      }
      index += 1;
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      const match = /^\s*[-*+]\s+(.*)$/.exec(line);
      if (match && match[1].trim()) {
        blocks.push({
          kind: 'unorderedListItem',
          markdown: line,
          inlineMarkdown: match[1],
        });
      }
      index += 1;
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const match = /^\s*(\d+)\.\s+(.*)$/.exec(line);
      if (match && match[2].trim()) {
        blocks.push({
          kind: 'orderedListItem',
          markdown: line,
          inlineMarkdown: match[2],
          orderedStart: Number(match[1]),
        });
      }
      index += 1;
      continue;
    }

    const alertMatch = line.match(/^>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION|COMMENT)\]\s*$/i);
    if (alertMatch) {
      const alertType = alertMatch[1].toUpperCase();
      const alertLines = [line];
      const contentLines: string[] = [];
      index += 1;
      while (index < lines.length && /^\s*>/.test(lines[index])) {
        alertLines.push(lines[index]);
        contentLines.push(lines[index].replace(/^\s*>\s?/, ''));
        index += 1;
      }
      blocks.push({
        kind: 'githubAlert',
        markdown: alertLines.join('\n'),
        inlineMarkdown: contentLines.join('\n'),
        alertType,
      });
      continue;
    }

    if (/^\s*>/.test(line)) {
      const quoteLines: string[] = [];
      while (index < lines.length && /^\s*>/.test(lines[index])) {
        quoteLines.push(lines[index]);
        index += 1;
      }
      blocks.push({
        kind: 'blockquote',
        markdown: quoteLines.join('\n'),
        inlineMarkdown: quoteLines
          .map(quoteLine => quoteLine.replace(/^\s*>\s?/, ''))
          .join('\n'),
      });
      continue;
    }

    if (/^\|.*\|\s*$/.test(line)) {
      const tableLines: string[] = [];
      while (index < lines.length && /^\|.*\|\s*$/.test(lines[index])) {
        tableLines.push(lines[index]);
        index += 1;
      }
      blocks.push({
        kind: 'table',
        markdown: tableLines.join('\n'),
        inlineMarkdown: tableLines.join('\n'),
      });
      continue;
    }

    const paragraphLines: string[] = [];
    while (
      index < lines.length &&
      lines[index].trim() &&
      !/^(```|~~~)/.test(lines[index].trim()) &&
      !/^#{1,6}\s+/.test(lines[index]) &&
      !/^\s*[-*+]\s+\[[ xX]\]\s+/.test(lines[index]) &&
      !/^\s*[-*+]\s+/.test(lines[index]) &&
      !/^\s*\d+\.\s+/.test(lines[index]) &&
      !/^\s*>/.test(lines[index]) &&
      !/^\|.*\|\s*$/.test(lines[index])
    ) {
      paragraphLines.push(lines[index]);
      index += 1;
    }

    blocks.push({
      kind: 'paragraph',
      markdown: paragraphLines.join('\n'),
      inlineMarkdown: paragraphLines.join('\n'),
    });
  }

  return blocks;
}

function diffTextParts(original: string, replacement: string): DiffPart[] {
  const originalTokens = tokenizeText(original);
  const replacementTokens = tokenizeText(replacement);
  const operations = diffSequences(originalTokens, replacementTokens);
  const parts: DiffPart[] = [];
  let originalIndex = 0;
  let replacementIndex = 0;

  for (const operation of operations) {
    if (operation.type === 'equal') {
      parts.push({ type: 'equal', value: originalTokens[originalIndex] });
      originalIndex += 1;
      replacementIndex += 1;
      continue;
    }

    if (operation.type === 'delete') {
      parts.push({ type: 'delete', value: originalTokens[originalIndex] });
      originalIndex += 1;
      continue;
    }

    parts.push({ type: 'insert', value: replacementTokens[replacementIndex] });
    replacementIndex += 1;
  }

  const merged = mergeAdjacentParts(parts);
  const absorbed = absorbSpacesIntoDiffRuns(merged);
  const remerged = mergeAdjacentParts(absorbed);
  return ensureDeleteBeforeInsert(remerged);
}

function tokenizeText(text: string): string[] {
  return text.match(
    /\s+|!\[[^\]]*?\]\([^)]+\)|\[[^\]]+?\]\([^)]+\)|\*\*[^*\n]+?\*\*|__[^_\n]+?__|~~[^~\n]+?~~|\*[^*\n]+?\*|_[^_\n]+?_|`[^`\n]+?`|[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*|[.,!?;:()[\]{}"“”'‘’/\\-]+|[^\s]/g
  ) ?? [];
}

/**
 * Returns true if every non-whitespace token in the string is either
 * punctuation-only or a word of 1–2 characters. These "glue" segments
 * (e.g. ", and ", "or", "; ") are absorbed into surrounding change runs
 * so that contiguous deletions/insertions render as single highlighted spans.
 */
function isAbsorbableEqualSegment(value: string): boolean {
  const tokens = value.match(/\S+/g) ?? [];
  if (tokens.length === 0) return true; // whitespace-only
  return tokens.every(t => /^[\p{P}\p{S}]+$/u.test(t) || t.length <= 2);
}

/**
 * After merging adjacent same-type parts, equal segments sandwiched between
 * change runs produce alternating spans in the rendered output. This function
 * absorbs equal segments that consist entirely of punctuation or short words
 * (≤ 2 chars) into the surrounding change runs.
 *
 * Handles two patterns:
 *   1. [del][equal-glue][del]  →  merged del
 *   2. [del][ins][equal-glue][del][ins]  →  merged del + merged ins
 *      (and the symmetric [ins][del][equal-glue][ins][del])
 */
function absorbSpacesIntoDiffRuns(parts: DiffPart[]): DiffPart[] {
  let changed = true;
  let result = parts;
  while (changed) {
    changed = false;
    const next: DiffPart[] = [];
    let i = 0;
    while (i < result.length) {
      // Pattern: [A][B][equal-glue][A][B]  where A and B are delete/insert (any order)
      // e.g. del ins equal del ins  →  merged-del merged-ins (deletion always first)
      if (
        i + 4 < result.length &&
        result[i].type !== 'equal' &&
        result[i + 1].type !== 'equal' &&
        result[i].type !== result[i + 1].type &&
        result[i + 2].type === 'equal' &&
        result[i + 3].type === result[i].type &&
        result[i + 4].type === result[i + 1].type &&
        isAbsorbableEqualSegment(result[i + 2].value)
      ) {
        const glue = result[i + 2].value;
        const mergedA = { type: result[i].type, value: result[i].value + glue + result[i + 3].value };
        const mergedB = { type: result[i + 1].type, value: result[i + 1].value + glue + result[i + 4].value };
        // Always output deletion before insertion
        if (mergedA.type === 'delete') {
          next.push(mergedA, mergedB);
        } else {
          next.push(mergedB, mergedA);
        }
        i += 5;
        changed = true;
        continue;
      }
      // Pattern: [same][equal-glue][same]  →  merged same
      if (
        i + 2 < result.length &&
        result[i].type !== 'equal' &&
        result[i + 1].type === 'equal' &&
        result[i + 2].type === result[i].type &&
        isAbsorbableEqualSegment(result[i + 1].value)
      ) {
        next.push({ type: result[i].type, value: result[i].value + result[i + 1].value + result[i + 2].value });
        i += 3;
        changed = true;
        continue;
      }
      next.push(result[i]);
      i += 1;
    }
    result = next;
  }
  return result;
}

/**
 * Reorder parts so all deletions for a change group appear before insertions.
 * Collects all contiguous non-equal parts (dels and ins mixed with equals between
 * them) and re-emits them as: all deletes, then all inserts, then the trailing equal.
 */
function ensureDeleteBeforeInsert(parts: DiffPart[]): DiffPart[] {
  const result: DiffPart[] = [];
  let i = 0;
  while (i < parts.length) {
    if (parts[i].type === 'equal') {
      result.push(parts[i]);
      i++;
      continue;
    }
    // Collect a run of change parts (del/ins) possibly separated by equal segments
    // Stop when we hit an equal that is NOT between two change parts
    const dels: DiffPart[] = [];
    const ins: DiffPart[] = [];
    const pendingEquals: DiffPart[] = [];
    while (i < parts.length) {
      if (parts[i].type === 'delete') {
        dels.push(parts[i]);
        pendingEquals.length = 0;
        i++;
      } else if (parts[i].type === 'insert') {
        ins.push(parts[i]);
        pendingEquals.length = 0;
        i++;
      } else {
        // equal — peek ahead: if next non-equal is a change, keep collecting
        let j = i + 1;
        while (j < parts.length && parts[j].type === 'equal') j++;
        if (j < parts.length && parts[j].type !== 'equal') {
          // there's more changes ahead — hold this equal as pending
          pendingEquals.push(parts[i]);
          i++;
        } else {
          // no more changes — stop here, leave equal for next iteration
          break;
        }
      }
    }
    // Emit: all deletes, then all inserts, then any pending equals
    result.push(...dels, ...ins, ...pendingEquals);
  }
  return result;
}

function mergeAdjacentParts(parts: DiffPart[]): DiffPart[] {
  if (parts.length === 0) {
    return parts;
  }

  const merged: DiffPart[] = [parts[0]];

  for (let index = 1; index < parts.length; index += 1) {
    const current = parts[index];
    const previous = merged[merged.length - 1];

    if (previous.type === current.type) {
      previous.value += current.value;
      continue;
    }

    merged.push({ ...current });
  }

  return merged;
}

function measureInlineDiffComplexity(original: string, replacement: string): {
  changeRuns: number;
  baselineTokenCount: number;
  changedTokenRatio: number;
} {
  const originalTokens = tokenizeText(original);
  const replacementTokens = tokenizeText(replacement);
  // Use the post-absorbed parts so run counts match what actually renders
  const parts = diffTextParts(original, replacement);

  let changeRuns = 0;
  let changedTokenCount = 0;
  let inChangeRun = false;

  for (const part of parts) {
    if (part.type === 'equal') {
      inChangeRun = false;
      continue;
    }
    changedTokenCount += (part.value.trim().match(/\S+/g) ?? []).length;
    if (!inChangeRun) {
      changeRuns += 1;
      inChangeRun = true;
    }
  }

  return {
    changeRuns,
    baselineTokenCount: Math.max(originalTokens.length, replacementTokens.length),
    changedTokenRatio:
      changedTokenCount / Math.max(originalTokens.length, replacementTokens.length, 1),
  };
}

function diffSequences<T>(left: T[], right: T[]): Array<{ type: 'equal' | 'delete' | 'insert' }> {
  const rows = left.length + 1;
  const cols = right.length + 1;
  const table = Array.from({ length: rows }, () => Array<number>(cols).fill(0));

  for (let leftIndex = left.length - 1; leftIndex >= 0; leftIndex -= 1) {
    for (let rightIndex = right.length - 1; rightIndex >= 0; rightIndex -= 1) {
      if (left[leftIndex] === right[rightIndex]) {
        table[leftIndex][rightIndex] = table[leftIndex + 1][rightIndex + 1] + 1;
      } else {
        table[leftIndex][rightIndex] = Math.max(
          table[leftIndex + 1][rightIndex],
          table[leftIndex][rightIndex + 1]
        );
      }
    }
  }

  const operations: Array<{ type: 'equal' | 'delete' | 'insert' }> = [];
  let leftIndex = 0;
  let rightIndex = 0;

  while (leftIndex < left.length && rightIndex < right.length) {
    if (left[leftIndex] === right[rightIndex]) {
      operations.push({ type: 'equal' });
      leftIndex += 1;
      rightIndex += 1;
      continue;
    }

    if (table[leftIndex + 1][rightIndex] >= table[leftIndex][rightIndex + 1]) {
      operations.push({ type: 'delete' });
      leftIndex += 1;
      continue;
    }

    operations.push({ type: 'insert' });
    rightIndex += 1;
  }

  while (leftIndex < left.length) {
    operations.push({ type: 'delete' });
    leftIndex += 1;
  }

  while (rightIndex < right.length) {
    operations.push({ type: 'insert' });
    rightIndex += 1;
  }

  return operations;
}
