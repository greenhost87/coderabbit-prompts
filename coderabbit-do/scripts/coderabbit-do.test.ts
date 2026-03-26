import { describe, expect, test } from 'bun:test'

import {
  extractPromptForFix,
  findFirstOpenFinding,
  parseFindingBlock,
  renderNextOpenFinding,
  slugifyBranch,
  splitFindingBlocks,
} from './coderabbit-do.ts'

describe('branch helpers', () => {
  test('slugifyBranch normalizes git branch names', () => {
    expect(slugifyBranch('Feature/Fix Critical Bug')).toBe('feature-fix-critical-bug')
  })

  test('slugifyBranch rejects empty slugs', () => {
    expect(() => slugifyBranch('!!!')).toThrow('Unable to build branch slug')
  })
})

describe('finding parsing', () => {
  const markdown = `# CodeRabbit Findings

- PR URL: https://github.com/acme/repo/pull/42

## F-0001
- Status: FIXED
- File: src/first.ts
- Lines: 10
- Severity: Minor
- Summary: Already handled
- Prompt for Fix:
\`\`\`text
Ignore this one
\`\`\`

## F-0002
- Status: OPEN
- File: src/second.ts
- Lines: 20-22
- Severity: Major
- Summary: Add guard before parsing
- Prompt for Fix:
\`\`\`text
In \`src/second.ts\`, add a guard before parsing input.
\`\`\`

## Archived (no longer present in latest PR scan)
`

  test('splitFindingBlocks ignores archived section', () => {
    expect(splitFindingBlocks(markdown)).toHaveLength(2)
  })

  test('extractPromptForFix requires fenced prompt block', () => {
    expect(extractPromptForFix(markdown)).toContain('Ignore this one')
  })

  test('parseFindingBlock reads fields from one block', () => {
    const block = splitFindingBlocks(markdown)[1]
    expect(parseFindingBlock(block)).toEqual({
      id: 'F-0002',
      status: 'OPEN',
      file: 'src/second.ts',
      lines: '20-22',
      severity: 'Major',
      summary: 'Add guard before parsing',
      promptForFix: 'In `src/second.ts`, add a guard before parsing input.',
    })
  })

  test('findFirstOpenFinding selects the first OPEN finding only', () => {
    expect(findFirstOpenFinding(markdown).id).toBe('F-0002')
  })

  test('renderNextOpenFinding prints a concise summary', () => {
    const output = renderNextOpenFinding({
      branch: 'feature/test',
      findingsFilePath: '/tmp/coderabbit-findings-feature-test.md',
      finding: findFirstOpenFinding(markdown),
    })

    expect(output).toContain('Branch: feature/test')
    expect(output).toContain('Processed finding: F-0002')
    expect(output).toContain('Prompt for Fix:')
  })
})
