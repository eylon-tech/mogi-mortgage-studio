import {createHash} from 'node:crypto';
export const hash=x=>createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex');
export async function ingest(db,bundle){
 const m=bundle.source, documentId=hash([m.id,m.sha256,m.fetchedAt]),runId=hash([documentId,bundle.parserVersion]);
 const done=await db.query("SELECT status FROM ingestion_run WHERE id=$1",[runId]);
 if(done.rows[0]?.status==='complete')return {documentId,runId,idempotent:true};
 await db.query('INSERT INTO source VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',[m.id,m.provider||'Bank of Israel',m.url,m.format,m.id]);
 await db.query(`INSERT INTO raw_document(id,source_id,sha256,storage_path,byte_size,fetched_at,source_reported_date,source_date_evidence,response_headers,source_url) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING`,[documentId,m.id,m.sha256,m.path,m.bytes,m.fetchedAt,bundle.sourceDate?.date||null,bundle.sourceDate?.evidence||null,m.responseHeaders,m.url]);
 await db.query("INSERT INTO ingestion_run(id,document_id,parser_version,status) VALUES($1,$2,$3,'running') ON CONFLICT(id) DO UPDATE SET status='running',error=NULL",[runId,documentId,bundle.parserVersion]);
 try{
 await db.transaction(async tx=>{
  for(const s of bundle.series){
   await tx.query(`INSERT INTO series SELECT * FROM jsonb_populate_record(NULL::series,$1::jsonb) ON CONFLICT DO NOTHING`,[JSON.stringify(s)]);
   const same=await tx.query('SELECT to_jsonb(s)=$2::jsonb AS same FROM series s WHERE id=$1',[s.id,JSON.stringify(s)]);
   if(!same.rows[0]?.same)throw Error('Series metadata drift: '+s.id);
  }
  for(let start=0;start<bundle.observations.length;start+=1000){
   const batch=bundle.observations.slice(start,start+1000).map(o=>({...o,id:hash([runId,o.series_id,o.period,o.horizon_months,o.effective_from]),document_id:documentId,ingestion_id:runId}));
   await tx.query('INSERT INTO observation SELECT * FROM jsonb_populate_recordset(NULL::observation,$1::jsonb)',[JSON.stringify(batch)]);
  }
  for(const [n,issue] of bundle.issues.entries())await tx.query('INSERT INTO coverage_issue VALUES($1,$2,$3,$4,$5,$6)',[hash([runId,n]),m.id,documentId,issue.severity,issue.code,JSON.stringify(issue.detail)]);
  const count=status=>bundle.observations.filter(o=>o.status===status).length;
  await tx.query("UPDATE ingestion_run SET status='complete',completed_at=now(),accepted_count=$2,missing_count=$3,invalid_count=$4,coverage_from=$5,coverage_to=$6 WHERE id=$1",[runId,count('present'),count('missing'),count('invalid'),bundle.observations.length?bundle.observations.map(o=>o.period).sort()[0]:null,bundle.observations.length?bundle.observations.map(o=>o.period).sort().at(-1):null]);
 });
 }catch(e){await db.query("UPDATE ingestion_run SET status='failed',completed_at=now(),error=$2 WHERE id=$1",[runId,String(e.message).slice(0,1000)]);throw e}
 return {documentId,runId,idempotent:false,observations:bundle.observations.length};
}
export async function observations(db,{source,series,asOf,from='1900-01-01',to='9999-12-31',limit=1000,offset=0}){
 if(!asOf || !Number.isFinite(Date.parse(asOf)))throw Error('asOf timestamp required');
 return (await db.query(`WITH releases AS (
 SELECT d.source_id,i.id,d.fetched_at,i.completed_at,i.coverage_from,i.coverage_to FROM raw_document d JOIN ingestion_run i ON i.document_id=d.id
 WHERE i.status='complete' AND d.fetched_at <= $1::timestamptz AND i.completed_at <= $1::timestamptz
 
 ) SELECT o.id,o.series_id,o.period::text,o.horizon_months,o.effective_from::text,o.value::text,o.status,o.raw_value,o.release_status,o.source_locator,
 d.id AS document_id,d.sha256,d.fetched_at,d.source_url,d.source_reported_date::text,d.published_at,i.completed_at AS ingested_at,i.parser_version,s.value_class,s.rate_convention,s.unit,s.unit_multiplier,s.dimensions
 FROM observation o JOIN releases r ON r.id=o.ingestion_id JOIN ingestion_run i ON i.id=o.ingestion_id JOIN series s ON s.id=o.series_id JOIN raw_document d ON d.id=o.document_id
 WHERE NOT EXISTS(SELECT 1 FROM releases n WHERE n.source_id=r.source_id AND (n.fetched_at,n.completed_at,n.id)>(r.fetched_at,r.completed_at,r.id) AND (r.source_id<>'boi_equator' OR o.period BETWEEN n.coverage_from AND n.coverage_to))
 AND ($2::text IS NULL OR s.source_id=$2) AND ($3::text IS NULL OR s.id=$3) AND o.period BETWEEN $4::date AND $5::date
 AND o.period<=($1::timestamptz AT TIME ZONE 'UTC')::date
 ORDER BY o.series_id,o.period,o.horizon_months,o.effective_from NULLS FIRST,o.id LIMIT $6 OFFSET $7`,[asOf,source||null,series||null,from,to,limit,offset])).rows;
}
export async function coverage(db){return (await db.query(`SELECT s.id AS source_id,count(DISTINCT o.series_id)::integer AS series,count(o.id)::integer AS observations,
 min(o.period)::text AS first_period,max(o.period)::text AS last_period,
 count(o.id) FILTER(WHERE o.status='missing')::integer AS missing,count(o.id) FILTER(WHERE o.status='invalid')::integer AS invalid
 FROM source s LEFT JOIN series se ON se.source_id=s.id LEFT JOIN latest_observation o ON o.series_id=se.id GROUP BY s.id ORDER BY s.id`)).rows}
