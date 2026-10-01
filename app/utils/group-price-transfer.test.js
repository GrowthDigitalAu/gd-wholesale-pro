/* eslint-env node */
import assert from "node:assert/strict";
import { test } from "node:test";
import { selectTransferGroup, scopedImportFields, groupExportRow } from "./group-price-transfer.js";

const gold = { id: 1, name: "Gold", customerTag: "B2B_gold", isActive: true };
const base = [{ key: "SKU", required: true }, { key: "Price" }, { key: "B2B Price" }];
const fields = [gold, { ...gold, id: 2, customerTag: "B2B_trade" }].map((group) => ({ key: `GROUP_PRICE:${group.customerTag}`, customerTag: group.customerTag, aliases: [] }));

test("group context rejects inactive, foreign, and invalid groups", () => {
  assert.equal(selectTransferGroup("https://app.test/import?group=1", [gold]), gold);
  assert.equal(selectTransferGroup("https://app.test/import", [gold]), null);
  for (const id of ["2", "bad"]) assert.throws(() => selectTransferGroup(`https://app.test/import?group=${id}`, [gold]), (error) => error.status === 404);
  assert.throws(() => selectTransferGroup("https://app.test/import?group=1", [{ ...gold, isActive: false }]), (error) => error.status === 404);
});

test("group import only exposes SKU and the selected group price", () => {
  const selected = scopedImportFields(base, fields, gold);
  assert.deepEqual(selected.map((field) => field.key), ["SKU", "GROUP_PRICE:B2B_gold"]);
  assert.ok(selected.every((field) => field.required));
  assert.ok(selected[1].aliases.includes("wholesale price"));
  assert.equal(scopedImportFields(base, fields, null).length, 5);
});

test("group export is reimportable without exposing other group or retail prices", () => {
  assert.deepEqual(groupExportRow("SKU-1", { B2B_gold: 12, B2B_trade: 9 }, gold), { SKU: "SKU-1", "Wholesale Price": 12 });
  assert.deepEqual(groupExportRow("SKU-2", {}, gold), { SKU: "SKU-2", "Wholesale Price": null });
});
