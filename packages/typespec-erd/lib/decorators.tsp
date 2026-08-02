import "../dist/decorators.js";

using TypeSpec.Reflection;

namespace OaSdkErd;

/** Declares the stable logical dataset scope for a namespace. */
extern dec dataset(target: Namespace, id: valueof string);

/** Declares a rename-safe logical entity id for a model. */
extern dec entity(target: Model, id: valueof string);

/** Declares a rename-safe logical field id for a model property. */
extern dec field(target: ModelProperty, id: valueof string);

/** Marks a logical field as a primary-key field. A group and order record a composite key part. */
extern dec primaryKey(target: ModelProperty, groupId?: valueof string, order?: valueof int32);

/** Marks a logical field as unique within its entity. */
extern dec unique(target: ModelProperty);

/** Records a logical foreign-key candidate. It never creates a physical DB FK. */
extern dec foreignKey(target: ModelProperty, targetField: ModelProperty);

/** Declares an explicit logical relationship between two declared fields. */
extern dec relationship(
  target: Namespace,
  id: valueof string,
  from: ModelProperty,
  to: ModelProperty,
  cardinality: valueof string,
);
