"""Export a pinned, public-data-only research snapshot for the deployed Mogi app.
The original backtest remains immutable. New forecasts reuse its locked configurations.
"""
import sys, json, hashlib
from pathlib import Path
from datetime import datetime, timezone
from backtest import load_dataset, monthly_series, make_features, fit_predict, candidates, month_id, month_name
root=Path(__file__).resolve().parents[2]
latest=json.loads((root/'research/forecast/latest.json').read_text())
raw=(root/latest['resultPath']).read_bytes()
assert hashlib.sha256(raw).hexdigest()==latest['resultSha256']
result=json.loads(raw);protocol=result['protocol'];data,manifest=load_dataset();series=monthly_series(data)
choices={c.name:c for c in candidates(protocol)}
now=datetime.now(timezone.utc)
items=[]
for name,target in result['targets'].items():
    code=protocol['targets'][name];features={};audits={}
    for origin in range(month_id(protocol['firstOrigin']),month_id(now.strftime('%Y-%m'))+1):
        try: features[origin],audits[origin]=make_features(series,code,origin,protocol['targetAvailabilityLagMonths'],protocol['macroAvailabilityLagMonths'])
        except KeyError: pass
    origin=max(features)
    for horizon,experiment in target['horizons'].items():
        h=int(horizon);prediction,audit,contributions=fit_predict(choices[experiment['lockedCandidate']],features,series[code],origin,h,protocol['targetAvailabilityLagMonths'],protocol['minTrainingRows'])
        radius=experiment['intervalCalibration']['radiusBp']/100
        items.append({'id':f'{name}-{h}','track':'fixed' if name=='fixed_unlinked' else 'indexed','horizon':h,'origin':month_name(origin),'targetMonth':month_name(origin+h),'baselineMonth':month_name(audits[origin]['lastTargetMonth']),'baseline':features[origin]['rate_level'],'prediction':prediction,'lower90':prediction-radius,'upper90':prediction+radius,'lockedCandidate':experiment['lockedCandidate'],'lockedAt':experiment['lockedAtOrigin'],'metrics':experiment['holdoutMetrics'],'sensitivityMetrics':result['lagSensitivity'][name]['horizons'][horizon]['holdoutMetrics'],'pairedImprovementInterval':experiment['pairedImprovementInterval'],'forecastAudit':audit,'featureAudit':audits[origin],'contributions':contributions,'holdout':[{'origin':r['origin'],'targetMonth':r['targetMonth'],'prediction':r['prediction'],'actual':r['actual'],'baseline':r['baseline']} for r in experiment['holdout']]})
output={'schemaVersion':1,'generatedAt':now.isoformat(),'datasetSha256':manifest['sha256'],'resultSha256':latest['resultSha256'],'protocolSha256':result['protocolSha256'],'pointInTimeVerified':False,'personalPricingEnabled':False,'applicationMode':'explicit_market_sensitivity_only','rateConvention':'effective_annual_percent','rateConventionEvidence':{'url':'https://boi.org.il/media/hc5dirbv/877.pdf','section':'9','sha256':hashlib.sha256((root/'research/forecast/evidence/boi-877.pdf').read_bytes()).hexdigest(),'note':'Supplemental verified convention; original backtest artifact is unchanged.'},'holdoutOriginStart':protocol['holdoutOriginStart'],'holdoutOriginEnd':protocol['holdoutOriginEnd'],'historyStart':min(t['firstTargetMonth'] for t in result['targets'].values()),'historyEnd':max(t['lastTargetMonth'] for t in result['targets'].values()),'targetLagMonths':protocol['targetAvailabilityLagMonths'],'macroLagMonths':protocol['macroAvailabilityLagMonths'],'bankLevelAssessment':result['bankLevelAssessment'],'forecasts':items}
p=Path(sys.argv[1]);p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(output,ensure_ascii=False,indent=2,allow_nan=False)+'\n')
print(json.dumps({'path':str(p),'forecasts':len(items),'origin':items[0]['origin'],'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}))
