# Markdown for Humans  -  MCP Tool Reference for AI Agents

Copy this file to your project as `CLAUDE.md` (for Claude Code), `AGENTS.md` (for Cursor/Codex), or any system prompt your agent reads at startup.

## Markdown for Humans Editor (VS Code Extension)

The Markdown for Humans VS Code extension exposes 7 MCP tools (server: `markdown-for-humans`).

### Routing: how the extension knows which file and editor to target

When the user selects text in a Markdown for Humans editor, the extension writes per-instance temp metadata containing `file`, `instance_id`, `selection`, `context_before`, and `context_after`. It also keeps per-file selection state for open Markdown for Humans files within that instance. `get_active_selection` reads the active Markdown for Humans tab only. `get_selections_for_file` can look up the last saved selection metadata for a specific open file when the caller names that file explicitly. Passing `file` and context parameters explicitly improves routing accuracy when the user may have moved focus since the last selection lookup.

Selection-reveal temp requests use `selection_request_id` as the correlation id and `instance_id` as the routing hint for the expected Markdown for Humans instance.

Do not treat selection temp metadata as proof that the referenced file is still open in Markdown for Humans. It is a routing hint only. `get_active_selection` tells you about the currently active tab. `get_selections_for_file` can return the last saved selection for a specific open MFH file even when that tab is inactive. Before using the `file` from `get_active_selection` or `get_selections_for_file` to drive `scroll_to_selection` or proposal tools, verify that the intended file is currently open in Markdown for Humans, or pass the exact target `file` explicitly from the document you are editing.

### When to call `get_active_selection`

**`get_active_selection` is not required before calling the proposal tools.** Call it only when the user refers to something they have highlighted ("this", "here", "what I selected"). When the agent already knows the text to change  -  from reading the file, from conversation context, or from its own analysis  -  pass `selection` directly to `propose_single_replacement` or `propose_sequential_replacements` without calling `get_active_selection` first. The extension will automatically scroll to and highlight the target passage in the editor.

---

## get_active_selection

Call this when the user refers to selected text, "this", "here", or similar references suggesting they have something highlighted in the active editor. This reflects the active MFH tab only. Do **not** call this as a routine prerequisite before proposing changes  -  if you already know the text to change, pass it directly to `propose_single_replacement` or `propose_sequential_replacements`.

**Parameters:** none

**Returns** a JSON string with:
- `file`: absolute path to the markdown file
- `selection`: the selected text as markdown (`null` if nothing selected)
- `context_before`: up to 500 characters before the selection
- `context_after`: up to 500 characters after the selection
- `headings_before`: up to 5 headings preceding the selection, closest first
- `instance_id`: internal editor instance identifier

---

## get_selections_for_file

Call this only when you explicitly want the current Markdown for Humans selection state for a named markdown file. Returns results across all instances where that file is open.

**Parameters:**
- `file` (required): absolute path to the markdown file

**Returns** a JSON array. Each element corresponds to one open instance and contains:
- `file`: absolute path to the markdown file
- `selection`: the selected text as markdown (`null` if nothing selected in that instance)
- `context_before`: up to 500 characters before the selection (`null` if nothing selected)
- `context_after`: up to 500 characters after the selection (`null` if nothing selected)
- `headings_before`: up to 5 headings preceding the selection, closest first
- `instance_id`: internal editor instance identifier

Returns `[]` if the file is not open in any Markdown for Humans instance. Returns immediately. Never hangs.

---

## scroll_to_selection

Scrolls the WYSIWYG editor to a specific passage and selects it. Use when the agent has identified a passage and the user wants to see it highlighted in the editor.

Note: it is typically the case that calling `scroll_to_selection` immediately after `get_active_selection` serves no useful purpose. Only do so if the selection is known or suspected to be scrolled out of view.

**Parameters:**
- `selection` (required): the exact text to reveal
- `file` (optional): absolute path to the file (`file` from `get_active_selection` or `get_selections_for_file`)
- `context_before` (optional): text immediately before the selection
- `context_after` (optional): text immediately after the selection
- `headings_before` (optional): up to 5 headings preceding the selection, closest first (`headings_before` from `get_active_selection` or `get_selections_for_file`)

**Returns** `{ status, file, error }` where status is `"revealed"` or `"error"`.

When `status` is `"error"`, the error text is user-facing. The main cases are:
- no instance acknowledged the selection request within 500ms
- the file is open in Markdown for Humans, but the requested selection could not be found
- the file is open in Markdown for Humans, but the selection could not be completed in time or hit an internal extension error

---

## propose_single_replacement

Opens a WYSIWYG popup panel showing the original and up to 3 alternative replacements. The extension automatically scrolls the main editor to the target passage when the panel opens  -  you do not need to call `get_active_selection` or `scroll_to_selection` first. The user reviews each option (which has its own editable pane and Accept button), with the shared redline at top updating to reflect the focused option. Each option may have an optional justification panel.

**Parameters:**
- `selection` (required): the exact text to replace
- `file` (optional): absolute path to the file
- `context_before` (optional): text immediately before the selection
- `context_after` (optional): text immediately after the selection
- `headings_before` (optional): up to 5 headings preceding the selection, closest first
- `replacement_options` (required): ordered array of 1-3 replacement alternatives (extras beyond 3 are ignored). These arguments come after the same selection-location arguments used by `scroll_to_selection`. Each item:
  - `selection_replacement` (required): the proposed replacement markdown text
  - `justification` (optional): markdown string explaining the reasoning. When supplied, displayed as a justification panel above that option's editor.

**Returns** `{ status, message, error_type, error, propose_single_replacement_session_id, selection, selection_replacement, selected_option_index, context_before, context_after, headings_before, file }` where status is one of:
- `"applied"`: the change was written to the file  -  treat this as authoritative success
- `"accepted_unchanged_but_not_applied"`: the user accepted the proposed replacement unchanged, but it was not applied to the file
- `"accepted_changed_but_not_applied"`: the user changed a proposed replacement and accepted that edited version, but it was not applied to the file
- `"skipped"`: user declined (Skip This / Skip These)
- `"rejected"`: user rejected the proposal, indicating no change is wanted (Reject This / Reject These)
- `"in_progress"`: review panel is still open  -  resume with `resume_single_replacement`
- `"error"`: workflow failed

`selected_option_index` (0-based) indicates which alternative the user accepted. `selection_replacement` contains the final accepted text (possibly edited by user).

Treat the edit as successful **only** when status is `"applied"`.

When status is `"in_progress"`:
- Tell the user the review is still open in Markdown for Humans
- Ask them to finish editing there and then type `resume` in the conversation
- When they return, call `resume_single_replacement` with the returned `propose_single_replacement_session_id`

When status is not `"applied"` or `"in_progress"`:
- Tell the user the proposed change was not confirmed as applied
- If appropriate, call `get_active_selection` again before retrying

When `status` is `"error"`:
- Inspect `error_type` programmatically
- Show or summarize the user-facing explanation from `error`
- The main cases are:
  - `proposal_request_not_acknowledged`
  - `proposal_selection_not_found`
  - `proposal_internal_error`

---

## resume_single_replacement

Use after `propose_single_replacement` returned `"in_progress"` and the user says they are done editing.

**Parameters:**
- `propose_single_replacement_session_id` (required): the `propose_single_replacement_session_id` from the `in_progress` response

**Returns:** same fields as `propose_single_replacement`

This does not open a new review or wait for a long background process. It checks the current state of the existing review immediately and returns:
- the final result, if the review has finished
- `"in_progress"` if the review is still open
- `"error"` with `error_type: "proposal_session_not_found"` if no open review matches the provided `propose_single_replacement_session_id` within 500ms

---

## propose_sequential_replacements

Proposes multiple replacements for the same file in one uninterrupted review flow. No prior `get_active_selection` call is needed  -  the extension automatically scrolls the main editor to each target passage as its proposal panel opens. The user reviews each proposal in order without returning to the conversation between steps. Each step supports up to 3 alternative options.

**Parameters:**
- `file` (optional): absolute path to the markdown file (recommended when available)
- `proposed_replacements` (required): ordered array of proposed replacement objects, each with:
  - `selection` (required): the exact text to replace for this step
  - `context_before` (optional): text immediately before this selection
  - `context_after` (optional): text immediately after this selection
  - `headings_before` (optional): up to 5 headings preceding this selection, closest first
  - `replacement_options` (required): ordered array of 1-3 replacement alternatives (extras beyond 3 are ignored). These come after the same selection-location arguments used by `scroll_to_selection`. Each item:
    - `selection_replacement` (required): the proposed replacement markdown text
    - `justification` (optional): markdown string explaining the reasoning for this option. When supplied, displayed above that option's editor.

**Returns** `{ status, message, error_type, error, propose_sequential_replacements_session_id, file, results }` where:
- `status` is `"completed"`, `"in_progress"`, or `"error"`
- `propose_sequential_replacements_session_id` is present when status is `"in_progress"`  -  pass it to `resume_sequential_replacements`
- `results` is an ordered array; each item has the same fields as a `propose_single_replacement` return value (including `selected_option_index`, per-step `"applied"`, `"accepted_unchanged_but_not_applied"`, `"accepted_changed_but_not_applied"`, `"skipped"`, `"rejected"`, etc.). If the user clicks "Skip Remaining", the current and all remaining unreviewed steps are marked `"skipped"` and the overall status is `"completed"`.

Treat a step as successful only when that step's status is `"applied"`.

When status is `"in_progress"`, resume with `resume_sequential_replacements`.

When `status` is `"error"`:
- Inspect `error_type` programmatically
- Show or summarize the user-facing explanation from `error`
- The main cases are:
  - `proposal_request_not_acknowledged`
  - `proposal_selection_not_found`
  - `proposal_internal_error`
  - `proposal_sequential_session_not_found`

Example call shape:
```json
{
  "file": "C:\docs\guide.md",
  "proposed_replacements": [
    {
      "selection": "Old introduction sentence.",
      "replacement_options": [
        { "selection_replacement": "Clearer introduction sentence.", "justification": "More direct opening." },
        { "selection_replacement": "A concise opening sentence." }
      ],
      "context_after": "\n\n## Overview"
    },
    {
      "selection": "- vague bullet",
      "replacement_options": [{ "selection_replacement": "- specific bullet" }],
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
- `propose_sequential_replacements_session_id` (required): the `propose_sequential_replacements_session_id` from the `in_progress` response

**Returns:** same fields as `propose_sequential_replacements`

This does not open a new review or wait for a long background process. It checks the current state of the existing review immediately and returns:
- the final result, if the review has finished
- `"in_progress"` if the review is still open
- `"error"` with `error_type: "proposal_sequential_session_not_found"` if no open review matches the provided `propose_sequential_replacements_session_id` within 500ms
