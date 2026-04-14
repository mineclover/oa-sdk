/** optional peer dep 동적 import — 미설치 시 에러 메시지 + exit */
export async function tryImport(pkg: string): Promise<Record<string, any>> {
  try {
    return await import(pkg)
  } catch {
    console.error(`오류: ${pkg} 패키지를 찾을 수 없습니다. 설치: pnpm add ${pkg}`)
    process.exit(1)
  }
}
