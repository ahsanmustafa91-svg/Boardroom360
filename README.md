# Boardroom 360

The digital boardroom. Made in Pakistan, for Pakistan.

A board portal MVP for one demo client, **Demo Company Limited** (fictional). Directors, the Chairman, the CEO, the Company Secretary and the CS Assistant sign in with a user ID, a password and a one-time code, and share one live record of notices, date polls, papers, votes, minutes and resolutions.

## Sign-in and users

- Sign-in: user ID and password, then a one-time code sent to the registered mobile. Five wrong passwords lock the user ID for 15 minutes.
- Passwords are stored as salted scrypt hashes and never sent to the browser.
- The **Company Secretary is the admin** (Users page): add users with a temporary password, edit name, title, role, contact details, voting and Board/committee membership, choose each body's Chair, reset passwords and deactivate or reactivate users. Resetting a password or deactivating a user signs them out everywhere. New and reset users must choose their own password at first sign-in.
- Everyone can change their own password (Password, top right).
- Demo user IDs are `firstname.lastname` (e.g. `sana.javed`, `tariq.hameed`, `farah.naz`) with the starter password `Board@360` (override with `DEMO_PASSWORD`). *Reset demo data* restores them.

## What's in it

**Directors, Chairman, CEO**
- Home with an action list: notices to acknowledge, date polls, attendance replies, unread papers, agenda approval (Chair), minutes to sign (Chair)
- Notices inbox: formal notices on the company letterhead, *Acknowledge receipt*, attendance reply, *Add to calendar* (.ics)
- Meetings, agendas and papers, *Read entire pack*, private notes on each paper
- Live meeting: follow the current item, join, vote For / Against / Abstain
- Minutes, resolution register (searchable), archive, *Ask the record*

**Company Secretary and CS Assistant**
- Create a meeting with a date poll; confirming a date drafts the notice automatically
- Notice screen: checks before sending (notice period from the rule pack, Chair's approval of the agenda, every recipient has email and mobile), *Sign and issue* with a one-time code (Company Secretary only), delivery / opened / acknowledged tracking, reminders
- Notice register; postponement, venue change and supplementary agenda create a new linked notice
- Live meeting console: attendance, quorum, open and close votes, discussion notes, end meeting
- Minutes drafted from the meeting, edited, circulated and signed by the Chair and the Company Secretary with one-time codes, then sealed
- Compliance tracker, directors' meeting fees (from attendance), members register, activity log
- Users (Company Secretary only): see *Sign-in and users*
- Settings: rule pack (Companies Act 2017: listed / private / public sector), reset demo data

## Demo mode

- SMS codes are **simulated**: the code is shown on screen instead of being sent.
- *Ask the record* searches the resolution register; it does not call an AI model.
- Everyone testing shares the same data. Settings › *Reset demo data* puts it back.

## Run locally

```bash
npm install
npm start            # in-memory data, http://localhost:3000
DATABASE_URL=postgres://… npm start   # with Postgres
```

Environment variables:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string. Without it the app keeps data in memory. |
| `SESSION_SECRET` | Signs sign-in tokens. Set it so sessions survive restarts. |
| `PGSSL=off` | Turn off TLS for a local Postgres. |
| `TENANT_ID` | Which client's data this instance serves (default `demo`). |

## Architecture

- `src/server.js`: Express API. Every change goes through `POST /api/action` with a named action; the server checks the user's role, applies the change, bumps a version number and writes to Postgres. Browsers poll `GET /api/state?since=<version>` every 3 seconds, so all testers see changes live.
- `src/store.js`: Postgres storage (`tenant_state` holds each client's record as JSONB; `audit_log` keeps every action permanently).
- `src/seed.js`: demo data.
- `public/`: the web client, plain JavaScript with no build step.

Each client is a separate `tenant_id`, which is the starting point for the multi-client platform in scope section M21.

## Deploy on Render

`render.yaml` defines the web service (free plan) and a Basic 256 MB Postgres database in Singapore (about $6 a month). The free web service sleeps when idle, so the first visit after a break takes about a minute.
