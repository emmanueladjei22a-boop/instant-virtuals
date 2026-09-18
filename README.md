# Instant Virtuals — live site

Real Node server + SQLite database. Admin and users share the same data.

## Run on your computer

```bash
cd instant-virtuals-live
npm install
ADMIN_EMAIL=you@email.com ADMIN_PASSWORD='YourStrongPassword' JWT_SECRET='long-random-string' npm start
```

Open http://localhost:3000

First admin account is created only once, from `ADMIN_EMAIL` / `ADMIN_PASSWORD`. If you already ran it, that admin is in `data/app.db`.

## Put it on the internet for free (Render)

1. Upload this folder to a GitHub repo.
2. Go to https://render.com → New Web Service → connect the repo.
3. Settings:
   - Build: `npm install`
   - Start: `npm start`
   - Instance: Free
4. Environment variables:
   - `ADMIN_EMAIL`
   - `ADMIN_PASSWORD`
   - `JWT_SECRET` (long random text)
   - `PORT` is set by Render automatically
5. After deploy you get `https://something.onrender.com`

Free Render apps sleep after idle. First open can take ~30 seconds.

**Disk note:** Free Render filesystem can reset. For money and real users, add a Render Disk mounted at `/opt/render/project/src/data`, or move later to Postgres.

## What is live

- Shared user accounts
- Admin approve / mark paid / credits / block
- Published tips all members see
- All slips stored on the server
- Homepage ticker, reviews, fees, maintenance — edited by admin

Automatic “analysis” only marks the shortest odd. Instant Virtuals results are RNG. Do not advertise guaranteed wins.

Paystack / MTN MoMo can be added on the unpaid registration payment record when you have API keys.
