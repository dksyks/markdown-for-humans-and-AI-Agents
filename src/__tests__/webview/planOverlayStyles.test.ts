import fs from 'fs';
import path from 'path';

describe('plan overlay styles', () => {
  it('keeps the validation warning readable and anchored within the button row', () => {
    const cssPath = path.resolve(__dirname, '../../webview/editor.css');
    const css = fs.readFileSync(cssPath, 'utf8');
    const buttonBlock = css.match(/\.plan-buttons\s*\{([^}]*)\}/)?.[1] ?? '';
    const regionBlock = css.match(/\.plan-validation-region\s*\{([^}]*)\}/)?.[1] ?? '';
    const warningBlock = css.match(/\.plan-validation-warning\s*\{([^}]*)\}/)?.[1] ?? '';

    expect(css).toContain('.plan-validation-region {');
    expect(buttonBlock).toContain('position: relative;');
    expect(buttonBlock).toContain('padding: 2px 0;');
    expect(buttonBlock).toContain('min-height: 36px;');
    expect(regionBlock).toContain('position: absolute;');
    expect(regionBlock).toContain('left: 0;');
    expect(regionBlock).toContain('pointer-events: none;');
    expect(warningBlock).toContain('color: var(--vscode-editor-foreground, #1f1f1f);');
    expect(warningBlock).toContain('white-space: normal;');
    expect(warningBlock).toContain('word-break: break-word;');
    expect(warningBlock).toContain('pointer-events: none;');
    expect(warningBlock).not.toContain('position: absolute;');
  });
});
