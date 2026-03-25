# Instructions for AI Agents

> **Project:** VS Code WYSIWYG Markdown Editor (medium.com-style reading/writing experience)
>
> **Status:** MVP ~85% complete | **Core value:** Write markdown naturally - focus on content, not syntax
>
> **Source of Truth (order):** Code + tests -> plan file (`roadmap/pipeline/*.md` or `roadmap/shipped/*.md`) -> these instructions. Prefer source over docs when in doubt.

**Start here (quick boot-up):**
1) Open the current task file in `roadmap/pipeline/` and skim sections 2-4.  
2) Read `vibe-coding-rules/env-context.md` for architecture/perf budgets.  
3) Scan the code/tests referenced in the task with `rg` before writing anything.

---

## Critical Constraints

### 1. Reading Experience is PARAMOUNT
- Typography and readability > feature completeness
- Serif body text (prose, not code)
- Generous spacing (white space is a feature)
- **Test every change by reading a 3000+ word doc for 10+ minutes**

### 2. Test-Driven Development (MANDATORY)
**RED -> GREEN -> REFACTOR -> VERIFY**

- Write failing tests BEFORE implementation
- A plan is only "done" when ALL tests pass (new + existing)
- Document tests in the plan file or test files
- See: [vibe-coding-rules/testing.md](vibe-coding-rules/testing.md)

### 3. Performance Budgets
- <500ms editor initialization
- <16ms typing latency (keystrokes)
- <50ms other interactions (cursor, formatting)
- <300ms menu/toolbar actions
- Handle 10,000+ line documents smoothly

### 4. VS Code Integration
- Deep Git integration (diffs, commits work correctly)
- Command palette commands (discoverable)
- Follow VS Code keyboard conventions
- Inherit theme colors (no hard-coded values)

### 5. Git & File Rules
- **As of March 2026:** For git operations, never use parallel. Always run `git add`, `git commit`, and `git push` sequentially.
- **As of March 2026:** For git commands that write (`git add`, `git commit`, `git push`, etc.), escalate immediately instead of trying once without escalation. Read-only git commands may still run normally.
- **Never commit or push** - User must review first
- **Use `git mv`** for renaming/moving tracked files (preserves history)
- **Pre-commit hook** - Automatically runs `npm run lint:fix` before each commit (see `.github/hooks/pre-commit`)

---

## Key Technical Decisions

| Decision | Choice | Why |
|----------|--------|-----|
| Editor Provider | `CustomTextEditorProvider` | Text-based, VS Code handles save/undo, better Git |
| Editor Framework | TipTap (over raw ProseMirror) | Easier API, rich extensions, markdown built-in |
| Sync Debounce | 500ms | Balance responsiveness vs. performance |
| Document Sync | Full replacement | Simpler, VS Code handles internal diffing |
| Body Font | Serif (Charter/Georgia) | Prose, not code; matches premium editors |

---

## Detailed Guides (Load When Needed)

| Guide | When to Load | Load Proactively? |
|-------|--------------|-------------------|
| [common-pitfalls.md](vibe-coding-rules/common-pitfalls.md) | Known issues and solutions | Read before any task |
| [testing.md](vibe-coding-rules/testing.md) | Writing tests, TDD workflow, bug fixes | For all bug fixes |
| [vscode-integration.md](vibe-coding-rules/vscode-integration.md) | Commands, webview, extension patterns | For extension features |
| [ux-principles.md](vibe-coding-rules/ux-principles.md) | Response times, errors, accessibility | For UI changes |
| [styling.md](vibe-coding-rules/styling.md) | CSS, visual feedback, theme-aware styling, Apple-like polish | For CSS/styling changes |
| [coding-standards.md](vibe-coding-rules/coding-standards.md) | TypeScript style, code documentation, file organization | For all code changes |
| [image-and-dom-handling.md](vibe-coding-rules/image-and-dom-handling.md) | Images, Enter key, NodeViews, Markdown serialization | For image/DOM changes |
| [performance.md](vibe-coding-rules/performance.md) | Bundle size, startup, memory optimization | Reference if concerns arise |

**Usage:** Proactively load guides when starting relevant work. The guides contain detailed patterns and examples.

---

## Plan Workflow (TDD Enforced)

**For new features/plans:**

1. **Create Plan** -> Use [`roadmap/task-plan-template.md`](roadmap/task-plan-template.md) as starting point (can use any AI coding tool or manually)
2. **Move to Pipeline** -> Once plan is locked and ready: `git mv [source]/[name].plan.md roadmap/pipeline/[name].md`
3. **Write Tests First** -> Create failing tests that define expected behavior
4. **Implement** -> Write simplest clean solution to make tests pass
5. **Refactor** -> Clean up while keeping tests green
6. **Verify** -> `npm test` - ALL tests must pass
7. **Self-Review** -> Audit your own changes (see checklist below)
8. **Ship** -> `git mv roadmap/pipeline/[name].md roadmap/shipped/`

**Critical Rules:**
- Tests MUST be written BEFORE implementation (TDD)
- A plan is only `done` when ALL tests pass (not just new ones)
- **Self-review before shipping** - catch overlooked issues
- If issues found, debug/audit code - NO quick hacks or patches

---

## Feature Checklist

**Plan Management:**
- [ ] Plan file created and moved to `roadmap/pipeline/[name].md` when ready
- [ ] Update plan with implementation progress
- [ ] Document decisions and test approach in plan

**Testing (MANDATORY - TDD Required):**
- [ ] **Write failing tests FIRST** (`src/__tests__/`)
- [ ] Verify tests fail (confirms tests work)
- [ ] **Implement feature** to make tests pass
- [ ] **Run `npm test`** - ALL tests pass (new + existing)
- [ ] Cover positive, negative, edge cases
- [ ] If bugs found: audit/debug, not quick fixes

**Self-Review (Before Shipping):**
- [ ] **Code quality** - TypeScript strict, meaningful names, no `any`
- [ ] **Linting** - Pre-commit hook automatically runs `npm run lint:fix` (no manual step needed)
- [ ] **Error handling** - All `async` functions have try/catch, critical operations show user errors (see `vibe-coding-rules/coding-standards.md#error-handling-requirements`)
- [ ] **Logic review** - No obvious bugs or uncovered edge cases
- [ ] **Documentation** - JSDoc updated, file headers current, inline WHY comments
- [ ] **Markdown docs** - Check update triggers table, verify file references (grep `src/` paths)
- [ ] **Third-party licenses** - If added/removed dependencies, update `THIRD_PARTY_LICENSES.md` with license info
- [ ] **Test coverage** - Positive, negative, edge cases all covered
- [ ] **Clean code** - Use `console.log()` for development (removed in production), `console.error()` for errors (always kept), no debugging code or commented-out blocks
- [ ] **Diff review** - Does this make sense to future you in 6 months?
- [ ] **Manual read** - Read a 3000+ word doc in the editor for 10+ minutes (light/dark) to catch UX regressions

---

## Code Documentation (Auto-Update)

**When you change code, update its docs:**
- **Modified function?** -> Update JSDoc (params, returns, throws)
- **Changed file exports?** -> Update file header
- **Removed code?** -> Delete stale comments
- **Added workaround?** -> Add inline WHY comment with issue reference

See: [vibe-coding-rules/coding-standards.md#code-documentation](vibe-coding-rules/coding-standards.md)

---

## Research Over Assumptions

**Before implementing:**
1. Check official docs (VS Code API, TipTap/ProseMirror) - prefer over memory
2. Search GitHub issues for known problems
3. Test assumptions with small examples

**Critical issues:** Feedback loops, cursor position breaks, performance degradation

See: [vibe-coding-rules/common-pitfalls.md](vibe-coding-rules/common-pitfalls.md) - **Read before sync/editor state work**

---

## Quick Reference: File Locations

| Task | File |
|------|------|
| Add command | `package.json` + `src/extension.ts` |
| Add keyboard shortcut | `package.json` |
| Add config option | `package.json` |
| Add/update MCP tool | `mcp/server.js` |
| Add/update MCP temp-file bridge | `src/editor/MarkdownEditorProvider.ts` |
| Add/update MCP file watcher | `src/features/proposalWatcher.ts` / `src/features/selectionRevealWatcher.ts` |
| Modify editor UI | `src/webview/editor.ts` + `src/webview/editor.css` |
| Style changes | `src/webview/editor.css` (see `vibe-coding-rules/styling.md`) |
| Add toolbar button | `src/webview/BubbleMenuView.ts` |
| Add TipTap extension | `src/webview/extensions/` |
| Update document sync | `src/editor/MarkdownEditorProvider.ts` |

---

## MCP Tool Usage

When this extension is active in VS Code, AI agents can use the Markdown for Humans MCP server to work with the editor selection and proposal UI.

See [`examples/CLAUDE.md`](examples/CLAUDE.md) for the full tool reference. Summary:

- `get_selection` - reads the current editor selection plus `file`, `context_before`, `context_after`, and `headings_before`. **Only call this when the user refers to something they have highlighted.** Do not call it as a routine prerequisite before proposing changes.

- `make_single_replacement` - proposes up to 3 alternative rewrites for a selection. Pass `selection` (the exact text to replace - no prior `get_selection` call needed), an `options` array (each with `replacement` and optional `justification`), and optional context fields. The extension automatically scrolls the main editor to the target passage when the panel opens. The panel shows a shared redline (driven by the focused option) and per-option Accept buttons. Treat as confirmed only when status is `"applied"`. `selected_option_index` in the response indicates which alternative was accepted. Status `"skipped"` means the user skipped; `"rejected"` means the user actively rejected the proposal as unwanted. If status is `"in_progress"`, resume with `resume_make_single_replacement` using the returned `session_id`.

- `resume_make_single_replacement` - resumes a single proposal that returned `"in_progress"`. Pass `session_id`.

- `make_sequential_replacements` - proposes multiple replacements for the same file in one uninterrupted review flow. Pass `file` and an ordered `changes` array of `{ selection, options, context_before, context_after, headings_before }` where `options` is an array of `{ replacement, justification? }` (1-3 per step). Treat each step as confirmed only when its status is `"applied"`. If status is `"in_progress"`, resume with `resume_make_sequential_replacements`.

- `resume_make_sequential_replacements` - resumes a sequential review that returned `"in_progress"`. Pass `session_id`.

- `scroll_to_selection` - scrolls the WYSIWYG editor to a known passage. Use when the agent has identified text from file context and the user wants to see it highlighted. Do not use as an immediate follow-up to `get_selection`.

- `sequential_replacement_plan` - presents proposed changes with reasoning for user review and commentary without modifying the document. Pass `file` and an ordered `proposed_replacements` array of `{ range: { start, end }, proposed_change }` where `range` is markdown source line numbers (1-based, inclusive) and `proposed_change` is markdown with the proposed change and reasoning. The user reviews each range, provides comments or clicks "No Comment", then submits. Each result has `status` (`"commented"`, `"no_comment"`, `"skipped"`) and `user_comment`. If status is `"in_progress"`, resume with `resume_sequential_replacement_plan`.

- `resume_sequential_replacement_plan` - resumes a plan review that returned `"in_progress"`. Pass `sequential_replacement_plan_session_id`.

Typical patterns:

- Agent knows what to change (most cases): call `make_single_replacement` or `make_sequential_replacements` directly with the target text - no `get_selection` needed.
- User points at selected text: call `get_selection` to read what they highlighted, then call the appropriate proposal tool.
- Batch review: call `make_sequential_replacements` with `file` and an ordered change list.
- Agent-driven reveal (no proposal): call `scroll_to_selection` with the exact text and available context.
- Agent wants user feedback on proposed changes: call `sequential_replacement_plan` with line ranges and reasoning. User comments are returned per-range.

---

## Documentation Update Triggers

**When you change code, check these docs:**

| Code Change | Docs to Check | Quick Check |
|-------------|---------------|-------------|
| Add/remove TipTap extension | `vibe-coding-rules/env-context.md` | Verify file paths in "Key File Locations" |
| Change sync/debounce logic | `vibe-coding-rules/env-context.md`, `vibe-coding-rules/common-pitfalls.md` | Verify timing values match (500ms, 2s, etc.) |
| Add/remove config option | `package.json` descriptions, README.md | Verify config exists and matches enum/defaults |
| **Add/remove dependency** | **`THIRD_PARTY_LICENSES.md`** | **Add entry with license, copyright, repository, and license URL** |
| Change file structure | `vibe-coding-rules/env-context.md` (Key File Locations table) | Verify all paths exist |
| Ship new feature | `roadmap/shipped/` | Move plan from pipeline to shipped when complete |
| Change styling patterns | `vibe-coding-rules/styling.md` | Verify examples match current CSS |
| Change testing approach | `vibe-coding-rules/testing.md` | Verify patterns match current tests |
| Change image/DOM handling | `vibe-coding-rules/image-and-dom-handling.md` | Verify patterns match code |

---

## Documentation

- `vibe-coding-rules/env-context.md` - Architecture (~80 lines) **Start here**
- `roadmap/shipped/` - Shipped features (detailed plan files)
- `docs/ARCHITECTURE.md` - Deep dive (when needed)

---

## Decision Making

**For UX:** Does this improve the reading experience? <- Most important
**For Tech:** Is this the simplest solution that works?
**For Features:** Does this align with "write markdown naturally"?

---

## 6 Core Principles

1. **One plan file** - Create plan, move to `roadmap/pipeline/` when ready, move to `roadmap/shipped/` when done
2. **Reading experience > Everything** - Typography is the product
3. **Performance from day 1** - Don't say "optimize later"
4. **Embrace VS Code** - Don't fight the platform
5. **Simplicity wins** - Simplest solution that works
6. **Test by using** - Read a 3000+ word doc for 10 minutes

---

**Last Updated:** 2025-12-13
