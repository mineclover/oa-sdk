import "@typespec/http";
import "@typespec/openapi";
import "../version.tsp";

using Http;
using OpenAPI;

@extension("x-oa-sdk-info", #{
  title: "OA SDK API",
  description: "OpenAPI 3.2 기반 API 관리 인프라",
  version: ContractVersion,
  license: #{ name: "MIT", identifier: "MIT" }
})
@server("http://localhost:3000", "Local dev server")
@server("http://localhost:4010", "Mock server (@oa-sdk/mock-server)")
@service(#{ title: "OA SDK API" })
@info(#{ version: ContractVersion })
@tagMetadata("health", #{ description: "서버 상태 확인" })
@tagMetadata("users", #{ description: "사용자 관리" })
@tagMetadata("auth", #{ description: "인증 — 토큰 발급/갱신/폐기" })
@tagMetadata("me", #{ description: "셀프 서비스 — 현재 인증된 사용자 자기 자원" })
@tagMetadata("world-model", #{ description: "World Model Kernel — World bootstrap, stimulus ingress, revision-pinned projection query" })
namespace OaSdkApi;
