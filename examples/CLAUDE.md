# Markdown for Humans — MCP Tool Reference for AI Agents

Copy this file to your project as `CLAUDE.md` (for Claude Code), `AGENTS.md` (for Cursor/Codex), or any system prompt your agent reads at startup.

## Markdown for Humans Editor (VS Code Extension)

The Markdown for Humans VS Code extension exposes 6 MCP tools (server: `markdown-for-humans`).

### Routing: how the extension knows which file and editor to target

When the user selects text in a Markdown for Humans editor, the extension writes a temp file containing `file`, `instance_id`, `selection`, `context_before`, and `context_after`. When the agent calls a tool, the MCP server reads that temp file and automatically routes the request to the correct editor instance. Passing `file` and context parameters explicitly improves routing accuracy when the user may have moved focus since the last `get_selection` call.

---

## get_selection

Call this when the user refers to selected text, "this", "here", or similar references suggesting they have something highlighted in the editor.

**Parameters:** none

**Returns** a JSON string with:
- `file`: absolute path to the markdown file
- `selection`: the selected text as markdown (`null` if nothing selected)
- `context_before`: up to 500 characters before the selection
- `context_after`: up to 500 characters after the selection
- `headings_before`: up to 5 headings preceding the selection, closest first
- `instance_id`: internal editor instance identifier

---

## scroll_to_selection

Scrolls the WYSIWYG editor to a specific passage and selects it. Use when the agent has identified a passage and the user wants to see it highlighted in the editor.

Do not use `scroll_to_selection` as a routine immediate follow-up to `get_selection` — if the user is already selecting text, that selection is already visible.

**Parameters:**
- `selection` (required): the exact text to reveal
- `file` (optional): absolute path to the file (`file` from `get_selection`)
- `context_before` (optional): text immediately before the selection
- `context_after` (optional): text immediately after the selection
- `headings_before` (optional): up to 5 headings preceding the selection, closest first (`headings_before` from `get_selection`)

**Returns** `{ status, file }` where status is `"revealed"`, `"timeout"`, or `"error"`.

---

## propose_single_replacement

Opens a WYSIWYG popup panel showing the original and proposed text side by side. The user can Accept, Edit, or Skip.

**Parameters:**
- `selection` (required): the exact text to replace (`selection` from `get_selection`)
- `replacement` (required): the proposed replacement markdown text
- `file` (optional): absolute path to the file (`file` from `get_selection`)
- `context_before` (optional): text immediately before the selection
- `context_after` (optional): text immediately after the selection
- `headings_before` (optional): up to 5 headings preceding the selection, closest first (`headings_before` from `get_selection`)
- `justification` (optional): markdown string explaining the reasoning behind the proposed change. When supplied, displayed as a third panel between the redline and editing panels.

**Returns** `{ status, session_id, selection, replacement, context_before, context_after, file, applied_by, fallback_error, error }` where status is one of:
- `"applied"`: the change was written to the file — treat this as authoritative success
- `"accepted_unchanged"`: user accepted without editing the proposed replacement
- `"accepted_changed"`: user accepted after editing the proposed replacement
- `"skipped"`: user declined
- `"in_progress"`: review panel is still open — resume with `resume_single_replacement`
- `"timeout"`: no response within 10 minutes
- `"error"`: workflow failed

Treat the edit as successful **only** when status is `"applied"`.

When status is `"in_progress"`:
- Tell the user the review is still open in Markdown for Humans
- Ask them to finish editing there and then say `resume`
- When they return, call `resume_single_replacement` with the returned `session_id`

When status is not `"applied"` or `"in_progress"`:
- Tell the user the proposed change was not confirmed as applied
- If appropriate, call `get_selection` again before retrying

---

## resume_single_replacement

Use after `propose_single_replacement` returned `"in_progress"` and the user says they are done editing.

**Parameters:**
- `session_id` (required): the `session_id` from the `in_progress` response

**Returns:** same fields as `propose_single_replacement`

---

## propose_sequential_replacements

Proposes multiple replacements for the same file in one uninterrupted review flow. The user reviews each proposal in order without returning to the conversation between steps.

**Parameters:**
- `file` (optional): absolute path to the markdown file (recommended when available)
- `changes` (required): ordered array of change objects, each with:
  - `selection` (required): the exact text to replace for this step
  - `replacement` (required): the proposed replacement markdown text
  - `context_before` (optional): text immediately before this selection
  - `context_after` (optional): text immediately after this selection
  - `headings_before` (optional): up to 5 headings preceding this selection, closest first
  - `justification` (optional): markdown string explaining the reasoning behind this proposed change. When supplied, displayed between the redline and editing panels.

**Returns** `{ status, session_id, file, results }` where:
- `status` is `"completed"`, `"in_progress"`, `"timeout"`, or `"error"`
- `session_id` is present when status is `"in_progress"` — pass it to `resume_sequential_replacements`
- `results` is an ordered array; each item has the same fields as a `propose_single_replacement` return value (including per-step `"applied"`, `"accepted_unchanged"`, `"accepted_changed"`, `"skipped"`, etc.)

Treat a step as successful only when that step's status is `"applied"`.

When status is `"in_progress"`, resume with `resume_sequential_replacements`.

Example call shape:
```json
{
  "file": "C:\docs\guide.md",
  "changes": [
    {
      "selection": "Old introduction sentence.",
      "replacement": "Clearer introduction sentence.",
      "context_after": "\n\n## Overview"
    },
    {
      "selection": "- vague bullet",
      "replacement": "- specific bullet",
      "context_before": "## Overview\n\n",
      "context_after": "\n- second bullet"
    }
  ]
}
```

---

## resume_sequential_replacements

Use after `propose_sequential_replacements` returned `"in_progress"` and the user says they are done editing.

**Parameters:**
- `session_id` (required): the `session_id` from the `in_progress` response

**Returns:** same fields as `propose_sequential_replacements`
