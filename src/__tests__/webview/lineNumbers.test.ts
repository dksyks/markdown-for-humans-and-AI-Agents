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

import { repositionGutterDecorations } from '../../webview/extensions/lineNumbers';

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
});
