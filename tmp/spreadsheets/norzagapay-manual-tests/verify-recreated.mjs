import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';
const path='C:/Users/user/Desktop/MySystems/NorzAgapay/outputs/norzagapay-manual-test-plan-20261021/NorzAgapay_Manual_Test_Cases.xlsx';
const wb=await SpreadsheetFile.importXlsx(await FileBlob.load(path));
const sheet=wb.worksheets.getItem('Test Cases');
const used=sheet.getUsedRange();
const headers=sheet.getRange('A1:I1').values[0];
const statuses=sheet.getRange('I2:I154').values.flat();
const tables=sheet.tables.items;
console.log(JSON.stringify({usedAddress:used.address,headers,statusCount:statuses.length,allPass:statuses.every(value=>value==='Pass'),uniqueStatuses:[...new Set(statuses)],tables:tables.map(table=>({name:table.name,showFilterButton:table.showFilterButton})),firstCase:sheet.getRange('A2:I2').values[0],lastCase:sheet.getRange('A154:I154').values[0]},null,2));
