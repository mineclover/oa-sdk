// AUTO-GENERATED — do not edit by hand.
// Run `pnpm --filter @oa-sdk/personas gen:tests` to regenerate.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'

import { createNodeMockServer, type NodeMockServer } from '@oa-sdk/mock-server/adapters/node-http'
import { createTestClient, type TestClient } from '@oa-sdk/mock-server'
import { createPersonaMockClient, loadAllDomains, type MinimalOpenApiDoc, type PersonaMockClient } from '@oa-sdk/personas'

const SPEC_PATH = fileURLToPath(new URL("../../../packages/schemas/src/.merged.yaml", import.meta.url))

let server: NodeMockServer
let client: TestClient
let personas: PersonaMockClient

async function setup(): Promise<void> {
  const spec = parse(readFileSync(SPEC_PATH, 'utf8')) as MinimalOpenApiDoc
  const domains = loadAllDomains()
  server = createNodeMockServer(spec as Parameters<typeof createNodeMockServer>[0], { port: 0 })
  await server.start()
  client = createTestClient(server)
  personas = createPersonaMockClient({ spec, domains })
}

async function teardown(): Promise<void> {
  if (server) await server.stop()
}

describe("persona roleplay (generated)", () => {
  beforeAll(setup)
  afterAll(teardown)
  beforeEach(() => server.clearOverrides())

  // ── auth/backend-svc-token-refresh ──
  it("backend-svc-token-refresh → POST /auth/refresh → 200", async () => {
    personas.switchTo(server, "backend-svc-token-refresh")
    const res = await client.post("/auth/refresh", {"refreshToken":"rt_login_0001"}, { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(200)
  })

  // ── auth/duplicate-email-register ──
  it("duplicate-email-register → POST /auth/register → 409", async () => {
    personas.switchTo(server, "duplicate-email-register")
    const res = await client.post("/auth/register", {"email":"greg@example.com","name":"Greg","password":"secure1234"}, { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(409)
  })

  // ── auth/guest-login ──
  it("guest-login → POST /auth/login → 200", async () => {
    personas.switchTo(server, "guest-login")
    const res = await client.post("/auth/login", {"email":"alice@example.com","password":"secure1234"}, { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(200)
  })

  // ── auth/guest-password-reset-confirm ──
  it("guest-password-reset-confirm → POST /auth/reset-password → 204", async () => {
    personas.switchTo(server, "guest-password-reset-confirm")
    const res = await client.post("/auth/reset-password", {"token":"rt_reset_0001","newPassword":"evenmoresecure5678"}, { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(204)
  })

  // ── auth/guest-password-reset-request ──
  it("guest-password-reset-request → POST /auth/forgot-password → 204", async () => {
    personas.switchTo(server, "guest-password-reset-request")
    const res = await client.post("/auth/forgot-password", {"email":"alice@example.com"}, { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(204)
  })

  // ── auth/guest-signup ──
  it("guest-signup → POST /auth/register → 201", async () => {
    personas.switchTo(server, "guest-signup")
    const res = await client.post("/auth/register", {"email":"greg@example.com","name":"Greg","password":"secure1234"}, { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(201)
  })

  // ── auth/guest-unauthorized-logout ──
  it("guest-unauthorized-logout → POST /auth/logout → 401", async () => {
    personas.switchTo(server, "guest-unauthorized-logout")
    const res = await client.post("/auth/logout", undefined, { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(401)
  })

  // ── auth/guest-unauthorized-refreshToken ──
  it("guest-unauthorized-refreshToken → POST /auth/refresh → 401", async () => {
    personas.switchTo(server, "guest-unauthorized-refreshToken")
    const res = await client.post("/auth/refresh", {"refreshToken":"rt_login_0001"}, { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(401)
  })

  // ── auth/guest-unauthorized-resetPassword ──
  it("guest-unauthorized-resetPassword → POST /auth/reset-password → 401", async () => {
    personas.switchTo(server, "guest-unauthorized-resetPassword")
    const res = await client.post("/auth/reset-password", {"token":"rt_reset_0001","newPassword":"evenmoresecure5678"}, { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(401)
  })

  // ── auth/login-bad-credentials ──
  it("login-bad-credentials → POST /auth/login → 401", async () => {
    personas.switchTo(server, "login-bad-credentials")
    const res = await client.post("/auth/login", {"email":"alice@example.com","password":"secure1234"}, { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(401)
  })

  // ── auth/login-rate-limited ──
  it("login-rate-limited → POST /auth/login → 429", async () => {
    personas.switchTo(server, "login-rate-limited")
    const res = await client.post("/auth/login", {"email":"alice@example.com","password":"secure1234"}, { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(429)
  })

  // ── auth/malformed-forgotPassword ──
  it("malformed-forgotPassword → POST /auth/forgot-password → 400", async () => {
    personas.switchTo(server, "malformed-forgotPassword")
    const res = await client.post("/auth/forgot-password", {"email":"alice@example.com"}, { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(400)
  })

  // ── auth/malformed-login ──
  it("malformed-login → POST /auth/login → 400", async () => {
    personas.switchTo(server, "malformed-login")
    const res = await client.post("/auth/login", {"email":"alice@example.com","password":"secure1234"}, { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(400)
  })

  // ── auth/malformed-payload-forgotPassword ──
  it("malformed-payload-forgotPassword → POST /auth/forgot-password → 422", async () => {
    personas.switchTo(server, "malformed-payload-forgotPassword")
    const res = await client.post("/auth/forgot-password", {"email":"alice@example.com"}, { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(422)
  })

  // ── auth/malformed-payload-login ──
  it("malformed-payload-login → POST /auth/login → 422", async () => {
    personas.switchTo(server, "malformed-payload-login")
    const res = await client.post("/auth/login", {"email":"alice@example.com","password":"secure1234"}, { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(422)
  })

  // ── auth/malformed-payload-refreshToken ──
  it("malformed-payload-refreshToken → POST /auth/refresh → 422", async () => {
    personas.switchTo(server, "malformed-payload-refreshToken")
    const res = await client.post("/auth/refresh", {"refreshToken":"rt_login_0001"}, { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(422)
  })

  // ── auth/malformed-payload-resetPassword ──
  it("malformed-payload-resetPassword → POST /auth/reset-password → 422", async () => {
    personas.switchTo(server, "malformed-payload-resetPassword")
    const res = await client.post("/auth/reset-password", {"token":"rt_reset_0001","newPassword":"evenmoresecure5678"}, { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(422)
  })

  // ── auth/malformed-register ──
  it("malformed-register → POST /auth/register → 400", async () => {
    personas.switchTo(server, "malformed-register")
    const res = await client.post("/auth/register", {"email":"greg@example.com","name":"Greg","password":"secure1234"}, { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(400)
  })

  // ── auth/malformed-register-body ──
  it("malformed-register-body → POST /auth/register → 422", async () => {
    personas.switchTo(server, "malformed-register-body")
    const res = await client.post("/auth/register", {"email":"greg@example.com","name":"Greg","password":"secure1234"}, { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(422)
  })

  // ── auth/malformed-resetPassword ──
  it("malformed-resetPassword → POST /auth/reset-password → 400", async () => {
    personas.switchTo(server, "malformed-resetPassword")
    const res = await client.post("/auth/reset-password", {"token":"rt_reset_0001","newPassword":"evenmoresecure5678"}, { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(400)
  })

  // ── auth/rate-limited-forgotPassword ──
  it("rate-limited-forgotPassword → POST /auth/forgot-password → 429", async () => {
    personas.switchTo(server, "rate-limited-forgotPassword")
    const res = await client.post("/auth/forgot-password", {"email":"alice@example.com"}, { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(429)
  })

  // ── auth/register-rate-limited ──
  it("register-rate-limited → POST /auth/register → 429", async () => {
    personas.switchTo(server, "register-rate-limited")
    const res = await client.post("/auth/register", {"email":"greg@example.com","name":"Greg","password":"secure1234"}, { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(429)
  })

  // ── auth/user-logout ──
  it("user-logout → POST /auth/logout → 204", async () => {
    personas.switchTo(server, "user-logout")
    const res = await client.post("/auth/logout", undefined, { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(204)
  })

  // ── auth/user-token-refresh ──
  it("user-token-refresh → POST /auth/refresh → 200", async () => {
    personas.switchTo(server, "user-token-refresh")
    const res = await client.post("/auth/refresh", {"refreshToken":"rt_login_0001"}, { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(200)
  })

  // ── health/dependency-down-getHealth ──
  it("dependency-down-getHealth → GET /health → 503", async () => {
    personas.switchTo(server, "dependency-down-getHealth")
    const res = await client.get("/health", { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(503)
  })

  // ── health/dependency-down-getReadiness ──
  it("dependency-down-getReadiness → GET /health/ready → 503", async () => {
    personas.switchTo(server, "dependency-down-getReadiness")
    const res = await client.get("/health/ready", { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(503)
  })

  // ── health/dependency-down-streamHealthEvents ──
  it("dependency-down-streamHealthEvents → GET /health/stream → 503", async () => {
    personas.switchTo(server, "dependency-down-streamHealthEvents")
    const res = await client.get("/health/stream", { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(503)
  })

  // ── health/ops-event-stream ──
  it("ops-event-stream → GET /health/stream → 200", async () => {
    personas.switchTo(server, "ops-event-stream")
    const res = await client.get("/health/stream", { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(200)
  })

  // ── health/ops-liveness-check ──
  it("ops-liveness-check → GET /health → 200", async () => {
    personas.switchTo(server, "ops-liveness-check")
    const res = await client.get("/health", { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(200)
  })

  // ── health/ops-readiness-check ──
  it("ops-readiness-check → GET /health/ready → 200", async () => {
    personas.switchTo(server, "ops-readiness-check")
    const res = await client.get("/health/ready", { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(200)
  })

  // ── health/ops-version-info ──
  it("ops-version-info → GET /version → 200", async () => {
    personas.switchTo(server, "ops-version-info")
    const res = await client.get("/version", { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(200)
  })

  // ── me/guest-unauthorized-changePassword ──
  it("guest-unauthorized-changePassword → POST /me/change-password → 401", async () => {
    personas.switchTo(server, "guest-unauthorized-changePassword")
    const res = await client.post("/me/change-password", {"currentPassword":"secure1234","newPassword":"evenmoresecure5678"}, { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(401)
  })

  // ── me/guest-unauthorized-deleteMyAccount ──
  it("guest-unauthorized-deleteMyAccount → DELETE /me → 401", async () => {
    personas.switchTo(server, "guest-unauthorized-deleteMyAccount")
    const res = await client.delete("/me", { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(401)
  })

  // ── me/guest-unauthorized-getMe ──
  it("guest-unauthorized-getMe → GET /me → 401", async () => {
    personas.switchTo(server, "guest-unauthorized-getMe")
    const res = await client.get("/me", { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(401)
  })

  // ── me/guest-unauthorized-getOnboardingChecklist ──
  it("guest-unauthorized-getOnboardingChecklist → GET /me/onboarding → 401", async () => {
    personas.switchTo(server, "guest-unauthorized-getOnboardingChecklist")
    const res = await client.get("/me/onboarding", { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(401)
  })

  // ── me/guest-unauthorized-requestMyDataExport ──
  it("guest-unauthorized-requestMyDataExport → POST /me/export → 401", async () => {
    personas.switchTo(server, "guest-unauthorized-requestMyDataExport")
    const res = await client.post("/me/export", {"format":"json"}, { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(401)
  })

  // ── me/guest-unauthorized-updateMe ──
  it("guest-unauthorized-updateMe → PATCH /me → 401", async () => {
    personas.switchTo(server, "guest-unauthorized-updateMe")
    const res = await client.patch("/me", {"name":"Alice (self-edit)"}, { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(401)
  })

  // ── me/malformed-changeMyPassword ──
  it("malformed-changeMyPassword → POST /me/change-password → 400", async () => {
    personas.switchTo(server, "malformed-changeMyPassword")
    const res = await client.post("/me/change-password", {"currentPassword":"secure1234","newPassword":"evenmoresecure5678"}, { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(400)
  })

  // ── me/malformed-payload-changeMyPassword ──
  it("malformed-payload-changeMyPassword → POST /me/change-password → 422", async () => {
    personas.switchTo(server, "malformed-payload-changeMyPassword")
    const res = await client.post("/me/change-password", {"currentPassword":"secure1234","newPassword":"evenmoresecure5678"}, { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(422)
  })

  // ── me/malformed-payload-updateMe ──
  it("malformed-payload-updateMe → PATCH /me → 422", async () => {
    personas.switchTo(server, "malformed-payload-updateMe")
    const res = await client.patch("/me", {"name":"Alice (self-edit)"}, { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(422)
  })

  // ── me/malformed-updateMe ──
  it("malformed-updateMe → PATCH /me → 400", async () => {
    personas.switchTo(server, "malformed-updateMe")
    const res = await client.patch("/me", {"name":"Alice (self-edit)"}, { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(400)
  })

  // ── me/onboarding-checklist ──
  it("onboarding-checklist → GET /me/onboarding → 200", async () => {
    personas.switchTo(server, "onboarding-checklist")
    const res = await client.get("/me/onboarding", { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(200)
  })

  // ── me/rate-limited-requestMyDataExport ──
  it("rate-limited-requestMyDataExport → POST /me/export → 429", async () => {
    personas.switchTo(server, "rate-limited-requestMyDataExport")
    const res = await client.post("/me/export", {"format":"json"}, { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(429)
  })

  // ── me/user-self-change-password ──
  it("user-self-change-password → POST /me/change-password → 204", async () => {
    personas.switchTo(server, "user-self-change-password")
    const res = await client.post("/me/change-password", {"currentPassword":"secure1234","newPassword":"evenmoresecure5678"}, { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(204)
  })

  // ── me/user-self-data-export ──
  it("user-self-data-export → POST /me/export → 202", async () => {
    personas.switchTo(server, "user-self-data-export")
    const res = await client.post("/me/export", {"format":"json"}, { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(202)
  })

  // ── me/user-self-delete-account ──
  it("user-self-delete-account → DELETE /me → 204", async () => {
    personas.switchTo(server, "user-self-delete-account")
    const res = await client.delete("/me", { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(204)
  })

  // ── me/user-self-read ──
  it("user-self-read → GET /me → 200", async () => {
    personas.switchTo(server, "user-self-read")
    const res = await client.get("/me", { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(200)
  })

  // ── me/user-self-update ──
  it("user-self-update → PATCH /me → 200", async () => {
    personas.switchTo(server, "user-self-update")
    const res = await client.patch("/me", {"name":"Alice (self-edit)"}, { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(200)
  })

  // ── users/admin-create-user ──
  it("admin-create-user → POST /users → 201", async () => {
    personas.switchTo(server, "admin-create-user")
    const res = await client.post("/users", {"email":"bob@example.com","name":"Bob","password":"secure1234"}, { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(201)
  })

  // ── users/admin-monitor ──
  it("admin-monitor → GET /users → 200", async () => {
    personas.switchTo(server, "admin-monitor")
    const res = await client.get("/users", { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(200)
  })

  // ── users/admin-role-grant ──
  it("admin-role-grant → PATCH /users/00000000-0000-0000-0000-000000000001 → 200", async () => {
    personas.switchTo(server, "admin-role-grant")
    const res = await client.patch("/users/00000000-0000-0000-0000-000000000001", {"name":"Alice Updated"}, { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(200)
  })

  // ── users/admin-user-detail ──
  it("admin-user-detail → GET /users/00000000-0000-0000-0000-000000000001 → 200", async () => {
    personas.switchTo(server, "admin-user-detail")
    const res = await client.get("/users/00000000-0000-0000-0000-000000000001", { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(200)
  })

  // ── users/admin-user-removal ──
  it("admin-user-removal → DELETE /users/00000000-0000-0000-0000-000000000001 → 204", async () => {
    personas.switchTo(server, "admin-user-removal")
    const res = await client.delete("/users/00000000-0000-0000-0000-000000000001", { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(204)
  })

  // ── users/b2b-customer-list-users ──
  it("b2b-customer-list-users → GET /users → 200", async () => {
    personas.switchTo(server, "b2b-customer-list-users")
    const res = await client.get("/users", { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(200)
  })

  // ── users/backend-svc-list-users ──
  it("backend-svc-list-users → GET /users → 200", async () => {
    personas.switchTo(server, "backend-svc-list-users")
    const res = await client.get("/users", { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(200)
  })

  // ── users/cs-agent-lookup-user ──
  it("cs-agent-lookup-user → GET /users/00000000-0000-0000-0000-000000000001 → 200", async () => {
    personas.switchTo(server, "cs-agent-lookup-user")
    const res = await client.get("/users/00000000-0000-0000-0000-000000000001", { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(200)
  })

  // ── users/data-eng-bulk-export-users ──
  it("data-eng-bulk-export-users → POST /admin/users/export → 202", async () => {
    personas.switchTo(server, "data-eng-bulk-export-users")
    const res = await client.post("/admin/users/export", {"format":"json","pseudonymize":true}, { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(202)
  })

  // ── users/getUserById-not-found ──
  it("getUserById-not-found → GET /users/00000000-0000-0000-0000-000000000001 → 404", async () => {
    personas.switchTo(server, "getUserById-not-found")
    const res = await client.get("/users/00000000-0000-0000-0000-000000000001", { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(404)
  })

  // ── users/guest-unauthorized-createUser ──
  it("guest-unauthorized-createUser → POST /users → 401", async () => {
    personas.switchTo(server, "guest-unauthorized-createUser")
    const res = await client.post("/users", {"email":"bob@example.com","name":"Bob","password":"secure1234"}, { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(401)
  })

  // ── users/guest-unauthorized-deleteUser ──
  it("guest-unauthorized-deleteUser → DELETE /users/00000000-0000-0000-0000-000000000001 → 401", async () => {
    personas.switchTo(server, "guest-unauthorized-deleteUser")
    const res = await client.delete("/users/00000000-0000-0000-0000-000000000001", { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(401)
  })

  // ── users/guest-unauthorized-getPublicUserProfile ──
  it("guest-unauthorized-getPublicUserProfile → GET /users/00000000-0000-0000-0000-000000000001/public → 401", async () => {
    personas.switchTo(server, "guest-unauthorized-getPublicUserProfile")
    const res = await client.get("/users/00000000-0000-0000-0000-000000000001/public", { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(401)
  })

  // ── users/guest-unauthorized-getUserById ──
  it("guest-unauthorized-getUserById → GET /users/00000000-0000-0000-0000-000000000001 → 401", async () => {
    personas.switchTo(server, "guest-unauthorized-getUserById")
    const res = await client.get("/users/00000000-0000-0000-0000-000000000001", { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(401)
  })

  // ── users/guest-unauthorized-list ──
  it("guest-unauthorized-list → GET /users → 401", async () => {
    personas.switchTo(server, "guest-unauthorized-list")
    const res = await client.get("/users", { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(401)
  })

  // ── users/guest-unauthorized-listModerationReports ──
  it("guest-unauthorized-listModerationReports → GET /moderation/reports → 401", async () => {
    personas.switchTo(server, "guest-unauthorized-listModerationReports")
    const res = await client.get("/moderation/reports", { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(401)
  })

  // ── users/guest-unauthorized-listMyRoleChanges ──
  it("guest-unauthorized-listMyRoleChanges → GET /me/role-changes → 401", async () => {
    personas.switchTo(server, "guest-unauthorized-listMyRoleChanges")
    const res = await client.get("/me/role-changes", { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(401)
  })

  // ── users/guest-unauthorized-reportUser ──
  it("guest-unauthorized-reportUser → POST /users/00000000-0000-0000-0000-000000000001/reports → 401", async () => {
    personas.switchTo(server, "guest-unauthorized-reportUser")
    const res = await client.post("/users/00000000-0000-0000-0000-000000000001/reports", {"reason":"harassment","details":"공격적 메시지 반복 발신"}, { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(401)
  })

  // ── users/guest-unauthorized-updateUser ──
  it("guest-unauthorized-updateUser → PATCH /users/00000000-0000-0000-0000-000000000001 → 401", async () => {
    personas.switchTo(server, "guest-unauthorized-updateUser")
    const res = await client.patch("/users/00000000-0000-0000-0000-000000000001", {"name":"Alice Updated"}, { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(401)
  })

  // ── users/insufficient-scope-listModerationReports ──
  it("insufficient-scope-listModerationReports → GET /moderation/reports → 403", async () => {
    personas.switchTo(server, "insufficient-scope-listModerationReports")
    const res = await client.get("/moderation/reports", { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(403)
  })

  // ── users/malformed-createUser ──
  it("malformed-createUser → POST /users → 400", async () => {
    personas.switchTo(server, "malformed-createUser")
    const res = await client.post("/users", {"email":"bob@example.com","name":"Bob","password":"secure1234"}, { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(400)
  })

  // ── users/malformed-payload-createUser ──
  it("malformed-payload-createUser → POST /users → 422", async () => {
    personas.switchTo(server, "malformed-payload-createUser")
    const res = await client.post("/users", {"email":"bob@example.com","name":"Bob","password":"secure1234"}, { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(422)
  })

  // ── users/malformed-payload-reportUser ──
  it("malformed-payload-reportUser → POST /users/00000000-0000-0000-0000-000000000001/reports → 422", async () => {
    personas.switchTo(server, "malformed-payload-reportUser")
    const res = await client.post("/users/00000000-0000-0000-0000-000000000001/reports", {"reason":"harassment","details":"공격적 메시지 반복 발신"}, { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(422)
  })

  // ── users/malformed-payload-updateUser ──
  it("malformed-payload-updateUser → PATCH /users/00000000-0000-0000-0000-000000000001 → 422", async () => {
    personas.switchTo(server, "malformed-payload-updateUser")
    const res = await client.patch("/users/00000000-0000-0000-0000-000000000001", {"name":"Alice Updated"}, { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(422)
  })

  // ── users/malformed-reportUser ──
  it("malformed-reportUser → POST /users/00000000-0000-0000-0000-000000000001/reports → 400", async () => {
    personas.switchTo(server, "malformed-reportUser")
    const res = await client.post("/users/00000000-0000-0000-0000-000000000001/reports", {"reason":"harassment","details":"공격적 메시지 반복 발신"}, { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(400)
  })

  // ── users/malformed-updateUser ──
  it("malformed-updateUser → PATCH /users/00000000-0000-0000-0000-000000000001 → 400", async () => {
    personas.switchTo(server, "malformed-updateUser")
    const res = await client.patch("/users/00000000-0000-0000-0000-000000000001", {"name":"Alice Updated"}, { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(400)
  })

  // ── users/moderator-review-reports ──
  it("moderator-review-reports → GET /moderation/reports → 200", async () => {
    personas.switchTo(server, "moderator-review-reports")
    const res = await client.get("/moderation/reports", { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(200)
  })

  // ── users/non-admin-update-other-user ──
  it("non-admin-update-other-user → PATCH /users/00000000-0000-0000-0000-000000000001 → 403", async () => {
    personas.switchTo(server, "non-admin-update-other-user")
    const res = await client.patch("/users/00000000-0000-0000-0000-000000000001", {"name":"Alice Updated"}, { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(403)
  })

  // ── users/not-found-deleteUser ──
  it("not-found-deleteUser → DELETE /users/00000000-0000-0000-0000-000000000001 → 404", async () => {
    personas.switchTo(server, "not-found-deleteUser")
    const res = await client.delete("/users/00000000-0000-0000-0000-000000000001", { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(404)
  })

  // ── users/not-found-getPublicUserProfile ──
  it("not-found-getPublicUserProfile → GET /users/00000000-0000-0000-0000-000000000001/public → 404", async () => {
    personas.switchTo(server, "not-found-getPublicUserProfile")
    const res = await client.get("/users/00000000-0000-0000-0000-000000000001/public", { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(404)
  })

  // ── users/rate-limited-reportUser ──
  it("rate-limited-reportUser → POST /users/00000000-0000-0000-0000-000000000001/reports → 429", async () => {
    personas.switchTo(server, "rate-limited-reportUser")
    const res = await client.post("/users/00000000-0000-0000-0000-000000000001/reports", {"reason":"harassment","details":"공격적 메시지 반복 발신"}, { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(429)
  })

  // ── users/site-admin-purge-user ──
  it("site-admin-purge-user → POST /admin/users/00000000-0000-0000-0000-000000000001/purge → 204", async () => {
    personas.switchTo(server, "site-admin-purge-user")
    const res = await client.post("/admin/users/00000000-0000-0000-0000-000000000001/purge", {"reason":"confirmed policy violation","legalHoldOverride":false}, { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(204)
  })

  // ── users/target-of-role-change ──
  it("target-of-role-change → GET /me/role-changes → 200", async () => {
    personas.switchTo(server, "target-of-role-change")
    const res = await client.get("/me/role-changes", { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(200)
  })

  // ── users/updateUser-not-found ──
  it("updateUser-not-found → PATCH /users/00000000-0000-0000-0000-000000000001 → 404", async () => {
    personas.switchTo(server, "updateUser-not-found")
    const res = await client.patch("/users/00000000-0000-0000-0000-000000000001", {"name":"Alice Updated"}, { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(404)
  })

  // ── users/user-public-profile-view ──
  it("user-public-profile-view → GET /users/00000000-0000-0000-0000-000000000001/public → 200", async () => {
    personas.switchTo(server, "user-public-profile-view")
    const res = await client.get("/users/00000000-0000-0000-0000-000000000001/public", { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(200)
  })

  // ── users/user-report-abuse ──
  it("user-report-abuse → POST /users/00000000-0000-0000-0000-000000000001/reports → 201", async () => {
    personas.switchTo(server, "user-report-abuse")
    const res = await client.post("/users/00000000-0000-0000-0000-000000000001/reports", {"reason":"harassment","details":"공격적 메시지 반복 발신"}, { headers: { authorization: 'Bearer t' } })
    expect(res.status).toBe(201)
  })

})
