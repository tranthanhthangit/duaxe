import ExcelJS from 'exceljs';
import { parse } from 'csv-parse/sync';
import { unzipSync } from 'fflate';
import type { ImportRow } from '../../shared/classroom';
export async function parseRoster(bytes:Buffer,format:string,existing:string[]):Promise<ImportRow[]>{
 if(bytes.length>2*1024*1024)throw new Error('Tệp danh sách tối đa 2 MB.');let rows:unknown[][];
 if(format==='xlsx'){
  let total=0,count=0;unzipSync(bytes,{filter:entry=>{total+=entry.originalSize;if(total>12*1024*1024||++count>200)throw new Error('Workbook giải nén quá lớn.');return false;}});
  const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(bytes as never);const sheet=workbook.worksheets[0];if(!sheet)throw new Error('Không có sheet dữ liệu.');if(sheet.rowCount>1001)throw new Error('Tối đa 1000 dòng.');rows=[];sheet.eachRow({includeEmpty:true},row=>rows.push([row.getCell(1).text,row.getCell(2).text]));
 }else if(format==='csv')rows=parse(bytes.toString('utf8'),{bom:true,skip_empty_lines:false,relax_column_count:true,max_record_size:1000});else throw new Error('Chỉ hỗ trợ CSV hoặc XLSX.');
 if(rows.length>1001)throw new Error('Tối đa 1000 dòng.');const seen=new Set(existing.map(n=>n.trim().toLocaleLowerCase('vi')));
 return rows.slice(1).map((cells,i)=>{const fullName=String(cells[0]??'').trim(),displayName=String(cells[1]??fullName).trim(),key=fullName.toLocaleLowerCase('vi'),duplicate=seen.has(key);seen.add(key);return {row:i+2,fullName,displayName,duplicate,...(!fullName||fullName.length>100||!displayName||displayName.length>30?{error:'Thiếu tên hoặc tên vượt giới hạn (họ tên 100, tên hiển thị 30 ký tự).'}:{})};});
}
