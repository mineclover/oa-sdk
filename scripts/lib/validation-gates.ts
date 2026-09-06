/**
 * Repository documentation gates.
 *
 * Authoritative implementation shared with and powered by
 * @spec-platform/document-gates and @spec-platform/document-parser
 * from spec-management-platform.
 */

import {
  createAgentConfigGate as sharedCreateAgentConfigGate,
  createCliExampleGate as sharedCreateCliExampleGate,
  createCliReferenceGate as sharedCreateCliReferenceGate,
  createMarkdownLocalLinkGate as sharedCreateMarkdownLocalLinkGate,
  createPackageEntrypointGate as sharedCreatePackageEntrypointGate,
  listMarkdownFiles as sharedListMarkdownFiles,
  runValidationGates as sharedRunValidationGates,
  type AgentConfigGateIssue as SharedAgentConfigGateIssue,
  type AgentConfigGateOptions as SharedAgentConfigGateOptions,
  type CliExampleGateOptions as SharedCliExampleGateOptions,
  type CliReferenceGateOptions as SharedCliReferenceGateOptions,
  type DocumentedCliCommand as SharedDocumentedCliCommand,
  type MarkdownLocalLinkGateOptions as SharedMarkdownLocalLinkGateOptions,
  type PackageEntrypointGateOptions as SharedPackageEntrypointGateOptions,
  type ValidationGate as SharedValidationGate,
  type ValidationGateIssue as SharedValidationGateIssue,
} from '../../../spec-management-platform/packages/document-gates/src/index.js'

export type ValidationGateIssue = SharedValidationGateIssue
export type ValidationGate = SharedValidationGate
export type DocumentedCliCommand = SharedDocumentedCliCommand
export type MarkdownLinkGateOptions = SharedMarkdownLocalLinkGateOptions
export type CliExampleGateOptions = SharedCliExampleGateOptions
export type CliReferenceGateOptions = SharedCliReferenceGateOptions
export type PackageEntrypointGateOptions = SharedPackageEntrypointGateOptions
export type AgentConfigGateIssue = SharedAgentConfigGateIssue
export type AgentConfigGateOptions = SharedAgentConfigGateOptions

export const runValidationGates = sharedRunValidationGates
export const listMarkdownFiles = sharedListMarkdownFiles
export const createMarkdownLocalLinkGate = sharedCreateMarkdownLocalLinkGate
export const createCliExampleGate = sharedCreateCliExampleGate
export const createCliReferenceGate = sharedCreateCliReferenceGate
export const createAgentConfigGate = sharedCreateAgentConfigGate

export function createPackageEntrypointGate(options: PackageEntrypointGateOptions): ValidationGate {
  return sharedCreatePackageEntrypointGate({
    ...options,
    pattern: /^\|\s*`(@oa-sdk\/[a-z0-9-]+)`\s*\|/gm,
  })
}

