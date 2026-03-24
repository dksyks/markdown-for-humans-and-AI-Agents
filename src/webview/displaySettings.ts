/**
 * Copyright (c) 2025-2026 Concret.io
 *
 * Licensed under the MIT License. See LICENSE file in the project root for details.
 */

export type EditorDisplaySettings = {
  showHeadingGutter: boolean;
  showDocumentLineNumbers: boolean;
  showNavigationLineNumbers: boolean;
};

export const editorDisplaySettings: EditorDisplaySettings = {
  showHeadingGutter: true,
  showDocumentLineNumbers: false,
  showNavigationLineNumbers: false,
};

export function updateDisplaySettings(settings: Record<string, unknown>): void {
  if (typeof settings.showHeadingGutter === 'boolean') {
    editorDisplaySettings.showHeadingGutter = settings.showHeadingGutter;
  }
  if (typeof settings.showDocumentLineNumbers === 'boolean') {
    editorDisplaySettings.showDocumentLineNumbers = settings.showDocumentLineNumbers;
  }
  if (typeof settings.showNavigationLineNumbers === 'boolean') {
    editorDisplaySettings.showNavigationLineNumbers = settings.showNavigationLineNumbers;
  }
}
