import { useEffect, useState, type FormEvent } from 'react';
import { api, type AppState, type Settings } from './api';
import { disablePush, enablePush, isSubscribed, pushSupport } from './push';
import { Field, Row, Toggle } from './ui';

export function SettingsScreen(props: { state: AppState; refresh: () => Promise<void>; onLoggedOut: () => void }) {
  const { state, refresh } = props;
  const [message, setMessage] = useState<{ text: string; bad?: boolean } | null>(null);
  const say = (text: string, bad = false) => setMessage({ text, bad });

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      if (ok) say(ok);
    } catch (err) {
      say((err as Error).message, true);
    }
    await refresh();
  };

  return (
    <>
      {message && <p className={`notice ${message.bad ? 'bad' : 'good'}`} role="status">{message.text}</p>}
      <Notifications state={state} run={run} />
      <Trading state={state} run={run} />
      <Account state={state} run={run} />
      {state.broker.kind === 'sim' && <Simulator state={state} run={run} />}
      <section className="panel">
        <button className="ghost danger" onClick={() => api.logout().then(props.onLoggedOut)}>Log out</button>
      </section>
    </>
  );
}

type Run = (fn: () => Promise<unknown>, ok?: string) => Promise<void>;

function Notifications({ state, run }: { state: AppState; run: Run }) {
  const support = pushSupport();
  const [on, setOn] = useState(false);
  useEffect(() => {
    void isSubscribed().then(setOn);
  }, []);

  return (
    <section className="panel">
      <h2>Notifications</h2>
      {support.state === 'needs-install' && (
        <p className="notice warn">On iPhone, notifications only work from the Home Screen app. In Safari tap Share, then "Add to Home Screen", open GroundZero from there and come back to this screen.</p>
      )}
      {support.state === 'unsupported' && <p className="notice warn">This browser does not support push notifications.</p>}
      {support.state === 'ready' && (
        <Row title="Alerts on this device" detail={on ? 'This device will be notified.' : 'Off for this device.'}>
          <Toggle
            checked={on} label="Alerts on this device"
            onChange={(next) => run(async () => {
              if (next) await enablePush(state.push.publicKey);
              else await disablePush();
              setOn(next);
            })}
          />
        </Row>
      )}
      <Row title="Devices receiving alerts" detail={String(state.push.devices)}>
        <button
          className="ghost" disabled={state.push.devices === 0}
          onClick={() => run(async () => {
            const r = await api.pushTest();
            if (r.sent === 0) throw new Error('The test could not be delivered to any device.');
          }, 'Test notification sent.')}
        >
          Send test
        </button>
      </Row>
    </section>
  );
}

function Trading({ state, run }: { state: AppState; run: Run }) {
  const s = state.settings;
  const [draft, setDraft] = useState({ risk: String(s.defaultRiskPercent), rr: String(s.defaultRr), spread: String(s.maxSpreadPips) });
  const changed = draft.risk !== String(s.defaultRiskPercent) || draft.rr !== String(s.defaultRr) || draft.spread !== String(s.maxSpreadPips);

  function save(e: FormEvent) {
    e.preventDefault();
    const patch: Partial<Settings> = {
      defaultRiskPercent: Number(draft.risk), defaultRr: Number(draft.rr), maxSpreadPips: Number(draft.spread),
    };
    void run(() => api.saveSettings(patch), 'Trading defaults saved.');
  }

  return (
    <section className="panel">
      <h2>Automatic trading</h2>
      <Row title="Allow auto-execute" detail="Master switch. When off, no alert places a trade, whatever its own toggle says.">
        <Toggle checked={s.autoTradeEnabled} label="Allow auto-execute" onChange={(on) => run(() => api.saveSettings({ autoTradeEnabled: on }))} />
      </Row>
      <form onSubmit={save}>
        <div className="grid2">
          <Field label="Default risk (% of balance)">
            <input inputMode="decimal" value={draft.risk} onChange={(e) => setDraft({ ...draft, risk: e.target.value })} />
          </Field>
          <Field label="Default Risk to Reward (1 : x)">
            <input inputMode="decimal" value={draft.rr} onChange={(e) => setDraft({ ...draft, rr: e.target.value })} />
          </Field>
        </div>
        <Field label="Maximum spread (pips)" hint="A trade is skipped if the spread is wider than this. 0 turns the check off.">
          <input inputMode="decimal" value={draft.spread} onChange={(e) => setDraft({ ...draft, spread: e.target.value })} />
        </Field>
        <button className="primary" disabled={!changed}>Save defaults</button>
      </form>
    </section>
  );
}

function Account({ state, run }: { state: AppState; run: Run }) {
  const b = state.broker;
  const [form, setForm] = useState({ login: '', password: '', server: '' });
  const [busy, setBusy] = useState(false);

  async function link(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    await run(async () => {
      await api.linkAccount(form.login, form.password, form.server);
      setForm({ login: '', password: '', server: '' });
    }, 'Account added. Connecting can take a couple of minutes.');
    setBusy(false);
  }

  return (
    <section className="panel">
      <h2>Trading account</h2>
      <Row title={b.kind === 'sim' ? 'Simulated market' : b.accountName ?? 'MetaTrader 5 via MetaApi'} detail={b.detail}>
        <span className={`badge ${b.connected ? 'filled' : 'skipped'}`}>{b.connected ? 'Connected' : 'Offline'}</span>
      </Row>
      {b.kind === 'sim' && <p className="field-hint">The server has no MetaApi token, so prices and fills are simulated. Nothing here touches a real account.</p>}
      {b.needsAccount && (
        <form onSubmit={link}>
          <p className="field-hint">Enter your MT5 details. Start with a demo account. The password is sent to MetaApi and is not stored by this app.</p>
          <Field label="MT5 login"><input inputMode="numeric" autoComplete="off" value={form.login} required onChange={(e) => setForm({ ...form, login: e.target.value })} /></Field>
          <Field label="MT5 password"><input type="password" autoComplete="off" value={form.password} required onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
          <Field label="Broker server" hint="Exactly as shown in MetaTrader, e.g. ICMarketsSC-Demo."><input autoComplete="off" value={form.server} required onChange={(e) => setForm({ ...form, server: e.target.value })} /></Field>
          <button className="primary" disabled={busy}>{busy ? 'Adding account…' : 'Link account'}</button>
        </form>
      )}
    </section>
  );
}

/** Lets you push the fake market to a price, to see an alert fire without waiting. */
function Simulator({ state, run }: { state: AppState; run: Run }) {
  const first = state.alerts.find((a) => a.status === 'active');
  const [symbol, setSymbol] = useState(first?.symbol ?? 'EURUSD');
  const [price, setPrice] = useState(first ? String(first.target) : '');
  return (
    <section className="panel">
      <h2>Simulator</h2>
      <p className="field-hint">Move the simulated price to test an alert.</p>
      <form onSubmit={(e) => { e.preventDefault(); void run(() => api.simPrice(symbol, Number(price)), `${symbol} moved to ${price}.`); }}>
        <div className="grid2">
          <Field label="Symbol"><input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} /></Field>
          <Field label="Price"><input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
        </div>
        <button className="ghost">Move price</button>
      </form>
    </section>
  );
}
