import unittest,importlib.util,json,io
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('normalize',ROOT/'scripts/normalize.py');p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
MANIFEST=json.loads((ROOT/'data/manifest.json').read_text())
def source(key):return next(m for m in MANIFEST if m['id']==key)
class NormalizeTests(unittest.TestCase):
 def test_blank_zero_and_excel_error(self):
  self.assertEqual(p.number(None)[1],'missing');self.assertEqual(p.number('0')[:2],('0','present'))
  self.assertEqual(p.number(23,error=True)[1],'invalid');self.assertEqual(p.number('NaN')[1],'invalid')
 def test_numeric_precision_and_no_percent_rescaling(self):
  self.assertEqual(p.number('4.1234567890123456')[0],'4.1234567890123456')
  self.assertEqual(p.number('1E-8')[0],'0.00000001')
 def test_equator_matches_named_original_cell(self):
  m=source('boi_equator');out=p.Output(m);b=(ROOT/m['path']).read_bytes();p.equator(out,b)
  w=p.openpyxl.load_workbook(io.BytesIO(b),data_only=True)
  cell=next(x for x in out.rows if x['source_locator']['sheet']=='L01' and x['source_locator']['cell']=='D13')
  self.assertEqual(cell['value'],str(w['L01']['D13'].value));self.assertEqual(cell['period'],w['L01']['B13'].value+'-01')
  self.assertEqual(out.series[cell['series_id']]['dimensions']['track'],'fixed_unlinked')
  self.assertTrue(any(i['code']=='ROLLING_WINDOW' for i in out.issues))
 def test_equator_header_drift_rejected(self):
  m=source('boi_equator');w=p.openpyxl.load_workbook(io.BytesIO((ROOT/m['path']).read_bytes()));w['L01']['D12']='different product';b=io.BytesIO();w.save(b)
  with self.assertRaisesRegex(ValueError,'header'):p.equator(p.Output(m),b.getvalue())
 def test_forecast_calendar_and_index_period_not_mixed(self):
  m=source('boi_forecast451');o=p.Output(m);p.forecast(o,(ROOT/m['path']).read_bytes())
  self.assertEqual(len(o.series),6)
  for sid in o.series:
   n=361 if ':index_' in sid else 360
   counts={}
   for r in o.rows:
    if r['series_id']==sid:counts[r['period']]=counts.get(r['period'],0)+1
   self.assertTrue(all(v==n for v in counts.values()))
  self.assertTrue(all(s['value_class']=='market_model' for s in o.series.values()))
 def test_forecast_horizon_drift_rejected(self):
  m=source('boi_forecast451');w=p.openpyxl.load_workbook(io.BytesIO((ROOT/m['path']).read_bytes()));w.worksheets[0]['D5']=0;b=io.BytesIO();w.save(b)
  with self.assertRaisesRegex(ValueError,'horizon'):p.forecast(p.Output(m),b.getvalue())
 def test_legacy_prepayment_dates_and_blank_effective_date_preserved(self):
  m=source('boi_prepay_linked');o=p.Output(m);p.prepay(o,(ROOT/m['path']).read_bytes())
  row=next(r for r in o.rows if r['source_locator']=={'sheet':'RESULT_OLD','cell':'A174','reportingDate':'2002-10-31','effectiveCell':'H174'})
  self.assertIsNone(row['effective_from']);self.assertEqual(row['value'],'6.18');self.assertEqual(row['period'],'2002-10-31')
  self.assertEqual(o.series[row['series_id']]['rate_convention'],'source_unspecified')
  self.assertTrue(any(r['period'][8:] not in ('01','28','29','30','31') for r in o.rows))
 def test_sdmx_preserves_dimensions_unit_multiplier_and_null(self):
  o=p.Output({'id':'boi_test'});p.sdmx(o,b'SERIES_CODE,TIME_PERIOD,OBS_VALUE,FREQ,UNIT_MEASURE,UNIT_MULT,LTV\nX,2020-01,,M,ILS,3,L0\nX,2020-02,0,M,ILS,3,L0\n')
  self.assertEqual(o.rows[0]['status'],'missing');self.assertEqual(o.rows[1]['value'],'0');self.assertEqual(o.series['boi_test:X']['unit_multiplier'],3);self.assertEqual(o.series['boi_test:X']['dimensions']['LTV'],'L0')
 def test_sdmx_schema_drift_and_duplicate_rejected(self):
  with self.assertRaisesRegex(ValueError,'schema'):p.sdmx(p.Output({'id':'test'}),b'TIME,VALUE\n2020,1')
  b=b'SERIES_CODE,TIME_PERIOD,OBS_VALUE,FREQ,UNIT_MEASURE,UNIT_MULT\nX,2020-01,0,M,PT,0\nX,2020-01,1,M,PT,0\n'
  with self.assertRaisesRegex(ValueError,'Duplicate'):p.sdmx(p.Output({'id':'test'}),b)
if __name__=='__main__':unittest.main(verbosity=2)
