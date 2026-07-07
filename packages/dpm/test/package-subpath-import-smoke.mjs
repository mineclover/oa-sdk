const [
  packageModule,
  catalogModule,
  profileModule,
  relationshipModule,
  gatewayModule,
  storageModule,
  publishingModule,
] = await Promise.all([
  import('@oa-sdk/dpm/package'),
  import('@oa-sdk/dpm/catalog'),
  import('@oa-sdk/dpm/profile'),
  import('@oa-sdk/dpm/relationship'),
  import('@oa-sdk/dpm/gateway'),
  import('@oa-sdk/dpm/storage'),
  import('@oa-sdk/dpm/publishing'),
])

const checks = [
  ['package', packageModule.DPM_PACKAGE_NAME === '@oa-sdk/dpm'],
  ['catalog', typeof catalogModule.normalizeCatalogSnapshot === 'function'],
  ['profile', typeof profileModule.normalizeDpmProfileArtifact === 'function'
    && typeof profileModule.createDpmRelationshipCandidateInputFromProfileHint === 'function'],
  ['relationship', typeof relationshipModule.createLogicalRelationship === 'function'],
  ['gateway', typeof gatewayModule.createDpmGatewayRuntime === 'function'],
  ['storage', typeof storageModule.createDpmProfileBaselineRepository === 'function'],
  ['publishing', typeof publishingModule.createDpmPublishingContext === 'function'],
]

const failures = checks
  .filter(([, passed]) => !passed)
  .map(([subpath]) => subpath)

if (failures.length > 0) {
  throw new Error(`DPM subpath import smoke failed: ${failures.join(', ')}`)
}

console.log('DPM subpath imports OK')
