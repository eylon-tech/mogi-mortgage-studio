BEGIN;
CREATE TABLE rate_backtest_run (
 id text PRIMARY KEY CHECK(length(id)=64),
 created_at timestamptz NOT NULL DEFAULT now(),
 protocol_sha256 text NOT NULL CHECK(length(protocol_sha256)=64),
 dataset_sha256 text NOT NULL CHECK(length(dataset_sha256)=64),
 code_sha256 text NOT NULL CHECK(length(code_sha256)=64),
 result jsonb NOT NULL,
 point_in_time_verified boolean NOT NULL DEFAULT false CHECK(point_in_time_verified=false),
 optimizer_connected boolean NOT NULL DEFAULT false CHECK(optimizer_connected=false)
);
CREATE TRIGGER immutable_backtest BEFORE UPDATE OR DELETE ON rate_backtest_run FOR EACH ROW EXECUTE FUNCTION reject_evidence_mutation();
INSERT INTO schema_migration(version) VALUES(4);
COMMIT;
