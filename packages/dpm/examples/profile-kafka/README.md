# DPM Kafka Profile Demo

This demo shows the profile-first DPM loop without connecting to Kafka:

```text
Kafka topic fixture
  -> profileKafkaTopicFixture
  -> gateway inspect profile
  -> gateway analyze profile
  -> gateway review relationship hint proposal
```

Run it from the repository root:

```bash
pnpm demo:dpm:profile
```

Or from this package:

```bash
pnpm --filter @oa-sdk/dpm run demo:profile
```

The demo proves:

- Kafka topic, key, header, schema, nested message field, metric, and relationship hint evidence is flattened into a DPM profile artifact.
- Connector and profile artifact validation pass without live Kafka access.
- Gateway inspection returns profile counts for editor use.
- Profile analysis emits relationship hint proposals, key candidates, risk indicators, and coverage metrics.
- Proposal review can accept or request changes on hints without mutating connector evidence.
- A mismatched proposal review is rejected with `PROF201`.
- Runtime profile snapshots are defensive copies.

The fixture intentionally contains only shape and metric evidence. It does not contain message
payload samples, source credentials, or token reverse lookup material.
