import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { AlertForm } from './AlertForm';
import { api, ApiError, fmtPrice, fmtTime, type Alert, type AppState } from './api';
import { SettingsScreen } from './Settings';
import { Toggle } from './ui';

type Tab = 'alerts' | 'activity' | 'settings';

export function App() {
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [state, setState] = useState<AppState | null>(null);
  const [tab, setTab] = useState<Tab>('alerts');
  const [form, setForm] = useState<{ editing: Alert | null } | null>(null);
  const [error, setError] = useState('');
  /** Why the last action was refused. Kept apart from connection errors, which clear on the next good poll. */
  const [actionError, setActionError] = useState('');

  const refresh = useCallback(async () => {
    try {
      setState(await api.state());
      setError('');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setLoggedIn(false);
      else setError('Cannot reach the server. Retrying…');
    }
  }, []);

  useEffect(() => {
    api.me().then((r) => setLoggedIn(r.loggedIn)).catch(() => setError('Cannot reach the server.'));
  }, []);

  // Poll while the app is on screen so prices and alert statuses stay current.
  useEffect(() => {
    if (!loggedIn) return;
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 2000);
    const onVisible = () => document.visibilityState === 'visible' && void refresh();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [loggedIn, refresh]);

  if (loggedIn === null) return <div className="center">{error || 'Loading…'}</div>;
  if (!loggedIn) return <Login onDone={() => setLoggedIn(true)} />;
  if (!state) return <div className="center">{error || 'Loading…'}</div>;

  const act = async (fn: () => Promise<unknown>) => {
    setActionError('');
    try {
      await fn();
    } catch (err) {
      setActionError((err as Error).message);
    }
    await refresh();
  };

  return (
    <div className="app">
      <header className="top">
        <div>
          <h1>GroundZero</h1>
          <div className="status">
            <span className={`dot ${state.broker.connected ? 'ok' : 'off'}`} />
            {state.broker.connected ? state.broker.accountName ?? 'Connected' : state.broker.detail}
          </div>
        </div>
        {state.broker.balance != null && (
          <div className="balance">
            <span>Balance</span>
            <b>{state.broker.balance.toLocaleString(undefined, { maximumFractionDigits: 2 })} {state.broker.currency}</b>
          </div>
        )}
      </header>

      {(actionError || error) && <p className="notice bad" role="alert">{actionError || error}</p>}

      <main>
        {tab === 'alerts' && (
          <AlertsScreen state={state} onNew={() => setForm({ editing: null })} onEdit={(a) => setForm({ editing: a })} act={act} goSettings={() => setTab('settings')} />
        )}
        {tab === 'activity' && <ActivityScreen state={state} act={act} />}
        {tab === 'settings' && <SettingsScreen state={state} refresh={refresh} onLoggedOut={() => setLoggedIn(false)} />}
      </main>

      <nav className="tabs" aria-label="Sections">
        {(['alerts', 'activity', 'settings'] as const).map((t) => (
          <button key={t} className={tab === t ? 'current' : ''} aria-current={tab === t ? 'page' : undefined} onClick={() => { setTab(t); setActionError(''); }}>
            {t === 'alerts' ? 'Alerts' : t === 'activity' ? 'Activity' : 'Settings'}
          </button>
        ))}
      </nav>

      {form && (
        <AlertForm
          state={state} editing={form.editing} onClose={() => setForm(null)}
          onSaved={() => { setForm(null); void refresh(); }}
        />
      )}
    </div>
  );
}

function Login(props: { onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.login(password);
      props.onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="login" onSubmit={submit}>
      <img src="/icon.svg" alt="" width="72" height="72" />
      <h1>GroundZero</h1>
      <p>Price alerts and automatic execution</p>
      <input type="password" autoComplete="current-password" placeholder="Password" aria-label="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      {error && <p className="notice bad" role="alert">{error}</p>}
      <button className="primary" disabled={busy}>{busy ? 'Logging in…' : 'Log in'}</button>
    </form>
  );
}

function AlertsScreen(props: {
  state: AppState;
  onNew: () => void;
  onEdit: (a: Alert) => void;
  act: (fn: () => Promise<unknown>) => Promise<void>;
  goSettings: () => void;
}) {
  const { state, act } = props;
  const active = state.alerts.filter((a) => a.status === 'active');
  const armed = active.some((a) => a.autoExecute);

  return (
    <>
      {state.broker.needsAccount && (
        <p className="notice warn">No trading account is linked yet. <button className="link" onClick={props.goSettings}>Link your MT5 account in Settings</button> to get prices.</p>
      )}
      {state.push.devices === 0 && (
        <p className="notice warn">Notifications are not turned on for any device. <button className="link" onClick={props.goSettings}>Turn them on in Settings</button>.</p>
      )}
      {armed && !state.settings.autoTradeEnabled && (
        <p className="notice warn">Auto-trading is off, so alerts will notify you but not place trades. <button className="link" onClick={props.goSettings}>Change in Settings</button>.</p>
      )}

      <div className="section-head">
        <h2>Active alerts</h2>
        <button className="primary small" onClick={props.onNew}>New alert</button>
      </div>

      {active.length === 0 && <p className="empty">No active alerts. Create one to be notified when price reaches your level.</p>}

      <ul className="cards">
        {active.map((a) => {
          const q = state.quotes[a.symbol];
          const d = state.digits[a.symbol];
          const now = q ? (a.autoExecute && a.side === 'BUY' ? q.ask : q.bid) : null;
          return (
            <li key={a.id} className="card">
              <div className="card-top">
                <div>
                  <div className="symbol">{a.symbol}</div>
                  {a.note && <div className="note">{a.note}</div>}
                </div>
                <div className="target">
                  <span>{a.direction === 'down' ? 'Falls to' : a.direction === 'up' ? 'Rises to' : 'Reaches'}</span>
                  <b>{fmtPrice(a.target, d)}</b>
                </div>
              </div>
              <div className="card-mid">
                <span>Now <b>{fmtPrice(now, d)}</b></span>
                {now != null && <span>{Math.abs(a.target - now).toFixed(d ?? 5)} away</span>}
              </div>
              <div className="card-auto">
                <div className="row-text">
                  <div className="row-title">Auto-execute</div>
                  <div className="row-detail">
                    {a.side
                      ? `${a.side === 'BUY' ? 'Buy' : 'Sell'} · SL ${a.slPrice != null ? fmtPrice(a.slPrice, d) : `${a.slPips} pips`} · RR 1:${a.rr} · ${a.riskMode === 'fixed' ? `${a.riskValue} lots` : `${a.riskValue}% risk`}`
                      : 'No trade set up. Edit the alert to add one.'}
                  </div>
                </div>
                <Toggle checked={a.autoExecute} label={`Auto-execute ${a.symbol} at ${a.target}`} onChange={(on) => act(() => api.setAuto(a.id, on))} />
              </div>
              <div className="card-actions">
                <button className="ghost" onClick={() => props.onEdit(a)}>Edit</button>
                <button className="ghost danger" onClick={() => act(() => api.cancelAlert(a.id))}>Cancel alert</button>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function ActivityScreen(props: { state: AppState; act: (fn: () => Promise<unknown>) => Promise<void> }) {
  const { state } = props;
  const done = state.alerts.filter((a) => a.status !== 'active');
  return (
    <>
      <div className="section-head"><h2>Trades</h2></div>
      {state.orders.length === 0 && <p className="empty">No automatic trades yet.</p>}
      <ul className="cards">
        {state.orders.map((o) => (
          <li key={o.id} className="card">
            <div className="card-top">
              <div>
                <div className="symbol">{o.side === 'BUY' ? 'Buy' : 'Sell'} {o.volume ?? ''} {o.symbol}</div>
                <div className="note">{fmtTime(o.createdAt)}</div>
              </div>
              <span className={`badge ${o.status}`}>{o.status === 'filled' ? 'Placed' : o.status === 'skipped' ? 'Not placed' : 'Failed'}</span>
            </div>
            {o.status === 'filled'
              ? <div className="card-mid"><span>Entry <b>{o.entry}</b></span><span>SL <b>{o.sl}</b></span><span>TP <b>{o.tp}</b></span></div>
              : <div className="note">{o.message}</div>}
          </li>
        ))}
      </ul>

      <div className="section-head"><h2>Past alerts</h2></div>
      {done.length === 0 && <p className="empty">Alerts that have fired or been cancelled appear here.</p>}
      <ul className="cards">
        {done.map((a) => (
          <li key={a.id} className="card">
            <div className="card-top">
              <div>
                <div className="symbol">{a.symbol} at {a.target}</div>
                <div className="note">
                  {a.status === 'triggered' && a.triggeredAt ? `Reached ${fmtTime(a.triggeredAt)} at ${a.triggeredPrice}` : 'Cancelled'}
                  {a.note ? ` · ${a.note}` : ''}
                </div>
              </div>
              <span className={`badge ${a.status}`}>{a.status === 'triggered' ? 'Reached' : 'Cancelled'}</span>
            </div>
            <div className="card-actions">
              <button className="ghost danger" onClick={() => props.act(() => api.deleteAlert(a.id))}>Delete</button>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
