import "@typespec/http";
import "@typespec/openapi";
import "./envelopes.tsp";
import "./kinds.tsp";
import "./colab.tsp";

using TypeSpec.Http;
using TypeSpec.OpenAPI;

@service(#{
  title: "EWIC Interoperability Envelope Service",
})
@info(#{
  version: "0.1.0",
})
namespace EwicInterop;

@route("/envelopes")
interface EnvelopeOperations {
  @get
  @route("/source/{id}")
  getSourceEnvelope(@path id: EntityId): EntitySourceEnvelope;

  @get
  @route("/derived/{id}")
  getDerivedEnvelope(@path id: EntityId): EntityDerivedEnvelope;

  @post
  @route("/verify-execution")
  verifyExecution(@body execution: ExecutionContent): {
    status: string;
    reproducible: boolean;
  };

  @get
  @route("/colab/runs/{runId}")
  getColabRun(@path runId: string): ColabRunPacket;
}
