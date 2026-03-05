/**
 * MCP server for Markdown for Humans VS Code extension.
 * Exposes the current editor selection to Claude Code and other MCP clients.
 */

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SELECTION_TEMP_FILE = path.join(os.tmpdir(), 'MarkdownForHumans-Selection.json');

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
      const data = fs.readFileSync(SELECTION_TEMP_FILE, 'utf8');
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

const transport = new StdioServerTransport();
server.connect(transport).catch(err => {
  console.error('[MD4H MCP] Failed to start:', err);
  process.exit(1);
});
