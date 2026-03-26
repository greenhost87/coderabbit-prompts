---
name: coderabbit-collect
description: Collect CodeRabbit findings from a GitHub pull request and write or refresh a normalized `coderabbit-findings-<branch-slug>.md` file in the target repository root. Use when a user provides a PR URL, asks to scan the current PR for CodeRabbit feedback, wants to rebuild the findings file while preserving statuses and archives, or needs a fail-fast inventory of `Potential issue` comments from review comments, reviews, and issue comments.
---

# CodeRabbit Collect

## Overview

Prefer the bundled script over rebuilding the GitHub collection flow by hand. Run the script from the target repository root so the findings file is written to the correct repository.

## Prepare The Run

1. Change into the target repository root before running anything.
2. Ensure `gh` is authenticated and `bun` is available.
3. Use the user-provided PR URL when available.
4. Omit the argument only when the current branch can be resolved by `gh pr view`.

## Run The Collector

Resolve the skill directory first, then run the bundled wrapper by absolute path from the target repository root.

With an explicit PR URL:

```bash
/absolute/path/to/coderabbit-collect/scripts/run-collect "https://github.com/owner/repo/pull/123"
```

Without a PR URL:

```bash
/absolute/path/to/coderabbit-collect/scripts/run-collect
```

Because the script writes to `process.cwd()`, stay in the repository root for the whole run.

## Enforce The Output Contract

Keep the generated filename in the exact form `coderabbit-findings-<branch-slug>.md`.

Use the PR head branch to build `<branch-slug>` with these rules:

1. Convert to lowercase.
2. Replace each run of non `[a-z0-9._-]` characters with `-`.
3. Collapse repeated `-`.
4. Trim leading and trailing `-`.

Expect the script to do all of the following:

1. Read PR metadata.
2. Collect CodeRabbit data from review comments, reviews, and issue comments.
3. Keep only findings explicitly marked as `Potential issue`.
4. Deduplicate by stable key.
5. Preserve existing statuses for matching findings on rebuild.
6. Archive findings that disappeared from the latest scan.
7. Mark inline findings from resolved GitHub review threads as `FIXED`.
8. Fail fast if the PR cannot be read or no CodeRabbit data is accessible.

Do not replace the bundled script with manual scraping as a fallback.

## Report The Result

Report the generated file path, PR branch, branch slug, total findings, and counts by status.

## Validate Script Changes

Run the focused test file when you modify the bundled script:

```bash
cd /absolute/path/to/coderabbit-collect && bun test
```

## Resources

- `scripts/run-collect`: wrapper entrypoint for direct execution from a target repository.
- `scripts/coderabbit-collect.ts`: canonical collector implementation.
- `scripts/coderabbit-collect.test.ts`: focused regression tests for parsing and dedupe behavior.
- `package.json`: local test command for the skill directory.
