# Schema Compare Frontend (Next.js)

## Stack

- Next.js + TypeScript (`app/` router)
- TanStack Query for data fetching/mutations
- MUI + MUI DataGrid (virtualized compare matrix)
- SSE client via `@microsoft/fetch-event-source`

## Routes

- `/instances`
- `/snapshots`
- `/compare/new`
- `/compare/[id]`
- `/tables/[tableKey]`
- `/changesets`
- `/changesets/[id]`
- `/executions/[id]`
- `/audit`

## Run

1. Start backend (`http://localhost:3000/api/v1`)
2. Start frontend:

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:3100`.

Set API URL if needed:

```bash
NEXT_PUBLIC_API_BASE_URL=http://localhost:3000/api/v1
```

## Basic e2e flow

1. Paste JWT in top bar (`roles` should include at least `viewer`, `editor`, `executor` as needed).
2. `/instances`: click `Snapshot now` for instances.
3. `/compare/new`: pick 2+ instances, choose baseline, create compare run.
4. `/compare/[id]`: select rows and create changeset from selected tables.
5. `/changesets/[id]`: reorder steps, validate target instances, execute.
6. `/executions/[id]`: watch polling status + SSE job events/logs.
