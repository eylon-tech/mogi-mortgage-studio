// This is a latest-vintage RESEARCH export. It does not backdate database asOf.
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {openDatabase,migrate} from '../src/db.mjs';
const codes=['BNK_99034_LR_BIR_MRTG_467','BNK_99034_LR_BIR_MRTG_1492','MNT_RIB_BOI_D','ZC_TSB_ZND_01Y_MA','ZC_TSB_ZND_05Y_MA','ZC_TSB_ZND_10Y_MA','ZC_TSB_ZRD_01Y_MA','ZC_TSB_ZRD_05Y_MA','ZC_TSB_ZRD_10Y_MA','EXP_EXP_01Y_BI_MA','percentYear'];
const db=await openDatabase();
try{
 await migrate(db);
 const series=(await db.query('SELECT * FROM series WHERE source_code=ANY($1) ORDER BY id',[codes])).rows;
 const rows=(await db.query(`SELECT o.id,o.series_id,o.period::text,o.value::text,o.status,o.source_locator,o.document_id,d.sha256,d.fetched_at,d.published_at,i.completed_at AS ingested_at
 FROM latest_observation o JOIN series s ON s.id=o.series_id JOIN raw_document d ON d.id=o.document_id JOIN ingestion_run i ON i.id=o.ingestion_id
 WHERE s.source_code=ANY($1) AND o.horizon_months=-1 ORDER BY o.series_id,o.period`,[codes])).rows;
 const documents=(await db.query('SELECT * FROM raw_document WHERE id=ANY($1) ORDER BY id',[[...new Set(rows.map(r=>r.document_id))]])).rows;
 const equator=(await db.query("SELECT s.id,s.dimensions,count(*)::int AS months,min(o.period)::text AS first,max(o.period)::text AS last FROM latest_observation o JOIN series s ON s.id=o.series_id WHERE s.source_id='boi_equator' AND s.dimensions->>'measure'='interest' GROUP BY s.id ORDER BY s.id")).rows;
 const data={schemaVersion:1,mode:'latest_vintage_research_only',pointInTimeVerified:false,series,observations:rows,documents,equatorCoverage:equator};
 const body=JSON.stringify(data),sha=createHash('sha256').update(body).digest('hex');
 await mkdir('research/forecast/data',{recursive:true});
 const path=`research/forecast/data/${sha}.json`;
 await writeFile(path,body,{flag:'wx'}).catch(e=>{if(e.code!=='EEXIST')throw e});
 await writeFile('research/forecast/dataset.json',JSON.stringify({path,sha256:sha,exportedAt:new Date().toISOString(),observations:rows.length,series:series.length,pointInTimeVerified:false},null,2));
 console.log(JSON.stringify({path,sha256:sha,observations:rows.length,series:series.length}));
}finally{await db.close()}
