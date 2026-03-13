/**
 * MCP server for Markdown for Humans VS Code extension.
 * Exposes the current editor selection to Claude Code and other MCP clients.
 * Also supports proposing text replacements via the propose_selection_replacement tool.
 */

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SELECTION_TEMP_FILE = path.join(os.tmpdir(), 'MarkdownForHumans-Selection.json');
const PROPOSAL_TEMP_FILE = path.join(os.tmpdir(), 'MarkdownForHumans-Proposal.json');
const RESPONSE_TEMP_FILE = path.join(os.tmpdir(), 'MarkdownForHumans-Response.json');
const TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

const server = new McpServer({
  name: 'markdown-for-humans',
  version: '1.0.0',
});

server.tool(
  'get_markdown_selection',
  'Get the currently selected text in the Markdown for Humans editor, along with surrounding context and preceding headings. Call this when the user refers to selected text, "this", "here", or similar references that suggest they have something highlighted in the editor.',
  {},
  async () => {
    try {
      if (!fs.existsSync(SELECTION_TEMP_FILE)) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ selected: null, error: 'No selection data available. Open a markdown file in the Markdown for Humans editor first.' }) }],
        };
      }
      const raw = fs.readFileSync(SELECTION_TEMP_FILE, 'utf8');
      // Normalize non-breaking spaces (\u00a0) to regular spaces so that
      // the returned text can be used as an exact match against the file.
      const data = raw.replace(/\u00a0/g, ' ');
      return {
        content: [{ type: 'text', text: data }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ selected: null, error: String(err) }) }],
      };
    }
  }
);

server.tool(
  'propose_selection_replacement',
  `Show the user a proposed replacement for selected text in the Markdown for Humans editor.
Opens a popup panel beside the editor showing the original and proposed text as WYSIWYG.
The user can Accept, Edit (modify the replacement inline), or Cancel.
The main editor scrolls to and highlights the original text when the popup opens.
Returns { status, replacement } where status is "accept", "edit", "cancelled", or "timeout".
On status "accept" or "edit": apply the returned replacement to the file, replacing the original text.
Use context_before and context_after to locate the correct occurrence if the text appears multiple times.`,
  {
    original: z.string().describe('The exact original text to replace (as returned by get_markdown_selection selected field)'),
    replacement: z.string().describe('The proposed replacement markdown text'),
    context_before: z.string().optional().describe('Text immediately before the selection (context_before from get_markdown_selection)'),
    context_after: z.string().optional().describe('Text immediately after the selection (context_after from get_markdown_selection)'),
  },
  async ({ original, replacement, context_before, context_after }) => {
    try {
      const id = Date.now().toString();
      // Clear any stale response
      if (fs.existsSync(RESPONSE_TEMP_FILE)) {
        try { fs.unlinkSync(RESPONSE_TEMP_FILE); } catch {}
      }
      // Write proposal for extension to pick up
      fs.writeFileSync(
        PROPOSAL_TEMP_FILE,
        JSON.stringify({
          id,
          original,
          replacement,
          context_before: context_before ?? null,
          context_after: context_after ?? null,
        }),
        'utf8'
      );

      const result = await waitForResponse(id, TIMEOUT_MS);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    } catch (err) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ status: 'error', error: String(err) }) }],
      };
    }
  }
);

/**
 * Wait for the extension to write a response to RESPONSE_TEMP_FILE with matching id.
 * Uses fs.watch with a polling fallback. Resolves on response or timeout.
 */
function waitForResponse(id, timeoutMs) {
  return new Promise((resolve) => {
    let watcher;
    let resolved = false;

    const finish = (value) => {
      if (resolved) return;
      resolved = true;
      try { watcher?.close(); } catch {}
      resolve(value);
    };

    const deadline = setTimeout(() => {
      finish({ status: 'timeout', replacement: null });
    }, timeoutMs);

    const check = () => {
      try {
        if (!fs.existsSync(RESPONSE_TEMP_FILE)) return;
        const data = JSON.parse(fs.readFileSync(RESPONSE_TEMP_FILE, 'utf8'));
        if (data.id !== id) return;
        clearTimeout(deadline);
        finish(data);
      } catch {}
    };

    try {
      watcher = fs.watch(path.dirname(RESPONSE_TEMP_FILE), (_event, filename) => {
        if (filename && filename.includes('Response')) check();
      });
    } catch {
      // Fallback to polling if fs.watch is unavailable
      const iv = setInterval(() => {
        if (resolved) { clearInterval(iv); return; }
        check();
      }, 1000);
    }

    check(); // Check immediately in case file already exists
  });
}

const transport = new StdioServerTransport();
server.connect(transport).catch(err => {
  console.error('[MD4H MCP] Failed to start:', err);
  process.exit(1);
});
