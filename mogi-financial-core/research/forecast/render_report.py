"""Standalone, offline research report and machine-readable prediction ledger."""
from pathlib import Path
import json,csv,hashlib,html,base64,io
ROOT=Path(__file__).resolve().parents[2];HERE=Path(__file__).resolve().parent

def main():
 import matplotlib
 matplotlib.use('Agg')
 import matplotlib.pyplot as plt
 import matplotlib.dates as md
 from datetime import datetime
 pointer=json.loads((HERE/'latest.json').read_text());raw=(ROOT/pointer['resultPath']).read_bytes()
 if hashlib.sha256(raw).hexdigest()!=pointer['resultSha256']:raise ValueError('Report checksum mismatch')
 r=json.loads(raw);out=ROOT/'reports';out.mkdir(exist_ok=True)
 labels={'fixed_unlinked':'קבועה לא־צמודה','fixed_linked':'קבועה צמודה'}
 charts={};ledger=[];rows=[];sensitivity=[];details=[]
 plt.rcParams.update({'font.family':'DejaVu Sans','axes.spines.top':False,'axes.spines.right':False,'axes.edgecolor':'#c9d3d6','axes.labelcolor':'#142344','xtick.color':'#607080','ytick.color':'#607080','svg.fonttype':'none'})
 for name,target in r['targets'].items():
  for h,v in target['horizons'].items():
   m=v['holdoutMetrics'];s=r['lagSensitivity'][name]['horizons'][h]['holdoutMetrics'];ci=v['pairedImprovementInterval']
   cls='positive' if m['improvementPercent']>0 else 'negative'
   rows.append(f'<tr><td>{labels[name]}</td><td>{h}</td><td>{m["maeBp"]:.2f}</td><td>{m["baselineMaeBp"]:.2f}</td><td class="{cls}">{m["improvementPercent"]:+.1f}%</td><td dir="ltr">{ci["lower95"]:.2f} … {ci["upper95"]:.2f}</td></tr>')
   sensitivity.append(f'<tr><td>{labels[name]}</td><td>{h}</td><td>{s["maeBp"]:.2f}</td><td>{s["baselineMaeBp"]:.2f}</td><td>{s["improvementPercent"]:+.1f}%</td></tr>')
   for split in ['development','holdout']:
    for point in v[split]:ledger.append({'target':name,'horizon_months':h,'split':split,**{k:point[k] for k in ['origin','targetMonth','candidate','prediction','actual','baseline','lastTrainingLabelAvailableMonth']},'error_bp':(point['prediction']-point['actual'])*100,'lower90':point.get('lower90'),'upper90':point.get('upper90')})
   key=name+'_'+h
   for split in ['holdout','development']:
    points=v[split];dates=[datetime.strptime(p['targetMonth'],'%Y-%m') for p in points]
    fig,ax=plt.subplots(figsize=(10,3.6),layout='constrained');fig.set_facecolor('white')
    ax.plot(dates,[p['actual'] for p in points],color='#10264a',lw=2.5,label='Observed')
    ax.plot(dates,[p['prediction'] for p in points],color='#06a6b1',lw=2,label='Forecast')
    ax.plot(dates,[p['baseline'] for p in points],color='#be6547',lw=1.5,ls='--',label='Last published rate baseline')
    ax.set_ylabel('Annual rate (%) · source units');ax.grid(axis='y',alpha=.2);ax.legend(frameon=False,loc='best',fontsize=8)
    ax.xaxis.set_major_formatter(md.DateFormatter('%Y-%m'));ax.xaxis.set_major_locator(md.AutoDateLocator(minticks=4,maxticks=7))
    buffer=io.BytesIO();fig.savefig(buffer,format='svg');plt.close(fig)
    charts[key+'_'+split]='data:image/svg+xml;base64,'+base64.b64encode(buffer.getvalue()).decode()
   group=[]
   for year,stats in v['developmentByTargetYear'].items():group.append(f'<tr><td>{year}</td><td>{stats["n"]}</td><td>{stats["maeBp"]:.2f}</td><td>{stats["baselineMaeBp"]:.2f}</td></tr>')
   details.append(f'<details><summary>{labels[name]} · אופק {h} חודשים — פירוט וביצועים בתקופות המוקדמות</summary><p>המודל שננעל: <code>{html.escape(v["lockedCandidate"])}</code>. כיוונון: {v["selectionOriginRange"][0]} עד {v["selectionOriginRange"][1]}, רק תוצאות שהיו זמינות לפי הנחת ההשהיה במרץ 2024.</p><p>טווח החיזוי הניסויי מכוון לכיסוי של 90%; במבחן כיסה {m["intervalCoveragePercent"]:.0f}% מהתוצאות, ברוחב ממוצע של {m["meanIntervalWidthBp"]:.1f} נקודות בסיס. טווח רחב אינו מעיד על חיזוי נקודתי טוב.</p><table><thead><tr><th>שנת התוצאה</th><th>תצפיות</th><th>MAE מודל</th><th>MAE בסיס</th></tr></thead><tbody>{"".join(group)}</tbody></table></details>')
 with (out/'rate-predictions.csv').open('w',newline='',encoding='utf-8-sig') as f:
  writer=csv.DictWriter(f,fieldnames=list(ledger[0]));writer.writeheader();writer.writerows(ledger)
 data_json=json.dumps(charts).replace('<','\\u003c')
 report='''<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mogi — מעבדת חיזוי ריבית</title>
 <style>*{box-sizing:border-box}body{margin:0;background:#f5f8f8;color:#142344;font-family:Arial,sans-serif;line-height:1.7}main{max-width:1140px;margin:auto;padding:44px 28px 70px}header{border-bottom:3px solid #08a5af;padding-bottom:24px}small,.muted{color:#5b6b7d}h1{font-size:40px;line-height:1.2;letter-spacing:-1px;margin:12px 0}h2{font-size:25px;margin:32px 0 10px}p{max-width:950px}b{font-weight:700}.tag{display:inline-block;padding:4px 12px;border-radius:20px;background:#e0f4f2;color:#145e66;font-size:14px}table{border-collapse:collapse;width:100%;background:white;font-variant-numeric:tabular-nums}th,td{text-align:right;border-bottom:1px solid #dce5e7;padding:12px 14px}th{background:#eaf0f2;font-size:14px}.positive{color:#166b50}.negative{color:#a0432d}.tablewrap{overflow-x:auto}section{margin-top:24px}.note{border-right:4px solid #be6547;padding:8px 20px;background:#fffaf5}.chart{background:white;padding:12px 16px;margin-top:20px}.chart img{width:100%;display:block}select{font:inherit;padding:7px 12px;border:1px solid #c0d1d6;border-radius:8px;background:white;margin:5px}label{margin-left:14px}details{border-top:1px solid #cbd6d9;padding:14px 0}summary{cursor:pointer;font-weight:bold}code{direction:ltr;unicode-bidi:embed;overflow-wrap:anywhere;font-size:13px}footer{margin-top:35px;font-size:13px;overflow-wrap:anywhere}a{color:#006c79}@media(max-width:650px){main{padding:25px 16px}h1{font-size:31px}td,th{padding:9px;font-size:13px}}</style>
 <main><header><span class="tag">MOGI · מחקר מקומי · 08.10.2026</span><h1>לחזור בזמן. לחזות. למדוד.</h1><p>מנוע בדיקה היסטורית לריבית המשכנתאות הממוצעת בשוק. 74 תצורות נבחנו בכל מסלול ואופק, מול תחזית בסיס פשוטה. <b>התוצאה מעורבת: יש שיפור בחלק מהמקרים וכישלון באחרים.</b></p></header>
 <section><h2>מה המבחן הראה</h2><p>בכל שורה: 24 מועדי חיזוי שנשמרו למבחן, מרץ 2024 עד פברואר 2026. החיזוי הוא לממוצע החודשי בעוד 1, 3 או 6 חודשים ממועד ההחלטה; הריבית האחרונה הידועה לפי ההנחה היא מחודשיים קודם לכן. נקודת בסיס אחת היא 0.01 נקודת אחוז.</p><div class="tablewrap"><table><thead><tr><th>מסלול</th><th>אופק בחודשים</th><th>שגיאת מודל · bp</th><th>שגיאת בסיס · bp</th><th>שיפור ב־MAE</th><th>טווח 95% להפרש השגיאות · bp</th></tr></thead><tbody>__ROWS__</tbody></table></div><p class="muted">טווח ההפרש חושב בדגימת בלוקים חודשיים; ערך חיובי תומך במודל, טווח שחוצה אפס אינו מכריע. זהו מדגם קטן עם אופקים חופפים ושש השוואות, ללא תיקון לריבוי השוואות. אין להסיק יתרון יציב מטווח חיובי בודד.</p></section>
 <section class="chart"><label>מסלול <select id="track"><option value="fixed_unlinked">קבועה לא־צמודה</option><option value="fixed_linked">קבועה צמודה</option></select></label><label>אופק <select id="horizon"><option>1</option><option>3</option><option>6</option></select></label><label>תקופה <select id="split"><option value="holdout">מבחן שנשמר בצד</option><option value="development">בדיקה מתגלגלת לפני המבחן</option></select></label><img id="plot" alt="ריבית בפועל מול תחזית המודל ותחזית הבסיס"><p class="muted">ציר הזמן מציג את חודש התוצאה. תחזית המודל נוצרה לפניו לפי האופק שנבחר. הקו הכתום הוא הריבית האחרונה שהותר למודל לראות. טווחי החיזוי נמצאים בפירוט ובקובץ הנתונים.</p></section>
 <section><h2>איך נמנעה הצצה לעתיד</h2><p>האימון משתמש רק בדוגמאות שתוצאתן כבר הייתה זמינה לפי הנחות הפרסום באותו חודש. נרמול המשתנים נעשה בתוך כל חלון אימון. בחרנו בין מודל ריבית קודמת, מגמה מרוסנת ומודלי Ridge עם משתני עבר, ריבית בנק ישראל, עקום אג״ח ואינפלציה; נבדקו חלונות של 60 ו־120 חודשים או כל העבר, שלוש עוצמות רגולריזציה ושתי עוצמות התאמה לתחזית הבסיס.</p><p>לפני המבחן נערכה בחירה מתגלגלת לפי עד 36 שגיאות קודמות שהתממשו. במרץ 2024 ננעלו תצורת המודל וטווח אי־הוודאות לכל מסלול ואופק. בתוך המבחן המקדמים מתאמנים מחדש מדי חודש רק על מידע שהותר עד אז; תוצאות המבחן אינן בוחרות תצורה חדשה. אין פיצול אקראי ואין השלמת חודשים חסרים.</p></section>
 <section class="note"><b>מגבלת הנתונים נשמרת בתוך המערכת</b><p>זו בדיקה היסטורית על גרסאות הנתונים שהורדו כיום. אין בידינו ארכיון מלא של כל גרסאות הפרסום המקוריות; השהיה של חודשיים לנתוני המשכנתאות וחודש לנתוני המאקרו היא הנחת מחקר מפורשת. תיקוני עבר עשויים להשפיע על התוצאות גם בלי דליפה בקוד. מצב <code>pointInTimeVerified=false</code> נשמר בכל ריצה.</p><p>המשתנים מתארים קשר חיזויי, לא סיבתיות. ממוצע שוק מושפע גם משינוי בהרכב הלווים והעסקאות; הוא אינו הצעה ללקוח מסוים. מוסכמת הריבית של סדרות BIR עדיין מסומנת כלא מאומתת, ולכן הפלט אינו מוזן אוטומטית למנוע התזרים.</p></section>
 <section><h2>בדיקת רגישות למועד הפרסום</h2><p>אותו פרוטוקול נבדק גם עם השהיה של שלושה חודשים לנתוני משכנתאות ושניים למאקרו. הבדיקה הוגדרה מראש ואינה משמשת לבחירת התוצאה המחמיאה יותר. שינוי ההשהיה משנה חלק מהמודלים ומהתוצאות, ולכן עדיין אין בסיס לשחרור מודל לתמחור אישי.</p><div class="tablewrap"><table><thead><tr><th>מסלול</th><th>אופק</th><th>MAE מודל · bp</th><th>MAE בסיס · bp</th><th>שיפור</th></tr></thead><tbody>__SENSITIVITY__</tbody></table></div></section>
 <section><h2>ביצועים בתקופות שונות</h2>__DETAILS__</section>
 <section><h2>מה כבר אפשר לבדוק, ומה נשאר פתוח</h2><p>הניסוי משתמש ב־182 חודשים לכל מסלול, יולי 2011 עד אוגוסט 2026. לקו המשווה שבמאגר יש כרגע 25 חודשים ושמונה בנקים; זו אינה היסטוריה מספקת לפרוטוקול האימון והמבחן הזה, ולכן לא הומצא ציון דיוק בנקאי. גם חיזוי אישי טרם נמדד, משום שאין כאן תוויות של הצעות אמת לפי לקוח ועסקה.</p><p>השלב הבא במחקר הוא איסוף גרסאות פרסום מקוריות, בדיקת משטרי ריבית נוספים וקליטת הצעות אמת. שיפורים שיפותחו בעקבות המבחן הזה יצטרכו תקופת בדיקה חדשה או מעקב עתידי; תקופת המבחן הנוכחית כבר נחשפה.</p></section>
 <footer>פרוטוקול: <code>__PROTOCOL__</code><br>נתוני הניסוי: <code>__DATASET__</code><br>ריצה: <code>__RESULT__</code><br><a href="rate-predictions.csv">יומן תחזיות CSV</a> · <a href="../research/forecast/protocol.json">הפרוטוקול</a> · <a href="https://edge.boi.gov.il/FusionEdgeServer/sdmx/v2/data/dataflow/BOI.STATISTICS/BIR_MRTG_99/1.0/?format=csv">סדרות משכנתאות — בנק ישראל</a> · <a href="https://www.cbs.gov.il/en/cbsNewBrand/Pages/Api-Indices.aspx">API מדדי הלמ״ס</a></footer></main>
 <script>const charts=__CHARTS__;function update(){document.getElementById('plot').src=charts[document.getElementById('track').value+'_'+document.getElementById('horizon').value+'_'+document.getElementById('split').value]}for(const id of ['track','horizon','split'])document.getElementById(id).addEventListener('change',update);update();</script></html>'''
 for token,value in {'__ROWS__':''.join(rows),'__SENSITIVITY__':''.join(sensitivity),'__DETAILS__':''.join(details),'__CHARTS__':data_json,'__PROTOCOL__':r['protocolSha256'],'__DATASET__':r['datasetSha256'],'__RESULT__':pointer['resultSha256']}.items():report=report.replace(token,value)
 (out/'rate-backtest.html').write_text(report)
 print(json.dumps({'report':'reports/rate-backtest.html','predictions':len(ledger),'heldOut':sum(row['split']=='holdout' for row in ledger)}))

if __name__=='__main__':main()
