/** @jest-environment jsdom */

import { scrollToPos } from '../../webview/utils/scrollToHeading';

describe('scrollToPos', () => {
  const originalRequestAnimationFrame = window.requestAnimationFrame;
  const originalInnerHeight = window.innerHeight;

  beforeEach(() => {
    document.body.innerHTML = '';
    window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    }) as typeof requestAnimationFrame;
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: 768,
    });
  });

  afterAll(() => {
    window.requestAnimationFrame = originalRequestAnimationFrame;
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: originalInnerHeight,
    });
  });

  it('can center the target vertically without moving focus', () => {
    const toolbar = document.createElement('div');
    toolbar.className = 'formatting-toolbar';
    toolbar.getBoundingClientRect = jest.fn(() => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 100,
      bottom: 40,
      width: 100,
      height: 40,
      toJSON: () => ({}),
    })) as typeof toolbar.getBoundingClientRect;
    document.body.appendChild(toolbar);

    const target = document.createElement('div');
    target.getBoundingClientRect = jest.fn(() => ({
      x: 0,
      y: 500,
      left: 0,
      top: 500,
      right: 200,
      bottom: 520,
      width: 200,
      height: 20,
      toJSON: () => ({}),
    })) as typeof target.getBoundingClientRect;

    document.documentElement.scrollTop = 200;

    const editor = {
      commands: {
        setTextSelection: jest.fn(),
        focus: jest.fn(),
      },
      view: {
        domAtPos: jest.fn(() => ({
          node: target,
          offset: 0,
        })),
      },
    };

    scrollToPos(editor as any, 10, true, true);

    expect(editor.commands.setTextSelection).toHaveBeenCalledWith(10);
    expect(editor.commands.focus).not.toHaveBeenCalled();
    expect(document.documentElement.scrollTop).toBe(306);
  });
});
