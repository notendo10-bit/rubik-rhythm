import { useState, useEffect, useRef, useCallback } from "react";

// ─────────────────────────────
//  CUBE ENGINE
// ─────────────────────────────
const CSS_COL = ["#E8192C","#FF7700","#0057B7","#00A650","#FFD700","#FFFFFF","#181818"];

function buildSolved(){
  const out=[];
  for(let x=-1;x<=1;x++) for(let y=-1;y<=1;y++) for(let z=-1;z<=1;z++)
    out.push({pos:[x,y,z],faces:[x===1?2:6,x===-1?3:6,y===1?4:6,y===-1?5:6,z===1?0:6,z===-1?1:6]});
  return out;
}
function rotP([x,y,z],ax,cw){const s=cw?1:-1;if(ax==="x")return[x,s*(-z),s*y];if(ax==="y")return[s*z,y,s*(-x)];return[s*(-y),s*x,z];}
function rotF([px,nx,py,ny,pz,nz],ax,cw){
  // faces=[+x,-x,+y,-y,+z,-z]
  // X-CW: +y→+z→-y→-z cycle: new=[px,nx,nz,pz,py,ny]
  if(ax==="x")return cw?[px,nx,nz,pz,py,ny]:[px,nx,pz,nz,ny,py];
  // Y-CW: +z→+x→-z→-x cycle: new=[pz,nz,py,ny,nx,px]
  if(ax==="y")return cw?[pz,nz,py,ny,nx,px]:[nz,pz,py,ny,px,nx];
  // Z-CW: +x→+y→-x→-y cycle: new=[ny,py,px,nx,pz,nz]
  return cw?[ny,py,px,nx,pz,nz]:[py,ny,nx,px,pz,nz];
}
function doMove(cubies,ax,layer,cw){
  const ai=ax==="x"?0:ax==="y"?1:2;
  return cubies.map(c=>{
    if(Math.round(c.pos[ai])!==layer)return c;
    const np=rotP(c.pos,ax,cw);
    return{pos:[Math.round(np[0]),Math.round(np[1]),Math.round(np[2])],faces:rotF(c.faces,ax,cw)};
  });
}

// ─────────────────────────────
//  AUDIO ENGINE
// ─────────────────────────────
let AC=null,MASTER=null,DRY_GAIN=null,SEND_GAIN=null,WET_GAIN=null;
let _reverbLevel=0.25;

function buildReverb(a,decay=2.2){
  const sr=a.sampleRate,len=Math.ceil(sr*decay);
  const buf=a.createBuffer(2,len,sr);
  for(let ch=0;ch<2;ch++){const d=buf.getChannelData(ch);for(let i=0;i<len;i++)d[i]=(Math.random()*2-1)*Math.exp(-i/sr*(3/decay));}
  const c=a.createConvolver();c.buffer=buf;return c;
}

function boot(){
  if(!AC){
    AC=new(window.AudioContext||window.webkitAudioContext)();
    // 音源 → MASTER → [DRY_GAIN → dest] + [SEND_GAIN → reverb → WET_GAIN → dest]
    MASTER=AC.createGain();MASTER.gain.value=1;
    DRY_GAIN=AC.createGain();DRY_GAIN.gain.value=1;
    SEND_GAIN=AC.createGain();SEND_GAIN.gain.value=_reverbLevel;
    WET_GAIN=AC.createGain();WET_GAIN.gain.value=1.8; // コンボルバーのゲイン補正
    const rv=buildReverb(AC);
    MASTER.connect(DRY_GAIN);DRY_GAIN.connect(AC.destination);
    MASTER.connect(SEND_GAIN);SEND_GAIN.connect(rv);rv.connect(WET_GAIN);WET_GAIN.connect(AC.destination);
  }
  if(AC.state==="suspended")AC.resume();
  return AC;
}

function setReverbLevel(v){
  _reverbLevel=Math.max(0,Math.min(1,v));
  if(!SEND_GAIN)return;
  const t=AC.currentTime;
  SEND_GAIN.gain.setTargetAtTime(_reverbLevel,t,0.05);
  // リバーブが増えても音量を維持: DRY を少し下げる程度
  DRY_GAIN.gain.setTargetAtTime(Math.max(0.3,1-_reverbLevel*0.5),t,0.05);
}

// 音源の出力先
function dest(){return MASTER||AC.destination;}

const rn=()=>Math.random()*2-1;

function kick(freq,decay,vol){
  const a=boot(),t=a.currentTime+0.008;
  const o=a.createOscillator(),g=a.createGain();
  o.type="sine";
  o.frequency.setValueAtTime(freq*3,t);
  o.frequency.exponentialRampToValueAtTime(freq*0.5,t+decay);
  g.gain.setValueAtTime(vol,t);g.gain.exponentialRampToValueAtTime(0.001,t+decay);
  o.connect(g);g.connect(dest());o.start(t);o.stop(t+decay+0.05);
  const c=a.createOscillator(),cg=a.createGain();
  c.type="square";c.frequency.value=freq*8;
  cg.gain.setValueAtTime(vol*0.3,t);cg.gain.exponentialRampToValueAtTime(0.001,t+0.015);
  c.connect(cg);cg.connect(dest());c.start(t);c.stop(t+0.02);
}
function snare(freq,decay,vol){
  const a=boot(),t=a.currentTime+0.008;
  const o=a.createOscillator(),g=a.createGain();
  o.type="sine";o.frequency.value=freq;
  g.gain.setValueAtTime(vol*0.4,t);g.gain.exponentialRampToValueAtTime(0.001,t+decay);
  o.connect(g);g.connect(dest());o.start(t);o.stop(t+decay+0.05);
  const buf=a.createBuffer(1,Math.ceil(a.sampleRate*decay),a.sampleRate);
  const d=buf.getChannelData(0);
  for(let i=0;i<d.length;i++)d[i]=rn()*Math.exp(-i/a.sampleRate*(1/decay)*3);
  const ng=a.createGain();ng.gain.value=vol*0.85;
  const ns=a.createBufferSource();ns.buffer=buf;ns.connect(ng);ng.connect(dest());ns.start(t);
}
function hihat(open,vol){
  const a=boot(),t=a.currentTime+0.008;
  const dur=open?0.38:0.055;
  const buf=a.createBuffer(1,Math.ceil(a.sampleRate*dur),a.sampleRate);
  const d=buf.getChannelData(0);
  for(let i=0;i<d.length;i++)d[i]=rn()*Math.exp(-i/a.sampleRate*(open?9:85));
  const f=a.createBiquadFilter();f.type="highpass";f.frequency.value=7000;
  const g=a.createGain();g.gain.value=vol;
  const s=a.createBufferSource();s.buffer=buf;s.connect(f);f.connect(g);g.connect(dest());s.start(t);
}
function cymbal(freq,dur,vol){
  const a=boot(),t=a.currentTime+0.008;
  const buf=a.createBuffer(1,Math.ceil(a.sampleRate*dur),a.sampleRate);
  const d=buf.getChannelData(0);
  for(let i=0;i<d.length;i++)d[i]=rn()*Math.exp(-i/a.sampleRate*(3/dur));
  const f=a.createBiquadFilter();f.type="bandpass";f.frequency.value=freq;f.Q.value=0.5;
  const g=a.createGain();g.gain.value=vol;
  const s=a.createBufferSource();s.buffer=buf;s.connect(f);f.connect(g);g.connect(dest());s.start(t);
}
function tom(freq,decay,vol){
  const a=boot(),t=a.currentTime+0.008;
  const o=a.createOscillator(),g=a.createGain();
  o.type="sine";
  o.frequency.setValueAtTime(freq*1.8,t);
  o.frequency.exponentialRampToValueAtTime(freq*0.55,t+decay);
  g.gain.setValueAtTime(vol,t);g.gain.exponentialRampToValueAtTime(0.001,t+decay);
  o.connect(g);g.connect(dest());o.start(t);o.stop(t+decay+0.05);
}
function clap(vol){
  const a=boot();
  [0,0.01,0.022].forEach(dt=>{
    const t=a.currentTime+0.008+dt;
    const buf=a.createBuffer(1,Math.ceil(a.sampleRate*0.12),a.sampleRate);
    const d=buf.getChannelData(0);
    for(let i=0;i<d.length;i++)d[i]=rn()*Math.exp(-i/a.sampleRate*25);
    const g=a.createGain();g.gain.value=vol;
    const s=a.createBufferSource();s.buffer=buf;s.connect(g);g.connect(dest());s.start(t);
  });
}
function rim(vol){
  const a=boot(),t=a.currentTime+0.008;
  const o=a.createOscillator(),g=a.createGain();
  o.type="square";o.frequency.value=800;
  g.gain.setValueAtTime(vol,t);g.gain.exponentialRampToValueAtTime(0.001,t+0.06);
  o.connect(g);g.connect(dest());o.start(t);o.stop(t+0.08);
}
function cowbell(vol){
  const a=boot(),t=a.currentTime+0.008;
  [562,845].forEach(f=>{
    const o=a.createOscillator(),g=a.createGain();
    o.type="square";o.frequency.value=f;
    g.gain.setValueAtTime(vol,t);g.gain.exponentialRampToValueAtTime(0.001,t+0.38);
    o.connect(g);g.connect(dest());o.start(t);o.stop(t+0.42);
  });
}
function conga(freq,vol){
  const a=boot(),t=a.currentTime+0.008;
  const o=a.createOscillator(),g=a.createGain();
  o.type="sine";
  o.frequency.setValueAtTime(freq*1.4,t);
  o.frequency.exponentialRampToValueAtTime(freq,t+0.02);
  g.gain.setValueAtTime(vol,t);g.gain.exponentialRampToValueAtTime(0.001,t+0.22);
  o.connect(g);g.connect(dest());o.start(t);o.stop(t+0.26);
}
function shaker(vol){
  const a=boot(),t=a.currentTime+0.008;
  const buf=a.createBuffer(1,Math.ceil(a.sampleRate*0.08),a.sampleRate);
  const d=buf.getChannelData(0);
  for(let i=0;i<d.length;i++)d[i]=rn()*Math.exp(-i/a.sampleRate*52);
  const f=a.createBiquadFilter();f.type="highpass";f.frequency.value=5000;
  const g=a.createGain();g.gain.value=vol;
  const s=a.createBufferSource();s.buffer=buf;s.connect(f);f.connect(g);g.connect(dest());s.start(t);
}

// Fun sounds
function meow(pitch){
  const a=boot(),t=a.currentTime+0.008;
  const o=a.createOscillator(),g=a.createGain();
  o.type="sine";
  o.frequency.setValueAtTime(pitch*0.9,t);
  o.frequency.linearRampToValueAtTime(pitch*1.8,t+0.08);
  o.frequency.linearRampToValueAtTime(pitch*1.3,t+0.28);
  g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(0.7,t+0.02);
  g.gain.linearRampToValueAtTime(0,t+0.32);
  o.connect(g);g.connect(dest());o.start(t);o.stop(t+0.36);
}
function boing(f0,f1){
  const a=boot(),t=a.currentTime+0.008;
  const o=a.createOscillator(),g=a.createGain();
  o.type="sine";
  o.frequency.setValueAtTime(f0,t);
  o.frequency.exponentialRampToValueAtTime(f1,t+0.5);
  g.gain.setValueAtTime(0.7,t);g.gain.exponentialRampToValueAtTime(0.001,t+0.5);
  o.connect(g);g.connect(dest());o.start(t);o.stop(t+0.55);
}
function laser(f0,f1){
  const a=boot(),t=a.currentTime+0.008;
  const o=a.createOscillator(),g=a.createGain();
  o.type="sawtooth";
  o.frequency.setValueAtTime(f0,t);
  o.frequency.exponentialRampToValueAtTime(f1,t+0.22);
  g.gain.setValueAtTime(0.55,t);g.gain.exponentialRampToValueAtTime(0.001,t+0.25);
  o.connect(g);g.connect(dest());o.start(t);o.stop(t+0.28);
}
function fart(){
  const a=boot(),t=a.currentTime+0.008;
  const buf=a.createBuffer(1,Math.ceil(a.sampleRate*0.3),a.sampleRate);
  const d=buf.getChannelData(0);
  for(let i=0;i<d.length;i++){
    const x=i/a.sampleRate;
    d[i]=(Math.sin(2*Math.PI*(80+Math.sin(x*85)*32)*x)+rn()*0.4)*Math.exp(-x*5)*(1-x/0.3);
  }
  const g=a.createGain();g.gain.value=0.75;
  const s=a.createBufferSource();s.buffer=buf;s.connect(g);g.connect(dest());s.start(t);
}
function airhorn(){
  const a=boot(),t=a.currentTime+0.008;
  const o1=a.createOscillator(),o2=a.createOscillator(),g=a.createGain();
  o1.type="sawtooth";o1.frequency.value=233;
  o2.type="sawtooth";o2.frequency.value=311;
  g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(0.6,t+0.02);g.gain.linearRampToValueAtTime(0,t+0.42);
  o1.connect(g);o2.connect(g);g.connect(dest());
  o1.start(t);o2.start(t);o1.stop(t+0.5);o2.stop(t+0.5);
}
function spring(){
  const a=boot(),t=a.currentTime+0.008;
  const o=a.createOscillator(),g=a.createGain();
  o.type="sine";
  g.gain.setValueAtTime(0.65,t);g.gain.linearRampToValueAtTime(0,t+0.55);
  for(let i=0;i<8;i++){
    o.frequency.setValueAtTime(380+i*65,t+i*0.065);
    o.frequency.linearRampToValueAtTime(200+i*38,t+i*0.065+0.058);
  }
  o.connect(g);g.connect(dest());o.start(t);o.stop(t+0.62);
}
function woof(){
  const a=boot(),t=a.currentTime+0.008;
  const o=a.createOscillator(),g=a.createGain();
  o.type="square";
  o.frequency.setValueAtTime(200,t);o.frequency.linearRampToValueAtTime(130,t+0.28);
  g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(0.55,t+0.01);g.gain.linearRampToValueAtTime(0,t+0.3);
  o.connect(g);g.connect(dest());o.start(t);o.stop(t+0.32);
}
function blip(freq){
  const a=boot(),t=a.currentTime+0.008;
  const o=a.createOscillator(),g=a.createGain();
  o.type="square";o.frequency.value=freq;
  g.gain.setValueAtTime(0.7,t);g.gain.exponentialRampToValueAtTime(0.001,t+0.1);
  o.connect(g);g.connect(dest());o.start(t);o.stop(t+0.12);
}

function metroTick(accent){
  const a=boot(),t=a.currentTime+0.008;
  const o=a.createOscillator(),g=a.createGain();
  o.type="sine";o.frequency.value=accent?1200:800;
  g.gain.setValueAtTime(accent?0.6:0.3,t);g.gain.exponentialRampToValueAtTime(0.001,t+0.02);
  o.connect(g);g.connect(dest());o.start(t);o.stop(t+0.03);
}

// ─────────────────────────────
//  COLOR KITS
//  Colors 0-3: complete drum kits (each playable alone)
//  Colors 4-5: fun/silly sounds
// ─────────────────────────────
const COLOR_KITS = [
  // 0 RED — ROCK (loud, punchy, straightforward)
  { name:"ROCK 🎸", sounds:[
    ()=>kick(80,0.50,0.95),     // 強いキック
    ()=>kick(65,0.65,0.92),     // 深いキック
    ()=>snare(195,0.22,0.90),   // スネア
    ()=>clap(0.88),             // クラップ
    ()=>hihat(false,0.72),      // クローズドハット
    ()=>hihat(true,0.60),       // オープンハット
    ()=>cymbal(3000,1.2,0.65),  // クラッシュ
    ()=>tom(150,0.35,0.88),     // ハイタム
    ()=>tom(80,0.48,0.92),      // フロアタム
  ]},
  // 1 ORANGE — TRAP / 808 (sub bass, hi hats galore)
  { name:"TRAP 🔥", sounds:[
    ()=>kick(55,0.82,0.98),     // 808キック
    ()=>kick(42,1.05,0.95),     // サブキック
    ()=>snare(160,0.18,0.88),   // トラップスネア
    ()=>clap(0.92),             // クラップ
    ()=>hihat(false,0.80),      // タイトハット
    ()=>hihat(false,0.52),      // ソフトハット
    ()=>hihat(true,0.55),       // オープンハット
    ()=>tom(68,0.58,0.92),      // 808タム
    ()=>cymbal(2700,0.7,0.58),  // チャイナ
  ]},
  // 2 BLUE — JAZZ (soft, nuanced, brushy feel)
  { name:"JAZZ 🎷", sounds:[
    ()=>kick(88,0.38,0.72),     // ソフトキック
    ()=>snare(205,0.25,0.75),   // ジャズスネア
    ()=>rim(0.70),              // リムショット
    ()=>hihat(false,0.52),      // ハット
    ()=>cymbal(3400,0.9,0.50),  // ライド
    ()=>cymbal(1800,0.65,0.55), // ライドベル
    ()=>cymbal(2800,1.1,0.48),  // クラッシュ(ソフト)
    ()=>tom(200,0.30,0.75),     // ハイタム
    ()=>cowbell(0.60),          // カウベル
  ]},
  // 3 GREEN — LATIN (conga, bongo, shaker, percussion)
  { name:"LATIN 🎪", sounds:[
    ()=>kick(85,0.42,0.85),     // キック
    ()=>snare(200,0.20,0.82),   // スネア
    ()=>conga(320,0.88),        // コンガHi
    ()=>conga(210,0.85),        // コンガLo
    ()=>conga(440,0.80),        // ボンゴ
    ()=>shaker(0.70),           // シェイカー
    ()=>cymbal(3000,1.0,0.58),  // シンバル
    ()=>rim(0.72),              // リムショット
    ()=>cowbell(0.65),          // カウベル
  ]},
  // 4 YELLOW — FUN / CAT (silly, kids love it)
  { name:"CAT 🐱", sounds:[
    ()=>meow(520),   // にゃー高
    ()=>meow(380),   // にゃー中
    ()=>meow(270),   // にゃーниз
    ()=>woof(),      // わんわん
    ()=>boing(800,100),  // ボーン↓
    ()=>boing(150,900),  // ボーン↑
    ()=>fart(),      // ぷー
    ()=>spring(),    // びよーん
    ()=>blip(880),   // ぴっ
  ]},
  // 5 WHITE — FUN / FX (electronic silly)
  { name:"FX 🎉", sounds:[
    ()=>laser(1400,180),   // レーザー↓
    ()=>laser(200,1600),   // レーザー↑
    ()=>airhorn(),         // エアホーン
    ()=>blip(440),         // ぶりっ低
    ()=>blip(1320),        // ぶりっ高
    ()=>boing(600,60),     // でろーん
    ()=>boing(80,1200),    // ぴゅーん
    ()=>spring(),          // びよーん
    ()=>fart(),            // ぷー
  ]},
];

// ─────────────────────────────
//  ROULETTE  (swap kits between colors)
// ─────────────────────────────
const COL_SW  = ["#E8192C","#FF7700","#0057B7","#00A650","#FFD700","#F0F0F0"];
const COL_LBL = ["RED","ORANGE","BLUE","GREEN","YELLOW","WHITE"];

// assign[colorId] = kit index (default identity)
const DEF = [0,1,2,3,4,5];
function randAssign(){
  const a=[0,1,2,3,4,5];
  for(let i=5;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}
  return a;
}

function Roulette({current,onDone}){
  const[spin,setSpin]=useState(false);
  const[done,setDone]=useState(false);
  const[asgn,setAsgn]=useState(current);
  const fRef=useRef(null),tm=useRef(null);
  const go=()=>{
    if(spin)return;setSpin(true);setDone(false);fRef.current=randAssign();
    let tick=0,max=20+Math.floor(Math.random()*10);
    const run=()=>{
      tick++;setAsgn([0,1,2,3,4,5].sort(()=>Math.random()-0.5));
      const d=tick<max*.5?60:tick<max*.8?100:180;
      if(tick<max)tm.current=setTimeout(run,d);
      else{setAsgn(fRef.current);setSpin(false);setDone(true);}
    };
    tm.current=setTimeout(run,60);
  };
  useEffect(()=>()=>clearTimeout(tm.current),[]);
  return(
    <div style={RS.ov}>
      <div style={RS.title}>🎲 KIT ROULETTE</div>
      <div style={RS.grid}>
        {Array.from({length:6},(_,ci)=>{
          const kit=COLOR_KITS[asgn[ci]];
          return(
            <div key={ci} style={RS.cell}>
              <div style={{...RS.sw,background:COL_SW[ci],color:ci===5?"#333":"#fff"}}>
                <span style={{fontSize:18}}>{done||!spin?kit.name.split(" ")[1]:"？"}</span>
              </div>
              <div style={RS.fn}>{COL_LBL[ci]}</div>
              <div style={RS.kn}>{done||!spin?kit.name.split(" ")[0]:"···"}</div>
            </div>
          );
        })}
      </div>
      <button style={RS.btn} onClick={go} disabled={spin}>{spin?"SPINNING···":done?"RE-SPIN":"▶ SPIN"}</button>
      {done&&<button style={{...RS.btn,borderColor:"#00e5ff",color:"#00e5ff"}} onClick={()=>onDone(asgn)}>PLAY →</button>}
      <button style={RS.skip} onClick={()=>onDone(randAssign())}>スキップ</button>
    </div>
  );
}
const RS={
  ov:{position:"fixed",inset:0,zIndex:100,background:"rgba(4,8,18,0.97)",backdropFilter:"blur(18px)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:14,fontFamily:"'Share Tech Mono',monospace"},
  title:{fontFamily:"'Orbitron',sans-serif",fontSize:16,fontWeight:900,letterSpacing:4,color:"#fff"},
  grid:{display:"flex",gap:8,flexWrap:"wrap",justifyContent:"center",maxWidth:360},
  cell:{display:"flex",flexDirection:"column",alignItems:"center",gap:4,width:52},
  sw:{width:44,height:44,borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"inset 0 2px 6px rgba(255,255,255,.2)",border:"2px solid rgba(255,255,255,.15)"},
  fn:{fontSize:7,color:"rgba(255,255,255,.35)",letterSpacing:1},
  kn:{fontSize:9,color:"#fff",letterSpacing:1,fontFamily:"'Orbitron',sans-serif",fontWeight:700,minHeight:14,textAlign:"center"},
  btn:{fontFamily:"'Orbitron',sans-serif",fontSize:11,fontWeight:900,letterSpacing:3,padding:"11px 24px",borderRadius:6,border:"2px solid #ff3e6c",color:"#ff3e6c",background:"transparent",cursor:"pointer"},
  skip:{fontSize:10,color:"rgba(255,255,255,.25)",cursor:"pointer",border:"none",background:"transparent"},
};

// ─────────────────────────────
//  CUBE RENDER
//  Sticker onPointerDown = exact color detection
// ─────────────────────────────
const SZ=52,GAP=4,UNIT=SZ+GAP;
const FACE_T=[
  `translateX(${SZ/2}px) rotateY(90deg)`,
  `translateX(-${SZ/2}px) rotateY(-90deg)`,
  `translateY(-${SZ/2}px) rotateX(90deg)`,
  `translateY(${SZ/2}px) rotateX(-90deg)`,
  `translateZ(${SZ/2}px)`,
  `translateZ(-${SZ/2}px) rotateY(180deg)`,
];

// Cell index within a face
function cellOf([x,y,z],fi){
  if(fi===4)return(1-y)*3+(x+1);   // +z front
  if(fi===5)return(1-y)*3+(1-x);   // -z back
  if(fi===0)return(1-y)*3+(z+1);   // +x right
  if(fi===1)return(1-y)*3+(1-z);   // -x left
  if(fi===2)return(1-z)*3+(x+1);   // +y top
  return(z+1)*3+(x+1);              // -y bottom
}

function Cubie({pos,faces,onSticker,onSwipeStart}){
  const[px,py,pz]=pos;
  return(
    <div style={{
      position:"absolute",left:0,top:0,width:SZ,height:SZ,
      transformStyle:"preserve-3d",
      transform:`translate3d(calc(${px*UNIT}px - ${SZ/2}px),calc(${-py*UNIT}px - ${SZ/2}px),${pz*UNIT}px)`,
    }}>
      {faces.map((colorId,fi)=>{
        const inner=colorId===6;
        const cell=inner?0:cellOf(pos,fi);
        return(
          <div key={fi} style={{
            position:"absolute",width:SZ,height:SZ,
            background:CSS_COL[colorId],
            transform:FACE_T[fi],
            backfaceVisibility:"hidden",
            border:"3px solid #111",borderRadius:5,boxSizing:"border-box",
            pointerEvents:inner?"none":"auto",
            cursor:inner?"default":"pointer",
            boxShadow:inner?"none":"inset 0 2px 6px rgba(255,255,255,0.25),inset 0 -2px 4px rgba(0,0,0,0.3)",
          }}
          onPointerDown={inner?undefined:(e)=>{
            e.stopPropagation();
            onSwipeStart(colorId,cell,e.clientX,e.clientY);
          }}
          onPointerUp={inner?undefined:(e)=>{
            e.stopPropagation();
            onSticker(colorId,cell,e.clientX,e.clientY);
          }}
          >
            {!inner&&<div style={{position:"absolute",top:6,left:7,width:"38%",height:"30%",
              background:"rgba(255,255,255,0.2)",borderRadius:"3px 3px 50% 50%",pointerEvents:"none"}}/>}
          </div>
        );
      })}
    </div>
  );
}

function SliceGroup({cubies,axis,cw,progress,onSticker,onSwipeStart}){
  const angle=progress*90*(cw?1:-1);
  const axStr=axis==="x"?"1,0,0":axis==="y"?"0,1,0":"0,0,1";
  return(
    <div style={{position:"absolute",left:0,top:0,width:0,height:0,transformStyle:"preserve-3d",
      transform:`rotate3d(${axStr},${angle}deg)`}}>
      {cubies.map((c,i)=><Cubie key={i} pos={c.pos} faces={c.faces} onSticker={onSticker} onSwipeStart={onSwipeStart}/>)}
    </div>
  );
}

// Swipe → slice (3軸対応・直感的スワイプ)
function getSlice(sx,sy,rect,orbitX,orbitY,dx,dy){
  const cx=rect.left+rect.width/2,cy=rect.top+rect.height/2;
  const rx=orbitX*Math.PI/180,ry=orbitY*Math.PI/180;
  const cosy=Math.cos(ry),siny=Math.sin(ry);
  const cosx=Math.cos(rx),sinx=Math.sin(rx);

  // スクリーン上のタッチ位置を正規化(-1〜1)
  const su=(sx-cx)/(rect.width*0.5);
  const sv=(sy-cy)/(rect.height*0.5);

  // ワールド座標に逆変換(Y回転→X回転の逆)
  const wx= su*cosy + sv*sinx*siny;
  const wy=-sv*cosx;
  const wz=-su*siny + sv*sinx*cosy;

  // レイヤー: -1, 0, 1
  const L=v=>v<-0.32?-1:v>0.32?1:0;
  const lx=L(wx),ly=L(wy),lz=L(wz);

  const horizontal=Math.abs(dx)>Math.abs(dy);

  if(horizontal){
    // 左右スワイプ → Y軸(水平)スライス
    // orbitYによって見え方が変わるのでsinYで方向補正
    const cwY = siny>=0 ? dx<0 : dx>0;
    return{axis:"y",layer:ly,cw:cwY};
  } else {
    // 上下スワイプ → X軸 or Z軸(縦)スライス
    if(Math.abs(cosy)>=Math.abs(siny)){
      // 正面よりに見ている → X軸スライス
      // dy<0(上スワイプ) = 前面が上に動く = X-CCW
      return{axis:"x",layer:lx,cw:dy>0};
    } else {
      // 横から見ている → Z軸スライス
      const cwZ = siny>=0 ? dy<0 : dy>0;
      return{axis:"z",layer:lz,cw:cwZ};
    }
  }
}

// ─────────────────────────────
//  APP
// ─────────────────────────────
const NS=16;

export default function App(){
  const[cubies,setCubies]=useState(buildSolved);
  const[sliceAnim,setSliceAnim]=useState(null);
  const animLock=useRef(false),animRaf=useRef(null);

  const[assign,setAssign]=useState(DEF);
  const assignRef=useRef(DEF);
  useEffect(()=>{assignRef.current=assign;},[assign]);

  const orbitRef=useRef({x:-28,y:38});
  const orbitElRef=useRef(null);
  const applyOrbit=useCallback(()=>{
    if(orbitElRef.current)
      orbitElRef.current.style.transform=`rotateX(${orbitRef.current.x}deg) rotateY(${orbitRef.current.y}deg)`;
  },[]);

  const[seqs,setSeqs]=useState(()=>Array.from({length:6},()=>Array.from({length:9},()=>Array(NS).fill(false))));
  const seqsRef=useRef(seqs);
  useEffect(()=>{seqsRef.current=seqs;},[seqs]);

  const[bpm,setBpm]=useState(120);
  const[playing,setPlaying]=useState(false);
  const[metro,setMetro]=useState(false);
  const[showRou,setShowRou]=useState(true);
  const[showSettings,setShowSettings]=useState(false);
  const[reverb,setReverb]=useState(25);

  const bpmRef=useRef(120),playRef=useRef(false),metroRef=useRef(false);
  const stepRef=useRef(0),nextTRef=useRef(0),timerRef=useRef(null),stepEls=useRef([]);

  useEffect(()=>{bpmRef.current=bpm;},[bpm]);
  useEffect(()=>{metroRef.current=metro;},[metro]);

  useEffect(()=>{
    if(document.getElementById("rr-font"))return;
    const l=document.createElement("link");l.id="rr-font";l.rel="stylesheet";
    l.href="https://fonts.googleapis.com/css2?family=Orbitron:wght@700;900&family=Share+Tech+Mono&display=swap";
    document.head.appendChild(l);
  },[]);

  // Slice
  const runSlice=useCallback((axis,layer,cw)=>{
    if(animLock.current)return;
    animLock.current=true;
    const DUR=200,start=performance.now();
    const go=()=>{
      const t=Math.min((performance.now()-start)/DUR,1);
      setSliceAnim({axis,layer,cw,progress:1-Math.pow(1-t,3)});
      if(t<1)animRaf.current=requestAnimationFrame(go);
      else{setSliceAnim(null);setCubies(prev=>doMove(prev,axis,layer,cw));animLock.current=false;}
    };
    animRaf.current=requestAnimationFrame(go);
  },[]);

  // Sticker events
  const swipeRef=useRef(null);

  // PointerDown on sticker: boot audio + record start pos
  // Sound fires here (on press, not release) for instant feedback
  const onSwipeStart=useCallback((colorId,cell,cx,cy)=>{
    boot();
    swipeRef.current={colorId,cell,sx:cx,sy:cy,swiped:false};
    // Play sound immediately on press
    const kitIdx=assignRef.current[colorId];
    const kit=COLOR_KITS[kitIdx];
    if(kit&&kit.sounds[cell])kit.sounds[cell]();
  },[]);

  // PointerUp on sticker: handle swipe-slice if movement exceeded threshold
  const onSticker=useCallback((colorId,cell,cx,cy)=>{
    const sw=swipeRef.current;
    swipeRef.current=null;
    if(!sw||sw.swiped)return;
    const dx=cx-sw.sx,dy=cy-sw.sy;
    const dist=Math.sqrt(dx*dx+dy*dy);
    const thresh=Math.min(window.innerWidth,window.innerHeight)*0.045;
    if(dist>thresh&&!animLock.current){
      const rect=sceneRef.current?.getBoundingClientRect();
      if(rect){
        const mv=getSlice(sw.sx,sw.sy,rect,orbitRef.current.x,orbitRef.current.y,dx,dy);
        runSlice(mv.axis,mv.layer,mv.cw);
      }
    }
  },[runSlice]);

  // Orbit on empty space
  const dragRef=useRef({on:false,lx:0,ly:0,vx:0,vy:0,lt:0});
  const sceneRef=useRef(null);

  const onSceneDown=useCallback((e)=>{
    boot();
    const p=e.touches?e.touches[0]:e;
    // stickerのonPointerDownが先に発火してswipeRefをセットしている場合はdrag不要
    if(swipeRef.current){return;}
    dragRef.current={on:true,lx:p.clientX,ly:p.clientY,vx:0,vy:0,lt:performance.now()};
    e.currentTarget.setPointerCapture&&e.currentTarget.setPointerCapture(e.pointerId);
  },[]);

  const onSceneMove=useCallback((e)=>{
    const p=e.touches?e.touches[0]:e;
    // Swipe on sticker?
    const sw=swipeRef.current;
    if(sw&&!sw.swiped){
      const dx=p.clientX-sw.sx,dy=p.clientY-sw.sy;
      const dist=Math.sqrt(dx*dx+dy*dy);
      const thresh=Math.min(window.innerWidth,window.innerHeight)*0.045;
      if(dist>thresh&&!animLock.current){
        const rect=sceneRef.current?.getBoundingClientRect();
        if(rect){
          const mv=getSlice(sw.sx,sw.sy,rect,orbitRef.current.x,orbitRef.current.y,dx,dy);
          sw.swiped=true;
          runSlice(mv.axis,mv.layer,mv.cw);
          return;
        }
      }
      return;
    }
    if(sw)return;
    const d=dragRef.current;if(!d.on)return;
    const dx=p.clientX-d.lx,dy=p.clientY-d.ly;
    const now=performance.now(),dt=Math.max(now-d.lt,1);
    d.vx=dx/dt*16;d.vy=dy/dt*16;
    d.lx=p.clientX;d.ly=p.clientY;d.lt=now;
    orbitRef.current.y+=dx*0.45;
    orbitRef.current.x=Math.max(-80,Math.min(80,orbitRef.current.x-dy*0.45));
    applyOrbit();
  },[applyOrbit,runSlice]);

  const onSceneUp=useCallback(()=>{
    swipeRef.current=null;
    const d=dragRef.current;if(!d.on)return;d.on=false;
    (function loop(){
      d.vx*=0.91;d.vy*=0.91;
      orbitRef.current.y+=d.vx*0.45;
      orbitRef.current.x=Math.max(-80,Math.min(80,orbitRef.current.x-d.vy*0.45));
      applyOrbit();
      if(Math.abs(d.vx)>0.06||Math.abs(d.vy)>0.06)animRaf.current=requestAnimationFrame(loop);
    })();
  },[applyOrbit]);

  // Sequencer
  const flashStep=useCallback((s)=>{
    stepEls.current.forEach((el,i)=>{if(!el)return;el.style.outline=i===s?"2px solid #FFD700":"none";});
  },[]);
  const scheduler=useCallback(()=>{
    if(!AC)return;
    while(nextTRef.current<AC.currentTime+0.1){
      const step=stepRef.current;
      if(metroRef.current)metroTick(step%4===0);
      for(let ci=0;ci<6;ci++){
        const kit=COLOR_KITS[assignRef.current[ci]];
        for(let cell=0;cell<9;cell++)
          if(seqsRef.current[ci][cell][step])kit.sounds[cell]();
      }
      const s=step;
      setTimeout(()=>flashStep(s),Math.max(0,(nextTRef.current-AC.currentTime)*1000));
      stepRef.current=(step+1)%NS;
      nextTRef.current+=60/bpmRef.current/4;
    }
    timerRef.current=setTimeout(scheduler,25);
  },[flashStep]);

  const stopPlay=useCallback(()=>{
    playRef.current=false;clearTimeout(timerRef.current);
    stepEls.current.forEach(el=>el&&(el.style.outline="none"));setPlaying(false);
  },[]);
  const startPlay=useCallback(()=>{
    const a=boot();playRef.current=true;stepRef.current=0;
    nextTRef.current=a.currentTime+0.05;scheduler();setPlaying(true);
  },[scheduler]);
  const toggleMetro=()=>{const n=!metro;setMetro(n);metroRef.current=n;if(n)metroTick(true);};

  let staticC=cubies,animC=[];
  if(sliceAnim){
    const ai=sliceAnim.axis==="x"?0:sliceAnim.axis==="y"?1:2;
    animC=cubies.filter(c=>c.pos[ai]===sliceAnim.layer);
    staticC=cubies.filter(c=>c.pos[ai]!==sliceAnim.layer);
  }

  return(
    <div style={S.root}>
      <div style={S.hd}>
        <div style={S.logo}>RUBIK <span style={{color:"#ff3e6c"}}>RHYTHM</span></div>
        <button style={{...S.iBtn,position:"absolute",right:12,fontSize:26,border:"none",padding:"4px 8px",color:"rgba(255,255,255,.7)"}}
          onClick={()=>setShowSettings(true)}>🎛</button>
      </div>

      <div ref={sceneRef} style={S.scene}
        onPointerDown={onSceneDown}
        onPointerMove={onSceneMove}
        onPointerUp={onSceneUp}
        onPointerCancel={onSceneUp}>
        <div style={{perspective:800,perspectiveOrigin:"50% 50%"}}>
          <div ref={orbitElRef} style={{...S.orbit,
            transform:`rotateX(${orbitRef.current.x}deg) rotateY(${orbitRef.current.y}deg)`}}>
            <div style={S.origin}>
              {staticC.map((c,i)=>(
                <Cubie key={"s"+i} pos={c.pos} faces={c.faces}
                  onSticker={onSticker} onSwipeStart={onSwipeStart}/>
              ))}
              {sliceAnim&&(
                <SliceGroup cubies={animC} axis={sliceAnim.axis} cw={sliceAnim.cw} progress={sliceAnim.progress}
                  onSticker={onSticker} onSwipeStart={onSwipeStart}/>
              )}
            </div>
          </div>
        </div>
        <div style={S.hint}>タップ: 音 ／ スワイプ: 列回転 ／ ドラッグ: 視点</div>
      </div>

      <div style={S.panel}>
        <div style={S.steps}>
          {Array.from({length:NS},(_,s)=>(
            <div key={s} ref={el=>stepEls.current[s]=el}
              style={{...S.step,background:seqs.some((_,ci)=>seqs[ci].some(sq=>sq[s]))?"rgba(255,255,255,0.2)":"rgba(255,255,255,0.06)"}}>
              <div style={S.sdots}>
                {Array.from({length:6},(_,ci)=>(
                  <div key={ci} style={{...S.sd,
                    background:seqs[ci].some(sq=>sq[s])?COL_SW[ci]:"transparent"}}/>
                ))}
              </div>
            </div>
          ))}
        </div>

      </div>

      {showRou&&<Roulette current={assign} onDone={(a)=>{setAssign(a);assignRef.current=a;setShowRou(false);}}/>}
      {showSettings&&(
        <div style={SS.overlay} onClick={()=>setShowSettings(false)}>
          <div style={SS.panel} onClick={e=>e.stopPropagation()}>
            <div style={SS.title}>🎛 SETTINGS</div>

            <div style={SS.section}>PLAYBACK</div>
            <div style={SS.row}>
              <span style={SS.label}>PLAY</span>
              <button style={{...SS.tog,...(playing?{borderColor:"#ff3e6c",color:"#ff3e6c",background:"rgba(255,62,108,.15)"}:{borderColor:"rgba(255,255,255,.25)",color:"rgba(255,255,255,.5)"})}}
                onClick={()=>{if(playRef.current)stopPlay();else startPlay();}}>
                {playing?"■ STOP":"▶ PLAY"}
              </button>
            </div>
            <div style={SS.row}>
              <span style={SS.label}>BPM</span>
              <input type="range" min="60" max="200" value={bpm} style={{...S.slider,flex:1}}
                onChange={e=>{const v=+e.target.value;setBpm(v);bpmRef.current=v;}}/>
              <span style={SS.val}>{bpm}</span>
            </div>
            <div style={SS.row}>
              <span style={SS.label}>METRO</span>
              <button style={{...SS.tog,borderColor:metro?"#FFD700":"rgba(255,255,255,.25)",color:metro?"#FFD700":"rgba(255,255,255,.4)"}}
                onClick={toggleMetro}>{metro?"ON ✓":"OFF"}</button>
            </div>

            <div style={SS.section}>SOUND</div>
            <div style={SS.row}>
              <span style={SS.label}>REVERB</span>
              <input type="range" min="0" max="100" value={reverb} style={{...S.slider,flex:1}}
                onChange={e=>{const v=+e.target.value;setReverb(v);setReverbLevel(v/100);}}/>
              <span style={SS.val}>{reverb}%</span>
            </div>

            <div style={SS.section}>CUBE</div>
            <div style={SS.row}>
              <span style={SS.label}>DRUM KIT</span>
              <button style={{...SS.tog,borderColor:"rgba(255,255,255,.3)",color:"rgba(255,255,255,.7)"}}
                onClick={()=>{setShowSettings(false);if(playRef.current)stopPlay();setShowRou(true);}}>🎲 SHUFFLE</button>
            </div>
            <div style={SS.row}>
              <span style={SS.label}>RESET</span>
              <button style={{...SS.tog,borderColor:"rgba(255,255,255,.25)",color:"rgba(255,255,255,.45)"}}
                onClick={()=>{if(animLock.current)return;cancelAnimationFrame(animRaf.current);animLock.current=false;setSliceAnim(null);setCubies(buildSolved());setShowSettings(false);}}>↺ CUBE</button>
            </div>

            <button style={{...S.btn,...S.btnOff,marginTop:6,alignSelf:"center",padding:"10px 32px"}}
              onClick={()=>setShowSettings(false)}>CLOSE</button>
          </div>
        </div>
      )}
    </div>
  );
}

const S={
  root:{width:"100vw",height:"100vh",display:"flex",flexDirection:"column",alignItems:"center",background:"linear-gradient(150deg,#1a2535 0%,#0f1e30 60%,#162035 100%)",fontFamily:"'Share Tech Mono',monospace",color:"#eee",overflow:"hidden",touchAction:"none",userSelect:"none"},
  hd:{width:"100%",display:"flex",alignItems:"center",justifyContent:"center",padding:"9px 16px",flexShrink:0,background:"rgba(5,10,22,0.85)",borderBottom:"1px solid rgba(255,255,255,0.07)",backdropFilter:"blur(12px)",zIndex:10,position:"relative"},
  logo:{fontFamily:"'Orbitron',sans-serif",fontWeight:900,fontSize:15,letterSpacing:5,color:"#fff"},
  scene:{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",width:"100%",minHeight:0,position:"relative",overflow:"hidden"},
  orbit:{transformStyle:"preserve-3d",willChange:"transform",cursor:"grab"},
  origin:{position:"relative",width:0,height:0,transformStyle:"preserve-3d"},
  hint:{fontSize:9,color:"rgba(255,255,255,0.14)",letterSpacing:1,marginTop:18},
  panel:{width:"100%",maxWidth:500,flexShrink:0,zIndex:10,background:"rgba(5,8,20,0.96)",borderTop:"1px solid rgba(255,255,255,0.07)",padding:"8px 12px 14px",display:"flex",flexDirection:"column",gap:6,backdropFilter:"blur(14px)"},
  steps:{display:"flex",gap:2},
  step:{flex:1,height:22,borderRadius:3,border:"1px solid rgba(255,255,255,0.04)",position:"relative",overflow:"hidden"},
  sdots:{position:"absolute",inset:3,display:"flex",flexDirection:"column",justifyContent:"space-evenly"},
  sd:{height:2,borderRadius:1},
  ctrl:{display:"flex",gap:5,alignItems:"center"},
  btn:{fontFamily:"'Orbitron',sans-serif",fontSize:9,fontWeight:700,letterSpacing:1,padding:"9px 10px",borderRadius:4,cursor:"pointer",whiteSpace:"nowrap",border:"1px solid",background:"transparent",flexShrink:0},
  btnOff:{borderColor:"#ff3e6c",color:"#ff3e6c"},
  btnOn:{borderColor:"#ff3e6c",background:"#ff3e6c",color:"#000",boxShadow:"0 0 14px rgba(255,62,108,.5)"},
  iBtn:{padding:"8px 10px",borderRadius:4,cursor:"pointer",border:"1px solid rgba(255,255,255,.2)",color:"rgba(255,255,255,.45)",background:"transparent",flexShrink:0,transition:"all 0.15s"},
  bpmWrap:{flex:1,display:"flex",alignItems:"center",gap:5},
  slider:{flex:1,WebkitAppearance:"none",height:3,background:"rgba(255,255,255,.15)",borderRadius:2,outline:"none",cursor:"pointer"},
};

const SS={
  overlay:{position:"fixed",inset:0,background:"rgba(0,0,0,0.72)",zIndex:200,display:"flex",alignItems:"center",justifyContent:"center",backdropFilter:"blur(5px)"},
  panel:{background:"linear-gradient(160deg,#1a2535,#0f1820)",border:"1px solid rgba(255,255,255,0.13)",borderRadius:14,padding:"28px 24px",display:"flex",flexDirection:"column",gap:18,minWidth:290,maxWidth:"90vw",boxShadow:"0 24px 64px rgba(0,0,0,0.85)"},
  title:{fontFamily:"'Orbitron',sans-serif",fontWeight:900,fontSize:13,letterSpacing:4,color:"#fff",textAlign:"center",marginBottom:2},
  row:{display:"flex",alignItems:"center",gap:12},
  label:{fontSize:9,letterSpacing:2,color:"rgba(255,255,255,0.4)",minWidth:80,fontFamily:"'Share Tech Mono',monospace"},
  val:{fontSize:10,color:"rgba(255,255,255,0.7)",minWidth:36,textAlign:"right"},
  tog:{padding:"6px 16px",borderRadius:4,cursor:"pointer",border:"1px solid",background:"transparent",fontFamily:"'Share Tech Mono',monospace",fontSize:10,letterSpacing:1,transition:"all 0.15s"},
  section:{fontSize:8,letterSpacing:3,color:"rgba(255,255,255,.25)",borderBottom:"1px solid rgba(255,255,255,.07)",paddingBottom:4,marginTop:2},
};
