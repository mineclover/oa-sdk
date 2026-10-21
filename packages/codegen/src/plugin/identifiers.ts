/**
 * Identifier rules shared by the plugin code emitters (pluginClient, the pluginTanstackQuery adapter).
 *
 * @oa-sdk/codegen
 */

import { quoteTypeScriptString } from '@oa-sdk/core'

/**
 * The ECMAScript reserved words, the strict-mode reserved words and `await` (reserved in modules).
 * None of them can name a binding in an ES module, and as an unquoted interface member `new(...)`
 * is a construct signature rather than a method.
 */
export const RESERVED_WORDS: ReadonlySet<string> = new Set([
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do',
  'else', 'enum', 'export', 'extends', 'false', 'finally', 'for', 'function', 'if', 'import', 'in',
  'instanceof', 'new', 'null', 'return', 'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof',
  'var', 'void', 'while', 'with',
  'implements', 'interface', 'let', 'package', 'private', 'protected', 'public', 'static', 'yield',
  'await',
])

/**
 * Words that cannot name a binding in a generated ES module (which is strict mode code):
 * {@link RESERVED_WORDS}, plus `arguments` and `eval` (not bindable in strict mode).
 */
export const RESERVED_BINDING_NAMES: ReadonlySet<string> = new Set([...RESERVED_WORDS, 'arguments', 'eval'])

/**
 * TypeScript's predefined type names. None of them can name a class, an interface, a type alias or a
 * type parameter ("Class name cannot be 'string'").
 */
export const PREDEFINED_TYPE_NAMES: ReadonlySet<string> = new Set([
  'any', 'bigint', 'boolean', 'never', 'number', 'object', 'string', 'symbol', 'undefined', 'unknown', 'void',
])

const IDENTIFIER_NAME = /^[\p{ID_Start}$_][\p{ID_Continue}$‌‍]*$/u

/**
 * Whether `name` is an ECMAScript IdentifierName written without Unicode escape sequences.
 * It may still be a reserved word.
 */
export function isIdentifierName(name: string): boolean {
  return IDENTIFIER_NAME.test(name)
}

const PLAIN_IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/

/**
 * Renders `name` as the name of an interface member or an object literal method: unquoted when it is a
 * plain identifier that is not a reserved word, quoted otherwise. A quoted name declares the same
 * property (`client.new(...)` still calls it), while an unquoted `new(...)` in an interface would
 * declare a construct signature instead of a `new` method.
 */
export function renderMemberName(name: string): string {
  return PLAIN_IDENTIFIER.test(name) && !RESERVED_WORDS.has(name) ? name : quoteTypeScriptString(name)
}
