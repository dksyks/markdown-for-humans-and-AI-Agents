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
const PROPOSAL_STATE_DIR = path.join(os.tmpdir(), 'MarkdownForHumans-ProposalState');
const SELECTION_REVEAL_TEMP_FILE = path.join(os.tmpdir(), 'MarkdownForHumans-SelectionReveal.json');
const SELECTION_REVEAL_RESPONSE_TEMP_FILE = path.join(
  os.tmpdir(),
  'MarkdownForHumans-SelectionRevealResponse.json'
);
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
Returns { status, replacement } where status is "accept", "edit", "cancelled", "pending", or "timeout".
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
      const selectionMetadata = readSelectionMetadata();
      const routingMetadata = proposalMatchesSelection(selectionMetadata, {
        original,
        context_before: context_before ?? null,
        context_after: context_after ?? null,
      })
        ? {
            file: selectionMetadata.file ?? null,
            source_instance_id: selectionMetadata.instance_id ?? null,
          }
        : {};
      clearFileIfExists(RESPONSE_TEMP_FILE);
      // Write proposal for extension to pick up
      fs.writeFileSync(
        PROPOSAL_TEMP_FILE,
        JSON.stringify({
          id,
          ...routingMetadata,
          original,
          replacement,
          context_before: context_before ?? null,
          context_after: context_after ?? null,
        }),
        'utf8'
      );

      const result = await waitForResponse(id, TIMEOUT_MS, {
        responseFilePath: RESPONSE_TEMP_FILE,
        timeoutResult: {
          id,
          status: 'timeout',
          replacement: null,
        },
      });
      const finalResult = await applyServerFallbackIfNeeded(result, {
        original,
        replacement,
        context_before: context_before ?? null,
        context_after: context_after ?? null,
      });
      return { content: [{ type: 'text', text: JSON.stringify(finalResult) }] };
    } catch (err) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ status: 'error', error: String(err) }) }],
      };
    }
  }
);

server.tool(
  'resume_proposal_review',
  `Resume a pending single proposed change review in the Markdown for Humans editor.
Use this after propose_selection_replacement returned status "pending" and the user later says they are done editing.
Returns the final review result when available, or "pending" again if the review is still open.`,
  {
    review_id: z.string().describe('The review_id returned by propose_selection_replacement when status was pending'),
  },
  async ({ review_id }) => {
    try {
      const result = await waitForProposalState(review_id, {
        pendingResult: {
          id: review_id,
          review_id,
          status: 'pending',
          message: 'Review is still open in Markdown for Humans. When you finish editing, return to chat and type: resume',
        },
      });

      const finalResult = await applyServerFallbackIfNeeded(result, {
        original: result.original,
        replacement: result.replacement,
        context_before: result.context_before ?? null,
        context_after: result.context_after ?? null,
      });
      return { content: [{ type: 'text', text: JSON.stringify(finalResult) }] };
    } catch (err) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ status: 'error', error: String(err) }) }],
      };
    }
  }
);

server.tool(
  'propose_sequential_selection_replacements',
  `Show a queued series of proposed replacements for the same markdown file in the Markdown for Humans editor.
Opens the same review panel and advances through each proposal without returning control to the MCP client between steps.
Returns one aggregated result after the sequence completes or times out.
Pass file when available so the extension can target the correct open markdown document.`,
  {
    file: z
      .string()
      .optional()
      .describe('Absolute path to the markdown file being reviewed (recommended when available)'),
    changes: z
      .array(
        z.object({
          original: z
            .string()
            .describe('The exact original text to replace for this step'),
          replacement: z.string().describe('The proposed replacement markdown text for this step'),
          context_before: z
            .string()
            .optional()
            .describe('Text immediately before this selection'),
          context_after: z
            .string()
            .optional()
            .describe('Text immediately after this selection'),
        })
      )
      .min(1)
      .describe('Ordered list of replacements to review sequentially'),
  },
  async ({ file, changes }) => {
    try {
      const id = Date.now().toString();
      const selectionMetadata = readSelectionMetadata();
      const routingMetadata = buildBatchRoutingMetadata(selectionMetadata, file ?? null);
      clearFileIfExists(RESPONSE_TEMP_FILE);

      fs.writeFileSync(
        PROPOSAL_TEMP_FILE,
        JSON.stringify({
          id,
          ...routingMetadata,
          proposals: changes.map(change => ({
            original: change.original,
            replacement: change.replacement,
            context_before: change.context_before ?? null,
            context_after: change.context_after ?? null,
          })),
        }),
        'utf8'
      );

      const result = await waitForResponse(id, TIMEOUT_MS, {
        responseFilePath: RESPONSE_TEMP_FILE,
        timeoutResult: {
          id,
          file: routingMetadata.file ?? null,
          status: 'timeout',
          results: [],
        },
      });
      const finalResult = await applyServerBatchFallbackIfNeeded(result, {
        file: routingMetadata.file ?? null,
        changes: changes.map(change => ({
          original: change.original,
          replacement: change.replacement,
          context_before: change.context_before ?? null,
          context_after: change.context_after ?? null,
        })),
      });
      return { content: [{ type: 'text', text: JSON.stringify(finalResult) }] };
    } catch (err) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ status: 'error', error: String(err) }) }],
      };
    }
  }
);

server.tool(
  'resume_sequential_proposal_review',
  `Resume a pending sequential proposal review session in the Markdown for Humans editor.
Use this after propose_sequential_selection_replacements returned status "pending" and the user later says they are done editing.
Returns the final aggregated result when available, or "pending" again if the session is still open.`,
  {
    session_id: z.string().describe('The session_id returned by propose_sequential_selection_replacements when status was pending'),
  },
  async ({ session_id }) => {
    try {
      const result = await waitForProposalState(session_id, {
        pendingResult: {
          id: session_id,
          session_id,
          status: 'pending',
          message: 'Sequential review is still open in Markdown for Humans. When you finish editing, return to chat and type: resume',
        },
      });

      const finalResult = await applyServerBatchFallbackIfNeeded(result, {
        file: result.file ?? null,
        changes: Array.isArray(result.results)
          ? result.results.map(entry => ({
              original: entry.original,
              replacement: entry.replacement,
              context_before: entry.context_before ?? null,
              context_after: entry.context_after ?? null,
            }))
          : [],
      });
      return { content: [{ type: 'text', text: JSON.stringify(finalResult) }] };
    } catch (err) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ status: 'error', error: String(err) }) }],
      };
    }
  }
);

server.tool(
  'scroll_to_markdown_selection',
  `Select and scroll to a markdown selection in the Markdown for Humans editor.
Use the exact selected markdown from get_markdown_selection, plus context_before/context_after when available, so the editor can locate the correct occurrence if the text appears multiple times.
Returns { status, file } where status is "revealed", "timeout", or "error".`,
  {
    original: z
      .string()
      .describe('The exact selected markdown to reveal (as returned by get_markdown_selection selected field)'),
    context_before: z
      .string()
      .optional()
      .describe('Text immediately before the selection (context_before from get_markdown_selection)'),
    context_after: z
      .string()
      .optional()
      .describe('Text immediately after the selection (context_after from get_markdown_selection)'),
  },
  async ({ original, context_before, context_after }) => {
    try {
      const id = Date.now().toString();
      const selectionMetadata = readSelectionMetadata();
      const routingMetadata = buildSelectionRoutingMetadata(selectionMetadata, {
        original,
        context_before: context_before ?? null,
        context_after: context_after ?? null,
      });

      clearFileIfExists(SELECTION_REVEAL_RESPONSE_TEMP_FILE);
      fs.writeFileSync(
        SELECTION_REVEAL_TEMP_FILE,
        JSON.stringify({
          id,
          ...routingMetadata,
          original,
          context_before: context_before ?? null,
          context_after: context_after ?? null,
        }),
        'utf8'
      );

      const result = await waitForResponse(id, TIMEOUT_MS, {
        responseFilePath: SELECTION_REVEAL_RESPONSE_TEMP_FILE,
        timeoutResult: {
          id,
          status: 'timeout',
          file: routingMetadata.file ?? null,
        },
      });
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    } catch (err) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ status: 'error', error: String(err) }) }],
      };
    }
  }
);

function normalizeForMatching(markdown) {
  return markdown.replace(/\r\n/g, '\n').replace(/\u00a0/g, ' ');
}

function readSelectionMetadata() {
  try {
    if (!fs.existsSync(SELECTION_TEMP_FILE)) {
      return null;
    }

    return JSON.parse(fs.readFileSync(SELECTION_TEMP_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function proposalMatchesSelection(selection, proposal) {
  if (!selection || typeof selection !== 'object') {
    return false;
  }

  if (selection.selected !== proposal.original) {
    return false;
  }

  return (
    (selection.context_before ?? null) === (proposal.context_before ?? null) &&
    (selection.context_after ?? null) === (proposal.context_after ?? null)
  );
}

function buildSelectionRoutingMetadata(selectionMetadata, selection) {
  return proposalMatchesSelection(selectionMetadata, selection)
    ? {
        file: selectionMetadata.file ?? null,
        source_instance_id: selectionMetadata.instance_id ?? null,
      }
    : {};
}

function buildBatchRoutingMetadata(selectionMetadata, file) {
  if (file) {
    return {
      file,
      ...(selectionMetadata?.file === file
        ? { source_instance_id: selectionMetadata.instance_id ?? null }
        : {}),
    };
  }

  if (!selectionMetadata?.file) {
    return {};
  }

  return {
    file: selectionMetadata.file,
    source_instance_id: selectionMetadata.instance_id ?? null,
  };
}

function collapseParagraphBreaks(markdown) {
  return normalizeForMatching(markdown).replace(/([^\n])\n\n[ \t]*(?=\S)/g, '$1 ');
}

function buildCandidates(serializedSelection) {
  const normalized = normalizeForMatching(serializedSelection);
  const collapsed = collapseParagraphBreaks(serializedSelection);
  return [...new Set([serializedSelection, normalized, collapsed])].filter(
    candidate => candidate.length > 0
  );
}

function commonSuffixLength(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[a.length - 1 - i] === b[b.length - 1 - i]) {
    i += 1;
  }
  return i;
}

function commonPrefixLength(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) {
    i += 1;
  }
  return i;
}

function mapNormalizedIndexToOriginal(markdown, normalizedIndex) {
  if (normalizedIndex <= 0) {
    return 0;
  }

  let originalIndex = 0;
  let seenNormalizedChars = 0;

  while (originalIndex < markdown.length && seenNormalizedChars < normalizedIndex) {
    if (markdown[originalIndex] !== '\r') {
      seenNormalizedChars += 1;
    }
    originalIndex += 1;
  }

  return originalIndex;
}

function findProposalMatch(fullMarkdown, proposal) {
  const normalizedFullMarkdown = normalizeForMatching(fullMarkdown);
  const normalizedContextBefore = proposal.context_before
    ? normalizeForMatching(proposal.context_before)
    : null;
  const normalizedContextAfter = proposal.context_after
    ? normalizeForMatching(proposal.context_after)
    : null;

  let bestMatch = null;

  for (const candidate of buildCandidates(proposal.original)) {
    for (const searchContent of [fullMarkdown, normalizedFullMarkdown]) {
      const useNormalizedIndex = searchContent === normalizedFullMarkdown;
      let searchFrom = 0;

      while (true) {
        const index = searchContent.indexOf(candidate, searchFrom);
        if (index === -1) {
          break;
        }

        const matchStart = useNormalizedIndex
          ? mapNormalizedIndexToOriginal(fullMarkdown, index)
          : index;
        const matchEnd = useNormalizedIndex
          ? mapNormalizedIndexToOriginal(fullMarkdown, index + candidate.length)
          : index + candidate.length;
        const matchedText = fullMarkdown.slice(matchStart, matchEnd);
        let score = candidate.length;

        if (normalizedContextBefore) {
          const before = normalizeForMatching(
            fullMarkdown.slice(
              Math.max(0, matchStart - normalizedContextBefore.length),
              matchStart
            )
          );
          score += commonSuffixLength(before, normalizedContextBefore);
        }

        if (normalizedContextAfter) {
          const after = normalizeForMatching(
            fullMarkdown.slice(
              matchEnd,
              matchEnd + normalizedContextAfter.length + 8
            )
          );
          score += commonPrefixLength(after, normalizedContextAfter);
        }

        if (!bestMatch || score > bestMatch.score) {
          bestMatch = { index: matchStart, matchedText, score };
        }

        searchFrom = index + 1;
      }
    }
  }

  return bestMatch ? { index: bestMatch.index, matchedText: bestMatch.matchedText } : null;
}

function applyProposalReplacement(fullMarkdown, proposal) {
  const match = findProposalMatch(fullMarkdown, proposal);
  if (!match) {
    return null;
  }

  return {
    ...match,
    newContent:
      fullMarkdown.slice(0, match.index) +
      proposal.replacement +
      fullMarkdown.slice(match.index + match.matchedText.length),
  };
}

function clearFileIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  try {
    fs.unlinkSync(filePath);
  } catch {}
}

function getProposalStateFilePath(id) {
  return path.join(PROPOSAL_STATE_DIR, `${id}.json`);
}

function readProposalState(id) {
  const stateFilePath = getProposalStateFilePath(id);
  if (!fs.existsSync(stateFilePath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(stateFilePath, 'utf8'));
  } catch {
    return null;
  }
}

function isFinalProposalState(state) {
  return Boolean(state) && state.status !== 'pending';
}

async function applyServerFallbackIfNeeded(result, proposal) {
  if (!result || result.status !== 'accept' || !result.replacement) {
    return result;
  }

  const targetFile = result.file;
  if (!targetFile || !fs.existsSync(targetFile)) {
    return result;
  }

  try {
    const rawContent = fs.readFileSync(targetFile, 'utf8');
    const applied = applyProposalReplacement(rawContent, {
      original: result.original || proposal.original,
      replacement: result.replacement,
      context_before: result.context_before ?? proposal.context_before ?? null,
      context_after: result.context_after ?? proposal.context_after ?? null,
    });

    if (!applied) {
      return result;
    }

    fs.writeFileSync(targetFile, applied.newContent, 'utf8');
    return {
      ...result,
      status: 'applied',
      applied_by: 'mcp-server',
    };
  } catch (error) {
    return {
      ...result,
      fallback_error: String(error),
    };
  }
}

async function applyServerBatchFallbackIfNeeded(result, batch) {
  if (!result || !Array.isArray(result.results) || result.results.length === 0) {
    return result;
  }

  const targetFile = result.file || batch.file;
  if (!targetFile || !fs.existsSync(targetFile)) {
    return result;
  }

  const updatedResults = [];

  try {
    let workingContent = fs.readFileSync(targetFile, 'utf8');

    for (let i = 0; i < result.results.length; i += 1) {
      const currentResult = result.results[i];
      const originalChange = batch.changes[i];

      if (!currentResult || currentResult.status !== 'accept' || !currentResult.replacement) {
        updatedResults.push(currentResult);
        continue;
      }

      const applied = applyProposalReplacement(workingContent, {
        original: currentResult.original || originalChange?.original,
        replacement: currentResult.replacement,
        context_before: currentResult.context_before ?? originalChange?.context_before ?? null,
        context_after: currentResult.context_after ?? originalChange?.context_after ?? null,
      });

      if (!applied) {
        updatedResults.push(currentResult);
        continue;
      }

      workingContent = applied.newContent;
      updatedResults.push({
        ...currentResult,
        status: 'applied',
        applied_by: 'mcp-server',
      });
    }

    if (updatedResults.some(entry => entry?.status === 'applied' && entry?.applied_by === 'mcp-server')) {
      fs.writeFileSync(targetFile, workingContent, 'utf8');
    }

    return {
      ...result,
      results: updatedResults,
    };
  } catch (error) {
    return {
      ...result,
      fallback_error: String(error),
    };
  }
}

/**
 * Wait for the extension to write a response file with a matching id.
 * Uses fs.watch with a polling fallback. Resolves on response or timeout.
 */
function waitForResponse(id, timeoutMs, options) {
  const { responseFilePath, timeoutResult } = options;

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
      finish(timeoutResult);
    }, timeoutMs);

    const check = () => {
      try {
        if (!fs.existsSync(responseFilePath)) return;
        const data = JSON.parse(fs.readFileSync(responseFilePath, 'utf8'));
        if (data.id !== id) return;
        clearTimeout(deadline);
        finish(data);
      } catch {}
    };

    try {
      watcher = fs.watch(path.dirname(responseFilePath), (_event, filename) => {
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

function waitForProposalState(id, options = {}) {
  const { pendingResult } = options;
  const stateFilePath = getProposalStateFilePath(id);

  return new Promise((resolve) => {
    let watcher;
    let resolved = false;

    const finish = (value) => {
      if (resolved) return;
      resolved = true;
      try { watcher?.close(); } catch {}
      resolve(value);
    };

    const check = () => {
      const state = readProposalState(id);
      if (!state) {
        return false;
      }

      if (isFinalProposalState(state)) {
        finish(state);
        return true;
      }

      return false;
    };

    if (check()) {
      return;
    }

    const stateDir = path.dirname(stateFilePath);
    try {
      watcher = fs.watch(stateDir, (_event, filename) => {
        if (filename && filename.includes(`${id}.json`)) {
          check();
        }
      });
    } catch {
      // Fallback to polling if fs.watch is unavailable
      const iv = setInterval(() => {
        if (resolved) {
          clearInterval(iv);
          return;
        }

        if (check()) {
          clearInterval(iv);
        }
      }, 1000);
    }

    setTimeout(() => {
      finish(readProposalState(id) ?? pendingResult ?? {
        id,
        status: 'pending',
        message: 'Review is still open in Markdown for Humans. When you finish editing, return to chat and type: resume',
      });
    }, TIMEOUT_MS);
  });
}

const transport = new StdioServerTransport();
server.connect(transport).catch(err => {
  console.error('[MD4H MCP] Failed to start:', err);
  process.exit(1);
});
