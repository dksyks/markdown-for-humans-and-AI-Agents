import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  getEditorHostInstanceId,
  registerWebviewPanel,
  resetActiveWebviewStateForTests,
} from '../../activeWebview';
import {
  processSelectionRevealRequest,
  readPendingSelectionRevealRequest,
  shouldHandleSelectionRevealRequest,
  type SelectionRevealRequest,
} from '../../features/selectionRevealWatcher';

describe('readPendingSelectionRevealRequest', () => {
  beforeEach(() => {
    resetActiveWebviewStateForTests();
  });

  it('returns the request and deletes the temp file after reading it', () => {
    const requestFilePath = path.join(
      os.tmpdir(),
      `md4h-selection-reveal-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
    );

    fs.writeFileSync(
      requestFilePath,
      JSON.stringify({
        id: 'reveal-1',
        original: '**Note:** Test',
        context_before: 'Before',
        context_after: 'After',
      }),
      'utf8'
    );

    const request = readPendingSelectionRevealRequest(requestFilePath);

    expect(request).toEqual({
      id: 'reveal-1',
      original: '**Note:** Test',
      context_before: 'Before',
      context_after: 'After',
    });
    expect(fs.existsSync(requestFilePath)).toBe(false);
  });
});

describe('shouldHandleSelectionRevealRequest', () => {
  beforeEach(() => {
    resetActiveWebviewStateForTests();
  });

  function registerDocument(filePath: string) {
    const panel = {
      webview: { postMessage: jest.fn() },
    } as const;
    const document = {
      uri: { fsPath: filePath },
    } as const;

    registerWebviewPanel(panel as never, document as never);
  }

  function buildRequest(overrides: Partial<SelectionRevealRequest> = {}): SelectionRevealRequest {
    return {
      id: 'reveal-1',
      file: '/workspace/docs/target.md',
      source_instance_id: getEditorHostInstanceId(),
      original: 'Old text',
      context_before: null,
      context_after: null,
      ...overrides,
    };
  }

  it('rejects requests for files that are not open in Markdown for Humans in this window', () => {
    registerDocument('/workspace/docs/other.md');

    expect(shouldHandleSelectionRevealRequest(buildRequest())).toBe(false);
  });

  it('rejects requests written by a different extension host instance', () => {
    registerDocument('/workspace/docs/target.md');

    expect(
      shouldHandleSelectionRevealRequest(
        buildRequest({
          source_instance_id: 'other-window',
        })
      )
    ).toBe(false);
  });

  it('accepts requests for the matching open file from this extension host instance', () => {
    registerDocument('/workspace/docs/target.md');

    expect(shouldHandleSelectionRevealRequest(buildRequest())).toBe(true);
  });
});

describe('processSelectionRevealRequest', () => {
  beforeEach(() => {
    resetActiveWebviewStateForTests();
  });

  it('posts a scroll-and-select message to the matching webview and writes a revealed response', () => {
    const responseFilePath = path.join(
      os.tmpdir(),
      `md4h-selection-reveal-response-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
    );
    const postMessage = jest.fn();
    const panel = {
      webview: { postMessage },
      reveal: jest.fn(),
    } as const;
    const document = {
      uri: { fsPath: '/workspace/docs/target.md' },
    } as const;

    registerWebviewPanel(panel as never, document as never);

    const handled = processSelectionRevealRequest(
      {
        id: 'reveal-2',
        file: '/workspace/docs/target.md',
        source_instance_id: getEditorHostInstanceId(),
        original: 'Selected text',
        context_before: 'Before',
        context_after: 'After',
      },
      responseFilePath
    );

    expect(handled).toBe(true);
    expect(panel.reveal).toHaveBeenCalled();
    expect(postMessage).toHaveBeenCalledWith({
      type: 'scrollAndSelect',
      original: 'Selected text',
      context_before: 'Before',
      context_after: 'After',
    });

    const response = JSON.parse(fs.readFileSync(responseFilePath, 'utf8'));
    expect(response).toEqual({
      id: 'reveal-2',
      status: 'revealed',
      file: '/workspace/docs/target.md',
    });
  });

  it('matches the correct open document by markdown content when no file is supplied', () => {
    const responseFilePath = path.join(
      os.tmpdir(),
      `md4h-selection-reveal-response-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
    );
    const alphaPanel = {
      webview: { postMessage: jest.fn() },
      reveal: jest.fn(),
    } as const;
    const betaPanel = {
      webview: { postMessage: jest.fn() },
      reveal: jest.fn(),
    } as const;
    const alphaDocument = {
      uri: { fsPath: '/workspace/docs/alpha.md' },
      getText: jest.fn(
        () => '# Intro\n\nAlpha content.\n\n## Different Heading\n\nSomething else.\n'
      ),
    } as const;
    const betaDocument = {
      uri: { fsPath: '/workspace/docs/CODE_OF_CONDUCT.md' },
      getText: jest.fn(
        () =>
          '# Code of Conduct\n\n- Other conduct which could reasonably be considered inappropriate in a professional setting\n\n## Our Responsibilities\n\nProject maintainers are responsible for clarifying and enforcing our standards of acceptable behavior and will take appropriate and fair corrective action in response to any behavior that they deem inappropriate, threatening, offensive, or harmful.\n'
      ),
    } as const;

    registerWebviewPanel(alphaPanel as never, alphaDocument as never);
    registerWebviewPanel(betaPanel as never, betaDocument as never);

    const handled = processSelectionRevealRequest(
      {
        id: 'reveal-3',
        original: '## Our Responsibilities',
        context_before:
          '- Other conduct which could reasonably be considered inappropriate in a professional setting\n\n',
        context_after:
          '\n\nProject maintainers are responsible for clarifying and enforcing our standards of acceptable behavior and will take appropriate and fair corrective action in response to any behavior that they deem inappropriate, threatening, offensive, or harmful.\n',
      },
      responseFilePath
    );

    expect(handled).toBe(true);
    expect(alphaPanel.webview.postMessage).not.toHaveBeenCalled();
    expect(betaPanel.reveal).toHaveBeenCalled();
    expect(betaPanel.webview.postMessage).toHaveBeenCalledWith({
      type: 'scrollAndSelect',
      original: '## Our Responsibilities',
      context_before:
        '- Other conduct which could reasonably be considered inappropriate in a professional setting\n\n',
      context_after:
        '\n\nProject maintainers are responsible for clarifying and enforcing our standards of acceptable behavior and will take appropriate and fair corrective action in response to any behavior that they deem inappropriate, threatening, offensive, or harmful.\n',
    });

    const response = JSON.parse(fs.readFileSync(responseFilePath, 'utf8'));
    expect(response).toEqual({
      id: 'reveal-3',
      status: 'revealed',
      file: '/workspace/docs/CODE_OF_CONDUCT.md',
    });
  });
});
