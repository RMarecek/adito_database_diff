# ADIT Database REST Backend

Node.js + TypeScript backend API for schema snapshot, compare, changeset validation/execution, and job SSE streaming.

## Stack

- Framework: Express
- ORM: TypeORM (configurable for MariaDB or Oracle; SQLite included for local/dev)
- Auth: JWT bearer + RBAC (`viewer`, `editor`, `executor`, `approver`, `admin`)
- Integration: CRM gateway single endpoint (`/database_rest?action=...`)

## Implemented modules

- `src/modules/instances`
- `src/modules/snapshots`
- `src/modules/compare`
- `src/modules/changesets`
- `src/modules/executions`
- `src/modules/jobs` (queue + SSE)
- `src/modules/auth` (JWT/RBAC wiring documented)
- `src/modules/crmConnector`

## Setup

1. Install dependencies:

```bash
npm install
```

2. Configure env:

```bash
cp .env.example .env
```

3. Run migrations:

```bash
npm run migration:run
```

4. Start API:

```bash
npm run dev
```

## Mock CRM for end-to-end

Run the mock CRM gateway server:

```bash
npm run mock:crm
```

Set instance `crmBaseUrl` to `http://localhost:4100`.

## API contract docs

- OpenAPI: `openapi.yaml`
- Curl examples: `docs/curl-examples.md`

## Frontend UI

Next.js frontend is under `frontend/`.

```bash
cd frontend
npm install
npm run dev
```

Frontend docs and e2e flow: `frontend/README.md`

## Stack for run
Need to run both, backend and frontend.
Use `npm run dev` for backend and frontend/`npm run dev` for frontend.

## Testing

```bash
npm run typecheck
npm test
npm run test:contract
```

`tests/run-tests.ts` covers:

- stable key normalization
- changeset step validation
- matrix pagination

`tests/contract/run-contract-tests.ts` covers CRM contract/integration behavior against in-memory mock gateways with Oracle and MariaDB fixtures.
