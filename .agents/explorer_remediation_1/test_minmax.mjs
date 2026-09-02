import Ajv2020 from '../../packages/codegen/node_modules/ajv/dist/2020.js';
import standaloneCode from '../../packages/codegen/node_modules/ajv/dist/standalone/index.js';

const AjvCtor = Ajv2020.default ?? Ajv2020;
const standaloneCodeFn = standaloneCode.default ?? standaloneCode;

const ajv = new AjvCtor({
  code: { source: true, esm: true },
  strict: false,
  allErrors: false,
});

const schema = {
  $id: 'urn:test:min-max',
  type: 'object',
  properties: {
    arrObjects: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' } } }, uniqueItems: true },
  }
};
ajv.addSchema(schema, 'isUniqueObj');
const rawJs = standaloneCodeFn(ajv, { isUniqueObj: 'isUniqueObj' });
console.log('Includes require:', rawJs.includes('require('));
console.log('=== EXTRACTED REQUIRES ===');
for (const line of rawJs.split('\n')) {
  if (line.includes('require(')) {
    console.log(line);
  }
}
