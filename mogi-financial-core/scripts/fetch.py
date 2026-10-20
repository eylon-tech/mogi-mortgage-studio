"""Fetch public BOI files with TLS verification; archive exact bytes by SHA-256."""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import subprocess, json, hashlib, tempfile
ROOT=Path(__file__).resolve().parents[1]
BASE='https://edge.boi.gov.il/FusionEdgeServer/sdmx/v2/data/dataflow/BOI.STATISTICS/'
SOURCES=[
 dict(id='boi_br',format='sdmx_csv',url=BASE+'BR/1.0/?format=csv'),
 dict(id='boi_mortgage',format='sdmx_csv',url=BASE+'BIR_MRTG_99/1.0/?format=csv'),
 dict(id='boi_zcm',format='sdmx_csv',url=BASE+'ZCM/1.0/?format=csv'),
 dict(id='boi_equator',format='xlsx',url='https://www.boi.org.il/boi_files/Pikuah/TamInt010.xls'),
 dict(id='boi_forecast451',format='xlsx',url='https://www.boi.org.il/boi_files/Statistics/Estimation%20of%20yields%20from%20government%20bonds.xlsx'),
 dict(id='boi_prepay_linked',format='xls',url='https://www.boi.org.il/boi_files/Pikuah/pribmash.xls'),
 dict(id='boi_prepay_unlinked',format='xls',url='https://www.boi.org.il/boi_files/Pikuah/mashfix.xls'),
]
def fetch(s):
 now=datetime.now(timezone.utc).isoformat()
 with tempfile.TemporaryDirectory() as tmp:
  out=Path(tmp)/'body';headers=Path(tmp)/'headers'
  p=subprocess.run(['curl','--fail','--location','--silent','--show-error','--max-time','120','--retry','2',s['url'],'-D',str(headers),'-o',str(out),'-w','%{http_code}'],capture_output=True,text=True)
  item=dict(s, fetchedAt=now,httpStatus=p.stdout)
  if p.returncode: return dict(item,status='failed',error=p.stderr[:500])
  b=out.read_bytes();sha=hashlib.sha256(b).hexdigest()
  path=ROOT/'data/raw'/sha
  if not path.exists(): path.write_bytes(b)
  return dict(item,status='downloaded',sha256=sha,bytes=len(b),path=str(path.relative_to(ROOT)),responseHeaders=headers.read_text())
if __name__=='__main__':
 with ThreadPoolExecutor(max_workers=3) as pool: items=list(pool.map(fetch,SOURCES))
 from fetch_cbs import fetch_cbs
 items.append(fetch_cbs())
 stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
 (ROOT/'data'/f'fetch-{stamp}.json').write_text(json.dumps(items,ensure_ascii=False,indent=2))
 (ROOT/'data/manifest.json').write_text(json.dumps(items,ensure_ascii=False,indent=2))
 for i in items: print(i['id'],i['status'],i.get('bytes'),i.get('error',''))
 if any(i['status']!='downloaded' for i in items): raise SystemExit(1)
