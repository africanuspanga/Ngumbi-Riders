# SMS relay (runs on the VPS 164.92.205.5)

Mobishastra only accepts API calls from **whitelisted IP addresses**, and the
web app runs on Vercel, which has no fixed IP. So every SMS goes:

```
Vercel app ──HTTPS + HMAC──▶ sms.mikenovagroup.co.tz/ngumbi/send ──▶ relay :8089 ──▶ Mobishastra ──▶ phone
                              (nginx on 164.92.205.5, the whitelisted IP)
```

The same VPS already runs the HAKIKI relay (`hakiki-sms`, port 8088, sender
MIKENOVA) for mikenova-group — that is where this design comes from. Ng'umbi
has its **own** relay so it can send as **GEAFA** with its own secret, and so a
change here can never break HAKIKI. Both use the same Mobishastra account
(DRIFTMARK) and therefore the same credit balance.

## What is deployed (2026-10-23)

| Thing | Where |
| --- | --- |
| Script | `/opt/ngumbi-sms/relay.mjs` (this folder's `relay.mjs`) |
| Config | `/opt/ngumbi-sms/.env` (chmod 600): `MOBISHASTRA_USER`, `MOBISHASTRA_PASSWORD`, `MOBISHASTRA_SENDER_ID=GEAFA`, `SMS_RELAY_SECRET`, `PORT=8089`, `HOST=127.0.0.1` |
| Service | `ngumbi-sms.service` (systemd, `DynamicUser=yes`, restarts on failure) |
| Public routes | `location = /ngumbi/send`, `/ngumbi/balance`, `/ngumbi/health` added to `/etc/nginx/sites-available/hakiki-sms` (backup of the original in `/root/hakiki-sms.nginx.bak-*`) |

Port 8787 is taken by another service on this box, and 8088 by HAKIKI; the
relay binds **localhost only**, so it is reachable solely through nginx/TLS.

## Protocol

`POST /send` with JSON `{"to":["2557…"],"text":"…","sender":"GEAFA"}` and headers

- `x-relay-timestamp`: unix seconds (refused if more than 5 minutes off)
- `x-relay-signature`: hex HMAC-SHA256 of `${timestamp}.${rawBody}` with `SMS_RELAY_SECRET`

`POST /balance` (body `{}`, signed the same way) returns `{"ok":true,"balance":9654}`.
Only Tanzanian mobiles (`255[67]XXXXXXXX`), at most 50 per call, are accepted,
so a leaked secret cannot turn this into a spam gateway. Success is only ever
confirmed from the gateway body (`000` / "Send Successful").

## Operating it

```bash
ssh root@164.92.205.5
systemctl status ngumbi-sms          # is it up
journalctl -u ngumbi-sms -f          # live log: one line per send, no message text
systemctl restart ngumbi-sms         # after editing /opt/ngumbi-sms/.env
curl -s https://sms.mikenovagroup.co.tz/ngumbi/health
```

Updating the script: `scp scripts/sms-relay/relay.mjs root@164.92.205.5:/opt/ngumbi-sms/`
then `systemctl restart ngumbi-sms`. Editing nginx: always `nginx -t` before
`systemctl reload nginx` (never restart — other sites share it).

Rotating the secret: change `SMS_RELAY_SECRET` in `/opt/ngumbi-sms/.env` **and**
in Vercel, restart the service, redeploy.

## Vercel environment variables

```
SMS_RELAY_URL=https://sms.mikenovagroup.co.tz/ngumbi/send
SMS_RELAY_SECRET=<same value as /opt/ngumbi-sms/.env — also in .env.local>
MOBISHASTRA_SENDER_ID=GEAFA
OWNER_NOTIFY_PHONE=+255753522155
```

From the app: **Owner → System** shows the transport, sender, live credit
balance and outbox, and has a **Send test SMS** button.

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `IP address not allowed.` | The VPS IP is not whitelisted for DRIFTMARK — ask Mobishastra |
| `bad_signature` | `SMS_RELAY_SECRET` differs between Vercel and the VPS |
| `stale_or_missing_timestamp` | Clock skew > 5 min on either side (`timedatectl`) |
| `No More Credits` | Top up the DRIFTMARK account (shared with HAKIKI) |
| SMS arrives from a different name | GEAFA is not an approved sender on the account; Mobishastra falls back silently |
