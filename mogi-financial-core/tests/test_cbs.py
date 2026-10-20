import unittest,sys,json,hashlib,tempfile
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'scripts'))
from normalize import Output
import cbs_parser
M=next(m for m in json.loads((ROOT/'data/manifest.json').read_text()) if m['id']=='cbs_cpi')

class CbsTests(unittest.TestCase):
 def test_real_common_base_is_continuous_without_chaining_rounded_changes(self):
  o=Output(M);cbs_parser.parse_cbs(o,(ROOT/M['path']).read_bytes());sid=next(s['id'] for s in o.series.values() if s['dimensions'].get('base_label')=='1951 ספטמבר');rows=[r for r in o.rows if r['series_id']==sid]
  self.assertEqual(len(rows),900);self.assertEqual(min(r['period'] for r in rows),'1951-09-01');self.assertTrue(all(r['status']=='present' for r in rows))
  from decimal import Decimal
  snapshot=json.loads((ROOT/M['path']).read_bytes());data=json.loads((ROOT/snapshot['pages'][0]['path']).read_bytes(),parse_float=Decimal)
  for period in ['1951-09-01','2024-12-01','2025-01-01','2026-08-01']:
   row=next(r for r in rows if r['period']==period);value=data
   for key in row['source_locator']['jsonPointer'].strip('/').split('/'):value=value[int(key)] if isinstance(value,list) else value[key]
   self.assertEqual(Decimal(row['value']),Decimal(str(value)))
 def test_modified_raw_page_is_rejected(self):
  snapshot=json.loads((ROOT/M['path']).read_bytes());snapshot['pages'][0]['sha256']='0'*64
  with self.assertRaisesRegex(ValueError,'checksum'):cbs_parser.parse_cbs(Output(M),json.dumps(snapshot).encode())
 def test_incomplete_pagination_is_rejected(self):
  snapshot=json.loads((ROOT/M['path']).read_bytes());snapshot['expectedItems']+=1
  with self.assertRaisesRegex(ValueError,'pagination'):cbs_parser.parse_cbs(Output(M),json.dumps(snapshot).encode())
 def test_duplicate_reference_month_is_rejected(self):
  snapshot=json.loads((ROOT/M['path']).read_bytes());data=json.loads((ROOT/snapshot['pages'][0]['path']).read_bytes());data['month'][0]['date'][1]=data['month'][0]['date'][0]
  raw=json.dumps(data).encode()
  with tempfile.TemporaryDirectory() as td:
   Path(td,'page.json').write_bytes(raw);snapshot['pages'][0].update(path='page.json',sha256=hashlib.sha256(raw).hexdigest())
   with patch.object(cbs_parser,'ROOT',Path(td)):
    with self.assertRaisesRegex(ValueError,'Duplicate CBS reference'):cbs_parser.parse_cbs(Output(M),json.dumps(snapshot).encode())

if __name__=='__main__':unittest.main()
