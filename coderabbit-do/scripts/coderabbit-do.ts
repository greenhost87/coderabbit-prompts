#!/usr/bin/env bun

import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'

export interface NextOpenFinding {
  id: string
  status: string
  file: string
  lines: string
  severity: string
  summary: string
  promptForFix: string
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function run(cmd: string): string {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  } catch (error: unknown) {
    const err = error as { stderr?: Buffer | string; stdout?: Buffer | string; message?: string }
    const stderr = (err.stderr ?? '').toString().trim()
    const stdout = (err.stdout ?? '').toString().trim()
    const details = stderr || stdout || err.message || 'Unknown error'
    throw new Error(`Command failed: ${cmd}\n${details}`)
  }
}

export function slugifyBranch(branch: string): string {
  const slug = String(branch)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')

  if (!slug) {
    throw new Error(`Unable to build branch slug from: ${branch}`)
  }

  return slug
}

export function detectCurrentBranch(): string {
  const branch = run('git branch --show-current')
  if (!branch) {
    throw new Error('Unable to detect current git branch')
  }
  return branch
}

export function findingsFilePathForBranch(branch: string, cwd: string = process.cwd()): string {
  return path.join(cwd, `coderabbit-findings-${slugifyBranch(branch)}.md`)
}

function extractField(block: string, fieldName: string): string {
  const match = block.match(new RegExp(`^- ${escapeRegex(fieldName)}: (.*)$`, 'm'))
  if (!match) {
    throw new Error(`Missing required field "${fieldName}" in finding block`)
  }
  return match[1].trim()
}

export function extractPromptForFix(block: string): string {
  const match = block.match(/^- Prompt for Fix:\s*\n```(?:text)?\n([\s\S]*?)\n```/m)
  if (!match) {
    throw new Error('Missing required "Prompt for Fix" block in finding section')
  }

  const prompt = match[1].trim()
  if (!prompt) {
    throw new Error('Prompt for Fix block is empty')
  }

  return prompt
}

export function splitFindingBlocks(markdown: string): string[] {
  const lines = markdown.replace(/\r/g, '').split('\n')
  const blocks: string[] = []
  let current: string[] = []

  for (const line of lines) {
    if (/^## Archived/.test(line)) {
      if (current.length) {
        blocks.push(current.join('\n').trim())
      }
      current = []
      break
    }

    if (/^## F-\d{4}\s*$/.test(line)) {
      if (current.length) {
        blocks.push(current.join('\n').trim())
      }
      current = [line]
      continue
    }

    if (current.length) {
      current.push(line)
    }
  }

  if (current.length) {
    blocks.push(current.join('\n').trim())
  }

  return blocks
}

export function parseFindingBlock(block: string): NextOpenFinding {
  const idMatch = block.match(/^## (F-\d{4})\s*$/m)
  if (!idMatch) {
    throw new Error('Missing finding identifier in block')
  }

  return {
    id: idMatch[1],
    status: extractField(block, 'Status'),
    file: extractField(block, 'File'),
    lines: extractField(block, 'Lines'),
    severity: extractField(block, 'Severity'),
    summary: extractField(block, 'Summary'),
    promptForFix: extractPromptForFix(block),
  }
}

export function findFirstOpenFinding(markdown: string): NextOpenFinding {
  for (const block of splitFindingBlocks(markdown)) {
    const finding = parseFindingBlock(block)
    if (finding.status === 'OPEN') {
      return finding
    }
  }

  throw new Error('No OPEN findings found in the findings file')
}

export function renderNextOpenFinding(params: {
  branch: string
  findingsFilePath: string
  finding: NextOpenFinding
}): string {
  const { branch, findingsFilePath, finding } = params

  return [
    `Branch: ${branch}`,
    `Findings File: ${findingsFilePath}`,
    `Processed finding: ${finding.id}`,
    `Status: ${finding.status}`,
    `File: ${finding.file}`,
    `Lines: ${finding.lines}`,
    `Severity: ${finding.severity}`,
    `Summary: ${finding.summary}`,
    'Prompt for Fix:',
    finding.promptForFix,
  ].join('\n')
}

export function main(): void {
  const branch = detectCurrentBranch()
  const findingsFilePath = findingsFilePathForBranch(branch)

  if (!fs.existsSync(findingsFilePath)) {
    throw new Error(
      `Findings file not found: ${findingsFilePath}\nRun $coderabbit-collect first.`,
    )
  }

  const markdown = fs.readFileSync(findingsFilePath, 'utf8')
  const finding = findFirstOpenFinding(markdown)

  process.stdout.write(`${renderNextOpenFinding({ branch, findingsFilePath, finding })}\n`)
}

if (import.meta.main) {
  main()
}
