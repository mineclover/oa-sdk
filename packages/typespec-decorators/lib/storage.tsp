import "../dist/storage.js";

using TypeSpec.Reflection;

namespace OaSdkTypeSpec;

/**
 * Binds a Model or ModelProperty to an Atlas physical table or column identifier.
 * Used for read-only catalog evidence and drift verification without DDL mutation.
 * Emits internal x-oa-sdk-storage-ref.
 */
extern dec storageRef(target: Model | ModelProperty, tableOrColumn: valueof string);

/**
 * Declares the physical storage catalog origin for a namespace (e.g. "sqlite", "postgres", "d1").
 * Emits internal x-oa-sdk-storage-catalog.
 */
extern dec storageCatalog(target: Namespace, catalogName: valueof string);
