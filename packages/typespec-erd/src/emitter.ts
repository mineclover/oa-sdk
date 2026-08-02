import { emitFile, type EmitContext } from '@typespec/compiler'
import { join } from 'node:path'
import { emitLogicalErdArtifact } from './extract.js'

export async function $onEmit(context: EmitContext): Promise<void> {
  const artifact = emitLogicalErdArtifact(context.program)
  if (!artifact) return
  await emitFile(context.program, {
    path: join(context.emitterOutputDir, 'logical-erd.json'),
    content: `${JSON.stringify(artifact, null, 2)}\n`,
  })
}
