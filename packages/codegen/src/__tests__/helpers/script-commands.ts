/**
 * Reads the package.json script lines `oa-gen init` writes the way a shell does: commands joined by
 * `&&`, each a list of words, where a double-quoted string is one word (with `\"`, `\\`, `\$` and
 * `` \` `` escapes). Any other shell syntax throws, so that a script using it is noticed instead of
 * misread.
 */
export function scriptCommands(script: string): string[][] {
  const commands: string[][] = [[]]
  let word: string | undefined
  const endWord = () => {
    if (word !== undefined) commands[commands.length - 1]!.push(word)
    word = undefined
  }

  for (let index = 0; index < script.length; index++) {
    const char = script[index]!
    if (char === ' ' || char === '\t') {
      endWord()
    } else if (char === '"') {
      word ??= ''
      for (index++; script[index] !== '"'; index++) {
        if (index >= script.length) throw new Error(`unterminated quote in script: ${script}`)
        if (script[index] === '\\' && /["\\$`]/.test(script[index + 1] ?? '')) index++
        word += script[index]
      }
    } else if (char === '&' && script[index + 1] === '&' && word === undefined) {
      if (commands[commands.length - 1]!.length === 0) throw new Error(`empty command in script: ${script}`)
      commands.push([])
      index++
    } else if (/[|;<>&'`$\\(){}*?]/.test(char)) {
      throw new Error(`unsupported shell syntax "${char}" in script: ${script}`)
    } else {
      word = (word ?? '') + char
    }
  }
  endWord()
  if (commands[commands.length - 1]!.length === 0) throw new Error(`empty command in script: ${script}`)
  return commands
}

/** The arguments a command passes to `oa-gen`, run directly or through `bun x`; undefined for any other command. */
export function oaGenArguments(command: readonly string[]): string[] | undefined {
  if (command[0] === 'oa-gen') return command.slice(1)
  if (command[0] === 'bun' && command[1] === 'x' && command[2] === 'oa-gen') return command.slice(3)
  return undefined
}
