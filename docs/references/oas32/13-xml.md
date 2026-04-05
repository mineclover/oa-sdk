<!-- source: OAI/OpenAPI-Specification@3.2.0 -->

### XML Object

A metadata object that allows for more fine-tuned XML model definitions.
When using a Schema Object with XML, if no XML Object is present, the behavior is determined by the XML Object's default field values.

#### Fixed Fields

| Field Name | Type | Description |
| ---- | :----: | ---- |
| <a name="xml-node-type"></a>nodeType | `string` | One of `element`, `attribute`, `text`, `cdata`, or `none`, as explained under [XML Node Types](#xml-node-types).  The default value is `none` if `$ref`, `$dynamicRef`, or `type: "array"` is present in the [Schema Object](#schema-object) containing the XML Object, and `element` otherwise. |
| <a name="xml-name"></a>name | `string` | Sets the name of the element/attribute corresponding to the schema, replacing the name that was inferred as described under [XML Node Names](#xml-node-names). This field SHALL be ignored if the `nodeType` is `text`, `cdata`, or `none`. |
| <a name="xml-namespace"></a>namespace | `string` | The IRI ([[RFC3987]]) of the namespace definition. Value MUST be in the form of a non-relative IRI. |
| <a name="xml-prefix"></a>prefix | `string` | The prefix to be used for the [name](#xml-name). |
| <a name="xml-attribute"></a>attribute | `boolean` | Declares whether the property definition translates to an attribute instead of an element. Default value is `false`. If `nodeType` is present, this field MUST NOT be present.<br /><br />**Deprecated:** Use `nodeType: "attribute"` instead of `attribute: true` |
| <a name="xml-wrapped"></a>wrapped | `boolean` | MAY be used only for an array definition. Signifies whether the array is wrapped (for example, `<books><book/><book/></books>`) or unwrapped (`<book/><book/>`). Default value is `false`. The definition takes effect only when defined alongside `type` being `"array"` (outside the `items`). If `nodeType` is present, this field MUST NOT be present.<br /><br />**Deprecated:** Use `nodeType: "element"` instead of `wrapped: true` |

Note that when generating an XML document from object data, the order of the nodes is undefined.
Use `prefixItems` to control node ordering as shown under [Ordered Elements and Text](#ordered-elements-and-text).

See [Appendix B](#appendix-b-data-type-conversion) for a discussion of converting values of various types to string representations.

This object MAY be extended with [Specification Extensions](#specification-extensions).

#### XML Node Types

Each Schema Object describes a particular type of XML [[!DOM]] [node](https://dom.spec.whatwg.org/#interface-node) which is specified by the `nodeType` field, which has the following possible values.
Except for the special value `none`, these values have numeric equivalents in the DOM specification which are given in parentheses after the name:

* `element` (1): The schema represents an element and describes its contents
* `attribute` (2): The schema represents an attribute and describes its value
* `text` (3): The schema represents a text node (parsed character data)
* `cdata` (4): The schema represents a CDATA section
* `none`: The schema does not correspond to any node in the XML document, and the nodes corresponding to its subschema(s) are included directly under its parent schema's node

The `none` type is useful for JSON Schema constructs that require more Schema Objects than XML nodes, such as a schema containing only `$ref` that exists to facilitate re-use rather than imply any structure.

##### Modeling Element Lists

For historical compatibility, schemas of `type: "array"` default to `nodeType: "none"`, placing the nodes for each array item directly under the parent node.
This also aligns with the inferred naming behavior defined under [XML Node Names](#xml-node-names).

To produce an element wrapping the list, set an explicit `nodeType: "element"` on the `type: "array"` schema.
When doing so, it is advisable to set an explicit name on either the wrapping element or the item elements to avoid them having the same inferred name.
See examples for expected behavior.

##### Implicit and Explicit `text` Nodes

If an `element` node has a primitive type, then the schema also produces an implicit `text` node described by the schema for the contents of the `element` node named by the property name (or `name` field).

Explicit `text` nodes are necessary if an element has both attributes and content.

Note that placing two `text` nodes adjacent to each other is ambiguous for parsing, and the resulting behavior is implementation-defined.

#### XML Node Names

The `element` and `attribute` node types require a name, which MUST be inferred from the schema as follows, unless overridden by the `name` field:

* For schemas directly under the [Components Object's](#components-object) `schemas` field, the component name is the inferred name.
* For property schemas, and for array item schemas under a property schema, the property name is the inferred name.
* In all other cases, such as an inline schema under a [Media Type Object's](#media-type-object) `schema` field, no name can be inferred and an XML Object with a `name` field MUST be present.

Note that when using arrays, singular vs plural forms are _not_ inferred, and must be set explicitly.

#### Namespace Limitations

The `namespace` field is intended to match the syntax of [XML namespaces](https://www.w3.org/TR/xml-names11/), although there are a few caveats:

* Versions 3.1.0, 3.0.3, and earlier of this specification erroneously used the term "absolute URI" instead of "non-relative URI" ("non-relative IRI" as of OAS v3.2.0), so authors using namespaces that include a fragment should check tooling support carefully.
* XML allows but discourages relative IRI-references, while this specification outright forbids them.

#### Handling `null` Values

XML does not, by default, have a concept equivalent to `null`, and to preserve compatibility with version 3.1.1 and earlier of this specification, the behavior of serializing `null` values is implementation-defined.

However, implementations SHOULD handle `null` values as follows:

* For elements, produce an empty element with an `xsi:nil="true"` attribute.
* For attributes, omit the attribute.
* For text and CDATA sections, see [Appendix B](#appendix-b-data-type-conversion) for a discussion of serializing non-text values to text.

Note that for attributes, this makes either a `null` value or a missing property serialize to an omitted attribute.
As the Schema Object validates the in-memory representation, this allows handling the combination of `null` and a required property.
However, because there is no distinct way to represent `null` as an attribute, it is RECOMMENDED to make attribute properties optional rather than use `null`.

To ensure correct round-trip behavior, when parsing an element that omits an attribute, implementations SHOULD set the corresponding property to `null` if the schema allows for that value (e.g. `type: ["number", "null"]`), and omit the property otherwise (e.g.`type: "number"`).

#### XML Object Examples

The Schema Objects are followed by an example XML representation produced for the schema shown.
For examples using `attribute` or `wrapped`, please see version 3.1 of the OpenAPI Specification.

##### No XML Object

Basic string property without an XML Object, using `serializedValue` (the remaining examples will use `externalValue` so that the XML form can be shown with syntax highlighting):

```yaml
application/xml:
  schema:
    type: object
    xml:
      name: document
    properties:
      animals:
        type: string
  examples:
    pets:
      dataValue:
        animals: dog, cat, hamster
      serializedValue: |
        <document>
          <animals>dog, cat, hamster</animals>
        </document>
```

Basic string array property (`nodeType` is `none` by default):

```yaml
application/xml:
  schema:
    type: object
    xml:
      name: document
    properties:
      animals:
        type: array
        items:
          type: string
  examples:
    pets:
      dataValue:
        animals:
          - dog
          - cat
          - hamster
      externalValue: ./examples/pets.xml
```

Where `./examples/pets.xml` would be:

```xml
<document>
  <animals>dog</animals>
  <animals>cat</animals>
  <animals>hamster</animals>
</document>
```

##### XML Name Replacement

```yaml
application/xml:
  schema:
    type: object
    xml:
      name: document
    properties:
      animals:
        type: string
        xml:
          name: animal
  examples:
    pets:
      dataValue:
        animals:
          - dog
          - cat
          - hamster
      externalValue: ./examples/pets.xml
```

Where `./examples/pets.xml` would be:

```xml
<document>
  <animal>dog</animal>
  <animal>cat</animal>
  <animal>hamster</animal>
</document>
```

##### XML Attribute, Prefix and Namespace

Note that the name of the root XML element comes from the component name.

```yaml
components:
  schemas:
    Person:
      type: object
      properties:
        id:
          type: integer
          format: int32
          xml:
            nodeType: attribute
        name:
          type: string
          xml:
            namespace: https://example.com/schema/sample
            prefix: sample
  requestBodies:
    Person:
      content:
        application/xml:
          schema:
            $ref: "#/components/schemas/Person"
          examples:
            Person:
              dataValue:
                id: 123
                name: example
              externalValue: ./examples/Person.xml
```

Where `./examples/Person.xml` would be:

```xml
<Person id="123">
  <sample:name xmlns:sample="https://example.com/schema/sample">example</sample:name>
</Person>
```

##### XML Arrays

Changing the element names:

```yaml
application/xml:
  schema:
    type: object
    xml:
      name: document
    properties:
      animals:
        type: array
        items:
          type: string
          xml:
            name: animal
  examples:
    pets:
      dataValue:
        animals:
          - dog
          - cat
          - hamster
      externalValue: ./examples/pets.xml
```

Where `./examples/pets.xml` would be:

```xml
<document>
  <animal>dog</animal>
  <animal>cat</animal>
  <animal>hamster</animal>
</document>
```

The `name` field for the `type: "array"` schema has no effect because the default `nodeType` for that object is `none`:

```yaml
application/xml:
  schema:
    type: object
    xml:
      name: document
    properties:
      animals:
        type: array
        xml:
          name: aliens
        items:
          type: string
          xml:
            name: animal
  examples:
    pets:
      dataValue:
        animals:
          - dog
          - cat
          - hamster
      externalValue: ./examples/pets.xml
```

Where `./examples/pets.xml` would be:

```xml
<document>
  <animal>dog</animal>
  <animal>cat</animal>
  <animal>hamster</animal>
</document>
```

Even when a wrapping element is explicitly created by setting `nodeType` to `element`, if a name is not explicitly defined, the same name will be used for both the wrapping element and the list item elements:

```yaml
application/xml:
  schema:
    type: object
    xml:
      name: document
    properties:
      animals:
        type: array
        xml:
          nodeType: element
        items:
          type: string
  examples:
    pets:
      dataValue:
        animals:
          - dog
          - cat
          - hamster
      externalValue: ./examples/pets.xml
```

Where `./examples/pets.xml` would be:

```xml
<document>
  <animals>
    <animals>dog</animals>
    <animals>cat</animals>
    <animals>hamster</animals>
  </animals>
</document>
```

To overcome the naming problem in the example above, the following definition can be used:

```yaml
application/xml:
  schema:
    type: object
    xml:
      name: document
    properties:
      animals:
        type: array
        xml:
          nodeType: element
        items:
          type: string
          xml:
            name: animal
  examples:
    pets:
      dataValue:
        animals:
          - dog
          - cat
          - hamster
      externalValue: ./examples/pets.xml
```

Where `./examples/pets.xml` would be:

```xml
<document>
  <animals>
    <animal>dog</animal>
    <animal>cat</animal>
    <animal>hamster</animal>
  </animals>
</document>
```

Affecting both wrapping element and item element names:

```yaml
application/xml:
  schema:
    type: object
    xml:
      name: document
    properties:
      animals:
        type: array
        xml:
          name: aliens
          nodeType: element
        items:
          type: string
          xml:
            name: animal
  examples:
    pets:
      dataValue:
        animals:
          - dog
          - cat
          - hamster
      externalValue: ./examples/pets.xml
```

Where `./examples/pets.xml` would be:

```xml
<document>
  <aliens>
    <animal>dog</animal>
    <animal>cat</animal>
    <animal>hamster</animal>
  </aliens>
</document>
```

If we change the wrapping element name but not the item element names:

```yaml
application/xml:
  schema:
    type: object
    xml:
      name: document
    properties:
      animals:
        type: array
        xml:
          name: aliens
          nodeType: element
        items:
          type: string
  examples:
    pets:
      dataValue:
        animals:
          - dog
          - cat
          - hamster
      externalValue: ./examples/pets.xml
```

Where `./examples/pets.xml` would be:

```xml
<document>
  <aliens>
    <aliens>dog</aliens>
    <aliens>cat</aliens>
    <aliens>hamster</aliens>
  </aliens>
</document>
```

##### Elements With Attributes And Text

```yaml
application/xml:
  schema:
    type: array
    xml:
      nodeType: element
      name: animals
    items:
      xml:
        name: animal
      properties:
        kind:
          type: string
          xml:
            nodeType: attribute
        name:
          type: string
          xml:
            nodeType: text
  examples:
    pets:
      dataValue:
      - kind: Cat
        name: Fluffy
      - kind: Dog
        name: Fido
```

Where `./examples/pets.xml` would be:

```xml
<animals>
  <animal kind="Cat">Fluffy</animals>
  <animal kind="Dog">Fido</animals>
<animals>
```

##### Referenced Element With CDATA

In this example, no element is created for the Schema Object that contains only  the `$ref`, as its `nodeType` defaults to `none`.
It is necessary to create a subschema for the CDATA section as otherwise the content would be treated as an implicit node of type `text`.

```yaml
components:
  schemas:
    Documentation:
      type: object
      properties:
        content:
          type: string
          contentMediaType: text/html
          xml:
            nodeType: cdata
  responses:
    content:
      application/xml:
        schema:
          $ref: "#/components/schemas/Documentation"
        examples:
          docs:
            dataValue:
              content: <html><head><title>Awesome Docs</title></head><body></body><html>
            externalValue: ./examples/docs.xml
```

Where `./examples/docs.xml` would be:

```xml
<Documentation>
  <![CDATA[<html><head><title>Awesome Docs</title></head><body></body><html>]]>
</Documentation>
```

Alternatively, the named root element could be set at the point of use and the root element disabled on the component (note that in this example, the same `dataValue` is used in two places with different serializations shown with `externalValue`):

```yaml
paths:
  /docs:
    get:
      responses:
        "200":
          content:
            application/xml:
              schema:
                xml:
                  nodeType: element
                  name: StoredDocument
                $ref: "#/components/schemas/Documentation"
              examples:
                stored:
                  dataValue:
                    content: <html><head><title>Awesome Docs</title></head><body></body><html>
                  externalValue: ./examples/stored.xml
    put:
      requestBody:
        required: true
        content:
          application/xml:
            schema:
              xml:
                nodeType: element
                name: UpdatedDocument
              $ref: "#/components/schemas/Documentation"
            examples:
              updated:
                dataValue:
                  content: <html><head><title>Awesome Docs</title></head><body></body><html>
                externalValue: ./examples/updated.xml
      responses:
        "201": {}
components:
  schemas:
    Documentation:
      xml:
        nodeType: none
      type: object
      properties:
        content:
          type: string
          contentMediaType: text/html
          xml:
            nodeType: cdata
```

where `./examples/stored.xml` would be:

```xml
<StoredDocument>
  <![CDATA[<html><head><title>Awesome Docs</title></head><body></body><html>]]>
</StoredDocument>
```

and `./examples/updated.xml` would be:

```xml
<UpdatedDocument>
  <![CDATA[<html><head><title>Awesome Docs</title></head><body></body><html>]]>
</UpdatedDocument>
```

##### Ordered Elements and Text

To control the exact order of elements, use the `prefixItems` keyword.
With this approach, it is necessary to set the element names using the XML Object as they would otherwise all inherit the parent's name despite being different elements in a specific order.
It is also necessary to set `nodeType: "element"` explicitly on the array in order to get an element containing the sequence.

This first ordered example shows a sequence of elements, as well as the recommended serialization of `null` for elements:

```yaml
application/xml:
  schema:
    xml:
      nodeType: element
      name: OneTwoThree
    type: array
    minLength: 3
    maxLength: 3
    prefixItems:
    - xml:
        name: One
      type: string
    - xml:
        name: Two
      type: object
      required:
      - unit
      - value
      properties:
        unit:
          type: string
          xml:
            nodeType: attribute
        value:
          type: number
          xml:
            nodeType: text
    - xml:
        name: Three
      type:
      - boolean
      - "null"
  examples:
    OneTwoThree:
      dataValue:
        - Some text
        - unit: cubits
          value: 42
        null
      ]
      externalValue: ./examples/OneTwoThree.xml
```

Where `./examples/OneTwoThree.xml` would be:

```xml
<OneTwoThree>
  <One>Some text</One>
  <Two unit="cubits">42</Two>
  <Three xsi:nil="true" />
</OneTwoThree>
```

In this next example, the `name` needs to be set for the element, while the `nodeType` needs to be set for the text nodes.

```yaml
application/xml:
  schema:
    xml:
      nodeType: element
      name: Report
    type: array
    prefixItems:
    - xml:
        nodeType: text
      type: string
    - xml:
        name: data
      type: number
    - xml:
        nodeType: text
      type: string
  examples:
    Report:
      dataValue:
        - Some preamble text.
        - 42
        - Some postamble text.
      externalValue: ./examples/Report.xml
```

Where `./examples/Report.xml` would be:

```xml
<Report>Some preamble text.<data>42</data>Some postamble text.</Report>
```

##### XML With `null` Values

Recall that the schema validates the in-memory data, not the XML document itself.
This example does not define properties for `"related"` as it is showing how
empty objects and `null` are handled.

```yaml
application/xml:
  schema:
    xml:
      name: product
    type: object
    required:
    - count
    - description
    - related
    properties:
      count:
        type:
        - number
        - "null"
        xml:
          nodeType: attribute
      rating:
        type: string
        xml:
          nodeType: attribute
      description:
        type: string
      related:
        type:
        - object
        - "null"
  examples:
    productWithNulls:
      dataValue:
        count: null
        description: Thing
        related: null
      externalValue: ./examples/productWithNulls.xml
    productNoNulls:
      dataValue:
        count: 42
        description: Thing
        related: {}
      externalValue: ./examples/productNoNulls.xml
```

Where `./examples/productWithNulls.xml` would be:

```xml
<product>
  <description>Thing</description>
  <related xsi:nil="true" />
</product>
```

and `./examples/productNoNulls.xml` would be:

```xml
<product count="42">
  <description>Thing</description>
  <related></related>
</product>
```

---
← [index](./index.md)
