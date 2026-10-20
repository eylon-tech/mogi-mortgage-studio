import {PGlite} from '@electric-sql/pglite';
import pg from 'pg';
import {readFile} from 'node:fs/promises';
export async function openDatabase({url=process.env.DATABASE_URL,directory=process.env.PGLITE_DIR||'data/pg',memory=false}={}) {
 if(url){
  const pool=new pg.Pool({connectionString:url,max:5});
  const wrap=client=>({query:(sql,args)=>client.query(sql,args),exec:sql=>client.query(sql)});
  return {...wrap(pool),transaction:async fn=>{const c=await pool.connect();try{await c.query('BEGIN');const out=await fn(wrap(c));await c.query('COMMIT');return out}catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}},close:()=>pool.end(),backend:'postgresql'};
 }
 const db=new PGlite(memory?undefined:directory);await db.waitReady;
 db.backend='pglite';return db;
}
export async function migrate(db){
 const found=await db.query("SELECT to_regclass('public.schema_migration') AS name");
 let current=found.rows[0].name?(await db.query('SELECT max(version) AS v FROM schema_migration')).rows[0].v:0;
 const files=['001_foundation.sql','002_cpi_and_bundles.sql','003_rolling_release_coverage.sql','004_rate_backtests.sql'];
 if(current>files.length)throw Error('Database is newer than this application');
 for(let i=current;i<files.length;i++)await db.exec(await readFile(new URL('../migrations/'+files[i],import.meta.url),'utf8'));
}
