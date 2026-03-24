/**
 * Copyright (c) 2025-2026 Concret.io
 *
 * Licensed under the MIT License. See LICENSE file in the project root for details.
 */

export type NavigationLabelEntry = {
  text: string;
  line?: number | null;
};

export function formatNavigationLabel(
  entry: NavigationLabelEntry,
  showNavigationLineNumbers: boolean
): string {
  const headingText = entry.text || '(Untitled)';
  if (!showNavigationLineNumbers || typeof entry.line !== 'number' || entry.line < 1) {
    return headingText;
  }
  return `${entry.line} - ${headingText}`;
}
