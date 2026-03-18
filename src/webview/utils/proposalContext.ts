export type ProposalInlineBlockContext =
  | { kind: 'heading'; level: number }
  | { kind: 'unorderedListItem'; indent: string; marker: '-' | '*' | '+' }
  | { kind: 'orderedListItem'; indent: string; orderedStart: number }
  | { kind: 'taskListItem'; indent: string; marker: '-' | '*' | '+'; taskChecked: boolean };

export type ProposalInlineWrapperContext =
  | { kind: 'strong' }
  | { kind: 'em' }
  | { kind: 'strike' };

interface ProposalInlineWrapperBounds {
  kind: ProposalInlineWrapperContext['kind'];
  marker: string;
  innerBefore: string;
  innerAfter: string;
}

export function detectProposalInlineBlockContext(
  displayContextBefore: string,
  originalMarkdown: string,
  displayContextAfter: string
): ProposalInlineBlockContext | null {
  const before = displayContextBefore.split('\n').pop() ?? '';
  const originalFirstLine = originalMarkdown.split('\n')[0] ?? originalMarkdown;
  const after = displayContextAfter.split('\n')[0] ?? '';
  const fullLine = `${before}${originalFirstLine}${after}`;

  const taskMatch = fullLine.match(/^\s*[-*+]\s+\[([ xX])\]\s+.*$/);
  if (taskMatch) {
    const indentMatch = fullLine.match(/^(\s*)[-*+]\s+\[([ xX])\]\s+.*$/);
    return {
      kind: 'taskListItem',
      indent: indentMatch?.[1] ?? '',
      marker: ((fullLine.match(/^\s*([-*+])\s+/)?.[1] ?? '-') as '-' | '*' | '+'),
      taskChecked: taskMatch[1].toLowerCase() === 'x',
    };
  }

  const orderedMatch = fullLine.match(/^(\s*)(\d+)\.\s+.*$/);
  if (orderedMatch) {
    return {
      kind: 'orderedListItem',
      indent: orderedMatch[1] ?? '',
      orderedStart: Number(orderedMatch[2]),
    };
  }

  const unorderedMatch = fullLine.match(/^(\s*)([-*+])\s+.*$/);
  if (unorderedMatch) {
    return {
      kind: 'unorderedListItem',
      indent: unorderedMatch[1] ?? '',
      marker: unorderedMatch[2] as '-' | '*' | '+',
    };
  }

  const headingMatch = fullLine.match(/^(#{1,6})\s+.*$/);
  if (headingMatch) {
    return {
      kind: 'heading',
      level: headingMatch[1].length,
    };
  }

  return null;
}

export function normalizeProposalReplacementForContext(
  originalMarkdown: string,
  replacementMarkdown: string,
  displayContextBefore: string,
  displayContextAfter: string
): string {
  if (!replacementMarkdown) {
    return replacementMarkdown;
  }

  const context = detectProposalInlineBlockContext(
    displayContextBefore,
    originalMarkdown,
    displayContextAfter
  );
  const nestedListNormalized = normalizeNestedListFragmentForContext(
    originalMarkdown,
    replacementMarkdown,
    context
  );

  if (context?.kind !== 'orderedListItem') {
    return nestedListNormalized;
  }

  const originalOrderedMatch = originalMarkdown.match(/^(\s*)\d+\.\s+(.*)$/);
  if (!originalOrderedMatch) {
    return nestedListNormalized;
  }

  const replacementOrderedMatch = nestedListNormalized.match(/^(\s*)\d+\.\s+(.*)$/);
  if (replacementOrderedMatch) {
    return nestedListNormalized.replace(
      /^(\s*)\d+\.\s+/,
      `$1${context.orderedStart}. `
    );
  }

  const indent = originalOrderedMatch[1] ?? '';
  return `${indent}${context.orderedStart}. ${nestedListNormalized.trimStart()}`;
}

function normalizeNestedListFragmentForContext(
  originalMarkdown: string,
  replacementMarkdown: string,
  context: ProposalInlineBlockContext | null
): string {
  if (!replacementMarkdown) {
    return replacementMarkdown;
  }

  if (
    context?.kind !== 'unorderedListItem' &&
    context?.kind !== 'orderedListItem' &&
    context?.kind !== 'taskListItem'
  ) {
    return replacementMarkdown;
  }

  const normalizedOriginal = originalMarkdown.replace(/\r\n/g, '\n');
  const originalLines = normalizedOriginal.split('\n');
  if (originalLines.length < 2) {
    return replacementMarkdown;
  }

  const childIndent = detectNestedChildIndent(originalLines);
  if (!childIndent) {
    return replacementMarkdown;
  }

  const lines = replacementMarkdown.replace(/\r\n/g, '\n').split('\n');
  if (lines.length < 2) {
    return replacementMarkdown;
  }

  let firstNestedIndex = -1;
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) {
      continue;
    }
    if (isListMarkerLine(line)) {
      firstNestedIndex = i;
    }
    break;
  }

  if (firstNestedIndex === -1) {
    return replacementMarkdown;
  }

  if (firstNestedIndex > 1) {
    lines.splice(1, firstNestedIndex - 1);
    firstNestedIndex = 1;
  }

  for (let i = firstNestedIndex; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) {
      continue;
    }
    if (isListMarkerLine(line)) {
      const currentIndent = line.match(/^\s*/)?.[0] ?? '';
      if (currentIndent.length < childIndent.length) {
        lines[i] = `${childIndent}${line.trimStart()}`;
      }
    }
  }

  return lines.join('\n');
}

export function buildProposalEditableMarkdown(
  originalMarkdown: string,
  replacementMarkdown: string,
  displayContextBefore: string,
  displayContextAfter: string
): string {
  if (!replacementMarkdown) {
    return replacementMarkdown;
  }

  const blockContext = detectProposalInlineBlockContext(
    displayContextBefore,
    originalMarkdown,
    displayContextAfter
  );
  const wrapperBounds = detectProposalInlineWrapperBounds(displayContextBefore, displayContextAfter);
  let editableMarkdown = replacementMarkdown;

  if (wrapperBounds && !selectionAlreadyIncludesInlineWrapper(originalMarkdown, wrapperBounds.marker)) {
    editableMarkdown = `${wrapperBounds.marker}${editableMarkdown}${wrapperBounds.marker}`;
  }

  if (blockContext && !selectionAlreadyIncludesBlockContext(originalMarkdown, blockContext)) {
    return `${getBlockContextPrefix(blockContext)}${editableMarkdown}`;
  }

  return editableMarkdown;
}

export function extractProposalReplacementFromEditableMarkdown(
  originalMarkdown: string,
  editorMarkdown: string,
  displayContextBefore: string,
  displayContextAfter: string
): string {
  if (!editorMarkdown) {
    return editorMarkdown;
  }

  const blockContext = detectProposalInlineBlockContext(
    displayContextBefore,
    originalMarkdown,
    displayContextAfter
  );
  const wrapperBounds = detectProposalInlineWrapperBounds(displayContextBefore, displayContextAfter);
  let extractedMarkdown = editorMarkdown;

  if (blockContext && !selectionAlreadyIncludesBlockContext(originalMarkdown, blockContext)) {
    const stripped = stripContextLoosely(extractedMarkdown, getBlockContextPrefix(blockContext), '');
    extractedMarkdown = stripped ?? extractedMarkdown;
  }

  if (wrapperBounds && !selectionAlreadyIncludesInlineWrapper(originalMarkdown, wrapperBounds.marker)) {
    const stripped = stripContextLoosely(extractedMarkdown, wrapperBounds.marker, wrapperBounds.marker);
    extractedMarkdown = stripped ?? extractedMarkdown;
  }

  return extractedMarkdown;
}

export function detectProposalInlineWrapperContext(
  displayContextBefore: string,
  originalMarkdown: string,
  displayContextAfter: string
): ProposalInlineWrapperContext | null {
  const bounds = detectProposalInlineWrapperBounds(displayContextBefore, displayContextAfter);
  if (bounds) {
    return { kind: bounds.kind };
  }

  const before = displayContextBefore.split('\n').pop() ?? '';
  const after = displayContextAfter.split('\n')[0] ?? '';
  const fullLine = `${before}${originalMarkdown.split('\n')[0] ?? originalMarkdown}${after}`;
  for (const candidate of INLINE_WRAPPER_CANDIDATES) {
    if (fullLine.startsWith(candidate.marker) && fullLine.endsWith(candidate.marker)) {
      return { kind: candidate.kind };
    }
  }

  return null;
}

const INLINE_WRAPPER_CANDIDATES: Array<{
  marker: string;
  kind: ProposalInlineWrapperContext['kind'];
}> = [
  { marker: '**', kind: 'strong' },
  { marker: '__', kind: 'strong' },
  { marker: '~~', kind: 'strike' },
  { marker: '*', kind: 'em' },
  { marker: '_', kind: 'em' },
];

function detectProposalInlineWrapperBounds(
  displayContextBefore: string,
  displayContextAfter: string
): ProposalInlineWrapperBounds | null {
  const before = displayContextBefore.split('\n').pop() ?? '';
  const after = displayContextAfter.split('\n')[0] ?? '';

  for (const candidate of INLINE_WRAPPER_CANDIDATES) {
    const beforeMarkerIndex = before.lastIndexOf(candidate.marker);
    const afterMarkerIndex = after.indexOf(candidate.marker);
    if (beforeMarkerIndex === -1 && afterMarkerIndex === -1) {
      continue;
    }

    return {
      kind: candidate.kind,
      marker: candidate.marker,
      innerBefore: beforeMarkerIndex === -1 ? before : before.slice(beforeMarkerIndex + candidate.marker.length),
      innerAfter: afterMarkerIndex === -1 ? after : after.slice(0, afterMarkerIndex),
    };
  }

  return null;
}

function stripExactContext(
  markdown: string,
  prefix: string,
  suffix: string
): string | null {
  if (prefix && !markdown.startsWith(prefix)) {
    return null;
  }

  if (suffix && !markdown.endsWith(suffix)) {
    return null;
  }

  const start = prefix.length;
  const end = suffix.length > 0 ? markdown.length - suffix.length : markdown.length;
  if (end < start) {
    return null;
  }

  return markdown.slice(start, end);
}

function stripContextLoosely(
  markdown: string,
  prefix: string,
  suffix: string
): string | null {
  const candidates = Array.from(
    new Set([
      markdown,
      markdown.replace(/\r\n/g, '\n'),
      markdown.replace(/\r\n/g, '\n').replace(/\s+$/, ''),
      markdown.replace(/\r\n/g, '\n').replace(/\n+$/, ''),
    ])
  );

  for (const candidate of candidates) {
    const stripped = stripExactContext(candidate, prefix, suffix);
    if (stripped !== null) {
      return stripped;
    }
  }

  return null;
}

function selectionAlreadyIncludesBlockContext(
  originalMarkdown: string,
  context: ProposalInlineBlockContext
): boolean {
  const firstLine = originalMarkdown.split('\n')[0] ?? originalMarkdown;
  switch (context.kind) {
    case 'heading':
      return /^#{1,6}\s+/.test(firstLine);
    case 'unorderedListItem':
      return /^\s*[-*+]\s+/.test(firstLine);
    case 'orderedListItem':
      return /^\s*\d+\.\s+/.test(firstLine);
    case 'taskListItem':
      return /^\s*[-*+]\s+\[[ xX]\]\s+/.test(firstLine);
  }
}

function selectionAlreadyIncludesInlineWrapper(originalMarkdown: string, marker: string): boolean {
  const trimmed = originalMarkdown.trim();
  return trimmed.startsWith(marker) && trimmed.endsWith(marker);
}

function getBlockContextPrefix(context: ProposalInlineBlockContext): string {
  switch (context.kind) {
    case 'heading':
      return `${'#'.repeat(context.level)} `;
    case 'unorderedListItem':
      return `${context.indent}${context.marker} `;
    case 'orderedListItem':
      return `${context.indent}${context.orderedStart}. `;
    case 'taskListItem': {
      const checked = context.taskChecked ? 'x' : ' ';
      return `${context.indent}${context.marker} [${checked}] `;
    }
  }
}

function detectNestedChildIndent(lines: string[]): string | null {
  let sawNestedListLine = false;

  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) {
      continue;
    }

    const nestedMatch = line.match(/^(\s+)(?:[-*+]\s+\[[ xX]\]\s+|\d+\.\s+|[-*+]\s+)/);
    if (nestedMatch) {
      sawNestedListLine = true;
      return nestedMatch[1];
    }

    if (!/^\s+/.test(line)) {
      return null;
    }
  }

  return sawNestedListLine ? '  ' : null;
}

function isListMarkerLine(line: string): boolean {
  return /^\s*(?:[-*+]\s+\[[ xX]\]\s+|\d+\.\s+|[-*+]\s+)/.test(line);
}
