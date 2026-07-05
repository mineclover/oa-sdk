export type DpmCatalogCoordinate = {
  table?: string
  column?: string
  columns?: string[]
}

export type DpmRegistryCoordinate = {
  datasetId?: string
  registryVersion?: string
  relationshipName?: string
  relationshipVersion?: string
  status?: string
}
