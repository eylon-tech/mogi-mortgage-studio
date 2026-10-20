BEGIN;
ALTER TABLE ingestion_run ADD COLUMN coverage_from date;
ALTER TABLE ingestion_run ADD COLUMN coverage_to date;
UPDATE ingestion_run i SET coverage_from=x.lo,coverage_to=x.hi
FROM (SELECT ingestion_id,min(period) lo,max(period) hi FROM observation GROUP BY ingestion_id) x WHERE i.id=x.ingestion_id;
CREATE OR REPLACE VIEW latest_observation AS
 WITH releases AS (
 SELECT d.source_id,i.id,d.fetched_at,i.completed_at,i.coverage_from,i.coverage_to
 FROM raw_document d JOIN ingestion_run i ON i.document_id=d.id AND i.status='complete'
 ) SELECT o.* FROM observation o JOIN releases r ON o.ingestion_id=r.id
 WHERE NOT EXISTS(SELECT 1 FROM releases n WHERE n.source_id=r.source_id
 AND (n.fetched_at,n.completed_at,n.id)>(r.fetched_at,r.completed_at,r.id)
 AND (r.source_id<>'boi_equator' OR o.period BETWEEN n.coverage_from AND n.coverage_to));
INSERT INTO schema_migration(version) VALUES(3);
COMMIT;
