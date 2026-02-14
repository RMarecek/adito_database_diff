import assert from "node:assert/strict";
import {
  alignToBaselinePlan,
  columnDiffs,
  indexDiffs,
  multiInstanceDiff,
  similarityScore,
  tableKey,
  columnKey,
  indexKey,
  tablePresenceMatrix,
  type SnapshotSpec,
} from "../src/index";
import {
  baselineSnapshot,
  cloneSnapshot,
  identicalSnapshot,
  sparseSnapshot,
  targetSnapshot,
} from "./fixtures";

type TestCase = {
  name: string;
  run: () => void;
};

const tests: TestCase[] = [];
const add = (name: string, run: () => void): void => {
  tests.push({ name, run });
};

const table = (snapshot: SnapshotSpec, key: string) =>
  snapshot.tables.find((item) => item.tableKey.toUpperCase() === key.toUpperCase()) ?? null;

add("keys: tableKey normalizes", () => {
  assert.equal(tableKey(" crm ", "customers "), "CRM.CUSTOMERS");
});

add("keys: columnKey normalizes", () => {
  assert.equal(columnKey("crm", "customers", "email"), "CRM.CUSTOMERS.EMAIL");
});

add("keys: indexKey normalizes", () => {
  assert.equal(indexKey("crm", "customers", "idx_mail"), "CRM.CUSTOMERS.IDX_MAIL");
});

add("keys: deterministic for same inputs", () => {
  assert.equal(tableKey("CRM", "CUSTOMERS"), tableKey("crm", "customers"));
});

add("presence matrix: union row count", () => {
  const matrix = tablePresenceMatrix([baselineSnapshot, targetSnapshot, sparseSnapshot]);
  assert.equal(matrix.rows.length, 4);
});

add("presence matrix: row ordering is stable", () => {
  const matrix = tablePresenceMatrix([baselineSnapshot, targetSnapshot, sparseSnapshot]);
  assert.deepEqual(
    matrix.rows.map((row) => row.tableKey),
    ["CRM.AUDIT_LOG", "CRM.CUSTOMERS", "CRM.EXTRA_TARGET_ONLY", "CRM.ORDERS"],
  );
});

add("presence matrix: presence cells are correct", () => {
  const matrix = tablePresenceMatrix([baselineSnapshot, targetSnapshot, sparseSnapshot]);
  const orders = matrix.rows.find((row) => row.tableKey === "CRM.ORDERS");
  assert.ok(orders);
  assert.equal(orders.cells[baselineSnapshot.snapshotId]?.present, true);
  assert.equal(orders.cells[targetSnapshot.snapshotId]?.present, false);
  assert.equal(orders.cells[sparseSnapshot.snapshotId]?.present, false);
});

add("presence matrix: deterministic output", () => {
  const a = tablePresenceMatrix([baselineSnapshot, targetSnapshot, sparseSnapshot]);
  const b = tablePresenceMatrix([baselineSnapshot, targetSnapshot, sparseSnapshot]);
  assert.deepEqual(a, b);
});

add("column diff: detects ID type diff", () => {
  const diffs = columnDiffs(table(baselineSnapshot, "CRM.CUSTOMERS"), table(targetSnapshot, "CRM.CUSTOMERS"));
  const id = diffs.find((d) => d.columnName === "ID");
  assert.ok(id);
  assert.equal(id.typeDiff, true);
});

add("column diff: detects EMAIL type/length diff", () => {
  const diffs = columnDiffs(table(baselineSnapshot, "CRM.CUSTOMERS"), table(targetSnapshot, "CRM.CUSTOMERS"));
  const email = diffs.find((d) => d.columnName === "EMAIL");
  assert.ok(email);
  assert.equal(email.typeDiff, true);
});

add("column diff: detects STATUS nullable diff", () => {
  const diffs = columnDiffs(table(baselineSnapshot, "CRM.CUSTOMERS"), table(targetSnapshot, "CRM.CUSTOMERS"));
  const status = diffs.find((d) => d.columnName === "STATUS");
  assert.ok(status);
  assert.equal(status.nullableDiff, true);
});

add("column diff: detects STATUS default diff", () => {
  const diffs = columnDiffs(table(baselineSnapshot, "CRM.CUSTOMERS"), table(targetSnapshot, "CRM.CUSTOMERS"));
  const status = diffs.find((d) => d.columnName === "STATUS");
  assert.ok(status);
  assert.equal(status.defaultDiff, true);
});

add("column diff: reports extra target column", () => {
  const diffs = columnDiffs(table(baselineSnapshot, "CRM.CUSTOMERS"), table(targetSnapshot, "CRM.CUSTOMERS"));
  const legacy = diffs.find((d) => d.columnName === "LEGACY_CODE");
  assert.ok(legacy);
  assert.equal(legacy.inBaseline, false);
  assert.equal(legacy.inTarget, true);
});

add("index diff: ignore names treats same definition as match", () => {
  const diffs = indexDiffs(table(baselineSnapshot, "CRM.CUSTOMERS"), table(targetSnapshot, "CRM.CUSTOMERS"), {
    ignoreIndexName: true,
  });
  const missingInTarget = diffs.filter((d) => d.missingInTarget);
  assert.equal(missingInTarget.length, 0);
});

add("index diff: ignore names still catches extra target index", () => {
  const diffs = indexDiffs(table(baselineSnapshot, "CRM.CUSTOMERS"), table(targetSnapshot, "CRM.CUSTOMERS"), {
    ignoreIndexName: true,
  });
  const missingInBaseline = diffs.filter((d) => d.missingInBaseline);
  assert.equal(missingInBaseline.length, 1);
});

add("index diff: strict name mode flags renamed index", () => {
  const diffs = indexDiffs(table(baselineSnapshot, "CRM.CUSTOMERS"), table(targetSnapshot, "CRM.CUSTOMERS"), {
    ignoreIndexName: false,
  });
  const missingInTarget = diffs.filter((d) => d.missingInTarget);
  assert.ok(missingInTarget.length >= 1);
});

add("index diff: deterministic ordering of definition keys", () => {
  const diffs = indexDiffs(table(baselineSnapshot, "CRM.CUSTOMERS"), table(targetSnapshot, "CRM.CUSTOMERS"), {
    ignoreIndexName: true,
  });
  const keys = diffs.map((d) => d.definitionKey);
  const sorted = [...keys].sort((a, b) => a.localeCompare(b));
  assert.deepEqual(keys, sorted);
});

add("index diff: null target marks all baseline indexes missing", () => {
  const diffs = indexDiffs(table(baselineSnapshot, "CRM.CUSTOMERS"), null, { ignoreIndexName: true });
  assert.equal(diffs.every((d) => d.missingInTarget), true);
  assert.equal(diffs.length, 2);
});

add("multi-instance diff: default baseline uses first snapshot", () => {
  const diff = multiInstanceDiff([baselineSnapshot, targetSnapshot, sparseSnapshot]);
  assert.equal(diff.baselineSnapshotId, baselineSnapshot.snapshotId);
});

add("multi-instance diff: includes table presence rows", () => {
  const diff = multiInstanceDiff([baselineSnapshot, targetSnapshot, sparseSnapshot]);
  assert.equal(diff.tablePresence.rows.length, 4);
});

add("multi-instance diff: CUSTOMERS has column diffs for target snapshot", () => {
  const diff = multiInstanceDiff([baselineSnapshot, targetSnapshot]);
  const customers = diff.tableDiffs.find((t) => t.tableKey === "CRM.CUSTOMERS");
  assert.ok(customers);
  const items = customers.columnDiffsBySnapshotId[targetSnapshot.snapshotId] ?? [];
  assert.ok(items.some((item) => item.typeDiff || item.nullableDiff || item.defaultDiff));
});

add("multi-instance diff: missing table in sparse snapshot yields missing column records", () => {
  const diff = multiInstanceDiff([baselineSnapshot, sparseSnapshot]);
  const orders = diff.tableDiffs.find((t) => t.tableKey === "CRM.ORDERS");
  assert.ok(orders);
  const items = orders.columnDiffsBySnapshotId[sparseSnapshot.snapshotId] ?? [];
  assert.ok(items.every((item) => item.inTarget === false || item.inBaseline === true));
});

add("similarity: identical snapshots score 1", () => {
  const result = similarityScore(baselineSnapshot, identicalSnapshot);
  assert.equal(result.score, 1);
});

add("similarity: variant target scores lower than identical", () => {
  const identical = similarityScore(baselineSnapshot, identicalSnapshot).score;
  const variant = similarityScore(baselineSnapshot, targetSnapshot).score;
  assert.ok(variant < identical);
});

add("similarity: ignoreIndexName=true scores higher than strict for renamed indexes", () => {
  const lax = similarityScore(baselineSnapshot, targetSnapshot, { ignoreIndexName: true });
  const strict = similarityScore(baselineSnapshot, targetSnapshot, { ignoreIndexName: false });
  assert.ok(lax.score > strict.score);
});

add("similarity: custom table-only weights equal table jaccard", () => {
  const result = similarityScore(baselineSnapshot, targetSnapshot, {
    weights: { table: 1, column: 0, index: 0 },
  });
  assert.equal(result.score, result.components.tableJaccard);
});

add("planner: creates missing table ORDERS", () => {
  const plan = alignToBaselinePlan({
    baseline: baselineSnapshot,
    target: targetSnapshot,
    include: { columns: true, indexes: true },
    allowDestructive: false,
  });
  assert.ok(plan.steps.some((step) => step.action === "CREATE_TABLE" && step.target.table === "ORDERS"));
});

add("planner: adds missing baseline column", () => {
  const modified = cloneSnapshot(targetSnapshot);
  const customers = table(modified, "CRM.CUSTOMERS");
  assert.ok(customers);
  customers.columns = customers.columns.filter((column) => column.name !== "EMAIL");
  const plan = alignToBaselinePlan({
    baseline: baselineSnapshot,
    target: modified,
    include: { columns: true, indexes: false },
    allowDestructive: false,
    tableKeys: ["CRM.CUSTOMERS"],
  });
  assert.ok(plan.steps.some((step) => step.action === "ADD_COLUMN" && step.column?.name === "EMAIL"));
});

add("planner: safe widen produces ALTER_COLUMN", () => {
  const plan = alignToBaselinePlan({
    baseline: baselineSnapshot,
    target: targetSnapshot,
    include: { columns: true, indexes: false },
    allowDestructive: false,
    tableKeys: ["CRM.CUSTOMERS"],
  });
  assert.ok(plan.steps.some((step) => step.action === "ALTER_COLUMN" && step.column?.name === "ID"));
});

add("planner: unsafe nullable tightening blocked when non-destructive", () => {
  const plan = alignToBaselinePlan({
    baseline: baselineSnapshot,
    target: targetSnapshot,
    include: { columns: true, indexes: false },
    allowDestructive: false,
    tableKeys: ["CRM.CUSTOMERS"],
  });
  assert.ok(plan.blockingIssues.some((issue) => issue.code === "UNSAFE_ALTER_BLOCKED" && issue.columnName === "STATUS"));
});

add("planner: non-destructive mode never emits drops", () => {
  const plan = alignToBaselinePlan({
    baseline: baselineSnapshot,
    target: targetSnapshot,
    include: { columns: true, indexes: true },
    allowDestructive: false,
  });
  assert.equal(plan.steps.some((step) => step.action === "DROP_COLUMN" || step.action === "DROP_INDEX"), false);
});

add("planner: destructive mode can drop extras", () => {
  const plan = alignToBaselinePlan({
    baseline: baselineSnapshot,
    target: targetSnapshot,
    include: { columns: true, indexes: true },
    allowDestructive: true,
    tableKeys: ["CRM.CUSTOMERS"],
  });
  assert.ok(plan.steps.some((step) => step.action === "DROP_COLUMN" && step.column?.name === "LEGACY_CODE"));
  assert.ok(plan.steps.some((step) => step.action === "DROP_INDEX" && step.index?.name === "IDX_OLD_LEGACY"));
});

add("planner: destructive mode records warning for unsafe alter", () => {
  const plan = alignToBaselinePlan({
    baseline: baselineSnapshot,
    target: targetSnapshot,
    include: { columns: true, indexes: false },
    allowDestructive: true,
    tableKeys: ["CRM.CUSTOMERS"],
  });
  assert.ok(plan.warnings.some((issue) => issue.code === "UNSAFE_ALTER_ALLOWED" && issue.columnName === "STATUS"));
});

add("planner: deterministic for same inputs", () => {
  const a = alignToBaselinePlan({
    baseline: baselineSnapshot,
    target: targetSnapshot,
    include: { columns: true, indexes: true },
    allowDestructive: true,
  });
  const b = alignToBaselinePlan({
    baseline: baselineSnapshot,
    target: targetSnapshot,
    include: { columns: true, indexes: true },
    allowDestructive: true,
  });
  assert.deepEqual(a, b);
});

add("planner: include.columns=false excludes column actions", () => {
  const plan = alignToBaselinePlan({
    baseline: baselineSnapshot,
    target: targetSnapshot,
    include: { columns: false, indexes: true },
    allowDestructive: true,
  });
  assert.equal(
    plan.steps.some((step) => step.action === "ADD_COLUMN" || step.action === "ALTER_COLUMN" || step.action === "DROP_COLUMN"),
    false,
  );
});

add("planner: include.indexes=false excludes index actions", () => {
  const plan = alignToBaselinePlan({
    baseline: baselineSnapshot,
    target: targetSnapshot,
    include: { columns: true, indexes: false },
    allowDestructive: true,
  });
  assert.equal(plan.steps.some((step) => step.action === "CREATE_INDEX" || step.action === "DROP_INDEX"), false);
});

add("planner: tableKeys filter limits plan scope", () => {
  const plan = alignToBaselinePlan({
    baseline: baselineSnapshot,
    target: targetSnapshot,
    include: { columns: true, indexes: true },
    allowDestructive: true,
    tableKeys: ["CRM.CUSTOMERS"],
  });
  assert.equal(plan.steps.some((step) => step.target.table === "ORDERS"), false);
});

let failed = 0;
for (const test of tests) {
  try {
    test.run();
    // eslint-disable-next-line no-console
    console.log(`PASS: ${test.name}`);
  } catch (err) {
    failed += 1;
    // eslint-disable-next-line no-console
    console.error(`FAIL: ${test.name}`);
    // eslint-disable-next-line no-console
    console.error(err);
  }
}

if (failed > 0) {
  process.exitCode = 1;
  // eslint-disable-next-line no-console
  console.error(`\n${failed}/${tests.length} tests failed`);
} else {
  // eslint-disable-next-line no-console
  console.log(`\n${tests.length}/${tests.length} tests passed`);
}
