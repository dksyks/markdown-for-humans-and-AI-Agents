/**
 * MCP server for Markdown for Humans VS Code extension.
 * Exposes the current editor selection to Claude Code and other MCP clients.
 * Also supports proposing text replacements via the propose_single_replacement tool.
 */

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PROPOSAL_TEMP_FILE = path.join(os.tmpdir(), 'MarkdownForHumans-Proposal.json');
const SELECTION_REVEAL_TEMP_FILE = path.join(os.tmpdir(), 'MarkdownForHumans-SelectionReveal.json');
const ACTIVE_INSTANCE_TEMP_FILE = path.join(os.tmpdir(), 'MarkdownForHumans-ActiveInstance.json');
const INSTANCE_TEMP_DIR_PREFIX = 'MarkdownForHumans-';
const TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const PROPOSAL_CLAIM_TIMEOUT_MS = 500;
const PROPOSAL_STARTUP_TIMEOUT_MS = 3000;
const PROPOSAL_RESUME_SESSION_LOOKUP_TIMEOUT_MS = 500;
const SELECTION_REVEAL_CLAIM_TIMEOUT_MS = 500;
const SELECTION_REVEAL_COMPLETION_TIMEOUT_MS = 3000;
const MCP_RESPONSE_POLL_MS = 100;
const PROPOSAL_REQUEST_UNCLAIMED_ERROR =
  'No instance of the Markdown for Humans extension acknowledged the proposal request within 500ms. The file may not be open in Markdown for Humans, or the extension may be busy.';
const PROPOSAL_SELECTION_NOT_FOUND_ERROR =
  'The file is open in Markdown for Humans, but the selection for the proposal could not be found. The file contents may have changed, or the provided context may not match.';
const PROPOSAL_INTERNAL_ERROR =
  'The file is open in Markdown for Humans, but the proposal could not be completed due to an internal extension error.';
const PROPOSAL_SESSION_NOT_FOUND_ERROR =
  'No open Markdown for Humans proposal review matched the provided propose_single_replacement_session_id within 500ms. The review may have been closed, the session id may be wrong, or the extension may be busy.';
const PROPOSAL_SEQUENTIAL_SESSION_NOT_FOUND_ERROR =
  'No open Markdown for Humans sequential proposal review matched the provided propose_sequential_replacements_session_id within 500ms. The review may have been closed, the session id may be wrong, or the extension may be busy.';
const SELECTION_REQUEST_UNCLAIMED_ERROR =
  'No instance of the Markdown for Humans extension acknowledged the selection request within 500ms. The file may not be open in Markdown for Humans, or the extension may be busy.';
const SELECTION_NOT_FOUND_ERROR =
  'The file is open in Markdown for Humans, but the requested selection could not be found. The file contents may have changed, or the provided context may not match.';
const SELECTION_INTERNAL_ERROR =
  'Markdown for Humans began handling the selection, but an internal error prevented it from being completed.';
const SELECTION_COMPLETION_TIMEOUT_ERROR =
  'The file is open in Markdown for Humans, but an unknown error prevented the selection from being completed in time.';

function getInstanceTempDir(instanceId) {
  return path.join(os.tmpdir(), `${INSTANCE_TEMP_DIR_PREFIX}${instanceId}`);
}

function getSelectionTempFilePath(instanceId) {
  return path.join(getInstanceTempDir(instanceId), 'Selection.json');
}

function encodeSelectionFilePath(filePath) {
  return Buffer.from(filePath, 'utf8').toString('hex');
}

function getSelectionStateFilePathForDocument(filePath, instanceId) {
  return path.join(
    getInstanceTempDir(instanceId),
    `Selection-${encodeSelectionFilePath(filePath)}.json`
  );
}

function getResponseTempFilePath(instanceId) {
  return path.join(getInstanceTempDir(instanceId), 'Response.json');
}

function getProposalStateDir(instanceId) {
  return path.join(getInstanceTempDir(instanceId), 'ProposalState');
}

function getProposalStateFilePathForInstance(id, instanceId) {
  return path.join(getProposalStateDir(instanceId), `${id}.json`);
}

function getSelectionRevealResponseTempFilePath(instanceId) {
  return path.join(getInstanceTempDir(instanceId), 'SelectionRevealResponse.json');
}

function getSelectionRevealRequestId(data) {
  return data?.selection_request_id ?? data?.id ?? null;
}

function readJsonFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function readActiveInstanceMetadata() {
  return readJsonFile(ACTIVE_INSTANCE_TEMP_FILE);
}

function listInstanceIds() {
  try {
    return fs.readdirSync(os.tmpdir(), { withFileTypes: true })
      .filter(entry => entry.isDirectory() && entry.name.startsWith(INSTANCE_TEMP_DIR_PREFIX))
      .map(entry => entry.name.slice(INSTANCE_TEMP_DIR_PREFIX.length));
  } catch {
    return [];
  }
}

function readSelectionForActiveInstance() {
  const active = readActiveInstanceMetadata();
  if (!active?.instance_id) {
    return null;
  }

  const selectionPath = getSelectionTempFilePath(active.instance_id);
  if (!fs.existsSync(selectionPath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(selectionPath, 'utf8'));
}

function readSelectionsForFile(filePath) {
  if (!filePath) {
    return [];
  }

  const results = [];
  for (const instanceId of listInstanceIds()) {
    const selectionPath = getSelectionStateFilePathForDocument(filePath, instanceId);
    if (!fs.existsSync(selectionPath)) {
      continue;
    }

    try {
      const data = JSON.parse(fs.readFileSync(selectionPath, 'utf8'));
      if (data?.file === filePath) {
        results.push(data);
      }
    } catch {}
  }

  return results;
}

function normalizeSelectionResult(data) {
  if (!data) {
    return null;
  }

  const normalizedData = JSON.parse(JSON.stringify(data).replace(/\u00a0/g, ' '));
  if ('selected' in normalizedData) {
    normalizedData.selection = normalizedData.selected;
    delete normalizedData.selected;
  }
  return normalizedData;
}

function findResponseById(id, kind) {
  for (const instanceId of listInstanceIds()) {
    const filePath = kind === 'selectionReveal'
      ? getSelectionRevealResponseTempFilePath(instanceId)
      : getResponseTempFilePath(instanceId);

    try {
      if (!fs.existsSync(filePath)) continue;
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const responseId = kind === 'selectionReveal'
        ? getSelectionRevealRequestId(data)
        : data.id;
      if (responseId === id) {
        return data;
      }
    } catch {}
  }

  return null;
}

function readProposalStateFromAnyInstance(id) {
  for (const instanceId of listInstanceIds()) {
    const stateFilePath = getProposalStateFilePathForInstance(id, instanceId);
    if (!fs.existsSync(stateFilePath)) {
      continue;
    }

    try {
      return JSON.parse(fs.readFileSync(stateFilePath, 'utf8'));
    } catch {}
  }

  return null;
}

const server = new McpServer({
  name: 'markdown-for-humans',
  version: '1.0.0',
});

server.tool(
  'get_active_selection',
  'Get the currently selected text in the active Markdown for Humans editor, along with surrounding context and preceding headings. Call this when the user refers to selected text, "this", "here", or similar references that suggest they have something highlighted in the active editor.',
  {},
  async () => {
    try {
      const data = normalizeSelectionResult(readSelectionForActiveInstance());
      if (!data) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ selection: null, error: 'No active selection data available. Open a markdown file in the Markdown for Humans editor first.' }) }],
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(data) }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ selection: null, error: String(err) }) }],
      };
    }
  }
);

server.tool(
  'get_selections_for_file',
  'Get the current Markdown for Humans selection metadata for a specific markdown file across all instances where that file is open. Returns an array — one entry per open instance, empty array if not open anywhere. Use this only when the caller explicitly wants the selection for a named file.',
  {
    file: z.string().describe('Absolute path to the markdown file whose current MFH selection state should be returned'),
  },
  async ({ file }) => {
    try {
      const results = readSelectionsForFile(file).map(normalizeSelectionResult);
      return {
        content: [{ type: 'text', text: JSON.stringify(results) }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ file, error: String(err) }) }],
      };
    }
  }
);

server.tool(
  'get_selection',
  'Backward-compatible alias for get_active_selection. Returns the currently selected text in the active Markdown for Humans editor, along with surrounding context and preceding headings.',
  {},
  async () => {
    try {
      const data = normalizeSelectionResult(readSelectionForActiveInstance());
      if (!data) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ selection: null, error: 'No active selection data available. Open a markdown file in the Markdown for Humans editor first.' }) }],
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(data) }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ selection: null, error: String(err) }) }],
      };
    }
  }
);

server.tool(
  'propose_single_replacement',
  `Show the user one or more proposed replacements for selected text in the Markdown for Humans editor.
Opens a popup panel beside the editor. Each option has its own Accept button and optional justification.
The user can Accept any option (applying it), edit the replacement inline, or Skip All.
The redline diff updates live as the user edits or moves focus between options.
The arguments before replacement_options are the same as for scroll_to_selection.
Returns { status, message, error_type, error, propose_single_replacement_session_id, selection, selection_replacement, selected_option_index, file, context_before, context_after, headings_before } where status is "applied", "accepted_unchanged_but_not_applied", "accepted_changed_but_not_applied", "skipped", "in_progress", or "error".
Treat only "applied" as authoritative success.
Use context_before and context_after to locate the correct occurrence if the text appears multiple times.`,
  {
    selection: z.string().describe('The exact text to replace.'),
    file: z.string().optional().describe('Absolute path to the markdown file.'),
    context_before: z.string().optional().describe('Text immediately before the selection.'),
    context_after: z.string().optional().describe('Text immediately after the selection.'),
    headings_before: z.array(z.string()).optional().describe('Up to 5 headings preceding the selection, closest first.'),
    replacement_options: z
      .array(z.object({
        selection_replacement: z.string().describe('The proposed replacement markdown text.'),
        justification: z.string().optional().describe('Optional markdown explaining the reasoning behind this option. When supplied, displayed above the replacement editor.'),
      }))
      .min(1)
      .describe('Ordered list of replacement alternatives (max 3; extras ignored). Each has a selection_replacement and optional justification.'),
  },
  async ({ selection, file, context_before, context_after, headings_before, replacement_options }) => {
    try {
      const id = Date.now().toString();
      const selectionMetadata = readSelectionMetadata();
      const routingMetadata = proposalMatchesSelection(selectionMetadata, {
        selection,
        context_before: context_before ?? null,
        context_after: context_after ?? null,
      })
        ? {
            file: selectionMetadata.file ?? file ?? null,
            source_instance_id: selectionMetadata.instance_id ?? null,
          }
        : { file: file ?? null };
      const cappedOptions = replacement_options.slice(0, 3).map(o => ({
        replacement: o.selection_replacement,
        justification: o.justification ?? null,
      }));
      // Write proposal for extension to pick up
      fs.writeFileSync(
        PROPOSAL_TEMP_FILE,
        JSON.stringify({
          id,
          ...routingMetadata,
          original: selection,
          options: cappedOptions,
          context_before: context_before ?? null,
          context_after: context_after ?? null,
          headings_before: headings_before ?? null,
        }),
        'utf8'
      );

      const claimed = await waitForProposalClaim(id, PROPOSAL_CLAIM_TIMEOUT_MS);
      if (!claimed) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(
              normalizeSingleProposalResult(
                {
                  id,
                  status: 'error',
                  error_type: 'proposal_request_not_acknowledged',
                  error: PROPOSAL_REQUEST_UNCLAIMED_ERROR,
                },
                {
                  selection,
                  file: routingMetadata.file ?? null,
                  context_before: context_before ?? null,
                  context_after: context_after ?? null,
                  headings_before: headings_before ?? null,
                }
              )
            ),
          }],
        };
      }

      const startupResult = await waitForProposalStartup(id, PROPOSAL_STARTUP_TIMEOUT_MS);
      if (startupResult.type === 'response') {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(
              normalizeSingleProposalResult(startupResult.value, {
                selection,
                file: routingMetadata.file ?? null,
                context_before: context_before ?? null,
                context_after: context_after ?? null,
                headings_before: headings_before ?? null,
              })
            ),
          }],
        };
      }
      if (startupResult.type === 'error') {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(
              normalizeSingleProposalResult(startupResult.value, {
                selection,
                file: routingMetadata.file ?? null,
                context_before: context_before ?? null,
                context_after: context_after ?? null,
                headings_before: headings_before ?? null,
              })
            ),
          }],
        };
      }

      const result = await waitForResponse(id, TIMEOUT_MS, {
        responseKind: 'proposal',
        timeoutResult: {
          id,
          status: 'error',
          error_type: 'proposal_internal_error',
          error: PROPOSAL_INTERNAL_ERROR,
          replacement: null,
        },
      });
      const finalResult = await applyServerFallbackIfNeeded(result, {
        original: selection,
        replacement: result.replacement,
        context_before: context_before ?? null,
        context_after: context_after ?? null,
      });
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(
            normalizeSingleProposalResult(finalResult, {
              selection,
              file: routingMetadata.file ?? null,
              context_before: context_before ?? null,
              context_after: context_after ?? null,
              headings_before: headings_before ?? null,
            })
          ),
        }],
      };
    } catch (err) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(
            normalizeSingleProposalResult(
              {
                status: 'error',
                error_type: 'proposal_internal_error',
                error: String(err),
              },
              {
                selection,
                file: file ?? null,
                context_before: context_before ?? null,
                context_after: context_after ?? null,
                headings_before: headings_before ?? null,
              }
            )
          ),
        }],
      };
    }
  }
);

server.tool(
  'resume_single_replacement',
  `Resume a pending single proposed change review in the Markdown for Humans editor.
Use this after propose_single_replacement returned status "in_progress" and the user later says they are done editing.
Returns the same fields as propose_single_replacement. This reads the current state immediately: final result, "in_progress", or "error" if the provided propose_single_replacement_session_id does not match any open review.`,
  {
    propose_single_replacement_session_id: z
      .string()
      .describe('The propose_single_replacement_session_id returned by propose_single_replacement when status was in_progress'),
  },
  async ({ propose_single_replacement_session_id }) => {
    try {
      const currentState = await waitForSingleProposalResumeState(
        propose_single_replacement_session_id,
        PROPOSAL_RESUME_SESSION_LOOKUP_TIMEOUT_MS
      );

      if (!currentState) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(
              normalizeSingleProposalResult({
                status: 'error',
                error_type: 'proposal_session_not_found',
                error: PROPOSAL_SESSION_NOT_FOUND_ERROR,
                propose_single_replacement_session_id,
              })
            ),
          }],
        };
      }

      const result = isFinalProposalState(currentState)
        ? currentState
        : {
            ...currentState,
            status: 'in_progress',
            propose_single_replacement_session_id,
            message: 'The proposal review is still open in Markdown for Humans. Finish reviewing there, then in the conversation type "resume".',
          };

      const finalResult = await applyServerFallbackIfNeeded(result, {
        original: result.original,
        replacement: result.replacement,
        context_before: result.context_before ?? null,
        context_after: result.context_after ?? null,
      });
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(normalizeSingleProposalResult(finalResult)),
        }],
      };
    } catch (err) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(
            normalizeSingleProposalResult({
              status: 'error',
              error_type: 'proposal_internal_error',
              error: String(err),
            })
          ),
        }],
      };
    }
  }
);

server.tool(
  'propose_sequential_replacements',
  `Show a queued series of proposed replacements for the same markdown file in the Markdown for Humans editor.
Opens the same review panel and advances through each proposal without returning control to the MCP client between steps.
Returns one aggregated result after the sequence completes, returns "in_progress", or fails with "error".
The arguments before replacement_options in each proposed replacement are the same as for scroll_to_selection.
Pass file when available so the extension can target the correct open markdown document.`,
  {
    file: z
      .string()
      .optional()
      .describe('Absolute path to the markdown file being reviewed (recommended when available)'),
    proposed_replacements: z
      .array(
        z.object({
          selection: z
            .string()
            .describe('The exact text to replace for this step.'),
          context_before: z
            .string()
            .optional()
            .describe('Text immediately before this selection.'),
          context_after: z
            .string()
            .optional()
            .describe('Text immediately after this selection.'),
          headings_before: z
            .array(z.string())
            .optional()
            .describe('Up to 5 headings preceding this selection, closest first.'),
          replacement_options: z
            .array(z.object({
              selection_replacement: z.string().describe('The proposed replacement markdown text.'),
              justification: z.string().optional().describe('Optional markdown explaining the reasoning behind this option. When supplied, displayed above the replacement editor.'),
            }))
            .min(1)
            .describe('Ordered list of replacement alternatives for this step (max 3; extras ignored). Each has a selection_replacement and optional justification.'),
        })
      )
      .min(1)
      .describe('Ordered list of proposed replacements to review sequentially.'),
  },
  async ({ file, proposed_replacements }) => {
    try {
      const id = Date.now().toString();
      const selectionMetadata = readSelectionMetadata();
      const routingMetadata = buildBatchRoutingMetadata(selectionMetadata, file ?? null);
      fs.writeFileSync(
        PROPOSAL_TEMP_FILE,
        JSON.stringify({
          id,
          ...routingMetadata,
          proposals: proposed_replacements.map(proposedReplacement => ({
            original: proposedReplacement.selection,
            options: proposedReplacement.replacement_options.slice(0, 3).map(option => ({
              replacement: option.selection_replacement,
              justification: option.justification ?? null,
            })),
            context_before: proposedReplacement.context_before ?? null,
            context_after: proposedReplacement.context_after ?? null,
            headings_before: proposedReplacement.headings_before ?? null,
          })),
        }),
        'utf8'
      );

      const claimed = await waitForProposalClaim(id, PROPOSAL_CLAIM_TIMEOUT_MS);
      if (!claimed) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(
              normalizeBatchResultStatus(
                {
                  id,
                  file: routingMetadata.file ?? null,
                  status: 'error',
                  error_type: 'proposal_request_not_acknowledged',
                  error: PROPOSAL_REQUEST_UNCLAIMED_ERROR,
                  results: [],
                },
                {
                  file: routingMetadata.file ?? null,
                }
              )
            ),
          }],
        };
      }

      const startupResult = await waitForProposalStartup(id, PROPOSAL_STARTUP_TIMEOUT_MS);
      if (startupResult.type === 'response' || startupResult.type === 'error') {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(
              normalizeBatchResultStatus(startupResult.value, {
                file: routingMetadata.file ?? null,
              })
            ),
          }],
        };
      }

      const result = await waitForResponse(id, TIMEOUT_MS, {
        responseKind: 'proposal',
        timeoutResult: {
          id,
          file: routingMetadata.file ?? null,
          status: 'error',
          error_type: 'proposal_internal_error',
          error: PROPOSAL_INTERNAL_ERROR,
          results: [],
        },
      });
      const finalResult = await applyServerBatchFallbackIfNeeded(result, {
        file: routingMetadata.file ?? null,
        proposed_replacements: proposed_replacements.map(proposedReplacement => ({
          original: proposedReplacement.selection,
          replacement: proposedReplacement.replacement_options[0]?.selection_replacement ?? '',
          context_before: proposedReplacement.context_before ?? null,
          context_after: proposedReplacement.context_after ?? null,
        })),
      });
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(
            normalizeBatchResultStatus(finalResult, {
              file: routingMetadata.file ?? null,
            })
          ),
        }],
      };
    } catch (err) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(
            normalizeBatchResultStatus({
              status: 'error',
              error_type: 'proposal_internal_error',
              error: String(err),
              results: [],
            })
          ),
        }],
      };
    }
  }
);

server.tool(
  'resume_sequential_replacements',
  `Resume a pending sequential proposal review session in the Markdown for Humans editor.
Use this after propose_sequential_replacements returned status "in_progress" and the user later says they are done editing.
Returns the same fields as propose_sequential_replacements. This reads the current state immediately: final result, "in_progress", or "error" if the provided propose_sequential_replacements_session_id does not match any open review.`,
  {
    propose_sequential_replacements_session_id: z
      .string()
      .describe('The propose_sequential_replacements_session_id returned by propose_sequential_replacements when status was in_progress'),
  },
  async ({ propose_sequential_replacements_session_id }) => {
    try {
      const currentState = await waitForSequentialProposalResumeState(
        propose_sequential_replacements_session_id,
        PROPOSAL_RESUME_SESSION_LOOKUP_TIMEOUT_MS
      );

      if (!currentState) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(
              normalizeBatchResultStatus({
                status: 'error',
                error_type: 'proposal_sequential_session_not_found',
                error: PROPOSAL_SEQUENTIAL_SESSION_NOT_FOUND_ERROR,
                propose_sequential_replacements_session_id,
                results: [],
              })
            ),
          }],
        };
      }

      const result = isFinalProposalState(currentState)
        ? currentState
        : {
            ...currentState,
            status: 'in_progress',
            propose_sequential_replacements_session_id,
            message: 'The proposal review is still open in Markdown for Humans. Finish reviewing there, then in the conversation type "resume".',
          };

      const finalResult = await applyServerBatchFallbackIfNeeded(result, {
        file: result.file ?? null,
        proposed_replacements: Array.isArray(result.results)
          ? result.results.map(entry => ({
              original: entry.original,
              replacement: entry.replacement,
              context_before: entry.context_before ?? null,
              context_after: entry.context_after ?? null,
            }))
          : [],
      });
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(normalizeBatchResultStatus(finalResult)),
        }],
      };
    } catch (err) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(
            normalizeBatchResultStatus({
              status: 'error',
              error_type: 'proposal_internal_error',
              error: String(err),
              results: [],
            })
          ),
        }],
      };
    }
  }
);

server.tool(
  'scroll_to_selection',
  `Select and scroll to a passage in the Markdown for Humans editor.
Use the exact selection text from get_selection, plus context_before/context_after when available, so the editor can locate the correct occurrence if the text appears multiple times.
Returns { status, file, error } where status is "revealed" or "error".`,
  {
    selection: z
      .string()
      .describe('The exact text to reveal (as returned by get_selection selection field)'),
    file: z
      .string()
      .optional()
      .describe('Absolute path to the markdown file (file from get_selection)'),
    context_before: z
      .string()
      .optional()
      .describe('Text immediately before the selection (context_before from get_selection)'),
    context_after: z
      .string()
      .optional()
      .describe('Text immediately after the selection (context_after from get_selection)'),
    headings_before: z
      .array(z.string())
      .optional()
      .describe('Up to 5 headings preceding the selection, closest first (headings_before from get_selection)'),
  },
  async ({ selection, file, context_before, context_after, headings_before }) => {
    try {
      const selectionRequestId = Date.now().toString();
      const selectionMetadata = readSelectionMetadata();
      const routingMetadata = buildSelectionRoutingMetadata(selectionMetadata, {
        selection,
        context_before: context_before ?? null,
        context_after: context_after ?? null,
      }, file ?? null);

      fs.writeFileSync(
        SELECTION_REVEAL_TEMP_FILE,
        JSON.stringify({
          selection_request_id: selectionRequestId,
          id: selectionRequestId,
          ...routingMetadata,
          original: selection,
          context_before: context_before ?? null,
          context_after: context_after ?? null,
          headings_before: headings_before ?? null,
        }),
        'utf8'
      );

      const claimed = await waitForSelectionRevealClaim(
        selectionRequestId,
        SELECTION_REVEAL_CLAIM_TIMEOUT_MS
      );
      if (!claimed) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              selection_request_id: selectionRequestId,
              status: 'error',
              error: SELECTION_REQUEST_UNCLAIMED_ERROR,
              file: routingMetadata.file ?? null,
            }),
          }],
        };
      }

      const result = await waitForResponse(
        selectionRequestId,
        SELECTION_REVEAL_COMPLETION_TIMEOUT_MS,
        {
        responseKind: 'selectionReveal',
        timeoutResult: {
          selection_request_id: selectionRequestId,
          id: selectionRequestId,
          status: 'error',
          error: SELECTION_COMPLETION_TIMEOUT_ERROR,
          file: routingMetadata.file ?? null,
        },
      });
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(
            normalizeSelectionRevealResult(result, routingMetadata.file ?? null)
          ),
        }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ status: 'error', error: String(err) }) }],
      };
    }
  }
);

function normalizeSingleProposalResult(result, fallback = {}) {
  if (!result || typeof result !== 'object') return result;

  const normalized = { ...result };
  const rawStatus = normalized.status;
  const statusMap = {
    accept: 'accepted_unchanged_but_not_applied',
    accept_unchanged: 'accepted_unchanged_but_not_applied',
    accept_changed: 'accepted_changed_but_not_applied',
    cancelled: 'skipped',
    pending: 'in_progress',
    timeout: 'error',
  };
  if (normalized.status in statusMap) {
    normalized.status = statusMap[normalized.status];
  }

  normalized.selection = normalized.original ?? fallback.selection ?? normalized.selection ?? null;
  delete normalized.original;

  normalized.selection_replacement =
    normalized.selection_replacement ??
    normalized.replacement ??
    fallback.selection_replacement ??
    null;
  delete normalized.replacement;

  normalized.file = normalized.file ?? fallback.file ?? null;
  normalized.context_before = normalized.context_before ?? fallback.context_before ?? null;
  normalized.context_after = normalized.context_after ?? fallback.context_after ?? null;
  normalized.headings_before = normalized.headings_before ?? fallback.headings_before ?? null;

  normalized.propose_single_replacement_session_id =
    normalized.propose_single_replacement_session_id ??
    normalized.review_id ??
    normalized.session_id ??
    fallback.propose_single_replacement_session_id ??
    null;
  delete normalized.review_id;
  delete normalized.session_id;

  if (!('selected_option_index' in normalized)) {
    normalized.selected_option_index = null;
  }

  delete normalized.applied_by;
  delete normalized.fallback_error;

  if (normalized.status === 'skipped' || normalized.status === 'in_progress' || normalized.status === 'error') {
    normalized.selection_replacement = normalized.selection_replacement ?? null;
    normalized.selected_option_index = normalized.selected_option_index ?? null;
  }

  if (normalized.status === 'applied') {
    normalized.message = 'The replacement was written to the file.';
    normalized.error_type = null;
    normalized.error = null;
  } else if (normalized.status === 'accepted_unchanged_but_not_applied') {
    normalized.message =
      'The user accepted the proposed replacement unchanged, but Markdown for Humans could not apply it to the file. The accepted text was copied to the clipboard.';
    normalized.error_type = null;
    normalized.error = null;
  } else if (normalized.status === 'accepted_changed_but_not_applied') {
    normalized.message =
      'The user changed a proposed replacement and accepted that edited version, but Markdown for Humans could not apply it to the file. The accepted text was copied to the clipboard.';
    normalized.error_type = null;
    normalized.error = null;
  } else if (normalized.status === 'skipped') {
    normalized.message = 'The user declined all proposals.';
    normalized.error_type = null;
    normalized.error = null;
  } else if (normalized.status === 'in_progress') {
    normalized.message =
      'The proposal review is still open in Markdown for Humans. Finish reviewing there, then in the conversation type "resume".';
    normalized.error_type = null;
    normalized.error = null;
  } else if (normalized.status === 'error') {
    const normalizedError = normalizeSingleProposalError(
      normalized.error_type,
      normalized.error,
      rawStatus
    );
    normalized.error_type = normalizedError.error_type;
    normalized.error = normalizedError.error;
    normalized.message = normalizedError.error;
    normalized.selection_replacement = normalized.selection_replacement ?? null;
    normalized.selected_option_index = normalized.selected_option_index ?? null;
  }

  return normalized;
}

function normalizeBatchResultStatus(result, fallback = {}) {
  if (!result || typeof result !== 'object') return result;
  const rawStatus = result.status;
  const statusMap = {
    accept: 'accepted_unchanged_but_not_applied',
    accept_unchanged: 'accepted_unchanged_but_not_applied',
    accept_changed: 'accepted_changed_but_not_applied',
    cancelled: 'skipped',
    pending: 'in_progress',
    timeout: 'error',
  };
  const normalized = { ...result };
  if (normalized.status in statusMap) {
    normalized.status = statusMap[normalized.status];
  }

  normalized.propose_sequential_replacements_session_id =
    normalized.propose_sequential_replacements_session_id ??
    normalized.session_id ??
    fallback.propose_sequential_replacements_session_id ??
    null;
  delete normalized.session_id;

  normalized.file = normalized.file ?? fallback.file ?? null;
  normalized.results = Array.isArray(normalized.results) ? normalized.results : [];

  if (normalized.status === 'completed') {
    normalized.message = 'The sequential proposal review was completed.';
    normalized.error_type = null;
    normalized.error = null;
  } else if (normalized.status === 'in_progress') {
    normalized.message =
      'The proposal review is still open in Markdown for Humans. Finish reviewing there, then in the conversation type "resume".';
    normalized.error_type = null;
    normalized.error = null;
  } else if (normalized.status === 'error') {
    const normalizedError = normalizeSequentialProposalError(
      normalized.error_type,
      normalized.error,
      rawStatus
    );
    normalized.error_type = normalizedError.error_type;
    normalized.error = normalizedError.error;
    normalized.message = normalizedError.error;
  }

  if (Array.isArray(normalized.results)) {
    normalized.results = normalized.results.map(item => {
      if (!item || typeof item !== 'object') return item;
      const r = { ...item };
      if (r.status in statusMap) {
        r.status = statusMap[r.status];
      }
      if ('replacement' in r) {
        r.selection_replacement = r.replacement;
        delete r.replacement;
      }
      if ('original' in r) {
        r.selection = r.original;
        delete r.original;
      }
      if (!('selected_option_index' in r)) {
        r.selected_option_index = null;
      }
      return r;
    });
  }
  return normalized;
}

function normalizeSequentialProposalError(existingErrorType, existingError, rawStatus) {
  if (existingErrorType === 'proposal_sequential_session_not_found') {
    return {
      error_type: existingErrorType,
      error: PROPOSAL_SEQUENTIAL_SESSION_NOT_FOUND_ERROR,
    };
  }

  if (existingErrorType === 'proposal_request_not_acknowledged') {
    return {
      error_type: existingErrorType,
      error: PROPOSAL_REQUEST_UNCLAIMED_ERROR,
    };
  }

  if (existingErrorType === 'proposal_selection_not_found') {
    return {
      error_type: existingErrorType,
      error: PROPOSAL_SELECTION_NOT_FOUND_ERROR,
    };
  }

  if (existingErrorType === 'proposal_internal_error') {
    return {
      error_type: existingErrorType,
      error: PROPOSAL_INTERNAL_ERROR,
    };
  }

  if (existingError === PROPOSAL_SEQUENTIAL_SESSION_NOT_FOUND_ERROR) {
    return {
      error_type: 'proposal_sequential_session_not_found',
      error: PROPOSAL_SEQUENTIAL_SESSION_NOT_FOUND_ERROR,
    };
  }

  if (existingError === PROPOSAL_REQUEST_UNCLAIMED_ERROR) {
    return {
      error_type: 'proposal_request_not_acknowledged',
      error: PROPOSAL_REQUEST_UNCLAIMED_ERROR,
    };
  }

  if (existingError === PROPOSAL_SELECTION_NOT_FOUND_ERROR) {
    return {
      error_type: 'proposal_selection_not_found',
      error: PROPOSAL_SELECTION_NOT_FOUND_ERROR,
    };
  }

  if (rawStatus === 'timeout') {
    return {
      error_type: 'proposal_internal_error',
      error: PROPOSAL_INTERNAL_ERROR,
    };
  }

  return {
    error_type: 'proposal_internal_error',
    error: PROPOSAL_INTERNAL_ERROR,
  };
}

function normalizeSingleProposalError(existingErrorType, existingError, rawStatus) {
  if (existingErrorType === 'proposal_session_not_found') {
    return {
      error_type: existingErrorType,
      error: PROPOSAL_SESSION_NOT_FOUND_ERROR,
    };
  }

  if (existingErrorType === 'proposal_request_not_acknowledged') {
    return {
      error_type: existingErrorType,
      error: PROPOSAL_REQUEST_UNCLAIMED_ERROR,
    };
  }

  if (existingErrorType === 'proposal_selection_not_found') {
    return {
      error_type: existingErrorType,
      error: PROPOSAL_SELECTION_NOT_FOUND_ERROR,
    };
  }

  if (existingErrorType === 'proposal_internal_error') {
    return {
      error_type: existingErrorType,
      error: PROPOSAL_INTERNAL_ERROR,
    };
  }

  if (existingError === PROPOSAL_REQUEST_UNCLAIMED_ERROR) {
    return {
      error_type: 'proposal_request_not_acknowledged',
      error: PROPOSAL_REQUEST_UNCLAIMED_ERROR,
    };
  }

  if (existingError === PROPOSAL_SESSION_NOT_FOUND_ERROR) {
    return {
      error_type: 'proposal_session_not_found',
      error: PROPOSAL_SESSION_NOT_FOUND_ERROR,
    };
  }

  if (existingError === PROPOSAL_SELECTION_NOT_FOUND_ERROR) {
    return {
      error_type: 'proposal_selection_not_found',
      error: PROPOSAL_SELECTION_NOT_FOUND_ERROR,
    };
  }

  if (rawStatus === 'timeout') {
    return {
      error_type: 'proposal_internal_error',
      error: PROPOSAL_INTERNAL_ERROR,
    };
  }

  return {
    error_type: 'proposal_internal_error',
    error: PROPOSAL_INTERNAL_ERROR,
  };
}

function normalizeForMatching(markdown) {
  return markdown.replace(/\r\n/g, '\n').replace(/\u00a0/g, ' ');
}

function readSelectionMetadata() {
  try {
    return readSelectionForActiveInstance();
  } catch {
    return null;
  }
}

function proposalMatchesSelection(selection, proposal) {
  if (!selection || typeof selection !== 'object') {
    return false;
  }

  // Support both legacy 'selected' field and new 'selection' field in temp file
  const selectionText = selection.selection ?? selection.selected ?? null;
  if (selectionText !== proposal.selection) {
    return false;
  }

  return (
    (selection.context_before ?? null) === (proposal.context_before ?? null) &&
    (selection.context_after ?? null) === (proposal.context_after ?? null)
  );
}

function buildSelectionRoutingMetadata(selectionMetadata, selection, file) {
  if (proposalMatchesSelection(selectionMetadata, selection)) {
    return {
      file: selectionMetadata.file ?? file ?? null,
      instance_id: selectionMetadata.instance_id ?? null,
      source_instance_id: selectionMetadata.instance_id ?? null,
    };
  }
  return { file: file ?? null };
}

function normalizeSelectionRevealResult(result, fallbackFile) {
  if (!result || typeof result !== 'object') {
    return result;
  }

  const normalized = { ...result };
  if (!normalized.file && fallbackFile) {
    normalized.file = fallbackFile;
  }

  const selectionRequestId = getSelectionRevealRequestId(normalized);
  if (selectionRequestId && !normalized.selection_request_id) {
    normalized.selection_request_id = selectionRequestId;
  }

  if (normalized.status !== 'error') {
    return normalized;
  }

  const rawError = String(normalized.error ?? '');
  if (
    rawError === 'Could not resolve the requested selection in the active editor.' ||
    rawError === SELECTION_NOT_FOUND_ERROR
  ) {
    normalized.error = SELECTION_NOT_FOUND_ERROR;
    return normalized;
  }

  if (
    rawError === 'No matching Markdown for Humans editor is open.' ||
    rawError === 'Markdown for Humans did not accept the reveal request message.' ||
    rawError.startsWith('Failed to deliver reveal request to the Markdown for Humans webview:')
  ) {
    normalized.error = SELECTION_INTERNAL_ERROR;
    return normalized;
  }

  return normalized;
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

function hasProposalBeenClaimed(proposalId) {
  const pendingRequest = readJsonFile(PROPOSAL_TEMP_FILE);
  if (!pendingRequest) {
    return true;
  }

  return pendingRequest.id !== proposalId;
}

function hasSelectionRevealBeenClaimed(selectionRequestId) {
  const pendingRequest = readJsonFile(SELECTION_REVEAL_TEMP_FILE);
  if (!pendingRequest) {
    return true;
  }

  return getSelectionRevealRequestId(pendingRequest) !== selectionRequestId;
}

function readProposalState(id) {
  return readProposalStateFromAnyInstance(id);
}

function isFinalProposalState(state) {
  return Boolean(state) && state.status !== 'pending' && state.status !== 'ready';
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
      const originalProposedReplacement = batch.proposed_replacements[i];

      if (!currentResult || currentResult.status !== 'accept' || !currentResult.replacement) {
        updatedResults.push(currentResult);
        continue;
      }

      const applied = applyProposalReplacement(workingContent, {
        original: currentResult.original || originalProposedReplacement?.original,
        replacement: currentResult.replacement,
        context_before: currentResult.context_before ?? originalProposedReplacement?.context_before ?? null,
        context_after: currentResult.context_after ?? originalProposedReplacement?.context_after ?? null,
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
  const { responseKind, timeoutResult } = options;

  return new Promise((resolve) => {
    let watcher;
    let resolved = false;
    let iv;

    const finish = (value) => {
      if (resolved) return;
      resolved = true;
      try { watcher?.close(); } catch {}
      try { clearInterval(iv); } catch {}
      resolve(value);
    };

    const deadline = setTimeout(() => {
      finish(timeoutResult);
    }, timeoutMs);

    const check = () => {
      try {
        const data = findResponseById(id, responseKind);
        if (!data) return;
        clearTimeout(deadline);
        finish(data);
      } catch {}
    };

    iv = setInterval(() => {
      if (resolved) return;
      check();
    }, MCP_RESPONSE_POLL_MS);

    try {
      watcher = fs.watch(os.tmpdir(), (_event, filename) => {
        if (filename && filename.startsWith(INSTANCE_TEMP_DIR_PREFIX)) check();
      });
    } catch {
      // Polling is already active above.
    }

    check(); // Check immediately in case file already exists
  });
}

function waitForSelectionRevealClaim(selectionRequestId, timeoutMs) {
  return new Promise((resolve) => {
    let watcher;
    let resolved = false;
    let iv;

    const finish = (value) => {
      if (resolved) return;
      resolved = true;
      try { watcher?.close(); } catch {}
      try { clearInterval(iv); } catch {}
      resolve(value);
    };

    const deadline = setTimeout(() => {
      finish(false);
    }, timeoutMs);

    const check = () => {
      if (!hasSelectionRevealBeenClaimed(selectionRequestId)) {
        return;
      }
      clearTimeout(deadline);
      finish(true);
    };

    iv = setInterval(() => {
      if (resolved) return;
      check();
    }, 25);

    try {
      watcher = fs.watch(path.dirname(SELECTION_REVEAL_TEMP_FILE), (_event, filename) => {
        if (!filename || filename.includes('SelectionReveal')) {
          check();
        }
      });
    } catch {
      // Polling is already active above.
    }

    check();
  });
}

function waitForProposalClaim(proposalId, timeoutMs) {
  return new Promise((resolve) => {
    let watcher;
    let resolved = false;
    let iv;

    const finish = (value) => {
      if (resolved) return;
      resolved = true;
      try { watcher?.close(); } catch {}
      try { clearInterval(iv); } catch {}
      resolve(value);
    };

    const deadline = setTimeout(() => {
      finish(false);
    }, timeoutMs);

    const check = () => {
      if (!hasProposalBeenClaimed(proposalId)) {
        return;
      }
      clearTimeout(deadline);
      finish(true);
    };

    iv = setInterval(() => {
      if (resolved) return;
      check();
    }, 25);

    try {
      watcher = fs.watch(path.dirname(PROPOSAL_TEMP_FILE), (_event, filename) => {
        if (!filename || filename.includes('Proposal')) {
          check();
        }
      });
    } catch {
      // Polling is already active above.
    }

    check();
  });
}

function waitForProposalStartup(id, timeoutMs) {
  return new Promise((resolve) => {
    let watcher;
    let resolved = false;
    let iv;

    const finish = (value) => {
      if (resolved) return;
      resolved = true;
      try { watcher?.close(); } catch {}
      try { clearInterval(iv); } catch {}
      resolve(value);
    };

    const deadline = setTimeout(() => {
      finish({ type: 'timeout' });
    }, timeoutMs);

    const check = () => {
      const response = findResponseById(id, 'proposal');
      if (response) {
        clearTimeout(deadline);
        finish({ type: 'response', value: response });
        return;
      }

      const state = readProposalState(id);
      if (!state) {
        return;
      }

      if (state.status === 'error') {
        clearTimeout(deadline);
        finish({ type: 'error', value: state });
        return;
      }

      if (state.status === 'ready') {
        clearTimeout(deadline);
        finish({ type: 'ready' });
      }
    };

    iv = setInterval(() => {
      if (resolved) return;
      check();
    }, MCP_RESPONSE_POLL_MS);

    try {
      watcher = fs.watch(os.tmpdir(), (_event, filename) => {
        if (
          !filename ||
          filename.startsWith(INSTANCE_TEMP_DIR_PREFIX) ||
          filename.includes('Proposal')
        ) {
          check();
        }
      });
    } catch {
      // Polling is already active above.
    }

    check();
  });
}

function waitForSingleProposalResumeState(propose_single_replacement_session_id, timeoutMs) {
  return new Promise((resolve) => {
    let watcher;
    let resolved = false;
    let iv;

    const finish = (value) => {
      if (resolved) return;
      resolved = true;
      try { watcher?.close(); } catch {}
      try { clearInterval(iv); } catch {}
      resolve(value);
    };

    const deadline = setTimeout(() => {
      finish(null);
    }, timeoutMs);

    const check = () => {
      const state = readProposalState(propose_single_replacement_session_id);
      if (!state) {
        return;
      }
      clearTimeout(deadline);
      finish(state);
    };

    iv = setInterval(() => {
      if (resolved) return;
      check();
    }, 25);

    try {
      watcher = fs.watch(os.tmpdir(), (_event, filename) => {
        if (filename && filename.startsWith(INSTANCE_TEMP_DIR_PREFIX)) {
          check();
        }
      });
    } catch {
      // Polling is already active above.
    }

    check();
  });
}

function waitForSequentialProposalResumeState(propose_sequential_replacements_session_id, timeoutMs) {
  return new Promise((resolve) => {
    let watcher;
    let resolved = false;
    let iv;

    const finish = (value) => {
      if (resolved) return;
      resolved = true;
      try { watcher?.close(); } catch {}
      try { clearInterval(iv); } catch {}
      resolve(value);
    };

    const deadline = setTimeout(() => {
      finish(null);
    }, timeoutMs);

    const check = () => {
      const state = readProposalState(propose_sequential_replacements_session_id);
      if (!state) {
        return;
      }
      clearTimeout(deadline);
      finish(state);
    };

    iv = setInterval(() => {
      if (resolved) return;
      check();
    }, 25);

    try {
      watcher = fs.watch(os.tmpdir(), (_event, filename) => {
        if (filename && filename.startsWith(INSTANCE_TEMP_DIR_PREFIX)) {
          check();
        }
      });
    } catch {
      // Polling is already active above.
    }

    check();
  });
}

const transport = new StdioServerTransport();
server.connect(transport).catch(err => {
  console.error('[MD4H MCP] Failed to start:', err);
  process.exit(1);
});
