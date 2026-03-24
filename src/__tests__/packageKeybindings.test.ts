import fs from 'fs';
import path from 'path';

describe('manifest keybindings', () => {
  it('contributes Ctrl+Alt+G for Markdown for Humans Go to Line', () => {
    const manifestPath = path.resolve(__dirname, '../../package.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    expect(manifest.contributes.commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command: 'markdownForHumans.openGotoLine',
          title: 'Go to Line',
        }),
      ])
    );

    expect(manifest.contributes.keybindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command: 'markdownForHumans.openGotoLine',
          key: 'ctrl+alt+g',
          when: 'markdownForHumans.isActive',
        }),
      ])
    );
  });
});
