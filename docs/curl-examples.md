# Curl Examples

## 1) Start services

```bash
# terminal A
npm run mock:crm

# terminal B
npm run migration:run
npm run dev
```

## 2) Generate JWT (admin role)

```bash
node -e "const jwt=require('jsonwebtoken');console.log(jwt.sign({sub:'demo-admin',roles:['admin','viewer','editor','executor','approver']},'change-me',{issuer:'schema-compare-api',audience:'schema-compare',expiresIn:'1h'}))"
```

Set token and base URL:

```bash
export TOKEN="<paste-token>"
export API="http://localhost:3000/api/v1"
```

PowerShell:

```powershell
$env:TOKEN="<paste-token>"
$env:API="http://localhost:3000/api/v1"
```

## 3) Create an instance (mock CRM)

```bash
curl -X POST "$API/instances" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Correlation-Id: 11111111-1111-4111-8111-111111111111" \
  -H "Content-Type: application/json" \
  -d '{
    "name":"TEST-1",
    "environment":"test",
    "crmBaseUrl":"http://localhost:4100",
    "dbType":"oracle",
    "defaultSchema":"CRM",
    "capabilities":{"read":true,"write":true},
    "authRef":"mock-token"
  }'
```

Save `instanceId` from response.

## 4) Start snapshot

```bash
curl -X POST "$API/instances/<instanceId>/snapshots" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"schema":"CRM","filters":{"tableNameLike":null,"includeViews":false}}'
```

Save `snapshotId` and `jobId`.

## 5) Poll snapshot status

```bash
curl "$API/snapshots/<snapshotId>" -H "Authorization: Bearer $TOKEN"
```

## 6) Create compare run

```bash
curl -X POST "$API/compare-runs" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "baselineSnapshotId":"<snapshotId>",
    "snapshotIds":["<snapshotId>"],
    "options":{"matchIndexByDefinition":true,"ignoreIndexName":true,"ignoreColumnOrder":false}
  }'
```

Save `compareRunId`.

## 7) Get compare matrix

```bash
curl "$API/compare-runs/<compareRunId>/matrix?level=table&onlyDifferences=false&offset=0&limit=200" \
  -H "Authorization: Bearer $TOKEN"
```

## 8) Create a changeset

```bash
curl -X POST "$API/changesets" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Align CUSTOMERS schema","description":"Generated from compare","sourceCompareRunId":"<compareRunId>"}'
```

Save `changeSetId`.

## 9) Auto-plan from compare

```bash
curl -X POST "$API/changesets/<changeSetId>/plan/from-compare" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "compareRunId":"<compareRunId>",
    "tableKeys":["CRM.CUSTOMERS"],
    "targets":{"baselineInstanceId":"<instanceId>","targetInstanceIds":["<instanceId>"]},
    "include":{"tables":false,"columns":true,"indexes":true},
    "strategy":{"alignToBaseline":true,"allowDestructive":false}
  }'
```

## 10) Validate changeset

```bash
curl -X POST "$API/changesets/<changeSetId>/validate" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "targetInstanceIds":["<instanceId>"],
    "options":{"returnSqlPreview":true,"strict":true}
  }'
```

## 11) Execute changeset

```bash
curl -X POST "$API/changesets/<changeSetId>/execute" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"targetInstanceIds":["<instanceId>"],"options":{"stopOnError":true}}'
```

Save `executionId` and `jobId`.

## 12) View execution status + logs

```bash
curl "$API/executions/<executionId>" -H "Authorization: Bearer $TOKEN"
```

Live SSE:

```bash
curl "$API/jobs/<jobId>/events" -H "Authorization: Bearer $TOKEN"
```
