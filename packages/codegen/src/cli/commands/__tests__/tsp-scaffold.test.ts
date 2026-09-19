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

  it('generates full CRUD resource suite with generic envelopes', () => {
    const result = generateTypeSpecScaffold({
      route: '/products',
      crud: true,
      envelope: true,
    })

    expect(result.operationId).toBe('crudProduct')
    expect(result.code).toContain('model Product {')
    expect(result.code).toContain('model CreateProductRequest {')
    expect(result.code).toContain('model UpdateProductRequest {')
    expect(result.code).toContain('op listProducts(')
    expect(result.code).toContain('): Ok<PageResult<Product>>;')
    expect(result.code).toContain('op getProductById(')
    expect(result.code).toContain('): Ok<Product>;')
    expect(result.code).toContain('op createProduct(')
    expect(result.code).toContain('): Created<Product>;')
    expect(result.code).toContain('op updateProduct(')
    expect(result.code).toContain('): Ok<Product>;')
    expect(result.code).toContain('op deleteProduct(')
    expect(result.code).toContain('): NoContent;')
  })

  it('generates full CRUD resource suite without envelopes (legacy response models)', () => {
    const result = generateTypeSpecScaffold({
      route: '/orders',
      crud: true,
      envelope: false,
    })

    expect(result.operationId).toBe('crudOrder')
    expect(result.code).toContain('model ListOrders200Response {')
    expect(result.code).toContain('model GetOrderById200Response {')
    expect(result.code).toContain('model CreateOrder201Response {')
    expect(result.code).toContain('model UpdateOrder200Response {')
    expect(result.code).toContain('model DeleteOrder204Response {')
    expect(result.code).toContain('): ListOrders200Response;')
    expect(result.code).toContain('): GetOrderById200Response;')
  })

  it('generates single operation with generic envelope', () => {
    const result = generateTypeSpecScaffold({
      route: '/items',
      method: 'post',
      operationId: 'createItem',
      envelope: true,
    })

    expect(result.responseModelName).toBe('Created<CreateItemResult>')
    expect(result.code).toContain('op createItem(')
    expect(result.code).toContain('): Created<CreateItemResult>;')
  })

  it('exports valid Command definition', () => {
    expect(tspScaffold.name).toBe('tsp-scaffold')
    expect(tspScaffold.options?.route).toBeDefined()
    expect(tspScaffold.options?.method).toBeDefined()
    expect(tspScaffold.options?.file).toBeDefined()
    expect(tspScaffold.options?.crud).toBeDefined()
    expect(tspScaffold.options?.envelope).toBeDefined()
  })
})
