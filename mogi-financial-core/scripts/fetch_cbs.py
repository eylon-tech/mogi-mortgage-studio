"""Archive every HTTP response and a content-addressed manifest for the complete paginated release."""
from pathlib import Path
from datetime import datetime,timezone
import json,hashlib,subprocess,tempfile
from urllib.parse import urlencode
ROOT=Path(__file__).resolve().parents[1]
def fetch_cbs():
 pages=[];page=1;expected=None
 while True:
  url='https://api.cbs.gov.il/index/data/price?'+urlencode(dict(id=120010,format='json',download='false',startPeriod='01-1900',lang='he',coef='true',pagesize=1000,page=page))
  with tempfile.TemporaryDirectory() as tmp:
   body=Path(tmp)/'body';headers=Path(tmp)/'headers'
   subprocess.run(['curl','--fail','--location','--silent','--show-error','--max-time','60','--retry','2','--user-agent','MogiFinancialCore/0.2 (public statistical data)',url,'-D',str(headers),'-o',str(body)],check=True)
   b=body.read_bytes();a=json.loads(b);p=a['paging'];total=p['total_items']
   if expected is not None and total!=expected:raise ValueError('CBS changed during pagination; retry the entire snapshot')
   expected=total
   if p['current_page']!=page:raise ValueError('CBS did not return requested page')
   sha=hashlib.sha256(b).hexdigest();relative='data/raw/'+sha;(ROOT/relative).write_bytes(b)
   pages.append(dict(page=page,path=relative,sha256=sha,url=url,headers=headers.read_text(),fetchedAt=datetime.now(timezone.utc).isoformat()))
   if page==p['last_page']:break
   page+=1
   if page>100:raise ValueError('Unexpected CBS pagination volume')
 snapshot={'type':'cbs_price_snapshot','indexCode':120010,'expectedItems':expected,'pages':pages}
 b=json.dumps(snapshot,ensure_ascii=False,separators=(',',':')).encode();sha=hashlib.sha256(b).hexdigest();relative='data/raw/'+sha;(ROOT/relative).write_bytes(b)
 return dict(id='cbs_cpi',provider='Israel Central Bureau of Statistics',format='cbs_price_snapshot',url=pages[0]['url'],status='downloaded',httpStatus='200',sha256=sha,bytes=len(b),path=relative,fetchedAt=pages[-1]['fetchedAt'],responseHeaders='Composite snapshot; original HTTP headers and exact response hashes retained per page.')
if __name__=='__main__':
 item=fetch_cbs();manifest=json.loads((ROOT/'data/manifest.json').read_text());manifest=[m for m in manifest if m['id']!='cbs_cpi']+[item]
 (ROOT/'data/manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2));stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
 (ROOT/'data'/f'fetch-{stamp}.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2));print(item['id'],item['sha256'])
