import fs from 'fs';
import path from 'path';

describe('search overlay styles', () => {
  it('keeps the search panel responsive on narrow viewports', () => {
    const cssPath = path.resolve(__dirname, '../../webview/editor.css');
    const css = fs.readFileSync(cssPath, 'utf8');

    expect(css).toContain('width: min(600px, calc(100vw - 24px));');
    expect(css).toContain('max-width: calc(100vw - 24px);');
    expect(css).toContain('@media (max-width: 560px)');
    expect(css).toContain('grid-template-columns: minmax(0, 1fr);');
    expect(css).toContain('justify-content: space-between;');
  });

  it('right-justifies the replace actions and keeps bordered replace buttons', () => {
    const cssPath = path.resolve(__dirname, '../../webview/editor.css');
    const css = fs.readFileSync(cssPath, 'utf8');
    const replaceButtonBlocks = css.match(/\.search-overlay-replace-btn\s*\{([^}]*)\}/g) ?? [];

    expect(css).toContain('.search-overlay-replace-actions {');
    expect(css).toContain('justify-self: end;');
    expect(css).toContain('justify-content: flex-end;');
    expect(replaceButtonBlocks.some(block => block.includes('border: 1px solid'))).toBe(true);
  });

  it('styles the replace input the same way as the find input', () => {
    const cssPath = path.resolve(__dirname, '../../webview/editor.css');
    const css = fs.readFileSync(cssPath, 'utf8');

    expect(css).toContain('.search-overlay-input,');
    expect(css).toContain('.search-overlay-replace-input {');
    expect(css).toContain('background: transparent;');
    expect(css).toContain('border: none;');
    expect(css).toContain('min-width: 150px;');
    expect(css).toContain('.search-overlay-replace-input::placeholder {');
  });
});
