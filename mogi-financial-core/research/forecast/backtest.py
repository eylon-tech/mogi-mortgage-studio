"""Auditable, direct multi-horizon forecasting. No random train/test split.

Rates are percentages here (4.5 means 4.5%). MAE is multiplied by 100 for bp.
This subsystem intentionally cannot call the optimizer or modify customer rates.
"""
from __future__ import annotations
from dataclasses import dataclass, asdict
from pathlib import Path
from collections import defaultdict
import hashlib, json, math
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent

def month_id(value):
    y, m = map(int, value[:7].split('-'))
    if not 1 <= m <= 12: raise ValueError('Invalid month')
    return y * 12 + m - 1

def month_name(value):
    return f'{value // 12:04}-{value % 12 + 1:02}'

def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode()).hexdigest()

def load_dataset():
    manifest = json.loads((HERE / 'dataset.json').read_text())
    raw = (ROOT / manifest['path']).read_bytes()
    if hashlib.sha256(raw).hexdigest() != manifest['sha256']: raise ValueError('Dataset checksum mismatch')
    return json.loads(raw), manifest

def monthly_series(dataset):
    metadata = {s['id']: s for s in dataset['series']}
    buckets = defaultdict(lambda: defaultdict(list))
    seen = set()
    for row in dataset['observations']:
        key = row['series_id'], row['period']
        if key in seen: raise ValueError('Duplicate source observation')
        seen.add(key)
        if row['status'] != 'present' or row['value'] is None: continue
        value = float(row['value'])
        if not math.isfinite(value): raise ValueError('Nonfinite source value')
        s = metadata[row['series_id']]
        if s['unit_multiplier'] != 0: raise ValueError('Unconverted source multiplier')
        buckets[s['source_code']][month_id(row['period'])].append(value)
    # Daily policy rate uses an unweighted calendar-day average of published daily rows.
    # Monthly series must have exactly one value. Missing months are never interpolated.
    by_code = {s['source_code']: s for s in dataset['series']}
    result = {}
    for code, months in buckets.items():
        result[code] = {}
        for m, values in months.items():
            if by_code[code]['frequency'] != 'D' and len(values) != 1: raise ValueError('Duplicate monthly value')
            result[code][m] = float(np.mean(values))
    return result

GROUPS = {
    'ar': ['rate_level','rate_change_1','rate_change_3','rate_change_6','rate_change_12'],
    'policy': ['policy_level','policy_change_1','policy_change_3','policy_change_12','rate_policy_gap'],
    'curve': ['nominal5_gap','real5_gap','nominal_slope','real_slope','nominal5_change_1','nominal5_change_3','real5_change_1','real5_change_3','inflation_expected','inflation_expected_change_3'],
    'inflation': ['cpi_yoy','cpi_yoy_change_3','policy_less_cpi']
}

def feature_names(group):
    groups = {'ar':['ar'], 'policy':['ar','policy'], 'curve':['ar','curve'], 'all':['ar','policy','curve','inflation']}[group]
    return [name for g in groups for name in GROUPS[g]]

def make_features(series, target_code, origin, target_lag=2, macro_lag=1):
    if min(target_lag,macro_lag) < 1: raise ValueError('Research publication lags must be positive')
    y, t, m = series[target_code], origin-target_lag, origin-macro_lag
    references = []
    def read(code, period):
        value = series[code][period]
        available = period + (target_lag if code == target_code else macro_lag)
        if available > origin: raise ValueError('Future feature')
        references.append((code,period,available))
        return value
    last = read(target_code,t)
    f = {'rate_level': last}
    for k in [1,3,6,12]: f[f'rate_change_{k}'] = last-read(target_code,t-k)
    pc = 'MNT_RIB_BOI_D'; policy = read(pc,m)
    f.update(policy_level=policy,rate_policy_gap=last-policy)
    for k in [1,3,12]: f[f'policy_change_{k}'] = policy-read(pc,m-k)
    n5, r5 = 'ZC_TSB_ZND_05Y_MA', 'ZC_TSB_ZRD_05Y_MA'
    nv, rv = read(n5,m),read(r5,m)
    f.update(nominal5_gap=nv-last,real5_gap=rv-last,
             nominal_slope=read('ZC_TSB_ZND_10Y_MA',m)-read('ZC_TSB_ZND_01Y_MA',m),
             real_slope=read('ZC_TSB_ZRD_10Y_MA',m)-read('ZC_TSB_ZRD_01Y_MA',m))
    for k in [1,3]:
        f[f'nominal5_change_{k}'] = nv-read(n5,m-k)
        f[f'real5_change_{k}'] = rv-read(r5,m-k)
    ec = 'EXP_EXP_01Y_BI_MA'; cv = read('percentYear',m)
    f.update(inflation_expected=read(ec,m),inflation_expected_change_3=read(ec,m)-read(ec,m-3),
             cpi_yoy=cv,cpi_yoy_change_3=cv-read('percentYear',m-3),policy_less_cpi=policy-cv)
    if not all(math.isfinite(v) for v in f.values()): raise ValueError('Nonfinite feature')
    return f, {'origin':origin,'lastTargetMonth':t,'lastMacroMonth':m,'maxAssumedAvailableMonth':max(x[2] for x in references),
               'references':[{'code':c,'period':month_name(p),'assumedAvailableMonth':month_name(a)} for c,p,a in sorted(set(references))]}

@dataclass(frozen=True)
class Candidate:
    method: str
    group: str = 'ar'
    window: int | None = None
    alpha: float = 1.0
    blend: float = 1.0
    @property
    def name(self):
        if self.method != 'ridge': return self.method
        return f'ridge/{self.group}/w{self.window or "all"}/a{self.alpha:g}/blend{self.blend:g}'

def candidates(protocol):
    result = [Candidate('persistence'),Candidate('damped_momentum')]
    for group in protocol['candidateFeatureSets']:
        for window in protocol['candidateWindows']:
            for alpha in protocol['candidateAlphas']:
                for blend in protocol['candidateBlendWeights']:
                    result.append(Candidate('ridge',group,window,alpha,blend))
    return result

def fit_predict(candidate, features, outcomes, origin, horizon, target_lag, min_rows):
    """Returns None if history is insufficient; never drops unavailable labels into training."""
    train = sorted(o for o in features if o < origin and o+horizon+target_lag <= origin and o+horizon in outcomes)
    if candidate.window is not None: train = [o for o in train if o >= origin-candidate.window]
    if len(train) < min_rows: return None
    f = features[origin]; base = f['rate_level']
    audit = {'trainingRows':len(train),'lastTrainingOrigin':month_name(train[-1]),
             'lastTrainingTargetMonth':month_name(train[-1]+horizon),
             'lastTrainingLabelAvailableMonth':month_name(train[-1]+horizon+target_lag)}
    if candidate.method == 'persistence': return base, audit, []
    if candidate.method == 'damped_momentum': return base+0.5*f['rate_change_3']*(horizon+target_lag)/3, audit, []
    names = feature_names(candidate.group)
    X = np.array([[features[o][n] for n in names] for o in train])
    delta = np.array([outcomes[o+horizon]-features[o]['rate_level'] for o in train])
    mean = X.mean(axis=0); scale = X.std(axis=0); scale[scale<1e-12] = 1
    Z = (X-mean)/scale; center = float(delta.mean())
    beta = np.linalg.solve(Z.T @ Z+candidate.alpha*np.eye(len(names)), Z.T @ (delta-center))
    z = (np.array([f[n] for n in names])-mean)/scale
    contributions = candidate.blend*z*beta
    pred = base+candidate.blend*center+float(contributions.sum())
    if not math.isfinite(pred): raise ValueError('Nonfinite prediction')
    explanation = [{'feature':n,'contributionBp':float(v*100)} for n,v in zip(names,contributions)]
    explanation.append({'feature':'training_intercept','contributionBp':candidate.blend*center*100})
    audit['scalerFittedThroughOrigin'] = month_name(train[-1])
    return pred,audit,explanation

def predict_grid(series,code,protocol,target_lag,macro_lag):
    start,end = month_id(protocol['firstOrigin']),month_id(protocol['holdoutOriginEnd'])
    feats,audits,skipped = {},{},[]
    for o in range(start,end+1):
        try: feats[o],audits[o] = make_features(series,code,o,target_lag,macro_lag)
        except KeyError as e: skipped.append({'origin':month_name(o),'missingKey':str(e)})
    grid = {}; choices=candidates(protocol)
    for h in protocol['horizonsMonths']:
        grid[h] = {c.name:{} for c in choices}
        for o in sorted(feats):
            for c in choices:
                p = fit_predict(c,feats,series[code],o,h,target_lag,protocol['minTrainingRows'])
                if p is not None: grid[h][c.name][o]={'prediction':p[0],'audit':p[1],'contributions':p[2]}
    return feats,audits,grid,skipped

def choose(grid,outcomes,at,horizon,target_lag,protocol):
    # Common-origin comparison: a candidate cannot win by quietly skipping hard dates.
    common = set.intersection(*(set(v) for v in grid.values()))
    eligible = sorted(o for o in common if o < at and o+horizon+target_lag <= at and o+horizon in outcomes)
    eligible = eligible[-protocol['selectionWindowMonths']:]
    if len(eligible) < protocol['minSelectionErrors']: return None
    leaderboard = sorted([{'candidate':name,'maeBp':float(np.mean([abs(points[o]['prediction']-outcomes[o+horizon])*100 for o in eligible])),'n':len(eligible)} for name,points in grid.items()],key=lambda r:(r['maeBp'],r['candidate']))
    return leaderboard[0]['candidate'],eligible,leaderboard

def metrics(rows):
    if not rows: return {'n':0}
    e=np.array([r['prediction']-r['actual'] for r in rows]); ae=abs(e)*100
    b=np.array([r['baseline']-r['actual'] for r in rows]); ba=abs(b)*100
    changing=[r for r in rows if abs(r['actual']-r['baseline'])>=0.01]
    covered=[r for r in rows if r.get('lower90') is not None]
    return {'n':len(rows),'maeBp':float(ae.mean()),'rmseBp':float(np.sqrt(np.mean(e*e))*100),
            'biasBp':float(e.mean()*100),'medianAbsoluteErrorBp':float(np.median(ae)),
            'p90AbsoluteErrorBp':float(np.quantile(ae,.9)),'baselineMaeBp':float(ba.mean()),
            'improvementPercent':float((1-ae.mean()/ba.mean())*100) if ba.mean()>0 else None,
            'within10BpPercent':float(np.mean(ae<=10)*100),'within25BpPercent':float(np.mean(ae<=25)*100),
            'directionAccuracyPercent':float(np.mean([np.sign(r['prediction']-r['baseline'])==np.sign(r['actual']-r['baseline']) for r in changing])*100) if changing else None,
            'directionSampleSize':len(changing),
            'intervalCoveragePercent':float(np.mean([r['lower90']<=r['actual']<=r['upper90'] for r in covered])*100) if covered else None,
            'meanIntervalWidthBp':float(np.mean([(r['upper90']-r['lower90'])*100 for r in covered])) if covered else None}

def paired_block_interval(rows,block,replicates,seed):
    # Circular moving-block bootstrap, paired by origin; overlapping horizons are not IID.
    values=np.array([(abs(r['baseline']-r['actual'])-abs(r['prediction']-r['actual']))*100 for r in rows])
    if len(values)<block: return None
    rng=np.random.default_rng(seed); estimates=[]
    for _ in range(replicates):
        starts=rng.integers(0,len(values),size=math.ceil(len(values)/block))
        idx=np.concatenate([(s+np.arange(block))%len(values) for s in starts])[:len(values)]
        estimates.append(float(values[idx].mean()))
    lo,hi=np.quantile(estimates,[.025,.975])
    return {'quantity':'baseline_MAE_minus_model_MAE_bp','mean':float(values.mean()),'lower95':float(lo),'upper95':float(hi),'blockMonths':block,'replicates':replicates,'smallSampleWarning':len(values)<60}

def experiment(series,code,protocol,target_lag,macro_lag):
    feats,audits,grid,skipped=predict_grid(series,code,protocol,target_lag,macro_lag)
    start,end=month_id(protocol['holdoutOriginStart']),month_id(protocol['holdoutOriginEnd'])
    out={}; outcomes=series[code]
    for h,g in grid.items():
        selection=choose(g,outcomes,start,h,target_lag,protocol)
        if selection is None: raise ValueError('Insufficient pre-holdout selection history')
        locked,eligible,leaderboard=selection
        development=[]
        for o in sorted(feats):
            if o>=start or o+h not in outcomes: continue
            picked=choose(g,outcomes,o,h,target_lag,protocol)
            if picked is None or o not in g[picked[0]]: continue
            name,previous,_=picked
            p=g[name][o]
            development.append({'origin':month_name(o),'targetMonth':month_name(o+h),'candidate':name,'prediction':p['prediction'],'actual':outcomes[o+h],'baseline':feats[o]['rate_level'],
                                'lastSelectionLabelAvailableMonth':month_name(previous[-1]+h+target_lag),**p['audit']})
        # Calibrate against genuinely sequential model-selection errors, before lock, not
        # the winning candidate's in-sample or same-selection residuals.
        cal=[r for r in development if month_id(r['targetMonth'])+target_lag<=start][-36:]
        if len(cal)<protocol['minSelectionErrors']: raise ValueError('Insufficient interval calibration history')
        residuals=sorted(abs(r['actual']-r['prediction']) for r in cal)
        q=min(len(residuals)-1,math.ceil((len(residuals)+1)*protocol['intervalNominalCoverage'])-1)
        radius=residuals[q]
        holdout=[]
        for o in range(start,end+1):
            if o not in g[locked] or o+h not in outcomes: raise ValueError('Missing held-out origin or target')
            p=g[locked][o]
            holdout.append({'origin':month_name(o),'targetMonth':month_name(o+h),'candidate':locked,'prediction':p['prediction'],'actual':outcomes[o+h],
                            'baseline':feats[o]['rate_level'],'lower90':p['prediction']-radius,'upper90':p['prediction']+radius,
                            'errorBp':(p['prediction']-outcomes[o+h])*100,**p['audit'],
                            'featureAudit':audits[o],'contributions':p['contributions']})
        ci=paired_block_interval(holdout,max(6,h+target_lag),protocol['bootstrapReplicates'],protocol['bootstrapSeed'])
        summary=metrics(holdout)
        out[str(h)]={'lockedCandidate':locked,'lockedAtOrigin':month_name(start),
                    'selectionOriginRange':[month_name(eligible[0]),month_name(eligible[-1])],
                    'lastSelectionLabelAvailableMonth':month_name(eligible[-1]+h+target_lag),
                    'candidateCount':len(g),'selectionLeaderboard':leaderboard,
                    'intervalCalibration':{'n':len(cal),'radiusBp':radius*100,'latestLabelAvailableMonth':month_name(month_id(cal[-1]['targetMonth'])+target_lag),'method':'pre-holdout sequential absolute residual quantile; coverage not guaranteed under regime shifts'},
                    'holdoutMetrics':summary,'pairedImprovementInterval':ci,
                    'beatsBaselineWithPositiveLowerBound':ci['lower95']>0,
                    'deploymentEligible':False,
                    'deploymentBlockers':['historical_vintages_not_verified','aggregate_not_customer_pricing','single_24_origin_holdout'],
                    'developmentMetrics':metrics(development),'development':development,'holdout':holdout,
                    'holdoutByTargetYear':{y:metrics([r for r in holdout if r['targetMonth'][:4]==y]) for y in sorted({r['targetMonth'][:4] for r in holdout})},
                    'developmentByTargetYear':{y:metrics([r for r in development if r['targetMonth'][:4]==y]) for y in sorted({r['targetMonth'][:4] for r in development})}}
    return {'targetsObserved':len(outcomes),'firstTargetMonth':month_name(min(outcomes)),'lastTargetMonth':month_name(max(outcomes)),
            'targetLagMonths':target_lag,'macroLagMonths':macro_lag,'skippedFeatureOrigins':skipped,'horizons':out}

def main():
    data,manifest=load_dataset(); protocol=json.loads((HERE/'protocol.json').read_text()); series=monthly_series(data)
    sources={s['source_code']:s for s in data['series']}
    result={'protocol':protocol,'protocolSha256':digest(protocol),'datasetSha256':manifest['sha256'],
            'codeSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'numpyVersion':np.__version__,
            'mode':'latest_vintage_research_with_assumed_lags','pointInTimeVerified':False,
            'personalPricingEnabled':False,'optimizerConnected':False,'targets':{},'lagSensitivity':{},
            'bankLevelAssessment':{'status':'insufficient_history_for_this_protocol','monthsAvailable':25,'banks':len({s['dimensions']['bank_name'] for s in data['equatorCoverage']}),
                                   'reason':'The 48-row training minimum, 24-error validation and 24-origin holdout cannot be met. No synthetic earlier bank history is inserted.'},
            'interpretation':'Predictive relationships, not causal effects. Rate conventions remain source_unspecified for these BIR targets; estimates cannot be passed as nominal or effective cashflow inputs without verified metadata.'}
    for name,code in protocol['targets'].items():
        s=sources[code]; d=s['dimensions']
        if any(d[k]!=v for k,v in {'BS_ITEM':'A2C','IR_FV_TYPE':'F','DATA_TYPE':'R','PTI':'P01','BIR_COVERAGE':'N'}.items()): raise ValueError('Target metadata drift')
        print(f'Running {name}: primary',flush=True)
        result['targets'][name]={'sourceSeries':s,**experiment(series,code,protocol,protocol['targetAvailabilityLagMonths'],protocol['macroAvailabilityLagMonths'])}
        print(f'Running {name}: delayed-publication sensitivity',flush=True)
        lag=protocol['sensitivityLags']
        result['lagSensitivity'][name]=experiment(series,code,protocol,lag['target'],lag['macro'])
    out=HERE/'runs'/digest({'protocol':result['protocolSha256'],'dataset':manifest['sha256'],'code':result['codeSha256']})
    out.mkdir(parents=True,exist_ok=True)
    body=json.dumps(result,ensure_ascii=False,indent=2,allow_nan=False)
    result_path=out/'result.json'
    if result_path.exists() and result_path.read_text()!=body: raise ValueError('Non-reproducible rerun')
    result_path.write_text(body)
    (HERE/'latest.json').write_text(json.dumps({'resultPath':str(result_path.relative_to(ROOT)),'resultSha256':hashlib.sha256(body.encode()).hexdigest()},indent=2))
    print(json.dumps({'path':str(result_path),'scores':{name:{h:obj['holdoutMetrics'] for h,obj in target['horizons'].items()} for name,target in result['targets'].items()}},ensure_ascii=False,indent=2))

if __name__=='__main__': main()
