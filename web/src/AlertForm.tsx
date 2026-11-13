import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { api, fmtPrice, type Alert, type AlertInput, type AppState, type QuoteInfo, type RiskMode, type Side } from './api';
import { Field, Segmented, Toggle } from './ui';

const toNum = (s: string): number | null => {
  const n = Number(s.replace(',', '.'));
  return s.trim() !== '' && Number.isFinite(n) ? n : null;
};

/** Create or edit an alert. Trade details only appear when auto-execute is switched on. */
export function AlertForm(props: { state: AppState; editing: Alert | null; onClose: () => void; onSaved: () => void }) {
  const { state, editing } = props;
  const [symbols, setSymbols] = useState<string[]>([]);
  const [symbol, setSymbol] = useState(editing?.symbol ?? '');
  const [target, setTarget] = useState(editing ? String(editing.target) : '');
  const [note, setNote] = useState(editing?.note ?? '');
  const [auto, setAuto] = useState(editing?.autoExecute ?? false);
  const [side, setSide] = useState<Side | null>(editing?.side ?? null);
  const [slType, setSlType] = useState<'pips' | 'price'>(editing?.slPrice != null ? 'price' : 'pips');
  const [sl, setSl] = useState(editing ? String(editing.slPrice ?? editing.slPips ?? '') : '');
  const [rr, setRr] = useState(String(editing?.rr ?? state.settings.defaultRr));
  const [riskMode, setRiskMode] = useState<RiskMode>(editing?.riskMode ?? 'percent');
  const [risk, setRisk] = useState(String(editing?.riskValue ?? state.settings.defaultRiskPercent));
  const [info, setInfo] = useState<QuoteInfo | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.symbols().then((r) => setSymbols(r.symbols)).catch(() => undefined);
  }, []);

  // Live price for the chosen symbol, so the target can be judged against it.
  const known = symbols.length === 0 || symbols.includes(symbol);
  useEffect(() => {
    setInfo(null);
    if (!symbol || !known) return;
    let alive = true;
    const load = () => api.quote(symbol).then((r) => alive && setInfo(r)).catch(() => undefined);
    void load();
    const timer = setInterval(load, 2000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [symbol, known]);

  const digits = info?.spec?.digits;
  const targetNum = toNum(target);
  const slNum = toNum(sl);
  const rrNum = toNum(rr);
  const riskNum = toNum(risk);

  // What the trade would look like if it filled exactly at the alert price.
  const preview = useMemo(() => {
    const spec = info?.spec;
    if (!auto || !side || !spec || targetNum == null || slNum == null || rrNum == null || !(slNum > 0)) return null;
    const buy = side === 'BUY';
    const slPrice = slType === 'price' ? slNum : buy ? targetNum - slNum * spec.pipSize : targetNum + slNum * spec.pipSize;
    const distance = buy ? targetNum - slPrice : slPrice - targetNum;
    if (!(distance > 0)) return { error: buy ? 'For a Buy, the stop loss must be below the alert price.' : 'For a Sell, the stop loss must be above the alert price.' };
    const tp = buy ? targetNum + distance * rrNum : targetNum - distance * rrNum;
    let lots: number | null = null;
    let riskMoney: number | null = null;
    const tickValue = info?.quote?.lossTickValue;
    const lossPerLot = tickValue ? (distance / spec.tickSize) * tickValue : null;
    if (riskMode === 'fixed') lots = riskNum;
    else if (lossPerLot && riskNum && state.broker.balance) {
      lots = Math.floor((state.broker.balance * riskNum) / 100 / lossPerLot / spec.volumeStep + 1e-9) * spec.volumeStep;
    }
    if (lots != null && lossPerLot) riskMoney = lots * lossPerLot;
    return { slPrice, tp, lots, riskMoney, pips: distance / spec.pipSize, tooSmall: lots != null && lots < spec.minVolume };
  }, [auto, side, info, targetNum, slNum, rrNum, riskNum, slType, riskMode, state.broker.balance]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (targetNum == null) return setError('Enter the price to be alerted at.');
    const input: AlertInput = {
      symbol, target: targetNum, note, autoExecute: auto, side,
      slPrice: slType === 'price' ? slNum : null,
      slPips: slType === 'pips' ? slNum : null,
      rr: rrNum, riskMode, riskValue: riskNum,
    };
    setSaving(true);
    try {
      if (editing) await api.updateAlert(editing.id, input);
      else await api.createAlert(input);
      props.onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const q = info?.quote;
  const currency = state.broker.currency ?? '';

  return (
    <div className="sheet-backdrop" onClick={props.onClose}>
      <form className="sheet" onSubmit={submit} onClick={(e) => e.stopPropagation()} aria-label={editing ? 'Edit alert' : 'New alert'}>
        <header className="sheet-head">
          <h2>{editing ? 'Edit alert' : 'New alert'}</h2>
          <button type="button" className="ghost" onClick={props.onClose}>Close</button>
        </header>

        <Field
          label="Symbol"
          hint={
            !symbol ? undefined : !known ? 'Not available on this account.' : q
              ? <>Now: bid <b>{fmtPrice(q.bid, digits)}</b> · ask <b>{fmtPrice(q.ask, digits)}</b></>
              : 'Waiting for a price…'
          }
        >
          <input
            list="symbols" value={symbol} required autoCapitalize="characters" autoComplete="off" placeholder="e.g. EURUSD"
            onChange={(e) => setSymbol(symbols.find((s) => s.toLowerCase() === e.target.value.trim().toLowerCase()) ?? e.target.value.trim())}
          />
        </Field>
        <datalist id="symbols">{symbols.map((s) => <option key={s} value={s} />)}</datalist>

        <Field label="Alert me when price reaches">
          <input inputMode="decimal" value={target} required placeholder={q ? fmtPrice(q.bid, digits) : 'Price'} onChange={(e) => setTarget(e.target.value)} />
        </Field>

        <Field label="Note (optional)">
          <input value={note} maxLength={200} placeholder="e.g. Daily resistance" onChange={(e) => setNote(e.target.value)} />
        </Field>

        <div className="auto-box">
          <div className="row">
            <div className="row-text">
              <div className="row-title">Auto-execute a trade</div>
              <div className="row-detail">Places a market order the moment price reaches this alert.</div>
            </div>
            <Toggle checked={auto} onChange={setAuto} label="Auto-execute a trade" />
          </div>

          {auto && (
            <>
              {!state.settings.autoTradeEnabled && (
                <p className="notice warn">Auto-trading is switched off in Settings, so this alert will only notify you until you turn it on.</p>
              )}
              <Field label="Direction">
                <Segmented label="Direction" value={side} onChange={setSide} options={[{ value: 'BUY', label: 'Buy', tone: 'buy' }, { value: 'SELL', label: 'Sell', tone: 'sell' }]} />
              </Field>
              <div className="grid2">
                <Field label="Stop loss as">
                  <Segmented label="Stop loss type" value={slType} onChange={setSlType} options={[{ value: 'pips', label: 'Pips' }, { value: 'price', label: 'Price' }]} />
                </Field>
                <Field label={slType === 'pips' ? 'Stop loss (pips)' : 'Stop loss price'}>
                  <input inputMode="decimal" value={sl} placeholder={slType === 'pips' ? '20' : 'Price'} onChange={(e) => setSl(e.target.value)} />
                </Field>
              </div>
              <div className="grid2">
                <Field label="Risk to Reward (1 : x)">
                  <input inputMode="decimal" value={rr} onChange={(e) => setRr(e.target.value)} />
                </Field>
                <Field label={riskMode === 'percent' ? 'Risk (% of balance)' : 'Lot size'}>
                  <input inputMode="decimal" value={risk} onChange={(e) => setRisk(e.target.value)} />
                </Field>
              </div>
              <Field label="Position size from">
                <Segmented
                  label="Position size from" value={riskMode}
                  onChange={(m) => { setRiskMode(m); setRisk(m === 'percent' ? String(state.settings.defaultRiskPercent) : '0.01'); }}
                  options={[{ value: 'percent', label: 'Risk %' }, { value: 'fixed', label: 'Fixed lot' }]}
                />
              </Field>

              {preview && 'error' in preview && <p className="notice bad">{preview.error}</p>}
              {preview && !('error' in preview) && (
                <dl className="preview" aria-label="Trade estimate">
                  <div><dt>Stop loss</dt><dd>{fmtPrice(preview.slPrice, digits)} <small>({preview.pips.toFixed(1)} pips)</small></dd></div>
                  <div><dt>Take profit</dt><dd>{fmtPrice(preview.tp, digits)}</dd></div>
                  <div><dt>Lot size</dt><dd>{preview.lots != null ? preview.lots.toFixed(2) : '—'}</dd></div>
                  <div><dt>Risk</dt><dd>{preview.riskMoney != null ? `${preview.riskMoney.toFixed(2)} ${currency}` : '—'}</dd></div>
                </dl>
              )}
              {preview && !('error' in preview) && preview.tooSmall && (
                <p className="notice bad">This risk gives less than the smallest lot the broker allows, so the trade would be skipped. Raise the risk or tighten the stop.</p>
              )}
              {preview && !('error' in preview) && (
                <p className="field-hint">Estimate if filled exactly at the alert price. The real order uses the live price at that moment.</p>
              )}
            </>
          )}
        </div>

        {error && <p className="notice bad" role="alert">{error}</p>}
        <button className="primary" disabled={saving}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Create alert'}</button>
      </form>
    </div>
  );
}
