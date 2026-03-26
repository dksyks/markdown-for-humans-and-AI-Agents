/**
 * @jest-environment jsdom
 */

jest.mock('../../webview/displaySettings', () => ({
  editorDisplaySettings: {
    showHeadingGutter: true,
    showDocumentLineNumbers: true,
    showNavigationLineNumbers: false,
  },
}));

jest.mock('../../webview/utils/markdownSerialization', () => ({
  getEditorMarkdownForSync: jest.fn(() => ''),
}));

import { getEditorMarkdownForSync } from '../../webview/utils/markdownSerialization';
import {
  markdownLineToPos,
  markdownLineToSelectionRange,
  posToMarkdownLine,
  repositionGutterDecorations,
} from '../../webview/extensions/lineNumbers';

function createNestedListEditor() {
  const innerListItems = [
    { nodeSize: 7 },
    { nodeSize: 7 },
  ];
  const innerListNode = {
    type: { name: 'bulletList' },
    nodeSize: 16,
    forEach: (cb: (node: { nodeSize: number }, offset: number) => void) => {
      cb(innerListItems[0], 0);
      cb(innerListItems[1], 7);
    },
  };

  const outerListItems = [
    { nodeSize: 8 },
    {
      nodeSize: 25,
      forEach: (cb: (node: { nodeSize: number; type?: { name: string } }, offset: number) => void) => {
        cb({ nodeSize: 7, type: { name: 'paragraph' } }, 0);
        cb(innerListNode, 7);
      },
    },
    { nodeSize: 8 },
  ];
  const outerListNode = {
    type: { name: 'bulletList' },
    nodeSize: 43,
    forEach: (cb: (node: typeof outerListItems[number], offset: number) => void) => {
      cb(outerListItems[0], 0);
      cb(outerListItems[1], 8);
      cb(outerListItems[2], 33);
    },
  };
  const doc = {
    forEach: (cb: (node: typeof outerListNode, offset: number) => void) => cb(outerListNode, 0),
  };

  return {
    state: { doc },
  };
}

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

  it('keeps list anchors layout-neutral while still positioning later gutter labels', () => {
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
    expect(wrapper.style.height).toBe('');
    expect(wrapper.style.marginBottom).toBe('');
  });

  it('positions nested list gutter labels against inner list items in source order', () => {
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

    const spans = Array.from({ length: 5 }, () => {
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
      bottom: 120,
      width: 0,
      height: 100,
      x: 0,
      y: 20,
      toJSON: () => ({}),
    }));

    const outerOne = document.createElement('li');
    outerOne.getBoundingClientRect = jest.fn(() => ({
      top: 20,
      left: 0,
      right: 0,
      bottom: 30,
      width: 0,
      height: 10,
      x: 0,
      y: 20,
      toJSON: () => ({}),
    }));

    const outerTwo = document.createElement('li');
    outerTwo.getBoundingClientRect = jest.fn(() => ({
      top: 40,
      left: 0,
      right: 0,
      bottom: 90,
      width: 0,
      height: 50,
      x: 0,
      y: 40,
      toJSON: () => ({}),
    }));

    const innerList = document.createElement('ul');
    const innerOne = document.createElement('li');
    innerOne.getBoundingClientRect = jest.fn(() => ({
      top: 60,
      left: 0,
      right: 0,
      bottom: 70,
      width: 0,
      height: 10,
      x: 0,
      y: 60,
      toJSON: () => ({}),
    }));
    const innerTwo = document.createElement('li');
    innerTwo.getBoundingClientRect = jest.fn(() => ({
      top: 80,
      left: 0,
      right: 0,
      bottom: 90,
      width: 0,
      height: 10,
      x: 0,
      y: 80,
      toJSON: () => ({}),
    }));
    innerList.appendChild(innerOne);
    innerList.appendChild(innerTwo);
    outerTwo.appendChild(innerList);

    const outerThree = document.createElement('li');
    outerThree.getBoundingClientRect = jest.fn(() => ({
      top: 100,
      left: 0,
      right: 0,
      bottom: 110,
      width: 0,
      height: 10,
      x: 0,
      y: 100,
      toJSON: () => ({}),
    }));

    list.appendChild(outerOne);
    list.appendChild(outerTwo);
    list.appendChild(outerThree);

    document.body.appendChild(wrapper);
    document.body.appendChild(list);

    repositionGutterDecorations();

    expect(spans[0].style.top).toBe('10px');
    expect(spans[1].style.top).toBe('30px');
    expect(spans[2].style.top).toBe('50px');
    expect(spans[3].style.top).toBe('70px');
    expect(spans[4].style.top).toBe('90px');
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

  it('maps positions inside nested list items to their own markdown lines', () => {
    getEditorMarkdownForSyncMock.mockReturnValue(
      '- first\n- second\n  - inner first\n  - inner second\n- third'
    );

    const editor = createNestedListEditor();

    expect(posToMarkdownLine(editor, 11)).toBe(2);
    expect(posToMarkdownLine(editor, 20)).toBe(3);
    expect(posToMarkdownLine(editor, 27)).toBe(4);
    expect(posToMarkdownLine(editor, 36)).toBe(5);
  });
});

describe('list line selection helpers', () => {
  const getEditorMarkdownForSyncMock = getEditorMarkdownForSync as jest.MockedFunction<
    typeof getEditorMarkdownForSync
  >;

  afterEach(() => {
    getEditorMarkdownForSyncMock.mockReset();
  });

  it('maps nested list marker lines to the nested list item positions', () => {
    getEditorMarkdownForSyncMock.mockReturnValue(
      '- first\n- second\n  - inner first\n  - inner second\n- third'
    );

    const editor = createNestedListEditor();

    expect(markdownLineToSelectionRange(editor, 2)).toEqual({
      from: 10,
      to: 16,
    });
    expect(markdownLineToPos(editor, 3)).toBe(19);
    expect(markdownLineToSelectionRange(editor, 3)).toEqual({
      from: 19,
      to: 24,
    });
    expect(markdownLineToPos(editor, 4)).toBe(26);
    expect(markdownLineToSelectionRange(editor, 4)).toEqual({
      from: 26,
      to: 31,
    });
  });
});
