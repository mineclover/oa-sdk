import "@typespec/http";
import "@typespec/openapi3";
using Http;

@service(#{ title: "Discriminated Envelope Fixture" })
namespace OaSdkApi.DiscriminatedEnvelope;

model Cat { name: string; meow: int32; }
model Dog { name: string; bark: string; }
@discriminated union Pet { cat: Cat, dog: Dog }
@discriminated(#{ envelope: "object", discriminatorPropertyName: "type", envelopePropertyName: "data" }) union Pet2 { cat: Cat, dog: Dog }

@route("/pet") op pet(): Pet;
@route("/pet2") op pet2(): Pet2;
