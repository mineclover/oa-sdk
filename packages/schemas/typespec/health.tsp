import "@typespec/http";
import "@typespec/openapi";

using Http;
using OpenAPI;

namespace OaSdkApi;

@doc("현재 실행 중인 빌드 정보")
@extension("example", #{ version: "0.1.0", gitSha: "a0ca911", builtAt: "2026-05-04T00:00:00.000Z" })
model BuildInfo {
  @doc("semver 또는 빌드 식별 라벨")
  version: string;
  @doc("커밋 해시")
  @minLength(7)
  gitSha: string;
  builtAt: utcDateTime;
}

model DependencyStatus {
  name: string;
  status: "ok" | "degraded" | "down";
  @minValue(0)
  latencyMs?: integer;
  message?: string;
}

@extension("example", #{ status: "ok", timestamp: "2026-04-04T00:00:00.000Z" })
@example(#{ status: "ok", timestamp: utcDateTime.fromISO("2026-04-04T00:00:00.000Z") })
model HealthStatus {
  status: "ok";
  timestamp: utcDateTime;
}

@doc("readiness probe 결과 — 의존 시스템 검증 포함")
@extension("example", #{ status: "ready", timestamp: "2026-05-04T00:00:00.000Z", dependencies: #[#{ name: "postgres", status: "ok" }] })
model ReadinessReport {
  status: "ready" | "not-ready";
  timestamp: utcDateTime;
  dependencies: DependencyStatus[];
}

@doc("서버 정상")
model GetHealth200Response {
  @statusCode statusCode: 200;
  @body body: HealthStatus;
}

@doc("서비스 사용 불가")
model GetHealth503Response {
  @statusCode statusCode: 503;
  @body body: Error;
}

@doc("트래픽 수용 가능")
model GetReadiness200Response {
  @statusCode statusCode: 200;
  @body body: ReadinessReport;
}

@doc("서비스 사용 불가")
model GetReadiness503Response {
  @statusCode statusCode: 503;
  @body body: Error;
}

@doc("SSE 이벤트 스트림")
model StreamHealthEvents200Response {
  @statusCode statusCode: 200;
}

@doc("서비스 사용 불가")
model StreamHealthEvents503Response {
  @statusCode statusCode: 503;
  @body body: Error;
}

@doc("빌드 정보")
model GetVersion200Response {
  @statusCode statusCode: 200;
  @body body: BuildInfo;
}

@summary("서버 상태 확인")
@doc("서버가 정상 동작 중인지 확인하는 헬스체크 엔드포인트")
@tag("health")
@operationId("getHealth")
@route("/health")
@get
@extension("x-oa-sdk-operation-security", #[])
@extension("x-oa-sdk-operation-examples", #{
  responses: #{
    status_200_application_json: #{
      statusCode: "200",
      mediaType: "application/json",
      examples: #{
        ok: #{
          summary: "정상 응답",
          dataValue: #{
            status: "ok",
            timestamp: "2026-04-04T00:00:00.000Z"
          },
          serializedValue: "{\"status\":\"ok\",\"timestamp\":\"2026-04-04T00:00:00.000Z\"}"
        }
      }
    },
    status_503_application_json: #{
      statusCode: "503",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "SERVICE_UNAVAILABLE",
            message: "서비스가 일시적으로 사용 불가합니다"
          },
          serializedValue: "{\"code\":\"SERVICE_UNAVAILABLE\",\"message\":\"서비스가 일시적으로 사용 불가합니다\"}"
        }
      }
    }
  }
})
@extension("x-oa-sdk-operation-component-refs", #{
  responses: #[
    #{
      statusCode: "503",
      ref: "#/components/responses/ServiceUnavailable"
    }
  ]
})
op getHealth(): GetHealth200Response | GetHealth503Response;

@summary("서버 준비 상태 확인 (readiness)")
@doc("Kubernetes readiness probe / 배포 게이트용. 의존 시스템(DB, queue 등)\n검증 결과를 포함. `getHealth`(liveness)와 별개 — liveness는 프로세스\n살아있음만, readiness는 트래픽을 받을 준비가 됐는지 확인.\n")
@tag("health")
@operationId("getReadiness")
@route("/health/ready")
@get
@extension("x-oa-sdk-operation-security", #[])
@extension("x-oa-sdk-operation-examples", #{
  responses: #{
    status_200_application_json: #{
      statusCode: "200",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            status: "ready",
            timestamp: "2026-05-04T00:00:00.000Z",
            dependencies: #[
              #{
                name: "postgres",
                status: "ok",
                latencyMs: 3
              },
              #{
                name: "redis",
                status: "ok",
                latencyMs: 1
              }
            ]
          },
          serializedValue: "{\"status\":\"ready\",\"timestamp\":\"2026-05-04T00:00:00.000Z\",\"dependencies\":[{\"name\":\"postgres\",\"status\":\"ok\",\"latencyMs\":3},{\"name\":\"redis\",\"status\":\"ok\",\"latencyMs\":1}]}"
        }
      }
    },
    status_503_application_json: #{
      statusCode: "503",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "SERVICE_UNAVAILABLE",
            message: "서비스가 일시적으로 사용 불가합니다"
          },
          serializedValue: "{\"code\":\"SERVICE_UNAVAILABLE\",\"message\":\"서비스가 일시적으로 사용 불가합니다\"}"
        }
      }
    }
  }
})
@extension("x-oa-sdk-operation-component-refs", #{
  responses: #[
    #{
      statusCode: "503",
      ref: "#/components/responses/ServiceUnavailable"
    }
  ]
})
op getReadiness(): GetReadiness200Response | GetReadiness503Response;

@summary("서버 상태 실시간 스트림")
@doc("SSE로 서버 상태 변화를 실시간으로 구독")
@tag("health")
@operationId("streamHealthEvents")
@route("/health/stream")
@get
@extension("x-oa-sdk-operation-security", #[])
@extension("x-oa-sdk-operation-examples", #{
  responses: #{
    status_503_application_json: #{
      statusCode: "503",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "SERVICE_UNAVAILABLE",
            message: "서비스가 일시적으로 사용 불가합니다"
          },
          serializedValue: "{\"code\":\"SERVICE_UNAVAILABLE\",\"message\":\"서비스가 일시적으로 사용 불가합니다\"}"
        }
      }
    }
  }
})
@extension("x-oa-sdk-operation-component-refs", #{
  responses: #[
    #{
      statusCode: "503",
      ref: "#/components/responses/ServiceUnavailable"
    }
  ]
})
op streamHealthEvents(): StreamHealthEvents200Response | StreamHealthEvents503Response;

@summary("빌드/배포 정보 조회")
@doc("현재 실행 중인 빌드의 git sha, 빌드 시각, 배포 버전.")
@tag("health")
@operationId("getVersion")
@route("/version")
@get
@extension("x-oa-sdk-operation-security", #[])
@extension("x-oa-sdk-operation-examples", #{
  responses: #{
    status_200_application_json: #{
      statusCode: "200",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            version: "0.1.0",
            gitSha: "a0ca91100000000000000000000000000000000",
            builtAt: "2026-05-04T00:00:00.000Z"
          },
          serializedValue: "{\"version\":\"0.1.0\",\"gitSha\":\"a0ca91100000000000000000000000000000000\",\"builtAt\":\"2026-05-04T00:00:00.000Z\"}"
        }
      }
    }
  }
})
op getVersion(): GetVersion200Response;
