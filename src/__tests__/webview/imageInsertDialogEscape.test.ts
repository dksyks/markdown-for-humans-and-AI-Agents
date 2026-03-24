/** @jest-environment jsdom */

import type { Editor } from '@tiptap/core';
import { showImageInsertDialog } from '../../webview/features/imageInsertDialog';

jest.mock('../../webview/features/imageConfirmation', () => ({
  confirmImageDrop: jest.fn(),
  getRememberedFolder: jest.fn(() => null),
  setRememberedFolder: jest.fn(),
  getDefaultImagePath: jest.fn(() => 'images'),
}));

jest.mock('../../webview/features/hugeImageDialog', () => ({
  showHugeImageDialog: jest.fn(),
  isHugeImage: jest.fn(() => false),
}));

jest.mock('../../webview/features/imageDragDrop', () => ({
  isImageFile: jest.fn(() => true),
  insertImage: jest.fn(),
  extractImagePathFromDataTransfer: jest.fn(() => null),
  hasImageFiles: jest.fn(() => false),
}));

describe('imageInsertDialog Escape cleanup', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('removes the document Escape listener when the dialog closes', async () => {
    const editor = {
      state: {
        selection: { from: 12 },
      },
    } as unknown as Editor;

    const promise = showImageInsertDialog(editor, { postMessage: jest.fn() });

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    await expect(promise).resolves.toBeUndefined();
    expect(document.querySelector('.image-insert-dialog-overlay')).toBeNull();
    expect(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    }).not.toThrow();
  });
});
