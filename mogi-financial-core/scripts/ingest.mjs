import {readFile} from 'node:fs/promises';
import {openDatabase,migrate} from '../src/db.mjs';
import {ingest,hash} from '../src/repository.mjs';
const db=await openDatabase();
try{
 await migrate(db);
 const manifest=JSON.parse(await readFile(process.argv[2]||'data/manifest.json','utf8'));
 for(const m of manifest){
  const bytes=await readFile(m.path);
  const {createHash}=await import('node:crypto');
  if(createHash('sha256').update(bytes).digest('hex')!==m.sha256)throw Error('Raw checksum mismatch');
  const bundle=JSON.parse(await readFile(`data/normalized/${m.id}.json`,'utf8'));
  if(hash(bundle.source)!==hash(m))throw Error('Manifest does not match normalized file');
  console.log(m.id,await ingest(db,bundle));
 }
}finally{await db.close()}
