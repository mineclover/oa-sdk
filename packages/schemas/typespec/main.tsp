import "@typespec/http";
import "@typespec/openapi";
import "./version.tsp";
import "./common.tsp";
import "./auth.tsp";
import "./health.tsp";
import "./me.tsp";
import "./users.tsp";

using Http;
using OpenAPI;

// Bundle entrypoint: root service/component metadata stays here; domain definitions live in imports above.
// Scaffolded by oa-gen tsp-export and promoted to the production TypeSpec source.
// Keep schema:typespec-check green before changing generated OpenAPI artifacts.
@extension("x-oa-sdk-components", #{
  parameters: #[
    #{
      name: "Limit",
      value: #{
        name: "limit",
        in: "query",
        description: "페이지당 항목 수",
        schema: #{
          type: "integer",
          minimum: 1,
          maximum: 100,
          default: 20
        },
        examples: #{
          default: #{
            dataValue: 20,
            serializedValue: "limit=20"
          }
        }
      }
    },
    #{
      name: "Page",
      value: #{
        name: "page",
        in: "query",
        description: "페이지 번호 (1-based)",
        schema: #{
          type: "integer",
          minimum: 1,
          default: 1
        },
        examples: #{
          default: #{
            dataValue: 1,
            serializedValue: "page=1"
          }
        }
      }
    }
  ],
  responses: #[
    #{
      name: "BadRequest",
      value: #{
        description: "잘못된 요청 — 요청 형식 또는 파라미터 오류",
        content: #[
          #{
            mediaType: "application/json",
            value: #{
              schema: #{
                ref: "#/components/schemas/Error"
              },
              examples: #{
                default: #{
                  dataValue: #{
                    code: "BAD_REQUEST",
                    message: "요청 형식이 올바르지 않습니다"
                  },
                  serializedValue: "{\"code\":\"BAD_REQUEST\",\"message\":\"요청 형식이 올바르지 않습니다\"}"
                }
              }
            }
          }
        ]
      }
    },
    #{
      name: "Conflict",
      value: #{
        description: "리소스 충돌 — 중복 식별자 또는 동시성 충돌",
        content: #[
          #{
            mediaType: "application/json",
            value: #{
              schema: #{
                ref: "#/components/schemas/Error"
              },
              examples: #{
                default: #{
                  dataValue: #{
                    code: "CONFLICT",
                    message: "이미 존재하는 리소스입니다"
                  },
                  serializedValue: "{\"code\":\"CONFLICT\",\"message\":\"이미 존재하는 리소스입니다\"}"
                }
              }
            }
          }
        ]
      }
    },
    #{
      name: "Forbidden",
      value: #{
        description: "권한 없음 — 접근 거부",
        content: #[
          #{
            mediaType: "application/json",
            value: #{
              schema: #{
                ref: "#/components/schemas/Error"
              },
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
        ]
      }
    },
    #{
      name: "InternalServerError",
      value: #{
        description: "서버 내부 오류",
        content: #[
          #{
            mediaType: "application/json",
            value: #{
              schema: #{
                ref: "#/components/schemas/Error"
              },
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
        ]
      }
    },
    #{
      name: "NotFound",
      value: #{
        description: "리소스를 찾을 수 없음",
        content: #[
          #{
            mediaType: "application/json",
            value: #{
              schema: #{
                ref: "#/components/schemas/Error"
              },
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
        ]
      }
    },
    #{
      name: "ServiceUnavailable",
      value: #{
        description: "서비스 사용 불가",
        content: #[
          #{
            mediaType: "application/json",
            value: #{
              schema: #{
                ref: "#/components/schemas/Error"
              },
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
        ]
      }
    },
    #{
      name: "TooManyRequests",
      value: #{
        description: "요청 제한 초과 — Retry-After 헤더로 재시도 가능 시점 안내",
        headers: #[
          #{
            name: "Retry-After",
            value: #{
              description: "재시도 가능 시점 (초 단위 정수 또는 HTTP-date)",
              required: true,
              schema: #{
                type: "string",
                example: "30"
              }
            }
          }
        ],
        content: #[
          #{
            mediaType: "application/json",
            value: #{
              schema: #{
                ref: "#/components/schemas/Error"
              },
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
        ]
      }
    },
    #{
      name: "Unauthorized",
      value: #{
        description: "인증 실패 — 토큰 없음 또는 만료",
        content: #[
          #{
            mediaType: "application/json",
            value: #{
              schema: #{
                ref: "#/components/schemas/Error"
              },
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
        ]
      }
    },
    #{
      name: "UnprocessableEntity",
      value: #{
        description: "스키마 유효성 검사 실패",
        content: #[
          #{
            mediaType: "application/json",
            value: #{
              schema: #{
                ref: "#/components/schemas/Error"
              },
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
        ]
      }
    }
  ]
})
@extension("x-oa-sdk-info", #{
  title: "OA SDK API",
  description: "OpenAPI 3.2 기반 API 관리 인프라",
  version: ContractVersion,
  license: #{
    name: "MIT",
    identifier: "MIT"
  }
})
@extension("x-oa-sdk-security-schemes", #{
  bearerAuth: #{
    type: "http",
    scheme: "bearer",
    bearerFormat: "JWT",
    description: "JWT Bearer 토큰 인증"
  },
  oauth2: #{
    type: "oauth2",
    description: "OAuth 2.0 인증 (Authorization Code + Device Authorization 지원)",
    flows: #{
      authorizationCode: #{
        authorizationUrl: "https://auth.example.com/authorize",
        tokenUrl: "https://auth.example.com/token",
        refreshUrl: "https://auth.example.com/token",
        oauth2MetadataUrl: "https://auth.example.com/.well-known/oauth-authorization-server",
        scopes: #[
          #{
            name: "read",
            description: "읽기 권한"
          },
          #{
            name: "write",
            description: "쓰기 권한"
          },
          #{
            name: "admin",
            description: "관리자 권한"
          }
        ]
      },
      deviceAuthorization: #{
        deviceAuthorizationUrl: "https://auth.example.com/device/code",
        tokenUrl: "https://auth.example.com/token",
        oauth2MetadataUrl: "https://auth.example.com/.well-known/oauth-authorization-server",
        scopes: #[
          #{
            name: "read",
            description: "읽기 권한"
          },
          #{
            name: "write",
            description: "쓰기 권한"
          }
        ]
      }
    }
  }
})
@server("http://localhost:3000", "Local dev server")
@server("http://localhost:4010", "Mock server (@oa-sdk/mock-server)")
@service(#{ title: "OA SDK API" })
@info(#{ version: ContractVersion })
@tagMetadata("health", #{ description: "서버 상태 확인" })
@tagMetadata("users", #{ description: "사용자 관리" })
@tagMetadata("auth", #{ description: "인증 — 토큰 발급/갱신/폐기" })
@tagMetadata("me", #{ description: "셀프 서비스 — 현재 인증된 사용자 자기 자원" })
namespace OaSdkApi;
