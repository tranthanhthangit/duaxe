import type Phaser from 'phaser';

/** Bake once at scene creation: scenery never changes world positions or lane projection. */
export function paintRaceEnvironment(g: Phaser.GameObjects.Graphics) {
  g.fillStyle(0x8ddcfa).fillRect(0,0,900,600);
  // Soft rainbow, school, clouds and distant trees follow the supplied art direction.
  for(const [i,color] of [0xffb9c6,0xffd79d,0xfff2ad,0xb9e6ad,0xa7d9f1,0xc7b9ed].entries()) {
    g.lineStyle(8,color,.7);g.beginPath();g.arc(670,151,118-i*8,Math.PI,Math.PI*2);g.strokePath();
  }
  g.fillStyle(0xfff0b5).fillCircle(761,48,25);
  for(const [x,y] of [[103,49],[350,36],[613,62],[821,111]]) {
    g.fillStyle(0xffffff,.92).fillEllipse(x,y,87,24).fillCircle(x-20,y-8,18).fillCircle(x+6,y-13,23);
  }
  g.fillStyle(0xa8d99a).fillEllipse(180,182,560,122).fillEllipse(730,182,580,126);
  g.fillStyle(0x87cc81).fillRect(0,178,900,422);
  // School stays outside the track and does not cover moving cars.
  g.fillStyle(0xffe7ac).fillRoundedRect(188,113,116,62,3);
  g.fillStyle(0xfffaf0).fillRect(230,86,35,89);
  g.fillStyle(0xf49291).fillTriangle(182,115,246,77,310,115);
  g.fillStyle(0xfff8dc).fillCircle(247,111,13);g.lineStyle(2,0x8e8e7a).strokeCircle(247,111,12).lineBetween(247,111,247,104).lineBetween(247,111,254,113);
  for(const x of [202,217,277,292])g.fillStyle(0x77c4e4).fillRoundedRect(x,132,10,15,2);
  g.fillStyle(0xcead76).fillRect(236,152,20,23);
  g.lineStyle(2,0xffffff).lineBetween(250,84,250,45);g.fillStyle(0xf96862).fillTriangle(251,45,278,52,251,63);
  g.fillStyle(0xffea85).beginPath();
  for(let i=0;i<10;i++){const angle=-Math.PI/2+i*Math.PI/5,r=i%2?3:6,x=261+Math.cos(angle)*r,y=53+Math.sin(angle)*r;if(i===0)g.moveTo(x,y);else g.lineTo(x,y);}
  g.closePath().fillPath();
  for(const x of [37,132,332,568,784,864]) {
    g.fillStyle(0xa78858).fillRect(x-3,134,6,40);
    g.fillStyle(0x70bd75).fillCircle(x,130,24).fillCircle(x-15,141,18).fillCircle(x+15,141,18);
    g.fillStyle(0xa8db78,.9).fillCircle(x-8,123,12);
  }
  // Two small grandstands with a baked crowd; no crowd animations or per-frame objects.
  for(const side of [-1,1]) {
    const x=side<0?4:740;
    g.fillStyle(0xd4b78a).fillRect(x,190,156,30);
    for(let i=0;i<8;i++) {
      g.fillStyle(i%2?0xfffcf1:side<0?0x78bce9:0xf49397).fillRect(x+i*20,153,20,34);
      g.fillStyle(i%2?0xf6d49c:0xcba17b).fillCircle(x+10+i*19,198,7);
      g.fillStyle([0xf4a279,0xa39bda,0x8acba9][i%3]).fillRoundedRect(x+3+i*19,204,14,13,3);
    }
    g.fillStyle(side<0?0x629bce:0xdc7c8b).fillTriangle(x-5,153,x+78,130,x+161,153);
    g.lineStyle(4,0xfffaf0).lineBetween(x,219,x+156,219);
    for(const post of [x+4,x+76,x+150])g.fillStyle(0xf3d28c).fillRoundedRect(post,213,6,24,2);
    const lamp=side<0?70:831;
    g.lineStyle(4,0x9a8d7a).lineBetween(lamp,150,lamp,70);
    g.fillStyle(0xffe9a7).fillRoundedRect(lamp-14,65,28,18,5);g.lineStyle(3,0x8499a1).strokeRoundedRect(lamp-14,65,28,18,5);
  }
  // One road only. Its edges use the same horizon and lane width as projectRoad().
  const polygon=(color:number,points:number[])=>{g.fillStyle(color).beginPath().moveTo(points[0],points[1]);for(let i=2;i<points.length;i+=2)g.lineTo(points[i],points[i+1]);g.closePath().fillPath();};
  polygon(0xfff7de,[389,168,511,168,863,600,37,600]);
  polygon(0x8b91ab,[399,168,501,168,832,600,68,600]);
  polygon(0x9ca6ba,[399,168,501,168,510,180,390,180]);
  // Flower borders are baked behind the moving road entities.
  for(let i=0;i<26;i++)for(const side of [-1,1]) {
    const y=250+i*14,x=450+side*(125+(y-250)*1.14),size=3+(y-250)/160;
    g.fillStyle(0x59aa65).fillEllipse(x,y+6,16*size/3,7);
    g.fillStyle(i%2?0xffe49c:0xffafcc).fillCircle(x-size,y,size).fillCircle(x+size,y,size).fillCircle(x,y-size,size);
    g.fillStyle(0xfff4c8).fillCircle(x,y,size*.65);
  }
}
