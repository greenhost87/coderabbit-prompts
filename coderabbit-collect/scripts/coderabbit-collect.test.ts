import { describe, expect, test } from 'bun:test'

import {
  cleanupText,
  dedupeFindings,
  extractLineRangeFromText,
  extractPotentialIssueBlocks,
  findNearestFilePath,
  normalizeSeverity,
  parseAdditionalInfo,
  parsePrUrl,
  parsePromptForFix,
  parseSummary,
  quoteShell,
  slugifyBranch,
  stableKeyForFinding,
  type Finding,
} from './coderabbit-collect.ts'

describe('utility helpers', () => {
  test('quoteShell escapes single quotes', () => {
    expect(quoteShell("a'b")).toBe("'a'\\''b'")
  })

  test('parsePrUrl parses valid GitHub PR URL', () => {
    expect(parsePrUrl('https://github.com/acme/repo/pull/42')).toEqual({
      owner: 'acme',
      repo: 'repo',
      prNumber: 42,
    })
  })

  test('parsePrUrl rejects invalid URL', () => {
    expect(() => parsePrUrl('https://example.com/acme/repo/pull/42')).toThrow('Invalid PR URL format')
  })

  test('slugifyBranch normalizes branch names', () => {
    expect(slugifyBranch('Feature/Fix Critical Bug')).toBe('feature-fix-critical-bug')
  })

  test('slugifyBranch throws when slug is empty', () => {
    expect(() => slugifyBranch('!!!')).toThrow('Unable to build branch slug')
  })

  test('normalizeSeverity keeps known values', () => {
    expect(normalizeSeverity('critical')).toBe('Critical')
    expect(normalizeSeverity('Major')).toBe('Major')
    expect(normalizeSeverity('minor')).toBe('Minor')
    expect(normalizeSeverity('weird')).toBe('Unknown')
  })

  test('cleanupText removes markdown/html noise', () => {
    expect(cleanupText('> [Link](https://x) `<b>` <i>tag</i>')).toBe('Link tag')
  })

  test('parsePromptForFix extracts prompt payload', () => {
    const segment = `
<summary>Prompt for AI Agents</summary>
\`\`\`text
In \`src/app.ts\`, fix issue.
\`\`\`
`
    expect(parsePromptForFix(segment)).toBe('In `src/app.ts`, fix issue.')
  })

  test('parseSummary finds best standalone bold summary', () => {
    const segment = `
**JSON request body**
**Implement guard for empty payload before parsing input**
`
    expect(parseSummary(segment)).toBe('Implement guard for empty payload before parsing input')
  })
})

describe('line/path extraction', () => {
  test('extractLineRangeFromText reads inline ranges and single lines', () => {
    expect(extractLineRangeFromText('Issue in `12-15`')).toBe('12-15')
    expect(extractLineRangeFromText('Issue in line 9')).toBe('9')
  })

  test('findNearestFilePath uses prompt hint first', () => {
    expect(findNearestFilePath('', 'In `src/index.ts` do x')).toBe('src/index.ts')
  })
})

describe('finding parsing and dedupe', () => {
  test('extractPotentialIssueBlocks parses severity and explicit range', () => {
    const body = `
\`67-69\`: _⚠️ Potential issue_ | _Major_
**Unsafe merge order breaks determinism**
<summary>Prompt for AI Agents</summary>
\`\`\`text
In \`src/merge.ts\`, enforce deterministic ordering.
\`\`\`
`

    const blocks = extractPotentialIssueBlocks(body)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].severity).toBe('Major')
    expect(blocks[0].range).toBe('67-69')
  })

  test('stableKeyForFinding prefers source URL when available', () => {
    expect(
      stableKeyForFinding({
        sourceUrl: 'https://github.com/x/y/pull/1#discussion_r1',
        file: 'src/app.ts',
        lines: '10',
        summary: 'x',
        severity: 'Major',
      }),
    ).toBe('https://github.com/x/y/pull/1#discussion_r1')
  })

  test('dedupeFindings keeps entry with real prompt', () => {
    const base: Finding = {
      source: 'inline-comment',
      sourceUrl: 'n/a',
      author: 'coderabbitai',
      file: 'src/app.ts',
      lines: '10',
      severity: 'Major',
      summary: 'Summary',
      promptForFix: 'Prompt not found',
      status: 'OPEN',
      validationNotes: 'Pending',
      resolutionNotes: 'Pending',
      stableKey: 'k1',
    }

    const preferred: Finding = {
      ...base,
      promptForFix: 'Do the fix',
    }

    const deduped = dedupeFindings([base, preferred])
    expect(deduped).toHaveLength(1)
    expect(deduped[0].promptForFix).toBe('Do the fix')
  })

  test('parseAdditionalInfo preserves unknown sections only', () => {
    const block = `
- Status: OPEN
- Summary: Example
- Prompt for Fix:
\`\`\`text
Fix it
\`\`\`
Custom note line 1
Custom note line 2
`

    expect(parseAdditionalInfo(block)).toBe('Custom note line 1\nCustom note line 2')
  })
})
