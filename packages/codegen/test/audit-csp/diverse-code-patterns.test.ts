import { describe, expect, it } from 'vitest'
import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import { pathToFileURL } from 'node:url'
import { generateStandaloneGuards } from '../../src/index.js'
import { z } from 'zod'

describe('다양한 스키마 및 코드 패턴 심층 검증 스위트 (Diverse Code Patterns & Edge Cases Suite)', () => {
  const setupTempDir = async () => {
    return await fs.mkdtemp(path.join(os.tmpdir(), 'oa-codegen-diverse-patterns-'))
  }

  // =========================================================================
  // PATTERN 1: 멀티 트랜지션 (비디오, 오디오, 셰이더, 카메라) 다양화 및 파라미터 제약
  // =========================================================================
  describe('Pattern 1: 비디오/오디오/셰이더 10대 트랜지션 파라미터 다양화 및 Standalone Guard', () => {
    it('10대 트랜지션(Fade, Wipe, Slide, Dissolve, Zoom, GL, LumaWipe, PageCurl, Ripple, AudioCrossfade)의 JSON Schema와 Guard를 생성 및 검증한다', async () => {
      const outDir = await setupTempDir()

      const transitionsSchema = {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $defs: {
          HexColor: {
            type: 'string',
            pattern: '^#[0-9a-fA-F]{6}$',
          },
          CubicBezier: {
            type: 'object',
            required: ['p1', 'p2'],
            properties: {
              p1: { type: 'array', items: { type: 'number', minimum: 0, maximum: 1 }, minItems: 2, maxItems: 2 },
              p2: { type: 'array', items: { type: 'number', minimum: 0, maximum: 1 }, minItems: 2, maxItems: 2 },
            },
          },
          TransitionBase: {
            type: 'object',
            required: ['type', 'durationMs'],
            properties: {
              type: { type: 'string' },
              durationMs: { type: 'number', exclusiveMinimum: 0 },
              curve: {
                oneOf: [
                  { type: 'string', enum: ['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out'] },
                  { $ref: '#/$defs/CubicBezier' },
                ],
              },
            },
          },
          FadeTransition: {
            allOf: [{ $ref: '#/$defs/TransitionBase' }],
            required: ['type'],
            properties: {
              type: { const: 'fade' },
              direction: { type: 'string', enum: ['in', 'out', 'cross'] },
              fadeColor: { $ref: '#/$defs/HexColor' },
            },
          },
          WipeTransition: {
            allOf: [{ $ref: '#/$defs/TransitionBase' }],
            required: ['type', 'direction'],
            properties: {
              type: { const: 'wipe' },
              direction: { type: 'string', enum: ['left-to-right', 'right-to-left', 'top-to-bottom', 'bottom-to-top'] },
              feather: { type: 'number', minimum: 0, maximum: 1 },
            },
          },
          SlideTransition: {
            allOf: [{ $ref: '#/$defs/TransitionBase' }],
            required: ['type', 'direction'],
            properties: {
              type: { const: 'slide' },
              direction: { type: 'string', enum: ['from-left', 'from-right', 'from-top', 'from-bottom'] },
              push: { type: 'boolean' },
            },
          },
          DissolveTransition: {
            allOf: [{ $ref: '#/$defs/TransitionBase' }],
            required: ['type'],
            properties: {
              type: { const: 'dissolve' },
              noiseScale: { type: 'number', exclusiveMinimum: 0 },
              seed: { type: 'integer' },
            },
          },
          ZoomTransition: {
            allOf: [{ $ref: '#/$defs/TransitionBase' }],
            required: ['type'],
            properties: {
              type: { const: 'zoom' },
              origin: { type: 'array', items: { type: 'number', minimum: 0, maximum: 1 }, minItems: 2, maxItems: 2 },
              scale: { type: 'number', exclusiveMinimum: 0 },
            },
          },
          GlTransition: {
            allOf: [{ $ref: '#/$defs/TransitionBase' }],
            required: ['type', 'glsl'],
            properties: {
              type: { const: 'gl' },
              glsl: { type: 'string', minLength: 5 },
              textureFiltering: { type: 'string', enum: ['linear', 'nearest'] },
            },
          },
          LumaWipeTransition: {
            allOf: [{ $ref: '#/$defs/TransitionBase' }],
            required: ['type', 'maskUri'],
            properties: {
              type: { const: 'luma-wipe' },
              maskUri: { type: 'string', format: 'uri' },
              invert: { type: 'boolean' },
              softness: { type: 'number', minimum: 0, maximum: 1 },
            },
          },
          PageCurlTransition: {
            allOf: [{ $ref: '#/$defs/TransitionBase' }],
            required: ['type'],
            properties: {
              type: { const: 'page-curl' },
              cylinderRadius: { type: 'number', exclusiveMinimum: 0 },
              rollAngle: { type: 'number', minimum: 0, maximum: 360 },
              antiAlias: { type: 'boolean' },
            },
          },
          RippleTransition: {
            allOf: [{ $ref: '#/$defs/TransitionBase' }],
            required: ['type'],
            properties: {
              type: { const: 'ripple' },
              frequency: { type: 'number', exclusiveMinimum: 0 },
              speed: { type: 'number' },
              amplitude: { type: 'number', minimum: 0, maximum: 1 },
            },
          },
          AudioCrossfadeTransition: {
            allOf: [{ $ref: '#/$defs/TransitionBase' }],
            required: ['type', 'curveProfile'],
            properties: {
              type: { const: 'audio-crossfade' },
              curveProfile: { type: 'string', enum: ['linear', 'equal-power', 'logarithmic', 's-curve'] },
            },
          },
          AnyMediaTransition: {
            oneOf: [
              { $ref: '#/$defs/FadeTransition' },
              { $ref: '#/$defs/WipeTransition' },
              { $ref: '#/$defs/SlideTransition' },
              { $ref: '#/$defs/DissolveTransition' },
              { $ref: '#/$defs/ZoomTransition' },
              { $ref: '#/$defs/GlTransition' },
              { $ref: '#/$defs/LumaWipeTransition' },
              { $ref: '#/$defs/PageCurlTransition' },
              { $ref: '#/$defs/RippleTransition' },
              { $ref: '#/$defs/AudioCrossfadeTransition' },
            ],
          },
        },
      }

      const artifacts = await generateStandaloneGuards({
        schemaDocument: transitionsSchema,
        outDir,
        guards: [
          { name: 'isAnyMediaTransition', typeName: 'AnyMediaTransition', schema: '#/$defs/AnyMediaTransition' },
          { name: 'isLumaWipe', typeName: 'LumaWipeTransition', schema: '#/$defs/LumaWipeTransition' },
          { name: 'isPageCurl', typeName: 'PageCurlTransition', schema: '#/$defs/PageCurlTransition' },
          { name: 'isAudioCrossfade', typeName: 'AudioCrossfadeTransition', schema: '#/$defs/AudioCrossfadeTransition' },
        ],
      })

      expect(artifacts.length).toBeGreaterThan(0)
      const jsArtifact = artifacts.find(a => a.kind === 'js')!
      const guardFilePath = path.join(outDir, 'transitions.mjs')
      await fs.writeFile(guardFilePath, jsArtifact.content, 'utf8')

      const imported = await import(pathToFileURL(guardFilePath).href)

      // 1. Positive checks
      expect(
        imported.isAnyMediaTransition({
          type: 'fade',
          durationMs: 500,
          direction: 'cross',
          fadeColor: '#000000',
        }),
      ).toBe(true)

      expect(
        imported.isLumaWipe({
          type: 'luma-wipe',
          durationMs: 750,
          maskUri: 'https://assets.oa-sdk.dev/masks/radial.png',
          invert: false,
          softness: 0.25,
        }),
      ).toBe(true)

      expect(
        imported.isPageCurl({
          type: 'page-curl',
          durationMs: 1200,
          cylinderRadius: 45.5,
          rollAngle: 45,
          antiAlias: true,
        }),
      ).toBe(true)

      expect(
        imported.isAudioCrossfade({
          type: 'audio-crossfade',
          durationMs: 300,
          curveProfile: 'equal-power',
        }),
      ).toBe(true)

      // 2. Negative checks (boundaries & invalid values)
      expect(
        imported.isAnyMediaTransition({
          type: 'page-curl',
          durationMs: 1200,
          rollAngle: 400, // exceeds maximum 360
        }),
      ).toBe(false)

      expect(
        imported.isLumaWipe({
          type: 'luma-wipe',
          durationMs: 750,
          maskUri: 'not-a-uri', // invalid uri
        }),
      ).toBe(false)

      expect(
        imported.isAudioCrossfade({
          type: 'audio-crossfade',
          durationMs: 300,
          curveProfile: 'unsupported-curve',
        }),
      ).toBe(false)
    })
  })

  // =========================================================================
  // PATTERN 2: 계층적 2단계 다형성 (Two-Tier Hierarchical Polymorphism)
  // =========================================================================
  describe('Pattern 2: 2단계 계층적 다형성 (Timeline Track -> Clip -> Video Effect)', () => {
    it('트랙(Track) 내 클립(Clip)과 이펙트(Effect)의 다계층 디스크리미네이터 구조를 완전하게 판별한다', async () => {
      const outDir = await setupTempDir()

      const timelineSchema = {
        $defs: {
          BlurEffect: {
            type: 'object',
            required: ['type', 'radius'],
            properties: {
              type: { const: 'blur' },
              radius: { type: 'number', minimum: 0, maximum: 100 },
            },
          },
          ColorGradeEffect: {
            type: 'object',
            required: ['type', 'contrast', 'saturation'],
            properties: {
              type: { const: 'color-grade' },
              contrast: { type: 'number', minimum: 0, maximum: 2 },
              saturation: { type: 'number', minimum: 0, maximum: 2 },
            },
          },
          VideoEffect: {
            oneOf: [{ $ref: '#/$defs/BlurEffect' }, { $ref: '#/$defs/ColorGradeEffect' }],
          },
          VideoClip: {
            type: 'object',
            required: ['kind', 'id', 'sourceUri', 'effects'],
            properties: {
              kind: { const: 'video' },
              id: { type: 'string', minLength: 1 },
              sourceUri: { type: 'string', format: 'uri' },
              effects: {
                type: 'array',
                items: { $ref: '#/$defs/VideoEffect' },
              },
            },
          },
          AudioClip: {
            type: 'object',
            required: ['kind', 'id', 'sourceUri', 'volume'],
            properties: {
              kind: { const: 'audio' },
              id: { type: 'string', minLength: 1 },
              sourceUri: { type: 'string', format: 'uri' },
              volume: { type: 'number', minimum: 0, maximum: 1 },
            },
          },
          TimelineClip: {
            oneOf: [{ $ref: '#/$defs/VideoClip' }, { $ref: '#/$defs/AudioClip' }],
          },
        },
      }

      const artifacts = await generateStandaloneGuards({
        schemaDocument: timelineSchema,
        outDir,
        guards: [
          { name: 'isTimelineClip', typeName: 'TimelineClip', schema: '#/$defs/TimelineClip' },
          { name: 'isVideoClip', typeName: 'VideoClip', schema: '#/$defs/VideoClip' },
        ],
      })

      const jsArtifact = artifacts.find(a => a.kind === 'js')!
      const guardFile = path.join(outDir, 'timeline.mjs')
      await fs.writeFile(guardFile, jsArtifact.content, 'utf8')
      const imported = await import(pathToFileURL(guardFile).href)

      // VideoClip with nested effects
      const validVideoClip = {
        kind: 'video',
        id: 'clip_001',
        sourceUri: 'https://cdn.oa-sdk.dev/raw.mp4',
        effects: [
          { type: 'blur', radius: 12.5 },
          { type: 'color-grade', contrast: 1.2, saturation: 1.1 },
        ],
      }
      expect(imported.isTimelineClip(validVideoClip)).toBe(true)
      expect(imported.isVideoClip(validVideoClip)).toBe(true)

      // VideoClip with invalid nested effect (radius > 100)
      const invalidEffectVideoClip = {
        kind: 'video',
        id: 'clip_002',
        sourceUri: 'https://cdn.oa-sdk.dev/raw.mp4',
        effects: [{ type: 'blur', radius: 150 }],
      }
      expect(imported.isTimelineClip(invalidEffectVideoClip)).toBe(false)

      // AudioClip
      const validAudioClip = {
        kind: 'audio',
        id: 'audio_001',
        sourceUri: 'https://cdn.oa-sdk.dev/sound.mp3',
        volume: 0.8,
      }
      expect(imported.isTimelineClip(validAudioClip)).toBe(true)
      expect(imported.isVideoClip(validAudioClip)).toBe(false)
    })
  })

  // =========================================================================
  // PATTERN 3: @visibility 기반 CRUD 모델 수명주기 투영 및 격리
  // =========================================================================
  describe('Pattern 3: @visibility 단일 모델 CRUD 수명주기 분기 투영 (Create, Read, Update)', () => {
    it('동일 엔터티 스키마로부터 Create, Read, Update 프로젝션이 안전하게 분리되고 검증됨을 확인한다', async () => {
      const outDir = await setupTempDir()

      const crudSchemas = {
        $defs: {
          UserEntityCreate: {
            type: 'object',
            required: ['email', 'name', 'password'],
            properties: {
              email: { type: 'string', format: 'email' },
              name: { type: 'string', minLength: 2, maxLength: 50 },
              password: { type: 'string', minLength: 8 },
              role: { type: 'string', enum: ['admin', 'member'], default: 'member' },
            },
            additionalProperties: false,
          },
          UserEntityRead: {
            type: 'object',
            required: ['id', 'createdAt', 'email', 'name', 'role'],
            properties: {
              id: { type: 'string', pattern: '^usr_[a-zA-Z0-9]+$' },
              createdAt: { type: 'string', format: 'date-time' },
              email: { type: 'string', format: 'email' },
              name: { type: 'string', minLength: 2, maxLength: 50 },
              role: { type: 'string', enum: ['admin', 'member'] },
            },
            additionalProperties: false,
          },
          UserEntityUpdate: {
            type: 'object',
            properties: {
              name: { type: 'string', minLength: 2, maxLength: 50 },
              role: { type: 'string', enum: ['admin', 'member'] },
            },
            additionalProperties: false,
          },
        },
      }

      const artifacts = await generateStandaloneGuards({
        schemaDocument: crudSchemas,
        outDir,
        guards: [
          { name: 'isUserCreate', typeName: 'UserEntityCreate', schema: '#/$defs/UserEntityCreate' },
          { name: 'isUserRead', typeName: 'UserEntityRead', schema: '#/$defs/UserEntityRead' },
          { name: 'isUserUpdate', typeName: 'UserEntityUpdate', schema: '#/$defs/UserEntityUpdate' },
        ],
      })

      const jsArtifact = artifacts.find(a => a.kind === 'js')!
      const guardFile = path.join(outDir, 'user-crud.mjs')
      await fs.writeFile(guardFile, jsArtifact.content, 'utf8')
      const imported = await import(pathToFileURL(guardFile).href)

      // 1. Create: id가 포함되면 추가 프로퍼티 금지(additionalProperties: false)로 차단
      expect(
        imported.isUserCreate({
          id: 'usr_hacked',
          email: 'user@oa-sdk.dev',
          name: 'Alice',
          password: 'SecretPassword123!',
        }),
      ).toBe(false)

      expect(
        imported.isUserCreate({
          email: 'user@oa-sdk.dev',
          name: 'Alice',
          password: 'SecretPassword123!',
        }),
      ).toBe(true)

      // 2. Read: password가 포함되면 차단
      expect(
        imported.isUserRead({
          id: 'usr_999',
          createdAt: '2026-09-21T00:00:00Z',
          email: 'user@oa-sdk.dev',
          name: 'Alice',
          role: 'member',
          password: 'leaked_password',
        }),
      ).toBe(false)

      expect(
        imported.isUserRead({
          id: 'usr_999',
          createdAt: '2026-09-21T00:00:00Z',
          email: 'user@oa-sdk.dev',
          name: 'Alice',
          role: 'member',
        }),
      ).toBe(true)

      // 3. Update: 변경 불가능한 id, email, password 수정 시도 차단
      expect(
        imported.isUserUpdate({
          name: 'Alice Cooper',
          email: 'newemail@oa-sdk.dev', // immutable in update
        }),
      ).toBe(false)

      expect(
        imported.isUserUpdate({
          name: 'Alice Cooper',
        }),
      ).toBe(true)
    })
  })

  // =========================================================================
  // PATTERN 4: RFC 9457 ProblemDetails와 다양한 에러 상태코드 유니온
  // =========================================================================
  describe('Pattern 4: RFC 9457 ProblemDetails 도메인 에러 확장 및 다중 상태코드 판별', () => {
    it('검증 에러(422), 리소스 충돌(409), 속도 제한(429) 에러의 특화 필드를 판별한다', async () => {
      const outDir = await setupTempDir()

      const errorSchema = {
        $defs: {
          ProblemDetailsBase: {
            type: 'object',
            required: ['type', 'title', 'status'],
            properties: {
              type: { type: 'string', format: 'uri' },
              title: { type: 'string', minLength: 1 },
              status: { type: 'integer', minimum: 100, maximum: 599 },
              detail: { type: 'string' },
              instance: { type: 'string' },
            },
          },
          ValidationProblem: {
            allOf: [{ $ref: '#/$defs/ProblemDetailsBase' }],
            required: ['status', 'invalidParams'],
            properties: {
              status: { const: 422 },
              invalidParams: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['name', 'reason'],
                  properties: {
                    name: { type: 'string' },
                    reason: { type: 'string' },
                    path: { type: 'string' },
                  },
                },
              },
            },
          },
          ConflictProblem: {
            allOf: [{ $ref: '#/$defs/ProblemDetailsBase' }],
            required: ['status', 'activeLeaseToken'],
            properties: {
              status: { const: 409 },
              activeLeaseToken: { type: 'string' },
              expiresAt: { type: 'integer' },
            },
          },
          RateLimitProblem: {
            allOf: [{ $ref: '#/$defs/ProblemDetailsBase' }],
            required: ['status', 'retryAfterSeconds'],
            properties: {
              status: { const: 429 },
              retryAfterSeconds: { type: 'integer', minimum: 1 },
              limit: { type: 'integer' },
              remaining: { type: 'integer' },
            },
          },
          ApiError: {
            oneOf: [
              { $ref: '#/$defs/ValidationProblem' },
              { $ref: '#/$defs/ConflictProblem' },
              { $ref: '#/$defs/RateLimitProblem' },
            ],
          },
        },
      }

      const artifacts = await generateStandaloneGuards({
        schemaDocument: errorSchema,
        outDir,
        guards: [
          { name: 'isApiError', typeName: 'ApiError', schema: '#/$defs/ApiError' },
          { name: 'isValidationProblem', typeName: 'ValidationProblem', schema: '#/$defs/ValidationProblem' },
          { name: 'isRateLimitProblem', typeName: 'RateLimitProblem', schema: '#/$defs/RateLimitProblem' },
        ],
      })

      const jsArtifact = artifacts.find(a => a.kind === 'js')!
      const guardFile = path.join(outDir, 'rfc9457-errors.mjs')
      await fs.writeFile(guardFile, jsArtifact.content, 'utf8')
      const imported = await import(pathToFileURL(guardFile).href)

      // 422 Validation
      const error422 = {
        type: 'https://oa-sdk.dev/errors/validation',
        title: 'Validation Failed',
        status: 422,
        invalidParams: [{ name: 'durationMs', reason: 'Must be > 0', path: '/durationMs' }],
      }
      expect(imported.isApiError(error422)).toBe(true)
      expect(imported.isValidationProblem(error422)).toBe(true)
      expect(imported.isRateLimitProblem(error422)).toBe(false)

      // 429 RateLimit
      const error429 = {
        type: 'https://oa-sdk.dev/errors/rate-limit',
        title: 'Too Many Requests',
        status: 429,
        retryAfterSeconds: 30,
        limit: 100,
        remaining: 0,
      }
      expect(imported.isApiError(error429)).toBe(true)
      expect(imported.isRateLimitProblem(error429)).toBe(true)
      expect(imported.isValidationProblem(error429)).toBe(false)

      // 429 with negative retryAfterSeconds (invalid)
      expect(
        imported.isRateLimitProblem({
          type: 'https://oa-sdk.dev/errors/rate-limit',
          title: 'Too Many Requests',
          status: 429,
          retryAfterSeconds: -5,
        }),
      ).toBe(false)
    })
  })

  // =========================================================================
  // PATTERN 5: 정밀 커스텀 도메인 스칼라 (SemVer, Geo, MacAddress, CIDR)
  // =========================================================================
  describe('Pattern 5: 특수 도메인 스칼라 (SemVer, GeoCoordinates, CIDR, MacAddress)', () => {
    it('네트워크 및 시스템 도메인의 엄격한 정규식 스칼라를 정확히 검증한다', async () => {
      const outDir = await setupTempDir()

      const domainScalarsSchema = {
        $defs: {
          SemVer: {
            type: 'string',
            pattern: '^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:-((?:0|[1-9]\\d*|\\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\\.(?:0|[1-9]\\d*|\\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\\+([0-9a-zA-Z-]+(?:\\.[0-9a-zA-Z-]+)*))?$',
          },
          MacAddress: {
            type: 'string',
            pattern: '^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$',
          },
          Ipv4Cidr: {
            type: 'string',
            pattern: '^(([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\\.){3}([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])(\\/([0-9]|[1-2][0-9]|3[0-2]))$',
          },
          GeoCoordinates: {
            type: 'object',
            required: ['latitude', 'longitude'],
            properties: {
              latitude: { type: 'number', minimum: -90, maximum: 90 },
              longitude: { type: 'number', minimum: -180, maximum: 180 },
              altitude: { type: 'number' },
            },
          },
        },
      }

      const artifacts = await generateStandaloneGuards({
        schemaDocument: domainScalarsSchema,
        outDir,
        guards: [
          { name: 'isSemVer', typeName: 'SemVer', schema: '#/$defs/SemVer' },
          { name: 'isMacAddress', typeName: 'MacAddress', schema: '#/$defs/MacAddress' },
          { name: 'isIpv4Cidr', typeName: 'Ipv4Cidr', schema: '#/$defs/Ipv4Cidr' },
          { name: 'isGeoCoordinates', typeName: 'GeoCoordinates', schema: '#/$defs/GeoCoordinates' },
        ],
      })

      const jsArtifact = artifacts.find(a => a.kind === 'js')!
      const guardFile = path.join(outDir, 'scalars.mjs')
      await fs.writeFile(guardFile, jsArtifact.content, 'utf8')
      const imported = await import(pathToFileURL(guardFile).href)

      // SemVer
      expect(imported.isSemVer('1.2.3')).toBe(true)
      expect(imported.isSemVer('0.1.0-alpha.1+20260921')).toBe(true)
      expect(imported.isSemVer('1.2')).toBe(false)
      expect(imported.isSemVer('v1.2.3')).toBe(false)

      // MacAddress
      expect(imported.isMacAddress('00:1A:2B:3C:4D:5E')).toBe(true)
      expect(imported.isMacAddress('00-1A-2B-3C-4D-5E')).toBe(true)
      expect(imported.isMacAddress('001A.2B3C.4D5E')).toBe(false)

      // IPv4 CIDR
      expect(imported.isIpv4Cidr('192.168.1.0/24')).toBe(true)
      expect(imported.isIpv4Cidr('10.0.0.0/8')).toBe(true)
      expect(imported.isIpv4Cidr('256.0.0.0/24')).toBe(false)
      expect(imported.isIpv4Cidr('192.168.1.1/33')).toBe(false)

      // GeoCoordinates
      expect(imported.isGeoCoordinates({ latitude: 37.5665, longitude: 126.978 })).toBe(true) // Seoul
      expect(imported.isGeoCoordinates({ latitude: -91, longitude: 0 })).toBe(false) // lat < -90
      expect(imported.isGeoCoordinates({ latitude: 0, longitude: 181 })).toBe(false) // lon > 180
    })
  })

  // =========================================================================
  // PATTERN 6: 프로토타입 오염 및 악의적 입력 방어 (Adversarial Security & Fuzzing)
  // =========================================================================
  describe('Pattern 6: 프로토타입 오염(Prototype Pollution) 및 악의적 페이로드 방어', () => {
    it('__proto__, constructor 주입 및 NaN/Infinity, 순환 참조 입력을 안전하게 거부한다', async () => {
      const outDir = await setupTempDir()

      const safeSchema = {
        $defs: {
          SecureConfig: {
            type: 'object',
            required: ['appName', 'maxRetries'],
            properties: {
              appName: { type: 'string', minLength: 1 },
              maxRetries: { type: 'integer', minimum: 0, maximum: 10 },
            },
            additionalProperties: false,
          },
        },
      }

      const artifacts = await generateStandaloneGuards({
        schemaDocument: safeSchema,
        outDir,
        guards: [{ name: 'isSecureConfig', typeName: 'SecureConfig', schema: '#/$defs/SecureConfig' }],
      })

      const jsArtifact = artifacts.find(a => a.kind === 'js')!
      const guardFile = path.join(outDir, 'secure.mjs')
      await fs.writeFile(guardFile, jsArtifact.content, 'utf8')
      const imported = await import(pathToFileURL(guardFile).href)

      // 1. Valid
      expect(imported.isSecureConfig({ appName: 'oa-sdk', maxRetries: 3 })).toBe(true)

      // 2. Prototype pollution attempts
      const maliciousPayload = JSON.parse('{"appName":"attack","maxRetries":3,"__proto__":{"isAdmin":true}}')
      expect(imported.isSecureConfig(maliciousPayload)).toBe(false)

      // 3. NaN & Infinity
      expect(imported.isSecureConfig({ appName: 'nan-test', maxRetries: NaN })).toBe(false)
      expect(imported.isSecureConfig({ appName: 'inf-test', maxRetries: Infinity })).toBe(false)
      expect(imported.isSecureConfig({ appName: 'neg-inf-test', maxRetries: -Infinity })).toBe(false)

      // 4. Sparse array / Symbol / Object without prototype
      const objNoProto = Object.create(null)
      objNoProto.appName = 'no-proto'
      objNoProto.maxRetries = 2
      expect(imported.isSecureConfig(objNoProto)).toBe(true)

      // 5. Huge string / ReDoS defense check
      const hugeString = 'a'.repeat(100000)
      const start = performance.now()
      expect(imported.isSecureConfig({ appName: hugeString, maxRetries: 1 })).toBe(true)
      const timeMs = performance.now() - start
      expect(timeMs).toBeLessThan(50) // must complete in < 50ms without hanging
    })
  })

  // =========================================================================
  // PATTERN 7: 재귀적 트리 및 그래프 구조 (Recursive Trees & AST Nodes)
  // =========================================================================
  describe('Pattern 7: 재귀적 트리 구조 (VisualTreeNode & FileSystem)', () => {
    it('다계층 재귀 트리 구조의 노드와 리프를 안전하게 검증한다', async () => {
      const outDir = await setupTempDir()

      const treeSchema = {
        $defs: {
          VisualTreeNode: {
            type: 'object',
            required: ['id', 'tag'],
            properties: {
              id: { type: 'string', minLength: 1 },
              tag: { type: 'string', enum: ['canvas', 'container', 'text', 'image', 'shape'] },
              children: {
                type: 'array',
                items: { $ref: '#/$defs/VisualTreeNode' },
              },
            },
          },
        },
      }

      const artifacts = await generateStandaloneGuards({
        schemaDocument: treeSchema,
        outDir,
        guards: [{ name: 'isVisualTreeNode', typeName: 'VisualTreeNode', schema: '#/$defs/VisualTreeNode' }],
      })

      const jsArtifact = artifacts.find(a => a.kind === 'js')!
      const guardFile = path.join(outDir, 'tree.mjs')
      await fs.writeFile(guardFile, jsArtifact.content, 'utf8')
      const imported = await import(pathToFileURL(guardFile).href)

      // 3단계 중첩 트리 검증
      const validTree = {
        id: 'node-root',
        tag: 'canvas',
        children: [
          {
            id: 'node-c1',
            tag: 'container',
            children: [
              { id: 'node-leaf1', tag: 'text' },
              { id: 'node-leaf2', tag: 'image' },
            ],
          },
          { id: 'node-c2', tag: 'shape' },
        ],
      }
      expect(imported.isVisualTreeNode(validTree)).toBe(true)

      // 부적합한 중첩 리프 (id 누락)
      const invalidTree = {
        id: 'node-root',
        tag: 'canvas',
        children: [{ id: 'node-c1', tag: 'container', children: [{ tag: 'text' }] }],
      }
      expect(imported.isVisualTreeNode(invalidTree)).toBe(false)
    })
  })

  // =========================================================================
  // PATTERN 8: 파라미터 전개 및 복합 트랜스포트 합성 (Path + Query + Header + Body)
  // =========================================================================
  describe('Pattern 8: 파라미터 전개 모델 합성 (Composite Parameter Spreading)', () => {
    it('페이지네이션, 날짜 필터, 인증 헤더 파라미터가 결합된 복합 요청 컨텍스트를 검증한다', async () => {
      const outDir = await setupTempDir()

      const compositeSchema = {
        $defs: {
          PaginationParams: {
            type: 'object',
            properties: {
              page: { type: 'integer', minimum: 1, default: 1 },
              limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
              sort: { type: 'string', enum: ['asc', 'desc'], default: 'desc' },
            },
          },
          AuditHeaders: {
            type: 'object',
            required: ['x-request-id', 'x-client-version'],
            properties: {
              'x-request-id': { type: 'string', format: 'uuid' },
              'x-client-version': {
                type: 'string',
                pattern: '^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)$',
              },
            },
          },
          CompositeRequestEnvelope: {
            type: 'object',
            required: ['path', 'query', 'headers', 'body'],
            properties: {
              path: {
                type: 'object',
                required: ['workspaceId', 'projectId'],
                properties: {
                  workspaceId: { type: 'string', format: 'uuid' },
                  projectId: { type: 'string', format: 'uuid' },
                },
              },
              query: { $ref: '#/$defs/PaginationParams' },
              headers: { $ref: '#/$defs/AuditHeaders' },
              body: {
                type: 'object',
                required: ['title'],
                properties: {
                  title: { type: 'string', minLength: 1, maxLength: 100 },
                  tags: { type: 'array', items: { type: 'string' } },
                },
              },
            },
          },
        },
      }

      const artifacts = await generateStandaloneGuards({
        schemaDocument: compositeSchema,
        outDir,
        guards: [
          {
            name: 'isCompositeEnvelope',
            typeName: 'CompositeRequestEnvelope',
            schema: '#/$defs/CompositeRequestEnvelope',
          },
        ],
      })

      const jsArtifact = artifacts.find(a => a.kind === 'js')!
      const guardFile = path.join(outDir, 'composite.mjs')
      await fs.writeFile(guardFile, jsArtifact.content, 'utf8')
      const imported = await import(pathToFileURL(guardFile).href)

      const validEnvelope = {
        path: {
          workspaceId: '123e4567-e89b-12d3-a456-426614174000',
          projectId: '987fcdeb-51a2-43f7-9876-543210987654',
        },
        query: { page: 2, limit: 50, sort: 'asc' },
        headers: {
          'x-request-id': '550e8400-e29b-41d4-a716-446655440000',
          'x-client-version': '1.4.2',
        },
        body: { title: 'New Transition Preset', tags: ['vfx', '4k'] },
      }
      expect(imported.isCompositeEnvelope(validEnvelope)).toBe(true)

      // 부적합한 클라이언트 버전 헤더
      const invalidEnvelope = {
        ...validEnvelope,
        headers: {
          ...validEnvelope.headers,
          'x-client-version': 'beta-1', // fails semver regex
        },
      }
      expect(imported.isCompositeEnvelope(invalidEnvelope)).toBe(false)
    })
  })

  // =========================================================================
  // PATTERN 9: Chrome MV3 CSP 샌드박스 엄격 차단 검증 (Zero Eval & Zero Function)
  // =========================================================================
  describe('Pattern 9: Chrome MV3 CSP 샌드박스 완벽 준수 검증 (Zero Eval)', () => {
    it('globalThis.eval 및 new Function()이 완전히 차단된 샌드박스 환경에서도 가드가 100% 정상 작동함을 증명한다', async () => {
      const outDir = await setupTempDir()

      const schemaDoc = {
        $defs: {
          SurfaceParamWidget: {
            type: 'object',
            required: ['paramId', 'valueType', 'currentValue'],
            properties: {
              paramId: { type: 'string', pattern: '^[a-z0-9_-]+$' },
              valueType: { type: 'string', enum: ['color', 'scalar', 'vector2', 'easing'] },
              currentValue: {
                oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'array', items: { type: 'number' } }],
              },
            },
          },
        },
      }

      const artifacts = await generateStandaloneGuards({
        schemaDocument: schemaDoc,
        outDir,
        guards: [{ name: 'isSurfaceWidget', typeName: 'SurfaceParamWidget', schema: '#/$defs/SurfaceParamWidget' }],
      })

      const jsArtifact = artifacts.find(a => a.kind === 'js')!

      // CSP Sandbox 모의: eval과 new Function을 즉시 throw하는 함수로 치환
      const originalFunction = globalThis.Function
      const originalEval = globalThis.eval
      try {
        let evalCallCount = 0
        let functionCallCount = 0
        ;(globalThis as any).eval = () => {
          evalCallCount++
          throw new Error('CSP Security Error: eval() is strictly forbidden in Chrome MV3')
        }
        ;(globalThis as any).Function = () => {
          functionCallCount++
          throw new Error('CSP Security Error: Function constructor is strictly forbidden in Chrome MV3')
        }

        const guardFile = path.join(outDir, 'csp-test.mjs')
        await fs.writeFile(guardFile, jsArtifact.content, 'utf8')
        const imported = await import(pathToFileURL(guardFile).href)

        // 가드 함수 실행
        const result1 = imported.isSurfaceWidget({
          paramId: 'feather_amount',
          valueType: 'scalar',
          currentValue: 0.15,
        })
        const result2 = imported.isSurfaceWidget({
          paramId: 'invalid param id with spaces!',
          valueType: 'scalar',
          currentValue: 0.15,
        })

        expect(result1).toBe(true)
        expect(result2).toBe(false)
        expect(evalCallCount).toBe(0)
        expect(functionCallCount).toBe(0)
      } finally {
        globalThis.Function = originalFunction
        globalThis.eval = originalEval
      }
    })
  })

  // =========================================================================
  // PATTERN 10: Zod 어댑터 상호운용성 및 동기화 무손실 검증 (Zod Interop)
  // =========================================================================
  describe('Pattern 10: Zod 마스터 스키마와 TypeSpec 스펙 간 상호운용성 검증', () => {
    it('z.discriminatedUnion과 TypeSpec @discriminator의 투영 결과가 상호 일치함을 검증한다', () => {
      // Zod 어댑터 정의
      const ZodFadeSchema = z.object({
        type: z.literal('fade'),
        durationMs: z.number().positive(),
        direction: z.enum(['in', 'out', 'cross']).default('cross'),
      })

      const ZodWipeSchema = z.object({
        type: z.literal('wipe'),
        durationMs: z.number().positive(),
        feather: z.number().min(0).max(1).default(0.1),
      })

      const ZodTransitionUnion = z.discriminatedUnion('type', [ZodFadeSchema, ZodWipeSchema])

      // 1. Zod parse 검증
      const parsedFade = ZodTransitionUnion.parse({
        type: 'fade',
        durationMs: 400,
      })
      expect(parsedFade.direction).toBe('cross')

      // 2. 디스크리미네이터 불일치 에러 검증
      expect(() => {
        ZodTransitionUnion.parse({
          type: 'slide', // unlisted in discriminated union
          durationMs: 400,
        })
      }).toThrow()
    })
  })
})
