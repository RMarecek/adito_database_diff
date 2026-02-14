import assert from "node:assert/strict";
import { v4 as uuidv4 } from "uuid";
import { makeColumnKey, makeIndexKey, makeTableKey } from "../src/modules/schema/keys";
import { paginateMatrixRows } from "../src/modules/compare/matrix-pagination";
import { validateChangeStep, validateChangeSteps } from "../src/modules/schema/step-validation";
import type { MatrixRow } from "../src/modules/schema/diff";

const tests: Array<{ name: string; run: () => void }> = [];

const add = (name: string, run: () => void): void => {
  tests.push({ name, run });
};

// normalization tests
add("key normalization: table key uppercase", () => {
  assert.equal(makeTableKey("crm", "customers"), "CRM.CUSTOMERS");
  assert.equal(makeTableKey(" CRM ", " Customers "), "CRM.CUSTOMERS");
});

add("key normalization: column key uppercase", () => {
  assert.equal(makeColumnKey("crm", "customers", "email"), "CRM.CUSTOMERS.EMAIL");
});

add("key normalization: index key uppercase", () => {
  assert.equal(
    makeIndexKey("crm", "customers", "idx_customers_email"),
    "CRM.CUSTOMERS.IDX_CUSTOMERS_EMAIL",
  );
});

// changeset step validation tests
add("changeset validation: valid ADD_COLUMN step accepted", () => {
  const step = {
    stepId: uuidv4(),
    action: "ADD_COLUMN" as const,
    target: { schema: "CRM", table: "CUSTOMERS" },
    table: null,
    column: {
      name: "EMAIL",
      ordinalPosition: 1,
      canonicalType: "STRING" as const,
      nativeType: "VARCHAR2(255 CHAR)",
      length: 255,
      precision: null,
      scale: null,
      nullable: true,
      defaultRaw: null,
      comment: null,
      charset: null,
      collation: null,
    },
    index: null,
    options: { ifNotExists: true },
  };
  assert.doesNotThrow(() => validateChangeStep(step));
  assert.doesNotThrow(() => validateChangeSteps([step]));
});

add("changeset validation: missing column payload rejected", () => {
  const step = {
    stepId: uuidv4(),
    action: "ADD_COLUMN" as const,
    target: { schema: "CRM", table: "CUSTOMERS" },
    table: null,
    column: null,
    index: null,
    options: null,
  };
  assert.throws(() => validateChangeStep(step), /requires column payload/i);
});

// matrix pagination tests
add("matrix pagination: respects offset+limit and keeps total", () => {
  const rows: MatrixRow[] = Array.from({ length: 30 }).map((_, idx) => ({
    objectKey: `CRM.TABLE_${String(idx).padStart(3, "0")}`,
    displayName: `TABLE_${idx}`,
    cells: {
      a: { status: "PRESENT", diff: "NONE" },
    },
    diffSummary: {
      columnsDifferent: 0,
      indexesDifferent: 0,
      missingColumns: 0,
      missingIndexes: 0,
    },
  }));

  const paged = paginateMatrixRows(rows, 10, 5);
  assert.equal(paged.total, 30);
  assert.equal(paged.items.length, 5);
  assert.equal(paged.items[0]?.objectKey, "CRM.TABLE_010");
});

add("matrix pagination: empty page when offset out of range", () => {
  const rows: MatrixRow[] = Array.from({ length: 3 }).map((_, idx) => ({
    objectKey: `CRM.T${idx}`,
    displayName: `T${idx}`,
    cells: { a: { status: "PRESENT", diff: "NONE" } },
    diffSummary: {
      columnsDifferent: 0,
      indexesDifferent: 0,
      missingColumns: 0,
      missingIndexes: 0,
    },
  }));

  const paged = paginateMatrixRows(rows, 10, 10);
  assert.equal(paged.total, 3);
  assert.equal(paged.items.length, 0);
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
