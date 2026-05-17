export type RouteId = 'overview' | 'issues' | 'context' | 'docs' | 'settings'

export interface RouteDefinition {
  readonly id: RouteId
  readonly path: `/${string}`
}

export interface NavItem extends RouteDefinition {
  readonly active: boolean
}

export const ROUTE_DEFINITIONS = [
  {
    id: 'overview',
    path: '/overview',
  },
  {
    id: 'issues',
    path: '/issues',
  },
  {
    id: 'context',
    path: '/context',
  },
  {
    id: 'docs',
    path: '/docs',
  },
  {
    id: 'settings',
    path: '/settings',
  },
] as const satisfies readonly RouteDefinition[]

export const routes = ROUTE_DEFINITIONS

export const defaultRoute = ROUTE_DEFINITIONS[0]

export function normalizePathname(pathname: string): string {
  const trimmed = pathname.trim()
  const [pathWithoutQuery = '/'] = trimmed.split(/[?#]/)
  const withLeadingSlash = pathWithoutQuery.startsWith('/')
    ? pathWithoutQuery
    : `/${pathWithoutQuery}`

  const normalized = withLeadingSlash.toLowerCase().replace(/\/+/g, '/')
  const withoutTrailingSlash = normalized.replace(/\/+$/, '')

  return withoutTrailingSlash === '' ? '/' : withoutTrailingSlash
}

const isMatchingRoute = (normalizedPath: string, routePath: RouteDefinition['path']): boolean =>
  normalizedPath === routePath || normalizedPath.startsWith(`${routePath}/`)

export function findRouteByPath(pathname: string): RouteDefinition | undefined {
  const normalized = normalizePathname(pathname)
  return ROUTE_DEFINITIONS.find((route) => isMatchingRoute(normalized, route.path))
}

export const routeForPath = (pathname: string): RouteDefinition =>
  findRouteByPath(pathname) ?? defaultRoute

export function buildNavItems(pathname: string): NavItem[] {
  const activeRoute = routeForPath(pathname)

  return ROUTE_DEFINITIONS.map((route) => ({
    ...route,
    active: route.id === activeRoute.id,
  }))
}

export const buildNavigationItems = buildNavItems
