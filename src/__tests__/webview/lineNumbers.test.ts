/**
 * @jest-environment jsdom
 */

jest.mock('../../webview/BubbleMenuView', () => ({
  editorDisplaySettings: {
    showHeadingGutter: true,
    showLineNumbers: true,
  },
}));

jest.mock('../../webview/utils/markdownSerialization', () => ({
  getEditorMarkdownForSync: jest.fn(() => ''),
}));

import { getEditorMarkdownForSync } from '../../webview/utils/markdownSerialization';
import { posToMarkdownLine, repositionGutterDecorations } from '../../webview/extensions/lineNumbers';

describe('repositionGutterDecorations', () => {
  const originalCreateRange = document.createRange.bind(document);

  afterEach(() => {
    document.body.innerHTML = '';
    document.createRange = originalCreateRange;
  });

  it('positions a separate gutter label for each github alert line split by a hard break', () => {
    document.createRange = jest.fn(() => ({
      setStart: jest.fn(),
      setEnd: jest.fn(),
      collapse: jest.fn(),
      getClientRects: jest.fn(() => []),
      getBoundingClientRect: jest.fn(() => ({ top: Number.NaN })),
    })) as unknown as typeof document.createRange;

    const wrapper = document.createElement('div');
    wrapper.className = 'line-number-table-anchor';
    Object.defineProperty(wrapper, 'nextElementSibling', {
      configurable: true,
      get: () => alert,
    });
    wrapper.getBoundingClientRect = jest.fn(() => ({
      top: 10,
      left: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
      x: 0,
      y: 10,
      toJSON: () => ({}),
    }));

    const spans = Array.from({ length: 3 }, () => {
      const span = document.createElement('span');
      span.className = 'line-number-gutter';
      wrapper.appendChild(span);
      return span;
    });

    const alert = document.createElement('blockquote');
    alert.className = 'github-alert';

    const header = document.createElement('div');
    header.className = 'github-alert-header';
    header.getBoundingClientRect = jest.fn(() => ({
      top: 20,
      left: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
      x: 0,
      y: 20,
      toJSON: () => ({}),
    }));

    const content = document.createElement('div');
    content.className = 'github-alert-content';

    const paragraph = document.createElement('p');
    paragraph.appendChild(document.createTextNode('first line'));
    paragraph.appendChild(document.createElement('br'));
    paragraph.appendChild(document.createTextNode('second line'));
    paragraph.getBoundingClientRect = jest.fn(() => ({
      top: 40,
      left: 0,
      right: 0,
      bottom: 80,
      width: 0,
      height: 40,
      x: 0,
      y: 40,
      toJSON: () => ({}),
    }));

    content.appendChild(paragraph);
    alert.appendChild(header);
    alert.appendChild(content);

    document.body.appendChild(wrapper);
    document.body.appendChild(alert);

    repositionGutterDecorations();

    expect(spans[0].style.top).toBe('10px');
    expect(spans[1].style.top).toBe('30px');
    expect(spans[2].style.top).toBe('50px');
    expect(spans[2].style.visibility).toBe('');
  });

  it('positions a separate gutter label for each github alert line split by newline text', () => {
    const originalCreateRange = document.createRange;
    document.createRange = jest.fn(() => {
      let rangeNode: Node | null = null;
      let rangeOffset = 0;
      return {
        setStart: jest.fn((node: Node, offset: number) => {
          rangeNode = node;
          rangeOffset = offset;
        }),
        setEnd: jest.fn(),
        collapse: jest.fn(),
        getClientRects: jest.fn(() => []),
        getBoundingClientRect: jest.fn(() => {
          if (rangeNode?.nodeType === Node.TEXT_NODE && rangeOffset === 11) {
            return { top: 60 };
          }
          return { top: Number.NaN };
        }),
      };
    }) as unknown as typeof document.createRange;

    const wrapper = document.createElement('div');
    wrapper.className = 'line-number-table-anchor';
    Object.defineProperty(wrapper, 'nextElementSibling', {
      configurable: true,
      get: () => alert,
    });
    wrapper.getBoundingClientRect = jest.fn(() => ({
      top: 10,
      left: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
      x: 0,
      y: 10,
      toJSON: () => ({}),
    }));

    const spans = Array.from({ length: 3 }, () => {
      const span = document.createElement('span');
      span.className = 'line-number-gutter';
      wrapper.appendChild(span);
      return span;
    });

    const alert = document.createElement('blockquote');
    alert.className = 'github-alert';

    const header = document.createElement('div');
    header.className = 'github-alert-header';
    header.getBoundingClientRect = jest.fn(() => ({
      top: 20,
      left: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
      x: 0,
      y: 20,
      toJSON: () => ({}),
    }));

    const content = document.createElement('div');
    content.className = 'github-alert-content';

    const paragraph = document.createElement('p');
    paragraph.appendChild(document.createTextNode('first line\nsecond line'));
    paragraph.getBoundingClientRect = jest.fn(() => ({
      top: 40,
      left: 0,
      right: 0,
      bottom: 80,
      width: 0,
      height: 40,
      x: 0,
      y: 40,
      toJSON: () => ({}),
    }));

    content.appendChild(paragraph);
    alert.appendChild(header);
    alert.appendChild(content);

    document.body.appendChild(wrapper);
    document.body.appendChild(alert);

    repositionGutterDecorations();

    expect(spans[0].style.top).toBe('10px');
    expect(spans[1].style.top).toBe('30px');
    expect(spans[2].style.top).toBe('50px');

    document.createRange = originalCreateRange;
  });

  it('extends list anchors to the full list height so later gutter labels remain clickable', () => {
    const wrapper = document.createElement('div');
    wrapper.className = 'line-number-table-anchor';
    Object.defineProperty(wrapper, 'nextElementSibling', {
      configurable: true,
      get: () => list,
    });
    wrapper.getBoundingClientRect = jest.fn(() => ({
      top: 10,
      left: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
      x: 0,
      y: 10,
      toJSON: () => ({}),
    }));

    const spans = Array.from({ length: 3 }, () => {
      const span = document.createElement('span');
      span.className = 'line-number-gutter';
      wrapper.appendChild(span);
      return span;
    });

    const list = document.createElement('ul');
    list.getBoundingClientRect = jest.fn(() => ({
      top: 20,
      left: 0,
      right: 0,
      bottom: 100,
      width: 0,
      height: 80,
      x: 0,
      y: 20,
      toJSON: () => ({}),
    }));

    for (const top of [20, 40, 60]) {
      const item = document.createElement('li');
      item.getBoundingClientRect = jest.fn(() => ({
        top,
        left: 0,
        right: 0,
        bottom: top + 10,
        width: 0,
        height: 10,
        x: 0,
        y: top,
        toJSON: () => ({}),
      }));
      list.appendChild(item);
    }

    document.body.appendChild(wrapper);
    document.body.appendChild(list);

    repositionGutterDecorations();

    expect(spans[0].style.top).toBe('10px');
    expect(spans[1].style.top).toBe('30px');
    expect(spans[2].style.top).toBe('50px');
    expect(wrapper.style.height).toBe('80px');
    expect(wrapper.style.marginBottom).toBe('-80px');
  });
});

describe('posToMarkdownLine', () => {
  const getEditorMarkdownForSyncMock = getEditorMarkdownForSync as jest.MockedFunction<
    typeof getEditorMarkdownForSync
  >;

  afterEach(() => {
    getEditorMarkdownForSyncMock.mockReset();
  });

  it('maps positions inside later list items to that item markdown line', () => {
    getEditorMarkdownForSyncMock.mockReturnValue('- first\n- second\n- third');

    const listItems = [
      { nodeSize: 8 },
      { nodeSize: 9 },
      { nodeSize: 8 },
    ];
    const listNode = {
      type: { name: 'bulletList' },
      nodeSize: 29,
      forEach: (cb: (node: { nodeSize: number }, offset: number) => void) => {
        cb(listItems[0], 0);
        cb(listItems[1], 8);
        cb(listItems[2], 17);
      },
    };
    const doc = {
      forEach: (cb: (node: typeof listNode, offset: number) => void) => cb(listNode, 0),
    };
    const editor = {
      state: { doc },
    };

    expect(posToMarkdownLine(editor, 2)).toBe(1);
    expect(posToMarkdownLine(editor, 11)).toBe(2);
    expect(posToMarkdownLine(editor, 20)).toBe(3);
  });

  it('maps positions inside later table rows to that row markdown line', () => {
    getEditorMarkdownForSyncMock.mockReturnValue('| head |\n| --- |\n| first |\n| second |');

    const rows = [
      { nodeSize: 8 },
      { nodeSize: 9 },
      { nodeSize: 10 },
    ];
    const tableNode = {
      type: { name: 'table' },
      nodeSize: 31,
      forEach: (cb: (node: { nodeSize: number }, offset: number) => void) => {
        cb(rows[0], 0);
        cb(rows[1], 8);
        cb(rows[2], 17);
      },
    };
    const doc = {
      forEach: (cb: (node: typeof tableNode, offset: number) => void) => cb(tableNode, 0),
    };
    const editor = {
      state: { doc },
    };

    expect(posToMarkdownLine(editor, 2)).toBe(1);
    expect(posToMarkdownLine(editor, 11)).toBe(3);
    expect(posToMarkdownLine(editor, 21)).toBe(4);
  });

  it('maps positions inside github alert list items to distinct markdown lines', () => {
    getEditorMarkdownForSyncMock.mockReturnValue('> [!NOTE]\n> - first\n> - second\n> - third');

    const listItems = [
      { nodeSize: 8 },
      { nodeSize: 9 },
      { nodeSize: 8 },
    ];
    const listNode = {
      type: { name: 'bulletList' },
      nodeSize: 29,
      forEach: (cb: (node: { nodeSize: number }, offset: number) => void) => {
        cb(listItems[0], 0);
        cb(listItems[1], 8);
        cb(listItems[2], 17);
      },
    };
    const alertNode = {
      type: { name: 'githubAlert' },
      nodeSize: 33,
      forEach: (cb: (node: typeof listNode, offset: number) => void) => {
        cb(listNode, 0);
      },
    };
    const doc = {
      forEach: (cb: (node: typeof alertNode, offset: number) => void) => cb(alertNode, 0),
    };
    const editor = {
      state: { doc },
    };

    expect(posToMarkdownLine(editor, 3)).toBe(2);
    expect(posToMarkdownLine(editor, 11)).toBe(3);
    expect(posToMarkdownLine(editor, 20)).toBe(4);
  });
});
