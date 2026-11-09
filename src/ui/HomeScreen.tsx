import { useRef, useState } from 'react';
import { DesignBackdrop, type ArtworkState } from './DesignBackdrop';

export default function HomeScreen() {
  const [artwork,setArtwork]=useState<ArtworkState>('loading');
  const instructions=useRef<HTMLDialogElement>(null);
  return <main className="home-screen" data-art={artwork}>
    <div className="home-scene">
      <DesignBackdrop kind="home" onStatus={setArtwork}/>
      <div className="home-title"><p>VUI HỌC CÙNG CÔ</p><h1>Đường đua <span>Tri thức</span></h1><p>Mỗi câu trả lời, một bước tiến!</p></div>
      <nav className="home-actions" aria-label="Bắt đầu khám phá">
        <a className="game-button game-button-orange" href="?mode=teacher&fresh=1"><span aria-hidden="true">⚑</span><span>Tạo phòng chơi<small>Dành cho cô giáo</small></span><span aria-hidden="true">→</span></a>
        <a className="game-button game-button-blue" href="?mode=student"><span aria-hidden="true">🚗</span><span>Tham gia phòng<small>Bé cùng tranh tài</small></span><span aria-hidden="true">→</span></a>
        <button className="game-button game-button-cream" onClick={()=>instructions.current?.showModal()}><span aria-hidden="true">📖</span>Hướng dẫn chơi</button>
        <a className="game-button game-button-cream" href="?mode=teacher&fresh=1#teacher-account"><span aria-hidden="true">👩‍🏫</span>Tài khoản giáo viên</a>
      </nav>
      <a className="home-solo" href="?mode=solo">Chơi thử một mình →</a>
    </div>
    <dialog className="how-to-play" ref={instructions} aria-labelledby="instructions-title" onClick={e=>{if(e.target===e.currentTarget)instructions.current?.close();}}>
      <div className="dialog-heading"><h2 id="instructions-title">Cùng bé chinh phục đường đua!</h2><button autoFocus aria-label="Đóng hướng dẫn" onClick={()=>instructions.current?.close()}>×</button></div>
      <ol><li><b>Cô tạo phòng</b>, chọn lớp và bộ câu hỏi rồi chia sẻ mã QR hoặc mã phòng.</li><li><b>Bé tham gia</b>, chọn đúng hồ sơ hoặc nhập tên, chọn màu xe và chờ cô bắt đầu.</li><li><b>Trả lời câu hỏi</b>: mỗi câu đúng được 10 điểm và tăng tốc 3 giây. Mỗi câu chỉ trả lời một lần.</li><li><b>Chuyển làn</b> bằng hai nút trái/phải để tránh chóp giao thông. Cô có thể tạm dừng và tiếp tục.</li><li><b>Cùng về đích!</b> Cô xem thứ hạng, chi tiết câu trả lời và xuất kết quả.</li></ol>
      <p>Mất kết nối? Mở lại cùng trình duyệt để lấy lại phiên. Chờ cô xác nhận tiếp tục nếu cuộc đua đã tạm dừng.</p>
      <div className="online-actions"><a className="game-button game-button-blue" href="?mode=solo">Thử đường đua</a><button className="game-button game-button-cream" onClick={()=>instructions.current?.close()}>Đã hiểu rồi!</button></div>
    </dialog>
  </main>;
}
