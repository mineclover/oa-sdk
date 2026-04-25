import type {
  BehaviorRegistryComponents,
  BehaviorRegistryValidationIssue,
} from './behavior-registry.js'
import {
  issue,
  readBoolean,
  readDecisionSignal,
  readNumber,
  readString,
  validateCrossStringField,
  validateSameStringField,
} from './behavior-validation-utils.js'

export function validateBuildOpenApiTargetComponents(
  components: BehaviorRegistryComponents,
): BehaviorRegistryValidationIssue[] {
  const signal = readDecisionSignal(components)
  const issues: BehaviorRegistryValidationIssue[] = []
  issues.push(
    ...validateSameStringField(components, 'targetPath'),
  )
  const targetName = readString(components.target, 'targetName')
  const targetKey = readString(components.target, 'targetKey')
  if (targetName !== undefined && targetKey !== undefined && targetName !== targetKey) {
    issues.push(issue(
      'components.target.targetKey',
      'build_openapi_target targetKey must match targetName when targetName is present',
    ))
  }

  if (signal === undefined) return issues

  if (signal === 'build-valid') {
    if (readBoolean(components.result, 'valid') !== true) {
      issues.push(issue(
        'components.result.valid',
        'build-valid decision requires result.valid to be true',
      ))
    }
    if (readNumber(components.result, 'errors') !== 0) {
      issues.push(issue(
        'components.result.errors',
        'build-valid decision requires result.errors to be 0',
      ))
    }
  } else if (signal === 'build-invalid') {
    if (readBoolean(components.result, 'valid') !== false) {
      issues.push(issue(
        'components.result.valid',
        'build-invalid decision requires result.valid to be false',
      ))
    }
  } else if (signal === 'build-exception' && readString(components.result, 'errorMessage') === undefined) {
    issues.push(issue(
      'components.result.errorMessage',
      'build-exception decision requires result.errorMessage',
    ))
  }

  return issues
}

export function validateSyncRuntimeOpenApiComponents(
  components: BehaviorRegistryComponents,
): BehaviorRegistryValidationIssue[] {
  const signal = readDecisionSignal(components)
  const issues: BehaviorRegistryValidationIssue[] = []
  issues.push(
    ...validateSameStringField(components, 'managedPath'),
    ...validateSameStringField(components, 'runtimePath'),
    ...validateCrossStringField(
      components,
      'input',
      'runtimeUrl',
      'target',
      'runtimeSource',
      'runtimeUrl must match runtimeSource when both are present',
    ),
  )
  const targetKey = readString(components.target, 'targetKey')
  const managedPath = readString(components.target, 'managedPath')
  const runtimePath = readString(components.target, 'runtimePath')
  const runtimeSource = readString(components.target, 'runtimeSource')
  const runtimeSuffix = runtimePath ?? runtimeSource
  if (targetKey !== undefined && managedPath !== undefined && runtimeSuffix !== undefined && targetKey !== `${managedPath}|${runtimeSuffix}`) {
    issues.push(issue(
      'components.target.targetKey',
      'sync_runtime_openapi targetKey must match managedPath|runtimePath-or-runtimeSource',
    ))
  }

  if (signal === undefined) return issues

  if (signal === 'no-drift') {
    if (readBoolean(components.result, 'drift') !== false) {
      issues.push(issue(
        'components.result.drift',
        'no-drift decision requires result.drift to be false',
      ))
    }
    if (readString(components.result, 'status') !== 'ok') {
      issues.push(issue(
        'components.result.status',
        'no-drift decision requires result.status to be ok',
      ))
    }
  } else if (signal === 'drift-detected') {
    if (readBoolean(components.result, 'drift') !== true) {
      issues.push(issue(
        'components.result.drift',
        'drift-detected decision requires result.drift to be true',
      ))
    }
    if (readString(components.result, 'status') !== 'ok') {
      issues.push(issue(
        'components.result.status',
        'drift-detected decision requires result.status to be ok',
      ))
    }
  } else if (signal === 'fetch-failure') {
    if (readString(components.result, 'status') !== 'drift-check-failed') {
      issues.push(issue(
        'components.result.status',
        'fetch-failure decision requires result.status to be drift-check-failed',
      ))
    }
    if (readString(components.result, 'failureCode') === undefined) {
      issues.push(issue(
        'components.result.failureCode',
        'fetch-failure decision requires result.failureCode',
      ))
    }
  } else if (signal === 'runtime-error' && readString(components.result, 'errorMessage') === undefined) {
    issues.push(issue(
      'components.result.errorMessage',
      'runtime-error decision requires result.errorMessage',
    ))
  }

  return issues
}
