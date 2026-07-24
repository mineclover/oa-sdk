import "@typespec/http";
import "@typespec/openapi";

using Http;
using OpenAPI;

namespace OaSdkApi;

@doc("사용자 + 토큰 페어 — 가입/로그인 응답 단위")
@extension("example", #{ user: #{ id: "00000000-0000-0000-0000-000000000001", email: "alice@example.com", name: "Alice", role: "user", createdAt: "2024-01-01T00:00:00.000Z" }, tokens: #{ accessToken: "eyJhbGciOi...example", refreshToken: "rt_example_0001", tokenType: "Bearer", expiresIn: 3600 } })
model AuthSession {
  user: User;
  tokens: TokenPair;
}

@doc("비밀번호 재설정 토큰 발송 요청")
model ForgotPasswordRequest {
  @format("email")
  email: string;
}

@doc("로그인 요청")
model LoginRequest {
  @format("email")
  email: string;
  @minLength(1)
  password: string;
}

@doc("토큰 갱신 요청")
model RefreshRequest {
  @minLength(1)
  refreshToken: string;
}

@doc("회원가입 요청")
model RegisterRequest {
  @format("email")
  email: string;
  @minLength(1)
  @maxLength(100)
  name: string;
  @doc("최소 8자 이상")
  @minLength(8)
  password: string;
}

@doc("비밀번호 재설정 요청")
model ResetPasswordRequest {
  @minLength(1)
  token: string;
  @doc("최소 8자 이상")
  @minLength(8)
  newPassword: string;
}

@doc("access/refresh 토큰 페어")
@extension("example", #{ accessToken: "eyJhbGciOi...example", refreshToken: "rt_example_0001", tokenType: "Bearer", expiresIn: 3600 })
model TokenPair {
  @doc("bearerAuth 헤더에 사용할 JWT")
  accessToken: string;
  @doc("/auth/refresh 호출에 사용할 장기 토큰")
  refreshToken: string;
  tokenType: "Bearer";
  @doc("accessToken 만료까지 남은 초")
  @minValue(1)
  expiresIn: integer;
}

@doc("토큰 발송 처리 완료 (본문 없음)")
model ForgotPassword204Response {
  @statusCode statusCode: 204;
}

@doc("잘못된 요청 — 요청 형식 또는 파라미터 오류")
model ForgotPassword400Response {
  @statusCode statusCode: 400;
  @body body: Error;
}

@doc("스키마 유효성 검사 실패")
model ForgotPassword422Response {
  @statusCode statusCode: 422;
  @body body: Error;
}

@doc("요청 제한 초과 — Retry-After 헤더로 재시도 가능 시점 안내")
model ForgotPassword429Response {
  @statusCode statusCode: 429;
  @body body: Error;
  @doc("재시도 가능 시점 (초 단위 정수 또는 HTTP-date)")
  @header("Retry-After")
  @example("30")
  retryAfter: string;
}

@doc("로그인 성공")
model Login200Response {
  @statusCode statusCode: 200;
  @body body: AuthSession;
}

@doc("잘못된 요청 — 요청 형식 또는 파라미터 오류")
model Login400Response {
  @statusCode statusCode: 400;
  @body body: Error;
}

@doc("인증 실패 — 토큰 없음 또는 만료")
model Login401Response {
  @statusCode statusCode: 401;
  @body body: Error;
}

@doc("스키마 유효성 검사 실패")
model Login422Response {
  @statusCode statusCode: 422;
  @body body: Error;
}

@doc("요청 제한 초과 — Retry-After 헤더로 재시도 가능 시점 안내")
model Login429Response {
  @statusCode statusCode: 429;
  @body body: Error;
  @doc("재시도 가능 시점 (초 단위 정수 또는 HTTP-date)")
  @header("Retry-After")
  @example("30")
  retryAfter: string;
}

@doc("로그아웃 완료 (본문 없음)")
model Logout204Response {
  @statusCode statusCode: 204;
}

@doc("인증 실패 — 토큰 없음 또는 만료")
model Logout401Response {
  @statusCode statusCode: 401;
  @body body: Error;
}

@doc("갱신된 토큰 페어")
model RefreshToken200Response {
  @statusCode statusCode: 200;
  @body body: TokenPair;
}

@doc("인증 실패 — 토큰 없음 또는 만료")
model RefreshToken401Response {
  @statusCode statusCode: 401;
  @body body: Error;
}

@doc("스키마 유효성 검사 실패")
model RefreshToken422Response {
  @statusCode statusCode: 422;
  @body body: Error;
}

@doc("회원가입 + 토큰 발급")
model Register201Response {
  @statusCode statusCode: 201;
  @body body: AuthSession;
}

@doc("잘못된 요청 — 요청 형식 또는 파라미터 오류")
model Register400Response {
  @statusCode statusCode: 400;
  @body body: Error;
}

@doc("리소스 충돌 — 중복 식별자 또는 동시성 충돌")
model Register409Response {
  @statusCode statusCode: 409;
  @body body: Error;
}

@doc("스키마 유효성 검사 실패")
model Register422Response {
  @statusCode statusCode: 422;
  @body body: Error;
}

@doc("요청 제한 초과 — Retry-After 헤더로 재시도 가능 시점 안내")
model Register429Response {
  @statusCode statusCode: 429;
  @body body: Error;
  @doc("재시도 가능 시점 (초 단위 정수 또는 HTTP-date)")
  @header("Retry-After")
  @example("30")
  retryAfter: string;
}

@doc("비밀번호 갱신 완료 (본문 없음)")
model ResetPassword204Response {
  @statusCode statusCode: 204;
}

@doc("잘못된 요청 — 요청 형식 또는 파라미터 오류")
model ResetPassword400Response {
  @statusCode statusCode: 400;
  @body body: Error;
}

@doc("인증 실패 — 토큰 없음 또는 만료")
model ResetPassword401Response {
  @statusCode statusCode: 401;
  @body body: Error;
}

@doc("스키마 유효성 검사 실패")
model ResetPassword422Response {
  @statusCode statusCode: 422;
  @body body: Error;
}

@summary("비밀번호 재설정 토큰 발송 (공개)")
@doc("이메일로 reset 토큰 링크를 발송합니다. 이메일이 시스템에 없어도 동일한 204를\n반환 (enumeration 방지). 인증 불필요.\n")
@tag("auth")
@operationId("forgotPassword")
@route("/auth/forgot-password")
@post
@extension("x-oa-sdk-operation-security", #[])
@extension("x-oa-sdk-operation-examples", #{
  requestBody: #{
    application_json: #{
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            email: "alice@example.com"
          },
          serializedValue: "{\"email\":\"alice@example.com\"}"
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
      statusCode: "422",
      ref: "#/components/responses/UnprocessableEntity"
    },
    #{
      statusCode: "429",
      ref: "#/components/responses/TooManyRequests"
    }
  ]
})
op forgotPassword(
  @body body: ForgotPasswordRequest,
): ForgotPassword204Response | ForgotPassword400Response | ForgotPassword422Response | ForgotPassword429Response;

@summary("로그인 (공개)")
@doc("이메일과 비밀번호를 검증하고 access/refresh 토큰 페어를 발급합니다. 인증 불필요.")
@tag("auth")
@operationId("login")
@route("/auth/login")
@post
@extension("x-oa-sdk-operation-security", #[])
@extension("x-oa-sdk-operation-examples", #{
  requestBody: #{
    application_json: #{
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            email: "alice@example.com",
            password: "secure1234"
          },
          serializedValue: "{\"email\":\"alice@example.com\",\"password\":\"secure1234\"}"
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
            user: #{
              id: "00000000-0000-0000-0000-000000000001",
              email: "alice@example.com",
              name: "Alice",
              role: "user",
              createdAt: "2024-01-01T00:00:00.000Z"
            },
            tokens: #{
              accessToken: "eyJhbGciOi...login",
              refreshToken: "rt_login_0001",
              tokenType: "Bearer",
              expiresIn: 3600
            }
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
op login(
  @body body: LoginRequest,
): Login200Response | Login400Response | Login401Response | Login422Response | Login429Response;

@summary("로그아웃")
@doc("현재 access 토큰과 연결된 세션을 종료합니다. 응답 본문 없음.")
@tag("auth")
@useAuth(bearerAuth)
@operationId("logout")
@route("/auth/logout")
@post
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
op logout(): Logout204Response | Logout401Response;

@summary("토큰 갱신 (공개)")
@doc("유효한 refresh 토큰으로 새 access 토큰 페어를 발급합니다. access 토큰 인증 불필요.")
@tag("auth")
@operationId("refreshToken")
@route("/auth/refresh")
@post
@extension("x-oa-sdk-operation-security", #[])
@extension("x-oa-sdk-operation-examples", #{
  requestBody: #{
    application_json: #{
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            refreshToken: "rt_login_0001"
          },
          serializedValue: "{\"refreshToken\":\"rt_login_0001\"}"
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
            accessToken: "eyJhbGciOi...refreshed",
            refreshToken: "rt_login_0002",
            tokenType: "Bearer",
            expiresIn: 3600
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
      statusCode: "401",
      ref: "#/components/responses/Unauthorized"
    },
    #{
      statusCode: "422",
      ref: "#/components/responses/UnprocessableEntity"
    }
  ]
})
op refreshToken(
  @body body: RefreshRequest,
): RefreshToken200Response | RefreshToken401Response | RefreshToken422Response;

@summary("회원가입 (공개)")
@doc("이메일·이름·비밀번호로 신규 사용자 계정을 만들고 토큰 페어를 반환합니다. 인증 불필요.")
@tag("auth")
@operationId("register")
@route("/auth/register")
@post
@extension("x-oa-sdk-operation-security", #[])
@extension("x-oa-sdk-operation-examples", #{
  requestBody: #{
    application_json: #{
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            email: "greg@example.com",
            name: "Greg",
            password: "secure1234"
          },
          serializedValue: "{\"email\":\"greg@example.com\",\"name\":\"Greg\",\"password\":\"secure1234\"}"
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
            user: #{
              id: "00000000-0000-0000-0000-000000000010",
              email: "greg@example.com",
              name: "Greg",
              role: "user",
              createdAt: "2026-05-04T00:00:00.000Z"
            },
            tokens: #{
              accessToken: "eyJhbGciOi...register",
              refreshToken: "rt_register_0001",
              tokenType: "Bearer",
              expiresIn: 3600
            }
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
      statusCode: "409",
      ref: "#/components/responses/Conflict"
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
op register(
  @body body: RegisterRequest,
): Register201Response | Register400Response | Register409Response | Register422Response | Register429Response;

@summary("비밀번호 재설정 (공개)")
@doc("forgot-password로 발급받은 reset 토큰과 새 비밀번호로 갱신.")
@tag("auth")
@operationId("resetPassword")
@route("/auth/reset-password")
@post
@extension("x-oa-sdk-operation-security", #[])
@extension("x-oa-sdk-operation-examples", #{
  requestBody: #{
    application_json: #{
      mediaType: "application/json",
      examples: #{
        default: #{
          dataValue: #{
            token: "rt_reset_0001",
            newPassword: "evenmoresecure5678"
          },
          serializedValue: "{\"token\":\"rt_reset_0001\",\"newPassword\":\"evenmoresecure5678\"}"
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
op resetPassword(
  @body body: ResetPasswordRequest,
): ResetPassword204Response | ResetPassword400Response | ResetPassword401Response | ResetPassword422Response;
