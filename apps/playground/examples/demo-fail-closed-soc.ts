/**
 * @oa-sdk/playground — Executable Demo: 책임 분리(SoC) 및 Fail-Closed 계약 증명
 *
 * 이 데모는 Core Platform과 Downstream 간의 엄격한 책임 분리 원칙과
 * 재귀 스키마(Recursive Schema) 환경에서의 Fail-Closed 방어 메커니즘을 증명합니다.
 *
 * 1. 파서의 임의 판단 배제: 순환 참조를 감지했을 때 status = 'partial'과 'ref-cycle' 진단 기계적 기록
 * 2. cycleStrategy 비교: 'empty-schema'({}) 절단 vs 'preserve-ref'({$ref}) 유지
 * 3. 다운스트림의 Fail-Closed: assertParsedDocumentComplete()에 의한 IncompleteParsedDocumentError 차단
 * 4. Ref-aware Codegen의 AST 무손실 처리 비교
 */

import {
  parseDocument,
  assertParsedDocumentComplete,
  IncompleteParsedDocumentError,
} from "@oa-sdk/parser";
import { generateClient } from "@oa-sdk/client";
import { generateRouter } from "@oa-sdk/router";
import { generateTypesFromSpec } from "@oa-sdk/codegen";
import { buildSurfaceIr } from "@oa-sdk/surface-ir";

console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("🏛️ OA SDK 책임 분리(SoC) & 재귀 스키마 Fail-Closed 안전성 데모");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

// [Step 1] 재귀 스키마 정의 (트리 구조: Node -> children: Node[])
const recursiveTreeSpec = {
  openapi: "3.1.0",
  info: { title: "Hierarchical File Tree API", version: "1.0.0" },
  paths: {
    "/tree": {
      get: {
        operationId: "getTree",
        summary: "계층형 파일 트리 조회",
        responses: {
          "200": {
            description: "성공",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/TreeNode" },
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      TreeNode: {
        type: "object",
        required: ["id", "name"],
        properties: {
          id: { type: "string", format: "uuid" },
          name: { type: "string" },
          children: {
            type: "array",
            items: { $ref: "#/components/schemas/TreeNode" }, // 🔄 순환 참조 발생 지점
          },
        },
      },
    },
  },
};

// [Step 2] 파서의 책임: cycleStrategy 옵션별 기계적 동작 확인
console.log("━━━ [1] @oa-sdk/parser: 임의 판단 배제 및 진단 보존 ━━━");

// Strategy 1: 기본 전략 (빈 객체 {}로 순환 절단하여 메모리 무한 루프 방지)
const defaultDoc = parseDocument(structuredClone(recursiveTreeSpec));
const defaultChildrenItems = (defaultDoc.schemas as any).TreeNode?.properties?.children?.items;
console.log("1. 기본 전략 (default):");
console.log(`   - resolution.status:     '${defaultDoc.resolution?.status}' (불완전 상태 명시)`);
console.log(`   - diagnostics:           [${defaultDoc.resolution?.diagnostics.map((d) => d.code).join(", ")}]`);
console.log(`   - 순환 노드 절단 형태:   ${JSON.stringify(defaultChildrenItems)} (무한 루프 방지)`);

// Strategy 2: 'preserve-ref' (AST/z.lazy 등 재귀 타입을 지원하는 도구를 위해 {$ref} 유지)
const preserveDoc = parseDocument(structuredClone(recursiveTreeSpec), { cycleStrategy: "preserve-ref" });
const preserveChildrenItems = (preserveDoc.schemas as any).TreeNode?.properties?.children?.items;
console.log("\n2. 보존 전략 (cycleStrategy: 'preserve-ref'):");
console.log(`   - resolution.status:     '${preserveDoc.resolution?.status}'`);
console.log(`   - 순환 노드 보존 형태:   ${JSON.stringify(preserveChildrenItems)} ($ref 심볼 유지)`);

// [Step 3] 다운스트림의 책임: assertParsedDocumentComplete()에 의한 Fail-Closed
console.log("\n━━━ [2] Downstream Integration: Fail-Closed 런타임 차단 ━━━");

function testDownstreamConsumer(consumerName: string, fn: () => void) {
  try {
    fn();
    console.log(`❌ [${consumerName}] 깨진 결과가 조용히 통과됨 (안티패턴)`);
  } catch (err: any) {
    if (err instanceof IncompleteParsedDocumentError || err.name === "IncompleteParsedDocumentError") {
      console.log(`🛡️ [${consumerName}] 즉시 차단 완료!`);
      console.log(`   → 차단 사유: ${err.message}`);
    } else {
      console.log(`⚠️ [${consumerName}] 다른 예외 발생: ${err.message}`);
    }
  }
}

// 1. Client SDK Generator 차단 테스트
testDownstreamConsumer("@oa-sdk/client generateClient", () => {
  generateClient(defaultDoc);
});

// 2. Router Stub Generator 차단 테스트
testDownstreamConsumer("@oa-sdk/router generateRouter", () => {
  generateRouter(defaultDoc);
});

// 3. 직접 assertParsedDocumentComplete 호출
testDownstreamConsumer("assertParsedDocumentComplete", () => {
  assertParsedDocumentComplete(defaultDoc, "Custom Runtime Service");
});

// [Step 4] 특화 컨슈머의 책임: Ref-Aware AST Codegen & Surface IR
console.log("\n━━━ [3] Ref-Aware 특화 컨슈머: AST 타입 생성 및 Surface IR ━━━");

// Codegen: $ref를 TypeScript의 명명된 타입 참조(interface TreeNode { children: TreeNode[] })로 변환
const generatedTsTypes = generateTypesFromSpec(structuredClone(recursiveTreeSpec) as any);
console.log("1. @oa-sdk/codegen: 재귀 AST 타입 생성 성공:");
const filteredTs = generatedTsTypes
  .split("\n")
  .filter((line) => line.includes("interface TreeNode") || line.includes("children?:") || line.includes("id:"))
  .map((line) => `   ${line}`)
  .join("\n");
console.log(filteredTs);

// Surface IR: Soft diagnostic 수집 및 타깃 중립 메타데이터 구축
const surfaceIr = buildSurfaceIr(defaultDoc);
console.log(`\n2. @oa-sdk/surface-ir: Soft Diagnostic 수집 (오류 ${surfaceIr.diagnostics.length}건):`);
for (const diag of surfaceIr.diagnostics) {
  console.log(`   - [${diag.severity.toUpperCase()}] ${diag.code}: ${diag.message}`);
}

console.log("\n✨ 책임 분리(SoC) 및 Fail-Closed 안전성 데모가 성공적으로 완료되었습니다.");
