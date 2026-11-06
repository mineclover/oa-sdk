export const PYTHON_KEYWORDS: ReadonlySet<string> = new Set([
  'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del',
  'elif', 'else', 'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal',
  'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield',
])

export function pythonIdentifier(name: string): string {
  const cleaned = name.replace(/[^\p{ID_Continue}]/gu, '_').replace(/^(?=\d)/, '_') || '_'
  return PYTHON_KEYWORDS.has(cleaned) ? `${cleaned}_` : cleaned
}

export function snakeCase(name: string): string {
  return name
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/([a-z\d])([A-Z])/g, '$1_$2')
    .replace(/[^\p{ID_Continue}]+/gu, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase() || '_'
}

export function pascalCase(name: string): string {
  const words = snakeCase(name).split('_').filter(Boolean)
  const result = words.map(word => word[0]?.toUpperCase() + word.slice(1)).join('')
  return pythonIdentifier(result || 'Anonymous').replace(/_+$/g, '') || 'Anonymous'
}

export const PYDANTIC_BASE_MODEL_ATTRIBUTES: ReadonlySet<string> = new Set([
  'model_config', 'model_fields', 'model_computed_fields', 'model_extra', 'model_fields_set',
  'model_construct', 'model_copy', 'model_dump', 'model_dump_json', 'model_json_schema',
  'model_parametrized_name', 'model_post_init', 'model_rebuild', 'model_validate',
  'model_validate_json', 'model_validate_strings', 'copy', 'dict', 'json', 'parse_obj', 'parse_raw',
  'parse_file', 'from_orm', 'construct', 'schema', 'schema_json', 'validate', 'update_forward_refs', 'fields',
])

