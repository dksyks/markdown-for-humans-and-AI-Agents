import * as fs from 'fs';
import * as vscode from 'vscode';
import {
  getEditorHostInstanceId,
  resetActiveWebviewStateForTests,
  setActiveWebviewPanel,
} from '../../activeWebview';
import {
  FOCUSED_INSTANCE_TEMP_FILE,
  updateFocusedInstanceMetadataForCurrentWindow,
} from '../../editor/MarkdownEditorProvider';

describe('focused instance metadata', () => {
  let focusedInstanceBackup: string | null;

  const readFileBackup = (filePath: string): string | null =>
    fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null;

  const restoreFileBackup = (filePath: string, contents: string | null) => {
    if (contents === null) {
      try {
        fs.unlinkSync(filePath);
      } catch {}
      return;
    }

    fs.writeFileSync(filePath, contents, 'utf8');
  };

  beforeEach(() => {
    resetActiveWebviewStateForTests();
    focusedInstanceBackup = readFileBackup(FOCUSED_INSTANCE_TEMP_FILE);
    restoreFileBackup(FOCUSED_INSTANCE_TEMP_FILE, null);
  });

  afterEach(() => {
    restoreFileBackup(FOCUSED_INSTANCE_TEMP_FILE, focusedInstanceBackup);
    resetActiveWebviewStateForTests();
  });

  it('writes the focused instance metadata for the current window when VS Code is focused', () => {
    (vscode.window as typeof vscode.window & { state: { focused: boolean } }).state.focused = true;
    setActiveWebviewPanel(
      {} as never,
      {
        uri: { fsPath: '/workspace/docs/focused-window.md' },
        fileName: '/workspace/docs/focused-window.md',
      } as never
    );

    updateFocusedInstanceMetadataForCurrentWindow();

    expect(fs.existsSync(FOCUSED_INSTANCE_TEMP_FILE)).toBe(true);
    expect(JSON.parse(fs.readFileSync(FOCUSED_INSTANCE_TEMP_FILE, 'utf8'))).toEqual(
      expect.objectContaining({
        instance_id: getEditorHostInstanceId(),
        file: '/workspace/docs/focused-window.md',
        pid: process.pid,
      })
    );
  });

  it('does not overwrite the focused instance metadata when the window is not focused', () => {
    fs.writeFileSync(
      FOCUSED_INSTANCE_TEMP_FILE,
      JSON.stringify({ instance_id: 'existing-instance', file: '/workspace/docs/existing.md' }),
      'utf8'
    );
    (vscode.window as typeof vscode.window & { state: { focused: boolean } }).state.focused = false;
    setActiveWebviewPanel(
      {} as never,
      {
        uri: { fsPath: '/workspace/docs/unfocused-window.md' },
        fileName: '/workspace/docs/unfocused-window.md',
      } as never
    );

    updateFocusedInstanceMetadataForCurrentWindow();

    expect(JSON.parse(fs.readFileSync(FOCUSED_INSTANCE_TEMP_FILE, 'utf8'))).toEqual({
      instance_id: 'existing-instance',
      file: '/workspace/docs/existing.md',
    });
  });
});
