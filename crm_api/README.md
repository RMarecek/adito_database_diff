# CRM DB Gateway `/database_rest`

This repository now includes a Rhino REST webservice implementation for the CRM Database Gateway API v1.

## Deliverables

- `openapi.yaml`
- `process/database_rest/process.js`
- `process/database_rest/database_rest.aod`

## Run/Deploy

1. Import/build this Adito project as usual.
2. Ensure process `database_rest` is deployed as REST webservice (`process/database_rest/database_rest.aod`).
3. Call endpoint:
   - Spec path: `/database_rest`
   - In Adito runtime this is typically exposed under `/services/rest/database_rest`

## Assumptions and Notes

- Metadata export, validation, and execution now call the configured DB alias directly via `db.*` APIs.
- All responses include `correlationId` in body and `X-Correlation-Id` in response headers.
- `X-Correlation-Id` request header is accepted; if missing/invalid, a UUIDv4 is generated.
- Action/method compatibility is strict:
  - GET: `health`, `db_info`, `ddl_execution_status`, `ddl_execution_logs`
  - POST: `metadata_export`, `ddl_validate`, `ddl_execute`
  - Unknown or mismatched action returns `400 INVALID_ARGUMENT`.
- `ddl_validate` performs validation + SQL preview only (no execution).
- `ddl_execute` uses in-memory execution state tracking but runs generated DDL against the configured alias via `db.runStatement(...)`.
- `.aod` currently uses `internal.none` login placeholder and must be hardened for production security policy.
- `metadata_export` now defaults to a performance-optimized Oracle path:
  - skips expensive `DATA_DEFAULT` (`LONG`) reads unless explicitly requested
  - skips index expression joins unless explicitly requested
  - uses per-table in-memory metadata cache for repeated requests
  - chunks table-name lists in dictionary queries

## Metadata Export Performance Options (Backward Compatible)

`POST /database_rest?action=metadata_export` supports optional `options`:

```json
{
  "schema": "CRM",
  "include": { "tables": true, "columns": true, "indexes": true },
  "filters": { "includeViews": false, "includeSystemIndexes": false },
  "page": { "pageSize": 200, "pageToken": null },
  "options": {
    "detailLevel": "fast",
    "includeColumnDefaults": false,
    "includeColumnComments": false,
    "includeIndexExpressions": false,
    "matchByTableNameOnly": false,
    "comparisonSchema": "__TABLE_ONLY__",
    "useCache": true,
    "cacheTtlSeconds": 120,
    "maxObjectsPerPage": 80
  }
}
```

Notes:
- `detailLevel`: `fast` (default) or `full`
- `full` implies defaults/comments/index expressions enabled unless explicitly overridden
- Response shape stays unchanged; omitted expensive fields are returned as `null`
- `matchByTableNameOnly=true` rewrites all returned `schema` values to `comparisonSchema` (default `__TABLE_ONLY__`) so clients can compare by table name across different physical schemas.
- Two ready-to-use connector payload examples are provided in `connector-metadata-export-config.example.json`.
- Compare-service API proposal for schema-agnostic table-name matching is documented in `COMPARE_API_PROPOSAL_TABLE_NAME_MODE.md`.

## Step Validation Rules (Implemented)

- `stepId` must be UUIDv4.
- `action` must be one of:
  - `CREATE_TABLE`, `DROP_TABLE`, `ADD_COLUMN`, `DROP_COLUMN`, `ALTER_COLUMN`, `RENAME_TABLE`, `RENAME_COLUMN`, `CREATE_INDEX`, `DROP_INDEX`
- `target.schema` and `target.table` are required.
- Ambiguous payloads are rejected: only one of `table`, `column`, `index` can be present.
- Per action required payload:
  - `CREATE_TABLE` -> `table` (with `table.columns` non-empty)
  - `DROP_TABLE` -> no `table`/`column`/`index`
  - `ADD_COLUMN`/`DROP_COLUMN`/`ALTER_COLUMN`/`RENAME_COLUMN` -> `column` with `column.name`
  - `RENAME_TABLE` -> `options.newTableName`
  - `RENAME_COLUMN` -> `options.newColumnName`
  - `CREATE_INDEX` -> `index` with `index.name` and non-empty `index.columns`
  - `DROP_INDEX` -> `index` with `index.name`
- `options.ifExists` and `options.ifNotExists` cannot both be `true`.
- With `strict=true`, unsupported index `whereClause` is a blocking issue.

## SQL Preview Rules (Implemented)

- Oracle examples:
  - `ALTER TABLE schema.table ADD (...)`
  - `ALTER TABLE schema.table MODIFY (...)`
  - `CREATE [UNIQUE] INDEX schema.index ON schema.table (...)`
  - `DROP INDEX schema.index`
- MariaDB examples:
  - `ALTER TABLE schema.table ADD COLUMN ...`
  - `ALTER TABLE schema.table MODIFY COLUMN ...`
  - `CREATE [UNIQUE] INDEX index ON schema.table (...)`
  - `DROP INDEX index ON schema.table`

## Example cURL Requests/Responses

### 1) Health

```bash
curl -i "https://crm.example.com/database_rest?action=health"
```

```json
{
  "correlationId": "11111111-1111-4111-8111-111111111111",
  "status": "ok",
  "service": "crm-db-gateway",
  "version": "1.0.0",
  "time": "2026-02-13T18:22:11.123Z"
}
```

### 2) DB Info

```bash
curl -i "https://myworkplace-ent:7779/service/rest/database_rest?action=db_info" -H "X-Correlation-Id: 22222222-2222-4222-8222-222222222222"
```

```json
{
  "correlationId": "22222222-2222-4222-8222-222222222222",
  "db": {
    "type": "oracle",
    "version": "19c",
    "defaultSchema": "CRM"
  }
}
```

### 3) Metadata Export (paged)

```bash
curl -i -X POST "https://crm.example.com/database_rest?action=metadata_export" -H "Content-Type: application/json" -d '{"schema": "CRM","include": { "tables": true, "columns": true, "indexes": true },  "filters": {      "tableNameLike": "PERS%",      "tableNames": null,      "includeViews": false,      "includeSystemIndexes": false    },    "page": { "pageSize": 200, "pageToken": null }  }'
```

```json
{
  "correlationId": "33333333-3333-4333-8333-333333333333",
  "db": { "type": "oracle", "version": "19c" },
  "generatedAt": "2026-02-13T18:22:11.123Z",
  "page": { "pageSize": 200, "nextPageToken": null },
  "tables": [
    {
      "schema": "CRM",
      "name": "CUSTOMERS",
      "isView": false,
      "comment": null,
      "storage": { "engine": null, "tablespace": "CRM_DATA" }
    }
  ],
  "columns": [
    {
      "schema": "CRM",
      "table": "CUSTOMERS",
      "name": "EMAIL",
      "ordinalPosition": 5,
      "nativeType": "VARCHAR2(255 CHAR)",
      "canonicalType": "STRING",
      "length": 255,
      "precision": null,
      "scale": null,
      "nullable": true,
      "defaultRaw": null,
      "comment": null,
      "charset": null,
      "collation": null
    }
  ],
  "indexes": [
    {
      "schema": "CRM",
      "table": "CUSTOMERS",
      "name": "IDX_CUSTOMERS_EMAIL",
      "unique": false,
      "indexType": "BTREE",
      "tablespace": "CRM_IDX",
      "whereClause": null,
      "columns": [
        { "name": "EMAIL", "position": 1, "direction": "ASC", "expression": null }
      ]
    }
  ]
}
```

### 4) Validate DDL

```bash
curl -i -X POST "https://crm.example.com/database_rest?action=ddl_validate" \
  -H "Content-Type: application/json" \
  -d '{
    "schema": "CRM",
    "steps": [
      {
        "stepId": "44444444-4444-4444-8444-444444444444",
        "action": "ADD_COLUMN",
        "target": { "schema": "CRM", "table": "CUSTOMERS" },
        "table": null,
        "column": {
          "name": "EMAIL",
          "ordinalPosition": 5,
          "canonicalType": "STRING",
          "nativeType": "VARCHAR2(255 CHAR)",
          "length": 255,
          "precision": null,
          "scale": null,
          "nullable": true,
          "defaultRaw": null,
          "comment": null,
          "charset": null,
          "collation": null
        },
        "index": null,
        "options": { "ifExists": false, "ifNotExists": true }
      }
    ],
    "options": { "returnSqlPreview": true, "strict": true }
  }'
```

```json
{
  "correlationId": "55555555-5555-4555-8555-555555555555",
  "db": { "type": "oracle", "version": "19c" },
  "valid": true,
  "results": [
    {
      "stepId": "44444444-4444-4444-8444-444444444444",
      "valid": true,
      "blockingIssues": [],
      "warnings": [],
      "sqlPreview": [
        "ALTER TABLE CRM.CUSTOMERS ADD (EMAIL VARCHAR2(255 CHAR))"
      ],
      "estimatedLocking": "MEDIUM"
    }
  ]
}
```

### 5) Execute DDL + Poll Status

```bash
curl -i -X POST "https://crm.example.com/database_rest?action=ddl_execute" \
  -H "Content-Type: application/json" \
  -d '{
    "requestId": "66666666-6666-4666-8666-666666666666",
    "schema": "CRM",
    "changeSet": { "id": "77777777-7777-4777-8777-777777777777", "title": "Align schema" },
    "steps": [
      {
        "stepId": "44444444-4444-4444-8444-444444444444",
        "action": "ADD_COLUMN",
        "target": { "schema": "CRM", "table": "CUSTOMERS" },
        "table": null,
        "column": {
          "name": "EMAIL",
          "ordinalPosition": 5,
          "canonicalType": "STRING",
          "nativeType": "VARCHAR2(255 CHAR)",
          "length": 255,
          "precision": null,
          "scale": null,
          "nullable": true,
          "defaultRaw": null,
          "comment": null,
          "charset": null,
          "collation": null
        },
        "index": null,
        "options": { "ifExists": false, "ifNotExists": true }
      }
    ],
    "options": { "stopOnError": true, "lockTimeoutSeconds": 60 }
  }'
```

```json
{
  "correlationId": "88888888-8888-4888-8888-888888888888",
  "executionId": "99999999-9999-4999-8999-999999999999",
  "status": "QUEUED",
  "submittedAt": "2026-02-13T18:22:11.123Z"
}
```

```bash
curl -i "https://crm.example.com/database_rest?action=ddl_execution_status&executionId=99999999-9999-4999-8999-999999999999"
```

```json
{
  "correlationId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "executionId": "99999999-9999-4999-8999-999999999999",
  "status": "RUNNING",
  "submittedAt": "2026-02-13T18:22:11.123Z",
  "startedAt": "2026-02-13T18:22:20.000Z",
  "endedAt": null,
  "stepResults": [
    {
      "stepId": "44444444-4444-4444-8444-444444444444",
      "status": "SUCCEEDED",
      "startedAt": "2026-02-13T18:22:21.000Z",
      "endedAt": "2026-02-13T18:22:21.500Z",
      "sqlExecuted": [
        "ALTER TABLE CRM.CUSTOMERS ADD (EMAIL VARCHAR2(255 CHAR))"
      ],
      "error": null
    }
  ]
}
```
