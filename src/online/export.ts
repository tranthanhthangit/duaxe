import type { Report } from '../../shared/protocol';
export function reportCsv(report:Report) {
 const cell=(value:unknown)=>{let text=String(value??'');if(/^(?:\s*[=+\-@]|[\t\r])/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';};
 const rows:unknown[][]=[['Mã phòng','ID người chơi','ID hồ sơ học sinh','ID ảnh','Tên','Hạng','Điểm','Đúng','Sai','Quãng đường (m)','ID câu hỏi','Câu hỏi','ID đáp án chọn','Đáp án chọn','Đúng/Sai','Thời gian (giây)','Hết giờ','Đáp án đúng']];
 for(const player of report.players)for(const answer of player.answers.length?player.answers:[null])rows.push([report.code,player.id,player.studentId,player.avatarId,player.name,player.rank,player.points,player.correct,player.wrong,player.distance.toFixed(2),answer?.questionId,answer?.questionText,answer?.selectedOptionId,answer?.selectedText,answer?(answer.correct?'Đúng':'Sai'):'',answer?.responseTime.toFixed(2),answer?(answer.timedOut?'Có':'Không'):'',answer?.correctText]);
 return '\uFEFF'+rows.map(row=>row.map(cell).join(',')).join('\r\n');
}
export function downloadReport(report:Report,format:'json'|'csv') {const blob=new Blob([format==='csv'?reportCsv(report):JSON.stringify(report,null,2)],{type:format==='csv'?'text/csv;charset=utf-8':'application/json'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`ket-qua-${report.code}.${format}`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
