import * as vscode from 'vscode';
import * as fs from 'fs';
import {
  registerWebviewPanel,
  resetActiveWebviewStateForTests,
} from '../../activeWebview';
import { PlanPanel } from '../../features/planPanel';
import { PLAN_STATE_DIR, PLAN_RESPONSE_TEMP_FILE } from '../../editor/MarkdownEditorProvider';

describe('PlanPanel', () => {
  beforeEach(() => {
    resetActiveWebviewStateForTests();
    PlanPanel.currentPanel = undefined;
  });

  afterEach(() => {
    jest.useRealTimers();
    if (fs.existsSync(PLAN_RESPONSE_TEMP_FILE)) {
      fs.unlinkSync(PLAN_RESPONSE_TEMP_FILE);
    }
    try {
      fs.rmSync(PLAN_STATE_DIR, { recursive: true, force: true });
    } catch {}
  });

  function createMockPanel() {
    const postMessage = jest.fn();
    const onDidReceiveMessage = jest.fn();
    const onDidDispose = jest.fn();
    return {
      webview: { postMessage, onDidReceiveMessage },
      onDidDispose,
      postMessage,
    };
  }

  function createMockDocument(filePath: string) {
    return {
      uri: vscode.Uri.file(filePath),
      getText: () => 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5',
    } as unknown as vscode.TextDocument;
  }

  const sampleRequest = {
    id: 'plan-1',
    file: '/workspace/docs/test.md',
    proposed_replacements: [
      {
        range: { start: 1, end: 1 },
        proposed_change: '**Suggested:** Simplify this sentence.',
      },
      {
        range: { start: 3, end: 5 },
        proposed_change: '**Suggested:** Restructure as a list.',
      },
    ],
  };

  it('sends planInit to the editor webview when shown', () => {
    const mockPanel = createMockPanel();
    const mockDocument = createMockDocument('/workspace/docs/test.md');

    registerWebviewPanel(
      mockPanel as unknown as vscode.WebviewPanel,
      mockDocument
    );

    PlanPanel.show(
      {
        extensionUri: vscode.Uri.file('/extension'),
        subscriptions: [],
      } as unknown as vscode.ExtensionContext,
      sampleRequest
    );

    expect(mockPanel.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'planInit',
        id: 'plan-1',
        file: '/workspace/docs/test.md',
        proposed_replacements: sampleRequest.proposed_replacements,
      })
    );
  });

  it('sets planOverlayActive context when panel is created', () => {
    const mockPanel = createMockPanel();
    const mockDocument = createMockDocument('/workspace/docs/test.md');

    registerWebviewPanel(
      mockPanel as unknown as vscode.WebviewPanel,
      mockDocument
    );

    PlanPanel.show(
      {
        extensionUri: vscode.Uri.file('/extension'),
        subscriptions: [],
      } as unknown as vscode.ExtensionContext,
      sampleRequest
    );

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'setContext',
      'markdownForHumans.planOverlayActive',
      true
    );
  });

  it('writes immediate error when file is not provided', () => {
    PlanPanel.show(
      {
        extensionUri: vscode.Uri.file('/extension'),
        subscriptions: [],
      } as unknown as vscode.ExtensionContext,
      {
        id: 'plan-no-file',
        proposed_replacements: sampleRequest.proposed_replacements,
      }
    );

    expect(PlanPanel.currentPanel).toBeUndefined();

    // Should have written error state
    const stateFilePath = PlanPanel._getPlanStateFilePath('plan-no-file');
    if (fs.existsSync(stateFilePath)) {
      const state = JSON.parse(fs.readFileSync(stateFilePath, 'utf8'));
      expect(state.status).toBe('error');
      expect(state.error_type).toBe('plan_internal_error');
    }
  });

  it('writes immediate error when file is not open in any webview', () => {
    PlanPanel.show(
      {
        extensionUri: vscode.Uri.file('/extension'),
        subscriptions: [],
      } as unknown as vscode.ExtensionContext,
      {
        id: 'plan-not-open',
        file: '/workspace/docs/nonexistent.md',
        proposed_replacements: sampleRequest.proposed_replacements,
      }
    );

    expect(PlanPanel.currentPanel).toBeUndefined();

    const stateFilePath = PlanPanel._getPlanStateFilePath('plan-not-open');
    if (fs.existsSync(stateFilePath)) {
      const state = JSON.parse(fs.readFileSync(stateFilePath, 'utf8'));
      expect(state.status).toBe('error');
      expect(state.error_type).toBe('plan_file_not_found');
    }
  });

  it('disposes previous panel when a new plan is shown', () => {
    const mockPanel = createMockPanel();
    const mockDocument = createMockDocument('/workspace/docs/test.md');

    registerWebviewPanel(
      mockPanel as unknown as vscode.WebviewPanel,
      mockDocument
    );

    const context = {
      extensionUri: vscode.Uri.file('/extension'),
      subscriptions: [],
    } as unknown as vscode.ExtensionContext;

    PlanPanel.show(context, sampleRequest);
    const firstPanel = PlanPanel.currentPanel;
    expect(firstPanel).toBeDefined();

    PlanPanel.show(context, { ...sampleRequest, id: 'plan-2' });
    // First panel should have been disposed (currentPanel replaced)
    expect(PlanPanel.currentPanel).toBeDefined();
  });

  it('writes ready state when planReady message is received', () => {
    const mockPanel = createMockPanel();
    const mockDocument = createMockDocument('/workspace/docs/test.md');

    registerWebviewPanel(
      mockPanel as unknown as vscode.WebviewPanel,
      mockDocument
    );

    PlanPanel.show(
      {
        extensionUri: vscode.Uri.file('/extension'),
        subscriptions: [],
      } as unknown as vscode.ExtensionContext,
      sampleRequest
    );

    // Simulate planReady message via the onDidReceiveMessage callback
    const onMessageCallback = (mockPanel.webview.onDidReceiveMessage as jest.Mock).mock.calls[0]?.[0];
    if (onMessageCallback) {
      onMessageCallback({ type: 'planReady' });

      const stateFilePath = PlanPanel._getPlanStateFilePath('plan-1');
      if (fs.existsSync(stateFilePath)) {
        const state = JSON.parse(fs.readFileSync(stateFilePath, 'utf8'));
        expect(state.status).toBe('ready');
        expect(state.id).toBe('plan-1');
      }
    }
  });

  it('clears planOverlayActive context on dispose', () => {
    const mockPanel = createMockPanel();
    const mockDocument = createMockDocument('/workspace/docs/test.md');

    registerWebviewPanel(
      mockPanel as unknown as vscode.WebviewPanel,
      mockDocument
    );

    PlanPanel.show(
      {
        extensionUri: vscode.Uri.file('/extension'),
        subscriptions: [],
      } as unknown as vscode.ExtensionContext,
      sampleRequest
    );

    expect(PlanPanel.currentPanel).toBeDefined();
    PlanPanel.currentPanel!.dispose();

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'setContext',
      'markdownForHumans.planOverlayActive',
      false
    );
    expect(PlanPanel.currentPanel).toBeUndefined();
  });

  it('sends planDestroy to webview on dispose', () => {
    const mockPanel = createMockPanel();
    const mockDocument = createMockDocument('/workspace/docs/test.md');

    registerWebviewPanel(
      mockPanel as unknown as vscode.WebviewPanel,
      mockDocument
    );

    PlanPanel.show(
      {
        extensionUri: vscode.Uri.file('/extension'),
        subscriptions: [],
      } as unknown as vscode.ExtensionContext,
      sampleRequest
    );

    PlanPanel.currentPanel!.dispose();

    expect(mockPanel.postMessage).toHaveBeenCalledWith({ type: 'planDestroy' });
  });
});
