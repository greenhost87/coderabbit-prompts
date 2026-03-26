---
name: coderabbit-do
description: Validate and resolve exactly one next `OPEN` entry from a branch-specific `coderabbit-findings-<branch-slug>.md` file in the current Git repository. Use after findings have been collected and the user wants to work through CodeRabbit findings one by one, either by implementing a minimal fix with tests and a commit or by rejecting the finding with a technical reason and a commit.
---

# CodeRabbit Do

## Overview

Process exactly one finding per run. Fail fast when the findings file is missing, the finding cannot be validated, or a required user decision is unknown.

## Start The Run

From the target repository root, run the bundled helper to resolve the findings file and print the next `OPEN` finding block:

```bash
/absolute/path/to/coderabbit-do/scripts/run-do
```

Use the printed finding details as the input context for the rest of this workflow.

## Resolve The Findings File

1. Run `git branch --show-current`.
2. Normalize the branch with the same slug rules as the collector:
   lowercase, replace non `[a-z0-9._-]` runs with `-`, collapse repeated `-`, trim leading and trailing `-`.
3. Use `coderabbit-findings-<branch-slug>.md` in the repository root.
4. Stop immediately if the file is missing and tell the user to run `$coderabbit-collect` first.

## Select Exactly One Finding

1. Read the findings file from top to bottom.
2. Select the first `## F-xxxx` block whose status is `OPEN`.
3. Process only that block.
4. Stop after updating that block, header counters, and repository state for that one finding.

Do not skip ahead to a later finding.

## Validate Before Editing

1. Inspect the referenced file and lines.
2. Confirm whether the reported issue is real in the current code.
3. Run focused checks when feasible.
4. Raise an OPEN QUESTION and pause if correctness depends on an unknown product decision.

Do not introduce fallback logic, silent degradation, or hidden alternate paths while implementing a fix.

## Fix Or Reject

If the finding is valid:

1. Implement the minimal safe production fix.
2. Add or update regression tests.
3. Run focused validation commands for the changed scope.
4. Update the selected block with:
   `Status: FIXED`
   `Decision: AGREED`
   `Resolution Reason: ...`
   `Changed Files: ...`
   `Validation Commands: ...`
   `Fixed At (UTC): ...`
5. Replace `Validation Notes: Pending` and `Resolution Notes: Pending` with concrete notes.

If the finding is not valid:

1. Leave production and test code unchanged for that finding.
2. Update the selected block with:
   `Status: REJECTED`
   `Decision: DISAGREED`
   `Resolution Reason: ...`
   `Validation Commands: ...`
   `Reviewed At (UTC): ...`
3. Replace `Validation Notes: Pending` and `Resolution Notes: Pending` with concrete notes.

## Preserve File Structure

1. Never delete finding sections.
2. Never change `F-xxxx` identifiers.
3. Keep the markdown structure intact.
4. Update header counters for open, fixed, and rejected findings.
5. Preserve other findings unchanged.
6. Preserve any extra custom lines already present inside finding blocks unless they directly conflict with the required field updates.

## Commit In The Same Run

1. Stage all files changed for the selected finding, including the findings file.
2. Create exactly one git commit in the same run.
3. Do not defer commit creation to another agent or a later step.
4. Fail fast if commit creation fails.

## Report The Completion Summary

Print a concise summary with these exact items:

- `Processed finding: <F-xxxx>`
- `Result: FIXED | REJECTED`
- `Files changed: <list or none>`
- `Checks run: <list>`
- `Commit message: <one-line subject>`
- `Commit sha: <short sha>`

## Resources

- `scripts/run-do`: wrapper entrypoint that resolves the next `OPEN` finding from the current repository.
- `scripts/coderabbit-do.ts`: helper that locates the findings file and prints the next unresolved finding.
- `scripts/coderabbit-do.test.ts`: focused tests for branch slugging and findings parsing.
- `package.json`: local test command for the skill directory.
