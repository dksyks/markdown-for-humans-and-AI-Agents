# Markdown for Humans — MCP Tool Reference for AI Agents

Copy this file to your project as `CLAUDE.md` (for Claude Code), `AGENTS.md` (for Cursor/Codex), or any system prompt your agent reads at startup.

## Markdown for Humans Editor (VS Code Extension)

The Markdown for Humans VS Code extension exposes 8 MCP tools (server: `markdown-for-humans`).

### Routing: how the extension knows which file and editor to target

When the user selects text in a Markdown for Humans editor, the extension writes per-instance temp metadata containing `file`, `instance_id`, `selection`, `context_before`, and `context_after`. It also keeps per-file selection state for open Markdown for Humans files within that instance. `get_active_selection` reads the active Markdown for Humans tab only. `get_selection_for_file` can look up the last saved selection metadata for a specific open file when the caller names that file explicitly. Passing `file` and context parameters explicitly improves routing accuracy when the user may have moved focus since the last selection lookup.

Do not treat selection temp metadata as proof that the referenced file is still open in Markdown for Humans. It is a routing hint only. `get_active_selection` tells you about the currently active tab. `get_selection_for_file` can return the last saved selection for a specific open MFH file even when that tab is inactive. Before using the `file` from `get_active_selection`, `get_selection_for_file`, or `get_selection` to drive `scroll_to_selection` or proposal tools, verify that the intended file is currently open in Markdown for Humans, or pass the exact target `file` explicitly from the document you are editing.

### When to call `get_active_selection`

**`get_active_selection` is not required before calling the proposal tools.** Call it only when the user refers to something they have highlighted ("this", "here", "what I selected"). When the agent already knows the text to change — from reading the file, from conversation context, or from its own analysis — pass `selection` directly to `propose_single_replacement` or `propose_sequential_replacements` without calling `get_active_selection` first. The extension will automatically scroll to and highlight the target passage in the editor.

---

## get_active_selection

Call this when the user refers to selected text, "this", "here", or similar references suggesting they have something highlighted in the active editor. This reflects the active MFH tab only. Do **not** call this as a routine prerequisite before proposing changes — if you already know the text to change, pass it directly to `propose_single_replacement` or `propose_sequential_replacements`.

**Parameters:** none

**Returns** a JSON string with:
- `file`: absolute path to the markdown file
- `selection`: the selected text as markdown (`null` if nothing selected)
- `context_before`: up to 500 characters before the selection
- `context_after`: up to 500 characters after the selection
- `headings_before`: up to 5 headings preceding the selection, closest first
- `instance_id`: internal editor instance identifier

---

## get_selection_for_file

Call this only when you explicitly want the current Markdown for Humans selection state for a named markdown file. This can return the last saved selection for a specific open MFH file even if that tab is currently inactive. It does not search other files unless you provide the target `file`.

**Parameters:**
- `file` (required): absolute path to the markdown file

**Returns** a JSON string with:
- `file`: absolute path to the markdown file
- `selection`: the selected text as markdown (`null` if nothing selected)
- `context_before`: up to 500 characters before the selection
- `context_after`: up to 500 characters after the selection
- `headings_before`: up to 5 headings preceding the selection, closest first
- `instance_id`: internal editor instance identifier

---

## get_selection

Backward-compatible alias for `get_active_selection`.

---

## scroll_to_selection

Scrolls the WYSIWYG editor to a specific passage and selects it. Use when the agent has identified a passage and the user wants to see it highlighted in the editor.

Do not use `scroll_to_selection` as a routine immediate follow-up to `get_active_selection` — if the user is already selecting text, that selection is already visible.

**Parameters:**
- `selection` (required): the exact text to reveal
- `file` (optional): absolute path to the file (`file` from `get_active_selection` or `get_selection_for_file`)
- `context_before` (optional): text immediately before the selection
- `context_after` (optional): text immediately after the selection
- `headings_before` (optional): up to 5 headings preceding the selection, closest first (`headings_before` from `get_active_selection` or `get_selection_for_file`)

**Returns** `{ status, file }` where status is `"revealed"`, `"timeout"`, or `"error"`.

---

## propose_single_replacement

Opens a WYSIWYG popup panel showing the original and up to 3 alternative replacements. The extension automatically scrolls the main editor to the target passage when the panel opens — you do not need to call `get_active_selection` or `scroll_to_selection` first. The user reviews each option (which has its own editable pane and Accept button), with the shared redline at top updating to reflect the focused option. Each option may have an optional justification panel.

**Parameters:**
- `selection` (required): the exact text to replace (`selection` from `get_active_selection` or `get_selection_for_file`)
- `options` (required): ordered array of 1–3 replacement alternatives (extras beyond 3 are ignored). Each item:
  - `replacement` (required): the proposed replacement markdown text
  - `justification` (optional): markdown string explaining the reasoning. When supplied, displayed as a collapsible panel above that option's editor.
- `file` (optional): absolute path to the file (`file` from `get_active_selection` or `get_selection_for_file`)
- `context_before` (optional): text immediately before the selection
- `context_after` (optional): text immediately after the selection
- `headings_before` (optional): up to 5 headings preceding the selection, closest first (`headings_before` from `get_active_selection` or `get_selection_for_file`)

**Returns** `{ status, session_id, selection, replacement, selected_option_index, context_before, context_after, file, applied_by, fallback_error, error }` where status is one of:
- `"applied"`: the change was written to the file — treat this as authoritative success
- `"accepted_unchanged"`: user accepted without editing the proposed replacement
- `"accepted_changed"`: user accepted after editing the proposed replacement
- `"skipped"`: user declined (Skip All)
- `"in_progress"`: review panel is still open — resume with `resume_single_replacement`
- `"timeout"`: no response within 10 minutes
- `"error"`: workflow failed

`selected_option_index` (0-based) indicates which alternative the user accepted. `replacement` contains the final accepted text (possibly edited by user).

Treat the edit as successful **only** when status is `"applied"`.

When status is `"in_progress"`:
- Tell the user the review is still open in Markdown for Humans
- Ask them to finish editing there and then say `resume`
- When they return, call `resume_single_replacement` with the returned `session_id`

When status is not `"applied"` or `"in_progress"`:
- Tell the user the proposed change was not confirmed as applied
- If appropriate, call `get_active_selection` again before retrying

---

## resume_single_replacement

Use after `propose_single_replacement` returned `"in_progress"` and the user says they are done editing.

**Parameters:**
- `session_id` (required): the `session_id` from the `in_progress` response

**Returns:** same fields as `propose_single_replacement`

---

## propose_sequential_replacements

Proposes multiple replacements for the same file in one uninterrupted review flow. No prior `get_active_selection` call is needed — the extension automatically scrolls the main editor to each target passage as its proposal panel opens. The user reviews each proposal in order without returning to the conversation between steps. Each step supports up to 3 alternative options.

**Parameters:**
- `file` (optional): absolute path to the markdown file (recommended when available)
- `changes` (required): ordered array of change objects, each with:
  - `selection` (required): the exact text to replace for this step
  - `options` (required): ordered array of 1–3 replacement alternatives (extras beyond 3 are ignored). Each item:
    - `replacement` (required): the proposed replacement markdown text
    - `justification` (optional): markdown string explaining the reasoning for this option. When supplied, displayed as a collapsible panel above that option's editor.
  - `context_before` (optional): text immediately before this selection
  - `context_after` (optional): text immediately after this selection
  - `headings_before` (optional): up to 5 headings preceding this selection, closest first

**Returns** `{ status, session_id, file, results }` where:
- `status` is `"completed"`, `"in_progress"`, `"timeout"`, or `"error"`
- `session_id` is present when status is `"in_progress"` — pass it to `resume_sequential_replacements`
- `results` is an ordered array; each item has the same fields as a `propose_single_replacement` return value (including `selected_option_index`, per-step `"applied"`, `"accepted_unchanged"`, `"accepted_changed"`, `"skipped"`, etc.)

Treat a step as successful only when that step's status is `"applied"`.

When status is `"in_progress"`, resume with `resume_sequential_replacements`.

Example call shape:
```json
{
  "file": "C:\docs\guide.md",
  "changes": [
    {
      "selection": "Old introduction sentence.",
      "options": [
        { "replacement": "Clearer introduction sentence.", "justification": "More direct opening." },
        { "replacement": "A concise opening sentence." }
      ],
      "context_after": "\n\n## Overview"
    },
    {
      "selection": "- vague bullet",
      "options": [{ "replacement": "- specific bullet" }],
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
