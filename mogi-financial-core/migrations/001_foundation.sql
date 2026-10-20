BEGIN;
CREATE TABLE IF NOT EXISTS schema_migration(version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE source (
 id text PRIMARY KEY, provider text NOT NULL CHECK(provider='Bank of Israel'),
 url text NOT NULL CHECK(url LIKE 'https://%'), format text NOT NULL,
 description text NOT NULL
);
-- A snapshot is a fetched release, even when its bytes match an older release.
-- Reverted releases must remain representable; content-addressed files are deduplicated on disk.
CREATE TABLE raw_document (
 id text PRIMARY KEY, source_id text NOT NULL REFERENCES source,
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'), storage_path text NOT NULL,
 byte_size bigint NOT NULL CHECK(byte_size>0), fetched_at timestamptz NOT NULL,
 source_reported_date date, source_date_evidence text,
 published_at timestamptz, publication_evidence text,
 response_headers text NOT NULL, source_url text NOT NULL,
 UNIQUE(source_id,sha256,fetched_at),
 CHECK ((source_reported_date IS NULL) = (source_date_evidence IS NULL)),
 CHECK ((published_at IS NULL) = (publication_evidence IS NULL))
);
CREATE TABLE ingestion_run (
 id text PRIMARY KEY, document_id text NOT NULL REFERENCES raw_document,
 parser_version text NOT NULL, started_at timestamptz NOT NULL DEFAULT now(),
 completed_at timestamptz, status text NOT NULL CHECK(status IN ('running','complete','failed')),
 accepted_count integer NOT NULL DEFAULT 0, missing_count integer NOT NULL DEFAULT 0,
 invalid_count integer NOT NULL DEFAULT 0, error text,
 UNIQUE(document_id,parser_version)
);
CREATE TABLE series (
 id text PRIMARY KEY, source_id text NOT NULL REFERENCES source, source_code text NOT NULL,
 label text NOT NULL, frequency text NOT NULL CHECK(frequency IN ('D','M','I')),
 unit text NOT NULL, unit_multiplier integer NOT NULL,
 value_class text NOT NULL CHECK(value_class IN ('observed','market_model')),
 rate_convention text NOT NULL CHECK(rate_convention IN ('nominal_annual_percent','effective_annual_percent','source_unspecified','not_a_rate')),
 dimensions jsonb NOT NULL CHECK(jsonb_typeof(dimensions)='object'),
 UNIQUE(source_id,source_code)
);
CREATE TABLE observation (
 id text PRIMARY KEY, document_id text NOT NULL REFERENCES raw_document,
 ingestion_id text NOT NULL REFERENCES ingestion_run, series_id text NOT NULL REFERENCES series,
 period date NOT NULL, horizon_months integer NOT NULL DEFAULT -1 CHECK(horizon_months BETWEEN -1 AND 360),
 effective_from date, value numeric(38,16),
 status text NOT NULL CHECK(status IN ('present','missing','invalid')),
 raw_value text, release_status text, source_locator jsonb NOT NULL,
 CHECK((status='present' AND value IS NOT NULL) OR (status<>'present' AND value IS NULL)),
 UNIQUE NULLS NOT DISTINCT(ingestion_id,series_id,period,horizon_months,effective_from)
);
CREATE INDEX observation_lookup ON observation(series_id,period,horizon_months);
CREATE INDEX observation_document ON observation(document_id);
CREATE INDEX release_asof ON raw_document(source_id,fetched_at DESC);
CREATE TABLE coverage_issue (
 id text PRIMARY KEY, source_id text NOT NULL REFERENCES source, document_id text NOT NULL REFERENCES raw_document,
 severity text NOT NULL CHECK(severity IN ('info','warning','error')), code text NOT NULL, detail jsonb NOT NULL
);
CREATE TABLE simulation_run (
 id text PRIMARY KEY, engine_version text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 input_sha256 text NOT NULL, input jsonb NOT NULL, result jsonb NOT NULL,
 CHECK(jsonb_typeof(input)='object' AND jsonb_typeof(result)='object')
);
CREATE TABLE simulation_evidence (
 simulation_id text NOT NULL REFERENCES simulation_run,
 observation_id text NOT NULL REFERENCES observation,
 role text NOT NULL, PRIMARY KEY(simulation_id,observation_id,role)
);
-- Customer evidence is deliberately separate from published market series.
-- No customer quote import, model fitting or optimization is activated in v0.1.
CREATE TABLE customer_quote (
 id uuid PRIMARY KEY, pseudonymous_borrower_id text NOT NULL, bundle_id uuid NOT NULL,
 bank_code text NOT NULL, issued_at timestamptz NOT NULL, received_at timestamptz NOT NULL DEFAULT now(),
 evidence_sha256 text NOT NULL, consent_reference text NOT NULL,
 verification_status text NOT NULL CHECK(verification_status IN ('pending','verified','rejected')),
 quoted_terms jsonb NOT NULL, borrower_features jsonb NOT NULL
);
CREATE TABLE rate_estimate (
 id uuid PRIMARY KEY, model_version text NOT NULL, training_cutoff timestamptz NOT NULL,
 generated_at timestamptz NOT NULL DEFAULT now(), request jsonb NOT NULL, estimate jsonb NOT NULL,
 validation_report jsonb NOT NULL, optimization_enabled boolean NOT NULL DEFAULT false CHECK(NOT optimization_enabled)
);
CREATE FUNCTION reject_evidence_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Immutable evidence: append a new release instead'; END $$;
CREATE TRIGGER immutable_raw BEFORE UPDATE OR DELETE ON raw_document FOR EACH ROW EXECUTE FUNCTION reject_evidence_mutation();
CREATE TRIGGER immutable_observation BEFORE UPDATE OR DELETE ON observation FOR EACH ROW EXECUTE FUNCTION reject_evidence_mutation();
CREATE TRIGGER immutable_series BEFORE UPDATE OR DELETE ON series FOR EACH ROW EXECUTE FUNCTION reject_evidence_mutation();
CREATE TRIGGER immutable_simulation BEFORE UPDATE OR DELETE ON simulation_run FOR EACH ROW EXECUTE FUNCTION reject_evidence_mutation();
CREATE VIEW latest_observation AS
 WITH releases AS (
 SELECT DISTINCT ON (d.source_id) i.id FROM raw_document d
 JOIN ingestion_run i ON i.document_id=d.id AND i.status='complete'
 ORDER BY d.source_id,d.fetched_at DESC,i.completed_at DESC,i.id DESC
 ) SELECT o.* FROM observation o JOIN releases r ON o.ingestion_id=r.id;
INSERT INTO schema_migration(version) VALUES(1);
COMMIT;
