/**
 * @jest-environment jsdom
 */

/**
 * Tests for BubbleMenuView toolbar and menu components
 */

import type { Editor } from '@tiptap/core';

// Mock the imports
jest.mock('../../webview/mermaidTemplates', () => ({
  MERMAID_TEMPLATES: [{ label: 'Flowchart', diagram: 'graph TD\nA-->B' }],
}));

jest.mock('../../webview/features/tableInsert', () => ({
  showTableInsertDialog: jest.fn(),
}));

jest.mock('../../webview/features/linkDialog', () => ({
  showLinkDialog: jest.fn(),
}));

jest.mock('../../webview/features/imageInsertDialog', () => ({
  showImageInsertDialog: jest.fn().mockResolvedValue(undefined),
}));

describe('BubbleMenuView', () => {
  let createFormattingToolbar: (editor: Editor) => HTMLElement;
  let createTableMenu: (editor: Editor) => HTMLElement;
  let openGotoLineInput: () => boolean;
  let updateToolbarStates: () => void;

  beforeEach(async () => {
    jest.resetModules();
    document.body.innerHTML = '';

    // Import after mocks are set up
    const module = await import('../../webview/BubbleMenuView');
    createFormattingToolbar = module.createFormattingToolbar;
    createTableMenu = module.createTableMenu;
    openGotoLineInput = module.openGotoLineInput;
    updateToolbarStates = module.updateToolbarStates;
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  const createMockEditor = () => {
    const chain = jest.fn(() => ({
      focus: jest.fn().mockReturnThis(),
      toggleBold: jest.fn().mockReturnThis(),
      toggleItalic: jest.fn().mockReturnThis(),
      toggleStrike: jest.fn().mockReturnThis(),
      toggleCode: jest.fn().mockReturnThis(),
      toggleHeading: jest.fn().mockReturnThis(),
      toggleBulletList: jest.fn().mockReturnThis(),
      toggleOrderedList: jest.fn().mockReturnThis(),
      toggleTaskList: jest.fn().mockReturnThis(),
      toggleBlockquote: jest.fn().mockReturnThis(),
      setCodeBlock: jest.fn().mockReturnThis(),
      insertTable: jest.fn().mockReturnThis(),
      insertContent: jest.fn().mockReturnThis(),
      addRowBefore: jest.fn().mockReturnThis(),
      addRowAfter: jest.fn().mockReturnThis(),
      deleteRow: jest.fn().mockReturnThis(),
      addColumnBefore: jest.fn().mockReturnThis(),
      addColumnAfter: jest.fn().mockReturnThis(),
      deleteColumn: jest.fn().mockReturnThis(),
      deleteTable: jest.fn().mockReturnThis(),
      run: jest.fn(),
    }));

    return {
      chain,
      commands: {
        focus: jest.fn(),
      },
      isActive: jest.fn().mockReturnValue(false),
      on: jest.fn(), // Event listener registration
      off: jest.fn(), // Event listener removal
      state: {
        selection: { from: 0, to: 0 },
        doc: { textBetween: jest.fn().mockReturnValue('') },
      },
      view: {
        dom: document.createElement('div'),
      },
    } as unknown as Editor;
  };

  describe('createFormattingToolbar', () => {
    it('creates a toolbar element with correct class', () => {
      const editor = createMockEditor();
      const toolbar = createFormattingToolbar(editor);

      expect(toolbar).toBeInstanceOf(HTMLElement);
      expect(toolbar.className).toBe('formatting-toolbar');
    });

    it('contains formatting buttons', () => {
      const editor = createMockEditor();
      const toolbar = createFormattingToolbar(editor);

      // Check for essential buttons
      const buttons = toolbar.querySelectorAll('button');
      expect(buttons.length).toBeGreaterThan(0);
    });

    it('registers selection update listener', () => {
      const editor = createMockEditor();
      createFormattingToolbar(editor);

      // Toolbar should register for selection updates
      expect(editor.on).toHaveBeenCalledWith('selectionUpdate', expect.any(Function));
    });

    it('shows informative labels and tooltips in the settings menu', () => {
      const editor = createMockEditor();
      const toolbar = createFormattingToolbar(editor);
      document.body.appendChild(toolbar);

      const settingsButton = toolbar.querySelector('button.settings-dropdown') as HTMLButtonElement;
      expect(settingsButton.title).toBe('Display and editor settings');

      const menuItems = Array.from(document.body.querySelectorAll('.toolbar-dropdown-item'));
      const headingLabelsItem = menuItems.find(
        item => item.getAttribute('title') === 'Show H1-H6 labels in the document gutter beside headings.'
      ) as HTMLButtonElement | undefined;
      const documentLineNumbersItem = menuItems.find(
        item =>
          item.getAttribute('title') ===
          'Show markdown source line numbers in the document gutter. Clicking a number selects that source line.'
      ) as HTMLButtonElement | undefined;
      const navigationLineNumbersItem = menuItems.find(
        item =>
          item.getAttribute('title') ===
          'Show source line numbers before headings in the Navigation pane and Explorer outline.'
      ) as HTMLButtonElement | undefined;
      const textColorsItem = menuItems.find(
        item =>
          item.getAttribute('title') ===
          'Adjust heading, bold, italic, and gutter-label colors used in the editor.'
      ) as HTMLButtonElement | undefined;
      const systemSettingsItem = menuItems.find(
        item => item.getAttribute('title') === 'Open the full Markdown for Humans settings in VS Code.'
      ) as HTMLButtonElement | undefined;

      expect(menuItems.some(item => item.textContent?.includes('Heading Labels'))).toBe(true);
      expect(menuItems.some(item => item.textContent?.includes('Document Line Numbers'))).toBe(true);
      expect(menuItems.some(item => item.textContent?.includes('Navigation Line Numbers'))).toBe(true);
      expect(headingLabelsItem?.title).toBe(
        'Show H1-H6 labels in the document gutter beside headings.'
      );
      expect(documentLineNumbersItem?.title).toBe(
        'Show markdown source line numbers in the document gutter. Clicking a number selects that source line.'
      );
      expect(navigationLineNumbersItem?.title).toBe(
        'Show source line numbers before headings in the Navigation pane and Explorer outline.'
      );
      expect(textColorsItem?.title).toBe(
        'Adjust heading, bold, italic, and gutter-label colors used in the editor.'
      );
      expect(systemSettingsItem?.title).toBe(
        'Open the full Markdown for Humans settings in VS Code.'
      );
    });

    it('repositions the settings dropdown to stay inside the right viewport edge', () => {
      const editor = createMockEditor();
      const toolbar = createFormattingToolbar(editor);
      document.body.appendChild(toolbar);

      const settingsButton = toolbar.querySelector('button.settings-dropdown') as HTMLButtonElement;
      const settingsMenuCandidate = Array.from(document.body.querySelectorAll('.toolbar-dropdown-menu')).find(menu =>
        menu.textContent?.includes('Text Colors')
      ) as HTMLDivElement | undefined;

      expect(settingsButton).toBeTruthy();
      expect(settingsMenuCandidate).toBeTruthy();
      const settingsMenu = settingsMenuCandidate as HTMLDivElement;

      Object.defineProperty(window, 'innerWidth', {
        configurable: true,
        value: 1000,
      });

      settingsButton.getBoundingClientRect = jest.fn(() => ({
        x: 930,
        y: 12,
        left: 930,
        top: 12,
        right: 954,
        bottom: 36,
        width: 24,
        height: 24,
        toJSON: () => ({}),
      })) as typeof settingsButton.getBoundingClientRect;

      settingsMenu.getBoundingClientRect = jest.fn(() => ({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 180,
        bottom: 220,
        width: 180,
        height: 220,
        toJSON: () => ({}),
      })) as typeof settingsMenu.getBoundingClientRect;

      settingsButton.click();

      expect(settingsMenu.style.display).toBe('block');
      expect(settingsMenu.style.left).toBe('812px');
      expect(settingsMenu.style.top).toBe('40px');
    });

    it('closes regular toolbar dropdowns when Escape is pressed', () => {
      const editor = createMockEditor();
      const toolbar = createFormattingToolbar(editor);
      document.body.appendChild(toolbar);

      const settingsButton = toolbar.querySelector('button.settings-dropdown') as HTMLButtonElement;
      const settingsMenuCandidate = Array.from(document.body.querySelectorAll('.toolbar-dropdown-menu')).find(menu =>
        menu.textContent?.includes('Text Colors')
      ) as HTMLDivElement | undefined;
      expect(settingsMenuCandidate).toBeTruthy();
      const settingsMenu = settingsMenuCandidate as HTMLDivElement;

      settingsButton.click();
      expect(settingsMenu.style.display).toBe('block');
      expect(settingsButton.getAttribute('aria-expanded')).toBe('true');
      settingsButton.focus();
      expect(document.activeElement).toBe(settingsButton);

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

      expect(settingsMenu.style.display).toBe('none');
      expect(settingsButton.getAttribute('aria-expanded')).toBe('false');
      expect(document.activeElement).not.toBe(settingsButton);
    });

    it('closes the heading widget dropdown when Escape is pressed', () => {
      const editor = createMockEditor();
      const toolbar = createFormattingToolbar(editor);
      document.body.appendChild(toolbar);
      window.dispatchEvent(new CustomEvent('editorFocusChange', { detail: { focused: true } }));

      const headingButton = toolbar.querySelector(
        '.toolbar-heading-widget button[aria-label="Heading level"]'
      ) as HTMLButtonElement;
      const headingMenuCandidate = Array.from(document.body.querySelectorAll('.toolbar-dropdown-menu')).find(menu =>
        menu.textContent?.includes('Paragraph (P)')
      ) as HTMLDivElement | undefined;
      expect(headingMenuCandidate).toBeTruthy();
      const headingMenu = headingMenuCandidate as HTMLDivElement;

      headingButton.click();
      expect(headingMenu.style.display).toBe('block');
      expect(headingButton.getAttribute('aria-expanded')).toBe('true');

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

      expect(headingMenu.style.display).toBe('none');
      expect(headingButton.getAttribute('aria-expanded')).toBe('false');
    });

    it('adds a persistent Goto Line input under the Go menu and keeps it open on Enter', () => {
      const editor = createMockEditor();
      const toolbar = createFormattingToolbar(editor);
      document.body.appendChild(toolbar);

      const goButton = toolbar.querySelector(
        'button[aria-label="Navigate insertion point history"]'
      ) as HTMLButtonElement;
      const gotoLineHandler = jest.fn();
      window.addEventListener('gotoLine', gotoLineHandler as EventListener);

      goButton.click();

      const goMenu = Array.from(document.body.querySelectorAll('.toolbar-dropdown-menu')).find(menu =>
        menu.textContent?.includes('Go Back')
      ) as HTMLDivElement | undefined;
      expect(goMenu).toBeTruthy();

      const separator = goMenu?.querySelector('.toolbar-dropdown-sep');
      const gotoInputRow = goMenu?.querySelector('.toolbar-dropdown-input-row') as HTMLDivElement | null;
      const gotoInput = goMenu?.querySelector('.toolbar-dropdown-input') as HTMLInputElement | null;
      const gotoLabel = goMenu?.querySelector('.toolbar-dropdown-input-label');

      expect(separator).toBeTruthy();
      expect(gotoLabel?.textContent).toBe('Goto Line');
      expect(gotoInputRow?.title).toBe('Go to markdown source line (Ctrl+Alt+G)');
      expect(gotoInput).toBeTruthy();

      gotoInput!.focus();
      gotoInput!.value = '42';
      gotoInput!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

      expect(goMenu?.style.display).toBe('block');
      expect(document.activeElement).toBe(gotoInput);
      expect(gotoLineHandler).toHaveBeenCalledTimes(1);
      let event = gotoLineHandler.mock.calls[0][0] as CustomEvent<{ lineNumber: number }>;
      expect(event.detail.lineNumber).toBe(42);

      gotoInput!.value = '200';
      gotoInput!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

      expect(goMenu?.style.display).toBe('block');
      expect(gotoLineHandler).toHaveBeenCalledTimes(2);
      event = gotoLineHandler.mock.calls[1][0] as CustomEvent<{ lineNumber: number }>;
      expect(event.detail.lineNumber).toBe(200);

      window.removeEventListener('gotoLine', gotoLineHandler as EventListener);
    });

    it('opens the Go menu and focuses the Goto Line input when requested programmatically', () => {
      const editor = createMockEditor();
      const toolbar = createFormattingToolbar(editor);
      document.body.appendChild(toolbar);

      expect(openGotoLineInput()).toBe(true);

      const goMenu = Array.from(document.body.querySelectorAll('.toolbar-dropdown-menu')).find(menu => {
        const input = menu.querySelector('.toolbar-dropdown-input') as HTMLInputElement | null;
        return input && (menu as HTMLDivElement).style.display === 'block';
      }) as HTMLDivElement | undefined;
      const gotoInput = goMenu?.querySelector('.toolbar-dropdown-input') as HTMLInputElement | null;

      expect(goMenu?.style.display).toBe('block');
      expect(document.activeElement).toBe(gotoInput);
    });
  });

  describe('createTableMenu', () => {
    it('creates a hidden menu element', () => {
      const editor = createMockEditor();
      const menu = createTableMenu(editor);

      expect(menu).toBeInstanceOf(HTMLElement);
      expect(menu.className).toBe('table-menu');
      expect(menu.style.display).toBe('none');
    });

    it('contains table operation items', () => {
      const editor = createMockEditor();
      const menu = createTableMenu(editor);

      const items = menu.querySelectorAll('.table-menu-item');
      expect(items.length).toBeGreaterThan(0);

      // Check for specific operations
      const addRowItem = Array.from(items).find(item => item.textContent?.includes('Add Row'));
      expect(addRowItem).toBeTruthy();
    });

    it('calls editor commands on item click', () => {
      const editor = createMockEditor();
      const menu = createTableMenu(editor);

      const items = menu.querySelectorAll('.table-menu-item');
      const firstItem = items[0] as HTMLElement;

      if (firstItem) {
        firstItem.click();
        expect(editor.chain).toHaveBeenCalled();
      }
    });

    it('hides menu after item click', () => {
      const editor = createMockEditor();
      const menu = createTableMenu(editor);

      menu.style.display = 'block';

      const items = menu.querySelectorAll('.table-menu-item');
      const firstItem = items[0] as HTMLElement;

      if (firstItem) {
        firstItem.click();
        expect(menu.style.display).toBe('none');
      }
    });
  });

  describe('updateToolbarStates', () => {
    it('can be called without error when no toolbar exists', () => {
      expect(() => updateToolbarStates()).not.toThrow();
    });
  });
});
