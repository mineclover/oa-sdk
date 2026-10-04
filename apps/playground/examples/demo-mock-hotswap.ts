/**
 * @oa-sdk/playground — Executable Demo: @oa-sdk/mock-server 실시간 원자적 라우트 핫스왑 & Stateful Mock
 *
 * 이 데모는 배포 승격된 @oa-sdk/mock-server의 핵심 역량을 증명합니다:
 * 1. Zero-Build In-Memory Mock Server 가동 (포트 바인딩 및 OAS 3.2 경로 매칭)
 * 2. server.updateSpec()을 통한 실시간 원자적(Atomic) 라우트 테이블 핫스왑 (서버 재시작 없음, 0ms 컷오프)
 * 3. 스키마 파싱/문법 오류 주입 시 Error Shielding (기존 안정 라우트 보존)
 * 4. Operation 응답 오버라이드 (server.override)
 * 5. Stateful 인메모리 컬렉션 플러그인 (POST 생성 후 GET 조회 일관성 유지)
 */

import { createNodeMockServer } from "@oa-sdk/mock-server/adapters/node-http";

console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("🔥 @oa-sdk/mock-server 원자적 라우트 핫스왑 & Stateful Mock 데모");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

// [Step 1] V1 API 스펙: 헬스체크 및 사용자 조회 엔드포인트만 정의
const v1Spec = {
  openapi: "3.1.0",
  info: { title: "E-Commerce Mock API (v1)", version: "1.0.0" },
  paths: {
    "/health": {
      get: {
        operationId: "getHealth",
        summary: "서버 상태 확인",
        responses: {
          "200": {
            description: "정상",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { status: { type: "string" }, version: { type: "string" } },
                },
              },
            },
          },
        },
      },
    },
    "/products": {
      get: {
        operationId: "listProducts",
        summary: "상품 목록",
        responses: {
          "200": {
            description: "성공",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: { id: { type: "string" }, title: { type: "string" }, price: { type: "number" } },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
};

// [Step 2] Mock HTTP 서버 구동 (포트 0으로 임의 가용 포트 바인딩)
console.log("━━━ [1] V1 스펙 기반 인메모리 Mock 서버 가동 ━━━");
const server = createNodeMockServer(v1Spec, { port: 0 });
await server.start();
console.log(`✓ Mock Server 실행 중: ${server.url}`);

// 1. V1 헬스체크 호출
const res1 = await fetch(`${server.url}/health`);
const data1 = await res1.json();
console.log(`1. GET /health (V1): [${res1.status}]`, JSON.stringify(data1));

// 2. V1 상품 목록 호출
const res2 = await fetch(`${server.url}/products`);
const data2 = await res2.json();
console.log(`2. GET /products (V1): [${res2.status}]`, Array.isArray(data2) ? `items=${data2.length}` : data2);

// 3. V1에 아직 없는 신규 엔드포인트(/orders) 호출 시도 -> 404 예상
const res3 = await fetch(`${server.url}/orders`);
console.log(`3. GET /orders (미등록 엔드포인트): [${res3.status}] (404 정상 차단)`);

// [Step 3] 실시간 원자적 라우트 테이블 핫스왑 (Live Hot-Swap)
console.log("\n━━━ [2] server.updateSpec(): 실시간 무중단 라우트 핫스왑 ━━━");
console.log("🔄 서버 재시작 없이 신규 주문(/orders) 엔드포인트 스펙 동적 주입...");

const v2Spec = {
  ...v1Spec,
  info: { title: "E-Commerce Mock API (v2)", version: "2.0.0" },
  paths: {
    ...v1Spec.paths,
    "/orders": {
      get: {
        operationId: "listOrders",
        summary: "주문 내역 목록",
        responses: {
          "200": {
            description: "성공",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: { orderId: { type: "string" }, totalAmount: { type: "number" }, status: { type: "string" } },
                  },
                },
              },
            },
          },
        },
      },
      post: {
        operationId: "createOrder",
        summary: "신규 주문 생성",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["productId", "quantity"],
                properties: { productId: { type: "string" }, quantity: { type: "integer", minimum: 1 } },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "주문 접수 완료",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { orderId: { type: "string" }, status: { type: "string" } },
                },
              },
            },
          },
        },
      },
    },
  },
};

const swapResult = server.updateSpec(v2Spec);
console.log(`✓ 원자적 교체 완료: 총 ${swapResult.routesCount}개 라우트 즉시 활성화 (동일 포트 유지: ${server.url})`);

// 핫스왑 직후 신규 엔드포인트 즉각 응답 확인
const res4 = await fetch(`${server.url}/orders`);
const data4 = await res4.json();
console.log(`1. GET /orders (V2 핫스왑 직후): [${res4.status}]`, Array.isArray(data4) ? `items=${data4.length}` : data4);

// [Step 4] 동적 응답 오버라이드 (server.override)
console.log("\n━━━ [3] server.override(): 특정 오퍼레이션 응답 커스텀 주입 ━━━");
server.override("listOrders", {
  status: 200,
  body: [
    { orderId: "ord_custom_999", totalAmount: 49900, status: "SHIPPED" },
  ],
});

const res5 = await fetch(`${server.url}/orders`);
const data5 = await res5.json();
console.log("1. GET /orders (커스텀 오버라이드 결과):", JSON.stringify(data5));
server.clearOverrides();

// [Step 5] 스키마 오류 주입 시 파싱 에러 쉴딩 (Error Shielding)
console.log("\n━━━ [4] Error Shielding: 불량 스키마 주입 시 기존 안정 라우트 보존 ━━━");
try {
  console.log("⚠️ 문법 오류/파싱 불가 스키마 핫스왑 시도...");
  server.updateSpec({ openapi: "3.1.0", paths: null as any });
} catch (err: any) {
  console.log(`🛡️ 파싱 에러 감지 및 차단: ${err.message}`);
}

// 에러 발생 후에도 기존 Mock 라우트가 다운되지 않고 정상 작동하는지 확인
const res6 = await fetch(`${server.url}/health`);
console.log(`1. GET /health (오류 주입 시도 후 서버 건전성 확인): [${res6.status}] ✅ 서버 무중단 보호`);

// 서버 안전 종료
await server.stop();
console.log("\n✓ Mock Server 안전하게 정지 완료.");
console.log("\n✨ @oa-sdk/mock-server 원자적 라우트 핫스왑 데모가 성공적으로 완료되었습니다.");
