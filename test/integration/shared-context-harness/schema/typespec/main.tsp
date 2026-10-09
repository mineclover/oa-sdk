import "@typespec/http";
import "@typespec/openapi";
import "./collaboration.tsp";
import "./reference.tsp";
import "./reference-index.tsp";
import "./management.tsp";
import "./registry.tsp";

using TypeSpec.Http;
using TypeSpec.OpenAPI;

@service(#{
  title: "Shared Context Harness Contract Service",
})
@info(#{
  version: "0.1.0",
})
namespace SharedContextHarness;

@route("/collaborations")
interface CollaborationsOperations {
  @get
  @route("/{collaborationId}")
  getManifest(@path collaborationId: CollaborationId): CollaborationManifest;

  @get
  @route("/{collaborationId}/references/{referenceId}")
  getReference(
    @path collaborationId: CollaborationId,
    @path referenceId: ReferenceId
  ): SourceReference;

  @get
  @route("/{collaborationId}/references")
  getReferenceIndex(
    @path collaborationId: CollaborationId
  ): CollaborationReferenceIndex;

  @get
  @route("/{collaborationId}/management")
  getManagement(
    @path collaborationId: CollaborationId
  ): CollaborationManagementProjection;
}
