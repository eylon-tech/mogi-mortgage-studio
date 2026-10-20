import test from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase,migrate} from '../src/db.mjs';
import {ingest,observations,coverage} from '../src/repository.mjs';
function fixture(date='2020-01-02T00:00:00Z',value='4.25'){
 return {parserVersion:'test-1',source:{id:'boi_test',url:'https://www.boi.org.il/test-fixture',format:'test',sha256:'a'.repeat(64),fetchedAt:date,path:'tests/synthetic-only',bytes:1,responseHeaders:'Synthetic test fixture'},publication:null,series:[{id:'boi_test:rate',source_id:'boi_test',source_code:'rate',label:'Synthetic test only',frequency:'M',unit:'percent',unit_multiplier:0,value_class:'observed',rate_convention:'nominal_annual_percent',dimensions:{scope:'test'}}],observations:[{series_id:'boi_test:rate',period:'2020-01-01',horizon_months:-1,effective_from:null,value,status:value===null?'missing':'present',raw_value:value,release_status:null,source_locator:{cell:'A1'}}],issues:[]};
}
async function importAt(db,b){const r=await ingest(db,b);await db.query('UPDATE ingestion_run SET completed_at=$2 WHERE id=$1',[r.runId,b.source.fetchedAt]);return r;}
const asOf='2025-01-01T00:00:00Z';
test('PostgreSQL foundation: migrations, immutable releases and temporal selection',async t=>{
 const db=await openDatabase({memory:true});await migrate(db);
 try{
 await t.test('Migration is repeatable',async()=>{await migrate(db);assert.equal((await db.query('SELECT count(*)::int AS n FROM schema_migration')).rows[0].n,4)});
 const first=fixture();let receipt;
 await t.test('First import and idempotent repeated import',async()=>{receipt=await importAt(db,first);assert.equal((await ingest(db,first)).idempotent,true);assert.equal((await coverage(db))[0].observations,1)});
 await t.test('Published period does not backdate availability',async()=>{assert.equal((await observations(db,{asOf:'2020-01-01T23:59:59Z'})).length,0);assert.equal((await observations(db,{asOf:'2020-01-03T00:00:00Z'}))[0].value,'4.2500000000000000')});
 await t.test('Revision keeps both values and supports prior asOf',async()=>{const revision=fixture('2021-01-02T00:00:00Z','4.50');revision.source.sha256='b'.repeat(64);await importAt(db,revision);assert.equal((await observations(db,{asOf}))[0].value,'4.5000000000000000');assert.equal((await observations(db,{asOf:'2020-12-01T00:00:00Z'}))[0].value,'4.2500000000000000');assert.equal((await db.query('SELECT count(*)::int AS n FROM observation')).rows[0].n,2)});
 await t.test('Evidence cannot be edited or deleted',async()=>{await assert.rejects(db.query("UPDATE observation SET value=0 WHERE document_id=$1",[receipt.documentId]),/Immutable/);await assert.rejects(db.query('DELETE FROM raw_document WHERE id=$1',[receipt.documentId]),/Immutable/)});
 await t.test('Blank is distinct from zero; newest missing value does not fall back',async()=>{const missing=fixture('2022-01-02T00:00:00Z',null);await importAt(db,missing);const r=(await observations(db,{asOf}))[0];assert.equal(r.status,'missing');assert.equal(r.value,null);const z=fixture('2023-01-02T00:00:00Z','0');await importAt(db,z);assert.equal((await observations(db,{asOf}))[0].value,'0.0000000000000000')});
 await t.test('A reversion to previously seen bytes remains a new release',async()=>{const b=fixture('2024-01-02T00:00:00Z');await importAt(db,b);assert.equal((await observations(db,{asOf}))[0].value,'4.2500000000000000')});
 await t.test('Deleted rows do not resurrect from an older release',async()=>{const b=fixture('2024-02-02T00:00:00Z');b.observations=[];await importAt(db,b);assert.equal((await observations(db,{asOf})).length,0)});
 await t.test('Failed import is atomic and cannot become latest',async()=>{const b=fixture('2024-03-02T00:00:00Z');b.observations.push({...b.observations[0],value:'7'});await assert.rejects(ingest(db,b),/duplicate/);assert.equal((await observations(db,{asOf})).length,0);assert.equal((await db.query("SELECT count(*)::int AS n FROM ingestion_run WHERE status='failed'")).rows[0].n,1)});
 await t.test('Metadata drift fails instead of corrupting series units',async()=>{const b=fixture('2024-04-02T00:00:00Z');b.series[0].unit='ILS';await assert.rejects(ingest(db,b),/metadata drift/);assert.equal((await db.query('SELECT unit FROM series')).rows[0].unit,'percent')});
 await t.test('Personal pricing gate cannot be activated in the database',async()=>{await assert.rejects(db.query("INSERT INTO rate_estimate VALUES('123e4567-e89b-12d3-a456-426614174000','test',now(),now(),'{}','{}','{}',true)"),/check constraint/)});
 }finally{await db.close()}
});
