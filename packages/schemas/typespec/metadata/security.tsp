import "@typespec/openapi";

using OpenAPI;

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
          #{ name: "read", description: "읽기 권한" },
          #{ name: "write", description: "쓰기 권한" },
          #{ name: "admin", description: "관리자 권한" }
        ]
      },
      deviceAuthorization: #{
        deviceAuthorizationUrl: "https://auth.example.com/device/code",
        tokenUrl: "https://auth.example.com/token",
        oauth2MetadataUrl: "https://auth.example.com/.well-known/oauth-authorization-server",
        scopes: #[
          #{ name: "read", description: "읽기 권한" },
          #{ name: "write", description: "쓰기 권한" }
        ]
      }
    }
  }
})
namespace OaSdkApi;
