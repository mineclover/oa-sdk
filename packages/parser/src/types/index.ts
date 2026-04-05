/**
 * OAS 3.2 타입 인덱스
 *
 * 공식 스펙 섹션과 1:1 매핑:
 *   common.ts       — Referenceable<T>, OasReference
 *   document.ts     — §3  Root, Info, Contact, License
 *   server.ts       — §4  Server, ServerVariable
 *   components.ts   — §5  Components, Paths
 *   operations.ts   — §6  PathItem, Operation, ExternalDocs
 *   parameters.ts   — §7  Parameter
 *   request-body.ts — §8  RequestBody, MediaType, Encoding
 *   responses.ts    — §9  Responses, Response, Callback
 *   examples.ts     — §10 Example, Link
 *   headers-tags.ts — §11 Header, Tag
 *   schema.ts       — §12 Schema, Discriminator
 *   xml.ts          — §13 XML
 *   security.ts     — §14 SecurityScheme, OAuthFlows, SecurityRequirement
 */

export type { OasReference, Referenceable, OasExtensions } from './common.js'
export type { OasDocument, OasInfo, OasContact, OasLicense } from './document.js'
export type { OasServer, OasServerVariable } from './server.js'
export type { OasComponents, OasPaths } from './components.js'
export type { OasPathItem, OasOperation, OasExternalDocs } from './operations.js'
export type { OasParameter, OasParameterIn } from './parameters.js'
export type { OasRequestBody, OasMediaType, OasEncoding } from './request-body.js'
export type { OasResponses, OasResponse, OasCallback } from './responses.js'
export type { OasExample, OasLink } from './examples.js'
export type { OasHeader, OasTag } from './headers-tags.js'
export type { OasSchema, OasDiscriminator } from './schema.js'
export type { OasXml, OasXmlNodeType } from './xml.js'
export type {
  OasSecuritySchemeType, OasSecurityScheme,
  OasOAuthFlows, OasOAuthFlow,
  OasSecurityRequirement,
} from './security.js'
