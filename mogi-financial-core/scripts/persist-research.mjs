import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {openDatabase,migrate} from '../src/db.mjs';
const pointer=JSON.parse(await readFile('research/forecast/latest.json','utf8'));
const bytes=await readFile(pointer.resultPath),id=createHash('sha256').update(bytes).digest('hex');
if(id!==pointer.resultSha256)throw Error('Research output checksum mismatch');
const r=JSON.parse(bytes),db=await openDatabase();
try{
 await migrate(db);
 await db.query('INSERT INTO rate_backtest_run(id,protocol_sha256,dataset_sha256,code_sha256,result) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',[id,r.protocolSha256,r.datasetSha256,r.codeSha256,JSON.stringify(r)]);
 console.log(JSON.stringify({id,pointInTimeVerified:false,optimizerConnected:false}));
}finally{await db.close()}
