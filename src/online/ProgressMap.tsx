import type { PlayerView } from '../../shared/protocol';
import { raceConfig } from '../game/config';
import { GRID_SPACING } from '../game/perspective';
export function ProgressMap({players,onSelect}:{players:PlayerView[];onSelect:(id:string)=>void}){
 const start=-6*GRID_SPACING;
 return <section className="progress-map" aria-label="Bản đồ tiến độ 20 xe"><h2>Bản đồ tiến độ · chọn số xe để theo dõi</h2><div>{[...players].sort((a,b)=>a.number-b.number).map(p=><button key={p.id} title={`#${p.number} ${p.name} · ${Math.round(p.distance)} m · hạng ${p.rank}`} onClick={()=>onSelect(p.id)}><b>#{p.number}</b><span className="mini-track"><i style={{left:`${Math.max(0,Math.min(100,(p.distance-start)/(raceConfig.trackLength-start)*100))}%`,background:'#'+p.color.toString(16).padStart(6,'0')}}/></span><small>{p.boost>0?'⚡':p.rank}</small></button>)}</div></section>;
}
