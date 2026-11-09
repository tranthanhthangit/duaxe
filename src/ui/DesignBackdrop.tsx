import { useState } from 'react';

/** Only the original supplied artwork belongs at these paths; no generated substitutes. */
export const designAssets = {
  home: `${import.meta.env.BASE_URL}assets/game-ui/home-background.png`,
  create: `${import.meta.env.BASE_URL}assets/game-ui/create-room-background.png`,
  raceReference: `${import.meta.env.BASE_URL}assets/game-ui/race-background.png`,
};
export type ArtworkState = 'loading' | 'ready' | 'missing';
export function DesignBackdrop({kind,onStatus}:{kind:'home'|'create';onStatus:(state:ArtworkState)=>void}) {
  const [missing,setMissing]=useState(false);
  return <div className="design-backdrop" aria-hidden="true">{!missing&&<img src={designAssets[kind]} alt="" draggable={false}
    onLoad={()=>onStatus('ready')} onError={()=>{setMissing(true);onStatus('missing');}}/>}</div>;
}
