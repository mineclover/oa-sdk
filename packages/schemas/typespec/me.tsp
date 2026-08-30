import "@typespec/http";
import "@typespec/openapi";

using Http;
using OpenAPI;

namespace OaSdkApi;

@doc("비밀번호 변경 요청")
model ChangePasswordRequest {
  @minLength(1)
  currentPassword: string;
  @doc("최소 8자 이상")
  @minLength(8)
  newPassword: string;
}

@doc("export job receipt. 이 계약의 POST 응답은 queued 상태만 반환하며, 이후 상태 전이와 downloadUrl 전달 방식은 runtime 계약이 별도로 정의합니다.")
@extension("example", #{ jobId: "00000000-0000-0000-0000-000000000200", status: "queued", requestedAt: "2026-05-04T00:00:00.000Z" })
model ExportJob {
  @format("uuid")
  jobId: string;
  status: "queued" | "running" | "ready" | "failed";
  requestedAt: utcDateTime;
  @doc("status가 ready일 때만 제공")
  @format("uri")
  downloadUrl?: string;
}

@doc("데이터 export 요청")
model ExportRequest {
  format?: "json" | "csv" = "json";
}

@doc("온보딩 가이드 체크리스트")
@extension("example", #{ items: #[#{ id: "complete-profile", title: "프로필 작성", completed: false }] })
model OnboardingChecklist {
  items: OnboardingItem[];
}

model OnboardingItem {
  id: string;
  title: string;
  completed: boolean;
  hint?: string;
}

@doc("역할 변경 이력 단건")
model RoleChangeEvent {
  @format("uuid")
  id: string;
  changedAt: utcDateTime;
  previousRole: "admin" | "user" | "guest";
  newRole: "admin" | "user" | "guest";
  @doc("변경을 수행한 admin의 UUID")
  @format("uuid")
  changedBy: string;
  reason?: string;
}

@doc("셀프 프로필 수정 — name만 허용하며 role과 알 수 없는 필드는 포함할 수 없음")
model UpdateMeRequest {
  @minLength(1)
  @maxLength(100)
  name: string;
  ...Record<never>;
}

@doc("비밀번호 변경 완료 (본문 없음)")
model ChangeMyPassword204Response {
  @statusCode statusCode: 204;
}

@doc("잘못된 요청 — 요청 형식 또는 파라미터 오류")
model ChangeMyPassword400Response {
  @statusCode statusCode: 400;
  @body body: Error;
}

@doc("인증 실패 — 토큰 없음 또는 만료")
model ChangeMyPassword401Response {
  @statusCode statusCode: 401;
  @body body: Error;
}

@doc("스키마 유효성 검사 실패")
model ChangeMyPassword422Response {
  @statusCode statusCode: 422;
  @body body: Error;
}

@doc("export job 등록 완료")
model RequestMyDataExport202Response {
  @statusCode statusCode: 202;
  @body body: ExportJob;
}

@doc("인증 실패 — 토큰 없음 또는 만료")
model RequestMyDataExport401Response {
  @statusCode statusCode: 401;
  @body body: Error;
}

@doc("요청 제한 초과 — Retry-After 헤더로 재시도 가능 시점 안내")
model RequestMyDataExport429Response {
  @statusCode statusCode: 429;
  @body body: Error;
  @doc("재시도 가능 시점 (초 단위 정수 또는 HTTP-date)")
  @header("Retry-After")
  @example("30")
  retryAfter: string;
}

@doc("체크리스트")
model GetOnboardingChecklist200Response {
  @statusCode statusCode: 200;
  @body body: OnboardingChecklist;
}

@doc("인증 실패 — 토큰 없음 또는 만료")
model GetOnboardingChecklist401Response {
  @statusCode statusCode: 401;
  @body body: Error;
}

@doc("내 사용자 정보")
model GetMe200Response {
  @statusCode statusCode: 200;
  @body body: User;
}

@doc("인증 실패 — 토큰 없음 또는 만료")
model GetMe401Response {
  @statusCode statusCode: 401;
  @body body: Error;
}

@doc("탈퇴 처리 완료 (본문 없음)")
model DeleteMyAccount204Response {
  @statusCode statusCode: 204;
}

@doc("인증 실패 — 토큰 없음 또는 만료")
model DeleteMyAccount401Response {
  @statusCode statusCode: 401;
  @body body: Error;
}

@doc("수정된 내 사용자 정보")
model UpdateMe200Response {
  @statusCode statusCode: 200;
  @body body: User;
}

@doc("잘못된 요청 — 요청 형식 또는 파라미터 오류")
model UpdateMe400Response {
  @statusCode statusCode: 400;
  @body body: Error;
}

@doc("인증 실패 — 토큰 없음 또는 만료")
model UpdateMe401Response {
  @statusCode statusCode: 401;
  @body body: Error;
}

@doc("스키마 유효성 검사 실패")
model UpdateMe422Response {
  @statusCode statusCode: 422;
  @body body: Error;
}

@doc("역할 변경 이력")
model ListMyRoleChanges200Response {
  @statusCode statusCode: 200;
  @example(#{ items: #[#{ id: "00000000-0000-0000-0000-000000000100", changedAt: utcDateTime.fromISO("2026-04-01T00:00:00.000Z"), previousRole: "user", newRole: "admin", changedBy: "00000000-0000-0000-0000-000000000099", reason: "권한 위임" }], total: 1 })
  @body body: {
    items: RoleChangeEvent[];
    @minValue(0)
    total: integer;
  };
}

@doc("인증 실패 — 토큰 없음 또는 만료")
model ListMyRoleChanges401Response {
  @statusCode statusCode: 401;
  @body body: Error;
}

@summary("내 비밀번호 변경")
@doc("현재 비밀번호 검증 후 새 비밀번호로 교체합니다. 성공 시 기존 refresh 토큰은\n무효화될 수 있으므로 클라이언트는 재로그인 또는 refresh 흐름을 다시 시작해야 합니다.\n")
@tag("me")
@useAuth(bearerAuth)
@operationId("changeMyPassword")
@route("/me/change-password")
@post
@extension("x-oa-sdk-operation-examples", #{
  requestBody: #{
    application_json: #{
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            currentPassword: "secure1234",
            newPassword: "evenmoresecure5678"
          },
          serializedValue: "{\"currentPassword\":\"secure1234\",\"newPassword\":\"evenmoresecure5678\"}"
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
      statusCode: "422",
      ref: "#/components/responses/UnprocessableEntity"
    }
  ]
})
op changeMyPassword(
  @body body: ChangePasswordRequest,
): ChangeMyPassword204Response | ChangeMyPassword400Response | ChangeMyPassword401Response | ChangeMyPassword422Response;

@summary("내 데이터 export 작업 요청")
@doc("GDPR 정보주체 이동권 대응. 비동기 job 생성 후 jobId를 반환합니다. 이 operation은\n수락 receipt만 정의하며 완료 알림, 상태 조회, downloadUrl 전달은 runtime 계약이 별도로\n제공해야 합니다. 동시 진행 1건 제한.\n")
@tag("me")
@useAuth(bearerAuth)
@operationId("requestMyDataExport")
@route("/me/export")
@post
@extension("x-oa-sdk-operation-examples", #{
  requestBody: #{
    application_json: #{
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            format: "json"
          },
          serializedValue: "{\"format\":\"json\"}"
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
            jobId: "00000000-0000-0000-0000-000000000200",
            status: "queued",
            requestedAt: "2026-05-04T00:00:00.000Z"
          },
          serializedValue: "{\"jobId\":\"00000000-0000-0000-0000-000000000200\",\"status\":\"queued\",\"requestedAt\":\"2026-05-04T00:00:00.000Z\"}"
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
      statusCode: "429",
      ref: "#/components/responses/TooManyRequests"
    }
  ]
})
op requestMyDataExport(
  @body body?: ExportRequest,
): RequestMyDataExport202Response | RequestMyDataExport401Response | RequestMyDataExport429Response;

@summary("온보딩 체크리스트 조회")
@doc("첫 로그인 시 표시할 가이드 체크리스트. 진행률은 user state에 따름.")
@tag("me")
@useAuth(bearerAuth)
@operationId("getOnboardingChecklist")
@route("/me/onboarding")
@get
@extension("x-oa-sdk-operation-examples", #{
  responses: #{
    status_200_application_json: #{
      statusCode: "200",
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            items: #[
              #{
                id: "complete-profile",
                title: "프로필 작성",
                completed: false
              },
              #{
                id: "invite-team",
                title: "팀원 초대",
                completed: false
              }
            ]
          },
          serializedValue: "{\"items\":[{\"id\":\"complete-profile\",\"title\":\"프로필 작성\",\"completed\":false},{\"id\":\"invite-team\",\"title\":\"팀원 초대\",\"completed\":false}]}"
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
  responses: #[
    #{
      statusCode: "401",
      ref: "#/components/responses/Unauthorized"
    }
  ]
})
op getOnboardingChecklist(): GetOnboardingChecklist200Response | GetOnboardingChecklist401Response;

@summary("내 정보 조회")
@doc("현재 access 토큰으로 식별되는 사용자의 정보를 반환합니다.")
@tag("me")
@useAuth(bearerAuth)
@operationId("getMe")
@route("/me")
@get
@extension("x-oa-sdk-operation-examples", #{
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
    }
  }
})
@extension("x-oa-sdk-operation-component-refs", #{
  responses: #[
    #{
      statusCode: "401",
      ref: "#/components/responses/Unauthorized"
    }
  ]
})
op getMe(): GetMe200Response | GetMe401Response;

@summary("셀프 계정 탈퇴 (soft-delete)")
@doc("본인 계정 비활성화. PIPA/GDPR right-to-erasure 대응. 30일 이내 복구 가능,\n이후 영구 파기. 응답 본문 없음.\n")
@tag("me")
@useAuth(bearerAuth)
@operationId("deleteMyAccount")
@route("/me")
@delete
@extension("x-oa-sdk-operation-examples", #{
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
    }
  }
})
@extension("x-oa-sdk-operation-component-refs", #{
  responses: #[
    #{
      statusCode: "401",
      ref: "#/components/responses/Unauthorized"
    }
  ]
})
op deleteMyAccount(): DeleteMyAccount204Response | DeleteMyAccount401Response;

@summary("내 정보 수정 (부분 업데이트)")
@doc("현재 사용자의 name 등 프로필을 수정합니다. role은 셀프 변경 불가 — admin이\n/users/{id} 를 통해서만 변경할 수 있습니다.\n")
@tag("me")
@useAuth(bearerAuth)
@operationId("updateMe")
@route("/me")
@patch
@extension("x-oa-sdk-operation-examples", #{
  requestBody: #{
    application_json: #{
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            name: "Alice (self-edit)"
          },
          serializedValue: "{\"name\":\"Alice (self-edit)\"}"
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
      statusCode: "422",
      ref: "#/components/responses/UnprocessableEntity"
    }
  ]
})
op updateMe(
  @body body: UpdateMeRequest,
): UpdateMe200Response | UpdateMe400Response | UpdateMe401Response | UpdateMe422Response;

@summary("내 역할 변경 이력 조회")
@doc("admin이 내 역할을 변경한 이력 일람. target-of-action 페르소나의 surface.\n변경 시점·이전/현재 역할·변경자·사유 포함.\n")
@tag("me")
@useAuth(bearerAuth)
@operationId("listMyRoleChanges")
@route("/me/role-changes")
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
                id: "00000000-0000-0000-0000-000000000100",
                changedAt: "2026-04-01T00:00:00.000Z",
                previousRole: "user",
                newRole: "admin",
                changedBy: "00000000-0000-0000-0000-000000000099",
                reason: "권한 위임"
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
op listMyRoleChanges(
  @doc("페이지 번호 (1-based)") @query @minValue(1) page?: integer = 1,
  @doc("페이지당 항목 수") @query @minValue(1) @maxValue(100) limit?: integer = 20,
): ListMyRoleChanges200Response | ListMyRoleChanges401Response;
