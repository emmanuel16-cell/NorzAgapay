import { Workbook } from '@oai/artifact-tool';
const wb=Workbook.create(); wb.worksheets.add('S');
console.log(wb.help('range.dataValidation', { include: 'index,examples,notes', maxChars: 3000 }).ndjson);
