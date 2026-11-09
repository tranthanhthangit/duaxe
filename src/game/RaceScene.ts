import type { RoomProfile } from '../../shared/classroom';
import Phaser from 'phaser';
export { Phaser }; // Benchmark must use the same engine instance as the scene.
import { raceConfig as c, type RaceCommand, type RaceSnapshot, type CarState } from './config';
import { projectRoad, cameraTarget, labelPosition, type LabelBox } from './perspective';
import { RaceModel } from './RaceModel';
import { paintRaceEnvironment } from './environment';
import { SnapshotBuffer } from '../online/SnapshotBuffer';
import type { RoomView, PlayerView } from '../../shared/protocol';

export class RaceScene extends Phaser.Scene {
  readonly model = new RaceModel();
  private ink!: Phaser.GameObjects.Graphics;
  private labels: Phaser.GameObjects.Text[] = [];
  private playerLane = 1;
  private reportTimer = 0;
  private remoteTargets: PlayerView[] = [];
  private avatarProfiles:Record<string,RoomProfile>={};
  private avatarSprites=new Map<string,Phaser.GameObjects.Image>();
  private avatarKeys=new Set<string>();
  private avatarLoading=new Set<string>();
  private avatarRevision=0;
  private loadedRevision=-1;
  private disposed=false;
  setAvatars(profiles:Record<string,RoomProfile>){this.avatarProfiles=profiles;this.avatarRevision++;}
  private loadAvatars(){
    if(this.loadedRevision===this.avatarRevision)return;this.loadedRevision=this.avatarRevision;
    const wanted=new Set(Object.values(this.avatarProfiles).filter(p=>p.avatarId&&p.avatarData).map(p=>`avatar-${p.avatarId}`));
    for(const key of this.avatarKeys)if(!wanted.has(key)){for(const sprite of this.avatarSprites.values())if(sprite.texture.key===key)sprite.setTexture("avatar-default");this.textures.remove(key);this.avatarKeys.delete(key);}
    for(const p of Object.values(this.avatarProfiles).slice(0,20)){if(!p.avatarId||!p.avatarData)continue;const key=`avatar-${p.avatarId}`;if(this.textures.exists(key)||this.avatarLoading.has(key))continue;this.avatarLoading.add(key);const image=new Image();
      image.onload=()=>{this.avatarLoading.delete(key);if(this.disposed||!Object.values(this.avatarProfiles).some(v=>v.avatarId===p.avatarId))return;const canvas=document.createElement("canvas");canvas.width=canvas.height=128;const context=canvas.getContext("2d")!;context.save();context.beginPath();context.arc(64,64,60,0,Math.PI*2);context.clip();context.drawImage(image,0,0,128,128);context.restore();context.strokeStyle="white";context.lineWidth=7;context.beginPath();context.arc(64,64,60,0,Math.PI*2);context.stroke();this.textures.addCanvas(key,canvas);this.avatarKeys.add(key);};image.onerror=()=>this.avatarLoading.delete(key);image.src=p.avatarData;
    }
  }
  private labelLayoutAt=0;
  private relayout=true;
  private labelOffsets=new Map<string,{x:number;y:number}|null>();
  private scenery:Phaser.GameObjects.Image[]=[];
  private disabledLayer=new URLSearchParams(location.search).get('off');
  private focusId = 'leaders';
  private snapshots=new SnapshotBuffer();
  private cameraDistance=0;
  private sprites:Phaser.GameObjects.Image[]=[];
  private numbers:Phaser.GameObjects.Text[]=[];
  private cameraRange=430;
  private cameraInitialized=false;
  private labelBoxes:LabelBox[]=[];
  private effects!:Phaser.GameObjects.Graphics;
  private baking=false;
  private backgroundReady=false;
  private finishLabel!:Phaser.GameObjects.Text;
  private frames:number[]=[];
  private statsAt=0;
  constructor(private report: (snapshot: RaceSnapshot) => void, private remote = false) {
    super('race');
    if(remote)this.model.cars=[];
  }
  setRemote(room:RoomView, focusId='leaders') {
    this.snapshots.push(room,performance.now());this.model.status=room.status;if(this.focusId!==focusId)this.labelLayoutAt=0;this.focusId=focusId;
  }
  private label(name:string) {
    return this.add.text(0,0,name,{fontFamily:'sans-serif',fontSize:'12px',wordWrap:{width:142,useAdvancedWrap:true},align:'center',color:'#244356',fontStyle:'bold',backgroundColor:'#ffffffdd',padding:{x:7,y:3}}).setOrigin(.5);
  }
  create() {
    this.ink = this.add.graphics();
    this.finishLabel=this.add.text(450,0,'ĐÍCH',{fontFamily:'sans-serif',fontSize:'20px',fontStyle:'bold',color:'#ffffff',backgroundColor:'#e97469',padding:{x:15,y:5}}).setOrigin(.5).setDepth(.005).setVisible(false);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN,()=>{this.disposed=true;this.avatarProfiles={};this.avatarSprites.clear();this.avatarLoading.clear();this.avatarKeys.clear();this.labelOffsets.clear();});
    if(this.remote){const icon=this.add.graphics();icon.fillStyle(0xc8ebd4);icon.fillCircle(64,64,60);icon.lineStyle(7,0xffffff);icon.strokeCircle(64,64,60);icon.fillStyle(0x4c9469);icon.fillCircle(64,45,18);icon.fillEllipse(64,93,64,42);icon.generateTexture('avatar-default',128,128);icon.destroy();}
    this.effects=this.add.graphics().setDepth(1.5);
    this.labels = this.model.cars.map(car => this.add.text(0,0,car.id === 'car-0' ? 'BÉ' : car.name.split(' ')[0], { fontFamily: 'sans-serif', fontSize: '12px', color: '#244356', fontStyle: 'bold', backgroundColor: '#ffffffdd', padding: { x: 7, y: 3 } }).setOrigin(.5));
    if(this.remote)return;
    this.input.keyboard?.on('keydown-LEFT', () => this.command({ type:'lane', direction:-1 }));
    this.input.keyboard?.on('keydown-RIGHT', () => this.command({ type:'lane', direction:1 }));
    this.input.keyboard?.addCapture(['LEFT', 'RIGHT']);
    this.input.keyboard?.disableGlobalCapture();
    this.report(this.model.snapshot());
  }
  command(command: RaceCommand) {
    this.model.command(command);
    // Let arrow keys edit text normally whenever the race is not running.
    if (this.model.status === 'running') this.input.keyboard?.enableGlobalCapture();
    else this.input.keyboard?.disableGlobalCapture();
    this.report(this.model.snapshot());
  }
  private project(distance: number, lane: number) {
    return projectRoad(distance,lane,this.remote?this.cameraRange:c.viewDistance);
  }

  private renderMs=0;private renderFrames=0;private profiling=new URLSearchParams(location.search).get('profile')==='1';
  update(time:number,delta:number){if(!this.profiling){this.updateFrame(time,delta);return;}const start=performance.now();this.updateFrame(time,delta);this.renderMs+=performance.now()-start;this.renderFrames++;}
  private updateFrame(_time: number, delta: number) {
    const dt = Math.min(delta / 1000, .05);
    if(this.remote){
      this.loadAvatars();this.relayout=performance.now()-this.labelLayoutAt>=100;if(this.relayout)this.labelLayoutAt=performance.now();
      const targets=[...this.snapshots.sample(performance.now())]; // Camera sorting must not mutate the React ranking snapshot.
      if(this.focusId!=='leaders'&&this.focusId!=='overview')targets.sort((a,b)=>Number(b.id===this.focusId)-Number(a.id===this.focusId));
      const ids=new Set(targets.map(p=>p.id));for(const [id,sprite] of this.avatarSprites)if(!ids.has(id)){sprite.destroy();this.avatarSprites.delete(id);this.labelOffsets.delete(id);}
      this.remoteTargets=targets;this.model.boost=targets[0]?.boost??0;
      this.model.cars=targets;
      const wanted=cameraTarget(targets,this.focusId);
      if(!this.cameraInitialized&&targets.length){this.cameraDistance=wanted.position;this.cameraRange=wanted.range;this.cameraInitialized=true;}
      const cameraBlend=1-Math.exp(-dt*3);
      this.cameraDistance+=(wanted.position-this.cameraDistance)*cameraBlend;
      this.cameraRange+=(wanted.range-this.cameraRange)*cameraBlend;
      while(this.labels.length<targets.length){this.labels.push(this.label(''));this.numbers.push(this.add.text(0,0,'',{fontFamily:'sans-serif',fontSize:'11px',fontStyle:'bold',color:'#153c50'}).setOrigin(.5).setDepth(3));}
      targets.forEach((car,i)=>{const label=`#${car.number} ${car.name}`;if(this.labels[i].text!==label)this.labels[i].setText(label);if(this.numbers[i].text!==String(car.number))this.numbers[i].setText(String(car.number));});
      this.frames.push(delta);if(this.frames.length>600)this.frames.shift();
      if(performance.now()-this.statsAt>1000){this.statsAt=performance.now();this.game.canvas.dataset.avatarBindings=JSON.stringify([...this.avatarSprites].map(([playerId,sprite])=>({playerId,studentId:sprite.getData('studentId'),avatarId:sprite.getData('avatarId'),texture:sprite.texture.key,visible:sprite.visible})));const sorted=[...this.frames].sort((a,b)=>a-b);this.game.canvas.dataset.performance=JSON.stringify({fps:1000/(this.frames.reduce((a,b)=>a+b,0)/this.frames.length),frameP95:sorted[Math.floor(sorted.length*.95)],updateCpuMs:this.renderMs,updateFrames:this.renderFrames,cars:targets.length,textures:this.textures.getTextureKeys().length,avatarTextures:this.avatarKeys.size,visibleAvatars:[...this.avatarSprites.values()].filter(s=>s.visible).length});}
      if(!this.model.cars.length){this.finishLabel.setVisible(false);this.ink.clear();this.effects.clear();this.labels.forEach(s=>s.setVisible(false));this.sprites.forEach(s=>s.setVisible(false));this.numbers.forEach(s=>s.setVisible(false));return;}
      this.playerLane=this.model.cars[0].lane;this.draw();return;
    }
    this.model.update(dt);
    if (this.model.status === 'finished') this.input.keyboard?.disableGlobalCapture();
    this.playerLane = Phaser.Math.Linear(this.playerLane, this.model.cars[0].lane, Math.min(1, dt * 12));
    this.draw();
    this.reportTimer += dt;
    if (this.reportTimer > .1) { this.report(this.model.snapshot()); this.reportTimer = 0; }
  }
  private roadside(x:number,y:number,s:number,index:number,tree:boolean,color:number,side:number){
    const key=tree?'tree-'+color:'flag-'+color+'-'+side;
    if(!this.textures.exists(key)){const ink=this.add.graphics();if(tree){ink.fillStyle(0x916545).fillRect(36,35,8,49);ink.fillStyle(color).fillCircle(40,22,27).fillCircle(26,37,20).fillCircle(55,37,22);}else{ink.lineStyle(3,0xfffcdf).lineBetween(40,84,40,30);ink.fillStyle(color).fillTriangle(40,30,40+side*25,38,40,50);}ink.generateTexture(key,80,90);ink.destroy();}
    const image=this.scenery[index]??(this.scenery[index]=this.add.image(0,0,key).setOrigin(.5,84/90).setDepth(.01));if(image.texture.key!==key)image.setTexture(key);image.setPosition(x,y).setScale(s).setVisible(true);
  }
  private draw() {
    const g = this.ink; g.clear();this.effects.clear();this.labelBoxes=[];
    if(!this.backgroundReady){
    paintRaceEnvironment(g);
    g.generateTexture('race-background',900,600);g.clear();this.add.image(0,0,'race-background').setOrigin(0).setDepth(-1);this.backgroundReady=true;
    }
    const travel = this.remote?this.cameraDistance:this.model.cars[0].distance;
    const roadRange=this.remote?this.cameraRange:c.viewDistance;
    const dashStep=Math.max(24,roadRange/22);
    if(this.disabledLayer!=='road')for(let i=0;i<22;i++) {
      const d = ((i*dashStep-travel%dashStep)+roadRange+dashStep)%(roadRange+dashStep);
      if(d>roadRange)continue;
      for(const lane of [.5,1.5]) {
        const a=this.project(d,lane), b=this.project(d+10,lane);
        this.poly(0xeaf3f0,[a.x-2*a.scale,a.y,a.x+2*a.scale,a.y,b.x+2*b.scale,b.y,b.x-2*b.scale,b.y]);
      }
    }
    // Animated red/cream curbs use exactly the same world projection as lane lines.
    if(this.disabledLayer!=='road')for(let i=0;i<22;i++){
      const d=((i*dashStep-travel%dashStep)+roadRange+dashStep)%(roadRange+dashStep);
      if(d>roadRange)continue;
      for(const side of [-1,1]){
        const lane=1+side*1.5,a=this.project(d,lane),b=this.project(Math.min(roadRange,d+dashStep),lane);
        const widthA=8*a.scale,widthB=8*b.scale;
        this.poly((i+Math.floor(travel/dashStep))%2?0xfffcf0:0xf68a89,[a.x,a.y,a.x+side*widthA,a.y,b.x+side*widthB,b.y,b.x,b.y]);
      }
    }
    // Repeating roadside decorations share the same perspective as the road.
    this.scenery.forEach(s=>s.setVisible(false));
    if(this.disabledLayer!=='road')for(let i=11;i>=0;i--) {
      const d=(i*42-travel%42+504)%504;
      if(d>c.viewDistance) continue;
      for(const side of [-1,1]) {
        const p=this.project(d,1), x=450+side*(65+(p.y-168)*1.12), s=p.scale;
        if(this.remote){this.roadside(x,p.y,s,i*2+(side===1?1:0),i%3===0,i%3===0?(i%2?0x389c72:0x4bad7d):(i%2?0xffa290:0xffdc72),side);continue;}
        if(i%3===0) {
          g.fillStyle(0x916545); g.fillRect(x-4*s,p.y-45*s,8*s,49*s);
          g.fillStyle(i%2 ? 0x389c72 : 0x4bad7d); g.fillCircle(x,p.y-62*s,27*s); g.fillCircle(x-14*s,p.y-47*s,20*s); g.fillCircle(x+15*s,p.y-47*s,22*s);
        } else {
          g.lineStyle(3*s,0xfffcdf); g.lineBetween(x,p.y,x,p.y-54*s);
          this.poly(i%2 ? 0xffa290 : 0xffdc72,[x,p.y-54*s,x+side*25*s,p.y-46*s,x,p.y-34*s]);
        }
      }
    }
    // Small roadside direction sign, drawn without external assets.
    g.fillStyle(0x967650); g.fillRect(765,298,6,48);
    g.fillStyle(0xfff2bf); g.fillRoundedRect(727,271,83,32,6);
    g.lineStyle(3,0x66846c); g.lineBetween(746,287,790,287); g.lineBetween(781,279,790,287); g.lineBetween(781,295,790,287);
    this.finishLabel.setVisible(false);
    const finish=c.trackLength-travel;
    if(finish<=roadRange&&finish>=0){
      const left=this.project(finish,-.5),right=this.project(finish,2.5),p=this.project(finish,1),w=right.x-left.x,s=p.scale;
      // Checkered ground stripe and arch are tied to 3200 m, never a fixed background gate.
      for(let row=0;row<2;row++)for(let i=0;i<12;i++){
        g.fillStyle((i+row)%2?0xfffdf0:0x40516a).fillRect(left.x+i*w/12,p.y+row*5*s,w/12,5*s);
      }
      const top=p.y-75*s;
      g.lineStyle(10*s,0xffce75).lineBetween(left.x-8*s,p.y,left.x-8*s,top).lineBetween(right.x+8*s,p.y,right.x+8*s,top);
      for(let i=0;i<16;i++){
        const t1=Math.PI+i*Math.PI/16,t2=Math.PI+(i+1)*Math.PI/16;
        g.lineStyle(13*s,i%2?0xfffcf1:0x46536e).lineBetween(450+Math.cos(t1)*(w/2+8*s),top+Math.sin(t1)*45*s,450+Math.cos(t2)*(w/2+8*s),top+Math.sin(t2)*45*s);
      }
      this.finishLabel.setPosition(450,top-45*s).setScale(Math.max(.25,s*.8)).setVisible(true);
    }
    const entities: { y:number; draw:()=>void }[]=[];
    for(const o of this.model.obstacles) {
      const d=o.distance-travel;
      if(d<0 || d>(this.remote?this.cameraRange:c.viewDistance) || o.hit) continue;
      const p=this.project(d,o.lane);
      entities.push({y:p.y,draw:()=>{
        g.fillStyle(0x294b5b,.16); g.fillEllipse(p.x,p.y+4*p.scale,38*p.scale,10*p.scale);
        this.poly(0xf77c48,[p.x-14*p.scale,p.y,p.x,p.y-38*p.scale,p.x+14*p.scale,p.y]);
        this.poly(0xffffff,[p.x-8*p.scale,p.y-17*p.scale,p.x-5*p.scale,p.y-25*p.scale,p.x+5*p.scale,p.y-25*p.scale,p.x+8*p.scale,p.y-17*p.scale]);
        g.fillStyle(0xe9703d);g.fillRoundedRect(p.x-20*p.scale,p.y-3*p.scale,40*p.scale,7*p.scale,2);
      }});
    }
    this.labels.forEach(label=>label.setVisible(false));this.avatarSprites.forEach(sprite=>sprite.setVisible(false));
    this.sprites.forEach(sprite=>sprite.setVisible(false));this.numbers.forEach(number=>number.setVisible(false));
    if(this.remote)for(const car of this.model.cars){const p=this.project(car.distance-travel,car.lane);if(p.visible){const s=p.scale*.55;this.labelBoxes.push({x:p.x,y:p.y-35*s,width:66*s,height:74*s});}}
    if(this.disabledLayer!=='cars')this.model.cars.forEach((car,i)=>{
      const d=this.remote?car.distance-travel:i===0?0:car.distance-travel;
      if(d<0||d>(this.remote?this.cameraRange:c.viewDistance))return;
      const p=this.project(d,!this.remote&&i===0?this.playerLane:car.lane);
      entities.push({y:p.y,draw:()=>this.car(p.x,p.y,p.scale*(this.remote ? .55 : 1),car.color,i)});
    });
    entities.sort((a,b)=>a.y-b.y).forEach(e=>e.draw());
    if(this.disabledLayer!=='effects'&&this.model.boost>0 && this.model.status==='running') {
      g.lineStyle(3,0xffffff,.7);
      for(let i=0;i<9;i++){const x=45+i*102,y=270+(i*67+travel*12)%290;g.lineBetween(x,y,x+(x-450)*.06,y+30);}
    }

  }
  private poly(color:number,points:number[]) { const g=this.ink;g.fillStyle(color);g.beginPath();g.moveTo(points[0],points[1]);for(let i=2;i<points.length;i+=2)g.lineTo(points[i],points[i+1]);g.closePath();g.fillPath(); }
  private car(x:number,y:number,s:number,color:number,index:number) {
    const g=this.ink;
    if(this.remote&&!this.baking){
      const key=`car-${color}`;
      if(!this.textures.exists(key)){const temp=this.add.graphics();const previous=this.ink;this.ink=temp;this.baking=true;this.car(40,80,1,color,index);temp.generateTexture(key,80,110);temp.destroy();this.ink=previous;this.baking=false;}
      const sprite=this.sprites[index]??(this.sprites[index]=this.add.image(0,0,key).setOrigin(.5,80/110));
      if(sprite.texture.key!==key)sprite.setTexture(key);sprite.setPosition(x,y).setScale(s).setDepth(y/1000).setVisible(true);
      const car=this.remoteTargets[index];
      this.numbers[index].setPosition(x,y-20*s).setScale(Math.max(.65,s)).setDepth(y/1000+.001).setVisible(true);
      const label=this.labels[index];
      const size=Phaser.Math.Clamp(s*42,20,38),labelScale=Phaser.Math.Clamp(s*1.5,.7,1);
      let offset=this.labelOffsets.get(car.id);
      let box:LabelBox|null;
      if(this.relayout||offset===undefined){box=labelPosition(x,y-85*s-size/2,label.width*labelScale,label.height*labelScale+size+3,this.labelBoxes,60);this.labelOffsets.set(car.id,box?{x:box.x-x,y:box.y-y}:null);}else box=offset?{x:x+offset.x,y:y+offset.y,width:label.width*labelScale,height:label.height*labelScale+size+3}:null;
      const profile=car.studentId?this.avatarProfiles[car.studentId]:undefined;
      const texture=profile?.avatarId===car.avatarId&&car.avatarId&&this.textures.exists(`avatar-${car.avatarId}`)?`avatar-${car.avatarId}`:'avatar-default';
      let avatar=this.avatarSprites.get(car.id);if(!avatar){avatar=this.add.image(0,0,texture).setDepth(2);this.avatarSprites.set(car.id,avatar);}
      if(avatar.texture.key!==texture)avatar.setTexture(texture);if(avatar.getData('playerId')!==car.id||avatar.getData('avatarId')!==car.avatarId)avatar.setData({playerId:car.id,studentId:car.studentId,avatarId:car.avatarId});
      if(box){this.labelBoxes.push(box);label.setVisible(this.disabledLayer!=='labels');label.setPosition(box.x,box.y+size/2+2).setScale(labelScale).setVisible(this.disabledLayer!=='labels').setDepth(2);avatar.setPosition(box.x,box.y-label.height*labelScale/2).setDisplaySize(size,size).setVisible(this.disabledLayer!=='avatars');this.effects.lineStyle(1,0xffffff,.55).lineBetween(x,y-70*s,box.x,box.y+box.height/2);}
      if(car.id===this.focusId){this.effects.lineStyle(3,0xffef8e,.95).strokeEllipse(x,y+3*s,80*s,24*s);if(box)this.effects.lineStyle(2,0xffdb5a).strokeCircle(avatar.x,avatar.y,size/2+3);}
      if(this.disabledLayer!=='effects'&&this.model.status==='running'&&car.speed>0&&(this.remoteTargets.length<15||(car.boost??0)>0)){
        const phase=(this.model.cars[index].distance*3)%10;
        if((car.boost??0)>0){this.effects.lineStyle(3*s,0xffe486,.8);for(const offset of [-17,17])this.effects.lineBetween(x+offset*s,y+3*s,x+offset*s,y+(20+phase)*s);}
        else {this.effects.fillStyle(0xe9d9b7,.3);this.effects.fillCircle(x-20*s,y+(5+phase)*s,3*s);this.effects.fillCircle(x+20*s,y+(9+phase)*s,3*s);}
      }
      return;
    }
    g.fillStyle(0x253e50,.2);g.fillEllipse(x+4*s,y+8*s,66*s,23*s);
    if(!this.baking&&index===0 && this.model.boost>0 && this.model.status==='running') {
      this.poly(0xffb63f,[x-18*s,y+2*s,x-10*s,y+40*s,x,y+13*s,x+10*s,y+40*s,x+18*s,y+2*s]);
    }
    g.fillStyle(0x2d4355);g.fillRoundedRect(x-33*s,y-49*s,12*s,49*s,4*s);g.fillRoundedRect(x+22*s,y-49*s,12*s,49*s,4*s);
    g.fillStyle(Phaser.Display.Color.IntegerToColor(color).darken(17).color);g.fillRoundedRect(x-27*s,y-70*s,56*s,74*s,12*s);
    g.fillStyle(color);g.fillRoundedRect(x-29*s,y-66*s,55*s,63*s,12*s);
    g.fillStyle(0xd8f5f6);g.fillRoundedRect(x-19*s,y-55*s,35*s,21*s,6*s);
    g.fillStyle(0x375e77);g.fillRoundedRect(x-16*s,y-51*s,29*s,13*s,4*s);
    g.fillStyle(0xffffff,.55);g.fillRoundedRect(x-18*s,y-29*s,34*s,13*s,4*s);
    g.fillStyle(0xfff0ba);g.fillRoundedRect(x-23*s,y-10*s,10*s,5*s,2*s);g.fillRoundedRect(x+12*s,y-10*s,10*s,5*s,2*s);
    if(!this.baking)this.labels[index].setPosition(x,y-85*s).setScale(Math.max(.65,s)).setVisible(true).setDepth(2);
  }
}
