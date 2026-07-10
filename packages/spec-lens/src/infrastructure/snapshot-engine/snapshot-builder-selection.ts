import type { SpecProjectConfig } from '../../domain/project.js'
import type { SnapshotBuilderPort } from '../../application/ports/snapshot-builder.port.js'
import { SnapshotBuilder } from './snapshot-builder.js'

export type SnapshotBuilderSelection =
  | {
      status: 'ready'
      builder: SnapshotBuilderPort
    }
  | {
      status: 'pending'
      projectKind: 'typespec-bundle'
      adapterName: 'TypeSpecBundleSnapshotBuilder'
      message: string
    }

export function selectSnapshotBuilder(project: SpecProjectConfig): SnapshotBuilderSelection {
  if (project.kind === 'definition-builder') {
    return { status: 'ready', builder: new SnapshotBuilder() }
  }
  return {
    status: 'pending',
    projectKind: 'typespec-bundle',
    adapterName: 'TypeSpecBundleSnapshotBuilder',
    message: 'TypeSpec bundle candidate tracking is enabled, but TypeSpecBundleSnapshotBuilder is the next implementation milestone.',
  }
}
