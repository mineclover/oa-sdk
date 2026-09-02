import Ajv2020 from '../../packages/codegen/node_modules/ajv/dist/2020.js';
import standaloneCode from '../../packages/codegen/node_modules/ajv/dist/standalone/index.js';

const AjvCtor = Ajv2020.default ?? Ajv2020;
const standaloneCodeFn = standaloneCode.default ?? standaloneCode;

function createStandaloneAjv() {
  const ajv = new AjvCtor({
    code: { source: true, esm: true },
    strict: false,
    allErrors: false,
  });

  const STANDALONE_FORMATS = {
    'date-time': /^\d{4}-\d{2}-\d{2}[Tt\s]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[Zz]|[+-]\d{2}(?::?\d{2})?)?$/i,
    date: /^\d{4}-\d{2}-\d{2}$/,
    time: /^(?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:[Zz]|[+-]\d{2}(?::?\d{2})?)?$/i,
    'iso-date-time': /^\d{4}-\d{2}-\d{2}[Tt\s]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[Zz]|[+-]\d{2}(?::?\d{2})?)?$/i,
    'iso-time': /^(?:[0-2]\d:[0-5]\d:[0-5]\d|23:59:60)(?:\.\d+)?(?:[Zz]|[+-]\d{2}(?::?\d{2})?)?$/i,
    duration: /^P(?!$)(?:(?:\d+Y)?(?:\d+M)?(?:\d+D)?(?:T(?=\d)(?:\d+H)?(?:\d+M)?(?:\d+S)?)?|\d+W)$/,
    uri: /^(?:[a-z][a-z0-9+\-.]*:)(?:\/?\/)?[^\s]*$/i,
    'uri-reference': /^(?:(?:[a-z][a-z0-9+\-.]*:)?\/?\/)?(?:[^\\\s#][^\s#]*)?(?:#[^\\\s]*)?$/i,
    'uri-template': /^(?:(?:[^\x00-\x20"'<>%\\^`{|}]|%[0-9a-f]{2})|\{[+#./;?&=,!@|]?(?:[a-z0-9_]|%[0-9a-f]{2})+(?::[1-9][0-9]{0,3}|\*)?(?:,(?:[a-z0-9_]|%[0-9a-f]{2})+(?::[1-9][0-9]{0,3}|\*)?)*\})*$/i,
    url: /^(?:https?|ftp):\/\/(?:\S+(?::\S*)?@)?(?:(?!(?:10|127)(?:\.\d{1,3}){3})(?!(?:169\.254|192\.168)(?:\.\d{1,3}){2})(?!172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2})(?:[1-9]\d?|1\d\d|2[01]\d|22[0-3])(?:\.(?:1?\d{1,2}|2[0-4]\d|25[0-5])){2}(?:\.(?:[1-9]\d?|1\d\d|2[0-4]\d|25[0-4]))|(?:(?:[a-z0-9\u{00a1}-\u{ffff}]+-)*[a-z0-9\u{00a1}-\u{ffff}]+)(?:\.(?:[a-z0-9\u{00a1}-\u{ffff}]+-)*[a-z0-9\u{00a1}-\u{ffff}]+)*(?:\.(?:[a-z\u{00a1}-\u{ffff}]{2,})))(?::\d{2,5})?(?:\/[^\s]*)?$/iu,
    email: /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i,
    hostname: /^(?=.{1,253}\.?$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[-0-9a-z]{0,61}[a-z0-9])?)*\.?$/i,
    ipv4: /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/,
    ipv6: /^((([0-9a-f]{1,4}:){7}([0-9a-f]{1,4}|:))|(([0-9a-f]{1,4}:){6}(:[0-9a-f]{1,4}|((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9a-f]{1,4}:){5}(((:[0-9a-f]{1,4}){1,2})|:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9a-f]{1,4}:){4}(((:[0-9a-f]{1,4}){1,3})|((:[0-9a-f]{1,4})?:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-f]{1,4}:){3}(((:[0-9a-f]{1,4}){1,4})|((:[0-9a-f]{1,4}){0,2}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-f]{1,4}:){2}(((:[0-9a-f]{1,4}){1,5})|((:[0-9a-f]{1,4}){0,3}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9a-f]{1,4}:){1}(((:[0-9a-f]{1,4}){1,6})|((:[0-9a-f]{1,4}){0,4}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(:(((:[0-9a-f]{1,4}){1,7})|((:[0-9a-f]{1,4}){0,5}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:)))$/i,
    uuid: /^(?:urn:uuid:)?[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i,
    'json-pointer': /^(?:\/(?:[^~/]|~0|~1)*)*$/,
    'json-pointer-uri-fragment': /^#(?:\/(?:[a-z0-9_\-.!$&'()*+,;:=@]|%[0-9a-f]{2}|~0|~1)*)*$/i,
    'relative-json-pointer': /^(?:0|[1-9][0-9]*)(?:#|(?:\/(?:[^~/]|~0|~1)*)*)$/,
    byte: /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
    int32: { type: 'number', validate: (v) => Number.isInteger(v) && v <= 2147483647 && v >= -2147483648 },
    int64: { type: 'number', validate: (v) => Number.isInteger(v) },
    float: true,
    double: true,
    password: true,
    binary: true,
  };

  for (const [name, format] of Object.entries(STANDALONE_FORMATS)) {
    ajv.addFormat(name, format);
  }

  return ajv;
}

const ajv = createStandaloneAjv();
const schema = {
  $id: 'urn:test:all-formats',
  type: 'object',
  properties: {
    uriVal: { type: 'string', format: 'uri' },
    dtVal: { type: 'string', format: 'date-time' },
    emailVal: { type: 'string', format: 'email' },
    uuidVal: { type: 'string', format: 'uuid' },
    ipv4Val: { type: 'string', format: 'ipv4' },
    ipv6Val: { type: 'string', format: 'ipv6' },
    hostVal: { type: 'string', format: 'hostname' },
    dateVal: { type: 'string', format: 'date' },
    timeVal: { type: 'string', format: 'time' },
    durVal: { type: 'string', format: 'duration' },
    byteVal: { type: 'string', format: 'byte' },
  }
};
ajv.addSchema(schema, 'isAllFormats');
const rawJs = standaloneCodeFn(ajv, { isAllFormats: 'isAllFormats' });
console.log('Generated code length:', rawJs.length);
console.log('Includes require:', rawJs.includes('require('));
console.log('Includes ajv:', rawJs.includes('ajv'));
console.log('=== FIRST 500 CHARACTERS ===');
console.log(rawJs.slice(0, 500));
