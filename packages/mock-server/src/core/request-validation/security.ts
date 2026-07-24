import type { OasSecurityRequirement, OasSecurityScheme } from '@oa-sdk/parser'
import type { MockErrorDetail } from '../../errors/types.js'

export type SecurityRequestParts = {
  queryParams: Record<string, string | string[]>
  headers: Record<string, string>
}

/**
 * Validates credential presence only; token validity belongs to the service.
 * Security requirement entries are OR-ed and schemes inside each entry are AND-ed.
 */
export function validateSecurity(
  parts: SecurityRequestParts,
  requirements: OasSecurityRequirement[],
  schemes: Record<string, OasSecurityScheme>,
): MockErrorDetail[] {
  if (requirements.length === 0) return []

  for (const requirement of requirements) {
    const schemeNames = Object.keys(requirement)
    if (schemeNames.length === 0) return []

    const satisfied = schemeNames.every(name => {
      const scheme = schemes[name]
      return scheme !== undefined && hasSchemeCredential(parts, scheme)
    })
    if (satisfied) return []
  }

  return [{
    path: '/security',
    code: 'MISSING_REQUIRED_FIELD',
    message: '인증 자격 증명이 필요합니다',
    expected: requirements.map(requirement => Object.keys(requirement).join(' + ')).join(' 또는 '),
    stage: 'validate',
  }]
}

function hasSchemeCredential(parts: SecurityRequestParts, scheme: OasSecurityScheme): boolean {
  switch (scheme.type) {
    case 'http': {
      const authorization = parts.headers.authorization ?? ''
      if (scheme.scheme === 'bearer') return authorization.toLowerCase().startsWith('bearer ')
      if (scheme.scheme === 'basic') return authorization.toLowerCase().startsWith('basic ')
      return authorization.length > 0
    }
    case 'apiKey': {
      const location = scheme.in ?? 'header'
      const name = scheme.name ?? ''
      if (location === 'header') return (parts.headers[name.toLowerCase()] ?? '').length > 0
      if (location === 'query') return parts.queryParams[name] !== undefined
      if (location === 'cookie') return parseCookies(parts.headers.cookie ?? '')[name] !== undefined
      return false
    }
    case 'openIdConnect':
    case 'oauth2':
      return (parts.headers.authorization ?? '').toLowerCase().startsWith('bearer ')
    case 'mutualTLS':
      return true
    default:
      return true
  }
}

export function parseCookies(cookieHeader: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const pair of cookieHeader.split(';')) {
    const index = pair.indexOf('=')
    if (index === -1) continue
    const key = pair.slice(0, index).trim()
    if (key) result[key] = pair.slice(index + 1).trim()
  }
  return result
}
