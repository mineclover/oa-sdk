import { describe, expect, it } from 'vitest'
import { renderPyModule } from '../render.js'
import type { PyModuleIR } from '../ir.js'

function module(decls: PyModuleIR['decls']): PyModuleIR {
  return { irVersion: 1, module: 'models', decls, rebuild: [], imports: {
    from: {
      __future__: ['annotations'], pydantic: ['AfterValidator', 'BaseModel', 'ConfigDict', 'Field'],
      typing: ['Annotated', 'Literal', 'TypeAlias'],
    },
  }, diagnostics: [] }
}

describe('renderPyModule', () => {
  it('renders aliases and models with deterministic imports and spacing', () => {
    const result = renderPyModule(module([
      {
        kind: 'alias', name: 'Id', pyName: 'Id', origin: 'component',
        type: { kind: 'builtin', name: 'str' }, pointer: '/Id',
      },
      {
        kind: 'model', name: 'User', pyName: 'User', origin: 'component', bases: [],
        fields: [{
          wireName: 'userId', attribute: 'user_id', alias: 'userId', type: { kind: 'ref', target: 'Id' },
          required: true, nullable: false, default: { kind: 'required' }, rejectExplicitNull: false,
          pointer: '/User/userId',
        }],
        openness: { kind: 'open' }, extra: 'ignore', regexEngine: 'rust-regex', pointer: '/User',
      },
    ]))
    expect(result).toContain('Id: TypeAlias = str')
    expect(result).toContain('class User(BaseModel):')
    expect(result).toContain('user_id: Id = Field(..., alias="userId")')
  })

  it('renders JSON literals with Python booleans and nulls', () => {
    const result = renderPyModule(module([{
      kind: 'alias', name: 'Value', pyName: 'Value', origin: 'component',
      type: { kind: 'literal', values: ['x', true, null] }, pointer: '/Value',
    }]))
    expect(result).toContain('Literal["x", True, None]')
  })

  it('renders unique items as an annotation validator and keeps UTF-8 text readable', () => {
    const result = renderPyModule(module([{
      kind: 'model', name: 'M', pyName: 'M', origin: 'component', bases: [],
      fields: [{
        wireName: 'values', attribute: 'values', alias: '', required: true, nullable: false,
        default: { kind: 'required' }, rejectExplicitNull: false,
        type: {
          kind: 'constrained', base: { kind: 'list', item: { kind: 'builtin', name: 'str' } },
          constraints: { uniqueItems: true },
        },
        description: '한국어', pointer: '/M/values',
      }],
      openness: { kind: 'open' }, extra: 'ignore', regexEngine: 'rust-regex', description: '설명', pointer: '/M',
    }]))
    expect(result).toContain('"""설명"""')
    expect(result).toContain('values: Annotated[list[str], AfterValidator(_unique_items)]')
    expect(result).not.toContain('Field(AfterValidator')
  })

  it('indents continuation lines in class docstrings', () => {
    const result = renderPyModule(module([{
      kind: 'model', name: 'M', pyName: 'M', origin: 'component', bases: [], fields: [],
      openness: { kind: 'open' }, extra: 'ignore', regexEngine: 'rust-regex',
      description: 'first line\nsecond line', pointer: '/M',
    }]))
    expect(result).toContain('    """first line\n    second line"""')
  })

  it('does not inject lint comments into long multiline docstrings', () => {
    const description = 'first line with more than seventy characters '.repeat(2) + '\n'
      + 'second line with more than seventy characters '.repeat(2)
    const result = renderPyModule(module([{
      kind: 'model', name: 'M', pyName: 'M', origin: 'component', bases: [], fields: [],
      openness: { kind: 'open' }, extra: 'ignore', regexEngine: 'rust-regex', description, pointer: '/M',
    }]))
    expect(result).toContain(`    """${description.replaceAll('\n', '\n    ')}"""`)
    expect(result).not.toContain('characters  # noqa: E501')
  })

  it('renders decoded scalar validators and serializers from IR', () => {
    const result = renderPyModule(module([{
      kind: 'alias', name: 'When', pyName: 'When', origin: 'component', pointer: '/When',
      type: {
        kind: 'decoded', wireType: 'int', encoding: 'unixtime',
        pythonType: { kind: 'named', module: 'pydantic', name: 'AwareDatetime' },
      },
    }]))
    expect(result).toContain('Annotated[AwareDatetime, BeforeValidator(_decode_unixtime), PlainSerializer(_encode_unixtime, return_type=int)]')
    expect(result).toContain('def _decode_unixtime')
    expect(result).not.toContain('def _decode_http_date')
  })
})
