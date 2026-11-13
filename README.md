# GroundZero

A phone app for forex price alerts. You enter a symbol and a price; when the market
reaches it you get a push notification. Each alert has an **Auto-execute** toggle:
when it is on, the server also places a market order through
[MetaApi](https://metaapi.cloud/) on your MT5 account, with a stop loss and a take
profit worked out from your Risk to Reward ratio.

It is built for one user. It installs to the home screen on Android and iPhone
(no app store needed).

## How it works

```
Phone (home-screen app) ──HTTPS──► Server ──► MetaApi cloud MT5 ──► Broker
        ▲                            │ watches live prices
        └────── push notification ◄──┘ fires the alert, optionally sends the order
```

- The server keeps a live price stream open for symbols that have active alerts.
- An alert fires once, when price reaches or passes its level. It is marked as
  fired in the database before anything else happens, so it cannot fire twice.
- If the server restarts and price went through the level meanwhile, the alert
  fires as soon as the server is back.

### Auto-execute

A trade is only placed when **both** switches are on: the alert's own toggle and
the master switch "Allow auto-execute" in Settings (off by default).

- Entry: market order at the live price (ask for a Buy, bid for a Sell).
- Stop loss: a price, or a distance in pips from the entry.
- Take profit: stop distance × Risk to Reward.
- Lot size: either a fixed lot, or `balance × risk% ÷ loss per lot at the stop`,
  rounded **down** to the broker's lot step.
- The trade is skipped, and you are told why, if the account is offline, the
  spread is above your limit, the stop is on the wrong side, or the risk gives
  less than the broker's smallest lot.

Every attempt is listed under **Activity**.

## Run it on your computer

Needs Node.js 22 or newer.

```bash
npm run setup
```

```bash
npm run build
```

```bash
npm start
```

Open http://localhost:3000. With no MetaApi token the server runs a **simulated
market**, prints a temporary password in the terminal, and adds a "Simulator"
panel in Settings where you can move the price to see an alert fire. Nothing in
that mode touches a real account.

## Connect a real MT5 account

1. Create an account at https://app.metaapi.cloud and copy your API token.
2. Create your app password hash:

   ```bash
   npm --prefix server run hash-password
   ```

3. Copy `server/.env.example` to `server/.env` and fill in `APP_PASSWORD_HASH`
   and `METAAPI_TOKEN`.
4. Start the server, log in, open **Settings → Trading account** and enter your
   MT5 login, password and broker server. **Use a demo account first.** The
   password is passed to MetaApi and is not stored by this app.

## Put it online

Push notifications and home-screen install need HTTPS, so the app has to run on a
host. Any host that runs a Docker image with a persistent disk works (Railway,
Fly.io, Render, a small VPS).

- Build from the `Dockerfile`.
- Mount a persistent disk at `/data` (the database lives there).
- Set `APP_PASSWORD_HASH`, `METAAPI_TOKEN` and `VAPID_SUBJECT`.
- The service must stay running all the time. A host that puts the app to sleep
  when idle will miss alerts.

Then on your phone:

- **Android:** open the site in Chrome, menu → "Add to Home screen".
- **iPhone (iOS 16.4+):** open the site in Safari, Share → "Add to Home Screen".
  Notifications only work from the home-screen app, not from the Safari tab.

Open the installed app, go to **Settings → Notifications**, switch on "Alerts on
this device" and press "Send test".

## Development

```bash
npm run dev:server
```

```bash
npm run dev:web
```

```bash
npm test
```

| Path | What it is |
|---|---|
| `server/src/logic/` | Alert crossing rules and trade sizing. Pure functions with unit tests. |
| `server/src/engine.ts` | Watches prices, fires alerts, sends pushes and orders. |
| `server/src/metaApiBroker.ts` | The MetaApi connection (prices, symbol details, market orders). |
| `server/src/simBroker.ts` | The simulated market. |
| `server/src/app.ts` | HTTP API and login. |
| `web/src/` | The phone app (React). `web/public/sw.js` shows the notifications. |

## Limits to know about

- Market orders can slip: the fill price may differ a little from the alert price.
- Alerts depend on the server and MetaApi being up. If both are down while price
  touches the level and comes back, the alert is not caught.
- Trading carries risk. Test on a demo account before using real money.
