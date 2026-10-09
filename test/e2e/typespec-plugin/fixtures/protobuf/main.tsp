import "@typespec/http";
import "@typespec/openapi";

using Http;
using OpenAPI;

@service(#{
  title: "Telemetry & Binary Protocol Service"
})
@info(#{
  version: "1.0.0"
})
namespace WireProtocol;

@extension("x-oa-sdk-protobuf", true)
model SensorReading {
  @extension("x-oa-sdk-field", #{ index: 1 })
  sensorId: string;

  @extension("x-oa-sdk-field", #{ index: 2 })
  timestamp: int64;

  @extension("x-oa-sdk-field", #{ index: 3 })
  temperature: float64;

  @extension("x-oa-sdk-field", #{ index: 4 })
  humidity: float64;

  @extension("x-oa-sdk-field", #{ index: 5 })
  active: boolean;
}

@extension("x-oa-sdk-protobuf", true)
model MetricBatch {
  @extension("x-oa-sdk-field", #{ index: 1 })
  batchId: string;

  @extension("x-oa-sdk-field", #{ index: 2 })
  readings: SensorReading[];
}

@route("/metrics")
namespace Metrics {
  @post
  @summary("Ingest metric batch")
  op ingest(
    @body batch: MetricBatch,
  ): {
    @statusCode statusCode: 200;
    @body body: {
      success: boolean;
      ingestedCount: int32;
    };
  };
}
