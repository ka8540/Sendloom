# Sendloom

Sendloom is a production-oriented sequence sending platform built with Next.js, Postgres, Redis, and Gmail SMTP.

## Features

- CSV/XLSX imports with column detection and mapping
- HTML email templates with merge variables and preview
- Automatic field detection plus sequence creation, launch, and monitoring workflows
- Redis-backed queues for validation, launch, sending, and webhooks
- Suppression, unsubscribe, and tracking plumbing

## Quick start

0. Use `Node 20+` and `npm 10+`.
1. Copy `.env.example` to `.env`.
2. Install dependencies with `npm install`.
3. Run `npm run prisma:generate`.
4. Create the database and apply migrations with `npm run prisma:migrate`.
5. Start the app with `npm run dev`.
6. Start background workers with `npm run worker` and `npm run scheduler`.

## Notes

- The workspace started empty, so this scaffold focuses on a strong architectural foundation and first-pass feature implementation.
- File uploads default to local disk storage through `LOCAL_UPLOAD_DIR`; swap the storage adapter for S3 or Vercel Blob in production.
