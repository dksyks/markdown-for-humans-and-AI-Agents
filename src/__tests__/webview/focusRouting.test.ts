/** @jest-environment jsdom */

import { shouldPreserveFocusedElementOnWindowFocus } from '../../webview/utils/focusRouting';

describe('focus routing', () => {
  it('preserves focus for elements inside the search overlay', () => {
    document.body.innerHTML = `
      <div class="search-overlay">
        <input class="search-overlay-input" />
      </div>
    `;

    const input = document.querySelector('.search-overlay-input');
    expect(shouldPreserveFocusedElementOnWindowFocus(input)).toBe(true);
  });

  it('preserves focus for elements inside the navigation pane', () => {
    document.body.innerHTML = `
      <div id="toc-panel-wrapper">
        <button class="toc-panel-item">Heading</button>
      </div>
    `;

    const button = document.querySelector('.toc-panel-item');
    expect(shouldPreserveFocusedElementOnWindowFocus(button)).toBe(true);
  });

  it('preserves focus for elements inside the formatting toolbar', () => {
    document.body.innerHTML = `
      <div class="formatting-toolbar">
        <button class="toolbar-btn">Bold</button>
      </div>
    `;

    const button = document.querySelector('.toolbar-btn');
    expect(shouldPreserveFocusedElementOnWindowFocus(button)).toBe(true);
  });

  it('allows the editor to reclaim focus for unrelated active elements', () => {
    document.body.innerHTML = '<div class="outside"></div>';

    const outside = document.querySelector('.outside');
    expect(shouldPreserveFocusedElementOnWindowFocus(outside)).toBe(false);
    expect(shouldPreserveFocusedElementOnWindowFocus(null)).toBe(false);
  });
});
