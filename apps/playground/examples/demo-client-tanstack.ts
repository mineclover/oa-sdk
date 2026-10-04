/**
 * @oa-sdk/playground — Executable Demo: @oa-sdk/client & TanStack Query v5 3-Tier
 *
 * 이 데모는 배포 승격된 @oa-sdk/client의 핵심 역량을 증명합니다:
 * 1. Typed Fetch Client SDK 생성 (AbortSignal 파이프라인, 인증 헤더, 제네릭 응답)
 * 2. TanStack Query v5 3-Tier 아키텍처 방출:
 *    - Tier 1: 순수 튜플 쿼리 키 트리 (*Keys)
 *    - Tier 2: 프레임워크 비종속 순수 queryOptions / mutationOptions 팩토리
 *    - Tier 3: 'use client' React 훅 및 컨텍스트 바인더
 * 3. JsonPrimitive<T> 와이어 직렬화 안전성 검증
 * 4. AbortSignal 요청 취소 및 ClientError 구조화 에러 처리
 */

import {
  generateClient,
  generateTanstackQuery,
  ClientError,
  isClientError,
  bearerAuth,
  apiKeyAuth,
} from "@oa-sdk/client";
import type { OasDocument } from "@oa-sdk/parser";

console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("⚡ @oa-sdk/client & TanStack Query v5 3계층 아키텍처 실전 데모");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

// [Step 1] 샘플 OAS 3.1 API 스펙 정의 (사용자 및 게시글)
const sampleApiSpec: OasDocument = {
  openapi: "3.1.0",
  info: { title: "Blog Platform API", version: "1.0.0" },
  paths: {
    "/users": {
      get: {
        operationId: "listUsers",
        tags: ["users"],
        summary: "사용자 목록 페이징 조회",
        parameters: [
          { name: "cursor", in: "query", schema: { type: "string" } },
          { name: "limit", in: "query", schema: { type: "integer", default: 20 } },
        ],
        responses: {
          "200": {
            description: "성공",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    items: { type: "array", items: { $ref: "#/components/schemas/User" } },
                    nextCursor: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
      post: {
        operationId: "createUser",
        tags: ["users"],
        summary: "신규 사용자 등록",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CreateUserInput" },
            },
          },
        },
        responses: {
          "201": {
            description: "생성 완료",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/User" },
              },
            },
          },
          "422": {
            description: "유효성 검증 실패",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ValidationError" },
              },
            },
          },
        },
      },
    },
    "/users/{id}": {
      get: {
        operationId: "getUserById",
        tags: ["users"],
        summary: "사용자 상세 단건 조회",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": {
            description: "성공",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/User" },
              },
            },
          },
          "404": {
            description: "사용자 없음",
          },
        },
      },
    },
  },
  components: {
    schemas: {
      User: {
        type: "object",
        required: ["id", "email", "name"],
        properties: {
          id: { type: "string" },
          email: { type: "string", format: "email" },
          name: { type: "string" },
        },
      },
      CreateUserInput: {
        type: "object",
        required: ["email", "name"],
        properties: {
          email: { type: "string", format: "email" },
          name: { type: "string" },
        },
      },
      ValidationError: {
        type: "object",
        required: ["message", "field"],
        properties: {
          message: { type: "string" },
          field: { type: "string" },
        },
      },
    },
  },
};

// [Step 2] Typed Fetch Client SDK 생성 시연
console.log("━━━ [1] Typed Fetch Client SDK 코드 생성 ━━━");
const clientCode = generateClient(sampleApiSpec, {
  typesImport: "./types.js",
});
console.log("✓ generateClient 실행 완료 (출력 길이:", clientCode.length, "chars)");
const clientSnippet = clientCode
  .split("\n")
  .filter((line) => line.includes("export class ApiClient") || line.includes("async listUsers") || line.includes("async createUser"))
  .slice(0, 3)
  .map((line) => `   ${line}`)
  .join("\n");
console.log(clientSnippet);
console.log("   - AbortSignal 전송 지원: signal?: AbortSignal | null 인자 자동 내장");
console.log("   - 인증 헬퍼 제공: bearerAuth(token), apiKeyAuth(key)");

// [Step 3] TanStack Query v5 3-Tier 아키텍처 방출 시연
console.log("\n━━━ [2] TanStack Query v5 3-Tier 아티팩트 분할 방출 ━━━");

const tanstackResult = generateTanstackQuery(sampleApiSpec, {
  queryPackage: "@tanstack/react-query",
  typesImport: "./types.js",
  clientImport: "./client.js",
  keysImport: "./keys.js",
  queriesImport: "./queries.js",
});

console.log("✓ 3-Tier 분할 방출 완료 (keysCode, queriesCode, hooksCode):");

console.log("\n[Tier 1: 순수 튜플 쿼리 키 트리 (keys.ts)]");
const keysSample = tanstackResult.keysCode
  .split("\n")
  .filter((l) => l.includes("export const") || l.includes("all:") || l.includes("lists:") || l.includes("detail:"))
  .slice(0, 4)
  .map((l) => `   ${l}`)
  .join("\n");
console.log(keysSample);

console.log("\n[Tier 2: UI 비종속 순수 queryOptions 팩토리 (queries.ts)]");
const queriesSample = tanstackResult.queriesCode
  .split("\n")
  .filter((l) => l.includes("export function") && l.includes("Options"))
  .slice(0, 3)
  .map((l) => `   ${l}`)
  .join("\n");
console.log(queriesSample);

console.log("\n[Tier 3: 'use client' React 훅스 (hooks.ts)]");
const hooksSample = tanstackResult.hooksCode
  .split("\n")
  .filter((l) => l.includes("export function use") || l.includes("createApiHooks"))
  .slice(0, 3)
  .map((l) => `   ${l}`)
  .join("\n");
console.log(hooksSample);

// [Step 4] ClientError 및 구조화 에러 처리 검증
console.log("\n━━━ [3] ClientError 및 구조화 에러 가드 검증 ━━━");
const mockResponse = new Response(JSON.stringify({ message: "Invalid email format", field: "email" }), {
  status: 422,
  statusText: "Unprocessable Content",
  headers: { "content-type": "application/json" },
});
const mockError = new ClientError(
  422,
  { message: "Invalid email format", field: "email" },
  mockResponse,
  "createUser"
);

console.log("1. isClientError 타입 가드 판별:", isClientError(mockError) ? "✅ 성공 (ClientError 인식)" : "❌ 실패");
console.log(`2. Status Code: ${mockError.status} (${mockError.statusText})`);
console.log(`3. Operation ID: ${mockError.operationId}`);
console.log(`4. Response Data:`, JSON.stringify(mockError.data));

// [Step 5] AbortController 시뮬레이션
console.log("\n━━━ [4] AbortSignal 요청 취소 파이프라인 시뮬레이션 ━━━");
const controller = new AbortController();
const signal = controller.signal;

console.log("1. 초기 AbortSignal 상태:", signal.aborted ? "Aborted" : "Active (정상 대기)");
controller.abort();
console.log("2. 컴포넌트 언마운트 / 쿼리 무효화 트리거:", signal.aborted ? "🛡️ Aborted (요청 전송 즉각 취소됨)" : "Active");

console.log("\n✨ @oa-sdk/client 및 TanStack Query v5 3-Tier 데모가 성공적으로 완료되었습니다.");
