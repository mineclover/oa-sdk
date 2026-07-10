import type {
  DefinitionBuilderProjectConfig,
  SpecProjectConfig,
  TypeSpecBundleProjectConfig,
} from '../../domain/project.js'
import { SnapshotBuilder } from './snapshot-builder.js'
import { TypeSpecBundleSnapshotBuilder } from './typespec-bundle-snapshot-builder.js'

export type SnapshotBuilderSelection =
  | { status: 'ready'; projectKind: 'definition-builder'; builder: SnapshotBuilder }
  | { status: 'ready'; projectKind: 'typespec-bundle'; builder: TypeSpecBundleSnapshotBuilder }

export function selectSnapshotBuilder(
  project: DefinitionBuilderProjectConfig,
): Extract<SnapshotBuilderSelection, { projectKind: 'definition-builder' }>
export function selectSnapshotBuilder(
  project: TypeSpecBundleProjectConfig,
): Extract<SnapshotBuilderSelection, { projectKind: 'typespec-bundle' }>
export function selectSnapshotBuilder(project: SpecProjectConfig): SnapshotBuilderSelection
export function selectSnapshotBuilder(project: SpecProjectConfig): SnapshotBuilderSelection {
  if (project.kind === 'definition-builder') {
    return { status: 'ready', projectKind: project.kind, builder: new SnapshotBuilder() }
  }
  return {
    status: 'ready',
    projectKind: project.kind,
    builder: new TypeSpecBundleSnapshotBuilder(),
  }
}
