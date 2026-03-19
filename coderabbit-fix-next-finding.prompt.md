# CodeRabbit Findings Fixer (next OPEN item)

Use this prompt after the collector prompt. It works with the same findings format and processes exactly one unresolved finding per run.

## Input

No required input.

The prompt must resolve findings file automatically from current git branch:

1. `git branch --show-current` -> `branch_raw`
2. Normalize to `branch-slug` with the same rules as collector:
   - lowercase
   - replace non `[a-z0-9._-]` sequences with `-`
   - collapse repeated `-`
   - trim leading/trailing `-`
3. Findings file path:
   - `coderabbit-findings-<branch-slug>.md`

If file is missing, fail fast and instruct to run collector first.
Collector command:

```bash
bun run /Users/greenhost/develop/unitify/prompts/coderabbit-collect-from-pr.ts
```

## Goal

Process exactly one next unresolved finding (`Status: OPEN`) from the findings file:

- validate if issue is real in current code,
- if valid: implement fix + update/add tests,
- if invalid: document rejection reason,
- update finding status so it is not picked again on next run,
- create the commit in this run by the implementing agent.

## Selection Rules

1. Read findings file top to bottom.
2. Select first section `## F-xxxx` with `- Status: OPEN`.
3. Process only this one section in this run.
4. Stop after section update and verification.

## Validation Rules

Before changing code:

1. Inspect referenced file/lines.
2. Confirm whether behavior currently reproduces the reported problem.
3. Run focused checks when feasible (lint/test/targeted unit test).

If correctness depends on unknown decision, stop and ask user explicitly.

## If you AGREE with finding

1. Implement minimal safe fix in production code.
2. Add or update tests for regression coverage.
3. Run focused validation commands for changed scope.
4. Update selected finding section fields:
   - `- Status: FIXED`
   - `- Decision: AGREED`
   - `- Resolution Reason: <why issue was real>`
   - `- Changed Files: <comma-separated paths>`
   - `- Validation Commands: <command list with pass/fail>`
   - `- Fixed At (UTC): <iso8601>`
   - replace `Validation Notes` and `Resolution Notes` from `Pending` with concrete notes.
5. Create exactly one git commit for this finding (including findings file updates).

## If you DISAGREE with finding

1. Do not change production/test code for this finding.
2. Update selected finding section fields:
   - `- Status: REJECTED`
   - `- Decision: DISAGREED`
   - `- Resolution Reason: <technical reason why not a bug/not applicable/already fixed>`
   - `- Validation Commands: <what was checked>`
   - `- Reviewed At (UTC): <iso8601>`
   - replace `Validation Notes` and `Resolution Notes` from `Pending` with concrete notes.
3. Create exactly one git commit for this finding (findings file update only).

## File Update Rules

1. Never delete finding sections.
2. Never change IDs (`F-xxxx`).
3. Keep markdown structure intact.
4. Update header counters:
   - `Open Findings`
   - `Fixed Findings`
   - `Rejected Findings`
5. Preserve other findings unchanged.

## Commit Rules

1. The implementing agent MUST create the commit itself in the same run.
2. Do not defer commit creation to a coordinator or another agent.
3. Stage all files changed for this finding (including `coderabbit-findings-<branch-slug>.md`).
4. Create exactly one commit per run.
5. If commit creation fails, fail fast and report the blocking error.

## Completion Output (strict)

Print concise run summary:

- `Processed finding: <F-xxxx>`
- `Result: FIXED | REJECTED`
- `Files changed: <list or none>`
- `Checks run: <list>`
- `Commit message: <one-line commit subject>` (always required)
- `Commit sha: <short sha>` (always required)
