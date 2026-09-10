import "@typespec/http";
import "@typespec/openapi";

using Http;
using OpenAPI;

namespace OaSdkApi;

alias UserRole = "admin" | "user" | "guest";
alias ReportReason = "spam" | "harassment" | "hate-speech" | "fraud" | "impersonation" | "other";
alias ReportStatus = "open" | "under-review" | "resolved" | "dismissed";

@doc("사용자 PII bulk export 요청. data-eng ETL surface이며 non-admin\nperspective에서는 pseudonymization이 필수입니다.\n")
@extension("additionalProperties", false)
model AdminUsersExportRequest {
  format?: ExportFormat = "json";
  pseudonymize?: boolean = true;
}

@doc("사용자 생성 요청")
model CreateUserRequest {
  @format("email")
  email: string;
  @minLength(1)
  @maxLength(100)
  name: string;
  @doc("최소 8자 이상")
  @minLength(8)
  password: string;
}

@doc("공개 프로필 — PII 비포함 (email/createdAt 제외)")
@extension("example", #{ id: "00000000-0000-0000-0000-000000000001", name: "Alice", role: "user" })
model PublicUserProfile {
  @format("uuid")
  id: string;
  @minLength(1)
  @maxLength(100)
  name: string;
  role: UserRole;
}

@doc("site-admin 사용자 hard purge 요청. deleteUser와 별도의 권한 및 감사 절차를 적용합니다.")
@extension("additionalProperties", false)
model PurgeUserRequest {
  @doc("영구 삭제 감사 사유")
  @minLength(1)
  @maxLength(1000)
  reason: string;
  @doc("legal hold 예외 승인 여부")
  legalHoldOverride?: boolean = false;
}

@doc("신고 단건")
@extension("example", #{ id: "00000000-0000-0000-0000-000000000300", targetUserId: "00000000-0000-0000-0000-000000000001", reporterUserId: "00000000-0000-0000-0000-000000000002", reason: "harassment", status: "open", createdAt: "2026-05-04T00:00:00.000Z" })
model Report {
  @format("uuid")
  id: string;
  @format("uuid")
  targetUserId: string;
  @format("uuid")
  reporterUserId: string;
  reason: ReportReason;
  details?: string;
  status: ReportStatus;
  createdAt: utcDateTime;
  resolvedAt?: utcDateTime;
}

@doc("신고 요청 본문")
model ReportRequest {
  reason: ReportReason;
  @maxLength(1000)
  details?: string;
}

@doc("사용자 수정 요청 (부분 업데이트 — 모든 필드 optional)")
model UpdateUserRequest {
  @minLength(1)
  @maxLength(100)
  name?: string;
  role?: UserRole;
}

@doc("사용자 정보")
@extension("example", #{ id: "00000000-0000-0000-0000-000000000001", email: "alice@example.com", name: "Alice", role: "user", createdAt: "2024-01-01T00:00:00.000Z" })
@example(#{ id: "00000000-0000-0000-0000-000000000001", email: "alice@example.com", name: "Alice", role: "user", createdAt: utcDateTime.fromISO("2024-01-01T00:00:00.000Z") })
model User {
  @format("uuid")
  id: string;
  @format("email")
  email: string;
  @minLength(1)
  @maxLength(100)
  name: string;
  role: UserRole;
  createdAt: utcDateTime;
}

@doc("bulk export job 등록 완료")
model RequestUsersExport202Response {
  @statusCode statusCode: 202;
  @body body: ExportJob;
}

@doc("인증 실패 — 토큰 없음 또는 만료")
model RequestUsersExport401Response {
  @statusCode statusCode: 401;
  @body body: Error;
}

@doc("권한 없음 — 접근 거부")
model RequestUsersExport403Response {
  @statusCode statusCode: 403;
  @body body: Error;
}

@doc("요청 제한 초과 — Retry-After 헤더로 재시도 가능 시점 안내")
model RequestUsersExport429Response {
  @statusCode statusCode: 429;
  @body body: Error;
  @doc("재시도 가능 시점 (초 단위 정수 또는 HTTP-date)")
  @header("Retry-After")
  @example("30")
  retryAfter: string;
}

@doc("영구 삭제 완료 (본문 없음)")
model PurgeUser204Response {
  @statusCode statusCode: 204;
}

@doc("잘못된 요청 — 요청 형식 또는 파라미터 오류")
model PurgeUser400Response {
  @statusCode statusCode: 400;
  @body body: Error;
}

@doc("인증 실패 — 토큰 없음 또는 만료")
model PurgeUser401Response {
  @statusCode statusCode: 401;
  @body body: Error;
}

@doc("권한 없음 — 접근 거부")
model PurgeUser403Response {
  @statusCode statusCode: 403;
  @body body: Error;
}

@doc("리소스를 찾을 수 없음")
model PurgeUser404Response {
  @statusCode statusCode: 404;
  @body body: Error;
}

@doc("신고 큐")
model ListModerationReports200Response {
  @statusCode statusCode: 200;
  @example(#{ items: #[#{ id: "00000000-0000-0000-0000-000000000300", targetUserId: "00000000-0000-0000-0000-000000000001", reporterUserId: "00000000-0000-0000-0000-000000000002", reason: "harassment", status: "open", createdAt: utcDateTime.fromISO("2026-05-04T00:00:00.000Z") }], total: 1 })
  @body body: {
    items: Report[];
    @minValue(0)
    total: integer;
  };
}

@doc("인증 실패 — 토큰 없음 또는 만료")
model ListModerationReports401Response {
  @statusCode statusCode: 401;
  @body body: Error;
}

@doc("권한 없음 — 접근 거부")
model ListModerationReports403Response {
  @statusCode statusCode: 403;
  @body body: Error;
}

@doc("사용자 정보")
model GetUserById200Response {
  @statusCode statusCode: 200;
  @body body: User;
}

@doc("인증 실패 — 토큰 없음 또는 만료")
model GetUserById401Response {
  @statusCode statusCode: 401;
  @body body: Error;
}

@doc("리소스를 찾을 수 없음")
model GetUserById404Response {
  @statusCode statusCode: 404;
  @body body: Error;
}

@doc("삭제 완료 (본문 없음)")
model DeleteUser204Response {
  @statusCode statusCode: 204;
}

@doc("인증 실패 — 토큰 없음 또는 만료")
model DeleteUser401Response {
  @statusCode statusCode: 401;
  @body body: Error;
}

@doc("리소스를 찾을 수 없음")
model DeleteUser404Response {
  @statusCode statusCode: 404;
  @body body: Error;
}

@doc("수정된 사용자 정보")
model UpdateUser200Response {
  @statusCode statusCode: 200;
  @body body: User;
}

@doc("잘못된 요청 — 요청 형식 또는 파라미터 오류")
model UpdateUser400Response {
  @statusCode statusCode: 400;
  @body body: Error;
}

@doc("인증 실패 — 토큰 없음 또는 만료")
model UpdateUser401Response {
  @statusCode statusCode: 401;
  @body body: Error;
}

@doc("권한 없음 — 접근 거부")
model UpdateUser403Response {
  @statusCode statusCode: 403;
  @body body: Error;
}

@doc("리소스를 찾을 수 없음")
model UpdateUser404Response {
  @statusCode statusCode: 404;
  @body body: Error;
}

@doc("스키마 유효성 검사 실패")
model UpdateUser422Response {
  @statusCode statusCode: 422;
  @body body: Error;
}

@doc("공개 프로필")
model GetPublicUserProfile200Response {
  @statusCode statusCode: 200;
  @body body: PublicUserProfile;
}

@doc("인증 실패 — 토큰 없음 또는 만료")
model GetPublicUserProfile401Response {
  @statusCode statusCode: 401;
  @body body: Error;
}

@doc("리소스를 찾을 수 없음")
model GetPublicUserProfile404Response {
  @statusCode statusCode: 404;
  @body body: Error;
}

@doc("신고 접수 완료")
model ReportUser201Response {
  @statusCode statusCode: 201;
  @body body: Report;
}

@doc("잘못된 요청 — 요청 형식 또는 파라미터 오류")
model ReportUser400Response {
  @statusCode statusCode: 400;
  @body body: Error;
}

@doc("인증 실패 — 토큰 없음 또는 만료")
model ReportUser401Response {
  @statusCode statusCode: 401;
  @body body: Error;
}

@doc("스키마 유효성 검사 실패")
model ReportUser422Response {
  @statusCode statusCode: 422;
  @body body: Error;
}

@doc("요청 제한 초과 — Retry-After 헤더로 재시도 가능 시점 안내")
model ReportUser429Response {
  @statusCode statusCode: 429;
  @body body: Error;
  @doc("재시도 가능 시점 (초 단위 정수 또는 HTTP-date)")
  @header("Retry-After")
  @example("30")
  retryAfter: string;
}

@doc("사용자 목록")
model ListUsers200Response {
  @statusCode statusCode: 200;
  @example(#{ items: #[#{ id: "00000000-0000-0000-0000-000000000001", email: "alice@example.com", name: "Alice", role: "user", createdAt: utcDateTime.fromISO("2024-01-01T00:00:00.000Z") }], total: 1 })
  @body body: {
    items: User[];
    @minValue(0)
    total: integer;
  };
}

@doc("인증 실패 — 토큰 없음 또는 만료")
model ListUsers401Response {
  @statusCode statusCode: 401;
  @body body: Error;
}

@doc("사용자 생성 완료")
model CreateUser201Response {
  @statusCode statusCode: 201;
  @body body: User;
}

@doc("잘못된 요청 — 요청 형식 또는 파라미터 오류")
model CreateUser400Response {
  @statusCode statusCode: 400;
  @body body: Error;
}

@doc("인증 실패 — 토큰 없음 또는 만료")
model CreateUser401Response {
  @statusCode statusCode: 401;
  @body body: Error;
}

@doc("리소스 충돌 — 이미 등록된 이메일")
model CreateUser409Response {
  @statusCode statusCode: 409;
  @body body: Error;
}

@doc("스키마 유효성 검사 실패")
model CreateUser422Response {
  @statusCode statusCode: 422;
  @body body: Error;
}

@doc("서버 내부 오류")
model CreateUser500Response {
  @statusCode statusCode: 500;
  @body body: Error;
}

@summary("사용자 PII bulk export 작업 요청")
@doc("data-eng ETL surface. 사용자 PII bulk export를 비동기 job으로 등록하고\nExportJob을 반환합니다. non-admin perspective로 소비되는 export는\npseudonymization이 필수이며 기본값도 pseudonymize=true입니다. 호출은 audited.\n")
@tag("users")
@useAuth(bearerAuth)
@operationId("requestUsersExport")
@route("/admin/users/export")
@post
@extension("x-oa-sdk-operation-examples", #{
  requestBody: #{
    application_json: #{
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            format: "json",
            pseudonymize: true
          },
          serializedValue: "{\"format\":\"json\",\"pseudonymize\":true}"
        }
      }
    }
  },
  responses: #{
    status_202_application_json: #{
      statusCode: "202",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            jobId: "00000000-0000-0000-0000-000000000201",
            status: "queued",
            requestedAt: "2026-05-04T00:00:00.000Z"
          },
          serializedValue: "{\"jobId\":\"00000000-0000-0000-0000-000000000201\",\"status\":\"queued\",\"requestedAt\":\"2026-05-04T00:00:00.000Z\"}"
        }
      }
    },
    status_401_application_json: #{
      statusCode: "401",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "UNAUTHORIZED",
            message: "인증이 필요합니다"
          },
          serializedValue: "{\"code\":\"UNAUTHORIZED\",\"message\":\"인증이 필요합니다\"}"
        }
      }
    },
    status_403_application_json: #{
      statusCode: "403",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "FORBIDDEN",
            message: "이 리소스에 접근할 권한이 없습니다"
          },
          serializedValue: "{\"code\":\"FORBIDDEN\",\"message\":\"이 리소스에 접근할 권한이 없습니다\"}"
        }
      }
    },
    status_429_application_json: #{
      statusCode: "429",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "RATE_LIMITED",
            message: "요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요"
          },
          serializedValue: "{\"code\":\"RATE_LIMITED\",\"message\":\"요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요\"}"
        }
      }
    }
  }
})
@extension("x-oa-sdk-operation-component-refs", #{
  responses: #[
    #{
      statusCode: "401",
      ref: "#/components/responses/Unauthorized"
    },
    #{
      statusCode: "403",
      ref: "#/components/responses/Forbidden"
    },
    #{
      statusCode: "429",
      ref: "#/components/responses/TooManyRequests"
    }
  ]
})
op requestUsersExport(
  @body body?: AdminUsersExportRequest,
): RequestUsersExport202Response | RequestUsersExport401Response | RequestUsersExport403Response | RequestUsersExport429Response;

@summary("사용자 영구 삭제")
@doc("site-admin authority only. deleteUser와 별도의 권한 및 감사 절차를 적용하는\nhard purge입니다. legal hold override 여부와 사유를 감사 로그에 남기며\n호출은 audited.\n")
@tag("users")
@useAuth(bearerAuth)
@operationId("purgeUser")
@route("/admin/users/{id}/purge")
@post
@extension("x-oa-sdk-operation-examples", #{
  parameters: #{
    path_id: #{
      in: "path",
      name: "id",
      examples: #{
        default: #{
          dataValue: "00000000-0000-0000-0000-000000000001",
          serializedValue: "00000000-0000-0000-0000-000000000001"
        }
      }
    }
  },
  requestBody: #{
    application_json: #{
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            reason: "confirmed policy violation",
            legalHoldOverride: false
          },
          serializedValue: "{\"reason\":\"confirmed policy violation\",\"legalHoldOverride\":false}"
        }
      }
    }
  },
  responses: #{
    status_400_application_json: #{
      statusCode: "400",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "BAD_REQUEST",
            message: "요청 형식이 올바르지 않습니다"
          },
          serializedValue: "{\"code\":\"BAD_REQUEST\",\"message\":\"요청 형식이 올바르지 않습니다\"}"
        }
      }
    },
    status_401_application_json: #{
      statusCode: "401",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "UNAUTHORIZED",
            message: "인증이 필요합니다"
          },
          serializedValue: "{\"code\":\"UNAUTHORIZED\",\"message\":\"인증이 필요합니다\"}"
        }
      }
    },
    status_403_application_json: #{
      statusCode: "403",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "FORBIDDEN",
            message: "이 리소스에 접근할 권한이 없습니다"
          },
          serializedValue: "{\"code\":\"FORBIDDEN\",\"message\":\"이 리소스에 접근할 권한이 없습니다\"}"
        }
      }
    },
    status_404_application_json: #{
      statusCode: "404",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "NOT_FOUND",
            message: "요청한 리소스를 찾을 수 없습니다"
          },
          serializedValue: "{\"code\":\"NOT_FOUND\",\"message\":\"요청한 리소스를 찾을 수 없습니다\"}"
        }
      }
    }
  }
})
@extension("x-oa-sdk-operation-component-refs", #{
  responses: #[
    #{
      statusCode: "400",
      ref: "#/components/responses/BadRequest"
    },
    #{
      statusCode: "401",
      ref: "#/components/responses/Unauthorized"
    },
    #{
      statusCode: "403",
      ref: "#/components/responses/Forbidden"
    },
    #{
      statusCode: "404",
      ref: "#/components/responses/NotFound"
    }
  ]
})
op purgeUser(
  @doc("영구 삭제 대상 사용자 UUID") @path @format("uuid") id: string,
  @body body: PurgeUserRequest,
): PurgeUser204Response | PurgeUser400Response | PurgeUser401Response | PurgeUser403Response | PurgeUser404Response;

@summary("신고 큐 조회 (운영자)")
@doc("운영자(moderator) 전용. 처리 대기/처리 중 신고 일람. status 필터로\nopen/under-review/resolved 등 분기.\n")
@tag("users")
@useAuth(bearerAuth)
@operationId("listModerationReports")
@route("/moderation/reports")
@get
@extension("x-oa-sdk-operation-examples", #{
  parameters: #{
    query_page: #{
      in: "query",
      name: "page",
      examples: #{
        default: #{
          dataValue: 1,
          serializedValue: "page=1"
        }
      }
    },
    query_limit: #{
      in: "query",
      name: "limit",
      examples: #{
        default: #{
          dataValue: 20,
          serializedValue: "limit=20"
        }
      }
    }
  },
  responses: #{
    status_200_application_json: #{
      statusCode: "200",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            items: #[
              #{
                id: "00000000-0000-0000-0000-000000000300",
                targetUserId: "00000000-0000-0000-0000-000000000001",
                reporterUserId: "00000000-0000-0000-0000-000000000002",
                reason: "harassment",
                status: "open",
                createdAt: "2026-05-04T00:00:00.000Z"
              }
            ],
            total: 1
          }
        }
      }
    },
    status_401_application_json: #{
      statusCode: "401",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "UNAUTHORIZED",
            message: "인증이 필요합니다"
          },
          serializedValue: "{\"code\":\"UNAUTHORIZED\",\"message\":\"인증이 필요합니다\"}"
        }
      }
    },
    status_403_application_json: #{
      statusCode: "403",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "FORBIDDEN",
            message: "이 리소스에 접근할 권한이 없습니다"
          },
          serializedValue: "{\"code\":\"FORBIDDEN\",\"message\":\"이 리소스에 접근할 권한이 없습니다\"}"
        }
      }
    }
  }
})
@extension("x-oa-sdk-operation-component-refs", #{
  parameters: #[
    #{
      index: 0,
      ref: "#/components/parameters/Page"
    },
    #{
      index: 1,
      ref: "#/components/parameters/Limit"
    }
  ],
  responses: #[
    #{
      statusCode: "401",
      ref: "#/components/responses/Unauthorized"
    },
    #{
      statusCode: "403",
      ref: "#/components/responses/Forbidden"
    }
  ]
})
op listModerationReports(
  @doc("페이지 번호 (1-based)") @query @minValue(1) page?: integer = 1,
  @doc("페이지당 항목 수") @query @minValue(1) @maxValue(100) limit?: integer = 20,
  @doc("신고 상태 필터") @query status?: ReportStatus,
): ListModerationReports200Response | ListModerationReports401Response | ListModerationReports403Response;

@summary("사용자 단건 조회")
@doc("UUID로 특정 사용자의 상세 정보를 조회합니다")
@tag("users")
@useAuth(bearerAuth)
@operationId("getUserById")
@route("/users/{id}")
@get
@extension("x-oa-sdk-operation-examples", #{
  parameters: #{
    path_id: #{
      in: "path",
      name: "id",
      examples: #{
        default: #{
          dataValue: "00000000-0000-0000-0000-000000000001",
          serializedValue: "00000000-0000-0000-0000-000000000001"
        }
      }
    }
  },
  responses: #{
    status_200_application_json: #{
      statusCode: "200",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            id: "00000000-0000-0000-0000-000000000001",
            email: "alice@example.com",
            name: "Alice",
            role: "user",
            createdAt: "2024-01-01T00:00:00.000Z"
          }
        }
      }
    },
    status_401_application_json: #{
      statusCode: "401",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "UNAUTHORIZED",
            message: "인증이 필요합니다"
          },
          serializedValue: "{\"code\":\"UNAUTHORIZED\",\"message\":\"인증이 필요합니다\"}"
        }
      }
    },
    status_404_application_json: #{
      statusCode: "404",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "NOT_FOUND",
            message: "요청한 리소스를 찾을 수 없습니다"
          },
          serializedValue: "{\"code\":\"NOT_FOUND\",\"message\":\"요청한 리소스를 찾을 수 없습니다\"}"
        }
      }
    }
  }
})
@extension("x-oa-sdk-operation-component-refs", #{
  responses: #[
    #{
      statusCode: "401",
      ref: "#/components/responses/Unauthorized"
    },
    #{
      statusCode: "404",
      ref: "#/components/responses/NotFound"
    }
  ]
})
op getUserById(
  @doc("사용자 UUID") @path @format("uuid") id: string,
): GetUserById200Response | GetUserById401Response | GetUserById404Response;

@summary("사용자 삭제")
@doc("UUID로 특정 사용자를 삭제합니다. 복구 불가.")
@tag("users")
@useAuth(bearerAuth)
@operationId("deleteUser")
@route("/users/{id}")
@delete
@extension("x-oa-sdk-operation-examples", #{
  parameters: #{
    path_id: #{
      in: "path",
      name: "id",
      examples: #{
        default: #{
          dataValue: "00000000-0000-0000-0000-000000000001",
          serializedValue: "00000000-0000-0000-0000-000000000001"
        }
      }
    }
  },
  responses: #{
    status_401_application_json: #{
      statusCode: "401",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "UNAUTHORIZED",
            message: "인증이 필요합니다"
          },
          serializedValue: "{\"code\":\"UNAUTHORIZED\",\"message\":\"인증이 필요합니다\"}"
        }
      }
    },
    status_404_application_json: #{
      statusCode: "404",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "NOT_FOUND",
            message: "요청한 리소스를 찾을 수 없습니다"
          },
          serializedValue: "{\"code\":\"NOT_FOUND\",\"message\":\"요청한 리소스를 찾을 수 없습니다\"}"
        }
      }
    }
  }
})
@extension("x-oa-sdk-operation-component-refs", #{
  responses: #[
    #{
      statusCode: "401",
      ref: "#/components/responses/Unauthorized"
    },
    #{
      statusCode: "404",
      ref: "#/components/responses/NotFound"
    }
  ]
})
op deleteUser(
  @doc("사용자 UUID") @path @format("uuid") id: string,
): DeleteUser204Response | DeleteUser401Response | DeleteUser404Response;

@summary("사용자 수정 (부분 업데이트)")
@doc("이름, 역할 등 사용자 정보를 부분적으로 수정합니다")
@tag("users")
@useAuth(bearerAuth)
@operationId("updateUser")
@route("/users/{id}")
@patch
@extension("x-oa-sdk-operation-examples", #{
  parameters: #{
    path_id: #{
      in: "path",
      name: "id",
      examples: #{
        default: #{
          dataValue: "00000000-0000-0000-0000-000000000001",
          serializedValue: "00000000-0000-0000-0000-000000000001"
        }
      }
    }
  },
  requestBody: #{
    application_json: #{
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            name: "Alice Updated"
          },
          serializedValue: "{\"name\":\"Alice Updated\"}"
        }
      }
    }
  },
  responses: #{
    status_200_application_json: #{
      statusCode: "200",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            id: "00000000-0000-0000-0000-000000000001",
            email: "alice@example.com",
            name: "Alice Updated",
            role: "user",
            createdAt: "2024-01-01T00:00:00.000Z"
          }
        }
      }
    },
    status_400_application_json: #{
      statusCode: "400",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "BAD_REQUEST",
            message: "요청 형식이 올바르지 않습니다"
          },
          serializedValue: "{\"code\":\"BAD_REQUEST\",\"message\":\"요청 형식이 올바르지 않습니다\"}"
        }
      }
    },
    status_401_application_json: #{
      statusCode: "401",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "UNAUTHORIZED",
            message: "인증이 필요합니다"
          },
          serializedValue: "{\"code\":\"UNAUTHORIZED\",\"message\":\"인증이 필요합니다\"}"
        }
      }
    },
    status_403_application_json: #{
      statusCode: "403",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "FORBIDDEN",
            message: "이 리소스에 접근할 권한이 없습니다"
          },
          serializedValue: "{\"code\":\"FORBIDDEN\",\"message\":\"이 리소스에 접근할 권한이 없습니다\"}"
        }
      }
    },
    status_404_application_json: #{
      statusCode: "404",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "NOT_FOUND",
            message: "요청한 리소스를 찾을 수 없습니다"
          },
          serializedValue: "{\"code\":\"NOT_FOUND\",\"message\":\"요청한 리소스를 찾을 수 없습니다\"}"
        }
      }
    },
    status_422_application_json: #{
      statusCode: "422",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "SCHEMA_VALIDATION_FAILED",
            message: "요청 본문이 스키마 유효성 검사를 통과하지 못했습니다"
          },
          serializedValue: "{\"code\":\"SCHEMA_VALIDATION_FAILED\",\"message\":\"요청 본문이 스키마 유효성 검사를 통과하지 못했습니다\"}"
        }
      }
    }
  }
})
@extension("x-oa-sdk-operation-component-refs", #{
  responses: #[
    #{
      statusCode: "400",
      ref: "#/components/responses/BadRequest"
    },
    #{
      statusCode: "401",
      ref: "#/components/responses/Unauthorized"
    },
    #{
      statusCode: "403",
      ref: "#/components/responses/Forbidden"
    },
    #{
      statusCode: "404",
      ref: "#/components/responses/NotFound"
    },
    #{
      statusCode: "422",
      ref: "#/components/responses/UnprocessableEntity"
    }
  ]
})
op updateUser(
  @doc("사용자 UUID") @path @format("uuid") id: string,
  @body body: UpdateUserRequest,
): UpdateUser200Response | UpdateUser400Response | UpdateUser401Response | UpdateUser403Response | UpdateUser404Response | UpdateUser422Response;

@summary("공개 프로필 조회")
@doc("다른 user의 공개 가시 정보(이름, 역할). email/createdAt 등 PII 미포함.\n멘션·검색 결과 등에서 사용. user/scoped:read 이상 필요.\n")
@tag("users")
@useAuth(bearerAuth)
@operationId("getPublicUserProfile")
@route("/users/{id}/public")
@get
@extension("x-oa-sdk-operation-examples", #{
  parameters: #{
    path_id: #{
      in: "path",
      name: "id",
      examples: #{
        default: #{
          dataValue: "00000000-0000-0000-0000-000000000001",
          serializedValue: "00000000-0000-0000-0000-000000000001"
        }
      }
    }
  },
  responses: #{
    status_200_application_json: #{
      statusCode: "200",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            id: "00000000-0000-0000-0000-000000000001",
            name: "Alice",
            role: "user"
          },
          serializedValue: "{\"id\":\"00000000-0000-0000-0000-000000000001\",\"name\":\"Alice\",\"role\":\"user\"}"
        }
      }
    },
    status_401_application_json: #{
      statusCode: "401",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "UNAUTHORIZED",
            message: "인증이 필요합니다"
          },
          serializedValue: "{\"code\":\"UNAUTHORIZED\",\"message\":\"인증이 필요합니다\"}"
        }
      }
    },
    status_404_application_json: #{
      statusCode: "404",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "NOT_FOUND",
            message: "요청한 리소스를 찾을 수 없습니다"
          },
          serializedValue: "{\"code\":\"NOT_FOUND\",\"message\":\"요청한 리소스를 찾을 수 없습니다\"}"
        }
      }
    }
  }
})
@extension("x-oa-sdk-operation-component-refs", #{
  responses: #[
    #{
      statusCode: "401",
      ref: "#/components/responses/Unauthorized"
    },
    #{
      statusCode: "404",
      ref: "#/components/responses/NotFound"
    }
  ]
})
op getPublicUserProfile(
  @doc("사용자 UUID") @path @format("uuid") id: string,
): GetPublicUserProfile200Response | GetPublicUserProfile401Response | GetPublicUserProfile404Response;

@summary("사용자 신고")
@doc("혐오·스팸·사기 등 정책 위반 사용자를 운영자에게 신고. 신고자는 인증된\nuser. 동일 신고자→대상 페어는 24시간 내 1회로 rate-limit.\n")
@tag("users")
@useAuth(bearerAuth)
@operationId("reportUser")
@route("/users/{id}/reports")
@post
@extension("x-oa-sdk-operation-examples", #{
  requestBody: #{
    application_json: #{
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            reason: "harassment",
            details: "공격적 메시지 반복 발신"
          },
          serializedValue: "{\"reason\":\"harassment\",\"details\":\"공격적 메시지 반복 발신\"}"
        }
      }
    }
  },
  responses: #{
    status_201_application_json: #{
      statusCode: "201",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            id: "00000000-0000-0000-0000-000000000300",
            targetUserId: "00000000-0000-0000-0000-000000000001",
            reporterUserId: "00000000-0000-0000-0000-000000000002",
            reason: "harassment",
            status: "open",
            createdAt: "2026-05-04T00:00:00.000Z"
          },
          serializedValue: "{\"id\":\"00000000-0000-0000-0000-000000000300\",\"targetUserId\":\"00000000-0000-0000-0000-000000000001\",\"reporterUserId\":\"00000000-0000-0000-0000-000000000002\",\"reason\":\"harassment\",\"status\":\"open\",\"createdAt\":\"2026-05-04T00:00:00.000Z\"}"
        }
      }
    },
    status_400_application_json: #{
      statusCode: "400",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "BAD_REQUEST",
            message: "요청 형식이 올바르지 않습니다"
          },
          serializedValue: "{\"code\":\"BAD_REQUEST\",\"message\":\"요청 형식이 올바르지 않습니다\"}"
        }
      }
    },
    status_401_application_json: #{
      statusCode: "401",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "UNAUTHORIZED",
            message: "인증이 필요합니다"
          },
          serializedValue: "{\"code\":\"UNAUTHORIZED\",\"message\":\"인증이 필요합니다\"}"
        }
      }
    },
    status_422_application_json: #{
      statusCode: "422",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "SCHEMA_VALIDATION_FAILED",
            message: "요청 본문이 스키마 유효성 검사를 통과하지 못했습니다"
          },
          serializedValue: "{\"code\":\"SCHEMA_VALIDATION_FAILED\",\"message\":\"요청 본문이 스키마 유효성 검사를 통과하지 못했습니다\"}"
        }
      }
    },
    status_429_application_json: #{
      statusCode: "429",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "RATE_LIMITED",
            message: "요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요"
          },
          serializedValue: "{\"code\":\"RATE_LIMITED\",\"message\":\"요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요\"}"
        }
      }
    }
  }
})
@extension("x-oa-sdk-operation-component-refs", #{
  responses: #[
    #{
      statusCode: "400",
      ref: "#/components/responses/BadRequest"
    },
    #{
      statusCode: "401",
      ref: "#/components/responses/Unauthorized"
    },
    #{
      statusCode: "422",
      ref: "#/components/responses/UnprocessableEntity"
    },
    #{
      statusCode: "429",
      ref: "#/components/responses/TooManyRequests"
    }
  ]
})
op reportUser(
  @doc("신고 대상 사용자 UUID") @path @format("uuid") id: string,
  @body body: ReportRequest,
): ReportUser201Response | ReportUser400Response | ReportUser401Response | ReportUser422Response | ReportUser429Response;

@summary("사용자 목록 조회")
@doc("페이지네이션과 역할 필터를 지원하는 사용자 목록 API")
@tag("users")
@useAuth(bearerAuth)
@operationId("listUsers")
@route("/users")
@get
@extension("x-oa-sdk-operation-examples", #{
  parameters: #{
    query_page: #{
      in: "query",
      name: "page",
      examples: #{
        default: #{
          dataValue: 1,
          serializedValue: "page=1"
        }
      }
    },
    query_limit: #{
      in: "query",
      name: "limit",
      examples: #{
        default: #{
          dataValue: 20,
          serializedValue: "limit=20"
        }
      }
    }
  },
  responses: #{
    status_200_application_json: #{
      statusCode: "200",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            items: #[
              #{
                id: "00000000-0000-0000-0000-000000000001",
                email: "alice@example.com",
                name: "Alice",
                role: "user",
                createdAt: "2024-01-01T00:00:00.000Z"
              }
            ],
            total: 1
          },
          serializedValue: "{\"items\":[{\"id\":\"00000000-0000-0000-0000-000000000001\",\"email\":\"alice@example.com\",\"name\":\"Alice\",\"role\":\"user\",\"createdAt\":\"2024-01-01T00:00:00.000Z\"}],\"total\":1}"
        }
      }
    },
    status_401_application_json: #{
      statusCode: "401",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "UNAUTHORIZED",
            message: "인증이 필요합니다"
          },
          serializedValue: "{\"code\":\"UNAUTHORIZED\",\"message\":\"인증이 필요합니다\"}"
        }
      }
    }
  }
})
@extension("x-oa-sdk-operation-component-refs", #{
  parameters: #[
    #{
      index: 0,
      ref: "#/components/parameters/Page"
    },
    #{
      index: 1,
      ref: "#/components/parameters/Limit"
    }
  ],
  responses: #[
    #{
      statusCode: "401",
      ref: "#/components/responses/Unauthorized"
    }
  ]
})
op listUsers(
  @doc("페이지 번호 (1-based)") @query @minValue(1) page?: integer = 1,
  @doc("페이지당 항목 수") @query @minValue(1) @maxValue(100) limit?: integer = 20,
  @doc("역할 필터") @query role?: UserRole,
): ListUsers200Response | ListUsers401Response;

@summary("사용자 생성")
@doc("이메일, 이름, 비밀번호를 받아 새 사용자를 생성합니다. 이미 등록된 이메일은\n409 Conflict를 반환합니다.\n")
@tag("users")
@useAuth(bearerAuth)
@operationId("createUser")
@route("/users")
@post
@extension("x-oa-sdk-operation-examples", #{
  requestBody: #{
    application_json: #{
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            email: "bob@example.com",
            name: "Bob",
            password: "secure1234"
          },
          serializedValue: "{\"email\":\"bob@example.com\",\"name\":\"Bob\",\"password\":\"secure1234\"}"
        }
      }
    }
  },
  responses: #{
    status_201_application_json: #{
      statusCode: "201",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            id: "00000000-0000-0000-0000-000000000002",
            email: "bob@example.com",
            name: "Bob",
            role: "user",
            createdAt: "2024-01-01T00:00:00.000Z"
          }
        }
      }
    },
    status_400_application_json: #{
      statusCode: "400",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "BAD_REQUEST",
            message: "요청 형식이 올바르지 않습니다"
          },
          serializedValue: "{\"code\":\"BAD_REQUEST\",\"message\":\"요청 형식이 올바르지 않습니다\"}"
        }
      }
    },
    status_401_application_json: #{
      statusCode: "401",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "UNAUTHORIZED",
            message: "인증이 필요합니다"
          },
          serializedValue: "{\"code\":\"UNAUTHORIZED\",\"message\":\"인증이 필요합니다\"}"
        }
      }
    },
    status_409_application_json: #{
      statusCode: "409",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "CONFLICT",
            message: "이미 존재하는 리소스입니다"
          },
          serializedValue: "{\"code\":\"CONFLICT\",\"message\":\"이미 존재하는 리소스입니다\"}"
        }
      }
    },
    status_422_application_json: #{
      statusCode: "422",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "SCHEMA_VALIDATION_FAILED",
            message: "요청 본문이 스키마 유효성 검사를 통과하지 못했습니다"
          },
          serializedValue: "{\"code\":\"SCHEMA_VALIDATION_FAILED\",\"message\":\"요청 본문이 스키마 유효성 검사를 통과하지 못했습니다\"}"
        }
      }
    },
    status_500_application_json: #{
      statusCode: "500",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            code: "INTERNAL_SERVER_ERROR",
            message: "서버 내부 오류가 발생했습니다"
          },
          serializedValue: "{\"code\":\"INTERNAL_SERVER_ERROR\",\"message\":\"서버 내부 오류가 발생했습니다\"}"
        }
      }
    }
  }
})
@extension("x-oa-sdk-operation-component-refs", #{
  responses: #[
    #{
      statusCode: "400",
      ref: "#/components/responses/BadRequest"
    },
    #{
      statusCode: "401",
      ref: "#/components/responses/Unauthorized"
    },
    #{
      statusCode: "409",
      ref: "#/components/responses/Conflict"
    },
    #{
      statusCode: "422",
      ref: "#/components/responses/UnprocessableEntity"
    },
    #{
      statusCode: "500",
      ref: "#/components/responses/InternalServerError"
    }
  ]
})
op createUser(
  @body body: CreateUserRequest,
): CreateUser201Response | CreateUser400Response | CreateUser401Response | CreateUser409Response | CreateUser422Response | CreateUser500Response;
