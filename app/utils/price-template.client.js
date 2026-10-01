export async function downloadPriceTemplate(groups, selectedGroup) {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Prices");
  worksheet.addRow(selectedGroup ? ["SKU", "Wholesale Price"] : ["SKU", ...groups.map((group) => `${group.customerTag} Price`)]);
  worksheet.getRow(1).font = { bold: true };
  worksheet.columns.forEach((column) => { column.width = 24; });
  const url = URL.createObjectURL(new Blob([await workbook.xlsx.writeBuffer()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = selectedGroup ? `group-${selectedGroup.id}-prices-template.xlsx` : "all-group-prices-template.xlsx";
  link.click();
  URL.revokeObjectURL(url);
}
