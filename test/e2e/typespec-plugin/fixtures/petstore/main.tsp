import "@typespec/http";
import "@typespec/openapi";

using Http;
using OpenAPI;

@service(#{
  title: "Petstore Service"
})
@info(#{
  version: "1.0.0"
})
namespace Petstore;

enum PetStatus {
  available: "available",
  pending: "pending",
  sold: "sold",
}

model Category {
  id: string;
  name: string;
}

model Tag {
  id: string;
  name: string;
}

model Pet {
  id: string;
  name: string;
  category?: Category;
  status: PetStatus;
  tags?: Tag[];
  photoUrls?: string[];
}

model CreatePetRequest {
  name: string;
  category?: Category;
  status?: PetStatus;
  photoUrls?: string[];
}

model UpdatePetRequest {
  name?: string;
  category?: Category;
  status?: PetStatus;
  photoUrls?: string[];
}

@doc("Standard error structure")
model PetError {
  code: string;
  message: string;
  details?: string[];
}

@route("/pets")
namespace Pets {
  @get
  @summary("List all pets")
  op listPets(
    @query limit?: int32,
    @query offset?: int32,
    @query status?: PetStatus,
    @header("x-request-id") requestId?: string,
  ): Pet[] | PetError;

  @post
  @summary("Create a new pet")
  op createPet(
    @body pet: CreatePetRequest,
    @header("x-request-id") requestId?: string,
  ): {
    @statusCode statusCode: 201;
    @body body: Pet;
  } | PetError;

  @get
  @route("/{petId}")
  @summary("Get pet by ID")
  op getPetById(
    @path petId: string,
    @header("x-request-id") requestId?: string,
  ): Pet | PetError;

  @put
  @route("/{petId}")
  @summary("Update existing pet")
  op updatePet(
    @path petId: string,
    @body pet: UpdatePetRequest,
  ): Pet | PetError;

  @delete
  @route("/{petId}")
  @summary("Delete pet by ID")
  op deletePet(
    @path petId: string,
  ): {
    @statusCode statusCode: 204;
  } | PetError;
}
