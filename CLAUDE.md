# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ADIT Database REST — a TypeScript backend (Express + TypeORM) and frontend (Next.js 15) for database schema snapshot, comparison, changeset management, and DDL execution via a CRM gateway.

## Commands

### Backend (root)
- `npm run dev` — Start backend in watch mode (tsx, port 3000)
- `npm run build` — Compile TypeScript to `dist/`
- `npm start` — Run compiled backend
- `npm run typecheck` — Type-check without emitting
- `npm test` — Build then run unit + diff-planner tests
- `npm run test:contract` — Build then run contract tests
- `npm run migration:generate` — Generate a new TypeORM migration
- `npm run migration:run` — Apply pending migrations
- `npm run mock:crm` — Start mock CRM server for local dev

### Frontend (`frontend/`)
- `npm run dev` — Start Next.js dev server (port 3100)
- `npm run build` — Production build
- `npm start` — Serve production build

## Architecture

### Backend (Express + TypeORM)

**Module pattern** — Each feature in `src/modules/` follows `entity.ts` → `service.ts` → `routes.ts`. All routers are assembled in `src/modules/api-router.ts` under `/api/v1`.

**Modules**: `instances`, `snapshots`, `compare`, `changesets`, `executions`, `jobs`, `audit`, `crmConnector`, `schema`

**Middleware stack** (order matters): CORS → JSON body (2MB limit) → correlation-id → JWT auth → RBAC → error handler

**Auth**: JWT validation controlled by `AUTH_REQUIRED` env var. When false, dev mode injects admin role. RBAC roles: `viewer`, `editor`, `executor`, `approver`, `admin` — enforced via `requireRoles()` middleware.

**Database**: TypeORM with SQLite (dev) / MariaDB / Oracle (prod). Config in `src/config/data-source.ts`, env validated with Zod in `src/config/env.ts`. Migrations in `src/migrations/`.

**CRM Gateway**: All external DB operations go through `CrmConnectorService` which calls a single CRM endpoint (`/database_rest?action=...`). Actions: `health`, `db_info`, `metadata_export`, `ddl_validate`, `ddl_execute`, `ddl_execution_status`, `ddl_execution_logs`.

**Job/SSE system**: `JobBus` (in-memory event emitter) powers SSE streaming at `/api/v1/jobs/:jobId/events`. Used by snapshot creation and changeset execution for real-time progress.

**Error handling**: Custom `ApiError` class with helpers (`badRequest()`, `notFound()`, etc.). All responses include `correlationId`.

### Frontend (Next.js 15 App Router)

- **State**: TanStack Query (React Query) for server state
- **UI**: MUI 6 + MUI DataGrid for virtualized tables
- **SSE**: `@microsoft/fetch-event-source` for job streaming
- **Auth**: JWT token in React Context (`src/lib/auth.tsx`)
- **API client**: `src/lib/api.ts` — typed fetch wrapper
- **Theme**: `src/theme.ts`

### Internal Package

`packages/diff-planner/` — Schema diff calculation logic, database-agnostic canonical type system, and stable key generation for matching objects across snapshots. Has its own test suite.

## Environment Setup

Copy `.env.example` to `.env`. Key variables: `DB_TYPE` (sqlite/mariadb/oracle), `AUTH_REQUIRED`, `JWT_SECRET`, `CRM_TIMEOUT_MS`. Frontend uses `NEXT_PUBLIC_API_BASE_URL` (defaults to `http://localhost:3000/api/v1`).

## Testing

Tests use a custom runner (not Jest/Mocha). Build first with `npm run build`, then tests run from `dist/`. The diff-planner package has a separate test runner at `packages/diff-planner/tests/`.
