# Sendloom

Sendloom is a production-oriented sequence sending platform built with Next.js, Postgres, Redis, and Gmail SMTP.

## Features

- CSV/XLSX imports with column detection and mapping
- HTML email templates with merge variables and preview
- Automatic field detection plus sequence creation, launch, and monitoring workflows
- Redis-backed rate limiting plus app-driven launch and delivery processing
- Suppression, unsubscribe, and tracking plumbing

## Quick start

0. Use `Node 20+` and `npm 10+`.
1. Copy `.env.example` to `.env`.
2. Install dependencies with `npm install`.
3. Run `npm run prisma:generate`.
4. Create the database and apply migrations with `npm run prisma:migrate`.
5. Start the app with `npm run dev`.
6. Launch campaigns from the app. Immediate sends are processed in-app, and scheduled/retry work can be processed by calling `/api/cron/campaigns` from an external scheduler.

## Notes

- The workspace started empty, so this scaffold focuses on a strong architectural foundation and first-pass feature implementation.
- File uploads default to local disk storage through `LOCAL_UPLOAD_DIR`; swap the storage adapter for S3 or Vercel Blob in production.
- Set `CRON_SECRET` in Vercel so your external scheduler can authenticate its calls to `/api/cron/campaigns`.

## cron-job.org setup for scheduled sends

If you want scheduled sequences to run while your laptop is off, add an external cron job. The app already exposes a protected endpoint at `/api/cron/campaigns` for this.

1. In Vercel, set `CRON_SECRET` to a long random value and redeploy production.
2. In cron-job.org, create a new job with:
   - URL: `https://www.sendloom.net/api/cron/campaigns`
   - Method: `GET`
   - Schedule: every minute
   - Timeout: `60` seconds
3. Add one request header:
   - `X-Cron-Secret: <your CRON_SECRET>`

You can also use:

- `Authorization: Bearer <your CRON_SECRET>`

If the scheduler is configured correctly, queued scheduled sends will continue processing on Vercel even when your personal computer is shut down.
