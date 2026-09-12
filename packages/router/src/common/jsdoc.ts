/** Render untrusted OpenAPI text as a syntactically safe JSDoc block. */
export function formatJSDoc(value: unknown, indent = ''): string {
  const text = String(value)
    .replace(/\r\n?/g, '\n')
    // A literal terminator would turn OpenAPI metadata into generated code.
    .replace(/\*\//g, '*\\/')
  const lines = text.split('\n')

  if (lines.length === 1) return `${indent}/** ${lines[0]} */`

  return [
    `${indent}/**`,
    ...lines.map(line => `${indent} * ${line}`),
    `${indent} */`,
  ].join('\n')
}
