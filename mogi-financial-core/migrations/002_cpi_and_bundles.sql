BEGIN;
ALTER TABLE source DROP CONSTRAINT source_provider_check;
ALTER TABLE source ADD CONSTRAINT source_provider_check CHECK(provider IN ('Bank of Israel','Israel Central Bureau of Statistics'));
CREATE TABLE regulatory_rule_set (
 id text PRIMARY KEY, effective_from date NOT NULL, verified_through date NOT NULL,
 source_url text NOT NULL, source_sha256 text NOT NULL CHECK(source_sha256 ~ '^[a-f0-9]{64}$'),
 rules jsonb NOT NULL, CHECK(verified_through>=effective_from)
);
CREATE TRIGGER immutable_rules BEFORE UPDATE OR DELETE ON regulatory_rule_set FOR EACH ROW EXECUTE FUNCTION reject_evidence_mutation();
CREATE TABLE bundle_run (
 id uuid PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now(), engine_version text NOT NULL,
 rule_set_id text REFERENCES regulatory_rule_set, input_sha256 text NOT NULL,
 input jsonb NOT NULL, result jsonb NOT NULL
);
CREATE TABLE bundle_evidence (
 bundle_id uuid NOT NULL REFERENCES bundle_run, track_id text NOT NULL,
 observation_id text NOT NULL REFERENCES observation, role text NOT NULL,
 PRIMARY KEY(bundle_id,track_id,observation_id,role)
);
CREATE TRIGGER immutable_bundle BEFORE UPDATE OR DELETE ON bundle_run FOR EACH ROW EXECUTE FUNCTION reject_evidence_mutation();
INSERT INTO schema_migration(version) VALUES(2);
COMMIT;
