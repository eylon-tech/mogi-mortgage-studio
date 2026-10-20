import sys, unittest, copy, math
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'research/forecast'))
import backtest as b

def synthetic():
    start=b.month_id('2000-01'); months=range(start,start+300)
    codes=['target','MNT_RIB_BOI_D','ZC_TSB_ZND_01Y_MA','ZC_TSB_ZND_05Y_MA','ZC_TSB_ZND_10Y_MA','ZC_TSB_ZRD_01Y_MA','ZC_TSB_ZRD_05Y_MA','ZC_TSB_ZRD_10Y_MA','EXP_EXP_01Y_BI_MA','percentYear']
    return {c:{m:2+i/10+(m-start)/300+math.sin((m-start)/8)/2 for m in months} for i,c in enumerate(codes)}

class BacktestTests(unittest.TestCase):
    def test_month_round_trip(self):
        for m in ['1999-12','2000-01','2026-08']: self.assertEqual(b.month_name(b.month_id(m)),m)

    def test_unreleased_values_cannot_change_origin_features(self):
        s=synthetic(); origin=b.month_id('2020-01'); first=b.make_features(s,'target',origin)
        changed=copy.deepcopy(s)
        for code,values in changed.items():
            for m in values:
                if m>origin-(2 if code=='target' else 1): values[m]=9999
        self.assertEqual(first,b.make_features(changed,'target',origin))
        self.assertLessEqual(first[1]['maxAssumedAvailableMonth'],origin)

    def test_future_labels_and_scaler_rows_do_not_change_prediction(self):
        s=synthetic(); origin=b.month_id('2020-01')
        f={o:b.make_features(s,'target',o)[0] for o in range(b.month_id('2002-01'),b.month_id('2023-01'))}
        c=b.Candidate('ridge','all',120,10,1)
        first=b.fit_predict(c,f,s['target'],origin,6,2,48)
        altered=copy.deepcopy(f); y=copy.deepcopy(s['target'])
        for m in y:
            if m+2>origin:y[m]=9999
        for o in altered:
            if o+6+2>origin and o!=origin: altered[o]={k:9999 for k in altered[o]}
        self.assertEqual(first,b.fit_predict(c,altered,y,origin,6,2,48))
        self.assertLessEqual(b.month_id(first[1]['lastTrainingLabelAvailableMonth']),origin)

    def test_selection_uses_only_matured_labels_and_common_cohort(self):
        g={'a':{i:{'prediction':0} for i in range(100)},'b':{i:{'prediction':1} for i in range(10,100)}}
        y={i:0 if i<60 else 999 for i in range(120)}; p={'selectionWindowMonths':36,'minSelectionErrors':24}
        name,origins,table=b.choose(g,y,60,6,2,p)
        self.assertEqual(name,'a');self.assertEqual(origins[-1],52)
        self.assertTrue(all(i+8<=60 for i in origins));self.assertEqual(table[0]['n'],36)

    def test_no_interpolation_for_missing_month(self):
        s=synthetic();origin=b.month_id('2020-01');del s['percentYear'][origin-1]
        with self.assertRaises(KeyError): b.make_features(s,'target',origin)

    def test_attribution_sums_to_predicted_change(self):
        s=synthetic();origin=b.month_id('2020-01')
        f={o:b.make_features(s,'target',o)[0] for o in range(b.month_id('2002-01'),origin+1)}
        pred,_,parts=b.fit_predict(b.Candidate('ridge','all',120,10,.5),f,s['target'],origin,3,2,48)
        self.assertAlmostEqual(sum(v['contributionBp'] for v in parts),(pred-f[origin]['rate_level'])*100,places=9)

    def test_metrics_units_and_paired_bootstrap(self):
        rows=[{'prediction':4.1,'actual':4.2,'baseline':4.,'lower90':4.,'upper90':4.3} for _ in range(24)]
        m=b.metrics(rows);self.assertAlmostEqual(m['maeBp'],10);self.assertAlmostEqual(m['improvementPercent'],50)
        ci=b.paired_block_interval(rows,6,100,1);self.assertAlmostEqual(ci['lower95'],10);self.assertAlmostEqual(ci['upper95'],10)
        self.assertEqual(m['intervalCoveragePercent'],100)

    def test_locked_configuration_is_independent_of_holdout_outcomes(self):
        s=synthetic();p={'firstOrigin':'2002-01','holdoutOriginStart':'2018-01','holdoutOriginEnd':'2019-12','horizonsMonths':[1],
        'minTrainingRows':48,'minSelectionErrors':24,'selectionWindowMonths':36,'candidateFeatureSets':['ar'],'candidateWindows':[120],
        'candidateAlphas':[10],'candidateBlendWeights':[1.],'intervalNominalCoverage':.9,'bootstrapReplicates':10,'bootstrapSeed':1}
        first=b.experiment(s,'target',p,2,1)['horizons']['1'];changed=copy.deepcopy(s)
        for m in changed['target']:
            if m>=b.month_id('2018-02'):changed['target'][m]+=5
        second=b.experiment(changed,'target',p,2,1)['horizons']['1']
        for k in ['lockedCandidate','selectionLeaderboard','intervalCalibration']:self.assertEqual(first[k],second[k])
        self.assertEqual(first['holdout'][0]['prediction'],second['holdout'][0]['prediction'])
        self.assertNotEqual(first['holdoutMetrics']['maeBp'],second['holdoutMetrics']['maeBp'])

if __name__=='__main__':unittest.main()
