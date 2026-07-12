/** optional peer dep 동적 import — 미설치 시 호출자에게 오류 전달 */
export async function tryImport(pkg: string): Promise<Record<string, any>> {
  try {
    return await import(pkg)
  } catch {
    throw new Error(`${pkg} 패키지를 찾을 수 없습니다. 설치: pnpm add ${pkg}`)
  }
}
