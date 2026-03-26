#!/usr/bin/env bun

import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'

export type FindingStatus = 'OPEN' | 'FIXED' | 'REJECTED'

export interface Finding {
  id?: string
  status: FindingStatus
  source: string
  sourceUrl: string
  author: string
  file: string
  lines: string
  severity: string
  summary: string
  promptForFix: string
  validationNotes: string
  resolutionNotes: string
  additionalInfo?: string
  stableKey?: string
  isResolved?: boolean
}

interface ExistingEntries {
  active: Finding[]
  archived: Finding[]
}

interface ParsePrResult {
  owner: string
  repo: string
  prNumber: number
}

const VALID_STATUSES = new Set<FindingStatus>(['OPEN', 'FIXED', 'REJECTED'])

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function quoteShell(value: unknown): string {
  return `'${String(value).replace(/'/g, `'\\''`)}'`
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

export function ghApiJson(endpoint: string): unknown {
  const cmd = `gh api -X GET ${quoteShell(endpoint)}`
  const output = run(cmd)
  try {
    return JSON.parse(output)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to parse GitHub API response for ${endpoint}: ${message}`)
  }
}

export function ghGraphqlJson(query: string, variables: Record<string, unknown>): unknown {
  const args = [`gh api graphql -f query=${quoteShell(query)}`]

  for (const [key, value] of Object.entries(variables || {})) {
    if (value === null || value === undefined) {
      continue
    }
    const typeFlag = typeof value === 'number' ? '-F' : '-f'
    args.push(`${typeFlag} ${key}=${quoteShell(value)}`)
  }

  const output = run(args.join(' '))
  try {
    return JSON.parse(output)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to parse GitHub GraphQL response: ${message}`)
  }
}

export function fetchAllPages(endpointBase: string): unknown[] {
  const results: unknown[] = []
  let page = 1

  while (true) {
    const separator = endpointBase.includes('?') ? '&' : '?'
    const endpoint = `${endpointBase}${separator}per_page=100&page=${page}`
    const pageData = ghApiJson(endpoint)

    if (!Array.isArray(pageData)) {
      throw new Error(`Expected array response from ${endpoint}, got ${typeof pageData}`)
    }

    results.push(...pageData)

    if (pageData.length < 100) {
      break
    }

    page += 1

    if (page > 200) {
      throw new Error(`Pagination limit exceeded while reading ${endpointBase}`)
    }
  }

  return results
}

export function fetchResolvedCodeRabbitDiscussionUrls(params: { owner: string; repo: string; prNumber: number }): Set<string> {
  const { owner, repo, prNumber } = params
  const query = `
query($owner:String!, $repo:String!, $number:Int!, $cursor:String) {
  repository(owner:$owner, name:$repo) {
    pullRequest(number:$number) {
      reviewThreads(first:100, after:$cursor) {
        nodes {
          isResolved
          comments(first:100) {
            nodes {
              url
              author {
                login
              }
            }
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
}
`

  const resolvedUrls = new Set<string>()
  let cursor: string | null = null
  let page = 0

  while (true) {
    page += 1
    if (page > 200) {
      throw new Error('Pagination limit exceeded while reading review thread resolution states')
    }

    const response = ghGraphqlJson(query, { owner, repo, number: prNumber, cursor })
    const responseObj = isObject(response) ? response : null
    const data = responseObj && isObject(responseObj.data) ? responseObj.data : null
    const repository = data && isObject(data.repository) ? data.repository : null
    const pullRequest = repository && isObject(repository.pullRequest) ? repository.pullRequest : null
    const reviewThreads = pullRequest && isObject(pullRequest.reviewThreads) ? pullRequest.reviewThreads : null
    const nodes = reviewThreads && Array.isArray(reviewThreads.nodes) ? reviewThreads.nodes : null
    const pageInfo = reviewThreads && isObject(reviewThreads.pageInfo) ? reviewThreads.pageInfo : null

    if (!pullRequest || !reviewThreads || !nodes || !pageInfo) {
      throw new Error('Invalid GraphQL response while reading review thread resolution states')
    }

    for (const thread of nodes) {
      if (!isObject(thread) || !thread.isResolved) {
        continue
      }

      const commentsObj = isObject(thread.comments) ? thread.comments : null
      const comments = commentsObj && Array.isArray(commentsObj.nodes) ? commentsObj.nodes : null
      if (!comments) {
        continue
      }

      for (const comment of comments) {
        if (!isObject(comment)) {
          continue
        }
        const author = isObject(comment.author) ? comment.author : null
        const login = author && typeof author.login === 'string' ? author.login : ''
        const url = typeof comment.url === 'string' ? comment.url : ''
        if (!isCodeRabbitAuthor(login)) {
          continue
        }
        if (!url) {
          continue
        }
        resolvedUrls.add(url)
      }
    }

    const hasNextPage = Boolean(pageInfo.hasNextPage)
    const endCursor = typeof pageInfo.endCursor === 'string' ? pageInfo.endCursor : null

    if (!hasNextPage) {
      break
    }

    if (!endCursor) {
      throw new Error('GraphQL pagination is inconsistent: hasNextPage=true but endCursor is missing')
    }

    cursor = endCursor
  }

  return resolvedUrls
}

export function detectCurrentPrUrl(): string {
  const url = run('gh pr view --json url --jq .url')
  if (!url || !/^https:\/\/github\.com\/.+\/pull\/\d+$/i.test(url)) {
    throw new Error('Unable to detect PR URL from current branch via gh pr view')
  }
  return url
}

export function parsePrUrl(prUrl: string): ParsePrResult {
  const match = prUrl.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:[/?#].*)?$/i)
  if (!match) {
    throw new Error(`Invalid PR URL format: ${prUrl}`)
  }

  return {
    owner: match[1],
    repo: match[2],
    prNumber: Number(match[3]),
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

export function isCodeRabbitAuthor(login: unknown): boolean {
  return typeof login === 'string' && /coderabbit/i.test(login)
}

export function normalizeSeverity(raw: unknown): string {
  if (!raw) {
    return 'Unknown'
  }

  const value = String(raw).trim().toLowerCase()
  if (value === 'critical') {
    return 'Critical'
  }
  if (value === 'major') {
    return 'Major'
  }
  if (value === 'minor') {
    return 'Minor'
  }

  return 'Unknown'
}

export function cleanupText(text: unknown): string {
  return String(text || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^\s*>\s?/gm, '')
    .replace(/`+/g, '')
    .replace(/\[[^\]]+\]\([^\)]+\)/g, (m) => m.replace(/^\[|\]\([^\)]+\)$/g, ''))
    .replace(/\s+/g, ' ')
    .trim()
}

export function parsePromptForFix(segment: unknown): string {
  const dequoted = String(segment || '').replace(/^\s*>\s?/gm, '')
  const match = dequoted.match(/<summary>[^<]*Prompt for AI Agents[^<]*<\/summary>\s*```(?:text)?\n([\s\S]*?)```/i)
  if (!match) {
    return 'Prompt not found'
  }

  const prompt = String(match[1] || '').replace(/\r/g, '').trim()
  if (!prompt) {
    return 'Prompt not found'
  }

  return prompt.replace(/```/g, "'''")
}

export function parseSummary(segment: unknown): string {
  const dequoted = String(segment || '').replace(/^\s*>\s?/gm, '')
  const standaloneBoldMatches = [...dequoted.matchAll(/^\s*\*\*([^*\n][^*]*?)\*\*\s*$/gm)]

  if (standaloneBoldMatches.length) {
    const best = standaloneBoldMatches
      .map((m) => cleanupText(m[1]))
      .find((line) => {
        if (!line) {
          return false
        }
        if (/^(json request body|sources?)[:]?$/i.test(line)) {
          return false
        }
        if (line.endsWith(':')) {
          return false
        }
        return line.split(/\s+/).filter(Boolean).length >= 3
      })

    if (best) {
      return best
    }
  }

  const boldMatch = dequoted.match(/\*\*([^*\n][\s\S]*?)\*\*/)
  if (boldMatch) {
    return cleanupText(boldMatch[1])
  }

  const lines = dequoted
    .split('\n')
    .map((line) => cleanupText(line))
    .filter(Boolean)

  if (!lines.length) {
    return 'Summary not found'
  }

  const firstUseful = lines.find((line) => !/potential issue/i.test(line)) || lines[0]
  return firstUseful.slice(0, 220)
}

export function extractLineRangeFromText(text: unknown): string | null {
  const cleaned = String(text || '').replace(/^\s*>\s?/gm, '')

  const tickRange = cleaned.match(/`(\d+)\s*-\s*(\d+)`/)
  if (tickRange) {
    return `${tickRange[1]}-${tickRange[2]}`
  }

  const tickSingle = cleaned.match(/`(\d+)`/)
  if (tickSingle) {
    return tickSingle[1]
  }

  const aroundRange = cleaned.match(/around lines?\s+(\d+)\s*-\s*(\d+)/i)
  if (aroundRange) {
    return `${aroundRange[1]}-${aroundRange[2]}`
  }

  const lineSingle = cleaned.match(/line\s+(\d+)/i)
  if (lineSingle) {
    return lineSingle[1]
  }

  return null
}

export function findNearestFilePath(textBefore: unknown, segment: unknown): string {
  const dequotedSegment = String(segment || '').replace(/^\s*>\s?/gm, '')
  const dequotedPrefix = String(textBefore || '').replace(/^\s*>\s?/gm, '')

  const extractFromPrompt = (text: string, pick: 'first' | 'last' = 'last'): string | null => {
    const matches = [...text.matchAll(/In\s+`@?([^`\n]+\.[a-z0-9]+)`/gi)]
    if (!matches.length) {
      return null
    }
    const target = pick === 'first' ? matches[0] : matches[matches.length - 1]
    return cleanupText(target[1]).replace(/^@/, '')
  }

  const extractFromSummary = (text: string, pick: 'first' | 'last' = 'last'): string | null => {
    const matches = [...text.matchAll(/<summary>\s*([^<\n]+\.[a-z0-9]+)\s*(?:\(\d+\))?\s*<\/summary>/gi)]
    if (!matches.length) {
      return null
    }
    const target = pick === 'first' ? matches[0] : matches[matches.length - 1]
    return cleanupText(target[1]).replace(/^@/, '')
  }

  const extractPlainPath = (text: string): string | null => {
    const matches = [...text.matchAll(/\b([A-Za-z0-9_\/-]+\.(?:js|ts|jsx|tsx|md|json|yml|yaml|py|go|rb|php|java|kt|swift|c|cpp|h))\b/g)]
    if (!matches.length) {
      return null
    }
    return cleanupText(matches[matches.length - 1][1])
  }

  return (
    extractFromPrompt(dequotedSegment, 'first') ||
    extractFromSummary(dequotedSegment, 'first') ||
    extractFromSummary(dequotedPrefix) ||
    extractFromPrompt(dequotedPrefix) ||
    extractPlainPath(dequotedSegment) ||
    extractPlainPath(dequotedPrefix) ||
    'n/a'
  )
}

export function extractFileFromPrompt(promptText: unknown): string | null {
  const text = String(promptText || '')
  if (!text || text === 'Prompt not found') {
    return null
  }

  const inPath = text.match(/In\s+`@?([^`\n]+\.[a-z0-9]+)`/i)
  if (inPath) {
    return cleanupText(inPath[1]).replace(/^@/, '')
  }

  const genericPath = text.match(/`@?([^`\n]+\.[a-z0-9]+)`/)
  if (genericPath) {
    return cleanupText(genericPath[1]).replace(/^@/, '')
  }

  return null
}

interface PotentialIssueBlock {
  start: number
  segment: string
  severity: string
  range: string
}

export function extractPotentialIssueBlocks(body: unknown): PotentialIssueBlock[] {
  const text = String(body || '')
  if (!/Potential issue/i.test(text)) {
    return []
  }

  const markerRegex = /(^|\n)\s*>?\s*(?:`([^`\n]+)`:\s*)?_⚠️\s*Potential issue_\s*\|\s*_[^_\n]*(Critical|Major|Minor|Unknown)[^_\n]*_/gi
  const markers: Array<{ start: number; explicitRange: string | null; severity: string }> = []

  let match: RegExpExecArray | null
  while ((match = markerRegex.exec(text)) !== null) {
    const prefixLength = match[1] ? match[1].length : 0
    markers.push({
      start: match.index + prefixLength,
      explicitRange: match[2] || null,
      severity: normalizeSeverity(match[3]),
    })
  }

  if (!markers.length) {
    const looseRegex = /(^|\n)\s*>?\s*(?:`([^`\n]+)`:\s*)?.*Potential issue.*$/gim
    while ((match = looseRegex.exec(text)) !== null) {
      const prefixLength = match[1] ? match[1].length : 0
      const severityMatch = match[0].match(/Critical|Major|Minor|Unknown/i)
      markers.push({
        start: match.index + prefixLength,
        explicitRange: match[2] || null,
        severity: normalizeSeverity(severityMatch ? severityMatch[0] : undefined),
      })
    }
  }

  if (!markers.length) {
    return []
  }

  const blocks: PotentialIssueBlock[] = []

  for (let i = 0; i < markers.length; i += 1) {
    const marker = markers[i]
    const next = markers[i + 1]
    const rawSegment = text.slice(marker.start, next ? next.start : text.length)

    blocks.push({
      start: marker.start,
      segment: rawSegment,
      severity: marker.severity,
      range: marker.explicitRange || extractLineRangeFromText(rawSegment) || 'n/a',
    })
  }

  return blocks
}

export function stableKeyForFinding(params: {
  sourceUrl: string
  file: string
  lines: string
  summary: string
  severity: string
}): string {
  const { sourceUrl, file, lines, summary, severity } = params
  if (sourceUrl && sourceUrl !== 'n/a') {
    return sourceUrl
  }
  return `${file}::${lines}::${summary}::${severity}`.toLowerCase()
}

export function parseAdditionalInfo(block: unknown): string {
  const lines = String(block || '').replace(/\r/g, '').split('\n')
  const preserved: string[] = []

  const knownSingleLineField = /^- (Status|Source|Source URL|Author|File|Lines|Severity|Summary|Validation Notes|Resolution Notes):\s*/
  const promptHeader = /^- Prompt for Fix:\s*$/
  const fenceStart = /^```(?:text)?\s*$/
  const fenceEnd = /^```\s*$/

  let index = 0
  while (index < lines.length) {
    const line = lines[index]

    if (knownSingleLineField.test(line)) {
      index += 1
      continue
    }

    if (promptHeader.test(line)) {
      index += 1
      if (index < lines.length && fenceStart.test(lines[index])) {
        index += 1
        while (index < lines.length && !fenceEnd.test(lines[index])) {
          index += 1
        }
        if (index < lines.length) {
          index += 1
        }
      }
      continue
    }

    preserved.push(line)
    index += 1
  }

  while (preserved.length && !preserved[0].trim()) {
    preserved.shift()
  }
  while (preserved.length && !preserved[preserved.length - 1].trim()) {
    preserved.pop()
  }

  return preserved.join('\n')
}

export function parseExistingEntries(filePath: string): ExistingEntries {
  if (!fs.existsSync(filePath)) {
    return { active: [], archived: [] }
  }

  const content = fs.readFileSync(filePath, 'utf8')
  const archiveHeader = '## Archived (no longer present in latest PR scan)'
  const archiveIndex = content.indexOf(archiveHeader)
  const activePart = archiveIndex >= 0 ? content.slice(0, archiveIndex) : content
  const archivedPart = archiveIndex >= 0 ? content.slice(archiveIndex + archiveHeader.length) : ''

  const parseBlocks = (text: string, headingRegex: RegExp): Finding[] => {
    const entries: Finding[] = []
    const matches = [...text.matchAll(headingRegex)]

    for (let i = 0; i < matches.length; i += 1) {
      const current = matches[i]
      const next = matches[i + 1]
      const id = current[1]
      const start = (current.index ?? 0) + current[0].length
      const end = next ? next.index ?? text.length : text.length
      const block = text.slice(start, end)

      const field = (label: string, fallback = 'n/a'): string => {
        const regex = new RegExp(`^- ${label}:\\s*(.*)$`, 'm')
        const m = block.match(regex)
        return m ? m[1].trim() : fallback
      }

      const promptMatch = block.match(/- Prompt for Fix:\n```text\n([\s\S]*?)\n```/m)
      const validationMatch = block.match(/- Validation Notes:\s*(.*)$/m)
      const resolutionMatch = block.match(/- Resolution Notes:\s*(.*)$/m)

      const rawStatus = field('Status', 'OPEN')
      const normalizedStatus: FindingStatus = VALID_STATUSES.has(rawStatus as FindingStatus)
        ? (rawStatus as FindingStatus)
        : 'OPEN'

      const item: Finding = {
        id,
        status: normalizedStatus,
        source: field('Source', 'n/a'),
        sourceUrl: field('Source URL', 'n/a'),
        author: field('Author', 'n/a'),
        file: field('File', 'n/a'),
        lines: field('Lines', 'n/a'),
        severity: normalizeSeverity(field('Severity', 'Unknown')),
        summary: field('Summary', 'Summary not found'),
        promptForFix: promptMatch ? String(promptMatch[1]).trim() : 'Prompt not found',
        validationNotes: validationMatch ? validationMatch[1].trim() : 'Pending',
        resolutionNotes: resolutionMatch ? resolutionMatch[1].trim() : 'Pending',
        additionalInfo: parseAdditionalInfo(block),
      }

      item.stableKey = stableKeyForFinding({
        sourceUrl: item.sourceUrl,
        file: item.file,
        lines: item.lines,
        summary: item.summary,
        severity: item.severity,
      })
      entries.push(item)
    }

    return entries
  }

  const active = parseBlocks(activePart, /^## (F-\d{4})\n/gm)
  const archived = parseBlocks(archivedPart, /^### ([A-Z]-\d{4}|F-\d{4}|A-\d{4})\n/gm)

  return { active, archived }
}

export function formatFindingBlock(headingPrefix: '##' | '###', item: Finding): string {
  const additionalInfo = (item.additionalInfo || '').trim()

  return [
    `${headingPrefix} ${item.id}`,
    `- Status: ${item.status}`,
    `- Source: ${item.source}`,
    `- Source URL: ${item.sourceUrl || 'n/a'}`,
    `- Author: ${item.author || 'n/a'}`,
    `- File: ${item.file || 'n/a'}`,
    `- Lines: ${item.lines || 'n/a'}`,
    `- Severity: ${item.severity || 'Unknown'}`,
    `- Summary: ${item.summary || 'Summary not found'}`,
    '- Prompt for Fix:',
    '```text',
    item.promptForFix || 'Prompt not found',
    '```',
    `- Validation Notes: ${item.validationNotes || 'Pending'}`,
    `- Resolution Notes: ${item.resolutionNotes || 'Pending'}`,
    ...(additionalInfo ? [additionalInfo] : []),
    '',
  ].join('\n')
}

export function collectFindingsFromInlineComments(comments: unknown[], resolvedDiscussionUrls: Set<string>): Finding[] {
  const findings: Finding[] = []

  for (const commentRaw of comments) {
    const comment = isObject(commentRaw) ? commentRaw : {}
    const user = isObject(comment.user) ? comment.user : {}
    const login = typeof user.login === 'string' ? user.login : ''
    const body = typeof comment.body === 'string' ? comment.body : ''

    if (!isCodeRabbitAuthor(login)) {
      continue
    }
    if (!/Potential issue/i.test(body)) {
      continue
    }

    const blocks = extractPotentialIssueBlocks(body)
    if (!blocks.length) {
      continue
    }

    const sourceUrl = typeof comment.html_url === 'string' ? comment.html_url : 'n/a'
    const isResolved = sourceUrl !== 'n/a' && resolvedDiscussionUrls.has(sourceUrl)

    blocks.forEach((block, index) => {
      const startLine = typeof comment.start_line === 'number' ? comment.start_line : undefined
      const line = typeof comment.line === 'number' ? comment.line : undefined
      const originalLine = typeof comment.original_line === 'number' ? comment.original_line : undefined
      const endLine = line ?? originalLine

      let lines = 'n/a'
      if (typeof startLine === 'number' && typeof endLine === 'number') {
        lines = startLine === endLine ? `${endLine}` : `${startLine}-${endLine}`
      } else if (typeof endLine === 'number') {
        lines = `${endLine}`
      } else if (block.range && block.range !== 'n/a') {
        lines = block.range
      }

      const finding: Finding = {
        source: 'inline-comment',
        sourceUrl: blocks.length > 1 ? `${sourceUrl}#pi-${index + 1}` : sourceUrl,
        author: login,
        file: typeof comment.path === 'string' ? comment.path : 'n/a',
        lines,
        severity: normalizeSeverity(block.severity),
        summary: parseSummary(block.segment),
        promptForFix: parsePromptForFix(block.segment),
        status: isResolved ? 'FIXED' : 'OPEN',
        validationNotes: 'Pending',
        resolutionNotes: 'Pending',
        isResolved,
      }

      finding.stableKey = stableKeyForFinding({
        sourceUrl: finding.sourceUrl,
        file: finding.file,
        lines: finding.lines,
        summary: finding.summary,
        severity: finding.severity,
      })
      findings.push(finding)
    })
  }

  return findings
}

export function collectFindingsFromBodyList(items: unknown[], sourceType: string): Finding[] {
  const findings: Finding[] = []

  for (const itemRaw of items) {
    const item = isObject(itemRaw) ? itemRaw : {}
    const user = isObject(item.user) ? item.user : {}
    const login = typeof user.login === 'string' ? user.login : ''
    const body = typeof item.body === 'string' ? item.body : ''

    if (!isCodeRabbitAuthor(login)) {
      continue
    }
    if (!/Potential issue/i.test(body)) {
      continue
    }

    const blocks = extractPotentialIssueBlocks(body)
    if (!blocks.length) {
      continue
    }

    const sourceUrlBase = typeof item.html_url === 'string' ? item.html_url : 'n/a'

    blocks.forEach((block, index) => {
      const promptForFix = parsePromptForFix(block.segment)
      const prefix = body.slice(0, block.start)
      const file = extractFileFromPrompt(promptForFix) || findNearestFilePath(prefix, block.segment)
      const lines = block.range || extractLineRangeFromText(block.segment) || 'n/a'

      const finding: Finding = {
        source: sourceType,
        sourceUrl: sourceUrlBase === 'n/a' ? 'n/a' : `${sourceUrlBase}#pi-${index + 1}`,
        author: login,
        file,
        lines,
        severity: normalizeSeverity(block.severity),
        summary: parseSummary(block.segment),
        promptForFix,
        status: 'OPEN',
        validationNotes: 'Pending',
        resolutionNotes: 'Pending',
      }

      finding.stableKey = stableKeyForFinding({
        sourceUrl: finding.sourceUrl,
        file: finding.file,
        lines: finding.lines,
        summary: finding.summary,
        severity: finding.severity,
      })
      findings.push(finding)
    })
  }

  return findings
}

export function dedupeFindings(findings: Finding[]): Finding[] {
  const byKey = new Map<string, Finding>()

  for (const finding of findings) {
    const stableKey = finding.stableKey || ''
    const existing = byKey.get(stableKey)

    if (!existing) {
      byKey.set(stableKey, finding)
      continue
    }

    const existingHasPrompt = existing.promptForFix && existing.promptForFix !== 'Prompt not found'
    const newHasPrompt = finding.promptForFix && finding.promptForFix !== 'Prompt not found'

    if (!existingHasPrompt && newHasPrompt) {
      byKey.set(stableKey, finding)
    }
  }

  return [...byKey.values()]
}

export function preserveExistingOrder(currentFindings: Finding[], existingEntries: Finding[]): Finding[] {
  const orderByKey = new Map<string, number>()

  existingEntries.forEach((item, index) => {
    if (item.stableKey && !orderByKey.has(item.stableKey)) {
      orderByKey.set(item.stableKey, index)
    }
  })

  const known: Finding[] = []
  const fresh: Finding[] = []

  for (const finding of currentFindings) {
    if (finding.stableKey && orderByKey.has(finding.stableKey)) {
      known.push(finding)
    } else {
      fresh.push(finding)
    }
  }

  known.sort((a, b) => {
    const keyA = a.stableKey || ''
    const keyB = b.stableKey || ''
    return (orderByKey.get(keyA) ?? Number.MAX_SAFE_INTEGER) - (orderByKey.get(keyB) ?? Number.MAX_SAFE_INTEGER)
  })

  return [...known, ...fresh]
}

export function validateCodeRabbitAccess(pullComments: unknown[], reviews: unknown[], issueComments: unknown[]): void {
  const botObjects = [
    ...pullComments.filter((x) => isCodeRabbitAuthor(isObject(x) && isObject(x.user) ? x.user.login : undefined)),
    ...reviews.filter((x) => isCodeRabbitAuthor(isObject(x) && isObject(x.user) ? x.user.login : undefined)),
    ...issueComments.filter((x) => isCodeRabbitAuthor(isObject(x) && isObject(x.user) ? x.user.login : undefined)),
  ]

  if (!botObjects.length) {
    throw new Error('No CodeRabbit data is accessible for this PR (no bot-authored comments/reviews found)')
  }
}

export function ensureStatuses(findings: Finding[], existingActive: Finding[], existingArchived: Finding[]): void {
  const statusByKey = new Map<
    string,
    { status: FindingStatus; validationNotes: string; resolutionNotes: string; additionalInfo: string }
  >()

  for (const item of [...existingActive, ...existingArchived]) {
    const key = item.stableKey
    if (!key) {
      continue
    }

    const status: FindingStatus = VALID_STATUSES.has(item.status) ? item.status : 'OPEN'
    statusByKey.set(key, {
      status,
      validationNotes: item.validationNotes || 'Pending',
      resolutionNotes: item.resolutionNotes || 'Pending',
      additionalInfo: item.additionalInfo || '',
    })
  }

  for (const finding of findings) {
    const key = finding.stableKey
    if (!key) {
      continue
    }

    const old = statusByKey.get(key)
    if (!old) {
      continue
    }

    finding.status = old.status
    finding.validationNotes = old.validationNotes
    finding.resolutionNotes = old.resolutionNotes
    finding.additionalInfo = old.additionalInfo
  }
}

export function applyResolvedStatusRules(findings: Finding[]): void {
  for (const finding of findings) {
    if (finding.isResolved) {
      finding.status = 'FIXED'
    }
  }
}

export function buildArchive(existingActive: Finding[], existingArchived: Finding[], currentFindings: Finding[]): Finding[] {
  const currentKeys = new Set(currentFindings.map((x) => x.stableKey))

  const movedFromActive = existingActive.filter((x) => !currentKeys.has(x.stableKey))
  const combined = [...existingArchived, ...movedFromActive]

  const unique = new Map<string | undefined, Finding>()
  for (const item of combined) {
    if (!unique.has(item.stableKey)) {
      unique.set(item.stableKey, item)
    }
  }

  const archive = [...unique.values()]

  archive.forEach((item, index) => {
    if (!item.id || !/^([A-Z]-\d{4}|F-\d{4}|A-\d{4})$/.test(item.id)) {
      item.id = `A-${String(index + 1).padStart(4, '0')}`
    }
  })

  return archive
}

export function main(): void {
  const prUrl = process.argv[2] || detectCurrentPrUrl()
  const { owner, repo, prNumber } = parsePrUrl(prUrl)

  const prMeta = ghApiJson(`repos/${owner}/${repo}/pulls/${prNumber}`)
  const prMetaObj = isObject(prMeta) ? prMeta : null

  const base = prMetaObj && isObject(prMetaObj.base) ? prMetaObj.base : null
  const baseRepoObj = base && isObject(base.repo) ? base.repo : null
  const head = prMetaObj && isObject(prMetaObj.head) ? prMetaObj.head : null

  const baseRepo = baseRepoObj && typeof baseRepoObj.full_name === 'string' ? baseRepoObj.full_name : null
  const headRef = head && typeof head.ref === 'string' ? head.ref : null

  if (!baseRepo || !headRef) {
    throw new Error(`PR metadata is incomplete for ${prUrl}`)
  }

  const branchSlug = slugifyBranch(headRef)
  const outputFileName = `coderabbit-findings-${branchSlug}.md`
  const outputPath = path.join(process.cwd(), outputFileName)

  const pullComments = fetchAllPages(`repos/${owner}/${repo}/pulls/${prNumber}/comments`)
  const reviews = fetchAllPages(`repos/${owner}/${repo}/pulls/${prNumber}/reviews`)
  const issueComments = fetchAllPages(`repos/${owner}/${repo}/issues/${prNumber}/comments`)
  const resolvedDiscussionUrls = fetchResolvedCodeRabbitDiscussionUrls({ owner, repo, prNumber })

  validateCodeRabbitAccess(pullComments, reviews, issueComments)

  const findingsRaw = [
    ...collectFindingsFromInlineComments(pullComments, resolvedDiscussionUrls),
    ...collectFindingsFromBodyList(reviews, 'review-summary'),
    ...collectFindingsFromBodyList(issueComments, 'issue-comment'),
  ]

  const findingsDeduped = dedupeFindings(findingsRaw)

  const existing = parseExistingEntries(outputPath)
  const findingsOrdered = preserveExistingOrder(findingsDeduped, [...existing.active, ...existing.archived])
  ensureStatuses(findingsOrdered, existing.active, existing.archived)
  applyResolvedStatusRules(findingsOrdered)

  findingsOrdered.forEach((finding, index) => {
    finding.id = `F-${String(index + 1).padStart(4, '0')}`
  })

  const archiveEntries = buildArchive(existing.active, existing.archived, findingsOrdered)

  const counts: Record<FindingStatus, number> = { OPEN: 0, FIXED: 0, REJECTED: 0 }

  findingsOrdered.forEach((item) => {
    if (!VALID_STATUSES.has(item.status)) {
      item.status = 'OPEN'
    }
    counts[item.status] += 1
  })

  const lines: string[] = []
  lines.push('# CodeRabbit Findings')
  lines.push('')
  lines.push(`- PR URL: ${prUrl}`)
  lines.push(`- Repository: ${baseRepo}`)
  lines.push(`- PR Number: ${prNumber}`)
  lines.push(`- PR Branch: ${headRef}`)
  lines.push(`- Generated At (UTC): ${new Date().toISOString()}`)
  lines.push(`- Total Findings: ${findingsOrdered.length}`)
  lines.push(`- Open Findings: ${counts.OPEN}`)
  lines.push(`- Fixed Findings: ${counts.FIXED}`)
  lines.push(`- Rejected Findings: ${counts.REJECTED}`)
  lines.push('- Status values: OPEN | FIXED | REJECTED')
  lines.push('')

  for (const finding of findingsOrdered) {
    lines.push(formatFindingBlock('##', finding))
  }

  if (archiveEntries.length) {
    lines.push('## Archived (no longer present in latest PR scan)')
    lines.push('')
    for (const archived of archiveEntries) {
      lines.push(formatFindingBlock('###', archived))
    }
  }

  fs.writeFileSync(outputPath, `${lines.join('\n').trimEnd()}\n`, 'utf8')

  console.log(`Output file path: ${outputPath}`)
  console.log(`PR branch: ${headRef}`)
  console.log(`PR branch slug: ${branchSlug}`)
  console.log(`Collected findings: ${findingsOrdered.length}`)
  console.log(`Status counts: OPEN=${counts.OPEN}, FIXED=${counts.FIXED}, REJECTED=${counts.REJECTED}`)
}

if (import.meta.main) {
  main()
}
