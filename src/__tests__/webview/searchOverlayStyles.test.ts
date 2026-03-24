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
});
