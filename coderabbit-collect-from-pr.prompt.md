# CodeRabbit Findings Collector (PR URL only)

Use this prompt to collect CodeRabbit findings from a Pull Request and write them into one normalized file.

## Input

- `PR_URL` (optional), example: `https://github.com/Unitifycom/unitify/pull/51`

No other input is required.  
If `PR_URL` is omitted, the script detects current PR via `gh pr view`.

## Fast Path (use bundled Bun + TS script)

To avoid repeating manual API collection/parsing, use the prepared script:

- Script: `/Users/greenhost/develop/unitify/prompts/coderabbit-collect-from-pr.ts`
- Recommended run (with explicit PR URL):

```bash
bun run /Users/greenhost/develop/unitify/prompts/coderabbit-collect-from-pr.ts "$PR_URL"
```

- Optional: if `PR_URL` is omitted, script tries to detect PR from current branch via `gh pr view` (run from target repo root).

The script already implements this prompt's rules (collection from 3 endpoints, `Potential issue` filtering, dedupe, order preservation, status preservation, archive handling, strict output format, fail-fast errors) and is significantly faster than rebuilding the workflow each time.
It also maps resolved GitHub review threads for inline CodeRabbit comments to `Status: FIXED` automatically.

## Goal

Build one findings file in repository root named by PR head branch:

- `coderabbit-findings-<branch-slug>.md`

Where:

- `<branch-slug>` is PR head branch normalized to lowercase and filesystem-safe:
  - replace any sequence of non `[a-z0-9._-]` with `-`
  - collapse repeated `-`
  - trim leading/trailing `-`

Example:

- `feat/apple-pay` -> `feat-apple-pay`

## Execution Rules

1. Parse `owner`, `repo`, and `pr_number` from `PR_URL`.
2. Fetch PR metadata via GitHub API and extract:
   - base repo full name
   - PR number
   - PR head ref (branch name)
3. Resolve output filename from branch slug.
4. Collect CodeRabbit comments from:
   - review comments endpoint (`pulls/{pr}/comments`)
   - pull reviews endpoint (`pulls/{pr}/reviews`)
   - issue comments endpoint (`issues/{pr}/comments`)
5. Include only comments authored by CodeRabbit bot users (at minimum `coderabbitai[bot]`).
6. Include only findings explicitly marked as `Potential issue`.
7. Parse and keep:
   - short problem summary
   - severity (Critical/Major/Minor when available)
   - file path + line/range when available
   - source URL (discussion/review comment link)
   - full "Prompt for AI Agents" text when available
8. Do not drop unresolved findings, even if they are outside diff.
9. Deduplicate identical findings by stable key:
   - `source_url` if present, else `file + range + summary + severity`.
10. Fail fast with a clear error if PR cannot be read or no CodeRabbit data is accessible.
11. For inline CodeRabbit findings linked to resolved GitHub review threads, set `Status` to `FIXED` during rebuild.

## Output Format (strict)

Write one markdown file in repo root:

- `coderabbit-findings-<branch-slug>.md`

Template:

```md
# CodeRabbit Findings

- PR URL: <url>
- Repository: <owner/repo>
- PR Number: <number>
- PR Branch: <head_ref>
- Generated At (UTC): <iso8601>
- Total Findings: <N>
- Open Findings: <N_open>
- Fixed Findings: <N_fixed>
- Rejected Findings: <N_rejected>
- Status values: OPEN | FIXED | REJECTED

## F-0001
- Status: OPEN
- Source: inline-comment | review-summary | issue-comment
- Source URL: <url or n/a>
- Author: <login>
- File: <path or n/a>
- Lines: <line/range or n/a>
- Severity: Critical | Major | Minor | Unknown
- Summary: <short summary>
- Prompt for Fix:
```text
<prompt text from CodeRabbit, or "Prompt not found">
```
- Validation Notes: Pending
- Resolution Notes: Pending

## F-0002
...
```

## Ordering

Do not re-sort findings.
Keep findings in the same order as they are returned/encountered from CodeRabbit data.
On repeated runs, preserve existing order for matching findings; append only truly new findings.

## Idempotency

If file already exists:

1. Rebuild it from current PR data.
2. Keep existing statuses only for findings that still match by stable key.
3. New findings start as `OPEN`.
4. Removed findings should be moved to an archive section:
   - `## Archived (no longer present in latest PR scan)`
   - keep old status and metadata for traceability.
5. Keep any additional custom lines/fields previously added by agents inside finding blocks; never delete them during rebuild.

## Final console/report output

Print:

- output file path
- PR branch and slug
- number of collected findings
- counts by status
