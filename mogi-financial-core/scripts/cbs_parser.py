from pathlib import Path
from decimal import Decimal
import hashlib,json
ROOT=Path(__file__).resolve().parents[1]
def parse_cbs(o,b):
 snapshot=json.loads(b);rows=[];expected=snapshot['expectedItems'];seen=set()
 for index,page in enumerate(snapshot['pages'],1):
  raw=(ROOT/page['path']).read_bytes()
  if hashlib.sha256(raw).hexdigest()!=page['sha256']:raise ValueError('CBS page checksum mismatch')
  data=json.loads(raw,parse_float=Decimal);paging=data['paging']
  if paging['current_page']!=index or paging['last_page']!=len(snapshot['pages']) or paging['total_items']!=expected:raise ValueError('Incomplete CBS pagination')
  if len(data['month'])!=1 or data['month'][0]['code']!=120010:raise ValueError('Unexpected CBS index code')
  for ri,r in enumerate(data['month'][0]['date']):
   p=f"{r['year']:04}-{r['month']:02}-01"
   if p in seen:raise ValueError('Duplicate CBS reference period')
   seen.add(p);rows.append(p)
   locator={'page':index,'responseSha256':page['sha256'],'jsonPointer':f'/month/0/date/{ri}','referencePeriod':p}
   bases=[dict(r['currBase'],field='currBase')]+[dict(v,field=f'prevBase/{i}') for i,v in enumerate(r.get('prevBase') or [])]
   if len({v['baseDesc'] for v in bases})!=len(bases):raise ValueError('Duplicate CBS base')
   previous=r['currBase']['baseDesc']
   for base in bases:
    label=base['baseDesc'];code='level_'+hashlib.sha256(label.encode()).hexdigest()[:16]
    sid=o.series_id(code,'CPI 120010 / '+label,'M','index',{'index_code':'120010','base_label':label,'measure':'level','provider':'CBS'},convention='not_a_rate')
    o.add(sid,p,base['value'],dict(locator,baseLabel=label,jsonPointer=locator['jsonPointer']+'/'+base['field']+'/value'))
    if 'coeff' in base:
     code='coefficient_'+hashlib.sha256((previous+'->'+label).encode()).hexdigest()[:16]
     sid=o.series_id(code,'CPI coefficient '+previous+' -> '+label,'M','ratio',{'index_code':'120010','from_base':previous,'to_base':label,'measure':'chaining_coefficient'},convention='not_a_rate')
     o.add(sid,p,base['coeff'],dict(locator,jsonPointer=locator['jsonPointer']+'/'+base['field']+'/coeff'))
    previous=label
   for key in ['percent','percentYear']:
    sid=o.series_id(key,'CPI '+key,'M','percent',{'index_code':'120010','measure':key},convention='not_a_rate')
    o.add(sid,p,r[key],dict(locator,jsonPointer=locator['jsonPointer']+'/'+key))
 if len(rows)!=expected:raise ValueError('CBS item count mismatch')
 chronological=sorted(rows)
 for a,z in zip(chronological,chronological[1:]):
  y,m=map(int,a[:7].split('-'));next_period=f'{y+(m==12):04}-{m%12+1:02}-01'
  if z!=next_period:raise ValueError('Missing month in CBS snapshot')
 o.issue('CPI_PUBLICATION_TIMES_UNKNOWN',{'months':len(rows),'first':min(rows),'last':max(rows),'note':'Actual reference-month CPI and CBS-published rebased levels. This endpoint does not provide historical publication timestamps; retrospective replay only, with explicit reference months and captured/ingested asOf.'},'info')
