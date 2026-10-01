export function selectTransferGroup(requestUrl, groups) {
  const id = new URL(requestUrl).searchParams.get("group");
  if (!id) return null;
  const group = groups.find((entry) => String(entry.id) === id && entry.isActive);
  if (!group) throw new Response("Active wholesale group not found.", { status: 404 });
  return group;
}

export function scopedImportFields(baseFields, groupFields, selectedGroup) {
  if (!selectedGroup) return [...baseFields, ...groupFields];
  const priceField = groupFields.find((field) => field.customerTag === selectedGroup.customerTag);
  return [baseFields.find((field) => field.key === "SKU"), {
    ...priceField, label: "Wholesale Price", required: true,
    aliases: [...priceField.aliases, "wholesale price", "b2b price", "trade price"],
    help: `Required. Updates only ${selectedGroup.name}. Blank cells are ignored; null or 0 clears this group's price.`,
  }];
}

export function groupExportRow(sku, groupPrices, group) {
  const price = Number(groupPrices?.[group.customerTag]);
  return { SKU: sku || "", "Wholesale Price": price > 0 ? price : null };
}
