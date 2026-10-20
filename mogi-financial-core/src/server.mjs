import http from 'node:http';
import {pathToFileURL} from 'node:url';
import {readFile} from 'node:fs/promises';
import {z} from 'zod';
import {openDatabase,migrate} from './db.mjs';
import {coverage,observations} from './repository.mjs';
import {scenarioSelector} from './contracts.mjs';
import {runBundle} from './bundle.mjs';
import {ruleSet} from './regulation.mjs';
import {curve,runSimulation} from './service.mjs';
const iso=z.string().datetime({offset:true});
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(x=>!Number.isNaN(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x);
const pagination={limit:z.coerce.number().int().min(1).max(2000).default(1000),offset:z.coerce.number().int().min(0).max(10000000).default(0)};
const observationQuery=z.object({source:z.string().max(150).optional(),series:z.string().max(250).optional(),asOf:iso,from:date.optional(),to:date.optional(),...pagination}).strict().refine(x=>!x.from||!x.to||x.from<=x.to,'from must precede to');
async function readBody(req){
 if(!req.headers['content-type']?.startsWith('application/json'))throw Object.assign(Error('application/json required'),{statusCode:415});
 let length=0,parts=[];for await(const part of req){length+=part.length;if(length>2_000_000)throw Object.assign(Error('Body exceeds 2 MB'),{statusCode:413});parts.push(part)}
 try{return JSON.parse(Buffer.concat(parts).toString('utf8'))}catch{throw Object.assign(Error('Invalid JSON'),{statusCode:400})}
}
export function createServer(db){return http.createServer(async(req,res)=>{
 const send=(status,body)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(body))};
 try{
  if(req.headers.origin)throw Object.assign(Error('Cross-origin access is disabled for this local service'),{statusCode:403});
  const u=new URL(req.url,'http://localhost'),q=Object.fromEntries(u.searchParams);
  if(req.method==='GET'&&u.pathname==='/health')return send(200,{status:'ok',backend:db.backend,personalPricingEnabled:false});
  const reportPaths={'/research/rates':['../reports/rate-backtest.html','text/html; charset=utf-8'],'/research/rate-predictions.csv':['../reports/rate-predictions.csv','text/csv; charset=utf-8'],'/research/forecast/protocol.json':['../research/forecast/protocol.json','application/json']};
  if(req.method==='GET'&&reportPaths[u.pathname]){const [path,type]=reportPaths[u.pathname];const b=await readFile(new URL(path,import.meta.url));res.writeHead(200,{'Content-Type':type,'Content-Length':b.length,'X-Content-Type-Options':'nosniff'});res.end(b);return;}
  if(req.method==='GET'&&u.pathname==='/openapi.json')return send(200,JSON.parse(await readFile(new URL('../contracts/openapi.json',import.meta.url),'utf8')));
  if(req.method==='GET'&&u.pathname==='/v1/coverage'){
   const issues=(await db.query('SELECT c.* FROM coverage_issue c JOIN raw_document d ON d.id=c.document_id WHERE d.id IN(SELECT DISTINCT document_id FROM latest_observation) ORDER BY c.source_id,c.code')).rows;
   return send(200,{sources:await coverage(db),issues,coverageIsComplete:false,personalPricingEnabled:false});
  }
  if(req.method==='GET'&&u.pathname==='/v1/series'){
   const p=z.object({source:z.string().max(150).optional(),...pagination}).strict().parse(q);
   const rows=(await db.query('SELECT * FROM series WHERE ($1::text IS NULL OR source_id=$1) ORDER BY id LIMIT $2 OFFSET $3',[p.source||null,p.limit,p.offset])).rows;
   return send(200,{items:rows,limit:p.limit,offset:p.offset});
  }
  if(req.method==='GET'&&u.pathname==='/v1/observations'){
   const p=observationQuery.parse(q);return send(200,{items:await observations(db,p),asOf:p.asOf,availabilityPolicy:'captured_and_ingested_by_asOf',limit:p.limit,offset:p.offset});
  }
  if(req.method==='GET'&&u.pathname==='/v1/curves/boi451'){
   const p=scenarioSelector.omit({indexFloor:true}).parse(q);return send(200,await curve(db,p));
  }
  if(req.method==='GET'&&u.pathname==='/v1/regulation/rules')return send(200,ruleSet);
  if(req.method==='GET'&&u.pathname==='/v1/research/rate-backtests/latest'){
   const rows=(await db.query('SELECT * FROM rate_backtest_run ORDER BY created_at DESC,id DESC LIMIT 1')).rows;
   return rows.length?send(200,rows[0]):send(404,{error:'No saved research run'});
  }
  if(req.method==='POST'&&u.pathname==='/v1/bundles')return send(201,await runBundle(db,await readBody(req)));
  if(req.method==='GET'&&u.pathname.startsWith('/v1/bundles/')){
   const id=z.string().uuid().parse(u.pathname.split('/').pop());
   const rows=(await db.query('SELECT * FROM bundle_run WHERE id=$1',[id])).rows;return rows.length?send(200,rows[0]):send(404,{error:'not_found'});
  }
  if(req.method==='POST'&&u.pathname==='/v1/simulations')return send(201,await runSimulation(db,await readBody(req)));
  if(req.method==='GET'&&u.pathname.startsWith('/v1/simulations/')){
   const id=z.string().uuid().parse(u.pathname.split('/').pop());
   const rows=(await db.query('SELECT id,engine_version,created_at,input_sha256,input,result FROM simulation_run WHERE id=$1',[id])).rows;
   return rows.length?send(200,rows[0]):send(404,{error:'not_found'});
  }
  return send(404,{error:'not_found'});
 }catch(e){const status=e instanceof z.ZodError?422:e.statusCode||500;send(status,{error:status===500?'internal_error':e.message,...(e instanceof z.ZodError?{issues:e.issues}:{})});if(status===500)console.error(e.message)}
})}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const db=await openDatabase();await migrate(db);const server=createServer(db);const port=Number(process.env.PORT||4318);
 server.listen(port,'127.0.0.1',()=>console.log(`Mogi Financial Core http://127.0.0.1:${port} (${db.backend}); personal pricing disabled`));
 const stop=()=>server.close(async()=>{await db.close();process.exit(0)});process.on('SIGINT',stop);process.on('SIGTERM',stop);
}
