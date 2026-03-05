/**
 * Copyright (c) 2025-2026 Concret.io
 *
 * Licensed under the MIT License. See LICENSE file in the project root for details.
 */

export interface ColorSettings {
  h1: string;
  h2: string;
  h3: string;
  h4: string;
  h5: string;
  h6: string;
  bold: string;
  italic: string;
  boldItalic: string;
  labelOpacity: number;
}

export const DEFAULT_COLORS: ColorSettings = {
  h1: '#1560c1',
  h2: '#1560c1',
  h3: '#1560c1',
  h4: '#1560c1',
  h5: '#1560c1',
  h6: '#1560c1',
  bold: '#bc0101',
  italic: '#248a57',
  boldItalic: '#ff7300',
  labelOpacity: 0.10,
};

const COLOR_ROWS: Array<{ key: keyof ColorSettings; label: string }> = [
  { key: 'h1', label: 'Heading 1' },
  { key: 'h2', label: 'Heading 2' },
  { key: 'h3', label: 'Heading 3' },
  { key: 'h4', label: 'Heading 4' },
  { key: 'h5', label: 'Heading 5' },
  { key: 'h6', label: 'Heading 6' },
  { key: 'bold', label: 'Bold' },
  { key: 'italic', label: 'Italic' },
  { key: 'boldItalic', label: 'Bold Italic' },
];

let panelElement: HTMLElement | null = null;

function saveColorSetting(key: string, value: string) {
  const vscodeApi = (window as any).vscode;
  if (vscodeApi) {
    vscodeApi.postMessage({
      type: 'updateSetting',
      key: `markdownForHumans.colors.${key}`,
      value,
    });
  }
}

export function applyColors(colors: Partial<ColorSettings>) {
  const merged = { ...DEFAULT_COLORS, ...colors };
  let styleEl = document.getElementById('md4h-color-styles');
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'md4h-color-styles';
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = `
    .markdown-editor h1 { color: ${merged.h1}; }
    .markdown-editor h2 { color: ${merged.h2}; }
    .markdown-editor h3 { color: ${merged.h3}; }
    .markdown-editor h4 { color: ${merged.h4}; }
    .markdown-editor h5 { color: ${merged.h5}; }
    .markdown-editor h6 { color: ${merged.h6}; }
    .markdown-editor strong:not(em strong):not(strong em) { color: ${merged.bold}; }
    .markdown-editor em:not(strong em):not(em strong) { color: ${merged.italic}; }
    .markdown-editor strong em,
    .markdown-editor em strong { color: ${merged.boldItalic}; }
    .markdown-editor { --md4h-label-opacity: ${merged.labelOpacity}; }
  `;
}

export function showColorSettingsPanel() {
  if (panelElement) {
    panelElement.style.display = panelElement.style.display === 'none' ? 'block' : 'none';
    return;
  }

  const currentColors: ColorSettings = {
    ...DEFAULT_COLORS,
    ...(window as any).md4hColors,
  };

  const panel = document.createElement('div');
  panel.className = 'color-settings-panel';
  panel.id = 'md4h-color-settings-panel';

  const header = document.createElement('div');
  header.className = 'color-settings-header';

  const title = document.createElement('span');
  title.className = 'color-settings-title';
  title.textContent = 'Text Colors';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'color-settings-close';
  closeBtn.type = 'button';
  closeBtn.title = 'Close';
  closeBtn.setAttribute('aria-label', 'Close color settings');
  closeBtn.innerHTML = '&#xeab8;'; // codicon close
  closeBtn.classList.add('codicon');
  closeBtn.onclick = () => {
    panel.style.display = 'none';
  };

  header.append(title, closeBtn);
  panel.appendChild(header);

  const rowsContainer = document.createElement('div');
  rowsContainer.className = 'color-settings-rows';

  // Track input elements for "apply to all headings" logic
  const headingColorInputs: HTMLInputElement[] = [];
  const headingHexInputs: HTMLInputElement[] = [];

  COLOR_ROWS.forEach(({ key, label }) => {
    const row = document.createElement('div');
    row.className = 'color-settings-row';

    const labelEl = document.createElement('span');
    labelEl.className = 'color-settings-label';
    labelEl.textContent = label;

    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.className = 'color-settings-swatch';
    colorInput.value = currentColors[key];
    colorInput.title = `Pick color for ${label}`;

    const hexInput = document.createElement('input');
    hexInput.type = 'text';
    hexInput.className = 'color-settings-hex';
    hexInput.value = currentColors[key];
    hexInput.maxLength = 7;
    hexInput.placeholder = '#000000';
    hexInput.spellcheck = false;

    // Keep swatch and hex in sync
    colorInput.addEventListener('input', () => {
      hexInput.value = colorInput.value;
      currentColors[key] = colorInput.value;
      applyColors(currentColors);
      saveColorSetting(key, colorInput.value);
    });

    hexInput.addEventListener('change', () => {
      const val = hexInput.value.trim();
      if (/^#[0-9a-fA-F]{6}$/.test(val)) {
        colorInput.value = val;
        currentColors[key] = val;
        applyColors(currentColors);
        saveColorSetting(key, val);
      } else {
        hexInput.value = colorInput.value;
      }
    });

    const controls = document.createElement('div');
    controls.className = 'color-settings-controls';
    controls.append(colorInput, hexInput);

    const isHeading = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(key);
    if (isHeading) {
      const applyAllBtn = document.createElement('button');
      applyAllBtn.type = 'button';
      applyAllBtn.className = 'color-settings-apply-all';
      applyAllBtn.title = 'Apply this color to all headings (H1–H6)';
      applyAllBtn.textContent = 'All H';
      applyAllBtn.onclick = () => {
        const color = colorInput.value;
        headingColorInputs.forEach(inp => {
          inp.value = color;
          inp.dispatchEvent(new Event('input'));
        });
      };
      controls.appendChild(applyAllBtn);
    } else {
      const spacer = document.createElement('span');
      spacer.className = 'color-settings-apply-all-spacer';
      controls.appendChild(spacer);
    }

    row.append(labelEl, controls);
    rowsContainer.appendChild(row);

    if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(key)) {
      headingColorInputs.push(colorInput);
      headingHexInputs.push(hexInput);
    }
  });

  // Label Opacity slider row
  const opacityRow = document.createElement('div');
  opacityRow.className = 'color-settings-row color-settings-opacity-row';

  const opacityLabel = document.createElement('span');
  opacityLabel.className = 'color-settings-label';
  opacityLabel.textContent = 'Label Opacity';

  const opacitySlider = document.createElement('input');
  opacitySlider.type = 'range';
  opacitySlider.className = 'color-settings-opacity-slider';
  opacitySlider.min = '0';
  opacitySlider.max = '1';
  opacitySlider.step = '0.01';
  opacitySlider.value = String(currentColors.labelOpacity);
  opacitySlider.title = 'Adjust gutter label opacity';

  const opacityValue = document.createElement('span');
  opacityValue.className = 'color-settings-opacity-value';
  opacityValue.textContent = Math.round(currentColors.labelOpacity * 100) + '%';

  opacitySlider.addEventListener('input', () => {
    const val = parseFloat(opacitySlider.value);
    opacityValue.textContent = Math.round(val * 100) + '%';
    currentColors.labelOpacity = val;
    applyColors(currentColors);
    saveColorSetting('labelOpacity', String(val));
  });

  const opacityControls = document.createElement('div');
  opacityControls.className = 'color-settings-controls';
  opacityControls.append(opacitySlider, opacityValue);

  opacityRow.append(opacityLabel, opacityControls);
  rowsContainer.appendChild(opacityRow);

  panel.appendChild(rowsContainer);
  document.body.appendChild(panel);
  panelElement = panel;
}

export function updateColorSettingsPanel(colors: Partial<ColorSettings>) {
  // Update the live inputs if the panel is open
  const panel = document.getElementById('md4h-color-settings-panel');
  if (!panel) return;

  const merged = { ...DEFAULT_COLORS, ...colors };

  COLOR_ROWS.forEach(({ key }, index) => {
    const rows = panel.querySelectorAll<HTMLElement>('.color-settings-row');
    const row = rows[index];
    if (!row) return;
    const colorInput = row.querySelector<HTMLInputElement>('input[type="color"]');
    const hexInput = row.querySelector<HTMLInputElement>('input[type="text"]');
    if (colorInput) colorInput.value = merged[key];
    if (hexInput) hexInput.value = merged[key];
  });

  const slider = panel.querySelector<HTMLInputElement>('.color-settings-opacity-slider');
  const valueEl = panel.querySelector<HTMLSpanElement>('.color-settings-opacity-value');
  if (slider) slider.value = String(merged.labelOpacity);
  if (valueEl) valueEl.textContent = Math.round(merged.labelOpacity * 100) + '%';
}
