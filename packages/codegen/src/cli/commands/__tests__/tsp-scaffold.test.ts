import { describe, expect, it } from 'vitest'
import { generateTypeSpecScaffold, tspScaffold } from '../tsp-scaffold.js'

describe('tsp-scaffold', () => {
  it('generates GET operation with path parameters and response model', () => {
    const result = generateTypeSpecScaffold({
      route: '/users/{id}/profile',
      method: 'get',
      summary: '사용자 프로필 조회',
    })

    expect(result.operationId).toBe('getUserByIdProfile')
    expect(result.responseModelName).toBe('GetUserByIdProfile200Response')
    expect(result.requestModelName).toBeUndefined()

    expect(result.code).toContain('@summary("사용자 프로필 조회")')
    expect(result.code).toContain('@route("/users/{id}/profile")')
    expect(result.code).toContain('@get')
    expect(result.code).toContain('@path id: string')
    expect(result.code).toContain('@oaUseResponseComponent("401", "Unauthorized")')
    expect(result.code).toContain('model GetUserByIdProfile200Response {')
    expect(result.code).toContain('@statusCode statusCode: 200;')
  })

  it('generates POST operation with request body DTO and 201 response', () => {
    const result = generateTypeSpecScaffold({
      route: '/articles',
      method: 'post',
      operationId: 'createArticle',
      summary: '게시글 생성',
    })

    expect(result.operationId).toBe('createArticle')
    expect(result.requestModelName).toBe('CreateArticleRequest')
    expect(result.responseModelName).toBe('CreateArticle201Response')

    expect(result.code).toContain('model CreateArticleRequest {')
    expect(result.code).toContain('model CreateArticle201Response {')
    expect(result.code).toContain('@statusCode statusCode: 201;')
    expect(result.code).toContain('@post')
    expect(result.code).toContain('@body body: CreateArticleRequest')
  })

  it('respects auth: none option', () => {
    const result = generateTypeSpecScaffold({
      route: '/health',
      method: 'get',
      auth: 'none',
    })

    expect(result.code).not.toContain('@useAuth')
  })

  it('exports valid Command definition', () => {
    expect(tspScaffold.name).toBe('tsp-scaffold')
    expect(tspScaffold.options?.route).toBeDefined()
    expect(tspScaffold.options?.method).toBeDefined()
    expect(tspScaffold.options?.file).toBeDefined()
  })
})
