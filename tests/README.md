# Test Suites

## Unit tests

```bash
npm test
```

## Contract/integration tests (CRM <-> backend API)

Runs an in-memory mock CRM gateway (single `/database_rest?action=...` endpoint contract) and verifies:

- Snapshot paging ingestion
- Validate forwarding to CRM `ddl_validate`
- Execute flow with CRM `ddl_execute` + status/log polling
- Oracle and MariaDB fixture shapes

Run:

```bash
npm run test:contract
```

## Windows notes

- Commands are Windows-safe (`cmd /c ...` not required in npm scripts).
- Contract tests run with in-memory repositories (no external DB required).
