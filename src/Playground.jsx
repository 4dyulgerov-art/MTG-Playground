import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { storage } from "./lib/storage";
import { NetSync } from "./lib/netSync";

/* ─── v7 surgical edit ─────────────────────────────────────────────────
   The inline localStorage shim has been replaced by an import from
   ./lib/storage. That module accepts a `shared` flag: when false it
   uses localStorage (identical to v6 behaviour), when true it routes
   to Supabase. v6's RoomLobby already passes shared=true for every
   room-related call, so rooms automatically become cross-computer
   without any changes to RoomLobby itself.
   ───────────────────────────────────────────────────────────────── */


/* ─── Sound System ─────────────────────────────────────────────────── */
/*
  3 built-in synth styles per action (Natural / Arcade / Minimal)
  + optional user-supplied direct audio URL per action.
  Prefs stored in localStorage as "mtg_sfx_prefs_v2".
*/

const SOUND_PACKS = {
  draw:           { label:"🎴 Draw card" },
  tap:            { label:"⟳ Tap / Untap" },
  shuffle:        { label:"🔀 Shuffle" },
  toGraveyard:    { label:"☠ To Graveyard" },
  toExile:        { label:"✦ To Exile",             presets:[{id:"natural",label:"Choir Aria"},{id:"holy2",label:"Bell Toll"},{id:"holy3",label:"Crystal Shimmer"}] },
  toBattlefield:  { label:"▶ Play to Battlefield" },
  reanimate:      { label:"✦ Reanimate (grave→BF)",  presets:[{id:"natural",label:"Spooky Bells"},{id:"spooky2",label:"Dark Organ"},{id:"spooky3",label:"Ghost Choir"}] },
  commanderSummon:{ label:"⚔ Commander Summon" },
  lifeChange:     { label:"♥ Life Change" },
  flip:           { label:"↕ Transform (DFC)" },
  mill:           { label:"💀 Mill" },
  counter:        { label:"◈ Add Counter" },
  token:          { label:"✦ Create Token" },
  hover:          { label:"👆 Card Hover" },
};

const SFX = (() => {
  let ctx = null;
  let muted = false;
  let volume = 0.6;
  const bufCache = {};

  let prefs = {};
  let userUrls = {};
  try {
    prefs = JSON.parse(localStorage.getItem("mtg_sfx_prefs_v2") || "{}");
    userUrls = JSON.parse(localStorage.getItem("mtg_sfx_urls") || "{}");
    volume = parseFloat(localStorage.getItem("mtg_sfx_vol") || "0.6");
  } catch {}

  const ac = () => {
    if (!ctx) try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch {}
    if (ctx?.state === "suspended") ctx.resume();
    return ctx;
  };

  const G = (g) => {
    ac(); // ensure ctx exists
    const gn = ctx.createGain();
    gn.gain.value = muted ? 0 : volume * g;
    gn.connect(ctx.destination);
    return gn;
  };

  const O = (type, freq, t, dur, g = 0.4) => {
    const o = ctx.createOscillator(), gn = G(g);
    o.type = type; o.frequency.setValueAtTime(freq, t);
    gn.gain.setValueAtTime(muted?0:volume*g, t);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(gn); o.start(t); o.stop(t + dur + 0.02);
  };

  const OS = (type, f0, f1, t, dur, g = 0.3) => {
    const o = ctx.createOscillator(), gn = G(g);
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    gn.gain.setValueAtTime(muted?0:volume*g, t);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(gn); o.start(t); o.stop(t + dur + 0.02);
  };

  const N = (t, dur, g = 0.2, hp = 800, lp = 8000) => {
    const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    const fh = ctx.createBiquadFilter(); fh.type="highpass"; fh.frequency.value=hp;
    const fl = ctx.createBiquadFilter(); fl.type="lowpass";  fl.frequency.value=lp;
    const gn = G(g);
    gn.gain.setValueAtTime(muted?0:volume*g, t);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.buffer = buf;
    src.connect(fh); fh.connect(fl); fl.connect(gn);
    src.start(t); src.stop(t + dur + 0.02);
  };

  const sounds = {
    draw: {
      natural(t) { N(t,.055,.55,1800,12000); N(t+.01,.04,.35,2500,9000); O("sine",3200,t,.04,.06); },
      arcade(t)  { OS("square",200,800,t,.08,.25); O("sine",1200,t+.06,.06,.15); },
      minimal(t) { N(t,.03,.18,3000,10000); },
    },
    tap: {
      // Cardboard spin: stiff paper whoosh with rotation body
      natural(t) {
        // Main spin body — filtered noise shaped like stiff paper rotating
        N(t,.018,.7,600,9000);      // initial card friction
        N(t+.005,.025,.55,1800,14000); // high paper hiss
        N(t+.012,.018,.4,3000,18000);  // snap at end of rotation
        // Low thump as card lands flat
        O("sine",110,t+.015,.12,.45);
        O("triangle",70,t+.015,.1,.3);
      },
      arcade(t)  { OS("square",180,80,t,.08,.25); N(t,.015,.2,1500,9000); },
      minimal(t) { N(t,.015,.18,2000,11000); O("sine",100,t+.01,.1,.2); },
    },
    untap: {
      // Same cardboard spin — slightly lighter
      natural(t) {
        N(t,.018,.6,600,9000);
        N(t+.005,.022,.42,2000,15000);
        N(t+.01,.015,.3,3500,18000);
        O("sine",130,t+.012,.1,.35);
        O("triangle",90,t+.012,.08,.22);
      },
      arcade(t)  { OS("square",80,180,t,.08,.2); N(t,.014,.18,1500,9000); },
      minimal(t) { N(t,.014,.15,2200,12000); O("sine",120,t+.01,.08,.18); },
    },
    untapAll: {
      natural(t) {
        // Cascade of cardboard spins
        for(let i=0;i<6;i++){
          const dt=i*.038;
          N(t+dt,.016,.5-i*.04,600+i*100,9000+i*500);
          N(t+dt+.005,.02,.35-i*.03,2000,15000);
          O("sine",110-i*3,t+dt+.013,.1,.35);
        }
        // Settling chime
        O("sine",660,t+.26,.5,.14); O("sine",880,t+.30,.4,.09);
      },
      arcade(t)  { for(let i=0;i<5;i++)OS("square",200+i*40,400+i*40,t+i*.04,.08,.2);O("sine",800,t+.22,.3,.2); },
      minimal(t) { for(let i=0;i<4;i++)O("sine",130,t+i*.05,.07,.18); },
    },
    // Hover sound — synthesized from jsfxr parameters
    hover: {
      natural(t) {
        // Full sfxr synthesis of the provided param set
        const a=ac();if(!a||muted)return;
        const p={
          wave_type:3,
          p_env_attack:0.116,p_env_sustain:0,p_env_punch:0.407,p_env_decay:0.189,
          p_base_freq:1,p_freq_limit:0,p_freq_ramp:0.05704349114789018,p_freq_dramp:-0.13555646611377947,
          p_vib_strength:0.0015525788892596548,p_vib_speed:0.6208568442432087,
          p_arp_mod:-0.4219566625941058,p_arp_speed:-0.15218242222938771,
          p_duty:-0.23611958250648657,p_duty_ramp:-0.4174497848795579,
          p_repeat_speed:-0.2144297965962283,
          p_pha_offset:0.05317492298671885,p_pha_ramp:-0.009843237298553553,
          p_lpf_freq:0.8556560137658287,p_lpf_ramp:0.21767203878651387,p_lpf_resonance:0.9092263558408065,
          p_hpf_freq:4.948924973026715e-9,p_hpf_ramp:0.21086859822877702,
          sound_vol:0.25,
        };
        const sampleRate=44100;
        // Envelope lengths
        const envLen=[
          Math.floor(p.p_env_attack*p.p_env_attack*100000),
          Math.floor(p.p_env_sustain*p.p_env_sustain*100000),
          Math.floor(p.p_env_decay*p.p_env_decay*100000),
        ];
        const totalLen=envLen[0]+envLen[1]+envLen[2];
        if(totalLen<=0)return;

        const buf=a.createBuffer(1,totalLen,sampleRate);
        const data=buf.getChannelData(0);

        // State
        let period=100/( p.p_base_freq*p.p_base_freq+0.001);
        let maxPeriod=100/(p.p_freq_limit*p.p_freq_limit+0.001);
        let slide=1-p.p_freq_ramp*p.p_freq_ramp*p.p_freq_ramp*0.01;
        let dslide=-p.p_freq_dramp*p.p_freq_dramp*p.p_freq_dramp*0.000001;
        let squareDuty=0.5-p.p_duty*0.5;
        let squareSlide=-p.p_duty_ramp*0.00005;
        let arpTime=0,arpLimit=p.p_arp_speed===1?0:Math.floor((1-p.p_arp_speed)*(1-p.p_arp_speed)*20000+32);
        let arpMod=p.p_arp_mod>=0?(1+p.p_arp_mod*0.0015):(1/(1-p.p_arp_mod*0.0015));
        let phase=0,phaserOffset=p.p_pha_offset*p.p_pha_offset*(p.p_pha_offset<0?-1:1)*1020;
        let phaserDoff=p.p_pha_ramp*p.p_pha_ramp*(p.p_pha_ramp<0?-1:1)*0.1;
        const phaserBuf=new Float32Array(1024).fill(0);
        let phaserPos=0;
        let lpFilterPos=0,lpFilterPosOld=0,lpFilterCutoff=p.p_lpf_freq*p.p_lpf_freq*p.p_lpf_freq*0.1;
        let lpFilterDamp=1-p.p_lpf_resonance*0.01*(0.01+lpFilterCutoff)*5;
        let lpFilterOn=p.p_lpf_freq!==1,lpFilterDoff=p.p_lpf_ramp*0.0001,lpFilterVel=0;
        let hpFilterPos=0,hpFilterCutoff=p.p_hpf_freq*p.p_hpf_freq*0.1,hpFilterDoff=1+p.p_hpf_ramp*0.0003;
        let vibPhase=0,vibSpeed=p.p_vib_speed*p.p_vib_speed*0.01,vibAmp=p.p_vib_strength*0.5;
        let repTime=0,repLimit=p.p_repeat_speed===0?0:Math.floor((1-p.p_repeat_speed)*(1-p.p_repeat_speed)*20000+32);
        let envelopeTime=0,envelopeStage=0,envelopeVol=0;

        for(let i=0;i<totalLen;i++){
          // Repeat
          if(repLimit!==0&&++repTime>=repLimit){
            repTime=0;period=100/(p.p_base_freq*p.p_base_freq+0.001);
            slide=1-p.p_freq_ramp*p.p_freq_ramp*p.p_freq_ramp*0.01;
            dslide=-p.p_freq_dramp*p.p_freq_dramp*p.p_freq_dramp*0.000001;
            squareDuty=0.5-p.p_duty*0.5;squareSlide=-p.p_duty_ramp*0.00005;
            arpTime=0;arpMod=p.p_arp_mod>=0?(1+p.p_arp_mod*0.0015):(1/(1-p.p_arp_mod*0.0015));
          }
          // Arpeggio
          if(arpLimit!==0&&++arpTime>=arpLimit){arpTime=0;period*=arpMod;}
          // Freq slide
          slide+=dslide;period*=slide;if(period>maxPeriod){period=maxPeriod;if(p.p_freq_limit>0)break;}
          // Vibrato
          vibPhase+=vibSpeed;const vibrato=1+Math.sin(vibPhase)*vibAmp;
          const curPeriod=Math.round(period*vibrato);
          // Square duty
          squareDuty=Math.max(0,Math.min(0.95,squareDuty+squareSlide));
          // Envelope
          if(++envelopeTime>envLen[envelopeStage]){envelopeTime=0;if(++envelopeStage>2)break;}
          if(envelopeStage===0) envelopeVol=envelopeTime/envLen[0];
          else if(envelopeStage===1) envelopeVol=1+p.p_env_punch*(1-envelopeTime/envLen[1]);
          else envelopeVol=1-envelopeTime/envLen[2];
          // LPF
          lpFilterCutoff=Math.max(0,Math.min(0.1,lpFilterCutoff*(1+lpFilterDoff)));
          if(lpFilterOn){lpFilterDamp=Math.min(lpFilterDamp,1);lpFilterVel*=lpFilterDamp;lpFilterVel+=((phase<curPeriod*squareDuty?1:-1)-lpFilterPos)*lpFilterCutoff;lpFilterPos+=lpFilterVel;}
          else lpFilterPos=(phase<curPeriod*squareDuty?1:-1);
          // HPF
          hpFilterCutoff=Math.max(0,Math.min(0.1,hpFilterCutoff*hpFilterDoff));
          hpFilterPos+=lpFilterPos-lpFilterPosOld;hpFilterPos*=1-hpFilterCutoff;
          lpFilterPosOld=lpFilterPos;
          let sample=hpFilterPos;
          // Phaser
          phaserOffset+=phaserDoff;const iphase=Math.abs(Math.round(phaserOffset));
          phaserBuf[phaserPos&1023]=sample;sample+=phaserBuf[(phaserPos-iphase+1024)&1023];phaserPos=(phaserPos+1)&1023;
          // Oscillator
          phase++;if(phase>=curPeriod)phase=0;
          data[i]=sample*envelopeVol*p.sound_vol*volume;
        }

        const src=a.createBufferSource();
        src.buffer=buf;
        const g=a.createGain();g.gain.value=muted?0:1;
        src.connect(g);g.connect(a.destination);
        src.start(t);
      },
      arcade(t)  { N(t,.016,.18,2000,12000); O("sine",1100,t,.012,.06); },
      minimal(t) { N(t,.012,.1,2500,10000); },
    },
    // Holy bell/chime for reanimation
    reanimate: {
      // ── Spooky resurrection — 1.5 seconds ──
      natural(t) {
        // 1. Low rumble rises
        const rumble=ctx.createOscillator(), rg=G(.35);
        rumble.type="sine"; rumble.frequency.setValueAtTime(38,t);
        rumble.frequency.linearRampToValueAtTime(55,t+.75);
        rg.gain.setValueAtTime(0,t);
        rg.gain.linearRampToValueAtTime(volume*.35,t+.15);
        rg.gain.linearRampToValueAtTime(volume*.18,t+1.2);
        rg.gain.linearRampToValueAtTime(0,t+1.5);
        rumble.connect(rg); rumble.start(t); rumble.stop(t+1.6);
        // LFO tremolo
        const lfo=ctx.createOscillator(), lg=ctx.createGain();
        lfo.frequency.value=5.5; lg.gain.value=0.08;
        lfo.connect(lg); lg.connect(rg.gain);
        lfo.start(t); lfo.stop(t+1.6);

        // 2. Diminished 7th bells — B D F Ab, tighter spacing
        [[246.9,.05],[293.7,.28],[349.2,.55],[415.3,.85]].forEach(([f,dt])=>{
          const bel=ctx.createOscillator(), bg=G(.0);
          bel.type="sine"; bel.frequency.value=f;
          bg.gain.setValueAtTime(0,t+dt);
          bg.gain.linearRampToValueAtTime(volume*.28,t+dt+.03);
          bg.gain.exponentialRampToValueAtTime(volume*.05,t+dt+.4);
          bg.gain.exponentialRampToValueAtTime(0.0001,t+dt+1.1);
          bel.connect(bg); bel.start(t+dt); bel.stop(t+dt+1.2);
          // Detuned harmonic
          const h=ctx.createOscillator(), hg=G(.0);
          h.type="sine"; h.frequency.value=f*2.01;
          hg.gain.setValueAtTime(0,t+dt); hg.gain.linearRampToValueAtTime(volume*.09,t+dt+.04);
          hg.gain.exponentialRampToValueAtTime(0.0001,t+dt+.7);
          h.connect(hg); h.start(t+dt); h.stop(t+dt+.8);
        });

        // 3. Ghost wail — compressed sweep
        const wail=ctx.createOscillator(), wg=G(.0);
        wail.type="sine";
        wail.frequency.setValueAtTime(180,t+.2);
        wail.frequency.exponentialRampToValueAtTime(520,t+.9);
        wail.frequency.exponentialRampToValueAtTime(300,t+1.4);
        wg.gain.setValueAtTime(0,t+.2);
        wg.gain.linearRampToValueAtTime(volume*.18,t+.5);
        wg.gain.linearRampToValueAtTime(volume*.08,t+1.2);
        wg.gain.linearRampToValueAtTime(0,t+1.5);
        const vib=ctx.createOscillator(), vg=ctx.createGain();
        vib.frequency.value=6; vg.gain.value=12;
        vib.connect(vg); vg.connect(wail.frequency);
        wail.connect(wg); wail.start(t+.2); wail.stop(t+1.6);
        vib.start(t+.2); vib.stop(t+1.6);

        // 4. Cold wind
        N(t+.1,1.4,.08,200,900);
        N(t+.25,1.2,.05,1800,4000);
      },
      arcade(t) {
        OS("sawtooth",80,300,t,.4,.3);
        [200,250,300].forEach((f,i)=>OS("square",f,f*1.5,t+i*.15,.4,.15));
        O("sine",220,t+.5,.5,.2);
      },
      minimal(t) {
        O("sine",150,t,1,.25); O("sine",185,t+.15,.9,.15);
        N(t,.4,.06,300,1200);
      },
    },
    // Reanimate preset 2 — Dark Organ: low minor organ chord that swells and fades
    spooky2: {
      natural(t) {
        // Minor chord: A2 C3 E3 — classic horror organ
        [[110,.0],[130.8,.06],[164.8,.12]].forEach(([f,dt])=>{
          const o=ctx.createOscillator(), g=G(.0);
          o.type="sawtooth"; o.frequency.value=f;
          // Detune slightly for organ warmth
          o.detune.value=(Math.random()-0.5)*8;
          g.gain.setValueAtTime(0,t+dt);
          g.gain.linearRampToValueAtTime(volume*.3,t+dt+.2);
          g.gain.setValueAtTime(volume*.28,t+.9);
          g.gain.linearRampToValueAtTime(0,t+1.5);
          o.connect(g); o.start(t+dt); o.stop(t+1.6);
          // Octave harmonic
          const o2=ctx.createOscillator(), g2=G(.0);
          o2.type="sine"; o2.frequency.value=f*2;
          g2.gain.setValueAtTime(0,t+dt); g2.gain.linearRampToValueAtTime(volume*.1,t+dt+.25);
          g2.gain.linearRampToValueAtTime(0,t+1.5);
          o2.connect(g2); o2.start(t+dt); o2.stop(t+1.6);
        });
        // Slow tremolo filter
        const lfo=ctx.createOscillator(), lg=ctx.createGain();
        lfo.frequency.value=3; lg.gain.value=0.06;
        lfo.start(t); lfo.stop(t+1.6);
        // Noise like old organ bellows
        N(t+.1,1.3,.05,150,600);
        N(t,.5,.04,2000,6000);
      },
      arcade(t) { [220,277,330].forEach((f,i)=>O("sawtooth",f,t+i*.08,.8,.25)); },
      minimal(t) { O("sawtooth",110,t,1,.25); O("sawtooth",165,t+.1,.9,.15); },
    },
    // Reanimate preset 3 — Ghost Choir: eerie detuned voices in unison, trembling
    spooky3: {
      natural(t) {
        // Three voices at slightly different pitches — unsettling unison
        [[196,.0,4],[196.8,.04,5],[195.2,.08,6]].forEach(([f,dt,vibRate])=>{
          const o=ctx.createOscillator(), g=G(.0);
          o.type="sine"; o.frequency.value=f;
          g.gain.setValueAtTime(0,t+dt);
          g.gain.linearRampToValueAtTime(volume*.22,t+dt+.3);
          g.gain.setValueAtTime(volume*.2,t+1.0);
          g.gain.linearRampToValueAtTime(0,t+1.5);
          // Slow vibrato — wailing quality
          const vib=ctx.createOscillator(), vg=ctx.createGain();
          vib.frequency.value=vibRate; vg.gain.value=6;
          vib.connect(vg); vg.connect(o.frequency);
          o.connect(g); o.start(t+dt); o.stop(t+1.6);
          vib.start(t+dt); vib.stop(t+1.6);
        });
        // High eerie whistle above
        OS("sine",784,650,t+.3,.9,.08);
        N(t+.1,1.3,.05,300,1200);
      },
      arcade(t) { [200,250,300].forEach((f,i)=>OS("sine",f,f*.8,t+i*.1,.7,.18)); },
      minimal(t) { O("sine",196,t,1,.2); OS("sine",800,650,t+.2,.8,.08); },
    },
    toExile: {
      // ── Holy aria — 1.5 seconds ──
      natural(t) {
        // 1. Open 5th pad — C+G, entries compressed
        [[261.6,0],[392,.04],[523,.09],[784,.16]].forEach(([f,dt])=>{
          const p=ctx.createOscillator(), pg=G(.0);
          p.type="sine"; p.frequency.value=f;
          pg.gain.setValueAtTime(0,t+dt);
          pg.gain.linearRampToValueAtTime(volume*.18,t+dt+.18);
          pg.gain.setValueAtTime(volume*.18,t+.9);
          pg.gain.linearRampToValueAtTime(0,t+1.5);
          p.connect(pg); p.start(t+dt); p.stop(t+1.6);
        });

        // 2. Cathedral bell — strikes immediately, decays over 1.4s
        const bell=ctx.createOscillator(), bg=G(.0);
        bell.type="sine"; bell.frequency.value=1046.5;
        bg.gain.setValueAtTime(0,t); bg.gain.linearRampToValueAtTime(volume*.42,t+.05);
        bg.gain.exponentialRampToValueAtTime(volume*.1,t+.6);
        bg.gain.exponentialRampToValueAtTime(0.0001,t+1.4);
        bell.connect(bg); bell.start(t); bell.stop(t+1.5);
        // Shimmer harmonic
        const bh=ctx.createOscillator(), bhg=G(.0);
        bh.type="sine"; bh.frequency.value=1318.5*1.003;
        bhg.gain.setValueAtTime(0,t); bhg.gain.linearRampToValueAtTime(volume*.18,t+.06);
        bhg.gain.exponentialRampToValueAtTime(0.0001,t+1.0);
        bh.connect(bhg); bh.start(t); bh.stop(t+1.1);

        // 3. Choir voices — E G B E entering quickly
        [[329.6,.2],[392,.38],[493.9,.58],[659.3,.78]].forEach(([f,dt])=>{
          const v=ctx.createOscillator(), vg=G(.0);
          v.type="sine"; v.frequency.value=f;
          vg.gain.setValueAtTime(0,t+dt);
          vg.gain.linearRampToValueAtTime(volume*.13,t+dt+.15);
          vg.gain.setValueAtTime(volume*.13,t+dt+.22);
          vg.gain.linearRampToValueAtTime(0,t+1.5);
          const vi=ctx.createOscillator(), vig=ctx.createGain();
          vi.frequency.value=4.5; vig.gain.value=3;
          vi.connect(vig); vig.connect(v.frequency);
          v.connect(vg); v.start(t+dt); v.stop(t+1.6);
          vi.start(t+dt); vi.stop(t+1.6);
        });

        // 4. High shimmer — compressed
        [[2093,.15],[2637,.3],[3136,.45]].forEach(([f,dt])=>{
          const s=ctx.createOscillator(), sg=G(.0);
          s.type="sine"; s.frequency.value=f;
          sg.gain.setValueAtTime(0,t+dt);
          sg.gain.linearRampToValueAtTime(volume*.07,t+dt+.1);
          sg.gain.exponentialRampToValueAtTime(0.0001,t+dt+.8);
          s.connect(sg); s.start(t+dt); s.stop(t+dt+.9);
        });

        // 5. Breath of light
        N(t+.05,1.4,.04,6000,18000);
        N(t+.25,1.1,.03,4000,14000);
      },
      arcade(t) {
        [523,659,784,1047,1319].forEach((f,i)=>O("sine",f,t+i*.09,.7,.2-i*.02));
        OS("sine",1000,3000,t+.25,.75,.12);
      },
      minimal(t) {
        O("sine",880,t,1,.18); O("sine",1100,t+.1,.9,.12); O("sine",1320,t+.25,.75,.08);
      },
    },
    // Exile preset 2 — Bell Toll: a single deep cathedral bell with long overtones
    holy2: {
      natural(t) {
        // Main bell — G4 (392Hz), struck hard
        const bell=ctx.createOscillator(), bg=G(.0);
        bell.type="sine"; bell.frequency.value=392;
        bg.gain.setValueAtTime(0,t); bg.gain.linearRampToValueAtTime(volume*.55,t+.04);
        bg.gain.exponentialRampToValueAtTime(volume*.08,t+.9);
        bg.gain.exponentialRampToValueAtTime(0.0001,t+1.5);
        bell.connect(bg); bell.start(t); bell.stop(t+1.6);
        // Inharmonic partials (real bells have irrational overtones)
        [[392*2.76,.18],[392*5.4,.1],[392*8.93,.07]].forEach(([f,g])=>{
          const o=ctx.createOscillator(), og=G(.0);
          o.type="sine"; o.frequency.value=f;
          og.gain.setValueAtTime(0,t); og.gain.linearRampToValueAtTime(volume*g,t+.04);
          og.gain.exponentialRampToValueAtTime(0.0001,t+.8+g*3);
          o.connect(og); o.start(t); o.stop(t+1.5);
        });
        // Sub rumble — the physical resonance of a huge bell
        O("sine",98,t,.25,.3);
        O("sine",49,t,.35,.2);
        // Shimmer tail
        N(t+.05,1.4,.03,5000,16000);
      },
      arcade(t) { O("sine",392,t,.8,.4); O("sine",1082,t+.02,.5,.18); O("sine",3493,t+.03,.3,.1); },
      minimal(t) { O("sine",392,t,1,.35); O("sine",1082,t+.03,.7,.12); },
    },
    // Exile preset 3 — Crystal Shimmer: high glass harmonic series, like divine light
    holy3: {
      natural(t) {
        // Rising crystal harmonic series — G5 and its upper partials
        [[784,.0,.35],[1047,.08,.28],[1319,.16,.22],[1568,.24,.17],[1976,.32,.12],[2637,.4,.08]].forEach(([f,dt,g])=>{
          const o=ctx.createOscillator(), og=G(.0);
          o.type="sine"; o.frequency.value=f;
          og.gain.setValueAtTime(0,t+dt);
          og.gain.linearRampToValueAtTime(volume*g,t+dt+.1);
          og.gain.exponentialRampToValueAtTime(volume*g*.3,t+dt+.7);
          og.gain.linearRampToValueAtTime(0,t+1.5);
          o.connect(og); o.start(t+dt); o.stop(t+1.6);
        });
        // Glassy noise — like a crystal bowl singing
        N(t+.05,1.3,.05,4000,20000);
        // Very subtle pad underneath
        O("sine",261.6,t,.8,.08); O("sine",392,t,.8,.06);
      },
      arcade(t) { [784,1047,1319,1568,1976].forEach((f,i)=>O("sine",f,t+i*.07,.6,.2-i*.03)); },
      minimal(t) { [1047,1319,1568].forEach((f,i)=>O("sine",f,t+i*.1,.7,.12-i*.02)); },
    },
    shuffle: {
      natural(t) { for(let i=0;i<18;i++){const dt=i*.018+(Math.random()-.5)*.006;N(t+dt,.025,Math.max(.05,.45-i*.015),1200+Math.random()*1000,14000);} },
      arcade(t)  { for(let i=0;i<10;i++)OS("square",100+Math.random()*200,200+Math.random()*300,t+i*.03,.025,.12); },
      minimal(t) { N(t,.32,.22,1500,8000); N(t+.05,.2,.12,2000,10000); },
    },
    toGraveyard: {
      natural(t) { O("sine",55,t,.4,.8); O("sine",80,t,.3,.55); O("triangle",40,t+.02,.3,.4); N(t,.07,.55,150,2000); N(t,.04,.25,3000,8000); },
      arcade(t)  { OS("sawtooth",200,40,t,.3,.5); O("square",80,t,.25,.3); },
      minimal(t) { O("sine",70,t,.2,.4); N(t,.04,.15,200,1500); },
    },
    toBattlefield: {
      natural(t) { O("sine",110,t,.25,.55); O("sine",200,t,.18,.35); N(t,.04,.38,400,4000); N(t,.02,.15,3000,10000); O("sine",550,t+.04,.12,.12); },
      arcade(t)  { O("square",180,t,.1,.35); O("sine",440,t+.04,.12,.2); O("sine",880,t+.06,.08,.12); },
      minimal(t) { O("sine",130,t,.12,.3); N(t,.025,.18,600,4000); },
    },
    toHand: {
      natural(t) { N(t,.06,.3,1500,10000); O("sine",1800,t,.07,.08); N(t+.02,.04,.15,3000,14000); },
      arcade(t)  { OS("sine",600,1200,t,.08,.2); },
      minimal(t) { N(t,.04,.12,2000,10000); },
    },
    commanderSummon: {
      natural(t) {
        O("sine",40,t,1.0,.9); O("sine",60,t,.8,.7); O("triangle",30,t+.02,.7,.55);
        N(t,.2,.7,100,1500); N(t,.08,.4,3000,10000);
        OS("sine",180,1200,t+.08,.7,.35); OS("sine",240,1600,t+.1,.6,.22);
        [523,659,784,1047,1319].forEach((f,i)=>O("sine",f,t+.18+i*.07,.5-i*.05,.18-i*.02));
      },
      arcade(t)  { O("sawtooth",40,t,.5,.6); OS("square",100,400,t+.05,.4,.4); OS("sine",200,800,t+.1,.5,.3); [400,600,800,1000].forEach((f,i)=>O("square",f,t+.2+i*.06,.2,.2)); },
      minimal(t) { O("sine",55,t,.6,.5); OS("sine",200,800,t+.1,.4,.2); O("sine",880,t+.25,.3,.12); },
    },
    lifeGain: {
      natural(t) { [330,440,554].forEach((f,i)=>O("sine",f,t+i*.06,.28-i*.04,.22-i*.03)); },
      arcade(t)  { [400,600,800].forEach((f,i)=>O("square",f,t+i*.05,.15,.2)); },
      minimal(t) { O("sine",660,t,.15,.12); },
    },
    lifeLoss: {
      natural(t) { [220,165,110].forEach((f,i)=>O("sine",f,t+i*.07,.32-i*.04,.28-i*.04)); N(t,.06,.18,200,1200); },
      arcade(t)  { OS("square",300,80,t,.3,.4); O("sawtooth",80,t+.08,.2,.3); },
      minimal(t) { O("sine",160,t,.2,.2); N(t,.05,.1,300,1500); },
    },
    flip: {
      natural(t) { N(t,.07,.35,1200,10000); OS("sine",280,1400,t,.28,.28); N(t+.15,.05,.25,2000,12000); O("sine",2200,t+.22,.1,.12); },
      arcade(t)  { OS("square",200,1000,t,.2,.35); O("sine",1500,t+.18,.12,.15); },
      minimal(t) { N(t,.06,.2,1500,10000); O("sine",900,t+.04,.1,.1); },
    },
    mill: {
      natural(t) { N(t,.06,.4,1200,9000); O("sine",85,t,.18,.28); N(t+.02,.04,.2,2000,12000); },
      arcade(t)  { OS("square",300,100,t,.15,.3); N(t,.06,.15,800,5000); },
      minimal(t) { N(t,.04,.15,1500,8000); },
    },
    discard: {
      natural(t) { for(let i=0;i<5;i++){const dt=i*.05;N(t+dt,.05,.3,1000+Math.random()*600,9000);O("sine",75+i*8,t+dt,.1,.2);} },
      arcade(t)  { for(let i=0;i<4;i++)OS("square",300-i*50,100,t+i*.04,.08,.2); },
      minimal(t) { N(t,.18,.2,1200,8000); },
    },
    phaseNext: {
      natural(t) { O("sine",440,t,.06,.18); O("sine",660,t+.03,.05,.12); },
      arcade(t)  { O("square",400,t,.05,.2); },
      minimal(t) { O("sine",500,t,.04,.1); },
    },
    counter: {
      natural(t) { O("sine",900,t,.07,.14); O("sine",1350,t+.025,.05,.09); },
      arcade(t)  { O("square",600,t,.04,.18); O("square",900,t+.02,.03,.12); },
      minimal(t) { O("sine",800,t,.04,.08); },
    },
    token: {
      natural(t) { O("sine",440,t,.15,.22); O("sine",660,t+.04,.12,.16); O("sine",880,t+.08,.09,.12); N(t,.05,.1,2000,12000); },
      arcade(t)  { [300,500,700].forEach((f,i)=>O("square",f,t+i*.04,.1,.18)); },
      minimal(t) { O("sine",600,t,.1,.12); N(t,.03,.08,3000,14000); },
    },
  };

  // ── Catalog sounds — use same O/N/OS/G helpers as built-ins ──────────
  function BELL(freq,t,dur,g){ [[1,.9],[2.756,.4],[5.404,.18],[8.933,.08]].forEach(([r,rel])=>O("sine",freq*r,t,dur*(.3+rel*.7),g*rel)); }
  function VIB(freq,t,dur,g,vr,va){ const o=ctx.createOscillator(),gn=G(g),vib=ctx.createOscillator(),vg=ctx.createGain(); o.type="sine"; o.frequency.value=freq; vib.frequency.value=vr; vg.gain.value=va; vib.connect(vg); vg.connect(o.frequency); gn.gain.setValueAtTime(muted?0:volume*g,t); gn.gain.exponentialRampToValueAtTime(.0001,t+dur); o.connect(gn); o.start(t); o.stop(t+dur+.02); vib.start(t); vib.stop(t+dur+.02); }

  const catalogSounds = {
    rustle_whisper(t){ N(t,.045,.28,2200,9000); N(t+.01,.038,.18,3500,14000); N(t+.022,.025,.12,6000,20000); },
    rustle_sweep(t)  { N(t,.06,.42,1000,6000); N(t+.005,.05,.30,1800,10000); N(t+.015,.035,.20,3000,14000); N(t+.025,.022,.12,5000,18000); N(t,.008,.50,600,2500); },
    rustle_stiff(t)  { N(t,.025,.55,1400,5000); N(t,.012,.38,4000,16000); N(t+.018,.04,.28,900,4000); O("sine",140,t,.06,.22); },
    rustle_linen(t)  { for(let i=0;i<7;i++){const dt=i*.012+(Math.random()-.5)*.004; N(t+dt,.018,.22-i*.02,1200+i*200,8000+i*500);} },
    rustle_fan(t)    { N(t,.012,.50,2000,14000); N(t+.005,.018,.35,3000,18000); N(t+.005,.04,.18,400,2000); N(t+.06,.03,.45,300,1800); O("sine",95,t+.06,.08,.32); },
    vamp_coffin(t)   { OS("sawtooth",55,130,t,.8,.5); OS("sawtooth",53,127,t+.03,.85,.35); N(t+.1,.6,.16,60,500); N(t+.15,.4,.1,600,2200); [[110,.7],[130.8,.9],[164.8,1.1]].forEach(([f,d],i)=>{O("sawtooth",f,t+d,2.2,.38);O("sawtooth",f,t+d,2.2,.25);O("sine",f*.5,t+d,2.4,.18);}); O("sine",27.5,t+.6,2.2,.55); N(t+.7,2.0,.06,80,350); },
    vamp_blood(t)    { O("sine",50,t,.18,.55); O("sine",38,t+.02,.20,.42); N(t,.05,.6,80,500); O("sine",50,t+.44,.18,.38); N(t+.44,.05,.38,80,500); [[110,.8],[130.8,.92],[155.6,1.04],[184.9,1.16]].forEach(([f,d])=>{O("sawtooth",f,t+d,2.4,.38);O("sine",f*.5,t+d,2.6,.22);}); O("sine",27.5,t+.75,2.5,.50); },
    vamp_earth(t)    { for(let i=0;i<10;i++) N(t+i*.08,.14,.08+i*.05,50+i*40,350+i*150); N(t,1.0,.20,35,280); OS("sine",20,42,t+.1,1.2,.65); [[110,1.0],[130.8,1.15],[164.8,1.3]].forEach(([f,d])=>O("sawtooth",f,t+d,2.0,.45)); N(t+.95,.1,.75,120,1800); },
    vamp_count(t)    { N(t,.05,.90,150,2500); O("sine",32,t,.3,.8); [[110],[130.8],[164.8]].forEach(([f])=>{O("sine",f*.5,t+.06,3.0,.40);O("sawtooth",f,t+.06,2.8,.48);}); O("sine",27.5,t+.04,3.5,.65); O("sine",55,t+.04,3.2,.35); },
    holy_aria(t)     { [[261.6,0],[392,.04],[523,.09],[784,.16]].forEach(([f,d])=>O("sine",f,t+d,1.5,.18)); BELL(1046.5,t,1.4,.42); [[329.6,.2],[392,.38],[493.9,.58],[659.3,.78]].forEach(([f,d])=>O("sine",f,t+d,1.2,.13)); [[2093,.15],[2637,.3],[3136,.45]].forEach(([f,d])=>O("sine",f,t+d,.8,.07)); N(t+.05,1.4,.04,6000,18000); },
    holy_bell(t)     { BELL(392,t,1.8,.55); O("sine",98,t,1.2,.35); O("sine",49,t,1.0,.20); N(t+.05,1.4,.03,5000,16000); },
    holy_crystal(t)  { [[784,0,.35],[1047,.08,.28],[1319,.16,.22],[1568,.24,.17],[1976,.32,.12],[2637,.4,.08]].forEach(([f,d,g])=>O("sine",f,t+d,1.2,g)); O("sine",261.6,t,1.0,.08); N(t+.05,1.3,.05,4000,20000); },
    death_warrior(t) { BELL(196,t,2.2,.70); O("sine",98,t,1.5,.35); O("sine",49,t,1.2,.20); N(t+.02,.6,.06,150,800); },
    death_spirit(t)  { [[261.6,0,.30],[329.6,.15,.28],[392,.28,.24],[523,.40,.20],[659,.52,.16],[784,.64,.12]].forEach(([f,d,g])=>O("sine",f,t+d,.7-d*.2,g)); OS("sine",110,55,t,.9,.18); },
    death_dragon(t)  { O("sine",28,t,1.5,.95); O("sine",42,t,1.3,.70); N(t,.15,.70,60,800); BELL(98,t+.10,1.8,.65); BELL(130.8,t+.20,1.4,.45); BELL(164.8,t+.35,1.2,.35); [[196,.6,.25],[261.6,.9,.18],[329.6,1.2,.12]].forEach(([f,d,g])=>BELL(f,t+d,.8,g)); },
    death_small(t)   { BELL(1047,t,.6,.30); BELL(1319,t+.08,.5,.22); BELL(784,t+.04,.7,.20); O("sine",392,t,.4,.12); },
    land_crack(t)    { O("sine",32,t,.9,.85); O("sine",48,t,.7,.60); N(t,.06,.70,80,800); for(let i=0;i<5;i++) N(t+.08+i*.07,.02,.30-i*.04,600+i*200,3000+i*400); },
    art_gears(t)     { OS("sawtooth",200,40,t,.5,.20); N(t,.035,.55,800,6000); [[.04,320],[.09,410],[.14,280],[.21,350],[.30,190]].forEach(([d,f])=>BELL(f,t+d,.35,.22)); },
    art_shatter(t)   { N(t,.04,.70,500,5000); [[320,0],[480,.02],[780,.04]].forEach(([f,d])=>BELL(f,t+d,.6,.40)); for(let i=0;i<8;i++) BELL(200+Math.random()*400,t+i*.045,.3,.12); },
    ench_unravel(t)  { [[880,0,.22],[1047,.08,.18],[1319,.16,.14],[1568,.24,.10],[2093,.32,.07]].forEach(([f,d,g])=>OS("sine",f,f*.7,t+d,.7,g)); for(let i=0;i<10;i++) O("sine",800+Math.random()*1200,t+i*.06,.04,.08); },
    ench_glamour(t)  { [[2637,0,.12],[1976,.1,.10],[1319,.2,.09],[784,.35,.08],[523,.55,.07],[330,.8,.06]].forEach(([f,d,g])=>O("sine",f,t+d,.9-d*.3,g)); OS("sine",220,110,t+.2,.8,.08); N(t,.9,.05,3000,16000); },
    fun_processional(t){ [0,.75,1.5].forEach(d=>{BELL(196,t+d,1.8,.55);BELL(246.9,t+d+.04,1.6,.30);}); VIB(110,t+.4,3.0,.30,4.0,2.5); VIB(164.8,t+.5,3.0,.22,4.2,2.0); VIB(82.4,t+.3,3.2,.26,3.8,3.0); },
    fun_requiem(t)   { BELL(98,t,3.2,.80); BELL(123.5,t+.08,2.8,.55); O("sine",49,t,4.0,.60); O("sine",36.7,t,4.0,.40); [[110,.4,.38],[130.8,.58,.34],[164.8,.76,.30]].forEach(([f,d,g])=>{VIB(f,t+d,3.2,g,4.0,2.5);O("sawtooth",f,t+d,3.0,.15);}); VIB(523,t+1.1,1.6,.09,5.0,4.5); VIB(659,t+1.3,1.6,.07,5.0,4.5); N(t+.3,3.2,.09,35,280); },
  };

  const playCatalogById = (soundId) => {
    if (muted) return;
    const a = ac(); if (!a) return;
    const fn = catalogSounds[soundId];
    if (fn) try { fn(a.currentTime); } catch(e) { console.warn('catalog sound error', soundId, e); }
  };

  const play = (action) => {
    if (muted) return;
    const a = ac(); if (!a) return;
    const t = a.currentTime;

    // User URL takes priority
    const url = userUrls[action];
    if (url && bufCache[url]) {
      try {
        const src = a.createBufferSource();
        src.buffer = bufCache[url];
        const g = a.createGain(); g.gain.value = volume;
        src.connect(g); g.connect(a.destination);
        src.start(t); return;
      } catch {}
    }

    const variant = prefs[action] || "natural";
    const def = sounds[action];
    if (!def) return;
    try { (def[variant] || def.natural)(t); } catch {}
  };

  const audition = (action, variant) => {
    ac(); if (!ctx) return;
    const def = sounds[action];
    if (!def) return;
    try { (def[variant] || def.natural)(ctx.currentTime); } catch(e){console.warn("audition err",e);}
  };

  // Play any built-in sound variant by name (for preview)
  const auditionDirect = (soundKey, variant="natural") => {
    ac(); if (!ctx) return;
    const def = sounds[soundKey];
    if (!def) return;
    try { (def[variant] || def.natural)(ctx.currentTime); } catch(e){console.warn("auditionDirect",e);}
  };

  const auditionUrl = async (url) => {
    const a = ac(); if (!a) return false;
    try {
      if (!bufCache[url]) {
        const res = await fetch(url);
        if (!res.ok) return false;
        const arr = await res.arrayBuffer();
        bufCache[url] = await a.decodeAudioData(arr);
      }
      const src = a.createBufferSource();
      src.buffer = bufCache[url];
      const g = a.createGain(); g.gain.value = volume;
      src.connect(g); g.connect(a.destination);
      src.start();
      return true;
    } catch { return false; }
  };

  const savePrefs = () => {
    try {
      localStorage.setItem("mtg_sfx_prefs_v2", JSON.stringify(prefs));
      localStorage.setItem("mtg_sfx_urls", JSON.stringify(userUrls));
      localStorage.setItem("mtg_sfx_vol", String(volume));
    } catch {}
  };

  // ── Custom sound library ──────────────────────────────────────────
  // Each entry: {id, name, params:{...synthParams}, assignedTo:[action,...]}
  let customLib = [];
  try { customLib = JSON.parse(localStorage.getItem("mtg_sfx_custom_lib") || "[]"); } catch {}

  const saveCustomLib = () => {
    try { localStorage.setItem("mtg_sfx_custom_lib", JSON.stringify(customLib)); } catch {}
  };

  // Play a custom sound by id
  const playCustomById = (id) => {
    if (muted) return;
    const s = customLib.find(x=>x.id===id);
    if (!s) return;
    // Catalog sounds — play via the closure-scoped catalogSounds
    if (s.params && s.params.catalogId) {
      playCatalogById(s.params.catalogId);
      return;
    }
    // User-created layered sounds
    const a = ac(); if (!a) return;
    try { synthFromParams(s.params, a.currentTime); } catch {}
  };

  // Synth engine — renders params object to Web Audio
  const synthFromParams = (p, t) => {
    const a = ac(); if (!a || muted) return;
    const out = a.createGain(); out.gain.value = volume; out.connect(a.destination);
    const N2 = (dt,dur,g,hp,lp) => {
      try {
        const buf=a.createBuffer(1,Math.ceil(a.sampleRate*dur),a.sampleRate);
        const d=buf.getChannelData(0); for(let i=0;i<d.length;i++) d[i]=Math.random()*2-1;
        const src=a.createBufferSource();
        const fh=a.createBiquadFilter(); fh.type='highpass'; fh.frequency.value=hp;
        const fl=a.createBiquadFilter(); fl.type='lowpass'; fl.frequency.value=lp;
        const gn=a.createGain(); gn.gain.setValueAtTime(g,t+dt); gn.gain.exponentialRampToValueAtTime(.0001,t+dt+dur);
        src.buffer=buf; src.connect(fh); fh.connect(fl); fl.connect(gn); gn.connect(out);
        src.start(t+dt); src.stop(t+dt+dur+.05);
      } catch {}
    };
    const O2 = (dt,type,freq,dur,g,det=0) => {
      try {
        const o=a.createOscillator(),gn=a.createGain();
        o.type=type; o.frequency.value=freq; if(det) o.detune.value=det;
        gn.gain.setValueAtTime(0,t+dt); gn.gain.linearRampToValueAtTime(g,t+dt+Math.min(.05,dur*.2));
        gn.gain.exponentialRampToValueAtTime(.0001,t+dt+dur);
        o.connect(gn); gn.connect(out); o.start(t+dt); o.stop(t+dt+dur+.05);
      } catch {}
    };
    const BELL2 = (dt,freq,dur,g) => {
      [[1,.9],[2.756,.4],[5.404,.18],[8.933,.08]].forEach(([r,rel])=>O2(dt,'sine',freq*r,dur*(.3+rel*.7),g*rel));
    };
    // Parse and play layers
    (p.layers||[]).forEach(layer => {
      try {
        if (layer.type==='noise')    N2(layer.dt||0, layer.dur||.1, layer.gain||.3, layer.hp||800, layer.lp||8000);
        else if (layer.type==='bell') BELL2(layer.dt||0, layer.freq||440, layer.dur||1.0, layer.gain||.4);
        else O2(layer.dt||0, layer.type||'sine', layer.freq||440, layer.dur||.3, layer.gain||.3, layer.det||0);
      } catch {}
    });
  };

  return {
    play, audition, auditionUrl, auditionDirect,
    playCatalogById,
    mute()   { muted=true; },
    unmute() { muted=false; },
    isMuted(){ return muted; },
    setVolume(v){ volume=Math.max(0,Math.min(1,v)); savePrefs(); },
    getVolume(){ return volume; },
    setPref(action,variant){ prefs[action]=variant; savePrefs(); },
    setUrl(action,url){ if(url) userUrls[action]=url; else delete userUrls[action]; savePrefs(); },
    getUrl(action){ return userUrls[action]||""; },
    getPrefs(){ return {...prefs}; },
    _ctx(){ return ac(); }, // exposed for catalog sound functions
    init(){ ac(); }, // unlock AudioContext on first user gesture

    // Custom library API
    getCustomLib(){ return [...customLib]; },
    saveCustomSound(sound){ // {id,name,params,assignedTo}
      const idx=customLib.findIndex(x=>x.id===sound.id);
      if(idx>=0) customLib[idx]=sound; else customLib.push(sound);
      saveCustomLib();
    },
    deleteCustomSound(id){
      customLib=customLib.filter(x=>x.id!==id);
      // Clear any prefs pointing to this custom id
      Object.keys(prefs).forEach(a=>{ if(prefs[a]===`custom:${id}`) delete prefs[a]; });
      Object.keys(userUrls).forEach(a=>{ if(userUrls[a]===`custom:${id}`) delete userUrls[a]; });
      saveCustomLib(); savePrefs();
    },
    setCustomForAction(action, customId){
      // Store as special "custom:id" marker in prefs
      prefs[action] = `custom:${customId}`; savePrefs();
    },
    clearCustomForAction(action){
      delete prefs[action]; savePrefs();
    },
    playCustomById,
    synthFromParams,
    // Override play to check custom assignments
    playAction(action){
      if(muted) return;
      const pref = prefs[action]||'natural';
      if(pref.startsWith('custom:')){
        const id = pref.slice(7);
        playCustomById(id);
        return;
      }
      play(action);
    },
  };
})();

/* ─── Sound Studio ─────────────────────────────────────────────────── */

function getSoundCatalog(){
  const C=(id,label,action)=>({id,label,action,variants:{natural:()=>SFX.playCatalogById(id)}});
  return [
    { cat:"Card handling", sounds:[
      C("rustle_whisper","Whisper glide",   "hover"),
      C("rustle_sweep",  "Finger sweep",    "hover"),
      C("rustle_stiff",  "Stiff card snap", "hover"),
      C("rustle_linen",  "Linen card drag", "hover"),
      C("rustle_fan",    "Fan & settle",    "draw"),
    ]},
    { cat:"Vampire rising", sounds:[
      C("vamp_coffin","The coffin opens","reanimate"),
      C("vamp_blood", "Blood calls",     "reanimate"),
      C("vamp_earth", "From the earth",  "reanimate"),
      C("vamp_count", "The count speaks","reanimate"),
    ]},
    { cat:"Holy & exile", sounds:[
      C("holy_aria",   "Choir aria",     "toExile"),
      C("holy_bell",   "Cathedral bell", "toExile"),
      C("holy_crystal","Crystal shimmer","toExile"),
    ]},
    { cat:"Creature death", sounds:[
      C("death_warrior","Fallen warrior", "toGraveyard"),
      C("death_spirit", "Spirit departs", "toGraveyard"),
      C("death_dragon", "Ancient dragon", "toGraveyard"),
      C("death_small",  "Small creature", "toGraveyard"),
    ]},
    { cat:"Land death", sounds:[
      C("land_crack","Earth crack","toGraveyard"),
    ]},
    { cat:"Artifact death", sounds:[
      C("art_gears",  "Gear collapse",  "toGraveyard"),
      C("art_shatter","Iron shattering","toGraveyard"),
    ]},
    { cat:"Enchantment death", sounds:[
      C("ench_unravel","Spell unravels","toGraveyard"),
      C("ench_glamour","Fading glamour","toGraveyard"),
    ]},
    { cat:"Funerary", sounds:[
      C("fun_processional","Processional","toGraveyard"),
      C("fun_requiem",     "Requiem",     "toGraveyard"),
    ]},
  ];
}

function SoundSettings({onClose}){
  const SOUND_CATALOG=getSoundCatalog();
  const [selectedAction,setSelectedAction]=useState(null);  // which action is being assigned
  const [prefs,setPrefs]=useState(SFX.getPrefs());
  const [vol,setVol]=useState(SFX.getVolume());
  const [playing,setPlaying]=useState(null);
  const [customLib,setCustomLib]=useState(()=>SFX.getCustomLib());
  const [tab,setTab]=useState("assign"); // "assign"|"create"
  // Create tab
  const [draftName,setDraftName]=useState("My Sound");
  const [editingId,setEditingId]=useState(null);
  const [layers,setLayers]=useState([{id:uid(),type:"sine",freq:440,dt:0,dur:.3,gain:.35,det:0,hp:800,lp:8000}]);
  const [testPlaying,setTestPlaying]=useState(false);

  const WAVE_TYPES=["sine","triangle","sawtooth","square","noise","bell"];

  // ── helpers ──
  const playPreview=(sound,t)=>{
    try{ sound.variants.natural(t); }catch{}
  };
  const auditCatalog=(sound)=>{
    SFX.init();
    const k=sound.id; setPlaying(k);
    try{ sound.variants.natural(); }catch(e){ console.warn('catalog preview error:',e,sound.id); }
    setTimeout(()=>setPlaying(p=>p===k?null:p),2500);
  };
  const assignCatalogSound=(action,sound)=>{
    // Save as a named custom sound then assign
    const id="cat_"+sound.id;
    SFX.saveCustomSound({id,name:sound.label,params:{catalogId:sound.id},assignedTo:[]});
    SFX.setCustomForAction(action,id);
    setPrefs(SFX.getPrefs());
    setSelectedAction(null);
  };
  const assignBuiltin=(action,variant)=>{
    SFX.setPref(action,variant);
    setPrefs(p=>({...p,[action]:variant}));
    setSelectedAction(null);
  };
  const assignCustom=(action,customId)=>{
    SFX.setCustomForAction(action,customId);
    setPrefs(SFX.getPrefs());
    setSelectedAction(null);
  };
  const clearAction=(action)=>{
    SFX.clearCustomForAction(action);
    SFX.setPref(action,"natural");
    setPrefs(p=>({...p,[action]:"natural"}));
  };
  const getCurrentLabel=(action)=>{
    const p=prefs[action]||"natural";
    if(p.startsWith("custom:")){
      const id=p.slice(7);
      const cs=customLib.find(x=>x.id===id);
      if(cs) return{text:cs.name,color:"#d8b4fe"};
      const cat=getSoundCatalog().flatMap(c=>c.sounds).find(s=>"cat_"+s.id===id||s.id===id);
      if(cat) return{text:cat.label,color:"#d8b4fe"};
      return{text:"Custom",color:"#d8b4fe"};
    }
    return{text:p.charAt(0).toUpperCase()+p.slice(1),color:T.accent};
  };
  // Create tab
  const addLayer=()=>setLayers(l=>[...l,{id:uid(),type:"sine",freq:440,dt:0,dur:.3,gain:.3,det:0,hp:800,lp:8000}]);
  const removeLayer=(id)=>setLayers(l=>l.filter(x=>x.id!==id));
  const updateLayer=(id,k,v)=>setLayers(l=>l.map(x=>x.id===id?{...x,[k]:v}:x));
  const testSound=()=>{setTestPlaying(true);try{SFX.synthFromParams({layers});}catch{}setTimeout(()=>setTestPlaying(false),800);};
  const saveSound=()=>{
    if(!draftName.trim())return;
    const id=editingId||uid();
    SFX.saveCustomSound({id,name:draftName.trim(),params:{layers},assignedTo:[]});
    setCustomLib(SFX.getCustomLib());setEditingId(id);
  };
  const deleteCustom=(id)=>{SFX.deleteCustomSound(id);setCustomLib(SFX.getCustomLib());setPrefs(SFX.getPrefs());};
  const loadEdit=(cs)=>{setDraftName(cs.name);setEditingId(cs.id);setLayers((cs.params.layers||[]).map(l=>({...l,id:l.id||uid()})));setTab("create");};

  const TB=(id,lbl)=><button onClick={()=>setTab(id)} style={{padding:"6px 15px",fontSize:11,cursor:"pointer",fontFamily:"Cinzel,serif",border:"none",borderRadius:5,background:tab===id?`${T.accent}20`:"transparent",color:tab===id?T.accent:"#4a6a8a",borderBottom:tab===id?`2px solid ${T.accent}`:"2px solid transparent"}} onMouseOver={hov} onMouseOut={uhov}>{lbl}</button>;

  return(
    <div className="fade-in" style={{position:"fixed",inset:0,background:"rgba(2,4,10,.97)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:25001,backdropFilter:"blur(8px)"}}>
      <div className="slide-in" style={{background:`linear-gradient(160deg,${T.panel},${T.bg})`,border:`1px solid ${T.accent}40`,borderRadius:12,width:740,maxHeight:"92vh",display:"flex",flexDirection:"column",boxShadow:"0 24px 80px rgba(0,0,0,.98)",position:"relative",overflow:"hidden"}}>
        <div style={{position:"absolute",top:0,left:0,right:0,height:2,background:"linear-gradient(90deg,transparent,#c8a870,transparent)"}}/>
        {/* Header */}
        <div style={{padding:"13px 20px 0",borderBottom:`1px solid ${T.accent}18`,flexShrink:0}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
            <div style={{color:T.accent,fontFamily:"Cinzel Decorative,serif",fontSize:13}}>🔊 Sound Studio</div>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <span style={{fontSize:9,color:"#4a6a8a"}}>Vol</span>
              <input type="range" min={0} max={1} step={.05} value={vol} onChange={e=>{const v=+e.target.value;setVol(v);SFX.setVolume(v);}} style={{width:80,accentColor:T.accent,cursor:"pointer"}}/>
              <span style={{fontSize:10,color:T.accent,minWidth:28}}>{Math.round(vol*100)}%</span>
              <button onClick={onClose} style={{...btn("transparent","#6a7a8a",{fontSize:16,border:"none"})}} onMouseOver={hov} onMouseOut={uhov}>✕</button>
            </div>
          </div>
          <div style={{display:"flex",gap:2}}>{TB("assign","⚙ Assign")}{TB("library","📚 Sound Library")}{TB("create",`✦ Create${customLib.length?` (${customLib.length})`:""}`)}
          </div>
        </div>

        <div style={{flex:1,overflowY:"auto",padding:"12px 18px 18px"}}>

        {/* ── ASSIGN TAB ── */}
        {tab==="assign"&&!selectedAction&&(
          <div>
            <div style={{fontSize:9,color:"#4a6a8a",fontFamily:"Cinzel,serif",marginBottom:10}}>Click an action to choose its sound from the library</div>
            {Object.entries(SOUND_PACKS).map(([action,{label}])=>{
              const info=getCurrentLabel(action);
              return(
                <div key={action} onClick={()=>setSelectedAction(action)}
                  style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"9px 13px",marginBottom:6,
                    background:`${T.bg}80`,borderRadius:7,border:`1px solid ${T.border}18`,cursor:"pointer",transition:"border-color .1s"}}
                  onMouseOver={e=>e.currentTarget.style.borderColor=T.accent+"40"}
                  onMouseOut={e=>e.currentTarget.style.borderColor=T.border+"18"}>
                  <div style={{fontSize:11,color:T.text,fontFamily:"Crimson Text,serif"}}>{label}</div>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <span style={{fontSize:10,color:info.color,fontFamily:"Cinzel,serif"}}>{info.text}</span>
                    <button onClick={e=>{e.stopPropagation();SFX.playAction(action);}} style={{...btn(`${T.accent}15`,T.accent,{border:`1px solid ${T.accent}30`,fontSize:10,padding:"3px 8px"})}} onMouseOver={hov} onMouseOut={uhov}>▶</button>
                    <span style={{fontSize:11,color:"#4a6a8a"}}>›</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── SOUND PICKER (when action selected) ── */}
        {tab==="assign"&&selectedAction&&(
          <div>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
              <button onClick={()=>setSelectedAction(null)} style={{...btn(`${T.panel}99`,"#8a99b0",{border:`1px solid ${T.border}`,fontSize:11,padding:"4px 10px"})}} onMouseOver={hov} onMouseOut={uhov}>← Back</button>
              <div style={{color:T.accent,fontFamily:"Cinzel,serif",fontSize:12}}>{SOUND_PACKS[selectedAction]?.label}</div>
              <div style={{flex:1}}/>
              <button onClick={()=>{clearAction(selectedAction);setSelectedAction(null);}} style={{...btn("transparent","#4a6a8a",{border:`1px solid ${T.border}20`,fontSize:9,padding:"3px 9px"})}} onMouseOver={hov} onMouseOut={uhov}>Reset to default</button>
            </div>

            {/* Built-in variants */}
            <div style={{fontSize:8,color:"#4a6a8a",fontFamily:"Cinzel,serif",marginBottom:6,letterSpacing:".1em"}}>BUILT-IN STYLES</div>
            <div style={{display:"flex",gap:6,marginBottom:14}}>
              {["natural","arcade","minimal"].map(v=>{
                const isSel=(prefs[selectedAction]||"natural")===v&&!String(prefs[selectedAction]).startsWith("custom:");
                return(
                  <div key={v} onClick={()=>assignBuiltin(selectedAction,v)}
                    style={{flex:1,display:"flex",alignItems:"center",gap:6,padding:"9px 11px",borderRadius:6,cursor:"pointer",
                      background:isSel?`${T.accent}18`:`${T.panel}88`,border:`1px solid ${isSel?T.accent:T.border+"20"}`,transition:"all .1s"}}>
                    <button onClick={e=>{e.stopPropagation();SFX.auditionDirect(selectedAction,v);}} style={{width:18,height:18,borderRadius:"50%",border:"none",cursor:"pointer",background:`${T.accent}25`,color:T.accent,fontSize:8,display:"flex",alignItems:"center",justifyContent:"center"}} onMouseOver={hov} onMouseOut={uhov}>▶</button>
                    <span style={{fontSize:10,color:isSel?T.accent:"#8090a0",fontFamily:"Cinzel,serif"}}>{v.charAt(0).toUpperCase()+v.slice(1)}</span>
                    {isSel&&<span style={{fontSize:9,color:T.accent,marginLeft:"auto"}}>✓</span>}
                  </div>
                );
              })}
            </div>

            {/* Catalog sounds */}
            <div style={{fontSize:8,color:"#4a6a8a",fontFamily:"Cinzel,serif",marginBottom:6,letterSpacing:".1em"}}>SOUND LIBRARY</div>
            {getSoundCatalog().map(cat=>(
              <div key={cat.cat}>
                <div style={{fontSize:8,color:"#3a5a7a",fontFamily:"Cinzel,serif",marginBottom:4,marginTop:8,letterSpacing:".08em"}}>{cat.cat.toUpperCase()}</div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))",gap:5,marginBottom:6}}>
                  {cat.sounds.map(sound=>{
                    const isSel=prefs[selectedAction]===`custom:cat_${sound.id}`;
                    return(
                      <div key={sound.id} onClick={()=>assignCatalogSound(selectedAction,sound)}
                        style={{display:"flex",alignItems:"center",gap:6,padding:"7px 10px",borderRadius:6,cursor:"pointer",
                          background:isSel?"rgba(168,85,247,.18)":`${T.panel}88`,
                          border:`1px solid ${isSel?"rgba(168,85,247,.5)":T.border+"18"}`,transition:"all .1s"}}
                        onMouseOver={e=>e.currentTarget.style.borderColor=isSel?"rgba(168,85,247,.5)":T.accent+"30"}
                        onMouseOut={e=>e.currentTarget.style.borderColor=isSel?"rgba(168,85,247,.5)":T.border+"18"}>
                        <button onClick={e=>{e.stopPropagation();auditCatalog(sound);}} style={{width:18,height:18,borderRadius:"50%",border:"none",cursor:"pointer",background:playing===sound.id?"rgba(168,85,247,.5)":"rgba(168,85,247,.2)",color:"#d8b4fe",fontSize:8,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}} onMouseOver={hov} onMouseOut={uhov}>{playing===sound.id?"♪":"▶"}</button>
                        <span style={{fontSize:10,color:isSel?"#d8b4fe":T.text,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{sound.label}</span>
                        {isSel&&<span style={{fontSize:9,color:"#d8b4fe"}}>✓</span>}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}

            {/* User custom sounds */}
            {customLib.filter(cs=>!cs.id.startsWith("cat_")).length>0&&(
              <div style={{marginTop:8}}>
                <div style={{fontSize:8,color:"#4a6a8a",fontFamily:"Cinzel,serif",marginBottom:6,letterSpacing:".1em"}}>YOUR CUSTOM SOUNDS</div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))",gap:5}}>
                  {customLib.filter(cs=>!cs.id.startsWith("cat_")).map(cs=>{
                    const isSel=prefs[selectedAction]===`custom:${cs.id}`;
                    return(
                      <div key={cs.id} onClick={()=>assignCustom(selectedAction,cs.id)}
                        style={{display:"flex",alignItems:"center",gap:6,padding:"7px 10px",borderRadius:6,cursor:"pointer",
                          background:isSel?`${T.accent}18`:`${T.panel}88`,border:`1px solid ${isSel?T.accent:T.border+"18"}`,transition:"all .1s"}}>
                        <button onClick={e=>{e.stopPropagation();SFX.playCustomById(cs.id);}} style={{width:18,height:18,borderRadius:"50%",border:"none",cursor:"pointer",background:`${T.accent}25`,color:T.accent,fontSize:8,display:"flex",alignItems:"center",justifyContent:"center"}} onMouseOver={hov} onMouseOut={uhov}>▶</button>
                        <span style={{fontSize:10,color:isSel?T.accent:T.text,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>✦ {cs.name}</span>
                        {isSel&&<span style={{fontSize:9,color:T.accent}}>✓</span>}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── SOUND LIBRARY BROWSE TAB ── */}
        {tab==="library"&&(
          <div>
            <div style={{fontSize:9,color:"#4a6a8a",fontFamily:"Cinzel,serif",marginBottom:10}}>Browse and preview all sounds — click ▶ to hear, or go to Assign to wire them to actions</div>
            {getSoundCatalog().map(cat=>(
              <div key={cat.cat}>
                <div style={{fontSize:9,color:"#3a5a7a",fontFamily:"Cinzel,serif",margin:"12px 0 6px",letterSpacing:".1em"}}>{cat.cat.toUpperCase()}</div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(190px,1fr))",gap:6}}>
                  {cat.sounds.map(sound=>(
                    <div key={sound.id} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 11px",background:`${T.bg}80`,borderRadius:7,border:`.5px solid ${T.border}18`}}>
                      <button onClick={()=>auditCatalog(sound)} style={{width:22,height:22,borderRadius:"50%",border:"none",cursor:"pointer",background:playing===sound.id?"rgba(168,85,247,.6)":"rgba(168,85,247,.18)",color:"#d8b4fe",fontSize:9,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,transition:"background .1s"}} onMouseOver={hov} onMouseOut={uhov}>{playing===sound.id?"♪":"▶"}</button>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:11,color:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{sound.label}</div>
                        <div style={{fontSize:8,color:"#4a6a8a",fontFamily:"Cinzel,serif"}}>default: {SOUND_PACKS[sound.action]?.label.replace(/[^\w\s]/gu,"").trim()||sound.action}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── CREATE TAB ── */}
        {tab==="create"&&(
          <div>
            <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:10}}>
              <input value={draftName} onChange={e=>setDraftName(e.target.value)} placeholder="Sound name…" style={{...iS,flex:1,marginTop:0,fontSize:12,fontFamily:"Cinzel,serif",color:T.accent}}/>
              <button onClick={testSound} style={{...btn(testPlaying?`${T.accent}25`:`${T.panel}99`,testPlaying?T.accent:"#8a99b0",{border:`1px solid ${testPlaying?T.accent:T.border}`,fontSize:11,padding:"6px 12px"})}} onMouseOver={hov} onMouseOut={uhov}>{testPlaying?"♪ …":"▶ Test"}</button>
              <button onClick={saveSound} style={{...btn(`${T.accent}18`,T.accent,{border:`1px solid ${T.accent}50`,fontSize:11,padding:"6px 14px",fontFamily:"Cinzel,serif"})}} onMouseOver={hov} onMouseOut={uhov}>{editingId?"Update":"Save"}</button>
              {editingId&&<button onClick={()=>{setEditingId(null);setDraftName("My Sound");setLayers([{id:uid(),type:"sine",freq:440,dt:0,dur:.3,gain:.35,det:0,hp:800,lp:8000}]);}} style={{...btn("transparent","#4a6a8a",{border:`1px solid ${T.border}20`,fontSize:11,padding:"6px 10px"})}} onMouseOver={hov} onMouseOut={uhov}>+ New</button>}
            </div>

            {/* Presets */}
            <div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:10}}>
              {[{n:"Bell",l:[{id:uid(),type:"bell",freq:440,dt:0,dur:1.2,gain:.45,det:0,hp:800,lp:8000}]},
                {n:"Spooky",l:[{id:uid(),type:"sawtooth",freq:110,dt:0,dur:1.5,gain:.35,det:-8,hp:800,lp:8000},{id:uid(),type:"sawtooth",freq:130.8,dt:.1,dur:1.5,gain:.28,det:9,hp:800,lp:8000},{id:uid(),type:"sine",freq:55,dt:.05,dur:2.0,gain:.3,det:0,hp:800,lp:8000}]},
                {n:"Rustle",l:[{id:uid(),type:"noise",freq:440,dt:0,dur:.06,gain:.4,det:0,hp:1400,lp:7000},{id:uid(),type:"noise",freq:440,dt:.01,dur:.04,gain:.25,det:0,hp:3000,lp:14000}]},
                {n:"Holy",l:[{id:uid(),type:"sine",freq:1046.5,dt:0,dur:1.4,gain:.42,det:0,hp:800,lp:8000},{id:uid(),type:"sine",freq:784,dt:.08,dur:1.2,gain:.18,det:0,hp:800,lp:8000},{id:uid(),type:"sine",freq:523,dt:0,dur:1.0,gain:.14,det:0,hp:800,lp:8000}]},
                {n:"Thud",l:[{id:uid(),type:"sine",freq:55,dt:0,dur:.4,gain:.7,det:0,hp:800,lp:8000},{id:uid(),type:"noise",freq:440,dt:0,dur:.06,gain:.55,det:0,hp:150,lp:2000}]},
                {n:"Fart",l:[{id:uid(),type:"sawtooth",freq:80,dt:0,dur:.35,gain:.6,det:15,hp:200,lp:900},{id:uid(),type:"sawtooth",freq:85,dt:.02,dur:.3,gain:.4,det:-20,hp:150,lp:700}]},
                {n:"Airhorn",l:[{id:uid(),type:"sawtooth",freq:233,dt:0,dur:.8,gain:.55,det:0,hp:800,lp:8000},{id:uid(),type:"sawtooth",freq:311,dt:0,dur:.8,gain:.45,det:5,hp:800,lp:8000}]},
                {n:"Explosion",l:[{id:uid(),type:"noise",freq:440,dt:0,dur:.5,gain:.7,det:0,hp:40,lp:800},{id:uid(),type:"sine",freq:32,dt:0,dur:.8,gain:.8,det:0,hp:800,lp:8000}]},
              ].map(p=>(
                <button key={p.n} onClick={()=>{setLayers(p.l.map(l=>({...l,id:uid()})));setTimeout(testSound,50);}}
                  style={{...btn(`${T.panel}88`,"#8a99b0",{border:`1px solid ${T.border}20`,fontSize:9,padding:"3px 10px",fontFamily:"Cinzel,serif"})}}
                  onMouseOver={hov} onMouseOut={uhov}>{p.n}</button>
              ))}
            </div>

            <div style={{fontSize:8,color:"#4a6a8a",fontFamily:"Cinzel,serif",marginBottom:6,letterSpacing:".08em"}}>LAYERS — stack oscillators & noise to build your sound</div>
            {layers.map(layer=>(
              <div key={layer.id} style={{marginBottom:5,padding:"9px 10px",background:`${T.bg}80`,borderRadius:7,border:`1px solid ${T.border}15`,display:"grid",gridTemplateColumns:"86px 1fr 1fr 1fr 1fr auto",gap:6,alignItems:"center"}}>
                <select value={layer.type} onChange={e=>updateLayer(layer.id,"type",e.target.value)}
                  style={{background:T.bg,color:T.accent,border:`1px solid ${T.border}`,borderRadius:4,fontSize:9,padding:"3px 4px",fontFamily:"Cinzel,serif",cursor:"pointer"}}>
                  {WAVE_TYPES.map(w=><option key={w} value={w}>{w}</option>)}
                </select>
                {layer.type==="noise"?(
                  <div style={{display:"flex",flexDirection:"column",gap:1}}>
                    <span style={{fontSize:7,color:"#4a6a8a"}}>HP {Math.round(layer.hp||800)}Hz</span>
                    <input type="range" min={20} max={8000} step={10} value={layer.hp||800} onChange={e=>updateLayer(layer.id,"hp",+e.target.value)} style={{accentColor:"#60a5fa",cursor:"pointer"}}/>
                  </div>
                ):(
                  <div style={{display:"flex",flexDirection:"column",gap:1}}>
                    <span style={{fontSize:7,color:"#4a6a8a"}}>freq {Math.round(layer.freq)}Hz</span>
                    <input type="range" min={20} max={4000} step={1} value={layer.freq} onChange={e=>updateLayer(layer.id,"freq",+e.target.value)} style={{accentColor:T.accent,cursor:"pointer"}}/>
                  </div>
                )}
                <div style={{display:"flex",flexDirection:"column",gap:1}}>
                  <span style={{fontSize:7,color:"#4a6a8a"}}>dur {layer.dur.toFixed(2)}s</span>
                  <input type="range" min={.01} max={3} step={.01} value={layer.dur} onChange={e=>updateLayer(layer.id,"dur",+e.target.value)} style={{accentColor:T.accent,cursor:"pointer"}}/>
                </div>
                <div style={{display:"flex",flexDirection:"column",gap:1}}>
                  <span style={{fontSize:7,color:"#4a6a8a"}}>vol {Math.round(layer.gain*100)}%</span>
                  <input type="range" min={0} max={1} step={.01} value={layer.gain} onChange={e=>updateLayer(layer.id,"gain",+e.target.value)} style={{accentColor:T.accent,cursor:"pointer"}}/>
                </div>
                <div style={{display:"flex",flexDirection:"column",gap:1}}>
                  <span style={{fontSize:7,color:"#4a6a8a"}}>delay {layer.dt.toFixed(2)}s</span>
                  <input type="range" min={0} max={2} step={.01} value={layer.dt} onChange={e=>updateLayer(layer.id,"dt",+e.target.value)} style={{accentColor:"#4ade80",cursor:"pointer"}}/>
                </div>
                <button onClick={()=>removeLayer(layer.id)} style={{...btn("rgba(248,113,113,.1)","#f87171",{border:"1px solid rgba(248,113,113,.2)",fontSize:11,padding:"3px 7px"})}} onMouseOver={hov} onMouseOut={uhov}>✕</button>
              </div>
            ))}
            <button onClick={addLayer} style={{...btn(`${T.panel}99`,"#8a99b0",{border:`1px solid ${T.border}25`,fontSize:10,padding:"6px 16px",width:"100%",marginTop:4,fontFamily:"Cinzel,serif"})}} onMouseOver={hov} onMouseOut={uhov}>+ Add Layer</button>

            {/* Saved custom sounds */}
            {customLib.filter(cs=>!cs.id.startsWith("cat_")).length>0&&(
              <div style={{marginTop:14}}>
                <div style={{fontSize:8,color:"#4a6a8a",fontFamily:"Cinzel,serif",marginBottom:6,letterSpacing:".08em"}}>SAVED SOUNDS</div>
                {customLib.filter(cs=>!cs.id.startsWith("cat_")).map(cs=>(
                  <div key={cs.id} style={{display:"flex",alignItems:"center",gap:7,padding:"7px 10px",marginBottom:5,background:`${T.bg}80`,borderRadius:7,border:`1px solid ${T.border}15`}}>
                    <button onClick={()=>SFX.playCustomById(cs.id)} style={{...btn("rgba(168,85,247,.2)","#d8b4fe",{border:"1px solid rgba(168,85,247,.3)",fontSize:10,padding:"3px 9px"})}} onMouseOver={hov} onMouseOut={uhov}>▶</button>
                    <span style={{flex:1,fontSize:11,color:T.accent,fontFamily:"Cinzel,serif"}}>{cs.name}</span>
                    <span style={{fontSize:8,color:"#4a6a8a"}}>{(cs.params.layers||[]).length} layers</span>
                    <button onClick={()=>loadEdit(cs)} style={{...btn(`${T.panel}99`,"#8a99b0",{border:`1px solid ${T.border}`,fontSize:9,padding:"3px 9px"})}} onMouseOver={hov} onMouseOut={uhov}>Edit</button>
                    <button onClick={()=>deleteCustom(cs.id)} style={{...btn("rgba(248,113,113,.1)","#f87171",{border:"1px solid rgba(248,113,113,.2)",fontSize:9,padding:"3px 9px"})}} onMouseOver={hov} onMouseOut={uhov}>Delete</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        </div>
      </div>
    </div>
  );
}



const CARD_BACK="https://backs.scryfall.io/large/2/2/222b7a3b-2321-4d4c-af19-19338b134971.jpg?1677416389";
const PHASES=["Untap","Upkeep","Draw","Main 1","Combat","Main 2","End"];
const PHASE_CLR=["#7c3aed","#2563eb","#059669","#d97706","#dc2626","#d97706","#6b7280"];
const PHASE_ICONS=["⟳","⬆","🎴","🔮","⚔","🔮","🌙"];
const CW=72,CH=Math.round(72*1.4),LAND_STEP=Math.round(CW*.52),LAND_Y=220;
const HAND_H=160; // fixed hand strip height
const NOOP=()=>{}; // v7.6: stable no-op for readOnly BoardSide mounts

const autoPos=(bf,card)=>{
  if(isLand(card)){
    const l=bf.filter(isLand);
    // Row of 8 lands max, then wrap — anchored to bottom-quarter of BF safely above hand
    const col=l.length%10;
    const row=Math.floor(l.length/10);
    return{x:8+col*LAND_STEP, y:LAND_Y+row*(CH+10)};
  }
  const i=bf.filter(c=>!isLand(c)).length;
  return{x:8+(i%7)*(CW+10),y:8+Math.floor(i/7)*(CH+14)};
};

/* ─── Game modes ──────────────────────────────────────────────────── */
const GAMEMODES = [
  {id:"standard",  label:"Standard",    life:20, icon:"🃏"},
  {id:"commander", label:"Commander",   life:40, icon:"⚔"},
  {id:"modern",    label:"Modern",      life:20, icon:"⚡"},
  {id:"legacy",    label:"Legacy",      life:20, icon:"📜"},
  {id:"pioneer",   label:"Pioneer",     life:20, icon:"🌟"},
  {id:"dandan",    label:"Dandan",      life:20, icon:"🐟", special:true},
];

/* Dandan premade deck — 60 cards, 40 Dandans + 20 Islands */
const DANDAN_DECK = {
  id:"dandan_premade", name:"🐟 Dandan Deck", format:"dandan",
  cards:[
    {scryfallId:"dandan_card",name:"Dandan",quantity:40,
     imageUri:"https://cards.scryfall.io/normal/front/8/c/8c3dcea3-7c1b-4478-8bf4-a46e3b942e45.jpg",
     manaCost:"{1}{U}",typeLine:"Creature — Fish",
     oracleText:"Dandan cant attack unless defending player controls an Island. When there are no Islands on the battlefield, sacrifice Dandan.",
     power:"4",toughness:"1",colors:["U"]},
    {scryfallId:"island_basic",name:"Island",quantity:20,
     imageUri:"https://cards.scryfall.io/normal/front/b/d/bd335f5b-a7a4-4ac7-b8c8-f0b3e1c1e23c.jpg",
     manaCost:"",typeLine:"Basic Land — Island",oracleText:"",power:null,toughness:null,colors:[]},
  ],
};

const GAMEMATS=[
  {name:"Deep Ocean",  url:"https://images.unsplash.com/photo-1518020382113-a7e8fc38eac9?w=1400&q=80", accent:"#3b82f6"},
  {name:"Ancient Forest",url:"https://images.unsplash.com/photo-1448375240586-882707db888b?w=1400&q=80",accent:"#16a34a"},
  {name:"Volcanic",    url:"https://images.unsplash.com/photo-1562016600-ece13e8ba570?w=1400&q=80",accent:"#ef4444"},
  {name:"Arcane Tower",url:"https://images.unsplash.com/photo-1519681393784-d120267933ba?w=1400&q=80",accent:"#a855f7"},
  {name:"Desert Ruins",url:"https://images.unsplash.com/photo-1509316785289-025f5b846b35?w=1400&q=80",accent:"#d97706"},
  {name:"Starfield",   url:"https://images.unsplash.com/photo-1462331940025-496dfbfc7564?w=1400&q=80",accent:"#8b5cf6"},
  {name:"Mountain Pass",url:"https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=1400&q=80",accent:"#60a5fa"},
  {name:"Swamp",       url:"https://images.unsplash.com/photo-1501854140801-50d01698950b?w=1400&q=80",accent:"#22c55e"},
].map(g=>({...g,bg:`url(${g.url}) center/cover no-repeat`})).concat([{name:"Custom",bg:null,url:null,accent:"#c8a870"}]);
const AVATARS=["🧙","⚔️","🐉","🌙","⚡","🔮","🗡️","🛡️","🌊","🔥","🌿","💀","🦅","🎭","✨","🪄","🌸","🏔️","🦁","🐺","🦋","🌑","⭐","🌺"];

/* ─── All MTG counter types ───────────────────────────────────────── */
const COUNTER_TYPES = [
  // Power/Toughness
  {key:"+1/+1",  label:"+1/+1",  color:"#4ade80", group:"P/T"},
  {key:"-1/-1",  label:"-1/-1",  color:"#f87171", group:"P/T"},
  {key:"+2/+2",  label:"+2/+2",  color:"#86efac", group:"P/T"},
  {key:"-0/-1",  label:"-0/-1",  color:"#fca5a5", group:"P/T"},
  // Loyalty
  {key:"loyalty", label:"Loyalty", color:"#c084fc", group:"Loyalty"},
  // Special
  {key:"charge",  label:"Charge",  color:"#fbbf24", group:"Special"},
  {key:"time",    label:"Time",    color:"#60a5fa", group:"Special"},
  {key:"fate",    label:"Fate",    color:"#a78bfa", group:"Special"},
  {key:"ki",      label:"Ki",      color:"#34d399", group:"Special"},
  {key:"age",     label:"Age",     color:"#94a3b8", group:"Special"},
  {key:"quest",   label:"Quest",   color:"#fcd34d", group:"Special"},
  {key:"lore",    label:"Lore",    color:"#f97316", group:"Special"},
  {key:"study",   label:"Study",   color:"#38bdf8", group:"Special"},
  {key:"level",   label:"Level",   color:"#e879f9", group:"Special"},
  {key:"verse",   label:"Verse",   color:"#a3e635", group:"Special"},
  {key:"feather", label:"Feather", color:"#fef3c7", group:"Special"},
  {key:"flood",   label:"Flood",   color:"#7dd3fc", group:"Special"},
  // Resource
  {key:"gold",    label:"Gold",    color:"#fbbf24", group:"Resource"},
  {key:"energy",  label:"Energy",  color:"#facc15", group:"Resource"},
  {key:"treasure",label:"Treasure",color:"#d97706", group:"Resource"},
  {key:"food",    label:"Food",    color:"#a16207", group:"Resource"},
  {key:"clue",    label:"Clue",    color:"#e2e8f0", group:"Resource"},
  {key:"blood",   label:"Blood",   color:"#dc2626", group:"Resource"},
  {key:"shard",   label:"Shard",   color:"#818cf8", group:"Resource"},
  {key:"map",     label:"Map",     color:"#86efac", group:"Resource"},
  // Damage / Infect
  {key:"poison",  label:"Poison",  color:"#a855f7", group:"Damage"},
  {key:"infection",label:"Infect", color:"#22c55e", group:"Damage"},
  {key:"rad",     label:"Rad",     color:"#84cc16", group:"Damage"},
  {key:"doom",    label:"Doom",    color:"#ef4444", group:"Damage"},
  {key:"bounty",  label:"Bounty",  color:"#f59e0b", group:"Damage"},
  // Game State
  {key:"storm",   label:"Storm ⚡",color:"#38bdf8", group:"Game State"},
  {key:"experience",label:"Exp",   color:"#f0abfc", group:"Game State"},
  {key:"initiative",label:"Init",  color:"#fde68a", group:"Game State"},
  {key:"monarch", label:"Monarch", color:"#fbbf24", group:"Game State"},
  {key:"day",     label:"Day",     color:"#fef08a", group:"Game State"},
  {key:"night",   label:"Night",   color:"#818cf8", group:"Game State"},
  {key:"acorn",   label:"Acorn",   color:"#a3e635", group:"Game State"},
];

/* ─── Planechase plane cards ──────────────────────────────────────── */
const PLANE_CARDS = [
  {id:"akoum",name:"Akoum",type:"Plane — Zendikar",text:"Whenever a land enters the battlefield, Akoum deals 2 damage to any target. Chaos: Akoum deals 1 damage to any target.",chaos:"⚡ Deal 1 damage to any target",bg:"#1a0808"},
  {id:"glimmervoid",name:"Glimmervoid Basin",type:"Plane — Mirrodin",text:"Whenever a player casts an instant or sorcery spell, that player copies it. Chaos: Copy target instant or sorcery spell.",chaos:"📋 Copy target spell",bg:"#050a12"},
  {id:"hedron",name:"Hedron Fields of Agadeem",type:"Plane — Zendikar",text:"Creatures with power 7 or greater can't attack or block. Chaos: Create a 0/1 white Eldrazi Spawn token.",chaos:"✦ Create Eldrazi Spawn token",bg:"#0a0a1a"},
  {id:"iquatana",name:"Iquatana",type:"Plane — Zendikar",text:"When you planeswalk to Iquatana, you may cast a spell from your hand without paying its mana cost. Chaos: You may cast a card from your hand without paying its mana cost.",chaos:"🎁 Cast a card for free",bg:"#0a1a08"},
  {id:"ir",name:"Ir",type:"Plane — Phyrexia",text:"At the beginning of your upkeep, Ir deals damage to you equal to the number of Phyrexians you control. Chaos: Until end of turn, target creature gains infect.",chaos:"☠ Target creature gains infect",bg:"#050f05"},
  {id:"kessig",name:"Kessig",type:"Plane — Innistrad",text:"Whenever a creature attacks, it gets +2/+0 until end of turn. Chaos: Gain control of target creature until end of turn.",chaos:"🐺 Gain control of a creature",bg:"#080410"},
  {id:"linvala",name:"Linvala's Judgment",type:"Plane — Zendikar",text:"All creatures have flying. Chaos: Create a 4/4 white Angel creature token with flying and vigilance.",chaos:"👼 Create Angel token",bg:"#0e0e0a"},
  {id:"norn",name:"The Autonomous Furnace",type:"Plane — New Phyrexia",text:"All creatures get +1/+0. At the beginning of your upkeep, sacrifice a creature. Chaos: Deal 3 damage to each creature.",chaos:"💥 Deal 3 damage to each creature",bg:"#050a05"},
  {id:"takenuma",name:"Takenuma",type:"Plane — Kamigawa",text:"Whenever a creature dies, its controller draws a card. Chaos: Return target card from your graveyard to hand.",chaos:"↩ Return a card from graveyard",bg:"#0a0805"},
  {id:"ravnica_plane",name:"Ravnica",type:"Plane — Ravnica",text:"All multicolored spells cost {2} less to cast. Chaos: Search your library for a multicolored card, reveal it, put it in hand.",chaos:"🔍 Tutor a multicolored card",bg:"#100a0a"},
  {id:"shandalar",name:"Shandalar",type:"Plane — Shandalar",text:"Plains, Islands, Swamps, Mountains, and Forests are Arcane and have '{T}: Add three mana of this land's type.' Chaos: Add five mana of any one color.",chaos:"💎 Add 5 mana of any color",bg:"#0a1010"},
  {id:"stairs",name:"The Stairs to Infinity",type:"Plane — Meditation Realm",text:"Players have no maximum hand size. Chaos: Scry 2.",chaos:"🔮 Scry 2",bg:"#060610"},
];



/* ─── UI Themes ───────────────────────────────────────────────────── */
const THEMES = [
  // Dark/Night
  { id:"default",   name:"Arcane Night",    bg:"#050a12", panel:"#080f1c", border:"#1e3a5f", accent:"#c8a870", text:"#d4c5a0",
    headerBg:"linear-gradient(180deg,#080f1c,#050a12)",
    panelTex:"repeating-linear-gradient(135deg,rgba(200,168,112,.02) 0,rgba(200,168,112,.02) 1px,transparent 0,transparent 50%),#080f1c" },
  // Stone / Rock
  { id:"stone",     name:"Stone Dungeon",   bg:"#1a1714", panel:"#221f1b", border:"#5a4a38", accent:"#d4a46a", text:"#e8d5b8",
    headerBg:"linear-gradient(180deg,#2a2420,#1a1714)",
    panelTex:"repeating-linear-gradient(0deg,rgba(90,74,56,.18) 0,rgba(90,74,56,.18) 1px,transparent 0,transparent 16px),repeating-linear-gradient(90deg,rgba(90,74,56,.12) 0,rgba(90,74,56,.12) 1px,transparent 0,transparent 24px),#221f1b" },
  // Cobblestone
  { id:"cobble",    name:"Cobblestone",     bg:"#1c1a17", panel:"#252219", border:"#6a5c44", accent:"#c8a050", text:"#dfd0b0",
    headerBg:"linear-gradient(180deg,#2e2820,#1c1a17)",
    panelTex:"radial-gradient(ellipse 20px 14px at 10px 7px,rgba(255,255,255,.04) 0,transparent 60%),radial-gradient(ellipse 18px 12px at 30px 18px,rgba(255,255,255,.03) 0,transparent 60%),#252219" },
  // Wood
  { id:"wood",      name:"Oak Tavern",      bg:"#1e1408", panel:"#28180a", border:"#7a4a18", accent:"#e07820", text:"#f0d090",
    headerBg:"linear-gradient(180deg,#321c0c,#1e1408)",
    panelTex:"repeating-linear-gradient(12deg,rgba(180,100,30,.07) 0,rgba(180,100,30,.07) 1px,transparent 0,transparent 18px),repeating-linear-gradient(-8deg,rgba(120,60,10,.05) 0,rgba(120,60,10,.05) 1px,transparent 0,transparent 22px),#28180a" },
  // Grass/Ferns (day)
  { id:"forest",    name:"Forest Glade",    bg:"#0e1a0a", panel:"#152010", border:"#2e5a1e", accent:"#6ad040", text:"#d0f0c0",
    headerBg:"linear-gradient(180deg,#1a2e12,#0e1a0a)",
    panelTex:"radial-gradient(ellipse 40px 20px at 20px 18px,rgba(80,180,40,.08) 0,transparent 70%),radial-gradient(ellipse 30px 16px at 50px 32px,rgba(60,140,30,.06) 0,transparent 70%),#152010" },
  // Daylight (light theme)
  { id:"parchment", name:"Parchment Day",   bg:"#e8ddc8", panel:"#f0e4cc", border:"#9a7a50", accent:"#6a3a10", text:"#2a1a08",
    headerBg:"linear-gradient(180deg,#f5e8d0,#e8ddc8)",
    panelTex:"repeating-linear-gradient(45deg,rgba(154,122,80,.04) 0,rgba(154,122,80,.04) 1px,transparent 0,transparent 14px),#f0e4cc" },
  // Ocean
  { id:"ocean",     name:"Deep Ocean",      bg:"#020e1a", panel:"#041428", border:"#0a3a5a", accent:"#22b8e8", text:"#a0d8f0",
    headerBg:"linear-gradient(180deg,#061828,#020e1a)",
    panelTex:"repeating-linear-gradient(170deg,rgba(34,184,232,.04) 0,rgba(34,184,232,.04) 1px,transparent 0,transparent 30px),#041428" },
  // Volcanic
  { id:"volcanic",  name:"Volcanic",        bg:"#120404", panel:"#200808", border:"#6a1808", accent:"#ff5020", text:"#ffd0b0",
    headerBg:"linear-gradient(180deg,#2a0a06,#120404)",
    panelTex:"radial-gradient(ellipse 60px 20px at 50% 80%,rgba(255,80,0,.06) 0,transparent 60%),#200808" },
  // Arcane purple
  { id:"arcane",    name:"Arcane Void",     bg:"#08040f", panel:"#12081e", border:"#4a1a7a", accent:"#c084fc", text:"#e9d5ff",
    headerBg:"linear-gradient(180deg,#1a0830,#08040f)",
    panelTex:"radial-gradient(ellipse 80px 40px at 50% 40%,rgba(192,132,252,.05) 0,transparent 70%),#12081e" },
  // Gold/Theros
  { id:"theros",    name:"Golden Theros",   bg:"#0e0c02", panel:"#181600", border:"#5a5010", accent:"#eab308", text:"#fef3c7",
    headerBg:"linear-gradient(180deg,#1a1800,#0e0c02)",
    panelTex:"repeating-linear-gradient(45deg,rgba(234,179,8,.04) 0,rgba(234,179,8,.04) 1px,transparent 0,transparent 18px),#181600" },
  // Ice
  { id:"ice",       name:"Tundra Ice",      bg:"#080e18", panel:"#0e1825", border:"#2a4a7a", accent:"#90d0f8", text:"#d0e8ff",
    headerBg:"linear-gradient(180deg,#122030,#080e18)",
    panelTex:"repeating-linear-gradient(60deg,rgba(144,208,248,.03) 0,rgba(144,208,248,.03) 1px,transparent 0,transparent 22px),#0e1825" },
  // Bone/white
  { id:"bone",      name:"Bleached Bone",   bg:"#1a1510", panel:"#221c14", border:"#6a5a44", accent:"#f0d0a0", text:"#fff8ec",
    headerBg:"linear-gradient(180deg,#2a2018,#1a1510)",
    panelTex:"repeating-linear-gradient(15deg,rgba(240,208,160,.04) 0,rgba(240,208,160,.04) 1px,transparent 0,transparent 20px),#221c14" },
];

/* ─── Live theme object — written by MTGPlayground, read by all components ── */
const T = {
  bg:       '#050a12',
  panel:    '#080f1c',
  border:   '#1e3a5f',
  accent:   '#c8a870',
  text:     '#d4c5a0',
  headerBg: 'linear-gradient(180deg,#080f1c,#050a12)',
  panelTex: '',
};

/* ─── Weather Effects ─────────────────────────────────────────────── */
const WEATHER_OPTIONS = [
  { id:"none",       name:"Clear",       icon:"☀️" },
  { id:"rain",       name:"Rain",        icon:"🌧️" },
  { id:"snow",       name:"Snow",        icon:"❄️" },
  { id:"heat",       name:"Desert Heat", icon:"🌵" },
  { id:"stars",      name:"Starfield",   icon:"✨" },
  { id:"fireflies",  name:"Fireflies",   icon:"🪲" },
  { id:"embers",     name:"Embers",      icon:"🔥" },
  { id:"aurora",     name:"Aurora",      icon:"🌌" },
];


/* ─── Utilities ───────────────────────────────────────────────────── */
const uid=()=>`${Date.now().toString(36)}-${Math.random().toString(36).substr(2,5)}`;
const getImg=c=>{
  if(!c)return null;
  if(c.altFace){
    // Back face: check all possible locations
    return c.altImageUri
      || c.faces?.[1]?.imageUri
      || c.card_faces?.[1]?.image_uris?.normal
      || null;
  }
  // Front face: check all possible locations
  return c.imageUri
    || c.image_uris?.normal
    || c.faces?.[0]?.imageUri
    || c.card_faces?.[0]?.image_uris?.normal
    || null;
};

// Extract full face data from a Scryfall card object
const extractFaces=(card)=>{
  if(!card?.card_faces?.length) return null;
  return card.card_faces.map((f,i)=>({
    name:f.name||card.name,
    // Scryfall DFCs: image is in face.image_uris, not card.image_uris
    imageUri:f.image_uris?.normal||f.image_uris?.large||null,
    manaCost:f.mana_cost||"",
    typeLine:f.type_line||"",
    oracleText:f.oracle_text||"",
    power:f.power||null,
    toughness:f.toughness||null,
    colors:f.colors||card.colors||[],
  }));
};

// Detect if a card object (raw Scryfall or stored deck card) is double-faced
const isDFCCard=(c)=>{
  if(!c) return false;
  // Only cards explicitly marked as DFC by Scryfall (has real card_faces or isDoubleFaced flag)
  // altImageUri alone (custom sleeve/art) does NOT make a card DFC
  return !!(c.isDoubleFaced || c.card_faces?.length>=2 || c.faces?.length>=2);
};

// Build a complete stored card entry from a raw Scryfall card object
// Ensures DFC image data is captured from card_faces properly
const buildDeckEntry=(card, extra={})=>{
  const faces=extractFaces(card)||card.faces||null;
  const dfc=isDFCCard(card);

  // Front face image — Scryfall DFCs have no top-level image_uris, only inside card_faces
  const frontImg=card.image_uris?.normal
    || card.card_faces?.[0]?.image_uris?.normal
    || card.imageUri
    || faces?.[0]?.imageUri
    || null;

  // Back face image — check card_faces[1], then faces[1], then derive from front URL
  const backImg=card.card_faces?.[1]?.image_uris?.normal
    || card.altImageUri
    || faces?.[1]?.imageUri
    // Scryfall systematic pattern: /front/ → /back/
    || (frontImg?frontImg.replace("/front/","/back/"):null)
    || null;

  return {
    scryfallId:card.id||card.scryfallId||`c_${uid()}`,
    name:card.name,
    imageUri:frontImg,
    altImageUri:backImg,
    faces,
    isDoubleFaced:dfc,
    manaCost:card.mana_cost||card.card_faces?.[0]?.mana_cost||card.manaCost||"",
    typeLine:card.type_line||card.card_faces?.[0]?.type_line||card.typeLine||"",
    oracleText:card.oracle_text||card.card_faces?.[0]?.oracle_text||card.oracleText||"",
    power:card.power||card.card_faces?.[0]?.power||null,
    toughness:card.toughness||card.card_faces?.[0]?.toughness||null,
    colors:card.colors||card.card_faces?.[0]?.colors||[],
    ...extra,
  };
};
const isLand=c=>!!(c?.typeLine||c?.type_line||"").toLowerCase().includes("land");
const shuffleArr=a=>{const r=[...a];for(let i=r.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[r[i],r[j]]=[r[j],r[i]];}return r;};
const mkCard=(base,zone="library")=>({iid:uid(),...base,tapped:false,faceDown:false,counters:{},zone,x:0,y:0});

const getStartingLife=(format)=>format==="commander"?40:format==="dandan"?20:20;
const initPlayer=(deck,profile,life=20)=>({
  profile:(()=>{
    const base = profile||{alias:"Player",avatar:"🧙",gamemat:GAMEMATS[0].bg,gamematCustom:""};
    // v7.6.1: if the deck has its own playmat, use it (but don't overwrite profile object).
    // CSS fix: wrap the URL in `url(...) center/cover no-repeat` — the raw URL alone
    // is not valid for the CSS `background` shorthand and rendered as black.
    if(deck?.playmatUri) return {...base, gamemat: `url(${deck.playmatUri}) center/cover no-repeat`, gamematCustom: deck.playmatUri};
    return base;
  })(),
  deck,
  library:shuffleArr((deck?.cards||[]).flatMap(c=>Array.from({length:c.quantity},()=>mkCard(c,"library")))),
  hand:[],battlefield:[],graveyard:[],exile:[],
  command:(deck?.commanders||[]).map(c=>mkCard({...c,castCount:0,isCommander:true},"command")).concat(deck?.commander&&!(deck?.commanders?.length)?[mkCard({...deck.commander,castCount:0,isCommander:true},"command")]:[]),
  life,poison:0,energy:0,commanderDamage:{},revealTop:false,revealTopOnce:null,log:[],
});

/* ─── Mana cost parser ─────────────────────────────────────────────── */
function ManaCost({cost}){
  if(!cost)return null;
  const symbols=(cost.match(/\{[^}]+\}/g)||[]);
  const colorMap={W:"orb-W",U:"orb-U",B:"orb-B",R:"orb-R",G:"orb-G",C:"orb-C"};
  const textMap={W:"W",U:"U",B:"B",R:"R",G:"G",C:"C"};
  return(
    <span style={{display:"inline-flex",gap:1,flexWrap:"wrap",alignItems:"center"}}>
      {symbols.map((s,i)=>{
        const inner=s.slice(1,-1);
        const cls=colorMap[inner]||"orb-X";
        const txt=textMap[inner]||inner;
        return<span key={i} className={`mana-symbol ${cls}`} style={{color:inner==="W"?"#5a4a00":"#fff",fontSize:7,boxShadow:"0 1px 3px rgba(0,0,0,.5)",border:"1px solid rgba(255,255,255,.15)"}}>{txt}</span>;
      })}
    </span>
  );
}

/* ─── Style helpers ────────────────────────────────────────────────── */
const btn=(bg,color="white",ex={})=>({
  background:bg,border:"none",color,borderRadius:4,padding:"5px 10px",
  cursor:"pointer",fontSize:11,fontFamily:"Cinzel, serif",letterSpacing:"0.05em",
  transition:"filter .12s,transform .1s,box-shadow .15s",flexShrink:0,...ex
});
const iS={display:"block",width:"100%",padding:"7px 10px",background:"rgba(5,10,18,.8)",
  border:"1px solid #1e3a5f",color:"#d4c5a0",borderRadius:5,fontSize:12,
  fontFamily:"Crimson Text, serif",marginTop:3,transition:"border-color .15s,box-shadow .15s"};
const hov=e=>{e.currentTarget.style.filter="brightness(1.4)";e.currentTarget.style.transform="translateY(-1px)";};
const uhov=e=>{e.currentTarget.style.filter="none";e.currentTarget.style.transform="none";};

/* ─── Particle burst ───────────────────────────────────────────────── */
function SparkBurst({x,y,color="#c8a870",count=12,onDone}){
  const [alive,setAlive]=useState(true);
  useEffect(()=>{const t=setTimeout(()=>{setAlive(false);onDone&&onDone();},700);return()=>clearTimeout(t);},[]);
  if(!alive)return null;
  return(
    <div style={{position:"fixed",left:x,top:y,pointerEvents:"none",zIndex:99998}}>
      {Array.from({length:count},(_,i)=>{
        const angle=(i/count)*Math.PI*2;
        const dist=30+Math.random()*40;
        return(
          <div key={i} style={{
            position:"absolute",width:4,height:4,borderRadius:"50%",
            background:color,
            "--tx":`${Math.cos(angle)*dist}px`,
            "--ty":`${Math.sin(angle)*dist}px`,
            animation:`particleBurst ${0.4+Math.random()*.3}s ease-out forwards`,
            animationDelay:`${Math.random()*.1}s`,
            boxShadow:`0 0 4px ${color}`,
          }}/>
        );
      })}
    </div>
  );
}

/* ─── Dragon flyover ───────────────────────────────────────────────── */
function DragonFlyover({onDone}){
  useEffect(()=>{const t=setTimeout(onDone,4000);return()=>clearTimeout(t);},[]);
  return(
    <div style={{position:"fixed",inset:0,pointerEvents:"none",zIndex:99990,overflow:"hidden"}}>
      {/* Dragon */}
      <div style={{
        position:"absolute",top:"30%",fontSize:72,lineHeight:1,
        animation:"dragonFly 4s cubic-bezier(0.25,0.1,0.25,1) forwards",
        filter:"drop-shadow(0 0 20px rgba(255,80,0,.7)) drop-shadow(0 4px 8px rgba(0,0,0,.8))",
        textShadow:"none",
      }}>🐉</div>
      {/* Fire breath SVG */}
      <svg style={{position:"absolute",top:"26%",left:"46%",width:180,height:80,animation:"dragonBreath 1.2s ease-out 1.2s forwards",opacity:0}} viewBox="0 0 180 80">
        <defs>
          <radialGradient id="fire1" cx="0%" cy="50%">
            <stop offset="0%" stopColor="#ff9900" stopOpacity="1"/>
            <stop offset="40%" stopColor="#ff4400" stopOpacity=".8"/>
            <stop offset="100%" stopColor="#ff0000" stopOpacity="0"/>
          </radialGradient>
        </defs>
        <ellipse cx="90" cy="40" rx="90" ry="30" fill="url(#fire1)"/>
        <ellipse cx="70" cy="40" rx="50" ry="18" fill="#ffcc00" opacity=".6"/>
      </svg>
      {/* Screen flash */}
      <div style={{
        position:"absolute",inset:0,
        background:"radial-gradient(ellipse at 50% 30%,rgba(255,100,0,.08) 0%,transparent 60%)",
        animation:"fadeIn .5s ease 1.2s both, fadeIn .5s ease-out 2s reverse both"
      }}/>
      {/* Sparkles trail */}
      {Array.from({length:8},(_,i)=>(
        <div key={i} style={{
          position:"absolute",top:`${25+Math.random()*15}%`,
          left:`${10+i*10}%`,
          fontSize:16,
          animation:`sparkle ${0.6+Math.random()*.4}s ease-in-out ${0.3+i*.2}s both`,
          filter:"drop-shadow(0 0 6px orange)"
        }}>✨</div>
      ))}
    </div>
  );
}

/* ─── Ritual circle overlay ────────────────────────────────────────── */
function RitualCircle({color="#a855f7"}){
  return(
    <svg style={{position:"absolute",inset:0,width:"100%",height:"100%",pointerEvents:"none",opacity:.12}} viewBox="0 0 400 400">
      <circle cx="200" cy="200" r="180" fill="none" stroke={color} strokeWidth=".5" strokeDasharray="4 8"/>
      <circle cx="200" cy="200" r="140" fill="none" stroke={color} strokeWidth=".3" strokeDasharray="2 6"
        style={{transformOrigin:"200px 200px",animation:"ritualCircle 20s linear infinite"}}/>
      <polygon points="200,40 355,295 45,295" fill="none" stroke={color} strokeWidth=".4"
        style={{transformOrigin:"200px 200px",animation:"ritualCircle 30s linear infinite"}}/>
      {[0,72,144,216,288].map((a,i)=>(
        <text key={i} x="200" y="30"
          style={{transformOrigin:"200px 200px",transform:`rotate(${a}deg)`,animation:`runeFloat ${2+i*.3}s ease-in-out ${i*.4}s infinite`}}
          fill={color} fontSize="10" textAnchor="middle" fontFamily="serif" opacity=".6">
          {["✦","◈","⚔","✵","⬡"][i]}
        </text>
      ))}
    </svg>
  );
}

/* ─── Animated life counter ─────────────────────────────────────────── */
function LifeCounter({life,prevLife,onChange}){
  const [editing,setEditing]=useState(false);
  const [input,setInput]=useState("");
  const [flash,setFlash]=useState(null);
  const prevRef=useRef(life);

  useEffect(()=>{
    if(prevRef.current!==life){
      const delta=life-prevRef.current;
      setFlash(delta>0?"gain":"lose");
      setTimeout(()=>setFlash(null),600);
      prevRef.current=life;
    }
  },[life]);

  const color=life<=5?"#f87171":life<=10?"#fbbf24":life<=15?T.text:T.accent;
  const glowCls=life<=5?"glow-red":"";

  return(
    <div style={{display:"flex",alignItems:"center",gap:3,position:"relative"}}>
      <button onClick={()=>onChange(life-1)}
        style={{...btn("rgba(220,38,38,.15)","#f87171",{padding:"2px 7px",fontSize:14,borderRadius:"50%",width:22,height:22,display:"flex",alignItems:"center",justifyContent:"center"}),border:"1px solid rgba(220,38,38,.3)"}}
        onMouseOver={hov} onMouseOut={uhov}>−</button>
      {editing?(
        <input autoFocus value={input} onChange={e=>setInput(e.target.value)}
          onBlur={()=>{const v=parseInt(input);if(!isNaN(v))onChange(v);setEditing(false);}}
          onKeyDown={e=>{if(e.key==="Enter"){const v=parseInt(input);if(!isNaN(v))onChange(v);setEditing(false);}}}
          style={{width:44,textAlign:"center",fontSize:17,fontFamily:"Cinzel Decorative, serif",
            background:`${T.bg}e6`,border:`1px solid ${color}`,color,borderRadius:4,padding:"1px 2px"}}/>
      ):(
        <div onClick={()=>{setInput(String(life));setEditing(true);}} className={glowCls}
          style={{minWidth:38,textAlign:"center",cursor:"pointer",position:"relative",
            animation:flash==="gain"?"lifeFlash .5s ease":flash==="lose"?"lifeFlash .5s ease":undefined}}>
          <div style={{fontSize:7,color:"#6a7a8a",fontFamily:"Cinzel, serif",letterSpacing:".1em",marginBottom:1}}>LIFE</div>
          <div style={{fontSize:20,fontFamily:"Cinzel Decorative, serif",color,lineHeight:1,
            textShadow:life<=5?`0 0 20px #f87171`:`0 0 10px ${color}50`}}>
            {life}
          </div>
          {flash&&(
            <div style={{position:"absolute",top:-12,left:"50%",transform:"translateX(-50%)",
              fontSize:10,color:flash==="gain"?"#4ade80":"#f87171",fontFamily:"Cinzel, serif",
              fontWeight:700,animation:"slideUp .5s ease forwards",pointerEvents:"none"}}>
              {flash==="gain"?"+":"-"}{Math.abs(life-prevRef.current)}
            </div>
          )}
        </div>
      )}
      <button onClick={()=>onChange(life+1)}
        style={{...btn("rgba(74,222,128,.12)","#4ade80",{padding:"2px 7px",fontSize:14,borderRadius:"50%",width:22,height:22,display:"flex",alignItems:"center",justifyContent:"center"}),border:"1px solid rgba(74,222,128,.3)"}}
        onMouseOver={hov} onMouseOut={uhov}>+</button>
    </div>
  );
}

/* ─── Scryfall / Claude search ───────────────────────────────────── */
async function sfSearch(q,extra=""){
  try{
    const ctrl=new AbortController(),t=setTimeout(()=>ctrl.abort(),3500);
    const r=await fetch(`https://api.scryfall.com/cards/search?q=${encodeURIComponent(q+" "+extra)}&unique=cards&order=name`,{signal:ctrl.signal});
    clearTimeout(t);
    if(r.ok){const d=await r.json();return(d.data||[]).slice(0,20);}
    if(r.status===404)return[];
  }catch{}return null;
}
async function claudeCards(q,sys){
  const r=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:2500,system:sys,messages:[{role:"user",content:q}]})});
  const d=await r.json();
  const txt=(d.content||[]).filter(b=>b.type==="text").map(b=>b.text).join("");
  const m=txt.match(/\[[\s\S]*\]/);return m?JSON.parse(m[0]):[];
}


/* ─── WeatherCanvas — full-screen particle weather layer ──────────── */
function WeatherCanvas({weather}){
  const canvasRef=useRef(null);
  const rafRef=useRef(null);
  const particlesRef=useRef([]);
  const splashesRef=useRef([]);

  useEffect(()=>{
    const canvas=canvasRef.current;
    if(!canvas)return;
    const ctx=canvas.getContext("2d");
    let W=canvas.width=window.innerWidth;
    let H=canvas.height=window.innerHeight;
    const onResize=()=>{W=canvas.width=window.innerWidth;H=canvas.height=window.innerHeight;};
    window.addEventListener("resize",onResize);

    // Init particles based on weather type
    const initParticles=()=>{
      particlesRef.current=[];
      splashesRef.current=[];
      if(weather==="rain"){
        for(let i=0;i<200;i++) particlesRef.current.push({
          x:Math.random()*W,y:Math.random()*H,
          len:Math.random()*18+8,speed:Math.random()*8+14,
          opacity:Math.random()*.5+.3,
          width:Math.random()*.8+.4,
        });
      } else if(weather==="snow"){
        for(let i=0;i<150;i++) particlesRef.current.push({
          x:Math.random()*W,y:Math.random()*H,
          r:Math.random()*3+1,speed:Math.random()*.8+.3,
          drift:Math.random()*1.2-.6,opacity:Math.random()*.6+.3,
          wobble:Math.random()*Math.PI*2,wobbleSpeed:Math.random()*.02+.005,
        });
      } else if(weather==="stars"){
        for(let i=0;i<200;i++) particlesRef.current.push({
          x:Math.random()*W,y:Math.random()*H,
          r:Math.random()*1.5+.3,
          twinklePhase:Math.random()*Math.PI*2,
          twinkleSpeed:Math.random()*.03+.005,
          baseOpacity:Math.random()*.5+.1,
        });
      } else if(weather==="fireflies"){
        for(let i=0;i<60;i++) particlesRef.current.push({
          x:Math.random()*W,y:Math.random()*H,
          vx:(Math.random()-.5)*.6,vy:(Math.random()-.5)*.6,
          phase:Math.random()*Math.PI*2,phaseSpeed:Math.random()*.04+.01,
          r:Math.random()*2+1.5,glowR:Math.random()*8+6,
        });
      } else if(weather==="embers"){
        for(let i=0;i<80;i++) particlesRef.current.push({
          x:Math.random()*W,y:H+Math.random()*H,
          vx:(Math.random()-.5)*1.5,vy:-(Math.random()*1.5+.5),
          r:Math.random()*2.5+.5,
          life:Math.random(),maxLife:Math.random()*.8+.3,
          color:`hsl(${Math.random()*30+10},100%,${Math.random()*30+50}%)`,
        });
      } else if(weather==="aurora"){
        for(let i=0;i<8;i++) particlesRef.current.push({
          phase:Math.random()*Math.PI*2,speed:Math.random()*.005+.002,
          y:Math.random()*H*.35+H*.05,
          height:Math.random()*80+40,
          hue:Math.random()*120+160,alpha:Math.random()*.12+.04,
        });
      }
    };
    initParticles();

    // Rain splash: 30 frames of expanding ripple rings
    const addSplash=(x,y)=>{
      splashesRef.current.push({x,y,frame:0,maxFrames:30,r:0,maxR:18});
    };

    const draw=()=>{
      ctx.clearRect(0,0,W,H);

      if(weather==="heat"){
        // Heat shimmer: wavy distortion overlay
        const t=Date.now()*.001;
        ctx.save();
        for(let x=0;x<W;x+=40){
          const wave=Math.sin(x*.02+t*2)*3;
          const g=ctx.createLinearGradient(x,0,x,H);
          g.addColorStop(0,"rgba(255,160,60,0)");
          g.addColorStop(.3,`rgba(255,140,40,${.02+Math.sin(x*.05+t)*0.015})`);
          g.addColorStop(.7,"rgba(255,120,20,0)");
          g.addColorStop(1,"rgba(255,160,60,0)");
          ctx.fillStyle=g;
          ctx.fillRect(x+wave,0,40,H);
        }
        // Orange tint overlay
        ctx.fillStyle="rgba(255,120,30,0.04)";
        ctx.fillRect(0,0,W,H);
        ctx.restore();
        rafRef.current=requestAnimationFrame(draw);
        return;
      }

      if(weather==="rain"){
        ctx.strokeStyle="rgba(174,214,241,0.5)";
        ctx.lineCap="round";
        particlesRef.current.forEach(p=>{
          ctx.lineWidth=p.width;
          ctx.globalAlpha=p.opacity;
          ctx.beginPath();
          ctx.moveTo(p.x,p.y);
          ctx.lineTo(p.x-p.len*.15,p.y+p.len);
          ctx.stroke();
          p.y+=p.speed; p.x-=p.speed*.1;
          if(p.y>H){
            // Trigger splash
            if(Math.random()<.15) addSplash(p.x,H*.65+Math.random()*H*.2);
            p.y=-p.len; p.x=Math.random()*W;
          }
          if(p.x<0) p.x=W;
        });
        // Draw splashes — 30 frame ripple animation
        ctx.globalAlpha=1;
        splashesRef.current=splashesRef.current.filter(s=>{
          const progress=s.frame/s.maxFrames;
          s.r=progress*s.maxR;
          const alpha=(1-progress)*0.6;
          // Primary ring
          ctx.beginPath();
          ctx.ellipse(s.x,s.y,s.r,s.r*.35,0,0,Math.PI*2);
          ctx.strokeStyle=`rgba(180,220,255,${alpha})`;
          ctx.lineWidth=.8+progress*.3;
          ctx.stroke();
          // Secondary inner ring
          if(s.frame>5){
            const r2=s.r*.55;
            ctx.beginPath();
            ctx.ellipse(s.x,s.y,r2,r2*.3,0,0,Math.PI*2);
            ctx.strokeStyle=`rgba(200,230,255,${alpha*.6})`;
            ctx.lineWidth=.5;
            ctx.stroke();
          }
          // Tiny droplet sprays: 6 rays at frame 0-8
          if(s.frame<8){
            for(let i=0;i<6;i++){
              const angle=(i/6)*Math.PI*2;
              const dist=(s.frame/8)*12;
              ctx.beginPath();
              ctx.arc(s.x+Math.cos(angle)*dist,s.y+Math.sin(angle)*dist*.4,1,0,Math.PI*2);
              ctx.fillStyle=`rgba(200,235,255,${alpha*.8})`;
              ctx.fill();
            }
          }
          s.frame++;
          return s.frame<s.maxFrames;
        });
      }

      if(weather==="snow"){
        particlesRef.current.forEach(p=>{
          p.wobble+=p.wobbleSpeed;
          p.x+=Math.sin(p.wobble)*p.drift;
          p.y+=p.speed;
          if(p.y>H){p.y=-5;p.x=Math.random()*W;}
          if(p.x<0)p.x=W;if(p.x>W)p.x=0;
          ctx.globalAlpha=p.opacity;
          const g=ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,p.r*2);
          g.addColorStop(0,"rgba(255,255,255,.9)");
          g.addColorStop(.5,"rgba(200,230,255,.5)");
          g.addColorStop(1,"rgba(200,230,255,0)");
          ctx.fillStyle=g;
          ctx.beginPath();ctx.arc(p.x,p.y,p.r*2,0,Math.PI*2);ctx.fill();
          // Snowflake cross
          ctx.strokeStyle=`rgba(255,255,255,${p.opacity*.7})`;
          ctx.lineWidth=.5;
          ctx.beginPath();ctx.moveTo(p.x-p.r,p.y);ctx.lineTo(p.x+p.r,p.y);ctx.stroke();
          ctx.beginPath();ctx.moveTo(p.x,p.y-p.r);ctx.lineTo(p.x,p.y+p.r);ctx.stroke();
        });
      }

      if(weather==="stars"){
        particlesRef.current.forEach(p=>{
          p.twinklePhase+=p.twinkleSpeed;
          const opacity=p.baseOpacity+(Math.sin(p.twinklePhase)*.15);
          ctx.globalAlpha=Math.max(0,opacity);
          // Star glow
          const g=ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,p.r*4);
          g.addColorStop(0,"rgba(255,255,240,0.9)");
          g.addColorStop(.3,"rgba(200,220,255,0.4)");
          g.addColorStop(1,"rgba(200,220,255,0)");
          ctx.fillStyle=g;
          ctx.beginPath();ctx.arc(p.x,p.y,p.r*4,0,Math.PI*2);ctx.fill();
          // Core
          ctx.fillStyle="rgba(255,255,255,0.95)";
          ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,Math.PI*2);ctx.fill();
          // 4-point sparkle
          if(p.r>1){
            ctx.strokeStyle=`rgba(255,255,255,${opacity*.5})`;
            ctx.lineWidth=.6;
            const len=p.r*4;
            ctx.beginPath();ctx.moveTo(p.x-len,p.y);ctx.lineTo(p.x+len,p.y);ctx.stroke();
            ctx.beginPath();ctx.moveTo(p.x,p.y-len);ctx.lineTo(p.x,p.y+len);ctx.stroke();
          }
        });
      }

      if(weather==="fireflies"){
        const t=Date.now()*.001;
        particlesRef.current.forEach(p=>{
          p.phase+=p.phaseSpeed;
          p.x+=p.vx+Math.sin(p.phase*.7)*.4;
          p.y+=p.vy+Math.cos(p.phase*.5)*.3;
          if(p.x<-20)p.x=W+20;if(p.x>W+20)p.x=-20;
          if(p.y<0)p.y=H;if(p.y>H)p.y=0;
          const blink=Math.pow(Math.max(0,Math.sin(p.phase)),3);
          const opacity=blink*.85;
          if(opacity<.01) return;
          ctx.globalAlpha=opacity*.25;
          const g=ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,p.glowR);
          g.addColorStop(0,"rgba(180,255,120,1)");
          g.addColorStop(.5,"rgba(100,255,80,0.3)");
          g.addColorStop(1,"rgba(100,255,80,0)");
          ctx.fillStyle=g;
          ctx.beginPath();ctx.arc(p.x,p.y,p.glowR,0,Math.PI*2);ctx.fill();
          ctx.globalAlpha=opacity;
          ctx.fillStyle="rgba(220,255,180,0.95)";
          ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,Math.PI*2);ctx.fill();
        });
      }

      if(weather==="embers"){
        particlesRef.current.forEach(p=>{
          p.x+=p.vx+Math.sin(Date.now()*.001+p.x)*.3;
          p.y+=p.vy;
          p.life-=.004;
          if(p.life<=0||p.y<0){
            p.x=Math.random()*W;
            p.y=H+Math.random()*60;
            p.life=p.maxLife;
            p.vx=(Math.random()-.5)*1.5;
            p.vy=-(Math.random()*1.5+.5);
          }
          const alpha=p.life/p.maxLife;
          ctx.globalAlpha=alpha*.8;
          const g=ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,p.r*3);
          g.addColorStop(0,p.color);
          g.addColorStop(.4,p.color.replace("%)","%, 0.4)").replace("hsl","hsla"));
          g.addColorStop(1,"rgba(255,60,0,0)");
          ctx.fillStyle=g;
          ctx.beginPath();ctx.arc(p.x,p.y,p.r*3,0,Math.PI*2);ctx.fill();
          ctx.globalAlpha=alpha;
          ctx.fillStyle=p.color;
          ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,Math.PI*2);ctx.fill();
        });
      }

      if(weather==="aurora"){
        const t=Date.now()*.001;
        particlesRef.current.forEach((p,i)=>{
          p.phase+=p.speed;
          ctx.globalAlpha=p.alpha*(0.7+Math.sin(p.phase)*0.3);
          const g=ctx.createLinearGradient(0,p.y-p.height,0,p.y+p.height);
          const h1=p.hue,h2=(p.hue+60)%360;
          g.addColorStop(0,`hsla(${h1},100%,65%,0)`);
          g.addColorStop(.3,`hsla(${h1},100%,65%,0.6)`);
          g.addColorStop(.6,`hsla(${h2},100%,60%,0.4)`);
          g.addColorStop(1,`hsla(${h2},100%,60%,0)`);
          ctx.fillStyle=g;
          // Wavy band
          ctx.beginPath();
          ctx.moveTo(0,p.y+p.height);
          for(let x=0;x<=W;x+=20){
            const wave=Math.sin(x*.008+p.phase+(i*.7))*p.height*.6;
            const wave2=Math.sin(x*.015+p.phase*1.3)*p.height*.25;
            ctx.lineTo(x,p.y+wave+wave2);
          }
          ctx.lineTo(W,p.y+p.height);ctx.closePath();ctx.fill();
        });
      }

      ctx.globalAlpha=1;
      rafRef.current=requestAnimationFrame(draw);
    };
    draw();
    return()=>{cancelAnimationFrame(rafRef.current);window.removeEventListener("resize",onResize);};
  },[weather]);

  if(weather==="none") return null;
  const isHeat=weather==="heat";
  return(
    <canvas ref={canvasRef} style={{
      position:"fixed",inset:0,width:"100%",height:"100%",
      pointerEvents:"none",zIndex:99980,
      filter:isHeat?"sepia(0.3) saturate(1.4) hue-rotate(15deg)":"none",
      mixBlendMode:weather==="stars"||weather==="fireflies"||weather==="aurora"?"screen":"normal",
      opacity:weather==="heat"?.6:1,
    }}/>
  );
}

/* ─── ThemePicker ─────────────────────────────────────────────────── */
function ThemePicker({current,weather,onTheme,onWeather,onClose}){
  return(
    <div className="fade-in" style={{position:"fixed",inset:0,background:"rgba(2,4,10,.88)",
      display:"flex",alignItems:"center",justifyContent:"center",zIndex:10001,backdropFilter:"blur(6px)"}}>
      <div className="slide-in" style={{
        background:`linear-gradient(160deg,${T.panel},${T.bg})`,
        border:`1px solid ${T.accent}40`,borderRadius:12,padding:26,
        width:640,maxHeight:"85vh",overflowY:"auto",
        boxShadow:"0 24px 80px rgba(0,0,0,.95)",position:"relative"}}>
        <div style={{position:"absolute",top:0,left:0,right:0,height:2,
          background:"linear-gradient(90deg,transparent,#c8a870,transparent)"}}/>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20}}>
          <h3 style={{color:T.accent,fontFamily:"Cinzel Decorative, serif",fontSize:14,margin:0}}>🎨 Themes & Weather</h3>
          <button onClick={onClose} style={{...btn("transparent","#6a7a8a",{fontSize:16,border:"none"})}} onMouseOver={hov} onMouseOut={uhov}>✕</button>
        </div>
        {/* Themes */}
        <div style={{fontSize:9,color:"#6a7a8a",fontFamily:"Cinzel, serif",letterSpacing:".15em",textTransform:"uppercase",marginBottom:10}}>UI Theme</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(130px,1fr))",gap:8,marginBottom:22}}>
          {THEMES.map(t=>(
            <button key={t.id} onClick={()=>onTheme(t)}
              style={{
                background:T.headerBg||T.bg,
                border:`2px solid ${current.id===t.id?T.accent:"rgba(255,255,255,.08)"}`,
                borderRadius:8,padding:"10px 8px",cursor:"pointer",
                transition:"all .15s",color:T.accent,
                fontFamily:"Cinzel, serif",fontSize:10,letterSpacing:".05em",
                boxShadow:current.id===t.id?`0 0 16px ${T.accent}40`:"none",
                transform:current.id===t.id?"scale(1.04)":"scale(1)",
              }}
              onMouseOver={e=>{e.currentTarget.style.transform="scale(1.06)";e.currentTarget.style.boxShadow=`0 0 12px ${T.accent}30`;}}
              onMouseOut={e=>{e.currentTarget.style.transform=current.id===t.id?"scale(1.04)":"scale(1)";e.currentTarget.style.boxShadow=current.id===t.id?`0 0 16px ${T.accent}40`:"none";}}>
              <div style={{fontSize:18,marginBottom:4}}>
                {t.id==="default"?"🔮":t.id==="ravnica"?"🏙️":t.id==="zendikar"?"🌿":t.id==="innistrad"?"🌙":t.id==="theros"?"☀️":t.id==="ixalan"?"🌊":t.id==="eldraine"?"🏰":t.id==="kamigawa"?"🎋":t.id==="phyrexia"?"⚙️":t.id==="mirrodin"?"🔩":t.id==="amonkhet"?"🏺":t.id==="tarkir"?"🐲":"🌟"}
              </div>
              {t.name}
            </button>
          ))}
        </div>
        {/* Weather */}
        <div style={{fontSize:9,color:"#6a7a8a",fontFamily:"Cinzel, serif",letterSpacing:".15em",textTransform:"uppercase",marginBottom:10}}>Weather Effect</div>
        <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
          {WEATHER_OPTIONS.map(w=>(
            <button key={w.id} onClick={()=>onWeather(w.id)}
              style={{
                ...btn(weather===w.id?`${T.accent}26`:"rgba(8,15,28,.7)",
                  weather===w.id?T.accent:"#6a7a8a",
                  {border:`1px solid ${weather===w.id?"rgba(200,168,112,.4)":"#1e3a5f20"}`,
                  padding:"8px 14px",fontSize:11,gap:6,display:"flex",alignItems:"center",
                  boxShadow:weather===w.id?"0 0 12px rgba(200,168,112,.2)":"none"}),
              }}
              onMouseOver={hov} onMouseOut={uhov}>
              <span style={{fontSize:16}}>{w.icon}</span>{w.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}


/* ─── CounterPicker modal ─────────────────────────────────────────── */
function CounterPicker({card, onAdd, onClose}){
  const groups={};
  COUNTER_TYPES.forEach(ct=>{(groups[ct.group]=groups[ct.group]||[]).push(ct);});
  return(
    <div className="fade-in" style={{position:"fixed",inset:0,background:"rgba(2,4,10,.88)",
      display:"flex",alignItems:"center",justifyContent:"center",zIndex:10002,backdropFilter:"blur(4px)"}}>
      <div className="slide-in" style={{
        background:`linear-gradient(160deg,${T.panel},${T.bg})`,
        border:`1px solid ${T.accent}50`,borderRadius:12,padding:22,
        width:480,maxHeight:"82vh",overflowY:"auto",
        boxShadow:"0 24px 80px rgba(0,0,0,.95)",position:"relative"}}>
        <div style={{position:"absolute",top:0,left:0,right:0,height:2,background:"linear-gradient(90deg,transparent,#c8a870,transparent)"}}/>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
          <h3 style={{color:T.accent,fontFamily:"Cinzel Decorative, serif",fontSize:13,margin:0}}>◈ Counters — {card.name}</h3>
          <button onClick={onClose} style={{...btn("transparent","#6a7a8a",{fontSize:16,border:"none"})}} onMouseOver={hov} onMouseOut={uhov}>✕</button>
        </div>
        {/* Current counters */}
        {Object.entries(card.counters||{}).filter(([,v])=>v!==0).length>0&&(
          <div style={{marginBottom:14,padding:"8px 10px",background:`${T.bg}99`,borderRadius:6,border:`1px solid ${T.border}20`}}>
            <div style={{fontSize:8,color:"#6a7a8a",fontFamily:"Cinzel, serif",letterSpacing:".12em",marginBottom:6}}>CURRENT COUNTERS</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
              {Object.entries(card.counters||{}).filter(([,v])=>v!==0).map(([k,v])=>{
                const ct=COUNTER_TYPES.find(c=>c.key===k)||{color:T.accent};
                return(
                  <div key={k} style={{display:"flex",alignItems:"center",gap:3,
                    background:`${ct.color}15`,border:`1px solid ${ct.color}40`,
                    borderRadius:6,padding:"2px 8px"}}>
                    <span style={{fontSize:10,color:ct.color,fontFamily:"Cinzel, serif"}}>{k}</span>
                    <span style={{fontSize:13,color:ct.color,fontFamily:"Cinzel Decorative, serif",fontWeight:700}}>{v>0?`+${v}`:v}</span>
                    <button onClick={()=>onAdd(k,-1)} style={{...btn("transparent",ct.color,{fontSize:10,border:"none",padding:"0 3px"})}} onMouseOver={hov} onMouseOut={uhov}>−</button>
                    <button onClick={()=>onAdd(k,1)} style={{...btn("transparent",ct.color,{fontSize:10,border:"none",padding:"0 3px"})}} onMouseOver={hov} onMouseOut={uhov}>+</button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {/* Counter groups */}
        {Object.entries(groups).map(([group,types])=>(
          <div key={group} style={{marginBottom:12}}>
            <div style={{fontSize:8,color:"#4a6a8a",fontFamily:"Cinzel, serif",letterSpacing:".12em",textTransform:"uppercase",marginBottom:5,borderBottom:`1px solid ${T.border}20`,paddingBottom:3}}>{group}</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
              {types.map(ct=>(
                <div key={ct.key} style={{display:"flex",alignItems:"center",gap:0,borderRadius:5,
                  border:`1px solid ${ct.color}30`,overflow:"hidden"}}>
                  <button onClick={()=>onAdd(ct.key,-1)}
                    style={{...btn(`${ct.color}10`,ct.color,{padding:"3px 6px",fontSize:11,border:"none",borderRadius:"5px 0 0 5px"})}}
                    onMouseOver={hov} onMouseOut={uhov}>−</button>
                  <span style={{fontSize:9,color:ct.color,padding:"3px 6px",background:`${ct.color}08`,
                    fontFamily:"Cinzel, serif",minWidth:46,textAlign:"center"}}>
                    {ct.label}
                    {(card.counters?.[ct.key]||0)!==0&&
                      <span style={{marginLeft:3,fontWeight:700}}>{card.counters[ct.key]>0?`+${card.counters[ct.key]}`:card.counters[ct.key]}</span>}
                  </span>
                  <button onClick={()=>onAdd(ct.key,1)}
                    style={{...btn(`${ct.color}10`,ct.color,{padding:"3px 6px",fontSize:11,border:"none",borderRadius:"0 5px 5px 0"})}}
                    onMouseOver={hov} onMouseOut={uhov}>+</button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── PlanechasePanel ─────────────────────────────────────────────── */
function PlanechasePanel({active, onPlaneswalk, onChaos, onClose}){
  const plane = active || PLANE_CARDS[0];
  const [rolling, setRolling] = useState(false);
  const [dieResult, setDieResult] = useState(null); // "planeswalk"|"chaos"|"blank"

  const rollPlanarDie = () => {
    setRolling(true);
    setTimeout(()=>{
      const r = Math.random();
      // Planar die: 1/6 planeswalk, 1/6 chaos, 4/6 blank
      const result = r < 1/6 ? "planeswalk" : r < 2/6 ? "chaos" : "blank";
      setDieResult(result);
      setRolling(false);
      if(result==="planeswalk") onPlaneswalk();
      if(result==="chaos") onChaos(plane);
    }, 600);
  };

  return(
    <div className="slide-in" style={{
      position:"fixed",bottom:130,left:"50%",transform:"translateX(-50%)",
      zIndex:9995,background:`linear-gradient(160deg,${plane.bg||T.bg},#050a12)`,
      border:`1px solid ${T.accent}60`,borderRadius:12,padding:16,
      width:320,boxShadow:"0 12px 48px rgba(0,0,0,.95),0 0 40px rgba(200,168,112,.05)"}}>
      <div style={{position:"absolute",top:0,left:0,right:0,height:2,
        background:"linear-gradient(90deg,transparent,#c8a870,transparent)"}}/>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
        <div style={{fontSize:9,color:T.accent,fontFamily:"Cinzel, serif",letterSpacing:".15em"}}>🌌 PLANECHASE</div>
        <button onClick={onClose} style={{...btn("transparent","#6a7a8a",{fontSize:13,border:"none"})}} onMouseOver={hov} onMouseOut={uhov}>✕</button>
      </div>
      <div style={{color:"#f0d080",fontFamily:"Cinzel Decorative, serif",fontSize:14,marginBottom:3}}>{plane.name}</div>
      <div style={{fontSize:9,color:"#8a99b0",fontFamily:"Cinzel, serif",marginBottom:6}}>{plane.type}</div>
      <div style={{fontSize:11,color:T.text,fontFamily:"Crimson Text, serif",lineHeight:1.6,marginBottom:10,
        fontStyle:"italic",padding:"8px 10px",background:"rgba(5,10,18,.5)",borderRadius:5,
        border:"1px solid rgba(200,168,112,.1)"}}>{plane.text}</div>
      <div style={{fontSize:10,color:"#fbbf24",marginBottom:12,fontFamily:"Cinzel, serif"}}>
        ⚡ Chaos: {plane.chaos}
      </div>
      {dieResult&&(
        <div style={{textAlign:"center",marginBottom:8,padding:"6px",borderRadius:5,
          background:dieResult==="planeswalk"?`${T.accent}26`:dieResult==="chaos"?"rgba(249,115,22,.15)":"rgba(10,22,40,.5)",
          border:`1px solid ${dieResult==="planeswalk"?"rgba(200,168,112,.3)":dieResult==="chaos"?"rgba(249,115,22,.3)":"#1e3a5f20"}`,
          animation:"slideIn .2s ease"}}>
          <span style={{fontSize:13,fontFamily:"Cinzel, serif",
            color:dieResult==="planeswalk"?T.accent:dieResult==="chaos"?"#f97316":"#6a7a8a"}}>
            {dieResult==="planeswalk"?"🌀 Planeswalk!":dieResult==="chaos"?"⚡ Chaos!":"⬛ Blank"}
          </span>
        </div>
      )}
      <div style={{display:"flex",gap:6}}>
        <button onClick={rollPlanarDie} disabled={rolling}
          style={{...btn("linear-gradient(135deg,#c8a870,#8a6040)",T.bg,{flex:2,fontFamily:"Cinzel, serif",fontWeight:700,opacity:rolling?.7:1})}}
          onMouseOver={hov} onMouseOut={uhov}>{rolling?"🎲 Rolling…":"🎲 Roll Planar Die"}</button>
        <button onClick={onPlaneswalk}
          style={{...btn(`${T.accent}14`,T.accent,{flex:1,border:`1px solid ${T.accent}40`,fontSize:10})}}
          onMouseOver={hov} onMouseOut={uhov}>Next Plane →</button>
      </div>
    </div>
  );
}

/* ─── InGameChat ──────────────────────────────────────────────────── */
function InGameChat({playerName,avatar,isOpen,onToggle,log=[],showLog,onToggleLog}){
  const [messages,setMessages]=useState([
    {id:uid(),sender:"System",text:"Game started. Good luck!",ts:Date.now(),system:true},
  ]);
  const [input,setInput]=useState("");
  const bottomRef=useRef(null);
  // v7.4: unified remote log — every action from any seat lives here, tagged
  // with author alias. Replayed from game_events on rejoin so nothing is lost.
  const [remoteLog,setRemoteLog]=useState([]);
  const seenEvtIds=useRef(new Set());

  useEffect(()=>{
    if(isOpen) bottomRef.current?.scrollIntoView({behavior:"smooth"});
  },[messages,isOpen]);

  // v7.4: on mount, pull last 200 events so rejoining players see full history.
  // Also re-pull whenever netSync instance is (re-)attached.
  useEffect(()=>{
    let cancelled=false;
    const loadOnce=async()=>{
      const net=window.__MTG_V7__?.netSync;
      if(!net)return;
      try{
        const history=await net.loadHistory({limit:200});
        if(cancelled||!Array.isArray(history))return;
        const chatMsgs=[];
        const logEntries=[];
        for(const ev of history){
          if(seenEvtIds.current.has(ev.id))continue;
          seenEvtIds.current.add(ev.id);
          const p=ev.payload||{};
          if(ev.kind==="chat"&&p.text){
            chatMsgs.push({id:p.id||`h${ev.id}`,sender:p.alias||p.sender||"Player",avatar:p.avatar||"🧙",text:p.text,ts:p.ts||Date.parse(ev.created_at)||Date.now()});
          } else if(ev.kind==="action"&&p.text){
            const alias=p.alias||p.sender||"Player";
            logEntries.push(`${alias}: ${p.text}`);
          }
        }
        if(chatMsgs.length) setMessages(ms=>[...ms,...chatMsgs]);
        if(logEntries.length) setRemoteLog(l=>[...logEntries.reverse(),...l].slice(0,120));
      }catch(e){/* silent */}
    };
    loadOnce();
    // Re-attempt when netSync instance becomes available (startGame is async)
    const t=setInterval(loadOnce,800);
    const stop=setTimeout(()=>clearInterval(t),6000);
    return()=>{cancelled=true;clearInterval(t);clearTimeout(stop);};
  },[]);

  // v7.4: subscribe to incoming remote events (live). No "Opponent" fallback —
  // always use the event's stamped alias.
  useEffect(()=>{
    const onChat=(e)=>{
      const m=e.detail||{};
      if(!m.text)return;
      if(m.id&&seenEvtIds.current.has(m.id))return;
      if(m.id)seenEvtIds.current.add(m.id);
      setMessages(ms=>[...ms,{id:m.id||uid(),sender:m.alias||m.sender||"Player",avatar:m.avatar||"🧙",text:m.text,ts:m.ts||Date.now()}]);
    };
    const onAct=(e)=>{
      const m=e.detail||{};
      if(!m.text)return;
      const alias=m.alias||m.sender||"Player";
      setRemoteLog(l=>[`${alias}: ${m.text}`,...l].slice(0,120));
    };
    window.addEventListener("mtg:remote-chat",onChat);
    window.addEventListener("mtg:remote-action",onAct);
    return()=>{
      window.removeEventListener("mtg:remote-chat",onChat);
      window.removeEventListener("mtg:remote-action",onAct);
    };
  },[]);

  const send=()=>{
    if(!input.trim())return;
    const text=input.trim();
    const msg={id:uid(),sender:playerName,avatar,text,ts:Date.now()};
    setMessages(m=>[...m,msg]);
    if(msg.id)seenEvtIds.current.add(msg.id);
    setInput("");
    const net=window.__MTG_V7__?.netSync;
    if(net){
      try{net.appendEvent("chat",{sender:playerName,avatar,text,ts:msg.ts,id:msg.id});}catch(e){}
    }
  };

  const REACTIONS=["👍","👎","⚡","🔮","🃏","🐉","💀","😂","🤔","😤","🎲","✨"];

  // v7.5: log display = remote-attributed entries only (local entries are
  // also broadcast via appendEvent("action") so they come back through the
  // same stream with their alias tag). Local entries get prefixed with the
  // player's own name so every line always shows WHO did the action.
  const combinedLog = useMemo(()=>{
    const local = Array.isArray(log) ? log : [];
    const localTagged = local.map(e=>{
      if(typeof e !== "string") return e;
      if(e.startsWith(`${playerName}:`)) return e;
      return `${playerName}: ${e}`;
    });
    return [...localTagged, ...remoteLog].slice(0, 120);
  },[log,remoteLog,playerName]);

  return(
    <div style={{position:"fixed",top:50,left:8,zIndex:9994}}>
      {/* Toggle buttons */}
      <div style={{display:"flex",gap:3}}>
        <button onClick={onToggle}
          style={{...btn(`${T.panel}f2`,T.accent,{
            border:`1px solid ${T.accent}40`,borderRadius:isOpen?"8px 8px 0 0":"8px",
            padding:"6px 10px",fontSize:10,fontFamily:"Cinzel, serif",
            display:"flex",alignItems:"center",justifyContent:"space-between"}),
          }}
          onMouseOver={hov} onMouseOut={uhov}>
          <span>💬 Chat</span>
          <span style={{fontSize:8,opacity:.6}}>{isOpen?"▼":"▲"}</span>
        </button>
        <button onClick={onToggleLog}
          style={{...btn(showLog?`${T.accent}20`:`${T.panel}f2`,showLog?T.accent:"#6a7a8a",{
            border:`1px solid ${showLog?"rgba(200,168,112,.3)":"#1e3a5f20"}`,borderRadius:showLog?"8px 8px 0 0":"8px",
            padding:"6px 10px",fontSize:10,fontFamily:"Cinzel, serif"}),
          }}
          onMouseOver={hov} onMouseOut={uhov}>📜</button>
      </div>
      {isOpen&&(
        <div style={{background:`${T.panel}f7`,border:"1px solid rgba(200,168,112,.15)",
          borderTop:"none",borderRadius:"0 0 8px 8px",width:230,
          boxShadow:"0 8px 32px rgba(0,0,0,.8)"}}>
          {/* Messages */}
          <div style={{height:180,overflowY:"auto",padding:"8px 8px 4px",display:"flex",flexDirection:"column",gap:4}}>
            {messages.map(m=>(
              <div key={m.id} className="slide-up" style={{
                padding:m.system?"4px 0":"4px 7px",
                borderRadius:5,
                background:m.system?"transparent":`${T.panel}99`,
                border:m.system?"none":`1px solid ${T.border}20`}}>
                {!m.system&&<div style={{fontSize:8,color:T.accent,fontFamily:"Cinzel, serif",marginBottom:2}}>
                  {m.avatar} {m.sender}
                </div>}
                <div style={{fontSize:11,color:m.system?"#3a5a7a":T.text,fontFamily:"Crimson Text, serif",lineHeight:1.4,
                  fontStyle:m.system?"italic":"normal"}}>{m.text}</div>
              </div>
            ))}
            <div ref={bottomRef}/>
          </div>
          {/* Reactions */}
          <div style={{display:"flex",flexWrap:"wrap",gap:2,padding:"4px 8px",borderTop:`1px solid ${T.border}20`}}>
            {REACTIONS.map(r=>(
              <button key={r} onClick={()=>{
                const msg={id:uid(),sender:playerName,avatar,text:r,ts:Date.now()};
                setMessages(m=>[...m,msg]);
                // v2 fix (bug #2): reactions also broadcast.
                const net=window.__MTG_V7__?.netSync;
                if(net){try{net.appendEvent("chat",msg);}catch(e){}}
              }} style={{fontSize:14,background:"transparent",border:"none",cursor:"pointer",
                padding:"1px 2px",borderRadius:3,transition:"transform .1s"}}
                onMouseOver={e=>e.currentTarget.style.transform="scale(1.3)"}
                onMouseOut={e=>e.currentTarget.style.transform="scale(1)"}>
                {r}
              </button>
            ))}
          </div>
          {/* Input */}
          <div style={{display:"flex",gap:4,padding:"6px 8px",borderTop:`1px solid ${T.border}20`}}>
            <input value={input} onChange={e=>setInput(e.target.value)}
              onKeyDown={e=>e.key==="Enter"&&send()}
              placeholder="Say something…"
              className="mtg-chat-input"
              style={{...iS,flex:1,marginTop:0,fontSize:10,padding:"4px 7px"}}
              onFocus={e=>e.target.style.borderColor=T.accent}
              onBlur={e=>e.target.style.borderColor=T.border}/>
            <button onClick={send}
              style={{...btn(`${T.accent}1a`,T.accent,{padding:"4px 8px",border:`1px solid ${T.accent}40`,fontSize:13})}}
              onMouseOver={hov} onMouseOut={uhov}>↑</button>
          </div>
        </div>
      )}
      {/* Log panel — always below chat toggle */}
      {showLog&&(
        <div style={{
          background:`linear-gradient(160deg,${T.panel}f5,${T.bg}f8)`,
          border:`1px solid ${T.border}20`,borderTop:"none",
          borderRadius:"0 0 8px 8px",padding:"6px 10px",
          maxHeight:150,overflowY:"auto"}}>
          <div style={{fontSize:7,color:T.accent,fontFamily:"Cinzel,serif",letterSpacing:".12em",marginBottom:4}}>📜 GAME LOG</div>
          {(!combinedLog||combinedLog.length===0)&&<div style={{fontSize:8,color:"#2a3a5a",fontStyle:"italic"}}>No events yet</div>}
          {(combinedLog||[]).map((e,i)=>(
            <div key={i} style={{fontSize:8,color:i===0?T.accent:"#3a5a7a",padding:"1px 0",borderBottom:"1px solid #0d1f3c15",lineHeight:1.4}}>{e}</div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── RevealHandModal ─────────────────────────────────────────────── */
function RevealHandModal({hand,playerName,onClose}){
  return(
    <div className="fade-in" style={{position:"fixed",inset:0,background:"rgba(2,4,10,.88)",
      display:"flex",alignItems:"center",justifyContent:"center",zIndex:10000,backdropFilter:"blur(4px)"}}>
      <div className="slide-in" style={{
        background:`linear-gradient(160deg,${T.panel},${T.bg})`,
        border:`1px solid ${T.accent}50`,borderRadius:12,padding:22,
        maxWidth:560,boxShadow:"0 24px 80px rgba(0,0,0,.95)",position:"relative"}}>
        <div style={{position:"absolute",top:0,left:0,right:0,height:2,background:"linear-gradient(90deg,transparent,#c8a870,transparent)"}}/>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
          <h3 style={{color:T.accent,fontFamily:"Cinzel Decorative, serif",fontSize:13,margin:0}}>👁 {playerName}'s Hand</h3>
          <button onClick={onClose} style={{...btn("transparent","#6a7a8a",{fontSize:16,border:"none"})}} onMouseOver={hov} onMouseOut={uhov}>✕</button>
        </div>
        {hand.length===0?(
          <div style={{color:"#3a5a7a",fontFamily:"Cinzel, serif",fontSize:11,textAlign:"center",padding:20}}>Empty hand</div>
        ):(
          <div style={{display:"flex",flexWrap:"wrap",gap:6,justifyContent:"center",maxHeight:"70vh",overflowY:"auto"}}>
            {hand.map(card=>(
              <div key={card.iid}>
                <CardImg card={card} size="md" noHover/>
                <div style={{fontSize:8,color:"#8a99b0",textAlign:"center",marginTop:3,maxWidth:72,
                  overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{card.name}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── CardImg ─────────────────────────────────────────────────────── */
function CardImg({card,tapped,faceDown,selected,size="md",onClick,onCtx,onHover,onHoverEnd,onMouseDown,onCounterClick,style={},noHover}){
  const W=size==="sm"?50:size==="xs"?36:size==="lg"?100:CW;
  const H=Math.round(W*1.4);
  const img=faceDown?(window._deckSleeve||CARD_BACK):getImg(card);
  const hasCtr=card?.counters&&Object.values(card.counters).some(v=>v!==0);
  const [hover,setHover]=useState(false);
  const [flipping,setFlipping]=useState(false);

  // DFC: card is double-faced if it has isDoubleFaced flag, or faces array, or altImageUri
  const isDFC=isDFCCard(card);
  const currentFaceName=card?.altFace?(card?.faces?.[1]?.name||card?.name):(card?.faces?.[0]?.name||card?.name);

  const handleFlip=(e)=>{
    e.stopPropagation();e.preventDefault();
    setFlipping(true);
    setTimeout(()=>setFlipping(false),400);
    // Dispatch flip to parent via onCtx path won't work — use a custom event
    window.dispatchEvent(new CustomEvent("mtg-flip-card",{detail:{iid:card.iid}}));
  };

  return(
    <div onClick={onClick} onContextMenu={onCtx} onMouseDown={onMouseDown}
      onMouseEnter={()=>{if(!noHover)setHover(true);onHover&&onHover(card);}}
      onMouseLeave={()=>{setHover(false);onHoverEnd&&onHoverEnd();}}
      style={{width:W,height:H,flexShrink:0,cursor:"pointer",position:"relative",
        transform:tapped?"rotate(90deg) scale(1)":card?.inverted?"rotate(180deg)":hover&&!noHover?"scale(1.12)":"scale(1)",
        transition:"transform .15s cubic-bezier(0.34,1.4,0.64,1)",
        margin:tapped?`0 ${Math.round(H*.12)}px ${Math.round((H-W)*.5)}px`:"0",
        zIndex:selected?20:hover&&!noHover?15:1,...style}}>

      {/* 3D flip wrapper */}
      <div style={{
        width:"100%",height:"100%",
        perspective:"600px",
      }}>
        <div style={{
          width:"100%",height:"100%",
          transformStyle:"preserve-3d",
          transition:"transform .35s cubic-bezier(0.4,0,0.2,1)",
          transform:flipping?"rotateY(90deg)":"rotateY(0deg)",
        }}>
          <div style={{width:"100%",height:"100%",borderRadius:6,overflow:"hidden",
            border:selected?"2px solid #c8a870":card?.isClone?"2px solid #818cf8":card?.isToken?"2px solid #a855f7":isDFC?"1px solid #34d39980":"1px solid #2a3a5a",
            boxShadow:selected
              ?"0 0 0 1px #c8a870,0 0 20px #c8a87080,0 0 40px #c8a87030,0 8px 16px rgba(0,0,0,.8)"
              :hover&&!noHover
                ?"0 0 0 1px #4a6a8a40,0 8px 20px rgba(0,0,0,.7),0 0 12px rgba(200,168,112,.1)"
                :"0 3px 8px rgba(0,0,0,.7)",
            transition:"box-shadow .18s,border-color .18s",
            animation:selected?"glow 2.5s ease-in-out infinite":undefined}}>
            {img?(
              <img src={img} alt={card?.name} loading="lazy"
                style={{width:"100%",height:"100%",objectFit:"cover",display:"block",
                  filter:faceDown?"blur(0px) brightness(.7)":tapped?"brightness(.85)":"none",
                  transition:"filter .2s"}}/>
            ):(
              <div style={{width:"100%",height:"100%",
                background:"linear-gradient(135deg,#0a1628 0%,#0d1f3c 50%,#0a1628 100%)",
                display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:4,gap:3}}>
                <div style={{fontSize:6,color:T.accent,textAlign:"center",fontFamily:"Cinzel, serif",lineHeight:1.3}}>{card?.name}</div>
                {card?.power&&<div style={{fontSize:8,color:T.text,fontWeight:"bold",fontFamily:"Cinzel, serif"}}>{card.power}/{card.toughness}</div>}
                {card?.manaCost&&<ManaCost cost={card.manaCost||card.mana_cost}/>}
              </div>
            )}
            {/* Golden shimmer on hover */}
            {hover&&!noHover&&!tapped&&(
              <div style={{position:"absolute",inset:0,background:"linear-gradient(135deg,rgba(200,168,112,.08) 0%,transparent 50%,rgba(200,168,112,.04) 100%)",pointerEvents:"none"}}/>
            )}
          </div>
        </div>
      </div>

      {/* DFC flip button — always visible on DFC cards when not tiny */}
      {isDFC&&!faceDown&&size!=="xs"&&card?.zone==="battlefield"&&(
        <button
          onClick={handleFlip}
          title={`Flip: ${currentFaceName}`}
          style={{
            position:"absolute",bottom:size==="sm"?1:3,right:size==="sm"?1:3,
            background:"rgba(52,211,153,.85)",border:"none",
            borderRadius:"50%",width:size==="sm"?14:18,height:size==="sm"?14:18,
            display:"flex",alignItems:"center",justifyContent:"center",
            cursor:"pointer",zIndex:30,fontSize:size==="sm"?7:9,
            color:"#050a12",fontWeight:700,
            boxShadow:"0 0 6px rgba(52,211,153,.6)",
            pointerEvents:"all",
            transition:"transform .15s,opacity .15s",
            opacity:hover||!noHover?1:0.7,
          }}
          onMouseOver={e=>{e.currentTarget.style.transform="scale(1.2)";e.stopPropagation();}}
          onMouseOut={e=>{e.currentTarget.style.transform="scale(1)";}}
        >↕</button>
      )}

      {card?.isClone&&(
        <div style={{position:"absolute",top:2,right:2,fontSize:8,background:"rgba(129,140,248,.85)",
          color:"#fff",padding:"0 3px",borderRadius:2,fontFamily:"Cinzel,serif",letterSpacing:".05em",
          boxShadow:"0 0 6px #818cf870",pointerEvents:"none"}}>🪞</div>
      )}
      {card?.isCommander&&card?.zone==="battlefield"&&(
        <div style={{position:"absolute",top:2,left:2,fontSize:9,background:"rgba(200,168,112,.9)",
          color:"#050a12",padding:"0 3px",borderRadius:2,fontFamily:"Cinzel,serif",fontWeight:700,
          boxShadow:"0 0 6px rgba(200,168,112,.7)",pointerEvents:"none"}}>⚔</div>
      )}
      {card?.isCopy&&card?.copyImageUri&&(
        <div style={{position:"absolute",inset:0,borderRadius:6,overflow:"hidden",pointerEvents:"none"}}>
          <img src={card.copyImageUri} alt="" style={{width:"100%",height:"100%",objectFit:"cover",opacity:.55,display:"block"}}/>
          <div style={{position:"absolute",top:2,left:2,fontSize:8,background:"rgba(96,165,250,.85)",
            color:"#fff",padding:"0 3px",borderRadius:2,fontFamily:"Cinzel,serif",
            boxShadow:"0 0 6px #60a5fa70"}}>⧉</div>
        </div>
      )}
      {card?.targeted&&(
        <div style={{position:"absolute",inset:0,borderRadius:6,pointerEvents:"none",
          border:"2px solid #ef4444",boxShadow:"0 0 12px #ef444490, inset 0 0 8px #ef444440",
          animation:"glowRed 1s ease-in-out infinite"}}/>
      )}
      {hasCtr&&(
        <div style={{position:"absolute",bottom:-2,left:0,right:0,display:"flex",gap:2,flexWrap:"wrap",justifyContent:"center"}}>
          {Object.entries(card.counters).filter(([,v])=>v!==0).map(([k,v])=>{
            const ct=COUNTER_TYPES.find(c=>c.key===k)||{color:"#fbbf24"};
            return(
              <span key={k}
                onClick={e=>{e.stopPropagation();onCounterClick&&onCounterClick(e,k,v);}}
                onContextMenu={e=>{e.stopPropagation();e.preventDefault();onCounterClick&&onCounterClick(e,k,v);}}
                style={{
                  background:"rgba(5,10,18,.95)",fontSize:6,padding:"1px 3px",borderRadius:2,
                  color:ct.color,
                  border:`1px solid ${ct.color}60`,
                  boxShadow:`0 0 4px ${ct.color}50`,
                  animation:"counterBadge .3s ease",
                  cursor:onCounterClick?"pointer":"default",
                  zIndex:50,pointerEvents:"all",
              }}>{k}:{v>0?`+${v}`:v}</span>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ─── CardPreview ─────────────────────────────────────────────────── */
function CardPreview({card}){
  if(!card)return null;
  const img=getImg(card);
  // For DFC, show per-face data when flipped
  const name=card._displayName||card.name;
  const typeLine=card._displayType||card.typeLine||card.type_line;
  const oracleText=card._displayOracle||card.oracleText||card.oracle_text;
  const power=card._displayPower!==undefined?card._displayPower:card.power;
  const toughness=card._displayToughness!==undefined?card._displayToughness:card.toughness;
  const isDFC=isDFCCard(card);
  return(
    <div className="fade-in" style={{position:"fixed",left:14,bottom:HAND_H+14,zIndex:10000,pointerEvents:"none"}}>
      {img?(
        <div style={{position:"relative"}}>
          <img src={img} alt={name} style={{
            width:190,borderRadius:12,
            boxShadow:"0 12px 48px rgba(0,0,0,.95),0 0 30px rgba(200,168,112,.15),0 0 0 1px rgba(200,168,112,.2)"
          }}/>

          <div style={{position:"absolute",bottom:0,left:0,right:0,height:60,
            background:"linear-gradient(transparent,rgba(5,10,18,.9))",borderRadius:"0 0 12px 12px"}}/>
          {/* Counter badges on preview */}
          {card.counters&&Object.entries(card.counters).filter(([,v])=>v!==0).length>0&&(
            <div style={{position:"absolute",bottom:6,left:6,right:6,display:"flex",flexWrap:"wrap",gap:3,justifyContent:"center"}}>
              {Object.entries(card.counters).filter(([,v])=>v!==0).map(([k,v])=>{
                const ct=COUNTER_TYPES.find(c=>c.key===k)||{color:"#fbbf24"};
                return(
                  <span key={k} style={{
                    background:"rgba(5,10,18,.92)",fontSize:10,padding:"2px 6px",borderRadius:4,
                    color:ct.color,border:`1px solid ${ct.color}60`,
                    fontFamily:"Cinzel,serif",fontWeight:700,
                    boxShadow:`0 0 6px ${ct.color}50`,
                  }}>{k} {v>0?`+${v}`:v}</span>
                );
              })}
            </div>
          )}
        </div>
      ):(
        <div style={{width:190,background:"linear-gradient(180deg,#0d1f3c,#080f1c)",
          border:"1px solid #c8a870",borderRadius:12,padding:14,
          boxShadow:"0 12px 48px rgba(0,0,0,.95),0 0 30px rgba(200,168,112,.15)"}}>
          <div style={{fontSize:13,color:T.accent,fontFamily:"Cinzel, serif",marginBottom:5}}>{name}</div>
          <div style={{fontSize:10,color:"#8a99b0",marginBottom:6}}>{typeLine}</div>
          {oracleText&&
            <div style={{fontSize:11,color:T.text,fontStyle:"italic",lineHeight:1.6}}>{oracleText}</div>}
          {power&&<div style={{fontSize:12,color:T.accent,marginTop:8,textAlign:"right",fontFamily:"Cinzel, serif"}}>{power}/{toughness}</div>}
        </div>
      )}
    </div>
  );
}

/* ─── ContextMenu ─────────────────────────────────────────────────── */
function ContextMenu({x,y,items,onClose}){
  const ref=useRef(null);
  useEffect(()=>{const h=e=>{if(!ref.current?.contains(e.target))onClose();};document.addEventListener("mousedown",h);return()=>document.removeEventListener("mousedown",h);},[onClose]);
  const [menuH,setMenuH]=useState(300);
  useEffect(()=>{if(ref.current)setMenuH(ref.current.offsetHeight);});
  const top=Math.max(8,Math.min(y-menuH/2,window.innerHeight-menuH-8));
  return(
    <div ref={ref} className="slide-in mtg-context-menu" style={{
      position:"fixed",
      left:Math.min(x+8,window.innerWidth-218),
      top,
      background:`linear-gradient(160deg,${T.panel},${T.bg})`,
      border:"1px solid #2a3a5a",borderRadius:8,zIndex:9999,
      minWidth:205,boxShadow:"0 16px 48px rgba(0,0,0,.95),0 0 0 1px rgba(200,168,112,.08)",
      overflow:"hidden",backdropFilter:"blur(4px)"}}>
      <div style={{position:"absolute",top:0,left:0,right:0,height:1,
        background:"linear-gradient(90deg,transparent,#c8a87040,transparent)"}}/>
      {items.map((item,i)=>
        item==="---"?(
          <div key={i} style={{borderTop:`1px solid ${T.border}20`,margin:"3px 0",
            borderImage:"linear-gradient(90deg,transparent,#c8a87030,transparent) 1"}}/>
        ):item.header?(
          <div key={i} style={{padding:"5px 12px 3px",fontSize:8,color:"#c8a87090",
            letterSpacing:".15em",fontFamily:"Cinzel, serif",textTransform:"uppercase"}}>{item.header}</div>
        ):(
          <div key={i} onClick={()=>{item.action();onClose();}}
            style={{padding:"7px 13px",cursor:"pointer",fontSize:12,
              color:item.color||T.text,fontFamily:"Crimson Text, serif",
              display:"flex",alignItems:"center",gap:7,transition:"background .1s,padding-left .1s"}}
            onMouseEnter={e=>{e.currentTarget.style.background="#1a2a4a";e.currentTarget.style.paddingLeft="16px";}}
            onMouseLeave={e=>{e.currentTarget.style.background="transparent";e.currentTarget.style.paddingLeft="13px";}}>
            <span style={{opacity:.7,minWidth:14,fontSize:13}}>{item.icon||"·"}</span>
            <span>{item.label}</span>
          </div>
        )
      )}
      <div style={{position:"absolute",bottom:0,left:0,right:0,height:1,
        background:"linear-gradient(90deg,transparent,#c8a87020,transparent)"}}/>
    </div>
  );
}

/* ─── ZonePanel ───────────────────────────────────────────────────── */
function ZonePanel({title,color,icon,cards,zone,onCtx,onDragStart,onHover,isOpen,onToggle}){
  const [search,setSearch]=useState("");
  const filtered=cards.filter(c=>c.name.toLowerCase().includes(search.toLowerCase()));
  return(
    <div className="drop-target mtg-zone" data-zone={zone}
      style={{background:`linear-gradient(160deg,${T.panel},${T.bg})`,
        border:`1px solid ${isOpen?color+"30":"#1e3a5f20"}`,borderRadius:7,padding:"8px 10px",
        transition:"border-color .2s"}}>
      <div style={{color,fontFamily:"Cinzel, serif",fontSize:9,marginBottom:4,
        display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer",
        letterSpacing:".12em"}} onClick={onToggle}>
        <span style={{display:"flex",alignItems:"center",gap:5}}>
          <span>{icon}</span>
          <span>{title}</span>
          <span style={{background:`${color}20`,color,fontSize:8,padding:"1px 5px",
            borderRadius:10,border:`1px solid ${color}30`}}>{cards.length}</span>
        </span>
        <span style={{opacity:.5,fontSize:8}}>{isOpen?"▲":"▼"}</span>
      </div>
      {isOpen&&(
        <>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Filter…"
            style={{...iS,fontSize:9,marginTop:0,marginBottom:5,padding:"3px 7px"}}
            onFocus={e=>e.target.style.borderColor=color} onBlur={e=>e.target.style.borderColor=T.border}/>
          <div style={{display:"flex",flexWrap:"wrap",gap:3,maxHeight:160,overflowY:"auto"}}>
            {filtered.length===0&&<div style={{fontSize:9,color:T.border,width:"100%",textAlign:"center",padding:10}}>empty</div>}
            {filtered.map(card=>(
              <div key={card.iid} title={card.name}
                onContextMenu={e=>onCtx&&onCtx(e,card,zone)}
                onMouseEnter={()=>onHover&&onHover(card)}
                onMouseDown={e=>onDragStart&&onDragStart(e,card,zone)}
                style={{cursor:"grab",transition:"transform .12s"}}
                onMouseOver={e=>e.currentTarget.style.transform="translateY(-2px)"}
                onMouseOut={e=>e.currentTarget.style.transform="none"}>
                <CardImg card={card} size="xs" faceDown={false} tapped={false} noHover/>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ─── FloatingCard ────────────────────────────────────────────────── */
function FloatingCard({drag}){
  if(!drag)return null;
  const cards=drag.allCards&&drag.allCards.length>1?drag.allCards:[drag.card];
  return(
    <div style={{position:"fixed",left:drag.x-CW/2,top:drag.y-CH/2,zIndex:99999,pointerEvents:"none"}}>
      {cards.map((card,i)=>(
        <div key={card.iid} style={{
          position:i===0?"relative":"absolute",
          top:i===0?0:i*-4,left:i===0?0:i*6,
          zIndex:cards.length-i,
          opacity:i===0?0.95:0.75-i*0.1,
          transform:`rotate(${(i-(cards.length-1)/2)*8}deg)`,
          filter:"drop-shadow(0 0 12px rgba(200,168,112,.4)) drop-shadow(0 8px 16px rgba(0,0,0,.8))",
          animation:"float 1s ease-in-out infinite",
        }}>
          <CardImg card={card} size="md" faceDown={false} tapped={false} noHover/>
        </div>
      ))}
    </div>
  );
}

/* ─── SearchCardRow / DeckCardRow ─────────────────────────────────── */
function SearchCardRow({card,count,onAdd,onHover,onSetCommander}){
  const img=getImg(card);
  return(
    <div onMouseEnter={()=>onHover(card)}
      style={{display:"flex",alignItems:"center",gap:7,padding:"5px 8px",borderRadius:5,marginBottom:1,
        transition:"background .1s"}}
      onMouseOver={e=>e.currentTarget.style.background="#0d1f3c80"}
      onMouseOut={e=>e.currentTarget.style.background="transparent"}>
      {img?<img src={img} alt="" style={{width:28,height:39,borderRadius:3,objectFit:"cover",flexShrink:0,
        boxShadow:"0 2px 6px rgba(0,0,0,.6)"}} loading="lazy"/>
        :<div style={{width:28,height:39,borderRadius:3,background:T.panel,flexShrink:0,
          display:"flex",alignItems:"center",justifyContent:"center",fontSize:14}}>🃏</div>}
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontSize:12,color:T.text,overflow:"hidden",textOverflow:"ellipsis",
          whiteSpace:"nowrap",fontFamily:"Cinzel, serif"}}>{card.name}</div>
        <div style={{fontSize:9,color:"#4a6a8a",marginBottom:2}}>{card.type_line||card.typeLine}</div>
        <ManaCost cost={card.mana_cost||card.manaCost}/>
      </div>
      {count>0&&<span style={{fontSize:9,color:T.accent,minWidth:16,fontFamily:"Cinzel, serif",
        background:`${T.accent}1a`,padding:"1px 4px",borderRadius:3}}>{count}×</span>}
      {onSetCommander&&(
        <button onClick={()=>onSetCommander(card)} title="Set/Add as Commander"

          style={{...btn("rgba(52,211,153,.08)","#34d399",{padding:"2px 6px",fontSize:10,border:"1px solid rgba(52,211,153,.2)"})}
          } onMouseOver={hov} onMouseOut={uhov}>⚔</button>
      )}
      <button onClick={onAdd}
        style={{...btn(`${T.accent}1a`,T.accent,{padding:"2px 8px",fontSize:14,border:`1px solid ${T.accent}40`})}
        } onMouseOver={hov} onMouseOut={uhov}>+</button>
    </div>
  );
}

function DeckCardRow({card,onAdd,onRemove,onSelect,isSelected,onHover,fromZone,onDragStart,onCtxMenu}){
  const clr=card.typeLine?.includes("Land")?"#4ade80":card.typeLine?.includes("Creature")?"#60a5fa":card.typeLine?.includes("Instant")?"#f97316":card.typeLine?.includes("Sorcery")?"#fb7185":"#8b5cf6";
  return(
    <div onClick={()=>onSelect&&onSelect(card)}
      draggable
      onContextMenu={e=>{e.preventDefault();onCtxMenu&&onCtxMenu(e,card,fromZone);}}
      onDragStart={e=>{e.dataTransfer.effectAllowed="move";onDragStart&&onDragStart(card,fromZone);}}
      style={{display:"flex",alignItems:"center",gap:5,padding:"4px 8px",borderRadius:4,
        marginBottom:1,background:isSelected?`${T.accent}12`:`${T.bg}99`,
        borderLeft:`2px solid ${isSelected?T.accent:clr}`,
        outline:isSelected?`1px solid ${T.accent}40`:"none",
        transition:"background .1s,transform .1s",cursor:"grab"}}
      onMouseOver={e=>{if(!isSelected)e.currentTarget.style.background=`${T.panel}cc`;onHover&&onHover(card);}}
      onMouseOut={e=>{if(!isSelected)e.currentTarget.style.background=`${T.bg}99`;}}>
      {card.imageUri&&<img src={card.imageUri} alt="" style={{width:22,height:31,borderRadius:2,objectFit:"cover",flexShrink:0,border:`1px solid ${T.border}30`}} loading="lazy"/>}
      <span style={{fontSize:10,color:isSelected?T.accent:clr,minWidth:20,fontFamily:"Cinzel, serif"}}>{card.quantity}×</span>
      <span style={{flex:1,fontSize:10,color:isSelected?T.accent:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontWeight:isSelected?"600":"normal"}}>{card.name}</span>
      <ManaCost cost={card.manaCost}/>
      <button onClick={e=>{e.stopPropagation();onRemove();}} style={{...btn("transparent","#f87171",{padding:"1px 5px",fontSize:12,border:"none"})}}>−</button>
      <button onClick={e=>{e.stopPropagation();onAdd();}} style={{...btn("transparent","#4ade80",{padding:"1px 5px",fontSize:12,border:"none"})}}>+</button>
    </div>
  );
}

/* ─── DiceRoller ──────────────────────────────────────────────────── */
function DiceRoller(){
  const [r,setR]=useState(null);
  const [rolling,setRolling]=useState(false);
  const roll=n=>{
    setRolling(true);
    setTimeout(()=>{setR({n,v:Math.ceil(Math.random()*n)});setRolling(false);},200);
  };
  const coin=()=>{
    setRolling(true);
    setTimeout(()=>{setR({n:2,v:Math.random()<.5?"H":"T"});setRolling(false);},200);
  };
  const isCrit=r&&r.n!==2&&r.v===r.n;
  const isFail=r&&r.n!==2&&r.v===1;
  return(
    <div style={{display:"flex",gap:3,alignItems:"center"}}>
      {r&&(
        <span style={{
          fontSize:11,minWidth:48,textAlign:"right",fontFamily:"Cinzel Decorative, serif",
          color:isCrit?"#fbbf24":isFail?"#f87171":T.accent,
          textShadow:isCrit?"0 0 12px #fbbf24":isFail?"0 0 12px #f87171":"none",
          animation:rolling?"pulse .2s ease":"slideIn .2s ease"
        }}>
          {r.n===2?r.v:`d${r.n}:${r.v}`}{isCrit?" ✨":isFail?" 💀":""}
        </span>
      )}
      {[6,20].map(n=>(
        <button key={n} onClick={()=>roll(n)}
          style={{...btn(`${T.bg}cc`,"#8a99b0",{border:`1px solid ${T.border}`})}
          } onMouseOver={hov} onMouseOut={uhov}>d{n}</button>
      ))}
      <button onClick={coin} style={{...btn(`${T.bg}cc`,"#fbbf24",{border:"1px solid #fbbf2430",fontSize:13})}} onMouseOver={hov} onMouseOut={uhov}>🪙</button>
    </div>
  );
}

/* ─── TokenSearch ──────────────────────────────────────────────────── */
function TokenSearch({onCreate,onClose}){
  const [tab,setTab]=useState("tokens"); // "tokens"|"cards"
  const [query,setQuery]=useState("");
  const [results,setResults]=useState([]);
  const [loading,setLoading]=useState(false);
  const [typeFilter,setTypeFilter]=useState("All");
  const [hovered,setHovered]=useState(null);
  const [page,setPage]=useState(1);
  const [hasMore,setHasMore]=useState(false);
  const [nextUrl,setNextUrl]=useState(null);
  const tmr=useRef(null);

  const TYPE_FILTERS=["All","Angel","Artifact","Beast","Bird","Cat","Demon","Dragon","Elemental","Elf","Faerie","Goblin","Golem","Human","Insect","Knight","Merfolk","Rogue","Soldier","Spirit","Treasure","Vampire","Warrior","Wolf","Wizard","Zombie","Other"];

  const doSearch=async(url)=>{
    setLoading(true);
    try{
      const r=await fetch(url);
      if(r.ok){
        const d=await r.json();
        setResults(prev=>url.includes("page=1")||!url.includes("page=")?d.data||[]:[...prev,...(d.data||[])]);
        setHasMore(!!d.has_more);
        setNextUrl(d.next_page||null);
      } else { setResults([]); setHasMore(false); }
    }catch{ setResults([]); setHasMore(false); }
    setLoading(false);
  };

  useEffect(()=>{
    clearTimeout(tmr.current);
    setPage(1);
    setResults([]);
    const q=query.trim();
    tmr.current=setTimeout(async()=>{
      if(tab==="tokens"){
        // unique=prints to get ALL variations including Secret Lair
        let qStr=`t:token`;
        if(typeFilter!=="All") qStr+=` t:${typeFilter.toLowerCase()}`;
        if(q) qStr+=` ${q}`;
        doSearch(`https://api.scryfall.com/cards/search?q=${encodeURIComponent(qStr)}&unique=prints&order=name&page=1`);
      } else {
        // Any card search
        if(!q||q.length<2){setResults([]);setLoading(false);return;}
        doSearch(`https://api.scryfall.com/cards/search?q=${encodeURIComponent(q)}&unique=prints&order=name&page=1`);
      }
    },350);
  },[query,typeFilter,tab]);

  const loadMore=()=>{ if(nextUrl) doSearch(nextUrl); };

  const insertCard=(card,asToken)=>{
    const img=card.image_uris?.normal||card.card_faces?.[0]?.image_uris?.normal||null;
    onCreate({
      name:card.name,imageUri:img,
      typeLine:card.type_line||"",oracleText:card.oracle_text||card.card_faces?.[0]?.oracle_text||"",
      power:card.power||card.card_faces?.[0]?.power||"*",
      toughness:card.toughness||card.card_faces?.[0]?.toughness||"*",
      colors:card.colors||card.card_faces?.[0]?.colors||[],
      manaCost:card.mana_cost||card.card_faces?.[0]?.mana_cost||"",
      isToken:asToken,
      scryfallId:card.id,
    });
    onClose();
  };

  return(
    <div className="fade-in" style={{position:"fixed",inset:0,background:"rgba(2,4,10,.94)",
      display:"flex",flexDirection:"column",zIndex:20000,backdropFilter:"blur(6px)"}}>
      {/* Header */}
      <div style={{display:"flex",alignItems:"center",gap:8,padding:"10px 18px",
        background:`linear-gradient(180deg,${T.panel},transparent)`,borderBottom:`1px solid ${T.accent}30`,flexShrink:0}}>
        {/* Tab switcher */}
        <button onClick={()=>{setTab("tokens");setQuery("");setResults([]);}}
          style={{...btn(tab==="tokens"?`${T.accent}20`:"transparent",tab==="tokens"?T.accent:"#4a6a8a",
            {border:`1px solid ${tab==="tokens"?"rgba(200,168,112,.4)":"#1e3a5f20"}`,fontSize:11,padding:"4px 12px"})}}
          onMouseOver={hov} onMouseOut={uhov}>✦ Tokens</button>
        <button onClick={()=>{setTab("cards");setQuery("");setResults([]);}}
          style={{...btn(tab==="cards"?`${T.accent}20`:"transparent",tab==="cards"?T.accent:"#4a6a8a",
            {border:`1px solid ${tab==="cards"?"rgba(200,168,112,.4)":"#1e3a5f20"}`,fontSize:11,padding:"4px 12px"})}}
          onMouseOver={hov} onMouseOut={uhov}>🔍 Any Card</button>
        <input value={query} onChange={e=>setQuery(e.target.value)}
          placeholder={tab==="tokens"?"Search tokens (all printings + Secret Lair)…":"Search any MTG card…"}
          style={{...{display:"block",padding:"5px 10px",background:"rgba(5,10,18,.8)",border:`1px solid ${T.border}`,
            color:T.text,borderRadius:5,fontSize:11,fontFamily:"Crimson Text,serif"},flex:1,maxWidth:380}}
          onFocus={e=>e.target.style.borderColor=T.accent} onBlur={e=>e.target.style.borderColor=T.border}
          autoFocus/>
        <div style={{flex:1}}/>
        <span style={{fontSize:9,color:"#3a5a7a",fontFamily:"Cinzel,serif"}}>
          {results.length>0?`${results.length}${hasMore?"+":""} results`:""}
        </span>
        <button onClick={onClose} style={{...btn("transparent","#6a7a8a",{fontSize:16,border:"none",padding:"2px 8px"})}} onMouseOver={hov} onMouseOut={uhov}>✕</button>
      </div>
      {/* Token type filters */}
      {tab==="tokens"&&(
        <div style={{display:"flex",gap:3,padding:"5px 16px",flexShrink:0,flexWrap:"wrap",borderBottom:`1px solid ${T.accent}15`}}>
          {TYPE_FILTERS.map(t=>(
            <button key={t} onClick={()=>setTypeFilter(t)}
              style={{...btn(typeFilter===t?`${T.accent}20`:"transparent",typeFilter===t?T.accent:"#4a6a8a",
                {fontSize:9,border:`1px solid ${typeFilter===t?"rgba(200,168,112,.3)":"#1e3a5f20"}`,padding:"2px 8px",borderRadius:3})}}
              onMouseOver={hov} onMouseOut={uhov}>{t}</button>
          ))}
        </div>
      )}
      {tab==="cards"&&(
        <div style={{padding:"6px 18px",flexShrink:0,borderBottom:`1px solid ${T.accent}15`}}>
          <span style={{fontSize:9,color:"#4a6a8a",fontFamily:"Cinzel,serif"}}>
            Shows all printings & art variants. Click to place on battlefield. Shift+click to insert as token (no death trigger).
          </span>
        </div>
      )}
      {loading&&<div style={{padding:"10px 18px",fontSize:9,color:T.accent,fontFamily:"Cinzel,serif",flexShrink:0}}>🔮 Searching Scryfall (all printings)…</div>}
      <div style={{flex:1,overflowY:"auto",padding:"10px 16px",display:"flex",flexWrap:"wrap",gap:8,alignContent:"flex-start"}}>
        {results.map((card,i)=>{
          const img=card.image_uris?.normal||card.card_faces?.[0]?.image_uris?.normal||null;
          const isTokenType=card.type_line?.toLowerCase().includes("token");
          return(
            <div key={`${card.id}-${i}`}
              onMouseEnter={()=>setHovered(card)}
              onMouseLeave={()=>setHovered(null)}
              onClick={e=>insertCard(card,isTokenType||e.shiftKey)}
              title={`${card.name}\n${card.set_name||""} (${card.set?.toUpperCase()||""})\nClick to place on BF${tab==="cards"?" · Shift+Click to insert as token":""}`}
              style={{cursor:"pointer",transition:"transform .1s",flexShrink:0,position:"relative"}}
              onMouseOver={e=>e.currentTarget.style.transform="translateY(-4px) scale(1.05)"}
              onMouseOut={e=>e.currentTarget.style.transform="none"}>
              {img?(
                <img src={img} alt={card.name}
                  style={{width:CW,height:CH,borderRadius:6,objectFit:"cover",display:"block",
                    border:`1px solid ${T.border}`,boxShadow:"0 3px 10px rgba(0,0,0,.7)"}}/>
              ):(
                <div style={{width:CW,height:CH,borderRadius:6,background:`linear-gradient(135deg,${T.panel},${T.bg})`,
                  border:`1px solid ${T.border}`,display:"flex",flexDirection:"column",alignItems:"center",
                  justifyContent:"center",padding:4,gap:3}}>
                  <div style={{fontSize:8,color:T.accent,textAlign:"center",fontFamily:"Cinzel,serif"}}>{card.name}</div>
                  {card.power&&<div style={{fontSize:10,color:T.text,fontWeight:"bold"}}>{card.power}/{card.toughness}</div>}
                </div>
              )}
              <div style={{fontSize:7,color:"#6a7a8a",textAlign:"center",marginTop:2,maxWidth:CW,overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis"}}>
                {card.name}
              </div>
              {card.set&&<div style={{fontSize:6,color:"#2a3a5a",textAlign:"center",maxWidth:CW,overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis"}}>
                {card.set.toUpperCase()}
              </div>}
            </div>
          );
        })}
        {!loading&&results.length===0&&tab==="tokens"&&(
          <div style={{color:T.border,fontFamily:"Cinzel,serif",fontSize:11,padding:20,width:"100%",textAlign:"center",fontStyle:"italic"}}>
            {query?"No tokens found — try a different search":"Type to search all token printings…"}
          </div>
        )}
        {!loading&&results.length===0&&tab==="cards"&&(
          <div style={{color:T.border,fontFamily:"Cinzel,serif",fontSize:11,padding:20,width:"100%",textAlign:"center",fontStyle:"italic"}}>
            Search any card name, type, or oracle text
          </div>
        )}
        {hasMore&&!loading&&(
          <div style={{width:"100%",display:"flex",justifyContent:"center",padding:"10px 0"}}>
            <button onClick={loadMore}
              style={{...btn(`${T.accent}1a`,T.accent,{border:`1px solid ${T.accent}40`,padding:"6px 22px",fontFamily:"Cinzel,serif"})}}
              onMouseOver={hov} onMouseOut={uhov}>Load More…</button>
          </div>
        )}
        {loading&&results.length>0&&<div style={{width:"100%",textAlign:"center",padding:10,color:"#4a6a8a",fontSize:9,fontFamily:"Cinzel,serif"}}>Loading…</div>}
      </div>
      {hovered&&<CardPreview card={hovered}/>}
    </div>
  );
}

/* ─── CustomCardCreator ───────────────────────────────────────────── */
function CustomCardCreator({onSave,onClose}){
  const [f,setF]=useState({name:"",manaCost:"",typeLine:"",oracleText:"",power:"",toughness:"",imageUri:""});
  const set=k=>e=>setF(p=>({...p,[k]:e.target.value}));
  return(
    <div className="fade-in" style={{position:"fixed",inset:0,background:"rgba(2,4,10,.92)",
      display:"flex",alignItems:"center",justifyContent:"center",zIndex:10000,backdropFilter:"blur(4px)"}}>
      <div className="slide-in" style={{
        background:"linear-gradient(160deg,#0d1f3c,#0a1628)",
        border:"1px solid #c8a87050",borderRadius:10,padding:22,width:390,
        maxHeight:"92vh",overflowY:"auto",
        boxShadow:"0 24px 80px rgba(0,0,0,.95)",position:"relative"}}>
        <RitualCircle color="#a855f7"/>
        <h3 style={{margin:"0 0 16px",color:T.accent,fontFamily:"Cinzel Decorative, serif",fontSize:14,position:"relative"}}>🪄 Forge Custom Card</h3>
        {[["Name *","name","text"],["Mana Cost","manaCost","text"],["Type Line","typeLine","text"],["Image URL","imageUri","text"]].map(([l,k])=>(
          <label key={k} style={{display:"block",marginBottom:9,position:"relative"}}>
            <span style={{fontSize:8,color:"#6a7a8a",fontFamily:"Cinzel, serif",letterSpacing:".1em",textTransform:"uppercase"}}>{l}</span>
            <input value={f[k]} onChange={set(k)} style={iS}
              onFocus={e=>{e.target.style.borderColor=T.accent;e.target.style.boxShadow="0 0 8px rgba(200,168,112,.15)";}}
              onBlur={e=>{e.target.style.borderColor=T.border;e.target.style.boxShadow="none";}}/>
          </label>
        ))}
        <label style={{display:"block",marginBottom:9,position:"relative"}}>
          <span style={{fontSize:8,color:"#6a7a8a",fontFamily:"Cinzel, serif",letterSpacing:".1em",textTransform:"uppercase"}}>Rules Text</span>
          <textarea value={f.oracleText} onChange={set("oracleText")} rows={3} style={{...iS,resize:"vertical"}}/>
        </label>
        <div style={{display:"flex",gap:8,marginBottom:16}}>
          {[["Power","power"],["Toughness","toughness"]].map(([l,k])=>(
            <label key={k} style={{flex:1}}>
              <span style={{fontSize:8,color:"#6a7a8a",fontFamily:"Cinzel, serif",letterSpacing:".1em",textTransform:"uppercase"}}>{l}</span>
              <input value={f[k]} onChange={set(k)} style={iS}/>
            </label>
          ))}
        </div>
        {f.imageUri&&<img src={f.imageUri} alt="" style={{width:"100%",borderRadius:5,marginBottom:12,maxHeight:100,objectFit:"cover",border:`1px solid ${T.border}`}} onError={e=>e.target.style.display="none"}/>}
        <div style={{display:"flex",gap:8}}>
          <button onClick={onClose} style={{...btn(`${T.panel}99`,"#8a99b0",{flex:1,border:`1px solid ${T.border}`})}} onMouseOver={hov} onMouseOut={uhov}>Cancel</button>
          <button onClick={()=>{if(f.name.trim()){onSave({id:`custom_${uid()}`,...f,isCustom:true});onClose();}}}
            style={{...btn("linear-gradient(135deg,#c8a870,#a0804a)",T.bg,{flex:2,fontFamily:"Cinzel, serif",fontWeight:700})}}
            onMouseOver={hov} onMouseOut={uhov}>✦ Forge</button>
        </div>
      </div>
    </div>
  );
}

/* ─── StackPanel ──────────────────────────────────────────────────── */
function StackPanel({stack,onResolve,onCounter,onAdd}){
  const [txt,setTxt]=useState("");
  return(
    <div style={{background:`linear-gradient(160deg,${T.panel},${T.bg})`,
      border:`1px solid ${T.border}20`,borderRadius:7,padding:"8px 10px"}}>
      <div style={{display:"flex",alignItems:"center",gap:5,marginBottom:6}}>
        <span style={{fontSize:13}}>⚡</span>
        <span style={{color:"#f97316",fontFamily:"Cinzel, serif",fontSize:9,letterSpacing:".15em"}}>STACK</span>
        {stack.length>0&&(
          <span style={{background:"rgba(249,115,22,.15)",color:"#f97316",fontSize:8,
            padding:"1px 6px",borderRadius:10,border:"1px solid rgba(249,115,22,.3)"}}>{stack.length}</span>
        )}
      </div>
      {stack.length===0&&<div style={{color:T.border,fontSize:9,textAlign:"center",padding:"6px 0",fontStyle:"italic"}}>— empty —</div>}
      {[...stack].reverse().map((item,i)=>(
        <div key={item.id} className="slide-in" style={{
          background:i===0?`${T.panel}cc`:`${T.panel}99`,
          border:`1px solid ${i===0?"#c8a87040":"#1e3a5f20"}`,borderRadius:5,
          padding:"5px 8px",marginBottom:3,animation:"stackEntry .2s ease"}}>
          <div style={{fontSize:10,color:i===0?T.text:"#6a7a8a",marginBottom:3,lineHeight:1.4}}>{item.description}</div>
          <div style={{display:"flex",gap:3}}>
            {i===stack.length-1&&(
              <button onClick={()=>onResolve(item.id)}
                style={{...btn("rgba(74,222,128,.1)","#4ade80",{fontSize:9,padding:"1px 6px",border:"1px solid rgba(74,222,128,.2)"})}}
                onMouseOver={hov} onMouseOut={uhov}>✓ Resolve</button>
            )}
            <button onClick={()=>onCounter(item.id)}
              style={{...btn("rgba(248,113,113,.08)","#f87171",{fontSize:9,padding:"1px 6px",border:"1px solid rgba(248,113,113,.2)"})}}
              onMouseOver={hov} onMouseOut={uhov}>✗ Counter</button>
          </div>
        </div>
      ))}
      <div style={{display:"flex",gap:3,marginTop:7}}>
        <input value={txt} onChange={e=>setTxt(e.target.value)} placeholder="Add to stack…"
          style={{...iS,flex:1,fontSize:9,marginTop:0,padding:"3px 6px"}}
          onFocus={e=>{e.target.style.borderColor="#f97316";e.target.style.boxShadow="0 0 6px rgba(249,115,22,.15)";}}
          onBlur={e=>{e.target.style.borderColor=T.border;e.target.style.boxShadow="none";}}
          onKeyDown={e=>{if(e.key==="Enter"&&txt.trim()){onAdd(txt);setTxt("");}}}/>
        <button onClick={()=>{if(txt.trim()){onAdd(txt);setTxt("");}}}
          style={{...btn("rgba(249,115,22,.15)","#f97316",{padding:"2px 7px",fontSize:13,border:"1px solid rgba(249,115,22,.3)"})}}
          onMouseOver={hov} onMouseOut={uhov}>+</button>
      </div>
    </div>
  );
}

/* ─── ProfileSetup ────────────────────────────────────────────────── */
function ProfileSetup({existing,onSave}){
  const [alias,setAlias]=useState(existing?.alias||"");
  const [avatar,setAvatar]=useState(existing?.avatar||"🧙");
  const [avatarImg,setAvatarImg]=useState(existing?.avatarImg||""); // custom image URL
  const [gmIdx,setGmIdx]=useState(existing?.gamematIdx||3);
  const [gmCustom,setGmCustom]=useState(existing?.gamematCustom||"");
  const [avatarTab,setAvatarTab]=useState("emoji"); // "emoji"|"art"|"url"
  const [artQuery,setArtQuery]=useState("");
  const [artResults,setArtResults]=useState([]);
  const [artLoading,setArtLoading]=useState(false);
  const [customAvatarUrl,setCustomAvatarUrl]=useState(existing?.avatarImg||"");
  const canvasRef=useRef(null);
  const artTmr=useRef(null);

  const ART_PRESETS=["jace","liliana","chandra","garruk","ajani","nissa","elspeth","teferi","sorin","nicol bolas","serra","mirri"];

  useEffect(()=>{
    clearTimeout(artTmr.current);
    if(!artQuery||avatarTab!=="art")return;
    artTmr.current=setTimeout(async()=>{
      setArtLoading(true);
      try{
        const r=await fetch(`https://api.scryfall.com/cards/search?q=${encodeURIComponent(artQuery+" is:fullart")}&unique=prints&order=name&page=1`);
        if(r.ok){const d=await r.json();setArtResults((d.data||[]).map(c=>c.image_uris?.art_crop||null).filter(Boolean).slice(0,32));}
      }catch{}
      setArtLoading(false);
    },500);
  },[artQuery,avatarTab]);

  // Animated particle background
  useEffect(()=>{
    const canvas=canvasRef.current;if(!canvas)return;
    const ctx=canvas.getContext("2d");
    canvas.width=canvas.offsetWidth;canvas.height=canvas.offsetHeight;
    const particles=Array.from({length:60},()=>({
      x:Math.random()*canvas.width,y:Math.random()*canvas.height,
      vx:(Math.random()-.5)*.3,vy:(Math.random()-.5)*.3,
      r:Math.random()*2+.5,
      color:[`rgba(200,168,112,${Math.random()*.3+.1})`,`rgba(168,85,247,${Math.random()*.2+.05})`,`rgba(59,130,246,${Math.random()*.15+.05})`][Math.floor(Math.random()*3)]
    }));
    let raf;
    const draw=()=>{
      ctx.clearRect(0,0,canvas.width,canvas.height);
      particles.forEach(p=>{
        p.x+=p.vx;p.y+=p.vy;
        if(p.x<0)p.x=canvas.width;if(p.x>canvas.width)p.x=0;
        if(p.y<0)p.y=canvas.height;if(p.y>canvas.height)p.y=0;
        ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,Math.PI*2);
        ctx.fillStyle=p.color;ctx.fill();
      });
      raf=requestAnimationFrame(draw);
    };
    draw();
    return()=>cancelAnimationFrame(raf);
  },[]);

  const currentAvatarDisplay=avatarImg?(
    <img src={avatarImg} alt="avatar" style={{width:64,height:64,borderRadius:"50%",objectFit:"cover",border:`2px solid ${T.accent}`,boxShadow:`0 0 16px ${T.accent}60`}}/>
  ):(
    <span style={{fontSize:44,filter:`drop-shadow(0 0 12px ${T.accent}80)`}}>{avatar}</span>
  );

  return(
    <div style={{height:"100vh",background:T.bg,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"Crimson Text, serif",position:"relative",overflow:"hidden"}}>
      <canvas ref={canvasRef} style={{position:"absolute",inset:0,width:"100%",height:"100%",pointerEvents:"none"}}/>
      <div style={{position:"absolute",width:"100%",height:"100%",display:"flex",alignItems:"center",justifyContent:"center",pointerEvents:"none",opacity:.3}}>
        <RitualCircle color={T.accent}/>
      </div>
      <div className="fade-in" style={{
        background:"linear-gradient(160deg,rgba(13,31,60,.97),rgba(10,22,40,.99))",
        border:`1px solid ${T.accent}40`,borderRadius:14,padding:32,width:540,maxHeight:"92vh",overflowY:"auto",
        boxShadow:"0 32px 100px rgba(0,0,0,.95),0 0 80px rgba(200,168,112,.04)",
        position:"relative",overflow:"hidden"}}>
        <div style={{position:"absolute",top:0,left:0,right:0,height:2,background:"linear-gradient(90deg,transparent,#c8a870,transparent)"}}/>

        {/* Header with avatar preview */}
        <div style={{textAlign:"center",marginBottom:24}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"center",marginBottom:10}}>
            {currentAvatarDisplay}
          </div>
          <h2 className="shimmer-text" style={{fontFamily:"Cinzel Decorative, serif",fontSize:20,letterSpacing:".06em",marginBottom:4}}>MTG Playground</h2>
          <p style={{color:"#3a5a7a",fontSize:10,letterSpacing:".1em",fontFamily:"Cinzel, serif"}}>ENTER THE ARENA</p>
        </div>

        {/* Alias */}
        <label style={{display:"block",marginBottom:18}}>
          <span style={{fontSize:9,color:"#6a7a8a",fontFamily:"Cinzel, serif",letterSpacing:".15em",textTransform:"uppercase"}}>Planeswalker Alias</span>
          <input value={alias} onChange={e=>setAlias(e.target.value)} placeholder="Your name in the Multiverse"
            style={{...iS,fontSize:15,fontFamily:"Cinzel, serif",color:T.accent,marginTop:5}}
            onFocus={e=>{e.target.style.borderColor=T.accent;e.target.style.boxShadow="0 0 12px rgba(200,168,112,.2)";}}
            onBlur={e=>{e.target.style.borderColor=T.border;e.target.style.boxShadow="none";}}/>
        </label>

        {/* Avatar section */}
        <div style={{marginBottom:20}}>
          <div style={{fontSize:9,color:"#6a7a8a",fontFamily:"Cinzel, serif",letterSpacing:".15em",textTransform:"uppercase",marginBottom:10}}>Avatar</div>
          {/* Tabs */}
          <div style={{display:"flex",gap:4,marginBottom:12}}>
            {[["emoji","😀 Emoji"],["art","🔍 MTG Art"],["url","🔗 Custom URL"]].map(([t,l])=>(
              <button key={t} onClick={()=>setAvatarTab(t)}
                style={{...btn(avatarTab===t?`${T.accent}20`:"transparent",avatarTab===t?T.accent:"#4a6a8a",
                  {fontSize:9,border:`1px solid ${avatarTab===t?"rgba(200,168,112,.4)":"#1e3a5f20"}`,padding:"4px 10px",borderRadius:4})}}
                onMouseOver={hov} onMouseOut={uhov}>{l}</button>
            ))}
          </div>

          {/* Emoji tab */}
          {avatarTab==="emoji"&&(
            <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
              {AVATARS.map(a=>(
                <button key={a} onClick={()=>{setAvatar(a);setAvatarImg("");}} style={{
                  fontSize:20,background:(a===avatar&&!avatarImg)?`${T.accent}26`:`${T.panel}99`,
                  border:`1px solid ${(a===avatar&&!avatarImg)?T.accent:"#1e3a5f30"}`,borderRadius:7,
                  padding:"4px 6px",cursor:"pointer",transition:"all .15s",
                  boxShadow:(a===avatar&&!avatarImg)?"0 0 12px rgba(200,168,112,.3)":"none",
                  transform:(a===avatar&&!avatarImg)?"scale(1.1)":"scale(1)"}}>
                  {a}
                </button>
              ))}
            </div>
          )}

          {/* MTG Art tab */}
          {avatarTab==="art"&&(
            <div>
              <input value={artQuery} onChange={e=>setArtQuery(e.target.value)}
                placeholder="Search MTG art (e.g. 'jace', 'dragon', 'forest')…"
                style={{...iS,fontSize:11,marginBottom:8}}
                onFocus={e=>e.target.style.borderColor=T.accent}
                onBlur={e=>e.target.style.borderColor=T.border}/>
              {/* Quick searches */}
              <div style={{display:"flex",flexWrap:"wrap",gap:3,marginBottom:10}}>
                {ART_PRESETS.map(p=>(
                  <button key={p} onClick={()=>setArtQuery(p)}
                    style={{...btn(artQuery===p?`${T.accent}20`:"transparent",artQuery===p?T.accent:"#4a6a8a",
                      {fontSize:8,border:`1px solid ${artQuery===p?"rgba(200,168,112,.3)":"#1e3a5f20"}`,padding:"2px 7px",borderRadius:3})}}
                    onMouseOver={hov} onMouseOut={uhov}>{p}</button>
                ))}
              </div>
              {artLoading&&<div style={{fontSize:9,color:T.accent,fontFamily:"Cinzel,serif",textAlign:"center",padding:8}}>🔮 Searching Scryfall…</div>}
              <div style={{display:"flex",flexWrap:"wrap",gap:5,maxHeight:200,overflowY:"auto"}}>
                {artResults.map((url,i)=>(
                  <div key={i} onClick={()=>{setAvatarImg(url);setAvatar("🧙");}}
                    style={{cursor:"pointer",borderRadius:"50%",overflow:"hidden",
                      width:52,height:52,flexShrink:0,
                      border:`3px solid ${avatarImg===url?T.accent:"transparent"}`,
                      boxShadow:avatarImg===url?`0 0 12px ${T.accent}80`:"0 2px 8px rgba(0,0,0,.6)",
                      transition:"border-color .15s,transform .1s"}}
                    onMouseOver={e=>e.currentTarget.style.transform="scale(1.1)"}
                    onMouseOut={e=>e.currentTarget.style.transform="none"}>
                    <img src={url} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/>
                  </div>
                ))}
                {!artLoading&&artResults.length===0&&artQuery&&(
                  <div style={{fontSize:9,color:T.border,fontStyle:"italic",padding:8}}>No art found — try a different search</div>
                )}
                {!artQuery&&<div style={{fontSize:9,color:"#4a6a8a",padding:8,fontStyle:"italic"}}>Type a planeswalker or card name above</div>}
              </div>
            </div>
          )}

          {/* Custom URL tab */}
          {avatarTab==="url"&&(
            <div>
              <input value={customAvatarUrl} onChange={e=>setCustomAvatarUrl(e.target.value)}
                placeholder="Paste any image URL…"
                style={{...iS,fontSize:11,marginBottom:8}}
                onFocus={e=>e.target.style.borderColor=T.accent}
                onBlur={e=>e.target.style.borderColor=T.border}/>
              {customAvatarUrl&&(
                <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:8}}>
                  <div style={{width:60,height:60,borderRadius:"50%",overflow:"hidden",border:`2px solid ${T.border}`,flexShrink:0}}>
                    <img src={customAvatarUrl} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}
                      onError={e=>{e.target.style.display="none";}}/>
                  </div>
                  <button onClick={()=>{setAvatarImg(customAvatarUrl);setAvatar("🧙");}}
                    style={{...btn("rgba(74,222,128,.1)","#4ade80",{border:"1px solid rgba(74,222,128,.25)",fontFamily:"Cinzel,serif",padding:"6px 14px"})}}
                    onMouseOver={hov} onMouseOut={uhov}>✓ Use This</button>
                  {avatarImg===customAvatarUrl&&<span style={{fontSize:9,color:"#4ade80",fontFamily:"Cinzel,serif"}}>✓ Active</span>}
                </div>
              )}
              <div style={{fontSize:8,color:"#3a5a7a",fontStyle:"italic"}}>Works with Imgur, direct image links, Scryfall art crops, etc.</div>
            </div>
          )}
        </div>

        {/* Gamemat */}
        <div style={{marginBottom:22}}>
          <div style={{fontSize:9,color:"#6a7a8a",fontFamily:"Cinzel, serif",letterSpacing:".15em",textTransform:"uppercase",marginBottom:8}}>Gamemat</div>
          <div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:8}}>
            {GAMEMATS.map((gm,i)=>(
              <button key={gm.name} onClick={()=>setGmIdx(i)} style={{
                fontSize:9,fontFamily:"Cinzel, serif",padding:"5px 10px",borderRadius:5,
                border:`1px solid ${i===gmIdx?gm.accent||T.accent:"#1e3a5f20"}`,
                background:i===gmIdx?`${T.accent}14`:"rgba(8,15,28,.5)",
                color:i===gmIdx?gm.accent||T.accent:"#4a6a8a",
                cursor:"pointer",transition:"all .15s",
                boxShadow:i===gmIdx?`0 0 8px ${gm.accent||T.accent}30`:"none"}}>
                {gm.name}
              </button>
            ))}
          </div>
          {gmIdx===GAMEMATS.length-1&&(
            <input value={gmCustom} onChange={e=>setGmCustom(e.target.value)} placeholder="Custom CSS background…" style={iS}/>
          )}
          <div style={{height:40,borderRadius:6,background:gmIdx===GAMEMATS.length-1?(gmCustom||T.panel):GAMEMATS[gmIdx].bg,
            marginTop:8,border:`1px solid ${T.border}30`,transition:"background .3s"}}/>
        </div>

        <button onClick={()=>{
          if(!alias.trim())return;
          const gm=GAMEMATS[gmIdx];
          onSave({alias:alias.trim(),avatar,avatarImg,gamematIdx:gmIdx,gamemat:gm.bg||(gmCustom||T.panel),gamematCustom:gmCustom});
        }} style={{
          ...btn("linear-gradient(135deg,#c8a870,#8a6040)",T.bg,
            {width:"100%",padding:"12px",fontSize:13,fontFamily:"Cinzel Decorative, serif",
            fontWeight:700,letterSpacing:".06em",boxShadow:"0 8px 24px rgba(200,168,112,.3)"}),
          border:`1px solid ${T.accent}60`}}
          onMouseOver={e=>{e.currentTarget.style.filter="brightness(1.15)";e.currentTarget.style.boxShadow="0 12px 36px rgba(200,168,112,.4)";}}
          onMouseOut={e=>{e.currentTarget.style.filter="none";e.currentTarget.style.boxShadow="0 8px 24px rgba(200,168,112,.3)";}}>
          Enter the Multiverse ✦
        </button>
      </div>
    </div>
  );
}

/* ─── Room Lobby ──────────────────────────────────────────────────── */
function RoomLobby({profile,decks,onJoinGame,onBack}){
  const [rooms,setRooms]=useState([]);
  const [creating,setCreating]=useState(false);
  const [roomName,setRoomName]=useState("");
  const [maxP,setMaxP]=useState(2);
  const [selDeckId,setSelDeckId]=useState(""); // v7.5.1: empty by default — user MUST pick
  const [loading,setLoading]=useState(false);
  const [joinRoomId,setJoinRoomId]=useState("");
  const [myRoomId,setMyRoomId]=useState(null);
  const [mySeat,setMySeat]=useState(null);
  const [waitingMeta,setWaitingMeta]=useState(null); // v7: live meta for progress bar
  const [gamemode,setGamemode]=useState("standard");
  // v7.4: when joining another host's room, we can pick our deck from our
  // own library OR from the host's library (the host publishes their decks
  // alongside their player row).
  const [deckSource,setDeckSource]=useState("mine"); // "mine" | "host"
  const [hostDecks,setHostDecks]=useState([]); // host's published deck library
  const isJoinedGuest = myRoomId && mySeat && mySeat > 0;

  const loadRooms=async()=>{
    try{const keys=await storage.list("room_",true);
      const metas=await Promise.all((keys.keys||[]).filter(k=>k.endsWith("_meta")).map(async k=>{try{const r=await storage.get(k,true);return r?JSON.parse(r.value):null;}catch{return null;}}));
      setRooms(metas.filter(Boolean).filter(m=>m.status==="waiting"));}catch{setRooms([]);}};

  useEffect(()=>{loadRooms();const t=setInterval(loadRooms,3000);return()=>clearInterval(t);},[]);

  const createRoom=async()=>{
    if(!roomName.trim())return;
    if(!selDeckId){alert("Please select a deck first");return;}
    setLoading(true);
    const id=uid();
    // v7.4: host publishes their entire deck library so guests can pick from it
    const meta={id,name:roomName.trim(),host:profile.alias,hostAvatar:profile.avatar,maxPlayers:maxP,gamemode,players:[{alias:profile.alias,avatar:profile.avatar,ready:false}],status:"waiting",created:Date.now(),hostDecks:decks};
    try{await storage.set(`room_${id}_meta`,JSON.stringify(meta),true);await storage.set(`room_${id}_player_0`,JSON.stringify({profile,deckId:selDeckId,deck:decks.find(d=>d.id===selDeckId)||null,ready:false,decks}),true);setMyRoomId(id);setMySeat(0);setWaitingMeta(meta);}catch{alert("Could not create room");}
    setLoading(false);};

  const joinRoom=async(roomId)=>{
    setLoading(true);
    try{const r=await storage.get(`room_${roomId}_meta`,true);if(!r){alert("Room not found");setLoading(false);return;}
      const meta=JSON.parse(r.value);
      // v7.6.1: rejoin detection — if this user already has a row in room_players,
      // restore that seat instead of appending a new one. Fixes the "dropped, can't
      // rejoin" bug where the stale row made the room appear full.
      let existingSeat = null;
      try{
        const { supabase } = await import("./lib/supabase");
        const { data:u } = await supabase.auth.getUser();
        const me = u?.user?.id;
        if(me){
          const { data:rp } = await supabase.from('room_players')
            .select('seat').eq('room_id',roomId).eq('user_id',me).maybeSingle();
          if(rp && typeof rp.seat === 'number') existingSeat = rp.seat;
        }
      }catch(e){ console.warn("[joinRoom rejoin-probe]",e); }

      // v7.4: fetch host's deck library so we can show the "Host's Decks" tab
      const hostLib = Array.isArray(meta.hostDecks) ? meta.hostDecks : [];
      setHostDecks(hostLib);

      if(existingSeat !== null){
        // Rejoin — just re-enter the waiting room at our original seat.
        setMyRoomId(roomId);
        setMySeat(existingSeat);
        // Pull our existing deck selection from the row so popup doesn't force re-pick.
        try{
          const cur = await storage.get(`room_${roomId}_player_${existingSeat}`,true);
          const obj = cur?JSON.parse(cur.value):null;
          if(obj?.deckId){ setSelDeckId(obj.deckId); }
          else { setSelDeckId(""); }
        }catch{ setSelDeckId(""); }
      }else{
        // New joiner — find the first unoccupied seat index (lowest unused).
        // (Don't just use meta.players.length — stale stubs can skew it.)
        const pIdx = meta.players.length;
        if(pIdx>=meta.maxPlayers){alert("Room is full");setLoading(false);return;}
        meta.players.push({alias:profile.alias,avatar:profile.avatar,ready:false});
        await storage.set(`room_${roomId}_meta`,JSON.stringify(meta),true);
        // v7.5.1: write player row WITHOUT a deck — user must explicitly pick in waiting lobby
        await storage.set(`room_${roomId}_player_${pIdx}`,JSON.stringify({profile,deckId:null,deck:null,ready:false}),true);
        setMyRoomId(roomId);
        setMySeat(pIdx);
        setSelDeckId(""); // force deck-pick prompt
      }
    }catch(e){alert("Error: "+e.message);}
    setLoading(false);};

  // v7: polling waits for ALL seats to fill (not hardcoded 2), then gathers
  // every player's deck+profile and emits extraDecks/extraProfiles for 3-4p.
  useEffect(()=>{
    if(!myRoomId)return;
    const t=setInterval(async()=>{
      try{
        const r=await storage.get(`room_${myRoomId}_meta`,true);
        if(!r)return;
        const meta=JSON.parse(r.value);
        setWaitingMeta(meta); // v7: drive the waiting-room UI
        if(meta.players.length>=meta.maxPlayers){
          // v7.5: enforce every seat has actually picked a deck before auto-starting
          const playerRowsProbe=[];
          for(let i=0;i<meta.maxPlayers;i++){
            const pd=await storage.get(`room_${myRoomId}_player_${i}`,true).catch(()=>null);
            playerRowsProbe.push(pd?JSON.parse(pd.value):null);
          }
          const everyoneHasDeck = playerRowsProbe.every(pr => pr?.deck || pr?.deckId);
          if(!everyoneHasDeck){
            // Don't start yet; keep polling
            return;
          }
          clearInterval(t);
          const playerRows = playerRowsProbe;
          // My seat is whichever row matches our profile alias (falls back to 0)
          const seat=mySeat ?? playerRows.findIndex(pr=>pr?.profile?.alias===profile.alias);
          const mySeatIdx = seat>=0?seat:0;
          // v7.4: prefer the deck stored in my player_row (may be a host deck)
          const myRow = playerRows[mySeatIdx];
          const myDeck = myRow?.deck || decks.find(d=>d.id===selDeckId) || decks[0];
          // Primary opponent = next seat
          const oppSeat=(mySeatIdx+1)%meta.maxPlayers;
          const oppRow=playerRows[oppSeat];
          const otherDeck = oppRow?.deck || oppRow?.deckId ? (oppRow.deck||decks.find(d=>d.id===oppRow.deckId)) : myDeck;
          // Extra players (for 3p/4p) = all OTHER seats besides me and primary opponent
          const extraSeats=[];
          for(let i=0;i<meta.maxPlayers;i++){
            if(i===mySeatIdx||i===oppSeat)continue;
            extraSeats.push(i);
          }
          const extraDecks=extraSeats.map(i=>{
            const pr=playerRows[i];
            return pr?.deck || (pr?.deckId?decks.find(d=>d.id===pr.deckId):null) || myDeck;
          });
          const extraProfiles=extraSeats.map(i=>playerRows[i]?.profile||{alias:`Player ${i+1}`,avatar:"🧙"});
          onJoinGame({
            roomId:myRoomId,
            playerIdx:mySeatIdx,
            myDeck,
            otherDeck,
            extraDecks,
            extraProfiles,
            meta,
            isOnline:true,
            gamemode,
          });
        }
      }catch{}
    },1500);
    return()=>clearInterval(t);
  },[myRoomId,mySeat,selDeckId,decks,onJoinGame,profile.alias,gamemode]);


  // ── Scry N cards ──
  return(
    <div style={{height:"100vh",background:T.bg,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",fontFamily:"Crimson Text, serif",position:"relative",overflow:"hidden"}}>
      <div style={{position:"absolute",inset:0,background:"radial-gradient(ellipse at 50% 30%,rgba(168,85,247,.05) 0%,transparent 60%)",pointerEvents:"none"}}/>
      <div className="fade-in" style={{width:"100%",maxWidth:580,padding:20,zIndex:1}}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:24}}>
          <button onClick={onBack} style={{...btn(`${T.panel}99`,"#8a99b0",{border:`1px solid ${T.border}`})}} onMouseOver={hov} onMouseOut={uhov}>← Back</button>
          <span style={{color:T.accent,fontFamily:"Cinzel Decorative, serif",fontSize:18,letterSpacing:".06em"}}>Game Rooms</span>
          <span style={{fontSize:18}}>{profile.avatar}</span>
          <span style={{fontSize:13,color:"#4a6a8a"}}>{profile.alias}</span>
        </div>

        <div style={{marginBottom:16,background:`${T.bg}cc`,border:`1px solid ${T.border}30`,borderRadius:8,padding:14}}>
          <div style={{fontSize:9,color:"#6a7a8a",fontFamily:"Cinzel, serif",letterSpacing:".12em",textTransform:"uppercase",marginBottom:8}}>Your Deck</div>
          {/* v7.4: when joining someone else's room, let the guest pick from host's deck library too */}
          {isJoinedGuest && hostDecks.length>0 && (
            <div style={{display:"flex",gap:4,marginBottom:8}}>
              <button onClick={()=>setDeckSource("mine")}
                style={{...btn(deckSource==="mine"?`${T.accent}1a`:`${T.panel}60`,deckSource==="mine"?T.accent:"#6a7a8a",
                  {border:`1px solid ${deckSource==="mine"?T.accent:"#1e3a5f30"}`,fontSize:10,flex:1})}}
                onMouseOver={hov} onMouseOut={uhov}>Play with my deck</button>
              <button onClick={()=>setDeckSource("host")}
                style={{...btn(deckSource==="host"?`${T.accent}1a`:`${T.panel}60`,deckSource==="host"?T.accent:"#6a7a8a",
                  {border:`1px solid ${deckSource==="host"?T.accent:"#1e3a5f30"}`,fontSize:10,flex:1})}}
                onMouseOver={hov} onMouseOut={uhov}>Play with opponent's deck</button>
            </div>
          )}
          <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
            {(deckSource==="host"?hostDecks:decks).map(d=>(
              <button key={`${deckSource}-${d.id}`} onClick={async()=>{
                setSelDeckId(d.id);
                // v7.4: if host-deck chosen, update our player_row's `deck` field immediately
                if(deckSource==="host" && myRoomId && mySeat!=null){
                  try{
                    const cur=await storage.get(`room_${myRoomId}_player_${mySeat}`,true);
                    const obj=cur?JSON.parse(cur.value):{profile,deckId:d.id};
                    obj.deck=d; obj.deckId=d.id; obj.deckSource="host";
                    await storage.set(`room_${myRoomId}_player_${mySeat}`,JSON.stringify(obj),true);
                  }catch{}
                } else if(myRoomId && mySeat!=null){
                  try{
                    const cur=await storage.get(`room_${myRoomId}_player_${mySeat}`,true);
                    const obj=cur?JSON.parse(cur.value):{profile,deckId:d.id};
                    obj.deck=d; obj.deckId=d.id; obj.deckSource="mine";
                    await storage.set(`room_${myRoomId}_player_${mySeat}`,JSON.stringify(obj),true);
                  }catch{}
                }
              }}
                style={{...btn(d.id===selDeckId?`${T.accent}1a`:`${T.panel}99`,d.id===selDeckId?T.accent:"#6a7a8a",
                  {border:`1px solid ${d.id===selDeckId?T.accent:"#1e3a5f30"}`,fontSize:10})}}
                onMouseOver={hov} onMouseOut={uhov}>{d.name}{deckSource==="host"?" ⚔":""}</button>
            ))}
            {deckSource==="host" && hostDecks.length===0 && (
              <span style={{fontSize:9,color:"#6a7a8a",fontStyle:"italic"}}>Host hasn't published any decks yet</span>
            )}
          </div>
        </div>

        {/* Gamemode selector */}
        <div style={{marginBottom:16,background:`${T.bg}cc`,border:`1px solid ${T.border}30`,borderRadius:8,padding:12}}>
          <div style={{fontSize:9,color:"#6a7a8a",fontFamily:"Cinzel, serif",letterSpacing:".12em",textTransform:"uppercase",marginBottom:8}}>Game Mode</div>
          <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
            {GAMEMODES.map(gm=>(
              <button key={gm.id} onClick={()=>setGamemode(gm.id)}
                style={{...btn(gm.id===gamemode?(gm.special?"rgba(168,85,247,.15)":`${T.accent}1a`):`${T.panel}99`,
                  gm.id===gamemode?(gm.special?"#a855f7":T.accent):"#6a7a8a",
                  {border:`1px solid ${gm.id===gamemode?(gm.special?"rgba(168,85,247,.4)":"rgba(200,168,112,.3)"):"#1e3a5f30"}`,fontSize:10,
                   boxShadow:gm.id===gamemode&&gm.special?"0 0 12px rgba(168,85,247,.3)":"none"})}}
                onMouseOver={hov} onMouseOut={uhov}>{gm.icon} {gm.label}</button>
            ))}
          </div>
          {gamemode==="dandan"&&<div style={{marginTop:8,fontSize:10,color:"#a855f7",fontFamily:"Crimson Text,serif",fontStyle:"italic",lineHeight:1.5}}>
            🐟 Both players start with 40 Dandans + 20 Islands. First to run out of Islands loses.
          </div>}
          {gamemode==="commander"&&<div style={{marginTop:6,fontSize:10,color:T.accent,fontFamily:"Crimson Text,serif"}}>⚔ 40 life · Commander damage · Command zone</div>}
        </div>

        {myRoomId?(()=>{
          const curr = waitingMeta?.players?.length || 1;
          const max  = waitingMeta?.maxPlayers || 2;
          const slots = Array.from({length:max},(_,i)=>waitingMeta?.players?.[i]||null);
          return (
          <div style={{background:`${T.bg}cc`,border:`1px solid ${T.accent}60`,borderRadius:8,padding:18,marginBottom:16}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
              <div style={{color:T.accent,fontFamily:"Cinzel, serif",fontSize:13}}>Waiting for players… {curr}/{max}</div>
              <div style={{fontSize:11,color:"#8a99b0"}}>Room <span style={{color:T.text,fontFamily:"Cinzel, serif",letterSpacing:".05em",userSelect:"text"}}>{myRoomId}</span></div>
            </div>
            <div style={{display:"flex",gap:8,marginBottom:10}}>
              {slots.map((p,i)=>(
                <div key={i} style={{
                  flex:1,padding:"10px 8px",borderRadius:6,
                  background:p?`${T.accent}18`:"rgba(30,58,95,.25)",
                  border:p?`1px solid ${T.accent}60`:`1px dashed ${T.border}`,
                  textAlign:"center",transition:"all .2s",
                }}>
                  <div style={{fontSize:20,opacity:p?1:.3}}>{p?.avatar||"·"}</div>
                  <div style={{fontSize:10,color:p?T.text:"#4a6a8a",fontFamily:"Cinzel,serif",marginTop:3}}>
                    {p?.alias || `Seat ${i+1}`}
                  </div>
                </div>
              ))}
            </div>
            <div style={{display:"flex",gap:6,alignItems:"center",justifyContent:"space-between"}}>
              <div style={{animation:"pulse 1.5s ease-in-out infinite",fontSize:10,color:T.accent,fontFamily:"Cinzel, serif"}}>
                {curr>=max?"✦ All players ready — launching…":"⏳ Share the Room ID above with friends"}
              </div>
              <button onClick={async()=>{
                const id=myRoomId;
                setMyRoomId(null);setMySeat(null);setWaitingMeta(null);
                try{ const { leaveRoom } = await import("./lib/storage"); await leaveRoom(id); }catch(e){ console.warn("[leaveRoom]",e); }
              }}
                style={{...btn(`${T.panel}99`,"#8a99b0",{border:`1px solid ${T.border}`,fontSize:10,padding:"5px 10px"})}}
                onMouseOver={hov} onMouseOut={uhov}>Leave Room</button>
            </div>
          </div>);
        })():creating?(
          <div style={{background:`${T.bg}cc`,border:`1px solid ${T.border}30`,borderRadius:8,padding:14,marginBottom:14}}>
            <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:10}}>
              <input value={roomName} onChange={e=>setRoomName(e.target.value)} placeholder="Room name…" style={{...iS,flex:1,marginTop:0}}/>
              <select value={maxP} onChange={e=>setMaxP(+e.target.value)} style={{...iS,width:90,marginTop:0}}>
                {[2,3,4].map(n=><option key={n} value={n}>{n} players</option>)}
              </select>
            </div>
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>setCreating(false)} style={{...btn(`${T.panel}99`,"#8a99b0",{flex:1,border:`1px solid ${T.border}`})}} onMouseOver={hov} onMouseOut={uhov}>Cancel</button>
              <button onClick={createRoom} disabled={loading}
                style={{...btn("linear-gradient(135deg,#c8a870,#8a6040)",T.bg,{flex:2,fontFamily:"Cinzel, serif",fontWeight:700,opacity:loading?.7:1})}}
                onMouseOver={hov} onMouseOut={uhov}>{loading?"Creating…":"✦ Create Room"}</button>
            </div>
          </div>
        ):(
          <button onClick={()=>setCreating(true)}
            style={{...btn("linear-gradient(135deg,#c8a870,#8a6040)",T.bg,{width:"100%",padding:"11px",fontSize:12,fontFamily:"Cinzel, serif",fontWeight:700,marginBottom:14,boxShadow:"0 6px 20px rgba(200,168,112,.25)"})}}
            onMouseOver={hov} onMouseOut={uhov}>✦ Create Room</button>
        )}

        <div style={{display:"flex",gap:8,marginBottom:16}}>
          <input value={joinRoomId} onChange={e=>setJoinRoomId(e.target.value)} placeholder="Join by Room ID…" style={{...iS,flex:1,marginTop:0}}/>
          <button onClick={()=>joinRoom(joinRoomId.trim())} disabled={!joinRoomId.trim()||loading}
            style={{...btn("rgba(59,130,246,.15)","#60a5fa",{border:"1px solid rgba(59,130,246,.3)",opacity:!joinRoomId.trim()?.5:1})}}
            onMouseOver={hov} onMouseOut={uhov}>Join</button>
        </div>

        <button onClick={()=>onJoinGame({isLocal:true,myDeck:decks.find(d=>d.id===selDeckId)||decks[0],otherDeck:decks.find(d=>d.id===selDeckId)||decks[0],gamemode})}
          style={{...btn("rgba(167,139,250,.08)","#a78bfa",{width:"100%",padding:"9px",marginBottom:18,fontFamily:"Cinzel, serif",border:"1px solid rgba(167,139,250,.2)"})}}
          onMouseOver={hov} onMouseOut={uhov}>⇄ Local 2-Player (same device)</button>

        <div style={{color:"#4a6a8a",fontFamily:"Cinzel, serif",fontSize:9,marginBottom:10,letterSpacing:".12em",textTransform:"uppercase"}}>Open Rooms</div>
        {rooms.length===0?(
          <div style={{color:T.border,fontSize:11,textAlign:"center",padding:16,fontStyle:"italic"}}>No open rooms — create one above</div>
        ):rooms.map(room=>(
          <div key={room.id} style={{display:"flex",alignItems:"center",gap:10,padding:"11px 14px",background:`${T.bg}b3`,borderRadius:7,border:`1px solid ${T.border}30`,marginBottom:6,transition:"border-color .15s"}}
            onMouseOver={e=>e.currentTarget.style.borderColor="#c8a87040"}
            onMouseOut={e=>e.currentTarget.style.borderColor="#1e3a5f30"}>
            <div style={{flex:1}}>
              <div style={{color:T.accent,fontFamily:"Cinzel, serif",fontSize:12}}>{room.name}</div>
              <div style={{fontSize:10,color:"#4a6a8a"}}>{room.host} {room.hostAvatar} · {room.players.length}/{room.maxPlayers} players</div>
            </div>
            {/* v7.6.1: always allow clicking. joinRoom detects rejoin via user_id;
                if a non-rejoining user clicks a truly full room, joinRoom alerts. */}
            {(() => {
              const canRejoin = room.players.some(p => p.alias === profile.alias);
              const isFull    = room.players.length >= room.maxPlayers;
              const label     = canRejoin ? "Rejoin" : isFull ? "Full" : "Join";
              return (
                <button onClick={()=>joinRoom(room.id)} disabled={loading || (isFull && !canRejoin)}
                  style={{...btn(`${T.accent}1a`,T.accent,{border:`1px solid ${T.accent}40`,opacity:(isFull && !canRejoin)?.4:1})}}
                  onMouseOver={hov} onMouseOut={uhov}>{label}</button>
              );
            })()}
          </div>
        ))}
      </div>

      {/* v7.6 Phase 9: D1 deck-select popup. Opens immediately when the player
          is in a room without a deck picked. Forces a selection before the
          game can auto-launch (gated by `everyoneHasDeck` in the poller above).
          No ✕ close — only "Leave Room" exits. Joined guests see a tab toggle
          between their own library and the host's published deck library. */}
      {myRoomId && !selDeckId && (
        <div className="fade-in" style={{position:"fixed",inset:0,background:"rgba(0,0,0,.88)",
          backdropFilter:"blur(6px)",zIndex:10000,display:"flex",
          alignItems:"center",justifyContent:"center",padding:20}}>
          <div style={{background:T.panel,border:`2px solid ${T.accent}`,borderRadius:12,
            padding:22,maxWidth:560,width:"100%",maxHeight:"85vh",overflowY:"auto",
            boxShadow:`0 12px 48px ${T.accent}30, 0 0 0 1px ${T.accent}20`}}>
            <div style={{color:T.accent,fontFamily:"Cinzel Decorative, serif",
              fontSize:17,letterSpacing:".06em",textAlign:"center",marginBottom:5}}>
              ⚔ Choose Your Deck
            </div>
            <div style={{color:"#8a99b0",fontSize:11,textAlign:"center",marginBottom:18,
              fontStyle:"italic",fontFamily:"Crimson Text, serif"}}>
              The game can't start until every player has selected a deck.
            </div>

            {/* Tab toggle for joined guests who can borrow host decks */}
            {isJoinedGuest && hostDecks.length>0 && (
              <div style={{display:"flex",gap:6,marginBottom:12}}>
                <button onClick={()=>setDeckSource("mine")}
                  style={{...btn(deckSource==="mine"?`${T.accent}22`:`${T.bg}90`,deckSource==="mine"?T.accent:"#8a99b0",
                    {border:`1px solid ${deckSource==="mine"?T.accent:T.border}`,fontSize:11,flex:1,padding:"7px"})}}
                  onMouseOver={hov} onMouseOut={uhov}>📖 My library</button>
                <button onClick={()=>setDeckSource("host")}
                  style={{...btn(deckSource==="host"?`${T.accent}22`:`${T.bg}90`,deckSource==="host"?T.accent:"#8a99b0",
                    {border:`1px solid ${deckSource==="host"?T.accent:T.border}`,fontSize:11,flex:1,padding:"7px"})}}
                  onMouseOver={hov} onMouseOut={uhov}>⚔ Host's decks</button>
              </div>
            )}

            {/* Deck list — same click handler as main picker (writes to player_row) */}
            <div style={{display:"flex",flexDirection:"column",gap:5,marginBottom:14}}>
              {(deckSource==="host"?hostDecks:decks).length===0?(
                <div style={{color:"#6a7a8a",fontSize:11,textAlign:"center",
                  padding:16,fontStyle:"italic",
                  border:`1px dashed ${T.border}`,borderRadius:6}}>
                  {deckSource==="host"
                    ? "Host hasn't published any decks yet — switch to your library or wait."
                    : "You haven't built any decks yet. Leave the room and visit the Deckbuilder first."}
                </div>
              ):(deckSource==="host"?hostDecks:decks).map(d=>(
                <button key={`popup-${deckSource}-${d.id}`} onClick={async()=>{
                  setSelDeckId(d.id);
                  if(deckSource==="host" && myRoomId && mySeat!=null){
                    try{
                      const cur=await storage.get(`room_${myRoomId}_player_${mySeat}`,true);
                      const obj=cur?JSON.parse(cur.value):{profile,deckId:d.id};
                      obj.deck=d; obj.deckId=d.id; obj.deckSource="host";
                      await storage.set(`room_${myRoomId}_player_${mySeat}`,JSON.stringify(obj),true);
                    }catch{}
                  } else if(myRoomId && mySeat!=null){
                    try{
                      const cur=await storage.get(`room_${myRoomId}_player_${mySeat}`,true);
                      const obj=cur?JSON.parse(cur.value):{profile,deckId:d.id};
                      obj.deck=d; obj.deckId=d.id; obj.deckSource="mine";
                      await storage.set(`room_${myRoomId}_player_${mySeat}`,JSON.stringify(obj),true);
                    }catch{}
                  }
                }}
                  style={{...btn(`${T.bg}b0`,T.text,
                    {border:`1px solid ${T.border}`,fontSize:12,padding:"10px 12px",
                     textAlign:"left",fontFamily:"Cinzel, serif",transition:"all .15s"})}}
                  onMouseOver={e=>{e.currentTarget.style.borderColor=T.accent;e.currentTarget.style.background=`${T.accent}12`;}}
                  onMouseOut ={e=>{e.currentTarget.style.borderColor=T.border;e.currentTarget.style.background=`${T.bg}b0`;}}>
                  <span style={{color:T.accent,marginRight:8}}>✦</span>
                  {d.name}
                  {deckSource==="host" && <span style={{color:"#a855f7",marginLeft:6,fontSize:10}}>(borrowed)</span>}
                  {Array.isArray(d.mainboard) && <span style={{color:"#6a7a8a",marginLeft:8,fontSize:10}}>· {d.mainboard.length} cards</span>}
                </button>
              ))}
            </div>

            {/* Escape hatch — leave room without picking */}
            <button onClick={async()=>{
              const id=myRoomId;
              setMyRoomId(null);setMySeat(null);setWaitingMeta(null);
              try{ const { leaveRoom } = await import("./lib/storage"); await leaveRoom(id); }catch(e){ console.warn("[leaveRoom]",e); }
            }}
              style={{...btn(`${T.panel}99`,"#8a99b0",{width:"100%",border:`1px solid ${T.border}`,fontSize:10,padding:"7px"})}}
              onMouseOver={hov} onMouseOut={uhov}>← Leave Room</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── HandOverlay — cards rendered as position:fixed, no clipping ─── */
function HandOverlay({hand,handRef,containerRef,hovered,selected,setHovered,setSelected,setSelZone,startFloatDrag,handleCtx,floatDrag}){
  const [rect,setRect]=useState(null);
  useEffect(()=>{
    function update(){
      // v7.6 Phase 2: coordinates are relative to `containerRef` (typically the
      // BoardSide root) rather than the viewport. This lets HandOverlay survive
      // transform:rotate(180deg) on its parent for the opponent's view.
      if(handRef.current && containerRef?.current){
        const handR=handRef.current.getBoundingClientRect();
        const contR=containerRef.current.getBoundingClientRect();
        setRect({
          left:   handR.left   - contR.left,
          top:    handR.top    - contR.top,
          right:  handR.right  - contR.left,
          bottom: handR.bottom - contR.top,
          width:  handR.width,
          height: handR.height,
        });
      }
    }
    update();
    window.addEventListener("resize",update);
    return()=>window.removeEventListener("resize",update);
  },[handRef,containerRef,hand.length]);

  if(!rect||hand.length===0)return null;

  const total=hand.length;
  // Smaller cards
  const cardW=Math.round(CW*0.88);
  const cardH=Math.round(CH*0.88);
  // Always overlap — starts at 8px, grows with hand size, capped so all cards fit in zone width
  const zoneW=rect.width;
  const maxTotalW=zoneW*0.95; // never exceed 95% of zone width
  const baseOverlap=8+Math.max(0,(total-5)*4); // more overlap as hand grows
  // Calculate step so cards always fit: step = (maxTotalW - cardW) / (total-1)
  const fittedStep=total>1?Math.min(cardW-baseOverlap,(maxTotalW-cardW)/(total-1)):cardW;
  const step=Math.max(16,fittedStep); // never collapse below 16px step
  const totalW=cardW+(total-1)*step;
  // Center within zone
  const startX=rect.left+(zoneW-totalW)/2;
  // Lift cards higher above the drop zone
  const baseY=rect.bottom-20;

  const hovIdx=hovered?hand.findIndex(c=>c.iid===hovered.iid):-1;

  return(
    <div style={{position:"absolute",inset:0,pointerEvents:"none",zIndex:500}}>
      {hand.map((card,idx)=>{
        const isHov=hovered?.iid===card.iid;
        const isSel=selected.has(card.iid);
        const dist=hovIdx>=0?Math.abs(idx-hovIdx):99;
        const isNeighbor=dist===1;
        // Fan: spread more when fewer cards, tighter fan when many
        const fanSpread=Math.max(1.2,3-total*0.08);
        const fanRot=(idx-total/2+0.5)*fanSpread;
        const fanY=Math.abs(idx-total/2+0.5)*1.2;
        const scale=isHov?1.18:isNeighbor?1.07:isSel?1.03:1;
        const liftY=isHov?-12:isNeighbor?-5:isSel?-2:0;
        const yOff=isHov?0:isNeighbor?Math.max(0,fanY-2):fanY;
        // Keep fan rotation when hovered, just reduce it slightly
        const rot=isHov?fanRot*0.3:fanRot;
        const translateY=yOff+liftY;
        const x=startX+idx*step;
        const y=baseY-cardH; // fixed top — never changes

        return(
          <div key={card.iid}
            style={{
              position:"absolute",
              left:x,
              top:y,
              width:cardW,height:cardH,
              pointerEvents:"auto",
              zIndex:isHov?200:isNeighbor?150:isSel?100:idx+1,
              transform:`rotate(${rot}deg) translateY(${translateY}px) scale(${scale})`,
              transformOrigin:"bottom center",
              transition:"transform .18s cubic-bezier(0.34,1.5,0.64,1)",
              outline:"none",
              borderRadius:7,
              boxShadow:isSel?"0 0 0 3px #c8a870,0 0 18px #c8a87080,0 0 6px #c8a87040":
                        isHov?"0 8px 24px rgba(0,0,0,.85),0 0 16px rgba(200,168,112,.25)":"none",
            }}
            onMouseEnter={()=>setHovered(card)}
            onMouseLeave={()=>setHovered(null)}
            onClick={e=>e.stopPropagation()}
            onMouseDown={e=>{
              if(e.button!==0)return;
              e.preventDefault();e.stopPropagation();
              let didDrag=false;
              const sx=e.clientX,sy=e.clientY;
              const onMove=mv=>{
                if(!didDrag&&(Math.abs(mv.clientX-sx)>4||Math.abs(mv.clientY-sy)>4)){
                  didDrag=true;
                  const fakeE={button:0,clientX:mv.clientX,clientY:mv.clientY,preventDefault:()=>{},stopPropagation:()=>{}};
                  if(selected.size>1&&selected.has(card.iid)){
                    startFloatDrag(fakeE,card,"hand",hand.filter(c=>selected.has(c.iid)));
                  }else{
                    startFloatDrag(fakeE,card,"hand");
                  }
                }
              };
              const onUp=()=>{
                window.removeEventListener("mousemove",onMove);
                window.removeEventListener("mouseup",onUp);
                if(!didDrag){
                  setSelected(s=>{const n=new Set(s);n.has(card.iid)?n.delete(card.iid):n.add(card.iid);return n;});
                  setSelZone("hand");
                }
              };
              window.addEventListener("mousemove",onMove);
              window.addEventListener("mouseup",onUp);
            }}>
            <div style={{transform:"scale(0.88)",transformOrigin:"top left",width:CW,height:CH,animation:`handCard .3s cubic-bezier(0.34,1.3,0.64,1) ${idx*.04}s both`}}>
              <CardImg card={card} selected={isSel} size="md" noHover
                faceDown={!!card.faceDown}
                onCtx={e=>{
                  e.stopPropagation();
                  if(selected.size>1&&selected.has(card.iid)){
                    handleCtx(e,card,"hand");
                  }else{
                    setSelected(new Set([card.iid]));setSelZone("hand");
                    handleCtx(e,card,"hand");
                  }
                }}/>
            </div>
          </div>
        );
      })}
    </div>
  );
}


/* ─── GameBoard ───────────────────────────────────────────────────── */

/* Deck Viewer panel - bottom strip like Untap.in */
/* ─── ZoneViewerModal ─────────────────────────────────────────────── */
function ZoneViewerModal({title,icon,color,cards,zone,onCtx,onHover,onDragStart,onClose,onBulkExile,onBulkShuffle}){
  const [search,setSearch]=useState("");
  const [typeTab,setTypeTab]=useState("All");
  const [localCtx,setLocalCtx]=useState(null);
  const [selected,setSelected]=useState(new Set()); // Set of iids
  const lastClickedIid=useRef(null);

  const typeOrder=["All","Creatures","Planeswalkers","Instants","Sorceries","Enchantments","Artifacts","Lands","Other"];
  const getType=c=>{
    const t=c.typeLine||"";
    if(t.includes("Land"))return"Lands";
    if(t.includes("Creature"))return"Creatures";
    if(t.includes("Planeswalker"))return"Planeswalkers";
    if(t.includes("Instant"))return"Instants";
    if(t.includes("Sorcery"))return"Sorceries";
    if(t.includes("Enchantment"))return"Enchantments";
    if(t.includes("Artifact"))return"Artifacts";
    return"Other";
  };
  const filtered=cards.filter(c=>{
    const matchSearch=!search||c.name.toLowerCase().includes(search.toLowerCase());
    const matchType=typeTab==="All"||getType(c)===typeTab;
    return matchSearch&&matchType;
  });
  const typesPresent=["All",...typeOrder.slice(1).filter(t=>cards.some(c=>getType(c)===t))];

  // Cards that will be affected by a context action — selected set or just the right-clicked card
  const getTargets=(card)=>{
    if(selected.size>1&&selected.has(card.iid)){
      return cards.filter(c=>selected.has(c.iid));
    }
    return [card];
  };

  // Fire onCtx for every target card
  const applyToTargets=(card,targetZone)=>{
    const targets=getTargets(card);
    targets.forEach(c=>onCtx&&onCtx({clientX:0,clientY:0,preventDefault:()=>{}},c,zone,targetZone));
    setSelected(new Set());
  };

  const buildLocalCtx=(card)=>{
    const n=getTargets(card).length;
    const suffix=n>1?` (${n} cards)`:"";
    const items=[];
    if(zone==="graveyard"){
      items.push({icon:"↩",label:`→ Hand${suffix}`,             action:()=>applyToTargets(card,"hand")});
      items.push({icon:"▶",label:`Reanimate → BF${suffix}`,     action:()=>applyToTargets(card,"battlefield"),color:"#4ade80"});
      items.push({icon:"↑",label:`→ Top of Library${suffix}`,   action:()=>applyToTargets(card,"library-top")});
      items.push({icon:"↓",label:`→ Bottom of Library${suffix}`,action:()=>applyToTargets(card,"library-bottom")});
      items.push({icon:"🔀",label:`Shuffle into Library${suffix}`,action:()=>applyToTargets(card,"shuffle")});
      items.push("---");
      items.push({icon:"✦",label:`→ Exile${suffix}`,            action:()=>applyToTargets(card,"exile"),color:"#60a5fa"});
    }else if(zone==="exile"){
      items.push({icon:"↩",label:`→ Hand${suffix}`,             action:()=>applyToTargets(card,"hand")});
      items.push({icon:"▶",label:`→ Battlefield${suffix}`,      action:()=>applyToTargets(card,"battlefield"),color:"#4ade80"});
      items.push({icon:"☠",label:`→ Graveyard${suffix}`,        action:()=>applyToTargets(card,"graveyard")});
      items.push({icon:"↑",label:`→ Top of Library${suffix}`,   action:()=>applyToTargets(card,"library-top")});
      items.push({icon:"↓",label:`→ Bottom of Library${suffix}`,action:()=>applyToTargets(card,"library-bottom")});
      items.push({icon:"🔀",label:`Shuffle into Library${suffix}`,action:()=>applyToTargets(card,"shuffle")});
    }
    return items;
  };

  const handleCardClick=(e,card)=>{
    e.stopPropagation();
    if(e.shiftKey&&lastClickedIid.current){
      // Range select between last clicked and this one
      const ids=filtered.map(c=>c.iid);
      const a=ids.indexOf(lastClickedIid.current);
      const b=ids.indexOf(card.iid);
      const [lo,hi]=[Math.min(a,b),Math.max(a,b)];
      setSelected(prev=>{
        const next=new Set(prev);
        ids.slice(lo,hi+1).forEach(id=>next.add(id));
        return next;
      });
    }else{
      // Toggle individual card
      setSelected(prev=>{
        const next=new Set(prev);
        if(next.has(card.iid)) next.delete(card.iid);
        else next.add(card.iid);
        return next;
      });
      lastClickedIid.current=card.iid;
    }
    setLocalCtx(null);
  };

  return(
    <div className="fade-in" style={{position:"fixed",inset:0,background:"rgba(2,4,10,.92)",
      display:"flex",flexDirection:"column",zIndex:15000,backdropFilter:"blur(6px)"}}
      onClick={e=>{if(localCtx)setLocalCtx(null);else setSelected(new Set());}}>

      {/* Header */}
      <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 18px",
        background:`linear-gradient(180deg,${T.panel},transparent)`,borderBottom:`1px solid ${color}30`,flexShrink:0,flexWrap:"wrap"}}>
        <span style={{color,fontFamily:"Cinzel,serif",fontSize:15,letterSpacing:".1em"}}>{icon} {title} ({cards.length})</span>
        {selected.size>0&&(
          <span style={{fontSize:9,color,fontFamily:"Cinzel,serif",background:`${color}18`,
            border:`1px solid ${color}40`,borderRadius:4,padding:"2px 8px"}}>
            {selected.size} selected
          </span>
        )}
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Filter cards…"
          style={{display:"block",padding:"4px 10px",background:"rgba(5,10,18,.8)",border:`1px solid ${T.border}`,
            color:T.text,borderRadius:5,fontSize:11,fontFamily:"Crimson Text,serif",width:200}}
          onFocus={e=>e.target.style.borderColor=color} onBlur={e=>e.target.style.borderColor=T.border}
          onClick={e=>e.stopPropagation()}/>
        <div style={{flex:1}}/>
        {zone==="graveyard"&&onBulkExile&&(
          <button onClick={e=>{e.stopPropagation();onBulkExile();onClose();}}
            style={{...btn("rgba(96,165,250,.1)","#60a5fa",{border:"1px solid rgba(96,165,250,.25)",fontSize:9,padding:"4px 11px",fontFamily:"Cinzel,serif"})}}
            onMouseOver={hov} onMouseOut={uhov} title="Exile all">✦ Exile All</button>
        )}
        {(zone==="graveyard"||zone==="exile")&&onBulkShuffle&&(
          <button onClick={e=>{e.stopPropagation();onBulkShuffle();onClose();}}
            style={{...btn("rgba(251,191,36,.08)","#fbbf24",{border:"1px solid rgba(251,191,36,.2)",fontSize:9,padding:"4px 11px",fontFamily:"Cinzel,serif"})}}
            onMouseOver={hov} onMouseOut={uhov} title="Shuffle all into library">🔀 Shuffle All</button>
        )}
        <button onClick={onClose} style={{...btn("transparent","#6a7a8a",{fontSize:16,border:"none",padding:"2px 8px"})}} onMouseOver={hov} onMouseOut={uhov}>✕</button>
      </div>

      {/* Type filter tabs */}
      <div style={{display:"flex",gap:3,padding:"6px 16px",flexShrink:0,flexWrap:"wrap",borderBottom:`1px solid ${color}15`}}>
        {typesPresent.map(t=>(
          <button key={t} onClick={e=>{e.stopPropagation();setTypeTab(t);}}
            style={{...btn(typeTab===t?`${color}20`:"transparent",typeTab===t?color:"#4a6a8a",
              {fontSize:9,border:`1px solid ${typeTab===t?color+"40":"#1e3a5f20"}`,padding:"3px 9px",borderRadius:4})}}
            onMouseOver={hov} onMouseOut={uhov}>{t}</button>
        ))}
      </div>

      {/* Selection hint */}
      {filtered.length>0&&(
        <div style={{padding:"4px 18px",fontSize:8,color:"#3a5a7a",fontFamily:"Cinzel,serif",flexShrink:0}}>
          Left-click to select · Shift+click for range · Right-click for actions
        </div>
      )}

      {/* Card grid */}
      <div style={{flex:1,overflowY:"auto",padding:"8px 16px 16px",display:"flex",flexWrap:"wrap",gap:8,alignContent:"flex-start"}}>
        {filtered.length===0&&<div style={{color:T.border,fontFamily:"Cinzel,serif",fontSize:11,padding:20,width:"100%",textAlign:"center",fontStyle:"italic"}}>Nothing here</div>}
        {filtered.map(card=>{
          const isSel=selected.has(card.iid);
          return(
            <div key={card.iid}
              onMouseEnter={()=>onHover&&onHover(card)}
              onClick={e=>handleCardClick(e,card)}
              onContextMenu={e=>{
                e.preventDefault();
                e.stopPropagation();
                if(!selected.has(card.iid)){
                  setSelected(new Set([card.iid]));
                  lastClickedIid.current=card.iid;
                }
                setLocalCtx({x:e.clientX,y:e.clientY,card});
              }}
              onMouseDown={e=>{
                if(e.button!==0)return;
                // Only start drag after moving 8px — lets clicks register as selection
                const sx=e.clientX,sy=e.clientY;
                const onMove=(mv)=>{
                  if(Math.abs(mv.clientX-sx)>8||Math.abs(mv.clientY-sy)>8){
                    window.removeEventListener("mousemove",onMove);
                    window.removeEventListener("mouseup",onUp);
                    onDragStart&&onDragStart(e,card,zone);
                  }
                };
                const onUp=()=>{
                  window.removeEventListener("mousemove",onMove);
                  window.removeEventListener("mouseup",onUp);
                };
                window.addEventListener("mousemove",onMove);
                window.addEventListener("mouseup",onUp);
              }}
              style={{
                cursor:"pointer",transition:"transform .1s,box-shadow .1s",flexShrink:0,
                borderRadius:7,
                outline:isSel?`2px solid ${color}`:"2px solid transparent",
                boxShadow:isSel?`0 0 12px ${color}60,0 0 0 2px ${color}40`:"none",
                transform:isSel?"translateY(-3px) scale(1.04)":"none",
              }}
              onMouseOver={e=>{if(!isSel)e.currentTarget.style.transform="translateY(-4px) scale(1.04)";}}
              onMouseOut={e=>{if(!isSel)e.currentTarget.style.transform="none";}}>
              <CardImg card={card} size="md" noHover/>
              {isSel&&(
                <div style={{position:"absolute",top:3,right:3,width:16,height:16,borderRadius:"50%",
                  background:color,display:"flex",alignItems:"center",justifyContent:"center",
                  fontSize:9,color:"#080f1c",fontWeight:700,pointerEvents:"none",
                  boxShadow:`0 0 6px ${color}`}}>✓</div>
              )}
            </div>
          );
        })}
      </div>

      {/* Inline context menu */}
      {localCtx&&(()=>{
        const items=buildLocalCtx(localCtx.card);
        const menuW=230,menuH=items.length*34+32;
        const x=Math.min(localCtx.x,window.innerWidth-menuW-8);
        const y=Math.min(localCtx.y,window.innerHeight-menuH-8);
        const n=getTargets(localCtx.card).length;
        return(
          <div className="slide-in" onClick={e=>e.stopPropagation()}
            style={{position:"fixed",left:x,top:y,
              background:`linear-gradient(160deg,${T.panel},${T.bg})`,
              border:`1px solid ${color}40`,borderRadius:8,zIndex:16000,
              minWidth:menuW,boxShadow:"0 16px 48px rgba(0,0,0,.95)",overflow:"hidden"}}>
            <div style={{padding:"5px 12px 4px",fontSize:8,color:`${color}`,letterSpacing:".12em",
              fontFamily:"Cinzel,serif",borderBottom:`1px solid ${color}20`,
              display:"flex",alignItems:"center",gap:6}}>
              <span style={{opacity:.7}}>{localCtx.card.name}</span>
              {n>1&&<span style={{background:`${color}25`,borderRadius:3,padding:"0 5px",color}}>{n} cards</span>}
            </div>
            {items.map((item,i)=>
              item==="---"?(
                <div key={i} style={{borderTop:`1px solid ${T.border}20`,margin:"3px 0"}}/>
              ):(
                <div key={i}
                  onClick={()=>{item.action();setLocalCtx(null);}}
                  style={{padding:"7px 13px",cursor:"pointer",fontSize:12,
                    color:item.color||T.text,fontFamily:"Crimson Text,serif",
                    display:"flex",alignItems:"center",gap:8,transition:"background .1s,padding-left .1s"}}
                  onMouseEnter={e=>{e.currentTarget.style.background="#1a2a4a";e.currentTarget.style.paddingLeft="17px";}}
                  onMouseLeave={e=>{e.currentTarget.style.background="transparent";e.currentTarget.style.paddingLeft="13px";}}>
                  <span style={{opacity:.7,fontSize:13}}>{item.icon||"·"}</span>
                  <span>{item.label}</span>
                </div>
              )
            )}
          </div>
        );
      })()}
    </div>
  );
}

/* ─── SearchLibModal ──────────────────────────────────────────────── */
function SearchLibModal({player,opponent,onCtx,onHover,onShuffle,onUpdateGame,onClose,oppHandAccess,oppLibAccess,onRequestOppAccess}){
  const [libSearch,setLibSearch]=useState("");
  const [libTypeTab,setLibTypeTab]=useState("All");
  const [searchZone,setSearchZone]=useState("library");
  const zoneCards={
    library:player.library,
    graveyard:player.graveyard,
    exile:player.exile,
    opp_graveyard:opponent?.graveyard||[],
    opp_exile:opponent?.exile||[],
    opp_hand:oppHandAccess?opponent?.hand||[]:[],
    opp_library:oppLibAccess?opponent?.library||[]:[],
  };
  const zoneColor={library:T.accent,graveyard:"#a78bfa",exile:"#60a5fa",opp_graveyard:"#f87171",opp_exile:"#f97316",opp_hand:"#fb923c",opp_library:"#fb923c"};
  const zoneLabel={library:"📚 My Library",graveyard:"☠ My Graveyard",exile:"✦ My Exile",opp_graveyard:"☠ Opp. Grave",opp_exile:"✦ Opp. Exile",opp_hand:"✋ Opp. Hand",opp_library:"📚 Opp. Library"};
  const needsRequest={opp_hand:!oppHandAccess,opp_library:!oppLibAccess};
  const typeOrder=["All","Creatures","Planeswalkers","Instants","Sorceries","Enchantments","Artifacts","Lands","Other"];
  const getType=c=>{const t=c.typeLine||"";if(t.includes("Land"))return"Lands";if(t.includes("Creature"))return"Creatures";if(t.includes("Planeswalker"))return"Planeswalkers";if(t.includes("Instant"))return"Instants";if(t.includes("Sorcery"))return"Sorceries";if(t.includes("Enchantment"))return"Enchantments";if(t.includes("Artifact"))return"Artifacts";return"Other";};
  const srcCards=zoneCards[searchZone]||[];
  const filtered=srcCards.filter(c=>{
    const ms=!libSearch||c.name.toLowerCase().includes(libSearch.toLowerCase());
    const mt=libTypeTab==="All"||getType(c)===libTypeTab;
    return ms&&mt;
  });
  const typesPresent=["All",...typeOrder.slice(1).filter(t=>srcCards.some(c=>getType(c)===t))];
  const col=zoneColor[searchZone]||T.accent;
  const isOpp=searchZone.startsWith("opp_");
  return(
    <div className="fade-in" style={{position:"fixed",inset:0,background:"rgba(2,4,10,.93)",
      display:"flex",flexDirection:"column",zIndex:10000,backdropFilter:"blur(6px)"}}>
      <div style={{display:"flex",alignItems:"center",gap:8,padding:"10px 18px",
        background:`linear-gradient(180deg,${T.panel},transparent)`,borderBottom:`1px solid ${col}30`,flexShrink:0,flexWrap:"wrap"}}>
        <span style={{color:col,fontFamily:"Cinzel,serif",fontSize:13,letterSpacing:".08em"}}>{zoneLabel[searchZone]} ({srcCards.length})</span>
        <input value={libSearch} onChange={e=>setLibSearch(e.target.value)} placeholder="Search cards…"
          style={{...{display:"block",padding:"4px 10px",background:"rgba(5,10,18,.8)",border:`1px solid ${T.border}`,
            color:T.text,borderRadius:5,fontSize:11,fontFamily:"Crimson Text,serif"},width:180}}
          onFocus={e=>e.target.style.borderColor=col} onBlur={e=>e.target.style.borderColor=T.border}/>
        <div style={{flex:1}}/>
        {searchZone==="library"&&<button onClick={()=>{onShuffle();onClose();}}
          style={{...btn("rgba(251,191,36,.08)","#fbbf24",{border:"1px solid rgba(251,191,36,.2)",fontSize:10})}}
          onMouseOver={hov} onMouseOut={uhov}>🔀 Shuffle & Close</button>}
        <button onClick={onClose} style={{...btn("transparent","#6a7a8a",{fontSize:16,border:"none",padding:"2px 8px"})}} onMouseOver={hov} onMouseOut={uhov}>✕</button>
      </div>
      <div style={{display:"flex",gap:3,padding:"5px 16px",flexShrink:0,flexWrap:"wrap",borderBottom:`1px solid ${col}15`}}>
        {Object.keys(zoneCards).map(z=>(
          <button key={z} onClick={()=>{
            if(needsRequest[z]){onRequestOppAccess&&onRequestOppAccess(z);return;}
            setSearchZone(z);setLibTypeTab("All");
          }}
            style={{...btn(searchZone===z?`${zoneColor[z]}25`:"transparent",
              needsRequest[z]?"#3a4a5a":searchZone===z?zoneColor[z]:"#4a6a8a",
              {fontSize:9,border:`1px solid ${searchZone===z?zoneColor[z]+"50":"#1e3a5f20"}`,
               padding:"3px 8px",borderRadius:4,opacity:needsRequest[z]?.7:1})}}
            title={needsRequest[z]?"Click to request access from opponent":undefined}
            onMouseOver={hov} onMouseOut={uhov}>
            {needsRequest[z]?"🔒 ":""}{zoneLabel[z]}
          </button>
        ))}
      </div>
      <div style={{display:"flex",gap:3,padding:"4px 16px",flexShrink:0,flexWrap:"wrap",borderBottom:`1px solid ${col}10`}}>
        {typesPresent.map(t=>(
          <button key={t} onClick={()=>setLibTypeTab(t)}
            style={{...btn(libTypeTab===t?`${col}20`:"transparent",libTypeTab===t?col:"#4a6a8a",
              {fontSize:8,border:`1px solid ${libTypeTab===t?col+"40":"#1e3a5f15"}`,padding:"2px 7px",borderRadius:3})}}
            onMouseOver={hov} onMouseOut={uhov}>{t}</button>
        ))}
      </div>
      <div style={{flex:1,overflowY:"auto",padding:"12px 16px",display:"flex",flexWrap:"wrap",gap:8,alignContent:"flex-start"}}>
        {filtered.length===0&&<div style={{color:T.border,fontFamily:"Cinzel,serif",fontSize:11,padding:20,width:"100%",textAlign:"center",fontStyle:"italic"}}>No cards here</div>}
        {filtered.map((card,i)=>(
          <div key={card.iid||i} title={card.name}
            onMouseEnter={()=>onHover&&onHover(card)}
            onContextMenu={e=>{
              e.preventDefault();
              // Show context menu without closing window
              onCtx&&onCtx(e,card,isOpp?"opp_exile":searchZone);
            }}
            onMouseDown={e=>{
              if(e.button!==0)return;
              // Drag out of search window — close and hand off to float drag
              const handleMove=(mv)=>{
                const dx=mv.clientX-e.clientX,dy=mv.clientY-e.clientY;
                if(Math.sqrt(dx*dx+dy*dy)>8){
                  window.removeEventListener("mousemove",handleMove);
                  window.removeEventListener("mouseup",handleUp);
                  // Synthesise a mousedown on the card for the float drag system
                  onClose();
                  // Start float drag by dispatching to parent via a custom event
                  const evt=new CustomEvent("mtg-float-drag",{detail:{card,zone:isOpp?"opp_exile":searchZone,x:mv.clientX,y:mv.clientY}});
                  window.dispatchEvent(evt);
                }
              };
              const handleUp=()=>{window.removeEventListener("mousemove",handleMove);window.removeEventListener("mouseup",handleUp);};
              window.addEventListener("mousemove",handleMove);
              window.addEventListener("mouseup",handleUp);
            }}
            style={{cursor:"grab",transition:"transform .1s",flexShrink:0}}
            onMouseOver={e=>e.currentTarget.style.transform="translateY(-4px) scale(1.04)"}
            onMouseOut={e=>e.currentTarget.style.transform="none"}>
            <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:3}}>
              <CardImg card={card} size="md" noHover/>
              {isOpp&&onUpdateGame&&(
                <button onClick={e=>{e.stopPropagation();onUpdateGame({requestMsg:`${player.profile?.alias||"Player"} requests: ${card.name}`,requestTs:Date.now()});}}
                  style={{...btn("rgba(74,222,128,.1)","#4ade80",{fontSize:7,padding:"1px 5px",border:"1px solid rgba(74,222,128,.2)"})}}
                  onMouseOver={hov} onMouseOut={uhov}>→ Request</button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DeckViewer({library,revealTop,onClose,onCtx,onHover,onDragStart,onDraw,onShuffle}){
  const [search,setSearch]=useState("");
  const filtered=revealTop
    ? library.filter(c=>c.name.toLowerCase().includes(search.toLowerCase()))
    : [];
  return(
    <div style={{position:"absolute",bottom:0,left:0,right:0,zIndex:500,
      background:"linear-gradient(0deg,#040810,#06101a)",
      borderTop:`1px solid ${T.accent}40`,
      boxShadow:"0 -8px 32px rgba(0,0,0,.8)"}}>
      <div style={{display:"flex",alignItems:"center",gap:8,padding:"5px 10px",borderBottom:`1px solid ${T.border}20`}}>
        <span style={{color:T.accent,fontFamily:"Cinzel,serif",fontSize:10,letterSpacing:".1em"}}>
          📚 DECK ({library.length})
        </span>
        {revealTop&&(
          <div style={{display:"flex",alignItems:"center",gap:4,flex:1}}>
            <span style={{fontSize:12,color:"#6a7a8a"}}>🔍</span>
            <input value={search} onChange={e=>setSearch(e.target.value)}
              placeholder="Find card in deck…"
              style={{...{display:"block",width:"100%",padding:"3px 8px",background:"rgba(5,10,18,.8)",
                border:`1px solid ${T.border}`,color:T.text,borderRadius:4,fontSize:11,
                fontFamily:"Crimson Text,serif"},flex:1,maxWidth:200}}
              onFocus={e=>e.target.style.borderColor=T.accent}
              onBlur={e=>e.target.style.borderColor=T.border}/>
          </div>
        )}
        <div style={{flex:1}}/>
        <button onClick={onDraw} style={{...btn("rgba(59,130,246,.1)","#60a5fa",{fontSize:9,border:"1px solid rgba(59,130,246,.2)",padding:"3px 8px"})}} onMouseOver={hov} onMouseOut={uhov}>Draw</button>
        <button onClick={onShuffle} style={{...btn("rgba(251,191,36,.08)","#fbbf24",{fontSize:9,border:"1px solid rgba(251,191,36,.15)",padding:"3px 8px"})}} onMouseOver={hov} onMouseOut={uhov}>Shuffle</button>
        <button onClick={onClose} style={{...btn("transparent","#6a7a8a",{fontSize:14,border:"none",padding:"2px 6px"})}} onMouseOver={hov} onMouseOut={uhov}>✕</button>
      </div>
      <div style={{display:"flex",gap:3,padding:"6px 8px",overflowX:"auto",alignItems:"center",minHeight:90}}>
        {!revealTop&&(
          <div style={{color:"#2a3a5a",fontFamily:"Cinzel,serif",fontSize:10,padding:"0 20px",fontStyle:"italic"}}>
            Enable "Reveal Top" to view your library
          </div>
        )}
        {revealTop&&(search?filtered:library).map((card,i)=>(
          <div key={card.iid} title={card.name}
            onContextMenu={e=>onCtx&&onCtx(e,card,"library")}
            onMouseEnter={()=>onHover&&onHover(card)}
            onMouseDown={e=>onDragStart&&onDragStart(e,card,"library")}
            style={{flexShrink:0,cursor:"grab",transition:"transform .1s"}}
            onMouseOver={e=>e.currentTarget.style.transform="translateY(-4px)"}
            onMouseOut={e=>e.currentTarget.style.transform="none"}>
            <CardImg card={card} size="xs" faceDown={false} tapped={false} noHover/>
          </div>
        ))}
        {revealTop&&search&&filtered.length===0&&(
          <div style={{color:"#3a5a7a",fontFamily:"Cinzel,serif",fontSize:10,padding:"0 20px"}}>No cards match "{search}"</div>
        )}
      </div>
    </div>
  );
}

/* Scry modal — show top N cards, drag to reorder, send top/bottom/grave/exile */
function ScryModal({cards,mode,onConfirm,onClose}){
  const [order,setOrder]=useState(cards.map((_,i)=>i));
  const [decisions,setDecisions]=useState({}); // idx -> "top"|"bottom"|"graveyard"|"exile"
  const [dragging,setDragging]=useState(null);
  const decide=(idx,d)=>setDecisions(p=>({...p,[idx]:p[idx]===d?undefined:d}));
  const dragStart=(idx)=>setDragging(idx);
  const dragOver=(e,idx)=>{
    e.preventDefault();
    if(dragging===null||dragging===idx)return;
    setOrder(o=>{const n=[...o];const from=n.indexOf(dragging),to=n.indexOf(idx);n.splice(from,1);n.splice(to,0,dragging);return n;});
  };
  const confirm=()=>{
    if(mode==="look"){
      // Look: all cards go back on top in current order
      const tops=order.map(i=>cards[i]);
      onConfirm(tops,[],[],[]);
      return;
    }
    const tops=order.filter(i=>!decisions[i]||decisions[i]==="top").map(i=>cards[i]);
    const bots=order.filter(i=>decisions[i]==="bottom").map(i=>cards[i]);
    const grave=mode==="look"?[]:order.filter(i=>decisions[i]==="graveyard").map(i=>cards[i]);
    const exl=mode==="look"?[]:order.filter(i=>decisions[i]==="exile").map(i=>cards[i]);
    onConfirm(tops,bots,grave,exl);
  };
  const dBtn=(idx,d,label,col)=>(
    <button onClick={()=>decide(idx,d)}
      style={{...btn(decisions[idx]===d?`${col}30`:`${T.bg}99`,decisions[idx]===d?col:"#4a6a8a",
        {fontSize:8,padding:"2px 5px",border:`1px solid ${decisions[idx]===d?col+"50":"#1e3a5f30"}`,borderRadius:3})}}
      onMouseOver={hov} onMouseOut={uhov}>{label}</button>
  );
  return(
    <div className="fade-in" style={{position:"fixed",inset:0,background:"rgba(2,4,10,.9)",
      display:"flex",alignItems:"center",justifyContent:"center",zIndex:20000,backdropFilter:"blur(6px)"}}>
      <div className="slide-in" style={{background:`linear-gradient(160deg,${T.panel},${T.bg})`,
        border:`1px solid ${T.accent}50`,borderRadius:12,padding:22,
        maxWidth:600,width:"90vw",boxShadow:"0 24px 80px rgba(0,0,0,.95)"}}>
        <h3 style={{color:T.accent,fontFamily:"Cinzel,serif",fontSize:14,marginBottom:6}}>{mode==="surveil"?"🔍 Surveil":"🔮 Scry"} {cards.length}</h3>
        <div style={{fontSize:9,color:"#6a7a8a",marginBottom:12,fontFamily:"Crimson Text,serif"}}>
          {mode==="look"?"Drag to reorder, then confirm to put back on top in this order."
           :mode==="surveil"?"Drag to reorder. Cards default to top. Send to graveyard if desired."
           :"Default = keep on top. Drag to reorder. Use buttons to send to bottom, graveyard, or exile."}
        </div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:16,justifyContent:"center"}}>
          {order.map(i=>{
            const card=cards[i];
            const d=decisions[i];
            const borderCol=d==="top"?"#4ade80":d==="bottom"?"#60a5fa":d==="graveyard"?"#a78bfa":d==="exile"?"#f97316":T.border;
            return(
              <div key={i} draggable onDragStart={()=>dragStart(i)} onDragOver={e=>dragOver(e,i)}
                style={{display:"flex",flexDirection:"column",alignItems:"center",gap:4,cursor:"grab",
                  opacity:d&&d!=="top"?.7:1,transition:"opacity .15s",userSelect:"none"}}>
                <div style={{position:"relative",border:`2px solid ${borderCol}`,borderRadius:6,transition:"border-color .2s"}}>
                  <CardImg card={card} size="sm" noHover/>
                  {d&&d!=="top"&&<div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",
                    background:"rgba(0,0,0,.55)",borderRadius:4,fontSize:16,pointerEvents:"none"}}>
                    {d==="bottom"?"⬇":d==="graveyard"?"☠":"✦"}
                  </div>}
                </div>
                <div style={{fontSize:8,color:"#6a7a8a",maxWidth:52,textAlign:"center",overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis"}}>{card.name}</div>
                <div style={{display:"flex",gap:2,flexWrap:"wrap",justifyContent:"center"}}>
                  {mode!=="look"&&dBtn(i,"top","⬆Top","#4ade80")}
                  {mode!=="look"&&dBtn(i,"bottom","⬇Bot","#60a5fa")}
                  {(mode==="surveil"||mode==="scry")&&dBtn(i,"graveyard","☠Grave","#a78bfa")}
                  {mode==="scry"&&dBtn(i,"exile","✦Exile","#f97316")}
                </div>
              </div>
            );
          })}
        </div>
        <div style={{display:"flex",gap:8}}>
          <button onClick={onClose} style={{...btn(`${T.panel}99`,"#8a99b0",{flex:1,border:`1px solid ${T.border}`})}} onMouseOver={hov} onMouseOut={uhov}>Cancel</button>
          <button onClick={confirm} style={{...btn("linear-gradient(135deg,#c8a870,#8a6040)",T.bg,{flex:2,fontFamily:"Cinzel,serif",fontWeight:700})}} onMouseOver={hov} onMouseOut={uhov}>✦ Confirm</button>
        </div>
      </div>
    </div>
  );
}


/* ─── HotkeyHelp modal ───────────────────────────────────────────── */
function HotkeyHelp({onClose}){
  const GLOBAL=[
    ["X","Untap all cards in play"],
    ["C","Draw a card from deck"],
    ["V","Shuffle your deck"],
    ["Shift+V","Mill 1 → Graveyard (animated)"],
    ["Ctrl+Shift+V","Mill 1 → Exile (animated)"],
    ["M","Mulligan hand"],
    ["Shift+M","Mill X… (opens prompt)"],
    ["B","Focus chat input"],
    ["N","Next phase of turn"],
    ["A","Alert / Respond"],
    ["Q","No Response / Pass"],
    ["W","Insert token or any card"],
    ["E","End Turn"],
    ["F","Find a card in deck (Search Library)"],
    ["G","Look at top N cards (Scry)"],
    ["`","Roll D6"],
    ["Shift+`","Roll D20"],
    ["Ctrl+A","Select all on battlefield"],
    ["Escape","Clear selection / cancel"],
  ];
  const HOVER=[
    ["Space / _","Tap/untap (BF) · Send to battlefield (hand/grave/exile/library)"],
    ["Z","Tap/untap group of touching cards"],
    ["L","Flip card (DFC: alt face; others: show card back)"],
    ["D","Send card to Graveyard"],
    ["S","Send card to Exile"],
    ["P","Send card to Facedown Exile"],
    ["R","Send card to Hand"],
    ["T","Send card to top of Library"],
    [".","Send card to bottom of Library"],
    ["K","Clone card"],
    ["H","Shake card"],
    ["O","Target / mark as source"],
    ["I","Invert card (rotate 180°)"],
    ["U","Add +1/+1 counter"],
  ];
  const Row=({k,label})=>(
    <div style={{display:"flex",alignItems:"center",gap:10,padding:"4px 0",
      borderBottom:"1px solid rgba(200,168,112,.06)"}}>
      <span style={{background:"rgba(200,168,112,.12)",color:T.accent,fontFamily:"Cinzel,serif",
        fontSize:10,padding:"2px 7px",borderRadius:4,border:"1px solid rgba(200,168,112,.25)",
        minWidth:70,textAlign:"center",whiteSpace:"nowrap",flexShrink:0}}>{k}</span>
      <span style={{fontSize:11,color:"#d4c5a0",fontFamily:"Crimson Text,serif"}}>{label}</span>
    </div>
  );
  return(
    <div className="fade-in" style={{position:"fixed",inset:0,background:"rgba(2,4,10,.92)",
      display:"flex",alignItems:"center",justifyContent:"center",zIndex:10003,backdropFilter:"blur(6px)"}}>
      <div className="slide-in" style={{
        background:"linear-gradient(160deg,#0d1f3c,#080f1c)",
        border:"1px solid rgba(200,168,112,.2)",borderRadius:12,padding:26,
        width:700,maxHeight:"88vh",overflowY:"auto",
        boxShadow:"0 24px 80px rgba(0,0,0,.95)"}}>
        <div style={{position:"sticky",top:0,background:"linear-gradient(160deg,#0d1f3c,#080f1c)",
          paddingBottom:12,marginBottom:12,borderBottom:"1px solid rgba(200,168,112,.15)",
          display:"flex",alignItems:"center",justifyContent:"space-between",zIndex:1}}>
          <div>
            <div style={{color:T.accent,fontFamily:"Cinzel Decorative,serif",fontSize:15}}>⌨ Hotkey Help</div>
            <div style={{fontSize:10,color:"#4a6a8a",fontFamily:"Cinzel,serif",marginTop:2}}>
              Hover card hotkeys work when your mouse is over a card
            </div>
          </div>
          <button onClick={onClose} style={{...btn("transparent","#6a7a8a",{fontSize:18,border:"none"})}}
            onMouseOver={hov} onMouseOut={uhov}>✕</button>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:24}}>
          <div>
            <div style={{fontSize:10,color:"#6a7a8a",fontFamily:"Cinzel,serif",letterSpacing:".15em",
              textTransform:"uppercase",marginBottom:10}}>Global Hotkeys</div>
            {GLOBAL.map(([k,l])=><Row key={k} k={k} label={l}/>)}
          </div>
          <div>
            <div style={{fontSize:10,color:"#6a7a8a",fontFamily:"Cinzel,serif",letterSpacing:".15em",
              textTransform:"uppercase",marginBottom:10}}>Hover Card Hotkeys</div>
            {HOVER.map(([k,l])=><Row key={k} k={k} label={l}/>)}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── MatCropEditor — interactive crop/pan/zoom for gamemat images ─── */
function MatCropEditor({url,onApply,onSave,name}){
  const [scale,setScale]=useState(100);       // zoom %
  const [posX,setPosX]=useState(50);          // background-position-x %
  const [posY,setPosY]=useState(50);          // background-position-y %
  const [size,setSize]=useState("cover");     // cover | contain | 100% | custom
  const [customSize,setCustomSize]=useState("100%");
  const [brightness,setBrightness]=useState(100);
  const [saturation,setSaturation]=useState(100);
  const [dragging,setDragging]=useState(false);
  const dragStart=useRef(null);
  const previewRef=useRef(null);

  const bgSize=size==="custom"?customSize:size==="cover"?"cover":size==="contain"?"contain":`${scale}%`;
  const bgPos=`${posX}% ${posY}%`;
  // Encode filter as part of the name/metadata since CSS background can't hold filter
  // We pass a special object so the gamemat system can apply it
  const filterStr=(brightness!==100||saturation!==100)?`brightness(${brightness}%) saturate(${saturation}%)`:"";
  const bgCss=`url(${url}) ${bgPos}/${bgSize} no-repeat`;
  // For the gamemat, we store bg+filter together in a wrapper object serialised as JSON in the bg string
  // Actually: encode filter in bg string using a marker the gamemat renderer understands
  const fullBgCss=bgCss; // bg without filter - filter applied at render time via gamematFilter
  const nm=name?.trim()||`Custom ${Date.now()}`;

  const handleMouseDown=e=>{
    if(e.button!==0)return;
    e.preventDefault();
    setDragging(true);
    dragStart.current={x:e.clientX,y:e.clientY,px:posX,py:posY};
  };
  const handleMouseMove=e=>{
    if(!dragging||!dragStart.current)return;
    const dx=(e.clientX-dragStart.current.x)/3;
    const dy=(e.clientY-dragStart.current.y)/3;
    setPosX(v=>Math.max(0,Math.min(100,dragStart.current.px-dx)));
    setPosY(v=>Math.max(0,Math.min(100,dragStart.current.py-dy)));
  };
  const handleMouseUp=()=>setDragging(false);

  const Slider=({label,value,min,max,onChange,unit="%",step=1})=>(
    <div style={{marginBottom:8}}>
      <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
        <span style={{fontSize:8,color:"#6a7a8a",fontFamily:"Cinzel,serif",letterSpacing:".08em"}}>{label}</span>
        <span style={{fontSize:8,color:T.accent,fontFamily:"Cinzel,serif"}}>{value}{unit}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e=>onChange(Number(e.target.value))}
        style={{width:"100%",accentColor:T.accent,cursor:"pointer"}}/>
    </div>
  );

  return(
    <div style={{display:"flex",gap:16,flexWrap:"wrap"}}>
      {/* Preview pane — drag to pan */}
      <div style={{flex:"0 0 320px"}}>
        <div style={{fontSize:8,color:T.accent,fontFamily:"Cinzel,serif",letterSpacing:".1em",marginBottom:6}}>PREVIEW — drag to pan</div>
        <div ref={previewRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          style={{
            width:"100%",height:180,borderRadius:8,overflow:"hidden",
            background:fullBgCss,
            filter:filterStr||"none",
            border:`1px solid ${T.accent}40`,cursor:dragging?"grabbing":"grab",
            boxShadow:"0 4px 20px rgba(0,0,0,.6)",
            userSelect:"none",
          }}/>
        {/* Playmat-ratio preview */}
        <div style={{fontSize:7,color:"#3a5a7a",fontFamily:"Cinzel,serif",marginTop:4,textAlign:"center"}}>Drag to reposition · Zoom with slider below</div>
      </div>

      {/* Controls */}
      <div style={{flex:1,minWidth:200}}>
        <div style={{marginBottom:12}}>
          <div style={{fontSize:8,color:"#6a7a8a",fontFamily:"Cinzel,serif",letterSpacing:".08em",marginBottom:6}}>SIZING MODE</div>
          <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
            {[["cover","Fill (Cover)"],["contain","Fit (Contain)"],["scale","Zoom %"],["custom","Custom"]].map(([v,l])=>(
              <button key={v} onClick={()=>setSize(v)}
                style={{...btn(size===v?`${T.accent}20`:"transparent",size===v?T.accent:"#4a6a8a",
                  {fontSize:8,border:`1px solid ${size===v?"rgba(200,168,112,.3)":"#1e3a5f20"}`,padding:"3px 8px",borderRadius:3})}}
                onMouseOver={hov} onMouseOut={uhov}>{l}</button>
            ))}
          </div>
        </div>

        {size==="scale"&&<Slider label="ZOOM" value={scale} min={50} max={400} onChange={setScale}/>}
        {size==="custom"&&(
          <div style={{marginBottom:8}}>
            <div style={{fontSize:8,color:"#6a7a8a",fontFamily:"Cinzel,serif",marginBottom:3}}>CUSTOM SIZE (e.g. 120% or 800px)</div>
            <input value={customSize} onChange={e=>setCustomSize(e.target.value)} style={{...iS,fontSize:10,marginTop:0}}
              onFocus={e=>e.target.style.borderColor=T.accent} onBlur={e=>e.target.style.borderColor=T.border}/>
          </div>
        )}

        <Slider label="PAN HORIZONTAL" value={posX} min={0} max={100} onChange={setPosX}/>
        <Slider label="PAN VERTICAL" value={posY} min={0} max={100} onChange={setPosY}/>
        <Slider label="BRIGHTNESS" value={brightness} min={30} max={180} onChange={setBrightness}/>
        <Slider label="SATURATION" value={saturation} min={0} max={200} onChange={setSaturation}/>

        <div style={{display:"flex",gap:8,marginTop:14}}>
          <button onClick={()=>onApply(fullBgCss,url,nm,filterStr)}
            style={{...btn("rgba(74,222,128,.1)","#4ade80",{flex:1,border:"1px solid rgba(74,222,128,.2)",fontFamily:"Cinzel,serif",fontSize:10})}}
            onMouseOver={hov} onMouseOut={uhov}>▶ Apply</button>
          <button onClick={()=>onSave(fullBgCss,url,nm,filterStr)}
            style={{...btn(`${T.accent}1a`,T.accent,{flex:1,border:`1px solid ${T.accent}40`,fontFamily:"Cinzel,serif",fontSize:10})}}
            onMouseOver={hov} onMouseOut={uhov}>💾 Save & Apply</button>
        </div>
        <button onClick={()=>{setScale(100);setPosX(50);setPosY(50);setBrightness(100);setSaturation(100);setSize("cover");}}
          style={{...btn("transparent","#4a6a8a",{width:"100%",marginTop:6,fontSize:8,border:"none"})}}
          onMouseOver={hov} onMouseOut={uhov}>↺ Reset</button>
      </div>
    </div>
  );
}

/* ─── GamematPicker ─────────────────────────────────────────────────── */
// Uses Scryfall art search to find official MTG art for gamemats
function GamematPicker({currentBg,customMats,onSelect,onSaveCustom,onClose}){
  const [tab,setTab]=useState("presets"); // "presets"|"art"|"custom"
  const [query,setQuery]=useState("");
  const [artResults,setArtResults]=useState([]);
  const [artLoading,setArtLoading]=useState(false);
  const [artPage,setArtPage]=useState(null); // next_page url
  const [previewUrl,setPreviewUrl]=useState(null);
  const [customUrl,setCustomUrl]=useState("");
  const [customName,setCustomName]=useState("");
  const [selectedArtForCrop,setSelectedArtForCrop]=useState(null); // {url,name} — show crop editor
  const tmr=useRef(null);

  // Art search via Scryfall — searches for cards with panoramic/full art
  const searchArt=async(url)=>{
    setArtLoading(true);
    try{
      const r=await fetch(url);
      if(r.ok){
        const d=await r.json();
        const imgs=(d.data||[]).map(c=>({
          name:c.name,
          set:c.set_name||c.set,
          url:c.image_uris?.art_crop||c.image_uris?.large||c.image_uris?.normal||c.card_faces?.[0]?.image_uris?.art_crop||null,
        })).filter(x=>x.url);
        setArtResults(prev=>url.includes("page=1")?imgs:[...prev,...imgs]);
        setArtPage(d.has_more?d.next_page:null);
      }
    }catch{}
    setArtLoading(false);
  };

  useEffect(()=>{
    if(tab!=="art")return;
    clearTimeout(tmr.current);
    const q=query.trim()||"forest";
    tmr.current=setTimeout(()=>{
      setArtResults([]);
      searchArt(`https://api.scryfall.com/cards/search?q=${encodeURIComponent(q+" is:fullart")}&unique=prints&order=name&page=1`);
    },400);
  },[query,tab]);

  // Default art searches
  const ART_PRESETS=["forest","plains","island","swamp","mountain","zendikar","ixalan","kamigawa","phyrexia","eldraine","ravnica"];

  return(
    <div className="fade-in" style={{position:"fixed",inset:0,background:"rgba(2,4,10,.95)",
      display:"flex",flexDirection:"column",zIndex:25000,backdropFilter:"blur(8px)"}}>
      {/* Header */}
      <div style={{display:"flex",alignItems:"center",gap:10,padding:"12px 18px",
        background:`linear-gradient(180deg,${T.panel},transparent)`,borderBottom:`1px solid ${T.accent}30`,flexShrink:0}}>
        <span style={{color:T.accent,fontFamily:"Cinzel Decorative,serif",fontSize:13}}>🖼 Game Mat</span>
        {/* Tabs */}
        {[["presets","🎨 Presets"],["art","🔍 MTG Art"],["custom","🔗 Custom URL"]].map(([t,l])=>(
          <button key={t} onClick={()=>setTab(t)}
            style={{...btn(tab===t?`${T.accent}20`:"transparent",tab===t?T.accent:"#4a6a8a",
              {border:`1px solid ${tab===t?"rgba(200,168,112,.4)":"#1e3a5f20"}`,fontSize:10,padding:"4px 12px"})}}
            onMouseOver={hov} onMouseOut={uhov}>{l}</button>
        ))}
        {tab==="art"&&(
          <input value={query} onChange={e=>setQuery(e.target.value)}
            placeholder="Search MTG art (e.g. 'forest', 'dragon', 'plains')…"
            style={{...iS,flex:1,maxWidth:340,marginTop:0,fontSize:10,padding:"4px 10px"}}
            onFocus={e=>e.target.style.borderColor=T.accent} onBlur={e=>e.target.style.borderColor=T.border}
            autoFocus/>
        )}
        <div style={{flex:1}}/>
        <button onClick={onClose} style={{...btn("transparent","#6a7a8a",{fontSize:16,border:"none"})}} onMouseOver={hov} onMouseOut={uhov}>✕</button>
      </div>

      {/* Art preset chips */}
      {tab==="art"&&(
        <div style={{display:"flex",gap:4,padding:"6px 18px",flexShrink:0,flexWrap:"wrap",borderBottom:`1px solid ${T.accent}15`}}>
          {ART_PRESETS.map(p=>(
            <button key={p} onClick={()=>setQuery(p)}
              style={{...btn(query===p?`${T.accent}20`:"transparent",query===p?T.accent:"#4a6a8a",
                {fontSize:9,border:`1px solid ${query===p?"rgba(200,168,112,.3)":"#1e3a5f20"}`,padding:"2px 9px",borderRadius:3})}}
              onMouseOver={hov} onMouseOut={uhov}>{p}</button>
          ))}
        </div>
      )}

      <div style={{flex:1,overflowY:"auto",padding:"12px 18px",display:"flex",flexWrap:"wrap",gap:10,alignContent:"flex-start"}}>

        {/* PRESETS TAB */}
        {tab==="presets"&&(
          <>
          {/* Built-in mats */}
          <div style={{width:"100%",fontSize:8,color:T.accent,fontFamily:"Cinzel,serif",letterSpacing:".12em",marginBottom:6}}>BUILT-IN MATS</div>
          {GAMEMATS.filter(g=>g.bg&&g.name!=="Custom").map(g=>(
            <div key={g.name}
              onClick={()=>{onSelect(g.bg,g.url,g.name);onClose();}}
              style={{cursor:"pointer",borderRadius:8,overflow:"hidden",
                border:`2px solid ${currentBg===g.bg?T.accent:"transparent"}`,
                boxShadow:currentBg===g.bg?`0 0 14px ${T.accent}60`:"0 3px 10px rgba(0,0,0,.6)",
                transition:"transform .15s,border-color .15s",position:"relative",width:160,height:90}}
              onMouseOver={e=>e.currentTarget.style.transform="scale(1.04)"}
              onMouseOut={e=>e.currentTarget.style.transform="none"}>
              <div style={{width:"100%",height:"100%",background:g.bg}}/>
              <div style={{position:"absolute",bottom:0,left:0,right:0,background:"rgba(2,4,10,.75)",
                padding:"3px 7px",fontSize:9,color:g.accent||T.accent,fontFamily:"Cinzel,serif"}}>{g.name}</div>
              {currentBg===g.bg&&<div style={{position:"absolute",top:4,right:4,fontSize:12}}>✓</div>}
            </div>
          ))}
          {/* Saved custom mats */}
          {(customMats||[]).length>0&&(
            <>
            <div style={{width:"100%",fontSize:8,color:"#60a5fa",fontFamily:"Cinzel,serif",letterSpacing:".12em",marginTop:10,marginBottom:6}}>SAVED CUSTOM MATS</div>
            {customMats.map(g=>(
              <div key={g.name}
                onClick={()=>{onSelect(g.bg,g.url,g.name);onClose();}}
                style={{cursor:"pointer",borderRadius:8,overflow:"hidden",
                  border:`2px solid ${currentBg===g.bg?T.accent:"transparent"}`,
                  boxShadow:currentBg===g.bg?`0 0 14px ${T.accent}60`:"0 3px 10px rgba(0,0,0,.6)",
                  transition:"transform .15s",position:"relative",width:160,height:90}}
                onMouseOver={e=>e.currentTarget.style.transform="scale(1.04)"}
                onMouseOut={e=>e.currentTarget.style.transform="none"}>
                <div style={{width:"100%",height:"100%",background:g.bg}}/>
                <div style={{position:"absolute",bottom:0,left:0,right:0,background:"rgba(2,4,10,.75)",
                  padding:"3px 7px",fontSize:9,color:"#60a5fa",fontFamily:"Cinzel,serif"}}>{g.name}</div>
              </div>
            ))}
            </>
          )}
          </>
        )}

        {/* ART TAB */}
        {tab==="art"&&(
          <>
          {artLoading&&artResults.length===0&&(
            <div style={{width:"100%",padding:20,textAlign:"center",color:T.accent,fontFamily:"Cinzel,serif",fontSize:10}}>
              🔮 Searching Scryfall art…
            </div>
          )}
          {artResults.map((a,i)=>{
            return(
                <div key={i}
                onClick={()=>setSelectedArtForCrop({url:a.url,name:`${a.name} (${a.set})`})}
                style={{cursor:"pointer",borderRadius:8,overflow:"hidden",position:"relative",
                  width:200,height:130,flexShrink:0,
                  border:`2px solid ${selectedArtForCrop?.url===a.url?T.accent:currentBg===`url(${a.url}) 50% 50%/cover no-repeat`?T.accent:"transparent"}`,
                  boxShadow:selectedArtForCrop?.url===a.url?`0 0 14px ${T.accent}60`:"0 3px 12px rgba(0,0,0,.7)",
                  transition:"transform .15s,border-color .15s"}}
                onMouseEnter={e=>{e.currentTarget.style.transform="scale(1.04)";setPreviewUrl(a.url);}}
                onMouseLeave={e=>{e.currentTarget.style.transform="none";setPreviewUrl(null);}}>
                <img src={a.url} alt={a.name} style={{width:"100%",height:"100%",objectFit:"cover",display:"block"}}/>
                <div style={{position:"absolute",bottom:0,left:0,right:0,background:"rgba(2,4,10,.8)",
                  padding:"3px 7px",fontSize:8,color:selectedArtForCrop?.url===a.url?T.accent:T.text,fontFamily:"Cinzel,serif",
                  overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis"}}>
                  {a.name} · {a.set}
                </div>
                <div style={{position:"absolute",top:4,right:4,fontSize:9,background:"rgba(5,10,18,.8)",
                  color:T.accent,padding:"1px 5px",borderRadius:3,fontFamily:"Cinzel,serif",opacity:.9}}>
                  ✂ Crop
                </div>
              </div>
            );
          })}
          {artPage&&!artLoading&&(
            <div style={{width:"100%",display:"flex",justifyContent:"center",padding:"10px 0"}}>
              <button onClick={()=>searchArt(artPage)}
                style={{...btn(`${T.accent}1a`,T.accent,{border:`1px solid ${T.accent}40`,padding:"6px 22px",fontFamily:"Cinzel,serif"})}}
                onMouseOver={hov} onMouseOut={uhov}>Load More…</button>
            </div>
          )}
          {artLoading&&artResults.length>0&&<div style={{width:"100%",textAlign:"center",padding:10,color:"#4a6a8a",fontSize:9,fontFamily:"Cinzel,serif"}}>Loading…</div>}
          {!artLoading&&artResults.length===0&&query&&(
            <div style={{width:"100%",padding:20,textAlign:"center",color:T.border,fontFamily:"Cinzel,serif",fontSize:11,fontStyle:"italic"}}>
              No art found — try a different search
            </div>
          )}
          {/* Art crop editor — shown when an art thumbnail is clicked */}
          {selectedArtForCrop&&(
            <div style={{width:"100%",borderTop:`1px solid ${T.accent}30`,paddingTop:14,marginTop:10}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
                <span style={{color:T.accent,fontFamily:"Cinzel,serif",fontSize:11}}>✂ Crop & Adjust — {selectedArtForCrop.name}</span>
                <button onClick={()=>setSelectedArtForCrop(null)} style={{...btn("transparent","#6a7a8a",{fontSize:13,border:"none"})}} onMouseOver={hov} onMouseOut={uhov}>✕</button>
              </div>
              <MatCropEditor
                url={selectedArtForCrop.url}
                name={selectedArtForCrop.name}
                onApply={(bgCss,url,name,filterStr)=>{onSelect(bgCss,url,name,filterStr);onClose();}}
                onSave={(bgCss,url,name,filterStr)=>{onSaveCustom(bgCss,url,name,filterStr);onClose();}}/>
            </div>
          )}
          </>
        )}

        {/* CUSTOM URL TAB — with crop/resize/pan controls */}
        {tab==="custom"&&(
          <div style={{width:"100%",maxWidth:600}}>
            <div style={{fontSize:9,color:"#4a6a8a",fontFamily:"Cinzel,serif",lineHeight:1.7,marginBottom:12}}>
              Paste any image URL, then use the controls to crop, zoom and pan it exactly how you want it on the playmat.
            </div>
            <input value={customUrl} onChange={e=>{setCustomUrl(e.target.value);}}
              placeholder="https://example.com/image.jpg  or paste a Scryfall/Imgur URL…"
              style={{...iS,marginBottom:10}}
              onFocus={e=>e.target.style.borderColor=T.accent} onBlur={e=>e.target.style.borderColor=T.border}/>
            <input value={customName} onChange={e=>setCustomName(e.target.value)}
              placeholder="Name this mat (optional)…"
              style={{...iS,marginBottom:14}}
              onFocus={e=>e.target.style.borderColor=T.accent} onBlur={e=>e.target.style.borderColor=T.border}/>
            {customUrl&&<MatCropEditor
              url={customUrl}
              onApply={(bgCss,url,name,filterStr)=>{onSelect(bgCss,url,name,filterStr);onClose();}}
              onSave={(bgCss,url,name,filterStr)=>{onSaveCustom(bgCss,url,name,filterStr);onClose();}}
              name={customName}/>
            }
            {!customUrl&&(
              <div style={{padding:"40px 20px",textAlign:"center",border:`1px dashed ${T.border}40`,borderRadius:8,color:"#3a5a7a",fontFamily:"Cinzel,serif",fontSize:10,fontStyle:"italic"}}>
                Paste an image URL above to begin
              </div>
            )}
          </div>
        )}
      </div>

      {/* Full art hover preview */}
      {previewUrl&&(
        <div style={{position:"fixed",bottom:16,right:16,zIndex:99999,borderRadius:10,overflow:"hidden",
          width:320,height:200,border:`2px solid ${T.accent}60`,boxShadow:"0 12px 40px rgba(0,0,0,.95)"}}>
          <img src={previewUrl} alt="preview" style={{width:"100%",height:"100%",objectFit:"cover"}}/>
        </div>
      )}
    </div>
  );
}

/* ─── FlyingCardAnim ─── card flies with mid-flight 3D flip ──────── */
function FlyingCardAnim({cards,onDone}){
  useEffect(()=>{
    if(!cards.length)return;
    const maxDelay=cards.reduce((m,c)=>Math.max(m,(c.delay||0)+(c.dur||600)),0);
    const t=setTimeout(onDone,maxDelay+200);
    return()=>clearTimeout(t);
  },[cards]);

  return(
    <>
    {cards.map(c=>{
      const dx=c.toX-c.fromX, dy=c.toY-c.fromY;
      const dist=Math.sqrt(dx*dx+dy*dy);
      const dur=c.dur||500;
      const delay=c.delay||0;
      const id=c.id.replace(/[^a-z0-9]/gi,"_");
      // startRot: initial Z rotation (e.g. 90 for landscape deck card)
      // endRot: final Z rotation (e.g. 90 for mill to grave/exile)
      const sr=c.startRot||0;
      const er=c.endRot||0;

      return(
        <div key={c.id} style={{
          position:"fixed",
          left:c.fromX,top:c.fromY,
          width:CW,height:CH,
          pointerEvents:"none",
          zIndex:99996,
          perspective:"500px",
          animation:`flyMove_${id} ${dur}ms cubic-bezier(0.25,0.46,0.45,0.94) ${delay}ms both`,
        }}>
          <style>{`
            @keyframes flyMove_${id}{
              0%  {transform:translate(0px,0px);}
              100%{transform:translate(${dx}px,${dy}px);}
            }
            @keyframes flyFlip_${id}{
              0%  {transform:rotateZ(${sr}deg) rotateY(0deg)   scale(1);    opacity:1;}
              45% {transform:rotateZ(${(sr+er)/2}deg) rotateY(90deg) scale(1.12); opacity:1;}
              100%{transform:rotateZ(${er}deg) rotateY(0deg)   scale(.65); opacity:0;}
            }
          `}</style>
          <div style={{
            width:"100%",height:"100%",
            transformStyle:"preserve-3d",
            borderRadius:5,
            boxShadow:`0 10px 30px rgba(0,0,0,.9),0 0 20px ${c.glow||"rgba(200,168,112,.5)"}`,
            animation:`flyFlip_${id} ${dur}ms cubic-bezier(0.4,0,0.2,1) ${delay}ms both`,
          }}>
            <div style={{position:"absolute",inset:0,borderRadius:5,overflow:"hidden",backfaceVisibility:"hidden",WebkitBackfaceVisibility:"hidden"}}>
              <img src={c.img||CARD_BACK} alt="" style={{width:"100%",height:"100%",objectFit:"cover",display:"block"}}/>
            </div>
            {c.backImg&&(
              <div style={{position:"absolute",inset:0,borderRadius:5,overflow:"hidden",backfaceVisibility:"hidden",WebkitBackfaceVisibility:"hidden",transform:"rotateY(180deg)"}}>
                <img src={c.backImg} alt="" style={{width:"100%",height:"100%",objectFit:"cover",display:"block"}}/>
              </div>
            )}
          </div>
        </div>
      );
    })}
    </>
  );
}


/* ─── OpponentTile (v7 Phase 2) ───────────────────────────────────────
   Compact read-only view of a non-primary opponent. Shown for 3p/4p games.
   Displays their avatar, alias, life, library count, battlefield mini,
   and hand-as-sleeves. Click to promote them to "primary opponent" (the
   one whose strip appears at the top of the main GameBoard).
   ─────────────────────────────────────────────────────────────────── */
function OpponentTile({opp, seat, isActive, onPromote}){
  if (!opp) return null;
  const life = opp.life ?? 20;
  const lifeColor = life<=5?"#f87171":life<=10?"#fbbf24":"#e8e2d0";
  const sleeve = opp.deck?.sleeveUri || CARD_BACK;
  return (
    <div onClick={onPromote}
      style={{
        pointerEvents:"auto",
        background:`linear-gradient(165deg, ${T.panel}f2, ${T.bg}fc)`,
        border:`1px solid ${isActive?T.accent:T.border}60`,
        borderRadius:8,
        padding:"8px 10px",
        cursor:"pointer",
        boxShadow: isActive
          ? `0 0 20px ${T.accent}30, 0 4px 12px rgba(0,0,0,.5)`
          : "0 4px 12px rgba(0,0,0,.5)",
        transition:"all .2s ease",
        display:"flex",flexDirection:"column",gap:6,
        fontFamily:"Crimson Text,serif",
      }}
      onMouseOver={e=>{e.currentTarget.style.borderColor=T.accent+"a0";e.currentTarget.style.transform="translateX(-3px)";}}
      onMouseOut={e=>{e.currentTarget.style.borderColor=(isActive?T.accent:T.border)+"60";e.currentTarget.style.transform="none";}}
      title="Click to view this opponent on the main board"
    >
      {/* Header row: avatar + alias + life */}
      <div style={{display:"flex",alignItems:"center",gap:6}}>
        {opp.profile?.avatarImg
          ? <img src={opp.profile.avatarImg} alt="" style={{width:22,height:22,borderRadius:"50%",objectFit:"cover",border:`1px solid ${T.accent}40`}}/>
          : <span style={{fontSize:16,filter:`drop-shadow(0 0 4px ${T.accent}60)`}}>{opp.profile?.avatar||"🧙"}</span>}
        <div style={{flex:1,minWidth:0,overflow:"hidden"}}>
          <div style={{fontSize:11,color:T.text,fontFamily:"Cinzel,serif",letterSpacing:".03em",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
            {opp.profile?.alias||`Player ${seat+1}`}
          </div>
          <div style={{fontSize:8,color:"#6a7a8a",letterSpacing:".08em",fontFamily:"Cinzel,serif",textTransform:"uppercase"}}>
            Seat {seat+1} {isActive && <span style={{color:T.accent}}>· ACTIVE</span>}
          </div>
        </div>
        <div style={{
          fontFamily:"Cinzel Decorative,serif",fontSize:15,color:lifeColor,
          textShadow:life<=5?"0 0 10px #f87171":"none",
        }}>♥{life}</div>
      </div>

      {/* Battlefield mini */}
      <div style={{
        background:"rgba(3,6,12,.55)",
        border:`1px solid ${T.border}20`,borderRadius:5,
        padding:4,minHeight:52,maxHeight:80,
        display:"flex",flexWrap:"wrap",gap:2,overflow:"hidden",alignContent:"flex-start",
      }}>
        {(opp.battlefield||[]).length===0
          ? <div style={{fontSize:8,color:"#2a3a5a",fontStyle:"italic",alignSelf:"center",margin:"auto"}}>— empty —</div>
          : (opp.battlefield||[]).slice(0,12).map(c=>(
              <div key={c.iid} style={{
                width:18,height:26,borderRadius:2,overflow:"hidden",
                border:"1px solid rgba(200,168,112,.15)",flexShrink:0,
                transform:c.tapped?"rotate(12deg)":"none",
                opacity:c.tapped?.75:1,
              }}>
                <img src={(c.imageUri||c.image_uris?.small||getImg(c))||CARD_BACK} alt=""
                  style={{width:"100%",height:"100%",objectFit:"cover",display:"block"}}/>
              </div>
            ))}
        {(opp.battlefield||[]).length>12 && (
          <div style={{fontSize:7,color:T.accent,fontFamily:"Cinzel,serif",alignSelf:"center",padding:"0 3px"}}>
            +{opp.battlefield.length-12}
          </div>
        )}
      </div>

      {/* Hand-as-sleeves + counts */}
      <div style={{display:"flex",alignItems:"center",gap:4,fontSize:9,color:"#6a7a8a"}}>
        <span title="Library">📚{(opp.library||[]).length}</span>
        <span title="Graveyard">☠{(opp.graveyard||[]).length}</span>
        <span title="Exile">✦{(opp.exile||[]).length}</span>
        <div style={{flex:1}}/>
        <div style={{display:"flex",gap:1}}>
          {(opp.hand||[]).slice(0,6).map((_,i)=>(
            <div key={i} style={{
              width:14,height:20,borderRadius:2,overflow:"hidden",
              border:"1px solid #2a3a5a",flexShrink:0,
            }}>
              <img src={sleeve} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/>
            </div>
          ))}
        </div>
        <span style={{fontSize:9}}>✋{(opp.hand||[]).length}</span>
      </div>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════
// v7.6 Phase 0 — BoardSide
// Identity refactor of the local player half extracted from GameBoard. Takes
// all state, refs, and callbacks as explicit props (no context, no closure
// capture) so hooks order inside GameBoard is unchanged. Future phases mount
// this twice: once interactive for the local player, once readOnly + parent-
// rotated 180° for each opponent.
// ═══════════════════════════════════════════════════════════════════════════
function BoardSide({
  // ── state reads ────────────────────────────────────────────────────────
  player, T, currentPhaseColor,
  gamemat, gamematFilter,
  showDeckViewer, showChangeDeck, showGamematPicker,
  copyMode, cmdSummonAnim,
  customMats, decks,
  selected, selZone, selRect,
  graveIdx, exileIdx,
  // ── refs ───────────────────────────────────────────────────────────────
  bfRef, cmdRef, libRef, graveRef, exileRef,
  selRectRef, lastRightClick,
  // ── setters ────────────────────────────────────────────────────────────
  setCtxMenu, setHovered, setSelected, setSelZone, setSelRect,
  setCopyMode,
  setShowDeckViewer, setShowChangeDeck, setShowGamematPicker,
  setShowSearchLib, setShowGraveViewer, setShowExileViewer,
  setGraveIdx, setExileIdx, setCustomMats,
  // ── GameBoard-scoped callbacks ─────────────────────────────────────────
  upd, addLog, handleCtx, handleCardBFMouseDown, startFloatDrag,
  tap, swapDeck, draw, shuffle,
  // ── v7.6 Phase 2: HandOverlay integration ─────────────────────────────
  // `containerRef` is attached to this BoardSide's root <div> so the inner
  // HandOverlay can compute card positions relative to this container. Under
  // a parent transform:rotate(180deg) (Phase 3), the overlay rotates with us.
  containerRef, hand, handRef, hovered, floatDrag,
  readOnly = false,
  // ── v7.6 Phase 4-B: zone-request trigger (opp side only) ──────────────
  // Called with (zoneName, event) when the viewer right-clicks the hand,
  // graveyard, or exile tile on a readOnly BoardSide. Only wired on the opp
  // mount; undefined for the local mount (right-click retains existing
  // card-context-menu semantics via `handleCtx`).
  onZoneRequest,
}){
  return (
        <div ref={containerRef} style={{flex:1,display:"flex",overflow:"visible",minHeight:0,position:"relative"}}>

          {/* Battlefield */}
          <div ref={bfRef}
            style={{flex:1,position:"relative",overflow:"visible",background:"none",filter:"none"}}
            onClick={e=>e.stopPropagation()}
          onMouseDown={e=>{
            if(e.button!==0)return;
            // Only start rect select if clicking empty BF (not a card)
            if(e.target!==bfRef.current&&e.target.closest('[data-card]'))return;
            if(e.ctrlKey||e.metaKey)return;
            const rect=bfRef.current.getBoundingClientRect();
            const sx=e.clientX-rect.left, sy=e.clientY-rect.top;
            selRectRef.current={startX:sx,startY:sy,active:true};
            setSelRect({x1:sx,y1:sy,x2:sx,y2:sy});
            if(!e.ctrlKey&&!e.metaKey)setSelected(new Set());
          }}>
            <div style={{position:"absolute",inset:0,
              background:"radial-gradient(ellipse at 50% 50%,transparent 40%,rgba(2,4,10,.5) 100%)",
              pointerEvents:"none"}}/>
            <div style={{position:"absolute",inset:0,
              background:"radial-gradient(ellipse at 20% 30%,rgba(200,168,112,.015) 0%,transparent 50%),radial-gradient(ellipse at 80% 70%,rgba(96,165,250,.01) 0%,transparent 50%)",
              pointerEvents:"none"}}/>
            <div style={{position:"absolute",top:5,left:8,fontSize:7,
              color:"rgba(200,168,112,.12)",fontFamily:"Cinzel,serif",letterSpacing:".2em",pointerEvents:"none",userSelect:"none"}}>
              {player.profile?.alias||""}
            </div>
            {/* Gamemat background — clipped to BF bounds */}
            <div style={{position:"absolute",inset:0,background:gamemat,
              filter:gamematFilter&&gamematFilter!=="none"?gamematFilter:undefined,
              overflow:"hidden",borderRadius:0,zIndex:0,pointerEvents:"none"}}/>
            {/* Selection rectangle */}
            {selRect&&(()=>{
              const minX=Math.min(selRect.x1,selRect.x2);
              const minY=Math.min(selRect.y1,selRect.y2);
              const w=Math.abs(selRect.x2-selRect.x1);
              const h=Math.abs(selRect.y2-selRect.y1);
              return(
                <div style={{position:"absolute",left:minX,top:minY,width:w,height:h,
                  border:`1px solid ${T.accent}`,background:`${T.accent}12`,
                  borderRadius:2,pointerEvents:"none",zIndex:100,
                  boxShadow:`0 0 8px ${T.accent}30`}}/>
              );
            })()}
            {/* cards */}
            {player.battlefield.map(card=>(
              <div key={card.iid} data-iid={card.iid} style={{position:"absolute",left:card.x,top:card.y,zIndex:isLand(card)?1:3}}>
                <CardImg card={card} tapped={card.tapped} faceDown={card.faceDown}
                  selected={selected.has(card.iid)} size="md"
                  data-card="1"
                  onClick={e=>{
                    e.stopPropagation();
                    if(copyMode){
                      const srcCard=copyMode.card;
                      const targetImg=getImg(card)||card.imageUri;
                      upd(p=>({...p,battlefield:p.battlefield.map(c=>c.iid===srcCard.iid?{...c,isCopy:true,copyImageUri:targetImg}:c)}));
                      addLog(`⧉ ${srcCard.name} became a copy of ${card.name}`);
                      setCopyMode(null);
                      return;
                    }
                    // Double left click = tap/untap
                    const now=Date.now();
                    const last=lastRightClick.current;
                    if(last.iid===card.iid&&now-last.time<350&&!e.ctrlKey&&!e.metaKey){
                      tap(card);
                      addLog(`${card.tapped?"⟳ Untapped":"⟳ Tapped"} ${card.name}`);
                      lastRightClick.current={iid:null,time:0};
                      return;
                    }
                    lastRightClick.current={iid:card.iid,time:now};
                    if(!e.ctrlKey&&!e.metaKey){setSelected(s=>{const n=new Set();n.add(card.iid);return n;});setSelZone("battlefield");}
                    setHovered(card);
                  }}
                  onCtx={e=>handleCtx(e,card,"battlefield")} onHover={setHovered} onHoverEnd={()=>setHovered(null)}
                  onMouseDown={e=>handleCardBFMouseDown(e,card)}
                  onCounterClick={(e,k,v)=>setCtxMenu({x:e.clientX,y:e.clientY,card,zone:"battlefield",counterKey:k,counterVal:v})}/>
              </div>
            ))}

            {/* Deck Viewer overlay at bottom of BF */}
            {showDeckViewer&&(
              <DeckViewer library={player.library} revealTop={player.revealTop}
                onClose={()=>setShowDeckViewer(false)}
                onCtx={handleCtx} onHover={setHovered} onHoverEnd={()=>setHovered(null)} onDragStart={startFloatDrag}
                onDraw={()=>draw(1)} onShuffle={shuffle}/>
            )}
            {showChangeDeck&&(
              <div onClick={()=>setShowChangeDeck(false)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.85)",zIndex:9996,display:"flex",alignItems:"center",justifyContent:"center",backdropFilter:"blur(4px)"}}>
                <div onClick={e=>e.stopPropagation()} className="fade-in" style={{
                  background:`linear-gradient(160deg,${T.panel}fa,${T.bg}fd)`,
                  border:`1px solid ${T.accent}50`,borderRadius:12,padding:24,
                  width:520,maxWidth:"92vw",maxHeight:"88vh",overflowY:"auto",
                  boxShadow:"0 32px 100px rgba(0,0,0,.95)"}}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
                    <h3 className="shimmer-text" style={{fontFamily:"Cinzel Decorative,serif",fontSize:16,letterSpacing:".06em"}}>⇄ Change Deck</h3>
                    <button onClick={()=>setShowChangeDeck(false)}
                      style={{...btn(`${T.panel}99`,"#8a99b0",{border:`1px solid ${T.border}`,fontSize:10,padding:"4px 10px"})}}
                      onMouseOver={hov} onMouseOut={uhov}>Cancel</button>
                  </div>
                  <div style={{fontSize:11,color:"#6a7a8a",fontFamily:"Crimson Text,serif",lineHeight:1.5,marginBottom:16,padding:"8px 10px",borderRadius:6,background:"rgba(220,38,38,.06)",border:"1px solid rgba(220,38,38,.15)"}}>
                    ⚠ This will scoop all your current cards (battlefield, hand, graveyard, exile, command)
                    and replace them with a fresh shuffled library + opening hand from the chosen deck.
                    Life, turn number, and phase are preserved.
                  </div>
                  {(!decks || decks.length===0)?(
                    <div style={{color:T.border,fontSize:12,textAlign:"center",padding:"24px 12px",fontStyle:"italic"}}>
                      No decks available. Go back to the menu and create one first.
                    </div>
                  ):(
                    <div style={{display:"flex",flexDirection:"column",gap:6}}>
                      {decks.map(d=>(
                        <button key={d.id} onClick={()=>{swapDeck(d);setShowChangeDeck(false);}}
                          style={{...btn(d.id===player.deck?.id?`${T.accent}1a`:`${T.panel}aa`,
                            d.id===player.deck?.id?T.accent:T.text,
                            {textAlign:"left",padding:"10px 14px",border:`1px solid ${d.id===player.deck?.id?T.accent+"60":T.border+"30"}`,display:"flex",justifyContent:"space-between",alignItems:"center"})}}
                          onMouseOver={hov} onMouseOut={uhov}>
                          <span style={{fontFamily:"Cinzel,serif",fontSize:12}}>
                            {d.id===player.deck?.id?"◉ ":""}{d.name}
                          </span>
                          <span style={{fontSize:10,color:"#6a7a8a"}}>
                            {(d.cards||[]).reduce((s,c)=>s+(c.count||1),0)} cards · {d.format||"standard"}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div style={{width:190,display:"flex",flexDirection:"column",gap:2,padding:"3px",
            background:T.panelTex||`linear-gradient(180deg,${T.panel},${T.bg})`,
            borderLeft:`1px solid ${currentPhaseColor}15`,overflowY:"hidden",
            alignSelf:"stretch",marginBottom:-HAND_H,paddingBottom:HAND_H}}>

            {/* ── COMMAND ZONE ── */}
            {player.command.length>0&&(
              <div ref={cmdRef} className="drop-target"
                style={{background:`linear-gradient(160deg,${T.accent}08,${T.bg})`,
                  border:`1px solid ${T.accent}40`,borderRadius:8,padding:"4px 4px 4px",marginBottom:2}}>
                <div style={{color:`${T.accent}90`,fontFamily:"Cinzel,serif",fontSize:7,letterSpacing:".18em",marginBottom:3,textAlign:"center",textTransform:"uppercase",lineHeight:1}}>Command Zone</div>
                <div style={{display:"grid",gridTemplateColumns:player.command.length<=2?"1fr 1fr":"1fr 1fr",gap:3,justifyItems:"center"}}>
                  {player.command.map(card=>{
                    const isAway=card.status==="away"||card.status==="dead"||card.status==="exiled";
                    return(
                    <div key={card.iid} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:player.command.length>2?1:3}}
                      onMouseDown={e=>{
                        if(e.button!==0)return;
                        if(isAway)return; // blocked — must return to command zone first
                        startFloatDrag(e,{...card,isCommander:true},"command");
                      }}>
                      {/* Portrait */}
                      <div style={{position:"relative",cursor:isAway?"not-allowed":"grab",
                        animation:cmdSummonAnim?"cmdPortraitPulse .4s ease-in-out 3":undefined}}>
                        <CardImg card={card} size={player.command.length>2?"sm":"md"}
                          onCtx={e=>handleCtx(e,card,"command")}
                          onHover={setHovered} onHoverEnd={()=>setHovered(null)}
                          onClick={e=>{e.stopPropagation();setHovered(card);}}/>
                        {/* Away/blocked overlay — commander has left the command zone */}
                        {isAway&&(
                          <div style={{position:"absolute",inset:0,borderRadius:6,background:"rgba(0,0,0,.55)",
                            display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",pointerEvents:"none"}}>
                            <span style={{fontSize:card.status==="dead"?26:card.status==="exiled"?22:18}}>
                              {card.status==="dead"?"☠":card.status==="exiled"?"✦":"⚔"}
                            </span>
                            <span style={{fontSize:7,color:"rgba(255,255,255,.5)",fontFamily:"Cinzel,serif",marginTop:2}}>
                              {card.status==="dead"?"in grave":card.status==="exiled"?"exiled":"in play"}
                            </span>
                          </div>
                        )}
                      </div>
                      {/* Name */}
                      <div style={{fontSize:8,color:card.status?"#4a6a8a":T.accent,fontFamily:"Cinzel,serif",
                        textAlign:"center",maxWidth:player.command.length>2?46:72,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",lineHeight:1}}>{card.name}</div>
                      {/* Tax counter — below portrait, symmetrical −/number/+. In
                          readOnly, buttons are hidden and the pill is display-only
                          so viewers still see opp's commander tax value. */}
                      <div style={{display:"flex",alignItems:"center",gap:3}}>
                        {!readOnly&&<button
                          onClick={e=>{e.stopPropagation();upd(p=>({...p,command:p.command.map(c=>c.iid===card.iid?{...c,castCount:Math.max(0,(c.castCount||0)-1)}:c)}));}}
                          style={{width:player.command.length>2?13:18,height:player.command.length>2?13:18,borderRadius:3,background:"rgba(200,168,112,.08)",border:"1px solid rgba(200,168,112,.2)",color:T.accent,fontSize:player.command.length>2?9:12,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"Cinzel,serif",lineHeight:1}}
                          onMouseOver={hov} onMouseOut={uhov}>−</button>}
                        <div style={{display:"flex",alignItems:"center",gap:2,
                          background:(card.castCount||0)>0?"rgba(251,191,36,.1)":"rgba(200,168,112,.06)",
                          border:`1px solid ${(card.castCount||0)>0?"rgba(251,191,36,.4)":"rgba(200,168,112,.2)"}`,
                          borderRadius:4,padding:player.command.length>2?"0 3px":"1px 5px",cursor:readOnly?"default":"pointer",minWidth:player.command.length>2?28:42,justifyContent:"center"}}
                          onClick={readOnly?undefined:(e=>{
                            e.stopPropagation();
                            const cur=card.castCount||0;
                            const input=window.prompt("Set cast count:",String(cur));
                            if(input===null)return;
                            const n=parseInt(input);
                            if(!isNaN(n)&&n>=0) upd(p=>({...p,command:p.command.map(c=>c.iid===card.iid?{...c,castCount:n}:c)}));
                          })}
                          title={readOnly?"Commander cast count":"Click to edit cast count"}>
                          <span style={{fontSize:player.command.length>2?7:9}}>💎</span>
                          <span style={{fontSize:player.command.length>2?7:9,fontFamily:"Cinzel Decorative,serif",fontWeight:700,
                            color:(card.castCount||0)>0?"#fbbf24":T.accent}}>
                            +{(card.castCount||0)*2}
                          </span>
                        </div>
                        {!readOnly&&<button
                          onClick={e=>{e.stopPropagation();upd(p=>({...p,command:p.command.map(c=>c.iid===card.iid?{...c,castCount:(c.castCount||0)+1}:c)}));}}
                          style={{width:player.command.length>2?13:18,height:player.command.length>2?13:18,borderRadius:3,background:"rgba(200,168,112,.08)",border:"1px solid rgba(200,168,112,.2)",color:T.accent,fontSize:player.command.length>2?9:12,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"Cinzel,serif",lineHeight:1}}
                          onMouseOver={hov} onMouseOut={uhov}>+</button>}
                      </div>
                    </div>
                  );})}
                </div>

              </div>
            )}

            {/* ── Deck widget ── */}
            <div ref={libRef} className="drop-target"
              style={{background:`linear-gradient(160deg,${T.panel},${T.bg})`,border:`1px solid ${T.border}20`,borderRadius:7,padding:"3px 3px 3px"}}>
              {/* Title row — compact, centered */}
              <div style={{textAlign:"center",lineHeight:1,marginBottom:2,display:"flex",alignItems:"center",justifyContent:"center",gap:3}}>
                <span style={{color:T.accent,fontFamily:"Cinzel,serif",fontSize:8,letterSpacing:".1em"}}>DECK</span>
                <span style={{color:player.library.length<=5?"#f87171":player.library.length<=10?"#fbbf24":T.accent,fontSize:8}}>{player.library.length}</span>
                {!readOnly&&<button onClick={()=>setShowSearchLib(v=>!v)}
                  style={{...btn(`${T.panel}99`,"#8a99b0",{fontSize:7,border:`1px solid ${T.border}20`,padding:"0px 3px",lineHeight:"14px"})}}
                  onMouseOver={hov} onMouseOut={uhov}>🔍</button>}
              </div>
              {/* Card landscape: portrait img rotated 90deg, centered via absolute positioning */}
              <div style={{position:"relative",width:"100%",height:player.command.length>2?54:72,overflow:"hidden"}}
                onContextMenu={e=>{e.preventDefault();if(player.library[0]){const c=(player.revealTop||player.revealTopOnce===player.library[0]?.iid)?player.library[0]:{...player.library[0],name:"Top of Deck",imageUri:null,card_faces:null,image_uris:null};handleCtx(e,c,"library");}}}
                onMouseDown={e=>{
                  if(e.button!==0||!player.library[0])return;
                  e.preventDefault();
                  const t=setTimeout(()=>startFloatDrag(e,{...player.library[0],zone:"library"},"library"),300);
                  const cancel=()=>{clearTimeout(t);window.removeEventListener("mouseup",cancel);};
                  window.addEventListener("mouseup",cancel);
                }}>
                <img
                  src={(player.revealTop||player.revealTopOnce===player.library[0]?.iid)&&player.library[0]?getImg(player.library[0])||CARD_BACK:(player.deck?.sleeveUri||CARD_BACK)}
                  alt="top"
                  style={{
                    width:72,height:101,borderRadius:4,objectFit:"cover",display:"block",
                    position:"absolute",
                    top:"50%",left:"50%",
                    transform:"translate(-50%,-50%) rotate(90deg)",
                    border:`1px solid ${(player.revealTop||player.revealTopOnce===player.library[0]?.iid)?T.accent:"#1e3a5f40"}`,
                    boxShadow:(player.revealTop||player.revealTopOnce===player.library[0]?.iid)?`0 0 12px ${T.accent}40`:"0 3px 10px rgba(0,0,0,.7)",
                    cursor:player.library[0]?"grab":"default",
                  }}/>
              </div>
              {(player.revealTop||player.revealTopOnce===player.library[0]?.iid)&&player.library[0]&&(
                <div style={{fontSize:7,color:T.accent,textAlign:"center",marginTop:2,fontStyle:"italic",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                  {player.library[0].name}
                </div>
              )}
            </div>

            {/* Graveyard */}
            {/* Graveyard + Exile side by side */}
            <div style={{display:"flex",gap:3}}>

              <div ref={graveRef} className="drop-target mtg-zone" data-zone="graveyard"
                style={{flex:1,background:`linear-gradient(160deg,${T.panel},${T.bg})`,border:`1px solid #1e3a5f20`,borderRadius:7,padding:"3px 3px 3px",cursor:readOnly?"context-menu":"pointer",minWidth:0}}
                onClick={readOnly?undefined:()=>setShowGraveViewer(true)}
                onContextMenu={readOnly&&onZoneRequest?(e=>{e.preventDefault();onZoneRequest("graveyard",e);}):undefined}
                onWheel={e=>{e.preventDefault();e.stopPropagation();
                  if(!player.graveyard.length)return;
                  setGraveIdx(prev=>{
                    const len=player.graveyard.length;
                    const next=((prev+(e.deltaY>0?1:-1))%len+len)%len;
                    setHovered(player.graveyard[next]);
                    return next;
                  });
                }}>
                <div style={{color:"#a78bfa",fontFamily:"Cinzel,serif",fontSize:8,letterSpacing:".1em",textAlign:"center",marginBottom:2,lineHeight:1,display:"flex",alignItems:"center",justifyContent:"center",gap:3}}>
                  <span>GRAVE {player.graveyard.length}</span>
                  {!readOnly&&<span style={{cursor:"pointer",opacity:.6,fontSize:9}} onClick={e=>{e.stopPropagation();setShowGraveViewer(true);}}>🔍</span>}
                </div>
                <div style={{display:"flex",justifyContent:"center"}}>
                {player.graveyard.length>0?(
                  <div style={{position:"relative"}} onClick={e=>e.stopPropagation()}
                    onMouseDown={e=>{e.stopPropagation();if(readOnly)return;if(e.button===0)startFloatDrag(e,player.graveyard[graveIdx],"graveyard");}}
                    onContextMenu={e=>{
                      e.preventDefault();
                      e.stopPropagation();
                      if(readOnly&&onZoneRequest){ onZoneRequest("graveyard",e); }
                      else { handleCtx(e,player.graveyard[graveIdx],"graveyard"); }
                    }}>
                    <CardImg card={player.graveyard[graveIdx]??player.graveyard[player.graveyard.length-1]} size={player.command.length>2?"sm":"md"} onHover={setHovered} onHoverEnd={()=>setHovered(null)}/>
                  </div>
                ):(
                  <div style={{height:38,display:"flex",alignItems:"center",justifyContent:"center",color:"#3a3a5a",fontSize:8,fontStyle:"italic"}}>—</div>
                )}
                </div>
              </div>

              <div ref={exileRef} className="drop-target mtg-zone" data-zone="exile"
                style={{flex:1,background:`linear-gradient(160deg,${T.panel},${T.bg})`,border:`1px solid #1e3a5f20`,borderRadius:7,padding:"3px 3px 3px",cursor:readOnly?"context-menu":"pointer",minWidth:0}}
                onClick={readOnly?undefined:()=>setShowExileViewer(true)}
                onContextMenu={readOnly&&onZoneRequest?(e=>{e.preventDefault();onZoneRequest("exile",e);}):undefined}
                onWheel={e=>{e.preventDefault();e.stopPropagation();
                  if(!player.exile.length)return;
                  setExileIdx(prev=>{
                    const len=player.exile.length;
                    const next=((prev+(e.deltaY>0?1:-1))%len+len)%len;
                    setHovered(player.exile[next]);
                    return next;
                  });
                }}>
                <div style={{color:"#60a5fa",fontFamily:"Cinzel,serif",fontSize:8,letterSpacing:".1em",textAlign:"center",marginBottom:2,lineHeight:1,display:"flex",alignItems:"center",justifyContent:"center",gap:3}}>
                  <span>EXILE {player.exile.length}</span>
                  {!readOnly&&<span style={{cursor:"pointer",opacity:.6,fontSize:9}} onClick={e=>{e.stopPropagation();setShowExileViewer(true);}}>🔍</span>}
                </div>
                <div style={{display:"flex",justifyContent:"center"}}>
                {player.exile.length>0?(
                  <div style={{position:"relative"}} onClick={e=>e.stopPropagation()}
                    onMouseDown={e=>{e.stopPropagation();if(readOnly)return;if(e.button===0)startFloatDrag(e,player.exile[exileIdx],"exile");}}
                    onContextMenu={e=>{
                      e.preventDefault();
                      e.stopPropagation();
                      if(readOnly&&onZoneRequest){ onZoneRequest("exile",e); }
                      else { handleCtx(e,player.exile[exileIdx],"exile"); }
                    }}>
                    <CardImg card={player.exile[exileIdx]??player.exile[player.exile.length-1]} size={player.command.length>2?"sm":"md"} onHover={setHovered} onHoverEnd={()=>setHovered(null)}/>
                  </div>
                ):(
                  <div style={{height:38,display:"flex",alignItems:"center",justifyContent:"center",color:"#3a3a5a",fontSize:8,fontStyle:"italic"}}>—</div>
                )}
                </div>
              </div>

            </div>

            {/* In-game gamemat change */}
            {showGamematPicker&&(
              <GamematPicker
                currentBg={player.profile?.gamemat}
                customMats={customMats}
                onSelect={(bg,url,name,filterStr)=>{
                  upd(p=>({...p,profile:{...p.profile,gamemat:bg,gamematCustom:url||"",gamematFilter:filterStr||""}}));
                  try{window.__MTG_V7__?.saveProfile?.({...player.profile, gamemat:bg, gamematCustom:url||"", gamematFilter:filterStr||""});}catch{}
                }}
                onSaveCustom={(bg,url,name,filterStr)=>{
                  const newMat={name,bg,url,filter:filterStr||""};
                  const updated=[...(customMats||[]).filter(m=>m.name!==name),newMat];
                  setCustomMats(updated);
                  try{localStorage.setItem("mtg_custom_mats",JSON.stringify(updated));}catch{}
                  upd(p=>({...p,profile:{...p.profile,gamemat:bg,gamematCustom:url||"",gamematFilter:filterStr||""}}));
                  try{window.__MTG_V7__?.saveProfile?.({...player.profile, gamemat:bg, gamematCustom:url||"", gamematFilter:filterStr||""});}catch{}
                }}
                onClose={()=>setShowGamematPicker(false)}/>
            )}
          </div>

          {/* v7.6 Phase 2: invisible hand drop-zone, positioned inside BoardSide.
              `right:190` leaves the sidebar uncovered. Using position:absolute
              anchors this to the BoardSide root (position:relative). */}
          <div ref={handRef} className="drop-target mtg-hand"
            style={{position:"absolute",bottom:0,left:0,right:190,height:HAND_H,
              background:"none",border:"none",outline:"none",boxShadow:"none",
              pointerEvents:"none",zIndex:0,opacity:0}}/>

          {/* v7.6 Phase 2: HandOverlay mounted inside BoardSide so it inherits
              any parent transform (e.g. rotate(180deg) on the opponent side in
              Phase 3). In readOnly mode mutation callbacks are NOOPs; handleCtx
              is rerouted to fire onZoneRequest("hand", e) so right-clicking an
              opp hand sleeve triggers the view-hand request flow (Phase 4-B). */}
          {hand && handRef && containerRef && (
            <HandOverlay
              hand={hand}
              handRef={handRef}
              containerRef={containerRef}
              hovered={hovered}
              selected={selected}
              setHovered={readOnly ? NOOP : setHovered}
              setSelected={readOnly ? NOOP : setSelected}
              setSelZone={readOnly ? NOOP : setSelZone}
              startFloatDrag={readOnly ? NOOP : startFloatDrag}
              handleCtx={
                readOnly && onZoneRequest
                  ? ((e)=>{ if(e?.preventDefault) e.preventDefault(); onZoneRequest("hand", e); })
                  : (readOnly ? NOOP : handleCtx)
              }
              floatDrag={floatDrag}
            />
          )}
        </div>
  );
}

function GameBoard({playerIdx,player,opponent,phase,turn,stack,gamemode,onUpdatePlayer,onUpdateGame,onExit,onSwitchPlayer,onReset,onChangeDeck,isTwoPlayer,roomId,isOnline,onTheme,decks=[],authUser=null}){
  const [selected,setSelected]=useState(new Set()); // Set of iids
  const [selZone,setSelZone]=useState("battlefield"); // zone of selection
  // Selection rect state
  const [selRect,setSelRect]=useState(null); // {x1,y1,x2,y2} in BF coords
  const selRectRef=useRef(null); // {startX,startY,active}
  // Click timer for double-right-click detection
  const lastRightClick=useRef({iid:null,time:0});
  const [hovered,setHovered]=useState(null);
  const prevHoveredId=useRef(null);
  const [graveIdx,setGraveIdx]=useState(0);
  const [exileIdx,setExileIdx]=useState(0);
  // Track previous lengths to detect new cards being added
  const prevGraveLen=useRef(0);
  const prevExileLen=useRef(0);
  useEffect(()=>{
    const len=player.graveyard.length;
    if(len>prevGraveLen.current){setGraveIdx(len-1);}  // new card added — show it
    else if(graveIdx>=len){setGraveIdx(Math.max(0,len-1));} // card removed — clamp
    prevGraveLen.current=len;
  },[player.graveyard.length]);
  useEffect(()=>{
    const len=player.exile.length;
    if(len>prevExileLen.current){setExileIdx(len-1);}
    else if(exileIdx>=len){setExileIdx(Math.max(0,len-1));}
    prevExileLen.current=len;
  },[player.exile.length]);
  useEffect(()=>{
    if(hovered&&hovered.iid!==prevHoveredId.current){SFX.playAction("hover");prevHoveredId.current=hovered.iid||null;}
    if(!hovered)prevHoveredId.current=null;
  },[hovered]);
  const [ctxMenu,setCtxMenu]=useState(null);
  const [showToken,setShowToken]=useState(false);
  const [showCustom,setShowCustom]=useState(false);
  const [showLog,setShowLog]=useState(false);
  const [showDeckViewer,setShowDeckViewer]=useState(false);
  // v7 Phase 2: change-deck modal
  const [showChangeDeck,setShowChangeDeck]=useState(false);
  const [scryData,setScryData]=useState(null); // {cards:[]}
  const [libDropPrompt,setLibDropPrompt]=useState(null);
  const [sparks,setSparks]=useState([]);
  const [priority,setPriority]=useState(null); // "yes"|"no"|null
  const signalPriority=useCallback((v)=>{setPriority(v);setTimeout(()=>setPriority(null),1800);},[]);
  const [manaPool,setManaPool]=useState({W:0,U:0,B:0,R:0,G:0,C:0});
  const [showMana,setShowMana]=useState(false);
  const [showScry,setShowScry]=useState(false);
  const [scryCount,setScryCount]=useState(1);
  const [showSearchLib,setShowSearchLib]=useState(false);
  const [drawMode,setDrawMode]=useState(false);
  const [drawPaths,setDrawPaths]=useState([]);
  const [isDrawing,setIsDrawing]=useState(false);
  const drawCanvasRef=useRef(null);
  const [showCounterPicker,setShowCounterPicker]=useState(null); // card object
  const [showPlanechase,setShowPlanechase]=useState(false);
  const [currentPlane,setCurrentPlane]=useState(PLANE_CARDS[0]);
  const [planeIndex,setPlaneIndex]=useState(0);
  const [showChat,setShowChat]=useState(false);
  const [showRevealHand,setShowRevealHand]=useState(false);
  const [stormCount,setStormCount]=useState(0);
  const [showStorm,setShowStorm]=useState(false);
  const [showHotkeys,setShowHotkeys]=useState(false);
  const [showMillPrompt,setShowMillPrompt]=useState(false);
  const [showGamematPicker,setShowGamematPicker]=useState(false);
  const [gamematUrl,setGamematUrl]=useState(player.profile?.gamematCustom||"");
  const [gamematName,setGamematName]=useState("");
  const [customMats,setCustomMats]=useState(()=>{try{return JSON.parse(localStorage.getItem("mtg_custom_mats")||"[]");}catch{return [];}});
  const [prevLife,setPrevLife]=useState(player.life);
  const [copyMode,setCopyMode]=useState(null);
  const [oppHandAccess,setOppHandAccess]=useState(false);
  const [oppLibAccess,setOppLibAccess]=useState(false);
  const [oppAccessRequest,setOppAccessRequest]=useState(null);
  // v7.6 Phase 4: zone-parameterized request/reveal/deny. Covers hand,
  // graveyard, and exile. Previous (v7.4/v7.5) names mapped as follows:
  //   handRequestPending  → outgoingZoneRequest   {zone, targetAlias, ts}
  //   incomingHandRequest → incomingZoneRequest   {zone, requesterUserId, requesterAlias, ts}
  //   revealedOppHand     → revealedOppZones      {[zone]: {cards, userId, ts}}
  //   handRequestStatus   → zoneRequestStatus     {zone, type:"denied"|"timeout", alias}
  const [outgoingZoneRequest,setOutgoingZoneRequest]=useState(null);
  const [incomingZoneRequest,setIncomingZoneRequest]=useState(null);
  const [revealedOppZones,setRevealedOppZones]=useState({});
  const [zoneRequestStatus,setZoneRequestStatus]=useState(null);
  const [showGraveViewer,setShowGraveViewer]=useState(false);
  const [showExileViewer,setShowExileViewer]=useState(false);
  const [sfxMuted,setSfxMuted]=useState(()=>{
    try{return localStorage.getItem("mtg_sfx_muted")==="1";}catch{return false;}
  });
  const [showSoundSettings,setShowSoundSettings]=useState(false);

  // Init AudioContext on first user gesture, keep mute in sync
  useEffect(()=>{
    SFX.init();
    if(sfxMuted) SFX.mute(); else SFX.unmute();
  },[]);

  const toggleMute=()=>{
    const next=!sfxMuted;
    setSfxMuted(next);
    if(next) SFX.mute(); else SFX.unmute();
    try{localStorage.setItem("mtg_sfx_muted",next?"1":"0");}catch{}
  };
  // ── Animation state ──
  const [flyingCards,setFlyingCards]=useState([]); // [{id,img,fromX,fromY,toX,toY,type,delay}]
  const [cmdSummonAnim,setCmdSummonAnim]=useState(false); // flash when commander summoned
  const bfRef=useRef(null);
  // ── Drag on BF ──
  const bfDragRef=useRef(null);
  // ── Float drag (cross-zone) ──
  const [floatDrag,setFloatDrag]=useState(null);
  // ── Zone refs ──
  const graveRef=useRef(null);
  const exileRef=useRef(null);
  const libRef=useRef(null);
  const handRef=useRef(null);
  const cmdRef=useRef(null); // commander portrait drop target
  // v7.6 Phase 2: BoardSide root ref — HandOverlay positions cards relative to this.
  const containerRef=useRef(null);

  // ═══ v7.6 Phase 1: opponent-side refs + state ═══════════════════════════
  // BoardSide is mounted twice in online multiplayer: once interactive (above
  // refs) for the local player, once readOnly for the primary opponent using
  // these separate refs so DOM assignments don't collide. SelRect + lastRight-
  // Click are dummies (opponent is readOnly so selection/double-tap gated).
  const oppBfRef=useRef(null);
  const oppCmdRef=useRef(null);
  const oppLibRef=useRef(null);
  const oppGraveRef=useRef(null);
  const oppExileRef=useRef(null);
  const oppSelRectRef=useRef(null);
  const oppLastRightClick=useRef({iid:null,time:0});
  // v7.6 Phase 2: opp BoardSide root ref + opp hand drop-zone ref (mirrors local).
  const oppContainerRef=useRef(null);
  const oppHandRef=useRef(null);
  const [oppGraveIdx,setOppGraveIdx]=useState(0);
  const [oppExileIdx,setOppExileIdx]=useState(0);
  // Clamp opponent scroll indices when their zones change (mirrors the local
  // player effects at the top of GameBoard; deps are opponent-only).
  useEffect(()=>{
    const len=opponent?.graveyard?.length||0;
    if(oppGraveIdx>=len) setOppGraveIdx(Math.max(0,len-1));
  },[opponent?.graveyard?.length]);
  useEffect(()=>{
    const len=opponent?.exile?.length||0;
    if(oppExileIdx>=len) setOppExileIdx(Math.max(0,len-1));
  },[opponent?.exile?.length]);

  // v7.6 Phase 7: opponent SFX watcher. Diffs previous vs current opp state on
  // every render-where-opponent-ref-changes (remote broadcasts, mainly). Fires
  // local SFX cues for notable actions: draw, cast/summon, destroy, exile,
  // tap/untap, life change, counter change. Per-event coalescing caps each
  // category to ≤1 fire per diff (so untap-all-at-start-of-turn plays one
  // "untapAll" cue, not N "untap"s). Guards against false positives:
  //   • Skips on first-ever render (no prev).
  //   • Skips when opponent profile.userId changed (reconnect / different peer).
  //   • Skips when BF add/remove count > 5 (likely full-state reset / rejoin).
  // Local drags of opp cards never trigger SFX: x/y changes aren't in any of
  // the diff checks (iid sets, tap flags, counters, life, hand length).
  // Local actions don't trigger either: same-ref preservation in
  // setGameState's .map() means opp's player object reference is unchanged
  // when only the local seat mutates, so the watcher skips.
  const prevOppRef=useRef(null);
  useEffect(()=>{
    const prev=prevOppRef.current;
    const curr=opponent;
    prevOppRef.current=curr;
    if(!prev||!curr) return;
    if(prev.profile?.userId!==curr.profile?.userId) return;

    // BF iid-set diff (used by add/remove/tap/counter checks)
    const prevBf=prev.battlefield||[], currBf=curr.battlefield||[];
    const prevBfIids=new Set(prevBf.map(c=>c.iid));
    const currBfIids=new Set(currBf.map(c=>c.iid));
    const addedToBf=[...currBfIids].filter(iid=>!prevBfIids.has(iid));
    const removedFromBf=[...prevBfIids].filter(iid=>!currBfIids.has(iid));
    // Reset / rejoin bail-out: massive state churn indicates non-play update.
    if(addedToBf.length>5||removedFromBf.length>5) return;

    // Life change
    if((prev.life||0)>(curr.life||0)) SFX.playAction("lifeLoss");
    else if((prev.life||0)<(curr.life||0)) SFX.playAction("lifeGain");

    // Draw: hand size grew (masked or unmasked equally works — length survives masking)
    if((curr.hand?.length||0)>(prev.hand?.length||0)) SFX.playAction("draw");

    // BF additions = cast/summon/reanimate (not distinguished; fire toBattlefield)
    if(addedToBf.length>0) SFX.playAction("toBattlefield");

    // BF removals: classify by destination
    if(removedFromBf.length>0){
      const currGraveIids=new Set((curr.graveyard||[]).map(c=>c.iid));
      const currExileIids=new Set((curr.exile||[]).map(c=>c.iid));
      const destroyed=removedFromBf.filter(iid=>currGraveIids.has(iid));
      const exiled=removedFromBf.filter(iid=>currExileIids.has(iid));
      if(destroyed.length>0) SFX.playAction("toGraveyard");
      if(exiled.length>0)    SFX.playAction("toExile");
    }

    // Tap / untap. Only inspect cards present in BOTH snapshots (same iid).
    const prevTapMap=new Map(prevBf.map(c=>[c.iid,!!c.tapped]));
    let newlyTapped=0,newlyUntapped=0;
    for(const c of currBf){
      const prevT=prevTapMap.get(c.iid);
      if(prevT===undefined) continue;
      if(!prevT&&c.tapped) newlyTapped++;
      else if(prevT&&!c.tapped) newlyUntapped++;
    }
    if(newlyTapped>0) SFX.playAction("tap");
    if(newlyUntapped>=3) SFX.playAction("untapAll");
    else if(newlyUntapped>0) SFX.playAction("untap");

    // Counter change (any card with a different counters object). JSON.stringify
    // is fine here — counters are small objects and BF card count is modest.
    const prevCntMap=new Map(prevBf.map(c=>[c.iid,JSON.stringify(c.counters||{})]));
    const counterChanged=currBf.some(c=>{
      const prevS=prevCntMap.get(c.iid);
      if(prevS===undefined) return false;
      return prevS!==JSON.stringify(c.counters||{});
    });
    if(counterChanged) SFX.playAction("counter");
  },[opponent]);
  // ════════════════════════════════════════════════════════════════════════

  // upd and addLog must be declared first — many hooks depend on them
  const upd=useCallback(fn=>onUpdatePlayer(playerIdx,fn),[onUpdatePlayer,playerIdx]);
  const addLog=useCallback(msg=>{
    upd(p=>({...p,log:[`T${turn}:${msg}`,...p.log].slice(0,80)}));
    // v2 fix (bug #2): broadcast our action-log entries so opponents see them.
    const net=window.__MTG_V7__?.netSync;
    if(net){try{net.appendEvent("action",{text:`T${turn}:${msg}`,ts:Date.now()});}catch(e){}}
  },[upd,turn]);

  // v7.6 Phase 4-B: helper that opens a context-menu for requesting to view one
  // of the opponent's zones (hand / graveyard / exile). Wired into the opp
  // BoardSide via the `onZoneRequest` prop so that right-click on those zones
  // prompts the viewer-side confirmation and, if confirmed, emits a
  // zone_request event via NetSync. NOT a hook — plain arrow function,
  // closures resolve at call time (addLog / authUser / setCtxMenu etc.).
  const requestOppZone=(zone,e)=>{
    if(!opponent)return;
    const oppUid=opponent?.profile?.userId;
    const oppAlias=opponent?.profile?.alias||"Opponent";
    if(!oppUid){addLog(`⚠ Cannot request ${zone} — opponent has no user id`);return;}
    const net=window.__MTG_V7__?.netSync;
    if(!net){addLog("⚠ Offline — no opponent to ask");return;}
    setCtxMenu({
      x:e.clientX,y:e.clientY,card:null,zone:`opp_${zone}`,
      items:[
        {label:`👁 Request to see ${oppAlias}'s ${zone}`,action:()=>{
          try{net.appendEvent("zone_request",{zone,targetUserId:oppUid,requesterUserId:authUser?.id,ts:Date.now()});}catch{}
          addLog(`👁 Requested ${oppAlias}'s ${zone}`);
          setOutgoingZoneRequest({zone,targetAlias:oppAlias,ts:Date.now()});
          setCtxMenu(null);
        }},
        {label:"✕ Cancel",action:()=>setCtxMenu(null)},
      ]
    });
  };

  // v7.4: hand-request flow event listeners
  useEffect(()=>{
    const onReq=(e)=>{
      const d=e.detail||{};
      const zone=d.zone||"hand"; // legacy events without zone default to hand
      setIncomingZoneRequest({
        zone,
        requesterUserId:d.user_id||d.requesterUserId,
        requesterAlias:d.alias||"Someone",
        ts:Date.now(),
      });
    };
    const onReveal=(e)=>{
      const d=e.detail||{};
      const zone=d.zone||"hand";
      const ts=Date.now();
      setOutgoingZoneRequest(null);
      setZoneRequestStatus(null);
      setRevealedOppZones(curr=>({...curr,[zone]:{cards:d.cards||[],userId:d.revealerUserId,ts}}));
      // Auto-hide the reveal for this zone after 10s (only if nothing newer replaced it).
      setTimeout(()=>setRevealedOppZones(curr=>{
        if(curr[zone]?.ts!==ts) return curr;
        const n={...curr}; delete n[zone]; return n;
      }),10000);
    };
    const onDeny=(e)=>{
      const d=e.detail||{};
      const zone=d.zone||"hand";
      setOutgoingZoneRequest(null);
      setZoneRequestStatus({zone,type:"denied",alias:d.alias||"Opponent"});
      setTimeout(()=>setZoneRequestStatus(null),4000);
    };
    window.addEventListener("mtg:zone-request",onReq);
    window.addEventListener("mtg:zone-reveal",onReveal);
    window.addEventListener("mtg:zone-deny",onDeny);
    return()=>{
      window.removeEventListener("mtg:zone-request",onReq);
      window.removeEventListener("mtg:zone-reveal",onReveal);
      window.removeEventListener("mtg:zone-deny",onDeny);
    };
  },[]);

  // v7.6 Phase 4: 30s timeout on outgoing zone request → "no response".
  useEffect(()=>{
    if(!outgoingZoneRequest)return;
    const t=setTimeout(()=>{
      setOutgoingZoneRequest(null);
      setZoneRequestStatus({
        zone:outgoingZoneRequest.zone,
        type:"timeout",
        alias:outgoingZoneRequest.targetAlias,
      });
      setTimeout(()=>setZoneRequestStatus(null),4000);
    },30000);
    return()=>clearTimeout(t);
  },[outgoingZoneRequest]);

  // v7.4 game-start state (effect is defined further down after drawOne)
  const [startAnimPhase,setStartAnimPhase]=useState("idle"); // idle|shuffle|drawing|done
  const startedRef=useRef(false);

  // Flip a DFC card between its two faces, swapping all face-specific data
  // Scryfall DFC URL pattern: front/.../UUID.jpg → back/.../UUID.jpg
  const deriveBackFaceUrl=(uri)=>uri?uri.replace("/front/","/back/"):null;

  const flipCardFace=useCallback((c)=>{
    const newAltFace=!c.altFace;
    const face=newAltFace?(c.faces?.[1]):(c.faces?.[0]);

    // Resolve the back-face image through multiple fallbacks
    let altImg=c.altImageUri||c.faces?.[1]?.imageUri||null;
    if(newAltFace&&!altImg&&c.imageUri){
      // Scryfall stores DFC images as /front/ and /back/ in the same path
      altImg=deriveBackFaceUrl(c.imageUri);
    }

    // If still no image, asynchronously fetch from Scryfall and patch back
    if(newAltFace&&!altImg&&c.scryfallId){
      fetch(`https://api.scryfall.com/cards/${c.scryfallId}`)
        .then(r=>r.ok?r.json():null)
        .then(data=>{
          if(!data?.card_faces?.[1]) return;
          const backImg=data.card_faces[1]?.image_uris?.normal||null;
          if(!backImg) return;
          const newFaces=extractFaces(data);
          upd(p=>{
            const patch=card=>card.iid===c.iid
              ?{...card,altImageUri:backImg,altFace:true,faces:newFaces||card.faces}
              :card;
            return{...p,battlefield:p.battlefield.map(patch),hand:p.hand.map(patch)};
          });
        }).catch(()=>{});
    }

    return{
      ...c,
      altFace:newAltFace,
      altImageUri:altImg||c.altImageUri||null,
      _displayName:face?.name||(newAltFace?`${c.name} (back)`:c.name),
      _displayType:face?.typeLine||c.typeLine,
      _displayOracle:face?.oracleText||c.oracleText,
      _displayPower:face?.power!=null?face.power:c.power,
      _displayToughness:face?.toughness!=null?face.toughness:c.toughness,
    };
  },[upd]);

  // Listen for flip events dispatched by the CardImg flip button
  useEffect(()=>{
    const handler=(e)=>{
      const {iid}=e.detail;
      SFX.playAction("flip");
      upd(p=>({
        ...p,
        battlefield:p.battlefield.map(c=>c.iid===iid?flipCardFace(c):c),
        hand:p.hand.map(c=>c.iid===iid?flipCardFace(c):c),
      }));
    };
    window.addEventListener("mtg-flip-card",handler);
    return()=>window.removeEventListener("mtg-flip-card",handler);
  },[flipCardFace,upd]);

  const addSpark=(x,y,color)=>{
    const id=uid();
    setSparks(s=>[...s,{id,x,y,color}]);
    setTimeout(()=>setSparks(s=>s.filter(p=>p.id!==id)),800);
  };

  // Watch for opp access requests/grants targeting this player
  useEffect(()=>{
    const req=onUpdateGame._lastGame?.oppAccessRequest;
    if(req&&req.toPlayer===undefined&&req.fromPlayer!==playerIdx){
      setOppAccessRequest(req);
    }
    const grant=onUpdateGame._lastGame?.oppAccessGranted;
    if(grant&&grant.toPlayer===playerIdx){
      if(grant.zone==="opp_hand")setOppHandAccess(true);
      if(grant.zone==="opp_library")setOppLibAccess(true);
    }
  },[]);

  // helpers for flying card animations
  const refCenter=r=>{const rect=r?.current?.getBoundingClientRect();return rect?{x:rect.left+rect.width/2,y:rect.top+rect.height/2}:{x:window.innerWidth/2,y:window.innerHeight/2};};

  // drawOneRef tracks pending staggered draws so we don't overlap
  const drawTimersRef=useRef([]);
  // Cleanup timers on unmount
  useEffect(()=>()=>drawTimersRef.current.forEach(clearTimeout),[]);

  const drawIndexRef=useRef(0); // tracks how many cards are in-flight for landing position

  const drawOne=useCallback(()=>{
    // Animate one card from library to hand
    const libPos=libRef.current?.getBoundingClientRect();
    const handPos=handRef.current?.getBoundingClientRect();
    if(libPos&&handPos){
      const idx=drawIndexRef.current;
      drawIndexRef.current=idx+1;
      // Get the top card's image so the flip reveals it mid-flight
      const topCardImg=player.library[0]?getImg(player.library[0])||CARD_BACK:CARD_BACK;
      const anim={
        id:uid(),
        img:player.deck?.sleeveUri||CARD_BACK,  // starts as sleeve
        backImg:topCardImg,                       // flips to reveal card art
        fromX:libPos.left + libPos.width/2 - CW/2,
        fromY:libPos.top + libPos.height/2 - CH/2,
        toX:handPos.left + handPos.width/2 - CW*0.44,
        toY:handPos.bottom - Math.round(CH*0.88) - 4,
        startRot:90,
        endRot:0,
        glow:"rgba(96,165,250,.7)",
        delay:0,dur:520,
      };
      setFlyingCards(fc=>[...fc,anim]);
      setTimeout(()=>{
        setFlyingCards(fc=>fc.filter(c=>c.id!==anim.id));
        drawIndexRef.current=Math.max(0,drawIndexRef.current-1);
      },560);
    }
    SFX.playAction("draw");
    upd(p=>{
      if(!p.library.length) return{...p,log:[`T${turn}:💀 Library empty!`,...p.log].slice(0,80)};
      const [card,...rest]=p.library;
      return{
        ...p,
        revealTopOnce:p.revealTopOnce===card.iid?null:p.revealTopOnce,
        library:rest,
        hand:[...p.hand,{...card,zone:"hand"}],
        log:[`T${turn}:🎴 Drew ${card.name||"a card"}`,...p.log].slice(0,80)
      };
    });
  },[upd,turn,player.deck]);

  const draw=useCallback((n=1)=>{
    // Cancel any pending staggered draws and reset index
    drawTimersRef.current.forEach(clearTimeout);
    drawTimersRef.current=[];
    drawIndexRef.current=0;
    // Schedule n draws, each 150ms apart — satisfying one-by-one animation
    for(let i=0;i<n;i++){
      const t=setTimeout(()=>drawOne(),i*150);
      drawTimersRef.current.push(t);
    }
    if(n>1) addLog(`🎴 Drawing ${n} cards…`);
  },[drawOne,addLog]);

  const mulligan=useCallback(()=>{
    upd(p=>{
      const newSize=Math.max(p.hand.length-1,0);
      const newLib=shuffleArr([...p.library,...p.hand.map(c=>({...c,zone:"library"}))]);
      return{...p,library:newLib.slice(newSize),hand:newLib.slice(0,newSize).map(c=>({...c,zone:"hand"})),log:[`T${turn}:🔄 Mulligan to ${newSize}`,...p.log].slice(0,80)};
    });
  },[upd,turn]);

  const shuffle=useCallback(()=>{SFX.playAction("shuffle");upd(p=>({...p,library:shuffleArr(p.library),log:[`T${turn}:🔀 Shuffled`,...p.log].slice(0,80)}));},[upd,turn]);

  // v7.4: Game-start shuffle + staggered draw-7 animation.
  // Fires when: my seat isn't in startedSeats AND my board is empty AND
  // library has 7+ cards. Once started, mark this seat in startedSeats so
  // it won't re-trigger unless the seat is reset (which clears startedSeats).
  useEffect(()=>{
    if(!isOnline&&!isTwoPlayer)return; // single-player: skip auto-animation
    if(startedRef.current)return;
    if(startAnimPhase!=="idle")return;
    const startedSeats = onUpdateGame._lastGame?.startedSeats || [];
    if(startedSeats.includes(playerIdx))return;
    const isBoardEmpty = (player.hand?.length||0)===0
      && (player.battlefield?.length||0)===0
      && (player.graveyard?.length||0)===0
      && (player.exile?.length||0)===0;
    if(!isBoardEmpty)return;
    if((player.library?.length||0) < 7)return;

    startedRef.current=true;
    setStartAnimPhase("shuffle");
    SFX.playAction("shuffle");
    upd(p=>({...p,library:shuffleArr(p.library)}));
    const shuffleTimeout=setTimeout(()=>{
      setStartAnimPhase("drawing");
      for(let i=0;i<7;i++){
        setTimeout(()=>drawOne(),i*180);
      }
      setTimeout(()=>{
        setStartAnimPhase("done");
        const prev = onUpdateGame._lastGame?.startedSeats || [];
        if(!prev.includes(playerIdx)){
          onUpdateGame({startedSeats:[...prev,playerIdx]});
        }
        addLog("🎴 Opening hand drawn");
      },7*180+400);
    },900);
    return()=>clearTimeout(shuffleTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[startAnimPhase,playerIdx,player.hand?.length,player.battlefield?.length,player.graveyard?.length,player.exile?.length,player.library?.length]);

  // v7 Phase 2: change deck mid-game. Scoops all zones, builds a fresh library
  // from the chosen deck, deals an opening hand. Life/turn/phase preserved.
  const swapDeck = useCallback((newDeck)=>{
    if(!newDeck || !Array.isArray(newDeck.cards)) return;
    SFX.playAction("shuffle");
    upd(p=>{
      // Build library from deck cards, respecting card counts.
      const lib = [];
      for (const entry of newDeck.cards) {
        const n = entry.count || 1;
        for (let i=0; i<n; i++) lib.push(mkCard(entry,"library"));
      }
      const shuffled = shuffleArr(lib);
      // Opening hand size by format (commander = 7 standard)
      const handSize = 7;
      const hand = shuffled.slice(0, handSize).map(c=>({...c, zone:"hand"}));
      const library = shuffled.slice(handSize);
      return {
        ...p,
        deck: newDeck,
        library,
        hand,
        battlefield: [],
        graveyard: [],
        exile: [],
        command: newDeck.commander ? [mkCard({...newDeck.commander, isCommander:true}, "command")] : [],
        log: [`T${turn}:⇄ Changed to ${newDeck.name}`, ...p.log].slice(0,80),
      };
    });
    // Broadcast a log entry so opponent sees the deck change too.
    const net = window.__MTG_V7__?.netSync;
    if (net) { try { net.appendEvent("action", {text:`T${turn}:⇄ ${player.profile?.alias||"Opponent"} changed deck to ${newDeck.name}`, ts:Date.now()}); } catch {} }
  },[upd,turn,player.profile]);
  const untapAll=useCallback(()=>{SFX.playAction("untapAll");upd(p=>({...p,battlefield:p.battlefield.map(c=>({...c,tapped:false})),log:[`T${turn}:⟳ Untapped all`,...p.log].slice(0,80)}));},[upd,turn]);

  const moveCard=useCallback((card,from,to,pos="bottom",skipCmdCheck=false)=>{
    // Commander: when moving to grave/exile, track it on the command zone card but keep it in graveyard/exile
    if(!skipCmdCheck&&card.isCommander&&(to==="graveyard"||to==="exile")){
      const status=to==="graveyard"?"dead":to==="exile"?"exiled":null;
      upd(p=>{
        const rm=arr=>arr.filter(c=>c.iid!==card.iid);
        const nc={...card,zone:to,tapped:false,isCopy:false,copyImageUri:null};
        const add=(arr,c)=>pos==="top"?[c,...arr]:[...arr,c];
        // Update command zone portrait status without duplicating the card
        const newCommand=p.command.map(c=>c.scryfallId===card.scryfallId||c.iid===card.iid
          ?{...c,status}:c);
        return{...p,
          library:rm(p.library),hand:rm(p.hand),battlefield:rm(p.battlefield),
          graveyard:to==="graveyard"?add(rm(p.graveyard),nc):rm(p.graveyard),
          exile:to==="exile"?add(rm(p.exile),nc):rm(p.exile),
          command:newCommand,
          log:[`T${turn}:${to==="graveyard"?"☠":"✦"} ${card.name} → ${to} (can return to command zone)`,...p.log].slice(0,80)};
      });
      setSelected(new Set());
      return;
    }
    // Clones vanish instead of going to graveyard/exile
    if(card.isClone&&(to==="graveyard"||to==="exile")){
      upd(p=>{
        const rm=arr=>arr.filter(c=>c.iid!==card.iid);
        return{...p,library:rm(p.library),hand:rm(p.hand),battlefield:rm(p.battlefield),
          graveyard:rm(p.graveyard),exile:rm(p.exile),
          log:[`T${turn}:🪞 ${card.name} clone dissolved`,...p.log].slice(0,80)};
      });
      setSelected(new Set());
      return;
    }
    // Tokens also vanish when moved to graveyard or exile
    if(card.isToken&&(to==="graveyard"||to==="exile")){
      upd(p=>{
        const rm=arr=>arr.filter(c=>c.iid!==card.iid);
        return{...p,library:rm(p.library),hand:rm(p.hand),battlefield:rm(p.battlefield),
          graveyard:rm(p.graveyard),exile:rm(p.exile),
          log:[`T${turn}:✦ ${card.name} token removed`,...p.log].slice(0,80)};
      });
      setSelected(new Set());
      return;
    }
    // Play sound based on destination
    const sfxMap={exile:"toExile",battlefield:"toBattlefield",hand:"toHand"};
    if((from==="graveyard"||from==="exile")&&to==="battlefield") SFX.playAction("reanimate");
    else if(to==="graveyard"&&from==="battlefield") SFX.playAction("toGraveyard"); // death chime only from BF
    else if(sfxMap[to]) SFX.playAction(sfxMap[to]);
    upd(p=>{
      // Strip copy overlay, counters, and DFC state when leaving battlefield
      let nc={...card,zone:to,tapped:false};
      if(to!=="battlefield"){
        nc={...nc,isCopy:false,copyImageUri:null,counters:{},altFace:false};
      }
      if(to==="battlefield"){const dp=autoPos(p.battlefield,nc);nc={...nc,...dp};}
      const rm=arr=>arr.filter(c=>c.iid!==card.iid);
      const add=(arr,c)=>pos==="top"?[c,...arr]:[...arr,c];
      // Commander going to library: keep command zone portrait, don't remove it
      const shouldRemoveFromCommand=from==="command"&&to!=="library";
      return{...p,
        library:to==="library"?add(rm(p.library),nc):(from==="library"?rm(p.library):p.library),
        hand:to==="hand"?add(rm(p.hand),nc):(from==="hand"?rm(p.hand):p.hand),
        battlefield:to==="battlefield"?add(rm(p.battlefield),nc):(from==="battlefield"?rm(p.battlefield):p.battlefield),
        graveyard:to==="graveyard"?add(rm(p.graveyard),nc):(from==="graveyard"?rm(p.graveyard):p.graveyard),
        exile:to==="exile"?add(rm(p.exile),nc):(from==="exile"?rm(p.exile):p.exile),
        command:to==="command"?add(rm(p.command),nc):(shouldRemoveFromCommand?rm(p.command):p.command),
        log:[`T${turn}:${card.name} → ${to}`,...p.log].slice(0,80)};
    });
    setSelected(new Set());
  },[upd,turn]);

  const tap=useCallback(card=>{
    SFX.playAction(card.tapped?"untap":"tap");
    upd(p=>({...p,battlefield:p.battlefield.map(c=>c.iid===card.iid?{...c,tapped:!c.tapped}:c),log:[`T${turn}:${card.tapped?"⟳ Untapped":"⟳ Tapped"} ${card.name}`,...p.log].slice(0,80)}));
  },[upd,turn]);
  const addCounter=useCallback((card,type,amt)=>{
    if(amt>0) SFX.playAction("counter");
    upd(p=>{const u=arr=>arr.map(c=>c.iid===card.iid?{...c,counters:{...c.counters,[type]:(c.counters[type]||0)+amt}}:c);return{...p,battlefield:u(p.battlefield),hand:u(p.hand),graveyard:u(p.graveyard),log:[`T${turn}:${amt>0?"+":""} ${type} counter on ${card.name}`,...p.log].slice(0,80)};});
  },[upd,turn]);
  const copyCard=useCallback((card,isCloneFlag)=>upd(p=>{const cp={...card,iid:uid(),x:(card.x||0)+16,y:(card.y||0)+16,isClone:!!isCloneFlag,isCopy:false,copyImageUri:null};const z=card.zone||"battlefield";return{...p,[z]:[...p[z],cp],log:[`T${turn}:${isCloneFlag?"🪞 Cloned":"⧉ Copied"} ${card.name}`,...p.log].slice(0,80)};}),[upd,turn]);
  const createToken=useCallback(data=>{
    SFX.playAction("token");
    upd(p=>{const tok=mkCard({...data,isToken:true},"battlefield");const pos=autoPos(p.battlefield,tok);return{...p,battlefield:[...p.battlefield,{...tok,...pos}],log:[`T${turn}:✦ Token: ${data.name}`,...p.log].slice(0,80)};});
  },[upd,turn]);
  const discardHand=useCallback(()=>{
    // Animate hand cards flying one by one to graveyard
    const gravePos=graveRef.current?.getBoundingClientRect();
    const handPos=handRef.current?.getBoundingClientRect();
    if(gravePos&&handPos&&player.hand.length){
      const sleeve=player.deck?.sleeveUri||CARD_BACK;
      const anims=player.hand.map((c,i)=>({
        id:uid(),
        img:getImg(c)||CARD_BACK,
        backImg:sleeve,
        fromX:handPos.left+i*(CW+5),fromY:handPos.top+6,
        toX:gravePos.left+10,toY:gravePos.top+10,
        rot:(Math.random()-0.5)*90+45,
        glow:"rgba(168,85,247,.6)",
        delay:i*60,dur:420,
      }));
      setFlyingCards(anims);
      setTimeout(()=>setFlyingCards([]),player.hand.length*60+600);
    }
    SFX.playAction("discard");
    upd(p=>({...p,graveyard:[...p.graveyard,...p.hand.map(c=>({...c,zone:"graveyard"}))],hand:[],log:[`T${turn}:☠ Discarded hand`,...p.log].slice(0,80)}));
  },[upd,turn,player.hand]);
  const millTimersRef=useRef([]);
  useEffect(()=>()=>millTimersRef.current.forEach(clearTimeout),[]);

  // Mill n cards one at a time with staggered animation
  const millToZone=useCallback((n,toZone="graveyard")=>{
    const count=Math.min(n,player.library.length);
    if(!count) return;
    millTimersRef.current.forEach(clearTimeout);
    millTimersRef.current=[];

    const libPos=libRef.current?.getBoundingClientRect();
    const targetRef=toZone==="exile"?exileRef:graveRef;
    const targetPos=targetRef.current?.getBoundingClientRect();
    const glow=toZone==="exile"?"rgba(96,165,250,.8)":"rgba(168,85,247,.8)";

    // Snapshot card images NOW (before state updates change player.library)
    const snapImgs=player.library.slice(0,count).map(c=>getImg(c)||CARD_BACK);

    for(let i=0;i<count;i++){
      const cardImg=snapImgs[i];
      const t=setTimeout(()=>{
        // Fly one card from library to target zone
        SFX.playAction("mill");
        if(libPos&&targetPos){
          const sleeve=player.deck?.sleeveUri||CARD_BACK;
          const anim={
            id:uid(),
            img:cardImg,          // shows face
            backImg:sleeve,       // flips to sleeve as it hits the grave
            fromX:libPos.left + libPos.width/2 - CW/2,
            fromY:libPos.top + libPos.height/2 - CH/2,
            toX:targetPos.left+targetPos.width/2-CW/2,
            toY:targetPos.top+targetPos.height/2-CH/2,
            startRot:90,
            endRot:0,
            rot:(Math.random()-0.5)*80+(i%2===0?25:-25),
            glow,
            delay:0,
            dur:420,
          };
          setFlyingCards(fc=>[...fc,anim]);
          setTimeout(()=>setFlyingCards(fc=>fc.filter(c=>c.id!==anim.id)),560);
        }
        // State update — always pops top of library using upd closure
        upd(p=>{
          if(!p.library.length) return p;
          const [card,...rest]=p.library;
          const dest=toZone==="exile"
            ?{exile:[...p.exile,{...card,zone:"exile"}]}
            :{graveyard:[...p.graveyard,{...card,zone:"graveyard"}]};
          return{...p,library:rest,...dest,
            log:[`T${turn}:💀 ${card.name} → ${toZone}`,...p.log].slice(0,80)};
        });
      },i*130);
      millTimersRef.current.push(t);
    }
    // One summary log entry after all cards done
    const doneTimer=setTimeout(()=>{
      addLog(`💀 Milled ${count} → ${toZone}`);
    },count*130+50);
    millTimersRef.current.push(doneTimer);
  },[upd,addLog,turn,player.library]);

  const mill=useCallback((n)=>millToZone(n,"graveyard"),[millToZone]);
  const millExile=useCallback((n)=>millToZone(n,"exile"),[millToZone]);
  const [millCount,setMillCount]=useState(1);
  const [millTarget,setMillTarget]=useState("graveyard"); // "graveyard"|"exile"
  const handToLib=()=>upd(p=>({...p,library:shuffleArr([...p.library,...p.hand.map(c=>({...c,zone:"library"}))]),hand:[],log:[`T${turn}:Hand → library`,...p.log].slice(0,80)}));
  const changeLife=useCallback((newLife)=>{
    if(newLife>player.life) SFX.playAction("lifeGain");
    else if(newLife<player.life) SFX.playAction("lifeLoss");
    setPrevLife(player.life);
    upd(p=>({...p,life:newLife}));
  },[upd,player.life]);

  const scry=useCallback((n)=>{
    const top=player.library.slice(0,n);
    if(!top.length)return;
    setScryData({cards:top});
  },[player.library]);

  const surveil=useCallback((n)=>{
    const top=player.library.slice(0,n);
    if(!top.length)return;
    setScryData({cards:top,mode:"surveil"});
    addLog(`🔍 Surveilled ${n}`);
  },[player.library,addLog]);

  const lookAtTop=useCallback((n)=>{
    const top=player.library.slice(0,n);
    if(!top.length)return;
    setScryData({cards:top,mode:"look"});
    addLog(`👁 Looking at top ${n} cards`);
  },[player.library,addLog]);

  const handleScryConfirm=useCallback((tops,bots,grave,exl)=>{
    upd(p=>{
      const rest=p.library.slice(scryData.cards.length);
      const newLib=[...tops,...rest,...bots];
      const newGrave=[...p.graveyard,...(grave||[]).map(c=>({...c,zone:"graveyard"}))];
      const newExile=[...p.exile,...(exl||[]).map(c=>({...c,zone:"exile"}))];
      return{...p,library:newLib,graveyard:newGrave,exile:newExile,
        log:[`T${turn}:🔮 Scryed ${scryData.cards.length}`,...p.log].slice(0,80)};
    });
    setScryData(null);
  },[upd,turn,scryData]);

  const advancePhase=()=>{
    SFX.playAction("phaseNext");
    const next=(phase+1)%PHASES.length;
    if(phase===0)untapAll();
    if(phase===2)draw(1);
    onUpdateGame({phase:next,turn:next===0?turn+1:turn});
  };

  // ── BF drag — clamped to BF+sidebar total bounds ──
  // v7.6 Phase 6: live drag broadcast is IMPLICIT via this handler. Every
  // mousemove during a BF drag calls `upd(p=>{...battlefield with new x/y...})`
  // → `updatePlayer` sets gameState → `broadcastIfOnline(next)` → NetSync
  // debounces (80ms) and flushes the masked state over Supabase Realtime.
  // Peer receives → merge (their seat kept local, other seats from remote) →
  // remote seat's BoardSide re-renders cards at {left:card.x, top:card.y}.
  // The v7.5.1 bug was a field-name mismatch (old OpponentBoard read card.bfX,
  // card.bfY — never written); Phase 1's BoardSide reads card.x/y so the loop
  // is now closed end-to-end. To adjust drag smoothness, tune the 80ms
  // debounce in src/lib/netSync.js.
  const handleBFMouseMove=useCallback(e=>{
    const drag=bfDragRef.current;
    if(!drag)return;
    e.preventDefault();
    const rect=bfRef.current?.getBoundingClientRect();if(!rect)return;
    // Bounds: left=0 (BF left edge), right=BF+sidebar, top=0, bottom=BF bottom
    const minX=0, maxX=rect.width+190-CW;
    const minY=0, maxY=rect.height-CH;
    const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
    // Raw unclamped position of the dragged card
    const rawX=e.clientX-rect.left-drag.ox;
    const rawY=e.clientY-rect.top-drag.oy;
    const iid=drag.iid;
    upd(p=>{
      const anchor=p.battlefield.find(c=>c.iid===iid);
      if(!anchor)return p;
      // Delta from anchor's PREVIOUS position to new raw position
      const dx=rawX-anchor.x, dy=rawY-anchor.y;
      return{...p,battlefield:p.battlefield.map(c=>{
        if(c.iid===iid){
          // Dragged card clamps to bounds
          return{...c,x:clamp(rawX,minX,maxX),y:clamp(rawY,minY,maxY)};
        }
        if(selected.has(c.iid)){
          // Each selected card moves by the same delta, clamped independently
          return{...c,x:clamp((c.x||0)+dx,minX,maxX),y:clamp((c.y||0)+dy,minY,maxY)};
        }
        return c;
      })};
    });
  },[upd,selected]);

  const handleBFMouseUp=useCallback(e=>{
    const drag=bfDragRef.current;
    if(!drag)return;
    bfDragRef.current=null;
    const cx=e.clientX,cy=e.clientY;
    const checkZone=(ref)=>{if(!ref.current)return false;const r=ref.current.getBoundingClientRect();return cx>=r.left&&cx<=r.right&&cy>=r.top&&cy<=r.bottom;};
    const card=player.battlefield.find(c=>c.iid===drag.iid);
    if(card){
      // Commander dragged onto its portrait → return to command zone
      if(card.isCommander&&checkZone(cmdRef)){
        upd(p=>{
          const rm=arr=>arr.filter(c=>c.iid!==card.iid);
          const newCommand=p.command.map(c=>
            (c.scryfallId===card.scryfallId||c.name===card.name)?{...c,status:null}:c);
          return{...p,battlefield:rm(p.battlefield),command:newCommand,
            log:[`T${turn}:⚔ ${card.name} returned to command zone`,...p.log].slice(0,80)};
        });
        addSpark(cx,cy,T.accent);
      }
      else if(checkZone(graveRef)){
        // Move ALL selected BF cards (or just the dragged one)
        const toMove=selected.size>1&&selected.has(card.iid)
          ?player.battlefield.filter(c=>selected.has(c.iid))
          :[card];
        const iids=new Set(toMove.map(c=>c.iid));
        upd(p=>({...p,
          battlefield:p.battlefield.filter(c=>!iids.has(c.iid)),
          graveyard:[...p.graveyard,...toMove.map(c=>({...c,zone:"graveyard",tapped:false,counters:{},altFace:false}))],
          log:[`T${turn}:☠ ${toMove.map(c=>c.name).join(", ")} → graveyard`,...p.log].slice(0,80)}));
        toMove.forEach(()=>SFX.playAction("toGraveyard"));
        addSpark(cx,cy,"#a855f7");
      }
      else if(checkZone(exileRef)){
        const toMove=selected.size>1&&selected.has(card.iid)
          ?player.battlefield.filter(c=>selected.has(c.iid))
          :[card];
        const iids=new Set(toMove.map(c=>c.iid));
        upd(p=>({...p,
          battlefield:p.battlefield.filter(c=>!iids.has(c.iid)),
          exile:[...p.exile,...toMove.map(c=>({...c,zone:"exile",tapped:false,counters:{},altFace:false}))],
          log:[`T${turn}:✦ ${toMove.map(c=>c.name).join(", ")} → exile`,...p.log].slice(0,80)}));
        addSpark(cx,cy,"#60a5fa");
      }
      else if(checkZone(libRef)){setLibDropPrompt({card,fromZone:"battlefield",x:cx,y:cy});}
      else if(checkZone(handRef)){
        const toMove=selected.size>1&&selected.has(card.iid)
          ?player.battlefield.filter(c=>selected.has(c.iid))
          :[card];
        const iids=new Set(toMove.map(c=>c.iid));
        upd(p=>({...p,
          battlefield:p.battlefield.filter(c=>!iids.has(c.iid)),
          hand:[...p.hand,...toMove.map(c=>({...c,zone:"hand"}))],
          log:[`T${turn}: ${toMove.map(c=>c.name).join(", ")} → hand`,...p.log].slice(0,80)}));
        addSpark(cx,cy,"#c8a870");
      }

    }
  },[player.battlefield,moveCard,turn,upd]);

  const handleCardBFMouseDown=useCallback((e,card)=>{
    if(e.button!==0)return;
    e.preventDefault();e.stopPropagation();
    if(e.ctrlKey||e.metaKey){
      // Ctrl+click: toggle this card in selection
      setSelected(prev=>{
        const next=new Set(prev);
        if(next.has(card.iid))next.delete(card.iid);
        else next.add(card.iid);
        return next;
      });
      setSelZone("battlefield");
      return;
    }
    // If card not in selection, clear and select only it
    setSelected(prev=>{
      if(!prev.has(card.iid)){
        const s=new Set();s.add(card.iid);return s;
      }
      return prev; // keep multi-selection, drag all
    });
    setSelZone("battlefield");
    // Use float drag — gives access to ALL zones (grave, exile, lib, hand, cmd portrait)
    // But also start the BF position-drag for movement within BF
    const r=e.currentTarget.getBoundingClientRect();
    bfDragRef.current={iid:card.iid,ox:e.clientX-r.left-r.width/2,oy:e.clientY-r.top-r.height/2};
  },[]);

  // ── Float drag ──
  // Listen for drag-from-search-modal events
  useEffect(()=>{
    const handler=(e)=>{
      const {card,zone,x,y}=e.detail;
      setFloatDrag({card,fromZone:zone,x,y});
    };
    window.addEventListener("mtg-float-drag",handler);
    return()=>window.removeEventListener("mtg-float-drag",handler);
  },[]);

  const startFloatDrag=useCallback((e,card,fromZone,allCards=null)=>{
    if(e.button!==0)return;e.preventDefault();e.stopPropagation();
    setFloatDrag({card,fromZone,x:e.clientX,y:e.clientY,allCards});
  },[]);

  useEffect(()=>{
    if(!floatDrag)return;
    const onMove=e=>setFloatDrag(fd=>fd?{...fd,x:e.clientX,y:e.clientY}:null);
    const onUp=e=>{
      if(!floatDrag)return;
      const cx=e.clientX,cy=e.clientY;
      const checkZ=(ref)=>{if(!ref.current)return false;const r=ref.current.getBoundingClientRect();return cx>=r.left&&cx<=r.right&&cy>=r.top&&cy<=r.bottom;};
      const bfRect=bfRef.current?.getBoundingClientRect();
      const onBF=bfRect&&cx>=bfRect.left&&cx<=bfRect.right&&cy>=bfRect.top&&cy<=bfRect.bottom;

      // Commander dragged onto its portrait in command zone → return to command zone, clear status
      if(floatDrag.card.isCommander&&checkZ(cmdRef)){
        upd(p=>{
          const rm=arr=>arr.filter(c=>c.iid!==floatDrag.card.iid);
          // Clear the status on the command zone portrait
          const newCommand=p.command.map(c=>
            (c.scryfallId===floatDrag.card.scryfallId||c.name===floatDrag.card.name)
              ?{...c,status:null}:c);
          return{...p,
            graveyard:rm(p.graveyard),exile:rm(p.exile),
            battlefield:rm(p.battlefield),hand:rm(p.hand),
            command:newCommand,
            log:[`T${turn}:⚔ ${floatDrag.card.name} returned to command zone`,...p.log].slice(0,80)};
        });
        addSpark(cx,cy,T.accent);
        setFloatDrag(null);
        return;
      }

      if(onBF&&floatDrag){
        if(floatDrag.fromZone==="command"&&floatDrag.card.isCommander){
          // Summon commander: put on BF at exact drop position, increment castCount
          // Block if already on battlefield (prevent dupes)
          const alreadyOnBF=player.battlefield.some(c=>c.isCommander&&(c.scryfallId===floatDrag.card.scryfallId||c.name===floatDrag.card.name));
          if(alreadyOnBF){ setFloatDrag(null); return; }
          const cc=floatDrag.card.castCount||0;
          const dropX=Math.max(0,Math.min((bfRect?.width||400)-CW, cx-(bfRect?.left||0)-CW/2));
          const dropY=Math.max(0,Math.min((bfRect?.height||300)-CH, cy-(bfRect?.top||0)-CH/2));
          upd(p=>{
            const bf={...floatDrag.card,iid:uid(),zone:"battlefield",tapped:false,
              x:dropX,y:dropY,
              isCommander:true,isCopy:false,status:null};
            return{...p,
              command:p.command.map(c=>c.iid===floatDrag.card.iid?{...c,castCount:cc+1,status:"away"}:c),
              battlefield:[...p.battlefield,bf],
              log:[`T${turn}:⚔ ${floatDrag.card.name} cast from command zone (Tax +${cc*2})`,...p.log].slice(0,80)};
          });
          setCmdSummonAnim(true);setTimeout(()=>setCmdSummonAnim(false),1200);
          SFX.playAction("commanderSummon");
          addSpark(cx,cy,T.accent);
        }else{
          // Place card at exact cursor position — no auto-snapping
          const dropX=Math.max(0,Math.min((bfRect?.width||400)-CW, cx-(bfRect?.left||0)-CW/2));
          const dropY=Math.max(0,Math.min((bfRect?.height||300)-CH, cy-(bfRect?.top||0)-CH/2));
          // Play correct sound based on where card came from
          if(floatDrag.fromZone==="graveyard"||floatDrag.fromZone==="exile") SFX.playAction("reanimate");
          else SFX.playAction("toBattlefield");
          if(floatDrag.allCards&&floatDrag.allCards.length>1){
            // Multi-drag to battlefield — spread cards in a fan around drop point
            const iids=new Set(floatDrag.allCards.map(c=>c.iid));
            upd(p=>{
              const bfCards=floatDrag.allCards.map((c,i)=>({
                ...c,zone:"battlefield",tapped:false,isCopy:false,copyImageUri:null,
                x:Math.max(0,Math.min((bfRect?.width||400)-CW, dropX+(i-(floatDrag.allCards.length-1)/2)*(CW+8))),
                y:Math.max(0,Math.min((bfRect?.height||300)-CH, dropY)),
                iid:c.iid,
              }));
              return{...p,
                hand:p.hand.filter(c=>!iids.has(c.iid)),
                battlefield:[...p.battlefield.filter(c=>!iids.has(c.iid)),...bfCards],
                log:[`T${turn}:${floatDrag.allCards.map(c=>c.name).join(", ")} → battlefield`,...p.log].slice(0,80)};
            });
          }else{
            upd(p=>{
              const rm=arr=>arr.filter(c=>c.iid!==floatDrag.card.iid);
              let nc={...floatDrag.card,zone:"battlefield",tapped:false,x:dropX,y:dropY,isCopy:false,copyImageUri:null};
              return{...p,
                library:floatDrag.fromZone==="library"?rm(p.library):p.library,
                hand:floatDrag.fromZone==="hand"?rm(p.hand):p.hand,
                graveyard:floatDrag.fromZone==="graveyard"?rm(p.graveyard):p.graveyard,
                exile:floatDrag.fromZone==="exile"?rm(p.exile):p.exile,
                command:floatDrag.fromZone==="command"?rm(p.command):p.command,
                battlefield:[...rm(p.battlefield),nc],
                log:[`T${turn}:${floatDrag.card.name} → battlefield`,...p.log].slice(0,80)};
            });
          }
          addSpark(cx,cy,"#c8a870");
        }
      }
      else if(checkZ(graveRef)&&floatDrag){
        if(floatDrag.allCards&&floatDrag.allCards.length>0){
          const aC=floatDrag.allCards;const iids=new Set(aC.map(c=>c.iid));
          const newCards=aC.map(c=>({...c,zone:"graveyard",tapped:false,isCopy:false}));
          upd(p=>({...p,
            hand:p.hand.filter(c=>!iids.has(c.iid)),
            battlefield:p.battlefield.filter(c=>!iids.has(c.iid)),
            graveyard:[...p.graveyard,...newCards],
            log:[`T${turn}:☠ ${aC.map(c=>c.name).join(", ")} → graveyard`,...p.log].slice(0,80)}));
        }else{
          // Use direct upd so card always appended to end (newest = last = shown in preview)
          const card=floatDrag.card;const from=floatDrag.fromZone;
          if(card.isCommander){
            moveCard(card,from,"graveyard"); // commander path handles status
          } else {
            upd(p=>{
              const rm=arr=>arr.filter(c=>c.iid!==card.iid);
              return{...p,
                hand:from==="hand"?rm(p.hand):p.hand,
                battlefield:from==="battlefield"?rm(p.battlefield):p.battlefield,
                library:from==="library"?rm(p.library):p.library,
                exile:from==="exile"?rm(p.exile):p.exile,
                graveyard:[...rm(p.graveyard),{...card,zone:"graveyard",tapped:false}],
                log:[`T${turn}:☠ ${card.name} → graveyard`,...p.log].slice(0,80)};
            });
            if(from==="battlefield") SFX.playAction("toGraveyard");
          }
        }
        setGraveIdx(99999);
      addSpark(cx,cy,"#a855f7");
      }
      else if(checkZ(exileRef)&&floatDrag){
        if(floatDrag.fromZone==="graveyard") SFX.playAction("toExile");
        if(floatDrag.allCards&&floatDrag.allCards.length>0){
          const aC=floatDrag.allCards;const iids=new Set(aC.map(c=>c.iid));
          const newCards=aC.map(c=>({...c,zone:"exile",tapped:false,isCopy:false}));
          upd(p=>({...p,
            hand:p.hand.filter(c=>!iids.has(c.iid)),
            battlefield:p.battlefield.filter(c=>!iids.has(c.iid)),
            exile:[...p.exile,...newCards],
            log:[`T${turn}:✦ ${aC.map(c=>c.name).join(", ")} → exile`,...p.log].slice(0,80)}));
        }else{
          const card=floatDrag.card;const from=floatDrag.fromZone;
          if(card.isCommander){
            moveCard(card,from,"exile");
          } else {
            SFX.playAction("toExile");
            upd(p=>{
              const rm=arr=>arr.filter(c=>c.iid!==card.iid);
              return{...p,
                hand:from==="hand"?rm(p.hand):p.hand,
                battlefield:from==="battlefield"?rm(p.battlefield):p.battlefield,
                library:from==="library"?rm(p.library):p.library,
                graveyard:from==="graveyard"?rm(p.graveyard):p.graveyard,
                exile:[...rm(p.exile),{...card,zone:"exile",tapped:false}],
                log:[`T${turn}:✦ ${card.name} → exile`,...p.log].slice(0,80)};
            });
          }
        }
        setExileIdx(99999);
      addSpark(cx,cy,"#60a5fa");
      }
      else if(checkZ(libRef)&&floatDrag){setLibDropPrompt({card:floatDrag.card,fromZone:floatDrag.fromZone,x:cx,y:cy});}
      else if(checkZ(handRef)&&floatDrag&&floatDrag.fromZone!=="hand"){
        if(floatDrag.allCards&&floatDrag.allCards.length>0){
          const aC=floatDrag.allCards;const iids=new Set(aC.map(c=>c.iid));
          upd(p=>({...p,
            battlefield:p.battlefield.filter(c=>!iids.has(c.iid)),
            graveyard:p.graveyard.filter(c=>!iids.has(c.iid)),
            exile:p.exile.filter(c=>!iids.has(c.iid)),
            hand:[...p.hand,...aC.map(c=>({...c,zone:"hand"}))],
            log:[`T${turn}: ${aC.map(c=>c.name).join(", ")} → hand`,...p.log].slice(0,80)}));
        }else{
          moveCard(floatDrag.card,floatDrag.fromZone,"hand");
        }
        addSpark(cx,cy,"#c8a870");
      }
      setFloatDrag(null);
    };
    window.addEventListener("mousemove",onMove);window.addEventListener("mouseup",onUp);
    return()=>{window.removeEventListener("mousemove",onMove);window.removeEventListener("mouseup",onUp);};
  },[floatDrag,moveCard]);

  useEffect(()=>{
    const zones=[graveRef,exileRef,libRef,handRef,cmdRef];
    const on=()=>zones.forEach(r=>{if(r.current)r.current.classList.add("over");});
    const off=()=>zones.forEach(r=>{if(r.current)r.current.classList.remove("over");});
    if(floatDrag)on(); else off();
    return()=>off();
  },[floatDrag]);

  // ── Context menu builder ──
  const buildCtx=useCallback((card,zone,counterKey=null)=>{
    // Counter-specific context menu
    if(counterKey!==null){
      const items=[];
      const ct=COUNTER_TYPES.find(c=>c.key===counterKey)||{color:"#fbbf24",label:counterKey};
      items.push({header:`${counterKey} counters`});
      items.push({icon:"+",label:`Add ${counterKey}`,action:()=>addCounter(card,counterKey,1),color:ct.color});
      items.push({icon:"−",label:`Remove ${counterKey}`,action:()=>addCounter(card,counterKey,-1),color:ct.color});
      items.push({icon:"✕",label:`Remove ALL ${counterKey}`,action:()=>upd(p=>({...p,battlefield:p.battlefield.map(c=>c.iid===card.iid?{...c,counters:{...c.counters,[counterKey]:0}}:c)})),color:"#f87171"});
      return items;
    }
    const items=[{header:card.name}];
    const mv=(to,pos)=>()=>moveCard(card,zone,to,pos);
    if(zone==="battlefield"){
      items.push({icon:"⟳",label:card.tapped?"Untap":"Tap",action:()=>tap(card)});
      items.push("---");
      items.push({icon:"↩",label:"→ Hand",action:mv("hand")});
      items.push({icon:"☠",label:"→ Graveyard",action:mv("graveyard"),color:"#a78bfa"});
      items.push({icon:"⚡",label:"→ Exile",action:mv("exile"),color:"#60a5fa"});
      items.push({icon:"↑",label:"→ Library Top",action:mv("library","top")});
      items.push({icon:"↓",label:"→ Library Bottom",action:mv("library","bottom")});
      items.push({icon:"⧉",label:"Become a Copy of…",action:()=>setCopyMode({card}),color:"#60a5fa"});
      items.push({icon:"🪞",label:"Clone (vanishes on death)",action:()=>copyCard(card,true),color:"#818cf8"});
      // Multi-select actions when multiple selected
      if(selected.size>1){
        items.push("---");
        items.push({header:`${selected.size} cards selected`});
        items.push({icon:"⟳",label:"Tap All Selected",action:()=>{
          const ids=new Set(selected);
          upd(p=>({...p,battlefield:p.battlefield.map(c=>ids.has(c.iid)?{...c,tapped:true}:c)}));
        },color:"#fbbf24"});
        items.push({icon:"⟳",label:"Untap All Selected",action:()=>{
          const ids=new Set(selected);
          upd(p=>({...p,battlefield:p.battlefield.map(c=>ids.has(c.iid)?{...c,tapped:false}:c)}));
        },color:"#4ade80"});
        items.push({icon:"☠",label:"Send All → Graveyard",action:()=>{
          const ids=new Set(selected);
          const cards=player.battlefield.filter(c=>ids.has(c.iid));
          cards.forEach(c=>moveCard(c,"battlefield","graveyard"));
          setSelected(new Set());
        },color:"#a78bfa"});
        items.push({icon:"🪞",label:"Clone All Selected",action:()=>{
          const ids=new Set(selected);
          const cards=player.battlefield.filter(c=>ids.has(c.iid));
          cards.forEach(c=>copyCard(c,true));
        },color:"#818cf8"});
      }
      items.push({icon:"↔",label:card.faceDown?"Show Front":"Transform (Face Down)",action:()=>upd(p=>({...p,battlefield:p.battlefield.map(c=>c.iid===card.iid?{...c,faceDown:!c.faceDown}:c)}))});
      if(isDFCCard(card))items.push({icon:"↕",label:card.altFace?"◀ Transform (Back→Front)":"▶ Transform (Front→Back)",action:()=>window.dispatchEvent(new CustomEvent("mtg-flip-card",{detail:{iid:card.iid}}))});
      if(card.isToken)items.push({icon:"✗",label:"Remove Token",action:()=>upd(p=>({...p,battlefield:p.battlefield.filter(c=>c.iid!==card.iid)})),color:"#f87171"});
      items.push("---");
      items.push({icon:"◈",label:"Add Counter…",action:()=>{
        const type=(window.prompt("Counter type:\n(e.g. +1/+1  -1/-1  charge  loyalty  age  verse  poison  infect  time  fate  quest  study  task  wage  credit  brick  oil  eon  ice  wind  luck  dream  feather  fade  storage  rust  mire …)")||"").trim();
        if(!type)return;
        const amtStr=window.prompt(`Amount of [${type}] counters to add? (negative to remove)`,"1");
        if(amtStr===null)return;
        const amt=parseInt(amtStr);
        if(!isNaN(amt)&&amt!==0)addCounter(card,type,amt);
      }});
    }else if(zone==="hand"){
      // If multiple hand cards selected, show count and apply to all
      const handSel=selected.size>1&&selected.has(card.iid)
        ?player.hand.filter(c=>selected.has(c.iid))
        :[card];
      const sfx=handSel.length>1?` (${handSel.length})`:"";
      const selIids=new Set(handSel.map(c=>c.iid));
      const mvAll=(to,pos)=>()=>{
        // Single atomic upd to remove ALL selected cards at once
        SFX.playAction({graveyard:"toGraveyard",exile:"toExile",battlefield:"toBattlefield",hand:"toHand"}[to]||"toGraveyard");
        upd(p=>{
          const rmSel=arr=>arr.filter(c=>!selIids.has(c.iid));
          const cards=handSel.map(c=>({...c,zone:to,tapped:false,isCopy:false,copyImageUri:null}));
          const addAll=(arr)=>pos==="top"?[...cards,...arr]:[...arr,...cards];
          return{...p,
            hand:rmSel(p.hand),
            battlefield:to==="battlefield"?[...p.battlefield,...cards.map(c=>({...c,...autoPos(p.battlefield,c)}))]:p.battlefield,
            graveyard:to==="graveyard"?addAll(rmSel(p.graveyard)):p.graveyard,
            exile:to==="exile"?addAll(rmSel(p.exile)):p.exile,
            library:to==="library"?addAll(rmSel(p.library)):p.library,
            log:[`T${turn}:${handSel.map(c=>c.name).join(", ")} → ${to}`,...p.log].slice(0,80)};
        });
        setSelected(new Set());
      };
      items.push({icon:"▶",label:`→ Battlefield${sfx}`,action:mvAll("battlefield")});
      if(handSel.length===1)items.push({icon:"▶",label:"→ BF Face Down",action:()=>{moveCard(card,"hand","battlefield");upd(p=>({...p,battlefield:p.battlefield.map(c=>c.iid===card.iid?{...c,faceDown:true}:c)}));}});
      items.push({icon:"☠",label:`Discard${sfx}`,action:mvAll("graveyard"),color:"#a78bfa"});
      items.push({icon:"⚡",label:`→ Exile${sfx}`,action:mvAll("exile"),color:"#60a5fa"});
      items.push({icon:"↑",label:`→ Library Top${sfx}`,action:mvAll("library","top")});
      items.push({icon:"↓",label:`→ Library Bottom${sfx}`,action:mvAll("library","bottom")});
      if(handSel.length===1&&card.isCommander)items.push({icon:"⚔",label:"→ Command Zone",action:()=>{moveCard(card,zone,"command",undefined,true);addLog(`⚔ ${card.name} → command zone`);}});
    }else if(zone==="graveyard"){
      items.push({icon:"↩",label:"→ Hand",action:mv("hand")});
      items.push({icon:"▶",label:"Reanimate → BF",action:mv("battlefield"),color:"#4ade80"});
      if(card.isCommander)items.push({icon:"⚔",label:"→ Command Zone",action:()=>{
        upd(p=>{
          const rm=arr=>arr.filter(c=>c.iid!==card.iid);
          const newCommand=p.command.map(c=>(c.scryfallId===card.scryfallId||c.name===card.name)?{...c,status:null}:c);
          return{...p,graveyard:rm(p.graveyard),command:newCommand,
            log:[`T${turn}:⚔ ${card.name} returned to command zone`,...p.log].slice(0,80)};
        });
      },color:T.accent});
      items.push({icon:"↑",label:"→ Top of Library",action:mv("library","top")});
      items.push({icon:"↓",label:"→ Bottom of Library",action:mv("library","bottom")});
      items.push({icon:"🔀",label:"Shuffle into Library",action:()=>{
        moveCard(card,"graveyard","library","bottom");
        setTimeout(()=>upd(p=>({...p,library:shuffleArr(p.library),log:[`T${turn}:🔀 ${card.name} shuffled into library`,...p.log].slice(0,80)})),10);
        SFX.playAction("shuffle");
      }});
      items.push("---");
      items.push({icon:"⚡",label:"→ Exile",action:mv("exile"),color:"#60a5fa"});
      items.push({icon:"☠",label:"Exile Entire Graveyard",action:()=>{
        SFX.playAction("toExile");
        upd(p=>({...p,
          exile:[...p.exile,...p.graveyard.map(c=>({...c,zone:"exile"}))],
          graveyard:[],
          log:[`T${turn}:✦ Exiled entire graveyard (${p.graveyard.length} cards)`,...p.log].slice(0,80)}));
      },color:"#60a5fa"});
    }else if(zone==="exile"){
      items.push({icon:"↩",label:"→ Hand",action:mv("hand")});
      items.push({icon:"▶",label:"→ Battlefield",action:mv("battlefield"),color:"#4ade80"});
      if(card.isCommander)items.push({icon:"⚔",label:"→ Command Zone",action:()=>{
        upd(p=>{
          const rm=arr=>arr.filter(c=>c.iid!==card.iid);
          const newCommand=p.command.map(c=>(c.scryfallId===card.scryfallId||c.name===card.name)?{...c,status:null}:c);
          return{...p,exile:rm(p.exile),command:newCommand,
            log:[`T${turn}:⚔ ${card.name} returned to command zone`,...p.log].slice(0,80)};
        });
      },color:T.accent});
      items.push({icon:"↩",label:"→ Graveyard",action:mv("graveyard")});
      items.push({icon:"↑",label:"→ Top of Library",action:mv("library","top")});
      items.push({icon:"↓",label:"→ Bottom of Library",action:mv("library","bottom")});
      items.push({icon:"🔀",label:"Shuffle into Library",action:()=>{
        moveCard(card,"exile","library","bottom");
        setTimeout(()=>upd(p=>({...p,library:shuffleArr(p.library),log:[`T${turn}:🔀 ${card.name} shuffled into library`,...p.log].slice(0,80)})),10);
        SFX.playAction("shuffle");
      }});
    }else if(zone==="library"){
      items.push({icon:"🎴",label:"Draw This Card",action:()=>moveCard(card,"library","hand")});
      items.push({icon:"▶",label:"→ Battlefield",action:mv("battlefield")});
      items.push({icon:"☠",label:"→ Graveyard",action:mv("graveyard"),color:"#a78bfa"});
      items.push({icon:"⚡",label:"→ Exile",action:mv("exile"),color:"#60a5fa"});
      items.push("---");
      items.push({icon:"↑",label:"Move to Top",action:mv("library","top")});
      items.push({icon:"↓",label:"Move to Bottom",action:mv("library","bottom")});
      items.push("---");
      items.push({icon:"🔀",label:"Shuffle",action:()=>shuffle()});
      items.push("---");
      items.push({icon:"👁",label:player.revealTop?"◉ Play with Topdeck Revealed":"Play with Topdeck Revealed",action:()=>upd(p=>({...p,revealTop:!p.revealTop}))});
      items.push({icon:"👁",label:"Reveal Top Card (once)",action:()=>upd(p=>({...p,revealTopOnce:p.library[0]?.iid||null}))});
      items.push({icon:"🔮",label:"Scry 1",action:()=>scry(1)});
      items.push({icon:"🔮",label:"Scry X…",action:()=>setShowScry(true)});
      items.push({icon:"👁",label:"Look at top 3",action:()=>lookAtTop(3)});
      items.push({icon:"👁",label:"Look at top 5",action:()=>lookAtTop(5)});
      items.push({icon:"🔍",label:"Surveil 1",action:()=>surveil(1)});
      items.push({icon:"🔍",label:"Surveil 2",action:()=>surveil(2)});
      items.push("---");
      items.push({icon:"💀",label:"Mill 1 → Graveyard",action:()=>mill(1),color:"#a78bfa"});
      items.push({icon:"💀",label:"Mill 3 → Graveyard",action:()=>mill(3),color:"#a78bfa"});
      items.push({icon:"💀",label:"Mill X… → Graveyard",action:()=>{setMillTarget("graveyard");setShowMillPrompt(true);},color:"#a78bfa"});
      items.push("---");
      items.push({icon:"✦",label:"Mill 1 → Exile",action:()=>millExile(1),color:"#60a5fa"});
      items.push({icon:"✦",label:"Mill 3 → Exile",action:()=>millExile(3),color:"#60a5fa"});
      items.push({icon:"✦",label:"Mill X… → Exile",action:()=>{setMillTarget("exile");setShowMillPrompt(true);},color:"#60a5fa"});
      items.push("---");
      // v7 Phase 2: change deck mid-game (scoops current zones, opens picker).
      items.push({icon:"⇄",label:"Change Deck…",action:()=>setShowChangeDeck(true),color:T.accent});
    }else if(zone==="command"){
      const cc=card.castCount||0;
      const isAway=card.status==="away"||card.status==="dead"||card.status==="exiled";
      if(!isAway){
        items.push({icon:"⚔",label:`Cast from Command Zone (Tax: +${cc*2}💎)`,action:()=>{
          addLog(`⚔ Cast ${card.name} from command zone (Tax +${cc*2})`);
          upd(p=>({...p,
            command:p.command.map(c=>c.iid===card.iid?{...c,castCount:cc+1,status:"away"}:c),
            battlefield:[...p.battlefield,{...mkCard({...card,isCommander:true,status:null},"battlefield"),...autoPos(p.battlefield,card)}],
          }));
        },color:T.accent});
        items.push({icon:"▶",label:"→ Battlefield (no tax)",action:()=>{
          upd(p=>({...p,
            command:p.command.map(c=>c.iid===card.iid?{...c,status:"away"}:c),
            battlefield:[...p.battlefield,{...mkCard({...card,isCommander:true,status:null},"battlefield"),...autoPos(p.battlefield,card)}]}));
          addLog(`⚔ ${card.name} → battlefield`);
        }});
        items.push({icon:"↩",label:"→ Hand",action:()=>{
          upd(p=>({...p,command:p.command.map(c=>c.iid===card.iid?{...c,status:"away"}:c)}));
          moveCard(card,"command","hand",undefined,true);
          addLog(`⚔ ${card.name} → hand`);
        }});
        items.push({icon:"↑",label:"→ Library Top",action:()=>{
          upd(p=>({...p,
            command:p.command.map(c=>c.iid===card.iid?{...c,status:"away"}:c),
            library:[{...card,zone:"library",tapped:false},...p.library]}));
          addLog(`⚔ ${card.name} → library top`);
        }});
        items.push({icon:"↓",label:"→ Library Bottom",action:()=>{
          upd(p=>({...p,
            command:p.command.map(c=>c.iid===card.iid?{...c,status:"away"}:c),
            library:[...p.library,{...card,zone:"library",tapped:false}]}));
          addLog(`⚔ ${card.name} → library bottom`);
        }});
      }else{
        items.push({icon:"⚔",label:"Commander is away — return to command zone first",action:()=>{},color:"#4a6a8a"});
      }
    }
    return items;
  },[moveCard,tap,copyCard,addCounter,upd,onUpdateGame,stack,mill,millExile,scry,surveil,lookAtTop,selected,player.hand,player.graveyard,player.exile,player.library]);

  const handleCtx=useCallback((e,card,zone)=>{
    e.preventDefault();e.stopPropagation();
    const now=Date.now();
    lastRightClick.current={iid:card.iid,time:now};
    setCtxMenu({x:e.clientX,y:e.clientY,card,zone});
  },[]);
  const gamemat=player.profile?.gamemat||GAMEMATS[3].bg;
  window._deckSleeve=player.deck?.sleeveUri||null;
  const gamematFilter=player.profile?.gamematFilter||"none";
  const currentPhaseColor=PHASE_CLR[phase];
  const isDandan=gamemode==="dandan";

  // ── Full hotkey system ──
  useEffect(()=>{
    const onKey=e=>{
      // Don't fire hotkeys when typing in an input/textarea
      const tag=document.activeElement?.tagName;
      const isTyping=tag==="INPUT"||tag==="TEXTAREA"||document.activeElement?.isContentEditable;

      // ── GLOBAL hotkeys (always active) ──
      if((e.ctrlKey||e.metaKey)&&e.key==="a"){
        e.preventDefault();
        setSelected(new Set(player.battlefield.map(c=>c.iid)));
        setSelZone("battlefield");
        return;
      }
      if(e.key==="Escape"){
        // Close modals in priority order — innermost first
        if(showSoundSettings){ setShowSoundSettings(false); return; }
        if(showHotkeys)      { setShowHotkeys(false);       return; }
        if(showToken)        { setShowToken(false);          return; }
        if(showCustom)       { setShowCustom(false);         return; }
        if(showCounterPicker){ setShowCounterPicker(null);   return; }
        if(showMillPrompt)   { setShowMillPrompt(false);     return; }
        if(showGamematPicker){ setShowGamematPicker(false);  return; }
        if(showGraveViewer)  { setShowGraveViewer(false);    return; }
        if(showExileViewer)  { setShowExileViewer(false);    return; }
        if(showSearchLib)    { setShowSearchLib(false);      return; }
        if(showDeckViewer)   { setShowDeckViewer(false);     return; }
        if(showChangeDeck)   { setShowChangeDeck(false);      return; }
        if(showRevealHand)   { setShowRevealHand(false);     return; }
        if(showPlanechase)   { setShowPlanechase(false);     return; }
        if(showScry)         { setShowScry(false);           return; }
        if(scryData)         { setScryData(null);            return; }
        if(libDropPrompt)    { setLibDropPrompt(null);       return; }
        if(ctxMenu)          { setCtxMenu(null);             return; }
        if(copyMode)         { setCopyMode(null);            return; }
        setSelected(new Set());
        return;
      }

      if(isTyping)return; // below here: not while typing

      const k=e.key.toLowerCase();
      const shift=e.shiftKey;

      // ── GLOBAL hotkeys ──
      // X — untap all permanents
      if(k==="x"&&!e.ctrlKey){
        untapAll();
        return;
      }
      // C — draw a card
      if(k==="c"&&!e.ctrlKey){
        draw(1);
        return;
      }
      // V — shuffle deck
      if(k==="v"&&!shift&&!e.ctrlKey&&!e.metaKey){
        shuffle();
        return;
      }
      // Shift+V — mill 1 to graveyard (with animation)
      if(k==="v"&&shift&&!e.ctrlKey){
        mill(1);
        return;
      }
      // Ctrl+Shift+V — mill 1 to exile
      if(k==="v"&&shift&&(e.ctrlKey||e.metaKey)){
        millExile(1);
        return;
      }
      // Shift+M — open Mill X prompt
      if(k==="m"&&shift){
        e.preventDefault();
        setMillTarget("graveyard");
        setShowMillPrompt(true);
        return;
      }
      // M — mulligan (no shift)
      if(k==="m"&&!shift){
        mulligan();
        return;
      }
      // B — focus chat
      if(k==="b"){
        setShowChat(true);
        setTimeout(()=>document.querySelector('.mtg-chat-input')?.focus(),50);
        return;
      }
      // N — next phase
      if(k==="n"){
        advancePhase();
        return;
      }
      // A — alert / respond
      if(k==="a"){
        signalPriority("yes");
        return;
      }
      // Q — no response / pass
      if(k==="q"){
        signalPriority("no");
        return;
      }
      // W — insert token/card
      if(k==="w"){
        setShowToken(true);
        return;
      }
      // E — end turn (advance to End phase)
      if(k==="e"){
        onUpdateGame({phase:PHASES.length-1});
        return;
      }
      // Y — discard entire hand
      if(k==="y"){
        discardHand();
        return;
      }
      // F — toggle search library
      if(k==="f"){
        setShowSearchLib(v=>!v);
        return;
      }
      // G — look at top cards (scry)
      if(k==="g"){
        setShowScry(true);
        return;
      }
      // ? — show hotkey help
      if(e.key==="?"||e.key==="/"){
        e.preventDefault();
        setShowHotkeys(v=>!v);
        return;
      }
      // ` — roll d6
      if(e.key==="\`"&&!shift){
        e.preventDefault();
        const v=Math.ceil(Math.random()*6);
        addLog(`🎲 d6: ${v}`);
        return;
      }
      // Shift+` — roll d20
      if(e.key==="\`"&&shift){
        e.preventDefault();
        const v=Math.ceil(Math.random()*20);
        addLog(`🎲 d20: ${v}${v===20?" ✨ CRIT!":v===1?" 💀 FAIL":""}`);
        return;
      }

      // ── HOVER CARD hotkeys (act on hovered card) ──
      const card=hovered;
      if(!card)return;
      const zone=card.zone||"battlefield";
      const onBF=zone==="battlefield";

      // Space / _ — default action: tap/untap on BF, send to BF from anywhere else
      if(e.key===" "||e.key==="_"){
        e.preventDefault();
        if(onBF){
          tap(card);
        }else if(zone==="hand"||zone==="graveyard"||zone==="exile"||zone==="library"){
          if(zone==="graveyard"||zone==="exile") SFX.playAction("reanimate");
          else SFX.playAction("toBattlefield");
          moveCard(card,zone,"battlefield");
        }
        return;
      }
      // Z — tap/untap group of touching cards
      if(k==="z"&&onBF){
        upd(p=>{
          const pivot=p.battlefield.find(c=>c.iid===card.iid);
          if(!pivot)return p;
          const TOUCH=CW+10;
          const group=p.battlefield.filter(c=>{
            const dx=Math.abs((c.x||0)-(pivot.x||0));
            const dy=Math.abs((c.y||0)-(pivot.y||0));
            return dx<TOUCH&&dy<TOUCH;
          });
          const anyUntapped=group.some(c=>!c.tapped);
          // Play sound for each card in group, staggered slightly
          group.forEach((_,i)=>{
            setTimeout(()=>SFX.playAction(anyUntapped?"tap":"untap"),i*35);
          });
          return{...p,battlefield:p.battlefield.map(c=>
            group.find(g=>g.iid===c.iid)?{...c,tapped:anyUntapped}:c
          )};
        });
        return;
      }
      // J — face down / face up
      // L — flip card (DFC: alt face; non-DFC: toggle face-down showing sleeve)
      if(k==="l"){
        SFX.playAction("flip");
        // Trigger visual flip animation via custom event
        window.dispatchEvent(new CustomEvent("mtg-flip-card",{detail:{iid:card.iid}}));
        upd(p=>({...p,battlefield:p.battlefield.map(c=>{
          if(c.iid!==card.iid)return c;
          if(isDFCCard(c)) return flipCardFace(c);
          // Non-DFC: toggle faceDown (shows sleeve/card back)
          return{...c,faceDown:!c.faceDown};
        })}));
        return;
      }
      // D — send to graveyard
      if(k==="d"){
        if(selected.size>1&&selected.has(card.iid)){
          const selCards=[...player.battlefield.filter(c=>selected.has(c.iid)),...player.hand.filter(c=>selected.has(c.iid))];
          selCards.forEach(c=>moveCard(c,c.zone||"battlefield","graveyard"));
        }else moveCard(card,zone,"graveyard");
        return;
      }
      // S — send to exile
      if(k==="s"){
        if(selected.size>1&&selected.has(card.iid)){
          const selCards=[...player.battlefield.filter(c=>selected.has(c.iid)),...player.hand.filter(c=>selected.has(c.iid))];
          selCards.forEach(c=>moveCard(c,c.zone||"battlefield","exile"));
        }else moveCard(card,zone,"exile");
        return;
      }
      // P — send to facedown pile (exile facedown)
      if(k==="p"){
        moveCard(card,zone,"exile");
        upd(p=>({...p,exile:p.exile.map(c=>c.iid===card.iid?{...c,faceDown:true}:c)}));
        return;
      }
      // R — send to hand
      if(k==="r"){
        if(selected.size>1&&selected.has(card.iid)){
          const selCards=[...player.battlefield.filter(c=>selected.has(c.iid))];
          selCards.forEach(c=>moveCard(c,c.zone||"battlefield","hand"));
        }else moveCard(card,zone,"hand");
        return;
      }
      // T — send to top of library
      if(k==="t"){
        if(selected.size>1&&selected.has(card.iid)){
          const selCards=[...player.battlefield.filter(c=>selected.has(c.iid)),...player.hand.filter(c=>selected.has(c.iid))];
          selCards.forEach(c=>moveCard(c,c.zone||"battlefield","library","top"));
        }else moveCard(card,zone,"library","top");
        return;
      }
      // . — send to bottom of library
      if(e.key==="."){
        if(selected.size>1&&selected.has(card.iid)){
          const selCards=[...player.battlefield.filter(c=>selected.has(c.iid)),...player.hand.filter(c=>selected.has(c.iid))];
          selCards.forEach(c=>moveCard(c,c.zone||"battlefield","library","bottom"));
        }else moveCard(card,zone,"library","bottom");
        return;
      }
      // K — clone card
      if(k==="k"&&onBF){
        copyCard(card,true);
        return;
      }
      // H — shake card (visual wobble animation via CSS)
      if(k==="h"&&onBF){
        // We add a shake class temporarily via the card's DOM element
        const el=document.querySelector(`[data-iid="${card.iid}"]`);
        if(el){
          el.style.animation="none";
          requestAnimationFrame(()=>{
            el.style.animation="cardShake 0.4s ease";
            setTimeout(()=>el.style.animation="",450);
          });
        }
        return;
      }
      // O — target / mark as source (adds a target marker)
      if(k==="o"&&onBF){
        upd(p=>({...p,battlefield:p.battlefield.map(c=>c.iid===card.iid?{...c,targeted:!c.targeted}:c)}));
        addLog(`🎯 Targeted: ${card.name}`);
        return;
      }
      // I — invert card (rotate 180°, used for some card effects)
      if(k==="i"&&onBF){
        upd(p=>({...p,battlefield:p.battlefield.map(c=>c.iid===card.iid?{...c,inverted:!c.inverted}:c)}));
        return;
      }
      // U — add +1/+1 counter
      if(k==="u"){
        addCounter(card,"+1/+1",1);
        return;
      }
    };
    window.addEventListener("keydown",onKey);
    return()=>window.removeEventListener("keydown",onKey);
  },[player.battlefield,selected,hovered,upd,draw,shuffle,mulligan,untapAll,
     advancePhase,tap,moveCard,copyCard,addCounter,addLog,
     signalPriority,onUpdateGame]);

  // Online sync
  useEffect(()=>{
    if(!isOnline||!roomId)return;
    const interval=setInterval(async()=>{
      try{
        await storage.set(`room_${roomId}_player_${playerIdx}`,JSON.stringify({state:player,ts:Date.now()}));
        const r=await storage.get(`room_${roomId}_player_${1-playerIdx}`);
        if(r){const d=JSON.parse(r.value);if(d.state)onUpdatePlayer(1-playerIdx,()=>d.state);}
        if(playerIdx===0){
          await storage.set(`room_${roomId}_game`,JSON.stringify({phase,turn,stack}));
        }else{
          const gr=await storage.get(`room_${roomId}_game`);
          if(gr){const gd=JSON.parse(gr.value);onUpdateGame(gd);}
        }
      }catch{}
    },1500);
    return()=>clearInterval(interval);
  },[isOnline,roomId,playerIdx,player,phase,turn,stack,onUpdatePlayer,onUpdateGame]);


  // ── Scry N cards ──
  const doScry=(n)=>{
    upd(p=>{
      const top=p.library.slice(0,n);
      if(!top.length)return p;
      // For simplicity: reveal top N, player can drag them; we just show them
      return{...p,scryCards:top,log:[`T${turn}:🔮 Scrying ${n}`,...p.log].slice(0,80)};
    });
    setShowScry(false);
  };

  const addMana=(color,amt=1)=>setManaPool(p=>({...p,[color]:Math.max(0,p[color]+amt)}));
  const clearMana=()=>setManaPool({W:0,U:0,B:0,R:0,G:0,C:0});
  const totalMana=Object.values(manaPool).reduce((s,v)=>s+v,0);

  return(
    <div style={{height:"100vh",background:T.bg,color:T.text,display:"flex",flexDirection:"column",fontFamily:"Crimson Text,serif",userSelect:"none"}}
      onClick={()=>{SFX.init();setCtxMenu(null);setSelected(new Set());}}
      onMouseMove={e=>{
        handleBFMouseMove(e);
        // Update selection rect
        if(selRectRef.current?.active){
          const rect=bfRef.current?.getBoundingClientRect();
          if(rect){
            const cx=e.clientX-rect.left, cy=e.clientY-rect.top;
            setSelRect({x1:selRectRef.current.startX,y1:selRectRef.current.startY,x2:cx,y2:cy});
          }
        }
      }}
      onMouseUp={e=>{
        handleBFMouseUp(e);
        // Finalize selection rect
        if(selRectRef.current?.active){
          selRectRef.current.active=false;
          const r=selRect;
          if(r){
            const minX=Math.min(r.x1,r.x2),maxX=Math.max(r.x1,r.x2);
            const minY=Math.min(r.y1,r.y2),maxY=Math.max(r.y1,r.y2);
            // Select all cards whose position falls inside the rect
            if(maxX-minX>5||maxY-minY>5){
              const inRect=player.battlefield.filter(c=>{
                const cx=(c.x||0)+CW/2, cy=(c.y||0)+CH/2;
                return cx>=minX&&cx<=maxX&&cy>=minY&&cy<=maxY;
              });
              setSelected(new Set(inRect.map(c=>c.iid)));
              setSelZone("battlefield");
            }
          }
          setSelRect(null);
        }
      }}>

      {sparks.map(s=><SparkBurst key={s.id} x={s.x} y={s.y} color={s.color} onDone={()=>setSparks(p=>p.filter(x=>x.id!==s.id))}/>)}
      {flyingCards.length>0&&<FlyingCardAnim cards={flyingCards} onDone={()=>setFlyingCards([])}/>}
      {cmdSummonAnim&&(
        <div style={{position:"fixed",inset:0,pointerEvents:"none",zIndex:99993}}>
          <div style={{position:"absolute",inset:0,animation:"cmdSummonRumble .6s ease",background:"transparent"}}/>
          <div style={{position:"absolute",inset:0,background:"radial-gradient(ellipse at 50% 60%,rgba(200,168,112,.18) 0%,transparent 60%)",animation:"fadeIn .3s ease both, fadeIn .3s ease .5s reverse both"}}/>
          <div style={{position:"absolute",bottom:"30%",left:"50%",transform:"translateX(-50%)",
            fontSize:48,filter:"drop-shadow(0 0 30px #c8a870) drop-shadow(0 0 60px #c8a87080)",
            animation:"floatSoft .6s ease-in-out 2"}}>⚔</div>
          {Array.from({length:12},(_,i)=>(
            <div key={i} style={{position:"absolute",
              left:`${20+Math.random()*60}%`,top:`${20+Math.random()*60}%`,
              fontSize:16+Math.random()*14,
              animation:`sparkle ${0.4+Math.random()*.5}s ease ${Math.random()*.4}s both`,
              filter:"drop-shadow(0 0 8px #c8a870)"}}>✦</div>
          ))}
        </div>
      )}
      {scryData&&<ScryModal cards={scryData.cards} mode={scryData.mode} onConfirm={handleScryConfirm} onClose={()=>setScryData(null)}/>}

      {/* ═══ HEADER ═══ */}
      <div style={{display:"flex",alignItems:"center",gap:5,padding:"3px 8px",
        background:`linear-gradient(90deg,${T.bg},${T.panel}80,${T.bg})`,
        borderBottom:`1px solid ${currentPhaseColor}20`,flexShrink:0,
        position:"relative",flexWrap:"wrap",minHeight:38}}>
        <div style={{position:"absolute",bottom:0,left:0,right:0,height:1,
          background:`linear-gradient(90deg,transparent,${currentPhaseColor}40,transparent)`,
          boxShadow:`0 0 6px ${currentPhaseColor}`}}/>

        {player.profile?.avatarImg?(
          <img src={player.profile.avatarImg} alt="" style={{width:22,height:22,borderRadius:"50%",objectFit:"cover",border:`1px solid ${T.accent}40`,flexShrink:0}}/>
        ):(
          <span style={{fontSize:13}}>{player.profile?.avatar||"🧙"}</span>
        )}
        <button onClick={onExit} style={{...btn(`${T.panel}99`,"#6a7a8a",{border:`1px solid ${T.border}20`,fontSize:10})}} onMouseOver={hov} onMouseOut={uhov}>⬅</button>
        <button onClick={onReset} style={{...btn("rgba(251,191,36,.08)","#fbbf24",{border:"1px solid rgba(251,191,36,.2)",fontSize:10})}} onMouseOver={hov} onMouseOut={uhov}>↺</button>
        {!isDandan&&<button onClick={()=>setShowHotkeys(v=>!v)} title="Hotkey Help (?)" style={{...btn("rgba(200,168,112,.08)",T.accent,{fontSize:10,border:"1px solid rgba(200,168,112,.2)",fontFamily:"Cinzel,serif",letterSpacing:".05em"})}} onMouseOver={hov} onMouseOut={uhov}>⌨</button>}
        {isDandan&&<span style={{fontSize:11,color:"#a855f7",fontFamily:"Cinzel,serif",letterSpacing:".08em"}}>🐟 DANDAN</span>}

        <div style={{width:1,height:18,background:`${currentPhaseColor}30`}}/>
        <LifeCounter life={player.life} prevLife={prevLife} onChange={changeLife}/>

        {/* Poison */}
        <div style={{display:"flex",alignItems:"center",gap:1}}>
          <button onClick={()=>upd(p=>({...p,poison:Math.max(0,p.poison-1)}))} style={{...btn("transparent","#a78bfa",{padding:"0 4px",fontSize:10,border:"none"})}} onMouseOver={hov} onMouseOut={uhov}>−</button>
          <span style={{fontSize:10,fontFamily:"Cinzel,serif",color:player.poison>=10?"#f87171":"#a78bfa",minWidth:22,textAlign:"center"}}>☠{player.poison}</span>
          <button onClick={()=>upd(p=>({...p,poison:p.poison+1}))} style={{...btn("transparent","#a78bfa",{padding:"0 4px",fontSize:10,border:"none"})}} onMouseOver={hov} onMouseOut={uhov}>+</button>
        </div>

        <div style={{width:1,height:18,background:`${currentPhaseColor}30`}}/>

        {/* Phases */}
        <span style={{fontSize:8,color:"#3a5a7a",fontFamily:"Cinzel,serif"}}>T{turn}</span>
        {PHASES.map((p,i)=>(
          <button key={p} onClick={e=>{e.stopPropagation();onUpdateGame({phase:i});}}
            style={{...btn(i===phase?`${PHASE_CLR[i]}22`:"transparent",i===phase?PHASE_CLR[i]:"#3a5a7a",
              {border:`1px solid ${i===phase?PHASE_CLR[i]:"#1e3a5f15"}`,padding:"1px 5px",fontSize:8,
               fontFamily:"Cinzel,serif",boxShadow:i===phase?`0 0 8px ${PHASE_CLR[i]}50`:"none",
               animation:i===phase?"phaseActive 1.5s ease-in-out infinite":undefined})}}>
            {PHASE_ICONS[i]} {p}
          </button>
        ))}
        <button onClick={advancePhase}
          style={{...btn(`linear-gradient(135deg,${currentPhaseColor},${currentPhaseColor}80)`,T.bg,
            {fontFamily:"Cinzel,serif",padding:"2px 8px",fontSize:9,fontWeight:700})}}
          onMouseOver={hov} onMouseOut={uhov}>Next →</button>

        <div style={{flex:1}}/>
        {/* Priority signals */}
        <button onClick={()=>signalPriority("yes")}
          style={{...btn(priority==="yes"?"rgba(249,115,22,.3)":"rgba(249,115,22,.08)","#f97316",{border:"1px solid rgba(249,115,22,.3)",padding:"3px 8px",fontSize:10,fontFamily:"Cinzel, serif"})}}
          onMouseOver={hov} onMouseOut={uhov}>✋ Respond</button>
        <button onClick={()=>signalPriority("no")}
          style={{...btn(priority==="no"?"rgba(74,222,128,.2)":"rgba(74,222,128,.06)","#4ade80",{border:"1px solid rgba(74,222,128,.2)",padding:"3px 8px",fontSize:10,fontFamily:"Cinzel, serif"})}}
          onMouseOver={hov} onMouseOut={uhov}>✓ Pass</button>
        {/* Theme & Weather | Gamemat | Sound */}
        <button onClick={onTheme} title="Theme & Weather"
          style={{...btn(`${T.bg}99`,T.accent,{border:`1px solid ${T.border}20`,fontSize:11,padding:"2px 6px"})}}
          onMouseOver={hov} onMouseOut={uhov}>🎨</button>
        <button onClick={()=>setShowGamematPicker(v=>!v)} title="Change Game Mat"
          style={{...btn(showGamematPicker?`${T.accent}1a`:`${T.bg}99`,"#60a5fa",{border:`1px solid ${T.border}20`,fontSize:11,padding:"2px 6px"})}}
          onMouseOver={hov} onMouseOut={uhov}>🖼</button>
        <button
          onClick={e=>{if(e.shiftKey)toggleMute();else setShowSoundSettings(v=>!v);}}
          title={sfxMuted?"Shift+click to unmute · click for settings":"Click for sound settings · Shift+click to mute"}
          style={{...btn(showSoundSettings?`${T.accent}1a`:`${T.bg}99`,sfxMuted?"#4a6a8a":T.accent,{border:`1px solid ${T.border}20`,fontSize:11,padding:"2px 6px",opacity:sfxMuted?.5:1})}}
          onMouseOver={hov} onMouseOut={uhov}>{sfxMuted?"🔇":"🔊"}</button>
        {/* Mana pool */}
        <button onClick={()=>setShowMana(v=>!v)}
          style={{...btn(showMana?`${T.accent}1f`:`${T.bg}99`,T.accent,{border:"1px solid rgba(200,168,112,.15)",padding:"3px 7px",fontSize:9,fontFamily:"Cinzel, serif"})}}
          onMouseOver={hov} onMouseOut={uhov}>💎 {totalMana>0?totalMana:"Mana"}</button>
        <DiceRoller/>
        <div style={{width:1,height:18,background:`${currentPhaseColor}30`}}/>

        {/* Action buttons */}
        {[
          ["🎴",()=>{draw(1);addLog("🎴 Drew a card");},"rgba(59,130,246,.1)","#60a5fa","rgba(59,130,246,.25)","Draw (C)"],
          ["×7",()=>{
            const isOpeningHand=player.hand.length===0;
            draw(7);
            if(isOpeningHand) addLog("🎴 Drew opening hand");
          },"rgba(59,130,246,.08)","#60a5fa","rgba(59,130,246,.2)","Draw 7"],
          ["⟳",()=>{untapAll();addLog("⟳ Untapped all");},"rgba(22,163,74,.08)","#4ade80","rgba(22,163,74,.2)","Untap All (X)"],
          ["🔀",()=>{shuffle();addLog("🔀 Shuffled");},"rgba(251,191,36,.08)","#fbbf24","rgba(251,191,36,.2)","Shuffle (V)"],
          ["🔄",mulligan,"rgba(249,115,22,.08)","#f97316","rgba(249,115,22,.2)","Mulligan (M)"],
          ["✦",()=>setShowToken(true),"rgba(168,85,247,.08)","#c084fc","rgba(168,85,247,.2)","Token (W)"],
          ["☠✋",()=>{discardHand();addLog("☠ Discarded hand");},"rgba(248,113,113,.08)","#f87171","rgba(248,113,113,.2)","Discard Hand (Y)"],
        ].map(([l,a,bg,c,bc,title])=>(
          <button key={l} onClick={a} title={title}
            style={{...btn(bg,c,{border:`1px solid ${bc}`,padding:"2px 7px",fontSize:11})}}
            onMouseOver={hov} onMouseOut={uhov}>{l}</button>
        ))}
        <button onClick={()=>setShowScry(true)} title="Scry X (G)"
          style={{...btn("rgba(168,85,247,.08)","#a78bfa",{border:"1px solid rgba(168,85,247,.2)",padding:"2px 7px",fontSize:9,fontFamily:"Cinzel,serif"})}}
          onMouseOver={hov} onMouseOut={uhov}>Scry</button>
        <button onClick={()=>setShowLog(v=>!v)} title="Game Log"
          style={{...btn(`${T.bg}99`,"#6a7a8a",{border:`1px solid ${T.border}20`,fontSize:10})}} onMouseOver={hov} onMouseOut={uhov}>📜</button>
        {isTwoPlayer&&<button onClick={onSwitchPlayer}
          style={{...btn(`${T.accent}14`,T.accent,{fontSize:10,border:`1px solid ${T.accent}40`})}}
          onMouseOver={hov} onMouseOut={uhov}>⇄ Switch</button>}
        {isOnline&&<span style={{fontSize:8,color:"#4ade80",animation:"pulse 2s ease-in-out infinite"}}>● LIVE</span>}
      </div>

      {/* ═══ MAIN AREA ═══ */}
      <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"visible",minHeight:0,position:"relative"}}>

        {/* v7.6 Phase 3+4+5: opponent half wrapped in transform:rotate(180deg)
            so their cards face the local player. Uses `flex:1` (equal share with
            local) rather than `0 0 50%` so the divider doesn't steal from one
            side only — both halves grow symmetrically from `(total - 2px) / 2`.
            `display:flex` + `minHeight:0` make this wrapper a flex parent so
            BoardSide's own `flex:1` fills the entire half (without this, BoardSide
            collapsed to content height and opp visually appeared smaller: the D9
            bug). Zone-request triggers (hand, graveyard, exile) live inside
            BoardSide via the `onZoneRequest` prop. */}
        {opponent && (
          <div style={{flex:1,display:"flex",minHeight:0,position:"relative",overflow:"hidden",
            borderTop:`2px solid ${currentPhaseColor}30`,
            boxShadow:`0 -2px 12px ${currentPhaseColor}20`,
            transform:"rotate(180deg)",transformOrigin:"center center"}}>
            <BoardSide
              readOnly
              player={opponent} T={T} currentPhaseColor={currentPhaseColor}
              gamemat={opponent.profile?.gamemat || GAMEMATS[0].bg}
              gamematFilter={opponent.profile?.gamematFilter || ""}
              showDeckViewer={false} showChangeDeck={false} showGamematPicker={false}
              copyMode={null} cmdSummonAnim={false}
              customMats={[]} decks={[]}
              selected={new Set()} selZone="battlefield" selRect={null}
              graveIdx={oppGraveIdx} exileIdx={oppExileIdx}
              bfRef={oppBfRef} cmdRef={oppCmdRef} libRef={oppLibRef}
              graveRef={oppGraveRef} exileRef={oppExileRef}
              selRectRef={oppSelRectRef} lastRightClick={oppLastRightClick}
              setCtxMenu={NOOP} setHovered={setHovered}
              setSelected={NOOP} setSelZone={NOOP} setSelRect={NOOP}
              setCopyMode={NOOP}
              setShowDeckViewer={NOOP} setShowChangeDeck={NOOP} setShowGamematPicker={NOOP}
              setShowSearchLib={NOOP} setShowGraveViewer={NOOP} setShowExileViewer={NOOP}
              setGraveIdx={setOppGraveIdx} setExileIdx={setOppExileIdx}
              setCustomMats={NOOP}
              upd={NOOP} addLog={addLog}
              handleCtx={NOOP} handleCardBFMouseDown={NOOP} startFloatDrag={NOOP}
              tap={NOOP} swapDeck={NOOP} draw={NOOP} shuffle={NOOP}
              containerRef={oppContainerRef} hand={opponent.hand} handRef={oppHandRef}
              hovered={hovered} floatDrag={null}
              onZoneRequest={requestOppZone}
            />
          </div>
        )}

{/* ── DIVIDER / CENTER LINE (opponent only) ── */}
        {opponent && <div style={{height:2,background:`linear-gradient(90deg,transparent,${currentPhaseColor}50,transparent)`,
          boxShadow:`0 0 8px ${currentPhaseColor}30`,flexShrink:0}}/>}

        {/* ── PLAYER FIELD + SIDEBAR ── */}
        <BoardSide
          player={player} T={T} currentPhaseColor={currentPhaseColor}
          gamemat={gamemat} gamematFilter={gamematFilter}
          showDeckViewer={showDeckViewer} showChangeDeck={showChangeDeck} showGamematPicker={showGamematPicker}
          copyMode={copyMode} cmdSummonAnim={cmdSummonAnim}
          customMats={customMats} decks={decks}
          selected={selected} selZone={selZone} selRect={selRect}
          graveIdx={graveIdx} exileIdx={exileIdx}
          bfRef={bfRef} cmdRef={cmdRef} libRef={libRef} graveRef={graveRef} exileRef={exileRef}
          selRectRef={selRectRef} lastRightClick={lastRightClick}
          setCtxMenu={setCtxMenu} setHovered={setHovered} setSelected={setSelected} setSelZone={setSelZone} setSelRect={setSelRect}
          setCopyMode={setCopyMode}
          setShowDeckViewer={setShowDeckViewer} setShowChangeDeck={setShowChangeDeck} setShowGamematPicker={setShowGamematPicker}
          setShowSearchLib={setShowSearchLib} setShowGraveViewer={setShowGraveViewer} setShowExileViewer={setShowExileViewer}
          setGraveIdx={setGraveIdx} setExileIdx={setExileIdx} setCustomMats={setCustomMats}
          upd={upd} addLog={addLog} handleCtx={handleCtx} handleCardBFMouseDown={handleCardBFMouseDown} startFloatDrag={startFloatDrag}
          tap={tap} swapDeck={swapDeck} draw={draw} shuffle={shuffle}
          containerRef={containerRef} hand={player.hand} handRef={handRef}
          hovered={hovered} floatDrag={floatDrag}
        />
      </div>



      {/* v7.6 Phase 2: hand drop-zone and HandOverlay are now rendered inside
          each BoardSide mount (local + opp). This keeps the hand positioned
          relative to its BoardSide container so it rotates with the opp side
          in Phase 3. The previous viewport-fixed overlay has been retired. */}

      {/* Priority signal overlay */}
      {priority&&(
        <div style={{position:"fixed",top:"50%",left:"50%",transform:"translate(-50%,-50%)",
          zIndex:99985,pointerEvents:"none",
          fontSize:priority==="yes"?48:40,
          animation:"lifeFlash .4s ease,fadeIn .2s ease",
          filter:priority==="yes"?"drop-shadow(0 0 20px #f97316)":"drop-shadow(0 0 20px #4ade80)"}}>
          {priority==="yes"?"✋":"✓"}
        </div>
      )}



      {/* Mana pool panel */}
      {showMana&&(
        <div className="slide-in" style={{position:"fixed",bottom:130,right:220,zIndex:9990,
          background:`linear-gradient(160deg,${T.panel},${T.bg})`,
          border:`1px solid ${T.accent}40`,borderRadius:10,padding:14,
          boxShadow:"0 12px 40px rgba(0,0,0,.9)"}}>
          <div style={{fontSize:9,color:T.accent,fontFamily:"Cinzel, serif",letterSpacing:".12em",marginBottom:8}}>💎 MANA POOL</div>
          <div style={{display:"flex",gap:5,marginBottom:8}}>
            {[["W","#fffde7","#5a4a00"],["U","#1565c0","#fff"],["B","#7c4dff","#fff"],["R","#b71c1c","#fff"],["G","#1b5e20","#fff"],["C","#455a64","#fff"]].map(([c,bg,fg])=>(
              <div key={c} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:3}}>
                <span style={{background:bg,color:fg,width:22,height:22,borderRadius:"50%",display:"flex",
                  alignItems:"center",justifyContent:"center",fontSize:9,fontWeight:700,
                  boxShadow:`0 0 6px ${bg}80`,border:"1px solid rgba(255,255,255,.15)"}}>{c}</span>
                <div style={{display:"flex",flexDirection:"column",gap:1}}>
                  <button onClick={()=>addMana(c,1)} style={{...btn(`${T.accent}1a`,T.accent,{padding:"1px 6px",fontSize:10,border:`1px solid ${T.accent}40`})}} onMouseOver={hov} onMouseOut={uhov}>+</button>
                  <div style={{textAlign:"center",fontSize:13,color:T.text,fontFamily:"Cinzel Decorative, serif"}}>{manaPool[c]}</div>
                  <button onClick={()=>addMana(c,-1)} style={{...btn("rgba(248,113,113,.08)","#f87171",{padding:"1px 6px",fontSize:10,border:"1px solid rgba(248,113,113,.2)"})}} onMouseOver={hov} onMouseOut={uhov}>−</button>
                </div>
              </div>
            ))}
          </div>
          <button onClick={clearMana} style={{...btn("rgba(248,113,113,.08)","#f87171",{width:"100%",fontSize:9,border:"1px solid rgba(248,113,113,.15)"})}} onMouseOver={hov} onMouseOut={uhov}>Clear All</button>
        </div>
      )}

      {/* Scry modal */}
      {showScry&&(
        <div className="fade-in" style={{position:"fixed",inset:0,background:"rgba(2,4,10,.8)",
          display:"flex",alignItems:"center",justifyContent:"center",zIndex:10000,backdropFilter:"blur(4px)"}}>
          <div className="slide-in" style={{background:`linear-gradient(160deg,${T.panel},${T.bg})`,
            border:`1px solid ${T.accent}50`,borderRadius:10,padding:22,
            boxShadow:"0 24px 80px rgba(0,0,0,.95)"}}>
            <div style={{color:T.accent,fontFamily:"Cinzel Decorative, serif",fontSize:14,marginBottom:14}}>🔮 Scry — How many?</div>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16,justifyContent:"center"}}>
              <button onClick={()=>setScryCount(c=>Math.max(1,c-1))} style={{...btn(`${T.panel}99`,"#8a99b0",{border:`1px solid ${T.border}`,padding:"4px 12px"})}} onMouseOver={hov} onMouseOut={uhov}>−</button>
              <span style={{fontSize:28,fontFamily:"Cinzel Decorative, serif",color:T.accent,minWidth:48,textAlign:"center"}}>{scryCount}</span>
              <button onClick={()=>setScryCount(c=>Math.min(c+1,player.library.length||1))} style={{...btn(`${T.panel}99`,T.accent,{border:`1px solid ${T.accent}40`,padding:"4px 12px"})}} onMouseOver={hov} onMouseOut={uhov}>+</button>
            </div>
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>setShowScry(false)} style={{...btn(`${T.panel}99`,"#8a99b0",{flex:1,border:`1px solid ${T.border}`})}} onMouseOver={hov} onMouseOut={uhov}>Cancel</button>
              <button onClick={()=>{
                // Launch full ScryModal with the top N cards
                const top=player.library.slice(0,scryCount);
                if(top.length){setScryData({cards:top,mode:"scry"});}
                setShowScry(false);
              }}
                style={{...btn("linear-gradient(135deg,#c8a870,#8a6040)",T.bg,{flex:2,fontFamily:"Cinzel, serif",fontWeight:700})}}
                onMouseOver={hov} onMouseOut={uhov}>✦ Look</button>
            </div>
          </div>
        </div>
      )}

      {/* Search Library modal */}
      {/* Search Library modal */}
      {showSearchLib&&(
        <SearchLibModal
          player={player} opponent={opponent}
          onCtx={handleCtx} onHover={setHovered}
          onShuffle={shuffle} onUpdateGame={onUpdateGame}
          oppHandAccess={oppHandAccess} oppLibAccess={oppLibAccess}
          onRequestOppAccess={(zone)=>{
            // Broadcast access request via game state
            onUpdateGame({oppAccessRequest:{zone,fromPlayer:playerIdx,ts:Date.now()}});
          }}
          onClose={()=>{setShowSearchLib(false);setOppHandAccess(false);setOppLibAccess(false);}}/>
      )}
      {/* Opp access request notification */}
      {oppAccessRequest&&(
        <div className="slide-in" style={{position:"fixed",top:80,left:"50%",transform:"translateX(-50%)",
          zIndex:25000,background:`linear-gradient(160deg,${T.panel},${T.bg})`,
          border:"1px solid #fb923c60",borderRadius:10,padding:"14px 20px",
          boxShadow:"0 12px 40px rgba(0,0,0,.9)",textAlign:"center",minWidth:280}}>
          <div style={{fontSize:11,color:"#fb923c",fontFamily:"Cinzel,serif",marginBottom:6}}>
            ⚔ Opponent requests access to your {oppAccessRequest.zone==="opp_hand"?"Hand":"Library"}
          </div>
          <div style={{display:"flex",gap:8,justifyContent:"center"}}>
            <button onClick={()=>{
              onUpdateGame({
                oppAccessGranted:{zone:oppAccessRequest.zone,toPlayer:playerIdx,ts:Date.now()},
                oppAccessRequest:null
              });
              setOppAccessRequest(null);
            }} style={{...btn("rgba(74,222,128,.15)","#4ade80",{border:"1px solid rgba(74,222,128,.3)",padding:"6px 16px",fontFamily:"Cinzel,serif"})}}
            onMouseOver={hov} onMouseOut={uhov}>✓ Allow</button>
            <button onClick={()=>{onUpdateGame({oppAccessRequest:null});setOppAccessRequest(null);}}
              style={{...btn("rgba(248,113,113,.1)","#f87171",{border:"1px solid rgba(248,113,113,.2)",padding:"6px 14px"})}}
              onMouseOver={hov} onMouseOut={uhov}>✕ Deny</button>
          </div>
        </div>
      )}

      {/* v7.6 Phase 4: Incoming zone-reveal request (hand, graveyard, or exile).
          The owner sees this toast with Show/Deny buttons. Reveal emits a
          zone_reveal event carrying the zone's actual cards; deny emits a
          zone_deny. */}
      {incomingZoneRequest&&(()=>{
        const zone=incomingZoneRequest.zone||"hand";
        const zoneLabel=zone==="hand"?"hand":zone==="graveyard"?"graveyard":zone==="exile"?"exile":zone;
        const zoneCards=zone==="hand"?player.hand:zone==="graveyard"?player.graveyard:zone==="exile"?player.exile:[];
        return (
        <div className="slide-in" style={{position:"fixed",top:80,left:"50%",transform:"translateX(-50%)",
          zIndex:25001,background:`linear-gradient(160deg,${T.panel},${T.bg})`,
          border:"1px solid #a78bfa60",borderRadius:10,padding:"14px 20px",
          boxShadow:"0 12px 40px rgba(0,0,0,.9)",textAlign:"center",minWidth:300}}>
          <div style={{fontSize:11,color:"#a78bfa",fontFamily:"Cinzel,serif",marginBottom:6}}>
            👁 {incomingZoneRequest.requesterAlias} wants to see your {zoneLabel}
          </div>
          <div style={{display:"flex",gap:8,justifyContent:"center"}}>
            <button onClick={()=>{
              const net=window.__MTG_V7__?.netSync;
              if(net){
                try{net.appendEvent("zone_reveal",{
                  zone,
                  requesterUserId:incomingZoneRequest.requesterUserId,
                  revealerUserId:authUser?.id,
                  cards:zoneCards,
                  ts:Date.now()
                });}catch{}
              }
              addLog(`👁 Revealed ${zoneLabel} to ${incomingZoneRequest.requesterAlias}`);
              setIncomingZoneRequest(null);
            }} style={{...btn("rgba(74,222,128,.15)","#4ade80",{border:"1px solid rgba(74,222,128,.3)",padding:"6px 16px",fontFamily:"Cinzel,serif"})}}
            onMouseOver={hov} onMouseOut={uhov}>✓ Show</button>
            <button onClick={()=>{
              const net=window.__MTG_V7__?.netSync;
              if(net){try{net.appendEvent("zone_deny",{zone,requesterUserId:incomingZoneRequest.requesterUserId,ts:Date.now()});}catch{}}
              setIncomingZoneRequest(null);
            }} style={{...btn("rgba(248,113,113,.1)","#f87171",{border:"1px solid rgba(248,113,113,.2)",padding:"6px 14px"})}}
              onMouseOver={hov} onMouseOut={uhov}>✕ Deny</button>
          </div>
        </div>
        );
      })()}

      {/* v7.6 Phase 4: Outgoing zone-request status (pending / denied / timeout). */}
      {outgoingZoneRequest&&(
        <div style={{position:"fixed",top:120,right:20,zIndex:24000,
          background:`linear-gradient(160deg,${T.panel}e0,${T.bg}e0)`,
          border:"1px solid #a78bfa40",borderRadius:8,padding:"10px 14px",
          fontSize:10,color:"#a78bfa",fontFamily:"Cinzel,serif"}}>
          👁 Waiting for {outgoingZoneRequest.targetAlias}'s {outgoingZoneRequest.zone||"hand"}…
        </div>
      )}
      {zoneRequestStatus&&(
        <div style={{position:"fixed",top:120,right:20,zIndex:24000,
          background:`linear-gradient(160deg,${T.panel}e0,${T.bg}e0)`,
          border:`1px solid ${zoneRequestStatus.type==="denied"?"#f87171":"#fbbf24"}60`,
          borderRadius:8,padding:"10px 14px",
          fontSize:10,color:zoneRequestStatus.type==="denied"?"#f87171":"#fbbf24",fontFamily:"Cinzel,serif"}}>
          {zoneRequestStatus.type==="denied"
            ? `✕ ${zoneRequestStatus.alias} denied the ${zoneRequestStatus.zone||"hand"} request`
            : `⏱ No response from ${zoneRequestStatus.alias} (${zoneRequestStatus.zone||"hand"})`}
        </div>
      )}

      {/* Mill X prompt */}
      {showMillPrompt&&(()=>{
        const isExile=millTarget==="exile";
        const color=isExile?"#60a5fa":"#a78bfa";
        const borderColor=isExile?"rgba(96,165,250,.4)":"rgba(167,139,250,.4)";
        const icon=isExile?"✦":"💀";
        const label=isExile?"Exile":"Graveyard";
        return(
        <div className="fade-in" style={{position:"fixed",inset:0,background:"rgba(2,4,10,.85)",
          display:"flex",alignItems:"center",justifyContent:"center",zIndex:20000,backdropFilter:"blur(4px)"}}>
          <div className="slide-in" style={{background:`linear-gradient(160deg,${T.panel},${T.bg})`,
            border:`1px solid ${borderColor}`,borderRadius:10,padding:22,
            boxShadow:"0 24px 80px rgba(0,0,0,.95)",minWidth:240,textAlign:"center"}}>
            <div style={{color,fontFamily:"Cinzel,serif",fontSize:13,marginBottom:6}}>
              {icon} Mill X → {label}
            </div>
            {/* Toggle target zone */}
            <div style={{display:"flex",gap:6,justifyContent:"center",marginBottom:14}}>
              <button onClick={()=>setMillTarget("graveyard")}
                style={{...btn(millTarget==="graveyard"?"rgba(167,139,250,.2)":"transparent",millTarget==="graveyard"?"#a78bfa":"#4a6a8a",
                  {fontSize:9,border:`1px solid ${millTarget==="graveyard"?"rgba(167,139,250,.4)":"#1e3a5f20"}`,padding:"3px 10px",borderRadius:4})}}
                onMouseOver={hov} onMouseOut={uhov}>💀 Graveyard</button>
              <button onClick={()=>setMillTarget("exile")}
                style={{...btn(millTarget==="exile"?"rgba(96,165,250,.2)":"transparent",millTarget==="exile"?"#60a5fa":"#4a6a8a",
                  {fontSize:9,border:`1px solid ${millTarget==="exile"?"rgba(96,165,250,.4)":"#1e3a5f20"}`,padding:"3px 10px",borderRadius:4})}}
                onMouseOver={hov} onMouseOut={uhov}>✦ Exile</button>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:10,justifyContent:"center",marginBottom:14}}>
              <button onClick={()=>setMillCount(c=>Math.max(1,c-1))} style={{...btn(`${T.panel}99`,"#8a99b0",{border:`1px solid ${T.border}`,padding:"4px 12px"})}} onMouseOver={hov} onMouseOut={uhov}>−</button>
              <span style={{fontSize:28,fontFamily:"Cinzel Decorative,serif",color,minWidth:44,textAlign:"center"}}>{millCount}</span>
              <button onClick={()=>setMillCount(c=>Math.min(c+1,player.library.length||1))} style={{...btn(`${T.panel}99`,color,{border:`1px solid ${borderColor}`,padding:"4px 12px"})}} onMouseOver={hov} onMouseOut={uhov}>+</button>
            </div>
            <div style={{fontSize:8,color:"#3a5a7a",fontFamily:"Cinzel,serif",marginBottom:10}}>
              {player.library.length} cards in library
            </div>
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>setShowMillPrompt(false)} style={{...btn(`${T.panel}99`,"#8a99b0",{flex:1,border:`1px solid ${T.border}`})}} onMouseOver={hov} onMouseOut={uhov}>Cancel</button>
              <button onClick={()=>{
                if(millTarget==="exile") millExile(millCount);
                else mill(millCount);
                setShowMillPrompt(false);
              }} style={{...btn(isExile?"rgba(96,165,250,.15)":"rgba(167,139,250,.15)",color,
                {flex:2,border:`1px solid ${borderColor}`,fontFamily:"Cinzel,serif",fontWeight:700})}}
                onMouseOver={hov} onMouseOut={uhov}>{icon} Mill {millCount}</button>
            </div>
          </div>
        </div>
        );
      })()}

      {/* Library drop prompt */}
      {libDropPrompt&&(
        <div className="fade-in" style={{position:"fixed",left:Math.min(libDropPrompt.x, window.innerWidth-180),top:Math.min(libDropPrompt.y, window.innerHeight-120),
          zIndex:20000,background:"linear-gradient(160deg,#0d1f3c,#0a1628)",
          border:`1px solid ${T.accent}60`,borderRadius:8,padding:12,
          boxShadow:"0 12px 40px rgba(0,0,0,.95)"}}>
          <div style={{fontSize:11,color:T.accent,fontFamily:"Cinzel,serif",marginBottom:4}}>{libDropPrompt.card.name}</div>
          <div style={{fontSize:9,color:"#4a6a8a",fontFamily:"Cinzel,serif",marginBottom:8}}>Place on library?</div>
          <div style={{display:"flex",gap:6}}>
            <button onClick={()=>{
              const {card,fromZone}=libDropPrompt;
              // Commander from command zone → library: keep command zone portrait
              if(card.isCommander && fromZone==="command"){
                upd(p=>{
                  const add=(arr,c)=>[c,...arr];
                  return{...p,
                    library:add(p.library.filter(c=>c.iid!==card.iid),{...card,zone:"library",tapped:false}),
                    command:p.command.map(c=>c.iid===card.iid?{...c,status:"away"}:c),
                    log:[`T${turn}:${card.name} → library top`,...p.log].slice(0,80)};
                });
              } else {
                moveCard(card,fromZone,"library","top");
              }
              setLibDropPrompt(null);
            }}
              style={{...btn(`${T.accent}1a`,T.accent,{fontFamily:"Cinzel,serif",border:`1px solid ${T.accent}50`})}}
              onMouseOver={hov} onMouseOut={uhov}>↑ Top</button>
            <button onClick={()=>{
              const {card,fromZone}=libDropPrompt;
              if(card.isCommander && fromZone==="command"){
                upd(p=>{
                  return{...p,
                    library:[...p.library.filter(c=>c.iid!==card.iid),{...card,zone:"library",tapped:false}],
                    command:p.command.map(c=>c.iid===card.iid?{...c,status:"away"}:c),
                    log:[`T${turn}:${card.name} → library bottom`,...p.log].slice(0,80)};
                });
              } else {
                moveCard(card,fromZone,"library","bottom");
              }
              setLibDropPrompt(null);
            }}
              style={{...btn("rgba(96,165,250,.1)","#60a5fa",{fontFamily:"Cinzel,serif",border:"1px solid rgba(96,165,250,.25)"})}}
              onMouseOver={hov} onMouseOut={uhov}>↓ Bottom</button>
            <button onClick={()=>setLibDropPrompt(null)} style={{...btn(`${T.panel}99`,"#6a7a8a",{border:`1px solid ${T.border}`})}} onMouseOver={hov} onMouseOut={uhov}>✕</button>
          </div>
        </div>
      )}

      {/* Graveyard viewer modal */}
      {showGraveViewer&&(
        <ZoneViewerModal title="Graveyard" icon="☠" color="#a78bfa"
          cards={player.graveyard} zone="graveyard"
          onHover={setHovered}
          onCtx={(e,card,fromZone,targetZone)=>{
            // targetZone comes from inline context menu; route to real actions
            if(targetZone==="hand")            { moveCard(card,fromZone,"hand"); }
            else if(targetZone==="battlefield"){ SFX.playAction("reanimate"); moveCard(card,fromZone,"battlefield"); }
            else if(targetZone==="exile")      { SFX.playAction("toExile");   moveCard(card,fromZone,"exile"); }
            else if(targetZone==="library-top"){ moveCard(card,fromZone,"library","top"); }
            else if(targetZone==="library-bottom"){ moveCard(card,fromZone,"library","bottom"); }
            else if(targetZone==="shuffle")    {
              moveCard(card,fromZone,"library","bottom");
              setTimeout(()=>{upd(p=>({...p,library:shuffleArr(p.library)}));SFX.playAction("shuffle");},10);
            }
            else { handleCtx(e,card,fromZone); } // fallback to global ctx
          }}
          onDragStart={(e,card,zone)=>{startFloatDrag(e,card,zone);setShowGraveViewer(false);}}
          onBulkExile={()=>{
            SFX.playAction("toExile");
            upd(p=>({...p,exile:[...p.exile,...p.graveyard.map(c=>({...c,zone:"exile"}))],graveyard:[],
              log:[`T${turn}:✦ Exiled entire graveyard (${p.graveyard.length})`,...p.log].slice(0,80)}));
          }}
          onBulkShuffle={()=>{
            SFX.playAction("shuffle");
            upd(p=>{
              const newLib=shuffleArr([...p.library,...p.graveyard.map(c=>({...c,zone:"library"}))]);
              return{...p,library:newLib,graveyard:[],
                log:[`T${turn}:🔀 Shuffled graveyard into library`,...p.log].slice(0,80)};
            });
          }}
          onClose={()=>setShowGraveViewer(false)}/>
      )}
      {showExileViewer&&(
        <ZoneViewerModal title="Exile" icon="✦" color="#60a5fa"
          cards={player.exile} zone="exile"
          onHover={setHovered}
          onCtx={(e,card,fromZone,targetZone)=>{
            if(targetZone==="hand")            { moveCard(card,fromZone,"hand"); }
            else if(targetZone==="battlefield"){ SFX.playAction("reanimate"); moveCard(card,fromZone,"battlefield"); }
            else if(targetZone==="graveyard")  { moveCard(card,fromZone,"graveyard"); }
            else if(targetZone==="library-top"){ moveCard(card,fromZone,"library","top"); }
            else if(targetZone==="library-bottom"){ moveCard(card,fromZone,"library","bottom"); }
            else if(targetZone==="shuffle")    {
              moveCard(card,fromZone,"library","bottom");
              setTimeout(()=>{upd(p=>({...p,library:shuffleArr(p.library)}));SFX.playAction("shuffle");},10);
            }
            else { handleCtx(e,card,fromZone); }
          }}
          onDragStart={(e,card,zone)=>{startFloatDrag(e,card,zone);setShowExileViewer(false);}}
          onBulkShuffle={()=>{
            SFX.playAction("shuffle");
            upd(p=>{
              const newLib=shuffleArr([...p.library,...p.exile.map(c=>({...c,zone:"library"}))]);
              return{...p,library:newLib,exile:[],
                log:[`T${turn}:🔀 Shuffled exile into library`,...p.log].slice(0,80)};
            });
          }}
          onClose={()=>setShowExileViewer(false)}/>
      )}

      {/* v7.6 Phase 4-C: revealed-zone viewer modals (readOnly). One modal per
          currently-revealed opponent zone. Reuses ZoneViewerModal with all
          mutation callbacks undefined so bulk buttons and the inline context
          menu auto-suppress (they key off onBulkExile/onBulkShuffle and the
          zone strict-match "graveyard"/"exile"). `opp_{zone}` passes the
          strict-match suppression naturally. Hover preview still works. */}
      {Object.entries(revealedOppZones).map(([zone,data])=>{
        if(!data||!Array.isArray(data.cards)||data.cards.length===0) return null;
        const zoneLabel = zone==="hand"?"Hand":zone==="graveyard"?"Graveyard":zone==="exile"?"Exile":zone;
        const zoneIcon  = zone==="hand"?"✋":zone==="graveyard"?"☠":zone==="exile"?"✦":"•";
        const zoneColor = zone==="hand"?T.accent:zone==="graveyard"?"#a78bfa":zone==="exile"?"#60a5fa":T.border;
        const alias     = opponent?.profile?.alias||"Opponent";
        const closeOne  = ()=>setRevealedOppZones(prev=>{
          const next={...prev}; delete next[zone]; return next;
        });
        return(
          <ZoneViewerModal
            key={`revealed-${zone}`}
            title={`${alias}'s ${zoneLabel} · revealed`}
            icon={zoneIcon} color={zoneColor}
            cards={data.cards} zone={`opp_${zone}`}
            onHover={setHovered}
            onClose={closeOne}
          />
        );
      })}

      {/* Copy mode banner — pointerEvents:none so clicks reach battlefield cards */}
      {copyMode&&(
        <div className="fade-in" style={{position:"fixed",top:0,left:0,right:0,
          zIndex:19000,pointerEvents:"none",display:"flex",justifyContent:"center",paddingTop:8}}>
          <div style={{background:`linear-gradient(160deg,${T.panel}f5,${T.bg}f5)`,border:"1px solid #60a5fa80",
            borderRadius:8,padding:"8px 18px",fontSize:12,color:"#60a5fa",fontFamily:"Cinzel,serif",
            boxShadow:"0 4px 20px rgba(0,0,0,.8)",backdropFilter:"blur(4px)"}}>
            ⧉ Click target card on battlefield → <b style={{color:T.accent}}>{copyMode.card.name}</b> becomes a copy · Esc to cancel
          </div>
        </div>
      )}
      <FloatingCard drag={floatDrag}/>
      {hovered&&<CardPreview card={hovered}/>}
      {ctxMenu&&<ContextMenu x={ctxMenu.x} y={ctxMenu.y} items={ctxMenu.items || buildCtx(ctxMenu.card,ctxMenu.zone,ctxMenu.counterKey||null)} onClose={()=>setCtxMenu(null)}/>}
      {showToken&&<TokenSearch onCreate={createToken} onClose={()=>setShowToken(false)}/>}
      {showCustom&&<CustomCardCreator onSave={card=>{createToken({...card,isToken:false});}} onClose={()=>setShowCustom(false)}/>}
      {showCounterPicker&&<CounterPicker
        card={showCounterPicker}
        onAdd={(type,amt)=>addCounter(showCounterPicker,type,amt)}
        onClose={()=>setShowCounterPicker(null)}/>}
      {showPlanechase&&<PlanechasePanel
        active={currentPlane}
        onPlaneswalk={planeswalk}
        onChaos={triggerChaos}
        onClose={()=>setShowPlanechase(false)}/>}
      {showRevealHand&&<RevealHandModal
        hand={player.hand}
        playerName={player.profile?.alias||"Player"}
        onClose={()=>setShowRevealHand(false)}/>}
      {showHotkeys&&<HotkeyHelp onClose={()=>setShowHotkeys(false)}/>}
      {showSoundSettings&&<SoundSettings onClose={()=>setShowSoundSettings(false)}/>}
      <InGameChat
        playerName={player.profile?.alias||"Player"}
        avatar={player.profile?.avatar||"🧙"}
        isOpen={showChat}
        log={player.log}
        showLog={showLog}
        onToggleLog={()=>setShowLog(v=>!v)}
        onToggle={()=>setShowChat(v=>!v)}/>
    </div>
  );
}

/* ─── DeckBuilder ─────────────────────────────────────────────────── */

/* Smart decklist parser — handles any format:
   "4 Lightning Bolt", "4x Lightning Bolt", "Lightning Bolt x4",
   section headers like "Creatures:", "//Sideboard", numbered or plain,
   MTGO, Moxfield, Archidekt, plain list, etc.
*/
function parseDecklist(text){
  const lines = text.split(/\r?\n/);
  const main = [], side = [], tokens = [];
  let zone = "main"; // "main" | "side" | "token"
  const sideHeaders = /^(sideboard|side\s*board|sb|\/\/\s*sideboard|sideboard:)/i;
  const tokenHeaders = /^(tokens?|\/\/\s*tokens?)/i;
  const mainHeaders = /^(main\s*(deck)?|maindeck|\/\/\s*main|deck:?|commander:?|creatures?:?|lands?:?|spells?:?|instants?:?|sorceri(es|y):?|enchantments?:?|artifacts?:?|planeswalkers?:?|other:?)/i;
  // line that is purely a section header (no card name)
  const headerOnly = /^(\/\/[^0-9]|#{1,3}\s|---|\*\*\*)/;

  for(let raw of lines){
    const line = raw.trim();
    if(!line) continue;

    // Section switches
    if(sideHeaders.test(line)){ zone="side"; continue; }
    if(tokenHeaders.test(line)){ zone="token"; continue; }
    if(mainHeaders.test(line)){ zone="main"; continue; }
    if(headerOnly.test(line)) continue;

    // Parse quantity + name
    // Formats: "4 Name", "4x Name", "x4 Name", "Name x4", "Name (SET) 123", "1 Name (SET)"
    let qty = 1, name = "";
    // "4x Name" or "4 Name"
    let m = line.match(/^(\d+)[xX\s]+(.+)$/);
    if(m){ qty=parseInt(m[1]); name=m[2].trim(); }
    else {
      // "Name x4" at end
      m = line.match(/^(.+?)\s+[xX](\d+)$/);
      if(m){ qty=parseInt(m[2]); name=m[1].trim(); }
      else { name=line; qty=1; }
    }
    // Strip set code & collector number: "Lightning Bolt (M10) 149" or "[M10]"
    name = name.replace(/\s*[\(\[]\s*[A-Z0-9]{2,6}\s*[\)\]]\s*\d*\s*$/i,"").trim();
    // Strip anything after " // " (split cards listed as "Fire // Ice" keep as-is but "Name // extra" → name only if extra looks like set)
    // Strip trailing asterisks/stars used by some exporters
    name = name.replace(/\s*\*[fF]\*\s*$/, "").trim();
    if(!name || name.length < 2) continue;

    const entry = { name, quantity: qty };
    if(zone==="side") side.push(entry);
    else if(zone==="token") tokens.push(entry);
    else main.push(entry);
  }
  // Collapse duplicates
  const collapse = arr => {
    const map = {};
    arr.forEach(({name,quantity})=>{
      const k = name.toLowerCase();
      map[k] = map[k] ? {...map[k], quantity: map[k].quantity+quantity} : {name, quantity};
    });
    return Object.values(map);
  };
  return { main: collapse(main), side: collapse(side), tokens: collapse(tokens) };
}

/* Fetch a single card by exact name from Scryfall */
async function sfNamed(name){
  // Try exact first, then fuzzy, to avoid wrong matches
  try{
    const r=await fetch(`https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name)}`);
    if(r.ok)return await r.json();
  }catch{}
  try{
    const r=await fetch(`https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(name)}`);
    if(r.ok)return await r.json();
  }catch{}
  // Last resort: search API
  try{
    const r=await fetch(`https://api.scryfall.com/cards/search?q=!"${encodeURIComponent(name)}"&unique=cards`);
    if(r.ok){const d=await r.json();if(d.data?.length)return d.data[0];}
  }catch{}
  return null;
}

/* Batch import modal */
function BatchImporter({onImport, onClose}){
  const [text, setText] = useState("");
  const [status, setStatus] = useState(null); // {done,total,errors}
  const [importing, setImporting] = useState(false);
  const [preview, setPreview] = useState(null);
  const [partialResults, setPartialResults] = useState(null); // v7.5.1: holds results so user can retry failed

  const handlePreview = () => {
    const parsed = parseDecklist(text);
    setPreview(parsed);
    setStatus(null);
  };

  const handleImport = async () => {
    const parsed = preview || parseDecklist(text);
    const allEntries = [
      ...parsed.main.map(e=>({...e,zone:"main"})),
      ...parsed.side.map(e=>({...e,zone:"side"})),
      ...parsed.tokens.map(e=>({...e,zone:"token"})),
    ];
    if(!allEntries.length){ setStatus({done:0,total:0,errors:["Nothing to import"]}); return; }
    setImporting(true);
    setStatus({done:0,total:allEntries.length,errors:[]});

    const results = {main:[],side:[],tokens:[]};
    const failed = []; // entries that failed to fetch

    // v7.5.1: Process in chunks of 10 cards with retry-on-fail.
    // Scryfall has a soft rate limit ~10 req/s; we stay under that with 110ms delay.
    // On failure (network/rate limit), retry once after 600ms before giving up.
    const tryFetch = async (name) => {
      let card = await sfNamed(name);
      if (card) return card;
      // Retry once after short delay
      await new Promise(r => setTimeout(r, 600));
      card = await sfNamed(name);
      return card;
    };

    for(let i=0; i<allEntries.length; i++){
      const {name,quantity,zone} = allEntries[i];
      const card = await tryFetch(name);
      if(card){
        const entry = {...buildDeckEntry(card), quantity};
        results[zone].push(entry);
      } else {
        failed.push({name, quantity, zone});
      }
      setStatus({done:i+1,total:allEntries.length,errors:failed.map(f=>f.name)});
      if(i<allEntries.length-1) await new Promise(r=>setTimeout(r,110));
    }

    // v7.5.1: Second retry pass on every failure with longer delay (rate limit recovery)
    if(failed.length > 0){
      setStatus(s=>({...s, retrying: true}));
      const stillFailed = [];
      for(let i=0; i<failed.length; i++){
        const {name,quantity,zone} = failed[i];
        await new Promise(r=>setTimeout(r,400));
        const card = await sfNamed(name);
        if(card){
          const entry = {...buildDeckEntry(card), quantity};
          results[zone].push(entry);
        } else {
          stillFailed.push({name,quantity,zone});
        }
      }
      failed.length = 0;
      failed.push(...stillFailed);
    }

    setImporting(false);
    // Report final totals + failure list so user can retry
    const importedTotal = results.main.reduce((s,c)=>s+c.quantity,0)
      + results.side.reduce((s,c)=>s+c.quantity,0)
      + results.tokens.reduce((s,c)=>s+c.quantity,0);
    const expectedTotal = allEntries.reduce((s,e)=>s+e.quantity,0);
    setStatus({
      done: allEntries.length,
      total: allEntries.length,
      errors: failed.map(f=>`${f.quantity>1?f.quantity+'× ':''}${f.name}`),
      importedTotal,
      expectedTotal,
      finishedAt: Date.now(),
      failedEntries: failed, // for re-try
    });
    if(failed.length === 0){
      onImport(results);
    } else {
      // Keep modal open with partial results + missing list. User clicks "Add what was found" to commit.
      setPartialResults(results);
    }
  };

  const retryFailed = async () => {
    if(!status?.failedEntries || !partialResults) return;
    setImporting(true);
    const failed = [...status.failedEntries];
    const stillFailed = [];
    const results = {
      main:[...(partialResults.main||[])],
      side:[...(partialResults.side||[])],
      tokens:[...(partialResults.tokens||[])],
    };
    for(let i=0;i<failed.length;i++){
      const {name,quantity,zone} = failed[i];
      await new Promise(r=>setTimeout(r,500));
      const card = await sfNamed(name);
      if(card){
        results[zone].push({...buildDeckEntry(card), quantity});
      } else {
        stillFailed.push({name,quantity,zone});
      }
      setStatus(s=>({...s, done: partialResults.main.length + i+1,
        errors: stillFailed.map(f=>f.name)}));
    }
    setImporting(false);
    setPartialResults(results);
    setStatus(s=>({...s, failedEntries: stillFailed, errors: stillFailed.map(f=>f.name)}));
    if(stillFailed.length===0) onImport(results);
  };

  const commitPartial = () => {
    if(partialResults) onImport(partialResults);
  };

  const parsed = preview || (text.trim() ? parseDecklist(text) : null);

  return(
    <div className="fade-in" style={{position:"fixed",inset:0,background:"rgba(2,4,10,.93)",
      display:"flex",alignItems:"center",justifyContent:"center",zIndex:10000,backdropFilter:"blur(4px)"}}>
      <div className="slide-in" style={{
        background:`linear-gradient(160deg,${T.panel},${T.bg})`,
        border:`1px solid ${T.accent}50`,borderRadius:12,padding:24,
        width:560,maxHeight:"88vh",display:"flex",flexDirection:"column",gap:14,
        boxShadow:"0 24px 80px rgba(0,0,0,.95)",position:"relative",overflow:"hidden"}}>
        <div style={{position:"absolute",top:0,left:0,right:0,height:2,
          background:"linear-gradient(90deg,transparent,#c8a870,transparent)"}}/>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <h3 style={{color:T.accent,fontFamily:"Cinzel Decorative, serif",fontSize:14,margin:0}}>📋 Batch Import</h3>
          <button onClick={onClose} style={{...btn("transparent","#6a7a8a",{fontSize:16,border:"none"})}} onMouseOver={hov} onMouseOut={uhov}>✕</button>
        </div>
        <div style={{fontSize:10,color:"#4a6a8a",lineHeight:1.6,fontFamily:"Crimson Text, serif"}}>
          Paste any decklist format — Moxfield, Archidekt, MTGO, plain list. Supports numbered, sections like "Sideboard:", "//Creatures", etc.
        </div>
        <textarea
          value={text} onChange={e=>{setText(e.target.value);setPreview(null);setStatus(null);}}
          placeholder={"4 Lightning Bolt\n2x Counterspell\nSwamp\n\nSideboard\n2 Tormod's Crypt\n\n// Tokens\n1 Goblin"}
          style={{...iS,height:200,resize:"vertical",fontFamily:"'Crimson Text',monospace",fontSize:11,lineHeight:1.6,marginTop:0}}
          onFocus={e=>{e.target.style.borderColor=T.accent;}}
          onBlur={e=>{e.target.style.borderColor=T.border;}}
        />

        {/* Preview */}
        {parsed && !importing && (
          <div style={{background:`${T.bg}99`,borderRadius:6,padding:"8px 12px",border:`1px solid ${T.border}30`}}>
            <div style={{display:"flex",gap:16,fontSize:10,fontFamily:"Cinzel, serif",color:"#8a99b0"}}>
              <span>🃏 Main: <b style={{color:T.accent}}>{parsed.main.reduce((s,c)=>s+c.quantity,0)}</b> ({parsed.main.length} unique)</span>
              {parsed.side.length>0&&<span>⚔ Side: <b style={{color:"#60a5fa"}}>{parsed.side.reduce((s,c)=>s+c.quantity,0)}</b></span>}
              {parsed.tokens.length>0&&<span>✦ Tokens: <b style={{color:"#a78bfa"}}>{parsed.tokens.reduce((s,c)=>s+c.quantity,0)}</b></span>}
            </div>
            <div style={{marginTop:6,maxHeight:80,overflowY:"auto",display:"flex",flexWrap:"wrap",gap:3}}>
              {[...parsed.main,...parsed.side,...parsed.tokens].slice(0,30).map((c,i)=>(
                <span key={i} style={{fontSize:9,background:"rgba(200,168,112,.07)",color:T.text,
                  padding:"1px 6px",borderRadius:3,border:"1px solid rgba(200,168,112,.15)"}}>
                  {c.quantity>1?`${c.quantity}×`:""}{c.name}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Status */}
        {status && (
          <div style={{fontSize:10,fontFamily:"Cinzel, serif"}}>
            {importing ? (
              <div style={{color:T.accent}}>
                🔮 Fetching from Scryfall… {status.done}/{status.total}
                <div style={{marginTop:4,height:3,background:T.panel,borderRadius:2,overflow:"hidden"}}>
                  <div style={{height:"100%",background:"linear-gradient(90deg,#c8a870,#f0d080)",
                    width:`${(status.done/status.total)*100}%`,transition:"width .2s",borderRadius:2}}/>
                </div>
              </div>
            ):(
              <div>
                <span style={{color:status.errors.length===0?"#4ade80":"#fbbf24"}}>
                  {status.errors.length===0?"✓ Done!":"⚠ Partial import —"} {status.importedTotal ?? (status.total - status.errors.length)} of {status.expectedTotal ?? status.total} cards imported.
                </span>
                {status.errors.length>0&&(
                  <div style={{marginTop:6,color:"#f87171",fontSize:9,background:"rgba(248,113,113,.08)",
                    border:"1px solid rgba(248,113,113,.2)",borderRadius:4,padding:"6px 8px",maxHeight:100,overflowY:"auto"}}>
                    <b>✗ {status.errors.length} card(s) not found:</b><br/>
                    {status.errors.map((e,i)=><span key={i} style={{display:"inline-block",margin:"1px 3px",
                      background:"rgba(248,113,113,.12)",padding:"0 4px",borderRadius:2}}>{e}</span>)}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          <button onClick={onClose}
            style={{...btn(`${T.panel}99`,"#8a99b0",{flex:1,minWidth:80,border:`1px solid ${T.border}`})}}
            onMouseOver={hov} onMouseOut={uhov}>Cancel</button>
          {!importing && !status && (
            <button onClick={handlePreview}
              style={{...btn("rgba(96,165,250,.1)","#60a5fa",{flex:1,minWidth:80,border:"1px solid rgba(96,165,250,.25)"})}}
              onMouseOver={hov} onMouseOut={uhov}>Preview</button>
          )}
          {!importing && !status && (
            <button onClick={handleImport} disabled={!text.trim()}
              style={{...btn("linear-gradient(135deg,#c8a870,#8a6040)",T.bg,{flex:2,minWidth:140,fontFamily:"Cinzel, serif",fontWeight:700,border:`1px solid ${T.accent}60`})}}
              onMouseOver={hov} onMouseOut={uhov}>✦ Import List</button>
          )}
          {/* v7.5.1: When partial import, offer retry + commit-what-we-got */}
          {status && !importing && status.errors.length>0 && partialResults && (
            <>
              <button onClick={retryFailed}
                style={{...btn("rgba(251,191,36,.15)","#fbbf24",{flex:1,minWidth:100,border:"1px solid rgba(251,191,36,.3)"})}}
                onMouseOver={hov} onMouseOut={uhov}>↻ Retry failed</button>
              <button onClick={commitPartial}
                style={{...btn("linear-gradient(135deg,#c8a870,#8a6040)",T.bg,{flex:1,minWidth:140,fontFamily:"Cinzel, serif",fontWeight:700})}}
                onMouseOver={hov} onMouseOut={uhov}>✓ Add found ({status.importedTotal||0})</button>
            </>
          )}
          {status && !importing && status.errors.length===0 && (
            <button onClick={onClose}
              style={{...btn("linear-gradient(135deg,#4ade80,#16a34a)",T.bg,{flex:2,minWidth:100,fontFamily:"Cinzel, serif",fontWeight:700})}}
              onMouseOver={hov} onMouseOut={uhov}>✓ Done</button>
          )}
        </div>
      </div>
    </div>
  );
}

function DeckBuilder({deck,onSave,onBack,customCards=[]}){
  const [name,setName]=useState(deck?.name||"Unnamed Deck");
  const [cards,setCards]=useState(deck?.cards||[]);
  const [sideboard,setSideboard]=useState(deck?.sideboard||[]);
  const [tokens,setTokenList]=useState(deck?.tokens||[]);
  const [commanders,setCommanders]=useState(
    deck?.commanders || (deck?.commander ? [deck.commander] : [])
  );
  const [sleeveUri,setSleeveUri]=useState(deck?.sleeveUri||"");
  const [playmatUri,setPlaymatUri]=useState(deck?.playmatUri||""); // v7.5.1: per-deck playmat
  const [format,setFormat]=useState(deck?.format||"standard");
  const [query,setQuery]=useState(""),[ results,setResults]=useState([]),[ loading,setLoading]=useState(false);
  const [hovered,setHovered]=useState(null),[error,setError]=useState("");
  const [showCustom,setShowCustom]=useState(false);
  const [showBatch,setShowBatch]=useState(false);
  const [activeZone,setActiveZone]=useState("main"); // "main"|"side"|"token"|"cmdr"
  const [selectedCard,setSelectedCard]=useState(null); // card selected in deck list for preview
  const [printings,setPrintings]=useState([]); // alternate art/set printings
  const [loadingPrints,setLoadingPrints]=useState(false);
  const [deckDragCard,setDeckDragCard]=useState(null); // {card, fromZone}
  const [deckCtx,setDeckCtx]=useState(null); // {x,y,card,fromZone}
  const historyRef=useRef([]); // [{cards,sideboard,tokens,commanders}]
  const futureRef=useRef([]);  // redo stack
  const snapshotState=()=>({cards:[...cards],sideboard:[...sideboard],tokens:[...tokens],commanders:[...commanders]});
  const pushHistory=()=>{
    historyRef.current=[...historyRef.current.slice(-9),snapshotState()];
    futureRef.current=[];
  };
  const undo=()=>{
    if(!historyRef.current.length)return;
    futureRef.current=[...futureRef.current,snapshotState()];
    const prev=historyRef.current[historyRef.current.length-1];
    historyRef.current=historyRef.current.slice(0,-1);
    setCards(prev.cards);setSideboard(prev.sideboard);setTokenList(prev.tokens);setCommanders(prev.commanders);
  };
  const redo=()=>{
    if(!futureRef.current.length)return;
    historyRef.current=[...historyRef.current,snapshotState()];
    const next=futureRef.current[futureRef.current.length-1];
    futureRef.current=futureRef.current.slice(0,-1);
    setCards(next.cards);setSideboard(next.sideboard);setTokenList(next.tokens);setCommanders(next.commanders);
  };
  const tmr=useRef(null);

  // Fixed Scryfall search — use /cards/search with proper error handling
  useEffect(()=>{
    clearTimeout(tmr.current);
    if(!query.trim()||query.length<2){setResults([]);return;}
    tmr.current=setTimeout(async()=>{
      setLoading(true);setError("");
      try{
        const url=`https://api.scryfall.com/cards/search?q=${encodeURIComponent(query)}&unique=cards&order=name&limit=20`;
        const resp = await fetch(url);
        let found = [];
        if(resp.ok){
          const data = await resp.json();
          found = data.data||[];
        } else if(resp.status===404){
          const named = await sfNamed(query);
          if(named) found=[named];
        }
        const customMatches=customCards.filter(c=>c.name.toLowerCase().includes(query.toLowerCase()));
        const all=[...customMatches,...found];
        setResults(all);
        if(!all.length) setError("No cards found — try a different spelling");
      }catch(e){setError("Search failed — check your internet connection");}
      setLoading(false);
    },400);
  },[query,customCards]);

  // When a card is selected in the deck list, fetch all printings
  useEffect(()=>{
    if(!selectedCard?.name) return;
    setPrintings([]);
    setLoadingPrints(true);
    const q=encodeURIComponent(`!"${selectedCard.name}"`);
    fetch(`https://api.scryfall.com/cards/search?q=${q}&unique=prints&order=released`)
      .then(r=>r.ok?r.json():null)
      .then(d=>{if(d?.data)setPrintings(d.data);})
      .catch(()=>{})
      .finally(()=>setLoadingPrints(false));
  },[selectedCard?.name]);

  const getList=()=>activeZone==="side"?sideboard:activeZone==="token"?tokens:cards;
  const setList=(fn)=>{
    if(activeZone==="side") setSideboard(fn);
    else if(activeZone==="token") setTokenList(fn);
    else setCards(fn);
  };

  const addCard=useCallback((card,zone)=>{
    pushHistory();
    const z=zone||activeZone;
    if(z==="cmdr"){setAsCmdr(card);return;}
    const n={...buildDeckEntry(card),quantity:1,isCustom:!!card.isCustom};
    const setter=z==="side"?setSideboard:z==="token"?setTokenList:setCards;
    setter(prev=>{
      const ex=prev.find(c=>c.scryfallId===n.scryfallId);
      if(ex) return prev.map(c=>c.scryfallId===n.scryfallId?{...c,quantity:c.quantity+1}:c);
      return[...prev,n];
    });
  },[activeZone]);

  const removeCard=useCallback((id,zone)=>{
    pushHistory();
    const z=zone||activeZone;
    const setter=z==="side"?setSideboard:z==="token"?setTokenList:setCards;
    setter(prev=>{const ex=prev.find(c=>c.scryfallId===id);if(!ex)return prev;if(ex.quantity<=1)return prev.filter(c=>c.scryfallId!==id);return prev.map(c=>c.scryfallId===id?{...c,quantity:c.quantity-1}:c);});
    if(selectedCard?.scryfallId===id)setSelectedCard(null);
  },[activeZone,selectedCard]);

  const moveCardBetweenZones=(card,fromZone,toZone)=>{
    if(fromZone===toZone)return;
    pushHistory();
    // Remove from source
    if(fromZone==="cmdr"){setCommanders(prev=>prev.filter(c=>c.scryfallId!==card.scryfallId));}
    else{const s=fromZone==="side"?setSideboard:fromZone==="token"?setTokenList:setCards;s(prev=>{const ex=prev.find(c=>c.scryfallId===card.scryfallId);if(!ex)return prev;if(ex.quantity<=1)return prev.filter(c=>c.scryfallId!==card.scryfallId);return prev.map(c=>c.scryfallId===card.scryfallId?{...c,quantity:c.quantity-1}:c);});}
    // Add to destination
    if(toZone==="cmdr"){setAsCmdr(card);}
    else{const d=toZone==="side"?setSideboard:toZone==="token"?setTokenList:setCards;d(prev=>{const ex=prev.find(c=>c.scryfallId===card.scryfallId);if(ex)return prev.map(c=>c.scryfallId===card.scryfallId?{...c,quantity:c.quantity+1}:c);return[...prev,{...card,quantity:1}];});}
  };

  const exportDeck=()=>{
    const lines=[];
    if(commanders.length){lines.push("// Commander");commanders.forEach(c=>lines.push(`1 ${c.name}`));lines.push("");}
    if(cards.length){lines.push("// Mainboard");cards.forEach(c=>lines.push(`${c.quantity} ${c.name}`));lines.push("");}
    if(sideboard.length){lines.push("// Sideboard");sideboard.forEach(c=>lines.push(`${c.quantity} ${c.name}`));lines.push("");}
    if(tokens.length){lines.push("// Tokens");tokens.forEach(c=>lines.push(`${c.quantity} ${c.name}`));}
    const blob=new Blob([lines.join("\n")],{type:"text/plain"});
    const a=document.createElement("a");a.href=URL.createObjectURL(blob);
    a.download=`${name||"deck"}.txt`;a.click();URL.revokeObjectURL(a.href);
  };

  const setAsCmdr=card=>{
    pushHistory();
    const entry=buildDeckEntry(card);
    setCommanders(prev=>prev.find(c=>c.scryfallId===entry.scryfallId)?prev:[...prev,entry]);
    setFormat("commander");
  };

  // Apply a specific printing's image to the selected card
  const applyPrinting=(printing)=>{
    if(!selectedCard) return;
    const img=printing.image_uris?.normal||printing.card_faces?.[0]?.image_uris?.normal||null;
    if(!img) return;
    if(activeZone==="cmdr"){
      setCommanders(prev=>prev.map(c=>c.scryfallId===selectedCard.scryfallId?{...c,imageUri:img}:c));
    }else{
      const setter=activeZone==="side"?setSideboard:activeZone==="token"?setTokenList:setCards;
      setter(prev=>prev.map(c=>c.scryfallId===selectedCard.scryfallId?{...c,imageUri:img}:c));
    }
    setSelectedCard(sc=>sc?{...sc,imageUri:img}:sc);
  };

  const handleBatchImport=(results)=>{
    if(results.main.length){
      setCards(prev=>{
        const map={};
        [...prev,...results.main].forEach(c=>{
          const k=c.scryfallId||c.name;
          if(map[k])map[k]={...map[k],quantity:map[k].quantity+c.quantity};
          else map[k]={...c};
        });
        return Object.values(map);
      });
    }
    if(results.side?.length){
      setSideboard(prev=>{
        const map={};
        [...prev,...results.side].forEach(c=>{
          const k=c.scryfallId||c.name;
          if(map[k])map[k]={...map[k],quantity:map[k].quantity+c.quantity};
          else map[k]={...c};
        });
        return Object.values(map);
      });
    }
    if(results.tokens?.length) setTokenList(prev=>[...prev,...results.tokens]);
    setShowBatch(false);
  };

  const currentList=activeZone==="side"?sideboard:activeZone==="token"?tokens:cards;
  const mainTotal=cards.reduce((s,c)=>s+c.quantity,0);
  const sideTotal=sideboard.reduce((s,c)=>s+c.quantity,0);
  const tokenTotal=tokens.reduce((s,c)=>s+c.quantity,0);

  const typeOrder=["Creatures","Planeswalkers","Instants","Sorceries","Enchantments","Artifacts","Lands","Other"];
  const groups={};
  currentList.forEach(c=>{
    const t=c.typeLine?.includes("Planeswalker")?"Planeswalkers":c.typeLine?.includes("Creature")?"Creatures":c.typeLine?.includes("Instant")?"Instants":c.typeLine?.includes("Sorcery")?"Sorceries":c.typeLine?.includes("Enchantment")?"Enchantments":c.typeLine?.includes("Artifact")?"Artifacts":c.typeLine?.includes("Land")?"Lands":"Other";
    (groups[t]=groups[t]||[]).push(c);
  });
  const typeColors={Creatures:"#60a5fa",Planeswalkers:"#c084fc",Instants:"#f97316",Sorceries:"#fb7185",Enchantments:"#34d399",Artifacts:"#94a3b8",Lands:"#4ade80",Other:"#a3a3a3"};

  const zoneTabStyle=(z)=>({
    ...btn(
      activeZone===z?`${T.accent}1f`:"transparent",
      activeZone===z?T.accent:"#4a6a8a",
      {fontSize:10,border:`1px solid ${activeZone===z?"rgba(200,168,112,.3)":"#1e3a5f20"}`,
       padding:"5px 12px",borderRadius:5,transition:"all .15s"}
    )
  });

  return(
    <div className="mtg-root mtg-deckbuilder" style={{display:"flex",height:"100vh",background:T.bg,fontFamily:"Crimson Text, serif",overflow:"hidden"}}>
      {/* ── Left: Search ── */}
      <div style={{width:"40%",display:"flex",flexDirection:"column",borderRight:"1px solid #0d1f3c30"}}>
        <div style={{padding:"14px 14px 10px",background:`linear-gradient(180deg,${T.panel},${T.bg})`,borderBottom:"1px solid #0d1f3c20",flexShrink:0}}>
          <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:10,flexWrap:"wrap"}}>
            <button onClick={onBack} style={{...btn(`${T.panel}99`,"#8a99b0",{border:`1px solid ${T.border}`})}} onMouseOver={hov} onMouseOut={uhov}>← Back</button>
            <span style={{color:T.accent,fontFamily:"Cinzel, serif",fontSize:13,letterSpacing:".05em"}}>🔮 Card Search</span>
            <div style={{flex:1}}/>
            <button onClick={()=>setShowBatch(true)}
              style={{...btn(`${T.accent}1a`,T.accent,{fontSize:10,border:`1px solid ${T.accent}50`,padding:"5px 10px"})}}
              onMouseOver={hov} onMouseOut={uhov}>📋 Batch Import</button>
            <button onClick={()=>setShowCustom(true)}
              style={{...btn("rgba(52,211,153,.06)","#34d399",{fontSize:10,border:"1px solid rgba(52,211,153,.15)",padding:"5px 10px"})}}
              onMouseOver={hov} onMouseOut={uhov}>🪄 Custom</button>
          </div>
          <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search by name, type, oracle text…" style={iS}
            onFocus={e=>{e.target.style.borderColor=T.accent;e.target.style.boxShadow="0 0 12px rgba(200,168,112,.15)";}}
            onBlur={e=>{e.target.style.borderColor=T.border;e.target.style.boxShadow="none";}}/>
          <div style={{display:"flex",gap:4,marginTop:8,alignItems:"center"}}>
            <span style={{fontSize:8,color:"#4a6a8a",fontFamily:"Cinzel, serif",letterSpacing:".1em",marginRight:2}}>ADD TO:</span>
            <button onClick={()=>setActiveZone("main")} style={zoneTabStyle("main")} onMouseOver={hov} onMouseOut={uhov}>Main</button>
            <button onClick={()=>setActiveZone("side")} style={zoneTabStyle("side")} onMouseOver={hov} onMouseOut={uhov}>Sideboard</button>
            <button onClick={()=>setActiveZone("token")} style={zoneTabStyle("token")} onMouseOver={hov} onMouseOut={uhov}>Tokens</button>
            <button onClick={()=>setActiveZone("cmdr")} style={zoneTabStyle("cmdr")} onMouseOver={hov} onMouseOut={uhov}>⚔ Cmdr</button>
          </div>
          {loading&&<div style={{fontSize:9,color:"#4a6a8a",marginTop:5,fontFamily:"Cinzel, serif",letterSpacing:".08em"}}>🔮 Searching Scryfall…</div>}
          {error&&<div style={{fontSize:9,color:"#f87171",marginTop:5}}>{error}</div>}
        </div>
        <div style={{flex:1,overflowY:"auto",padding:"4px 6px"}}>
          {results.length===0&&!loading&&query.length>1&&(
            <div style={{padding:"20px",textAlign:"center",color:"#2a3a5a",fontFamily:"Cinzel, serif",fontSize:11,fontStyle:"italic"}}>No results — try another search</div>
          )}
          {results.map(card=>(
            <SearchCardRow key={card.id||card.scryfallId} card={card}
              count={cards.find(c=>c.scryfallId===(card.id||card.scryfallId))?.quantity||0}
              onAdd={()=>addCard(card)} onHover={setHovered} onSetCommander={setAsCmdr}/>
          ))}
        </div>
      </div>

      {/* ── Right: Deck List ── */}
      <div style={{width:"60%",display:"flex",flexDirection:"column"}}>
        <div style={{padding:"12px 14px 10px",background:`linear-gradient(180deg,${T.panel},${T.bg})`,borderBottom:"1px solid #0d1f3c20",flexShrink:0}}>
          <div style={{display:"flex",gap:6,alignItems:"center",marginBottom:8}}>
            <input value={name} onChange={e=>setName(e.target.value)}
              style={{...iS,flex:1,fontSize:14,fontFamily:"Cinzel, serif",color:T.accent,marginTop:0}}
              onFocus={e=>{e.target.style.borderColor=T.accent;}}
              onBlur={e=>{e.target.style.borderColor=T.border;}}/>
            <button onClick={()=>onSave({id:deck?.id||uid(),name,cards,sideboard,tokens,commanders,commander:commanders[0]||null,format,sleeveUri:sleeveUri.trim()||undefined,playmatUri:playmatUri.trim()||undefined})}
              style={{...btn("linear-gradient(135deg,#c8a870,#8a6040)",T.bg,{fontFamily:"Cinzel, serif",fontWeight:700,padding:"6px 14px"})}}
              onMouseOver={hov} onMouseOut={uhov}>✦ Save</button>
            <button onClick={exportDeck}
              style={{...btn(`${T.panel}cc`,"#8a99b0",{fontFamily:"Cinzel, serif",padding:"6px 14px",border:`1px solid ${T.border}30`})}}
              onMouseOver={hov} onMouseOut={uhov}>⬇ Export .txt</button>
            <button onClick={undo} disabled={!historyRef.current.length}
              style={{...btn("transparent",historyRef.current.length?"#8a99b0":"#2a3a5a",{padding:"6px 10px",border:`1px solid ${T.border}30`,opacity:historyRef.current.length?1:0.4})}}
              onMouseOver={hov} onMouseOut={uhov} title="Undo">↩</button>
            <button onClick={redo} disabled={!futureRef.current.length}
              style={{...btn("transparent",futureRef.current.length?"#8a99b0":"#2a3a5a",{padding:"6px 10px",border:`1px solid ${T.border}30`,opacity:futureRef.current.length?1:0.4})}}
              onMouseOver={hov} onMouseOut={uhov} title="Redo">↪</button>
          </div>
          <div style={{display:"flex",gap:3,marginBottom:8}}>
            {["standard","commander","modern","legacy","pioneer","pauper"].map(f=>(
              <button key={f} onClick={()=>setFormat(f)}
                style={{...btn(f===format?`${T.accent}1a`:"transparent",f===format?T.accent:"#4a6a8a",{fontSize:9,border:`1px solid ${f===format?"rgba(200,168,112,.3)":"#1e3a5f20"}`,padding:"3px 7px"})}}
                onMouseOver={hov} onMouseOut={uhov}>{f}</button>
            ))}
          </div>
          <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:6}}>
            {sleeveUri&&<img src={sleeveUri} alt="sleeve" style={{width:18,height:25,borderRadius:2,objectFit:"cover",border:`1px solid ${T.border}`}} onError={e=>e.target.style.display="none"}/>}
            <input value={sleeveUri} onChange={e=>setSleeveUri(e.target.value)}
              placeholder="🎴 Sleeve image URL (optional)…"
              style={{...iS,flex:1,fontSize:10,marginTop:0}}
              onFocus={e=>e.target.style.borderColor=T.accent} onBlur={e=>e.target.style.borderColor=T.border}/>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:6}}>
            {playmatUri&&<div style={{width:30,height:20,borderRadius:2,objectFit:"cover",border:`1px solid ${T.border}`,backgroundImage:`url(${playmatUri})`,backgroundSize:"cover",backgroundPosition:"center"}}/>}
            <input value={playmatUri} onChange={e=>setPlaymatUri(e.target.value)}
              placeholder="🖼 Playmat image URL for this deck (optional)…"
              style={{...iS,flex:1,fontSize:10,marginTop:0}}
              onFocus={e=>e.target.style.borderColor=T.accent} onBlur={e=>e.target.style.borderColor=T.border}/>
          </div>
          <div style={{display:"flex",gap:4}}>
            {[
              ["main","🃏 Main",mainTotal],
              ["side","⚔ Sideboard",sideTotal],
              ["token","✦ Tokens",tokenTotal],
              ["cmdr","⚔ Commander",commanders.length],
            ].map(([z,label,count])=>(
              <button key={z} onClick={()=>setActiveZone(z)}
                onDragOver={e=>{e.preventDefault();e.currentTarget.style.background=`${T.accent}30`;}}
                onDragLeave={e=>{e.currentTarget.style.background="";}}
                onDrop={e=>{e.currentTarget.style.background="";if(deckDragCard&&deckDragCard.fromZone!==z){moveCardBetweenZones(deckDragCard.card,deckDragCard.fromZone,z);setDeckDragCard(null);}}}
                style={{
                ...btn(activeZone===z?`${T.accent}1a`:"transparent",activeZone===z?T.accent:"#4a6a8a",
                  {fontSize:10,border:`1px solid ${activeZone===z?"rgba(200,168,112,.3)":"#1e3a5f20"}`,padding:"4px 10px",flex:1}),
              }} onMouseOver={hov} onMouseOut={uhov}>
                {label} <span style={{marginLeft:4,background:activeZone===z?`${T.accent}26`:"rgba(255,255,255,.05)",
                  padding:"0 5px",borderRadius:8,fontSize:9}}>{count}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Split view: deck list + card preview panel */}
        <div style={{flex:1,display:"flex",overflow:"hidden"}}>
          {/* Card list */}
          <div style={{flex:1,overflowY:"auto",padding:"6px 8px"}}>
            {activeZone==="cmdr"?(
              <div style={{padding:"18px 12px"}}>
                <div style={{fontSize:9,color:T.accent,fontFamily:"Cinzel, serif",letterSpacing:".14em",marginBottom:10,textAlign:"center"}}>⚔ COMMAND ZONE · Starts the game here</div>
                {commanders.length>0?(
                  <div style={{display:"flex",flexDirection:"column",gap:8}}>
                    {commanders.map((cmdr,ci)=>{
                      const isSel=selectedCard?.scryfallId===cmdr.scryfallId;
                      return(
                      <div key={cmdr.scryfallId||ci}
                        draggable
                        onDragStart={e=>{e.dataTransfer.effectAllowed="move";setDeckDragCard({card:cmdr,fromZone:"cmdr"});}}
                        onClick={()=>setSelectedCard(prev=>prev?.scryfallId===cmdr.scryfallId?null:cmdr)}
                        style={{display:"flex",gap:10,alignItems:"flex-start",background:isSel?`${T.accent}20`:`${T.accent}0d`,borderRadius:8,border:`1px solid ${isSel?T.accent:T.accent+"40"}`,padding:"8px 10px",cursor:"grab",transition:"background .1s"}}>
                        {cmdr.imageUri&&<img src={cmdr.imageUri} alt="" style={{width:48,height:67,borderRadius:3,objectFit:"cover",boxShadow:`0 0 10px ${T.accent}40`}}/>}
                        <div style={{flex:1}}>
                          <div style={{fontSize:7,color:T.accent,fontFamily:"Cinzel,serif",letterSpacing:".14em",marginBottom:2}}>⚔ COMMANDER {commanders.length>1?`#${ci+1}`:""}</div>
                          <div style={{fontSize:12,color:T.text,fontFamily:"Cinzel,serif",marginBottom:3}}>{cmdr.name}</div>
                          {cmdr.manaCost&&<div style={{fontSize:9,color:"#a3a3a3",marginBottom:2}}>{cmdr.manaCost}</div>}
                          {cmdr.typeLine&&<div style={{fontSize:8,color:"#6a7a8a",fontStyle:"italic",marginBottom:3}}>{cmdr.typeLine}</div>}
                          <div style={{fontSize:8,color:isSel?"#60a5fa":"#34d399",fontFamily:"Cinzel,serif"}}>{isSel?"🎨 Select a printing →":"✓ Starts in command zone"}</div>
                        </div>
                        <button onClick={e=>{e.stopPropagation();setCommanders(prev=>prev.filter((_,i)=>i!==ci));}} style={{...btn("transparent","#f87171",{fontSize:13,border:"none",padding:"2px 5px"})}} onMouseOver={hov} onMouseOut={uhov}>✕</button>
                      </div>
                      );
                    })}
                  </div>
                ):(
                  <div style={{textAlign:"center",color:T.border,marginTop:30,fontFamily:"Cinzel, serif",fontSize:11,fontStyle:"italic",lineHeight:1.8}}>
                    <div style={{fontSize:22,marginBottom:8}}>⚔</div>
                    No commander set<br/>
                    <span style={{fontSize:9,color:"#2a3a5a"}}>Search a card and click ⚔ to set as commander,<br/>or switch ADD TO: Cmdr and click +</span>
                  </div>
                )}
              </div>
            ):(
              <>
              {currentList.length===0&&(
                <div style={{textAlign:"center",color:T.border,marginTop:50,fontFamily:"Cinzel, serif",fontSize:11,fontStyle:"italic"}}>
                  {activeZone==="main"?"✦ Search cards or use Batch Import ✦":
                   activeZone==="side"?"⚔ Add sideboard cards above":
                   "✦ Add tokens above"}
                </div>
              )}
              {typeOrder.filter(t=>groups[t]).map(type=>(
                <div key={type} style={{marginBottom:10}}>
                  <div style={{fontSize:9,color:typeColors[type],padding:"3px 6px",fontFamily:"Cinzel, serif",
                    letterSpacing:".12em",borderBottom:`1px solid ${typeColors[type]}20`,marginBottom:3,
                    display:"flex",alignItems:"center",gap:6}}>
                    <span>{type}</span>
                    <span style={{background:`${typeColors[type]}15`,padding:"0 5px",borderRadius:8,fontSize:8}}>
                      {groups[type].reduce((s,c)=>s+c.quantity,0)}
                    </span>
                  </div>
                  {groups[type].sort((a,b)=>a.name.localeCompare(b.name)).map(card=>(
                    <DeckCardRow key={card.scryfallId} card={card}
                      isSelected={selectedCard?.scryfallId===card.scryfallId}
                      onSelect={c=>{setSelectedCard(prev=>prev?.scryfallId===c.scryfallId?null:c);}}
                      onHover={c=>setHovered({...c,imageUri:c.imageUri,typeLine:c.typeLine})}
                      onAdd={()=>addCard({id:card.scryfallId,...card,image_uris:{normal:card.imageUri}})}
                      onRemove={()=>removeCard(card.scryfallId)}
                      fromZone={activeZone}
                      onDragStart={(card,zone)=>setDeckDragCard({card,fromZone:zone})}
                      onCtxMenu={(e,card,zone)=>setDeckCtx({x:e.clientX,y:e.clientY,card,fromZone:zone})}/>
                  ))}
                </div>
              ))}
              </>
            )}
          </div>

          {/* Card Preview + Print Picker Panel */}
          {selectedCard&&(
            <div style={{width:200,flexShrink:0,borderLeft:`1px solid ${T.border}20`,display:"flex",flexDirection:"column",background:`linear-gradient(180deg,${T.panel},${T.bg})`}}>
              {/* Preview */}
              <div style={{padding:10,textAlign:"center",flexShrink:0}}>
                {selectedCard.imageUri?(
                  <img src={selectedCard.imageUri} alt={selectedCard.name}
                    style={{width:140,height:196,borderRadius:7,objectFit:"cover",border:`1px solid ${T.accent}40`,
                      boxShadow:`0 0 20px ${T.accent}20`}}/>
                ):(
                  <div style={{width:140,height:196,background:T.panel,borderRadius:7,border:`1px solid ${T.border}`,
                    display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,color:T.accent,fontFamily:"Cinzel,serif",margin:"0 auto"}}>
                    No Image
                  </div>
                )}
                <div style={{fontSize:10,color:T.accent,fontFamily:"Cinzel,serif",marginTop:6,fontWeight:600}}>{selectedCard.name}</div>
                <div style={{fontSize:8,color:"#6a7a8a",fontFamily:"Cinzel,serif",marginTop:2}}>{selectedCard.typeLine}</div>
                {selectedCard.manaCost&&<div style={{marginTop:4,display:"flex",justifyContent:"center"}}><ManaCost cost={selectedCard.manaCost}/></div>}
              </div>
              {/* Printings */}
              <div style={{flexShrink:0,padding:"4px 8px",borderTop:`1px solid ${T.border}20`}}>
                <div style={{fontSize:8,color:T.accent,fontFamily:"Cinzel,serif",letterSpacing:".1em",marginBottom:5}}>🎨 ALL PRINTINGS</div>
                {loadingPrints&&<div style={{fontSize:8,color:"#4a6a8a",fontFamily:"Cinzel,serif",textAlign:"center",padding:4}}>Loading…</div>}
              </div>
              <div style={{flex:1,overflowY:"auto",padding:"0 8px 8px",display:"flex",flexWrap:"wrap",gap:4}}>
                {printings.map((p,i)=>{
                  const img=p.image_uris?.normal||p.card_faces?.[0]?.image_uris?.normal||null;
                  const isCurrent=selectedCard.imageUri===img;
                  return img?(
                    <div key={p.id||i}
                      onClick={()=>applyPrinting(p)}
                      title={`${p.set_name||p.set?.toUpperCase()} (${p.set?.toUpperCase()}) · Click to use this art`}
                      style={{cursor:"pointer",borderRadius:4,overflow:"hidden",
                        border:`2px solid ${isCurrent?T.accent:"transparent"}`,
                        boxShadow:isCurrent?`0 0 8px ${T.accent}60`:"0 2px 5px rgba(0,0,0,.5)",
                        transition:"border-color .15s,transform .1s"}}
                      onMouseOver={e=>{e.currentTarget.style.transform="scale(1.06)";}}
                      onMouseOut={e=>{e.currentTarget.style.transform="none";}}>
                      <img src={img} alt={p.set} style={{width:56,height:78,objectFit:"cover",display:"block"}}/>
                      <div style={{fontSize:6,color:isCurrent?T.accent:"#4a6a8a",textAlign:"center",
                        padding:"1px 2px",background:"rgba(5,10,18,.8)",overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis"}}>
                        {p.set?.toUpperCase()}
                      </div>
                    </div>
                  ):null;
                })}
                {!loadingPrints&&printings.length===0&&<div style={{fontSize:8,color:T.border,fontStyle:"italic",padding:4}}>No alternate printings found</div>}
              </div>
              {/* Custom art URL input */}
              <div style={{padding:"6px 8px",borderTop:`1px solid ${T.border}20`,flexShrink:0}}>
                <div style={{fontSize:7,color:"#6a7a8a",fontFamily:"Cinzel,serif",letterSpacing:".08em",marginBottom:4}}>🔗 CUSTOM ART URL</div>
                <div style={{display:"flex",gap:4}}>
                  <input id="customArtInput"
                    placeholder="Paste image URL… (Enter to apply)"
                    style={{flex:1,background:T.bg,border:`1px solid ${T.border}30`,borderRadius:4,padding:"3px 6px",fontSize:9,color:T.text,outline:"none"}}
                    onKeyDown={e=>{
                      if(e.key!=="Enter")return;
                      const img=e.target.value.trim();if(!img||!selectedCard)return;
                      if(activeZone==="cmdr"){setCommanders(prev=>prev.map(c=>c.scryfallId===selectedCard.scryfallId?{...c,imageUri:img}:c));}
                      else{const setter=activeZone==="side"?setSideboard:activeZone==="token"?setTokenList:setCards;setter(prev=>prev.map(c=>c.scryfallId===selectedCard.scryfallId?{...c,imageUri:img}:c));}
                      setSelectedCard(sc=>sc?{...sc,imageUri:img}:sc);e.target.value="";
                    }}/>
                  <button onClick={()=>{
                    const inp=document.getElementById("customArtInput");
                    const img=inp?.value.trim();if(!img||!selectedCard)return;
                    if(activeZone==="cmdr"){setCommanders(prev=>prev.map(c=>c.scryfallId===selectedCard.scryfallId?{...c,imageUri:img}:c));}
                    else{const setter=activeZone==="side"?setSideboard:activeZone==="token"?setTokenList:setCards;setter(prev=>prev.map(c=>c.scryfallId===selectedCard.scryfallId?{...c,imageUri:img}:c));}
                    setSelectedCard(sc=>sc?{...sc,imageUri:img}:sc);if(inp)inp.value="";
                  }} style={{...btn(`${T.accent}18`,T.accent,{fontSize:9,border:`1px solid ${T.accent}40`,padding:"3px 8px",flexShrink:0})}} onMouseOver={hov} onMouseOut={uhov}>Apply</button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {hovered&&<CardPreview card={{...hovered,imageUri:getImg(hovered)||hovered.imageUri,typeLine:hovered.type_line||hovered.typeLine}}/>}
      {deckCtx&&(
        <ContextMenu x={deckCtx.x} y={deckCtx.y} onClose={()=>setDeckCtx(null)} items={[
          {header:`${deckCtx.card.name}`},
          ...[["main","🃏 Main"],["side","⚔ Sideboard"],["cmdr","⚔ Commander"],["token","✦ Token"]].filter(([z])=>z!==deckCtx.fromZone).map(([z,label])=>({
            icon:"→",label:`Move to ${label}`,action:()=>{moveCardBetweenZones(deckCtx.card,deckCtx.fromZone,z);}
          })),
          "---",
          {icon:"−",label:"Remove one",color:"#f87171",action:()=>removeCard(deckCtx.card.scryfallId,deckCtx.fromZone)},
        ]}/>
      )}
      {showCustom&&<CustomCardCreator onSave={card=>{addCard(card);setShowCustom(false);}} onClose={()=>setShowCustom(false)}/>}
      {showBatch&&<BatchImporter onImport={handleBatchImport} onClose={()=>setShowBatch(false)}/>}
    </div>
  );
}

/* ─── Chaos deck builder ──────────────────────────────────────────── */
async function buildChaosDeck(){
  try{
    const cards=await claudeCards("Generate a chaotic 60-card MTG deck",`MTG deck generator. Return ONLY a JSON array of exactly 60 card objects representing a chaotic, fun, diverse deck. Include ~24 lands (5 colors), ~20 creatures, ~16 spells. Each: {"id":"scryfall_uuid","name":"...","mana_cost":"{X}","type_line":"...","oracle_text":"...","power":null,"toughness":null,"image_uris":{"normal":"https://cards.scryfall.io/normal/front/X/Y/UUID.jpg"},"colors":[]}. Use real card names and real Scryfall UUIDs. Each object = 1 card (basic lands can repeat).`);
    if(!cards?.length)throw new Error();
    return cards.map((c,i)=>({scryfallId:c.id||`chaos_${i}`,name:c.name,quantity:1,imageUri:getImg(c),manaCost:c.mana_cost||"",typeLine:c.type_line||"",oracleText:c.oracle_text||"",power:c.power,toughness:c.toughness,colors:c.colors||[]}));
  }catch{
    const basics=[["Plains","Basic Land — Plains"],["Island","Basic Land — Island"],["Swamp","Basic Land — Swamp"],["Mountain","Basic Land — Mountain"],["Forest","Basic Land — Forest"]];
    return Array.from({length:60},(_,i)=>{const[n,t]=basics[i%5];return{scryfallId:`basic_${i}`,name:n,quantity:1,imageUri:null,manaCost:"",typeLine:t,oracleText:"",power:null,toughness:null,colors:[]};});
  }
}



/* ─── Main Menu ───────────────────────────────────────────────────── */
/* ─── InkSwirlCanvas — animated ink/smoke behind deck cards ─────── */
function InkSwirlCanvas({color}){
  const ref=useRef(null);
  useEffect(()=>{
    const canvas=ref.current;if(!canvas)return;
    const ctx=canvas.getContext("2d");
    canvas.width=canvas.offsetWidth||210;
    canvas.height=canvas.offsetHeight||240;
    const W=canvas.width,H=canvas.height;

    // Reliably extract r,g,b from any CSS color (hex, named, var(), gradient fallback)
    let r=200,g=168,b=112;
    try{
      const tmp=document.createElement("canvas");
      tmp.width=tmp.height=1;
      const tc=tmp.getContext("2d");
      tc.fillStyle="#c8a870"; // safe default
      tc.fillStyle=color;     // overwrite if valid
      tc.fillRect(0,0,1,1);
      const px=tc.getImageData(0,0,1,1).data;
      if(px[3]>0){r=px[0];g=px[1];b=px[2];}
    }catch{}

    const blobs=Array.from({length:14},()=>({
      x:W*(.2+Math.random()*.6),
      y:H*(.3+Math.random()*.5),
      br:18+Math.random()*28,
      dx:(Math.random()-.5)*.25,
      dy:(Math.random()-.5)*.22,
      phase:Math.random()*Math.PI*2,
      speed:.003+Math.random()*.004,
      opacity:.04+Math.random()*.09,
    }));

    let raf,frame=0;
    const rgba=(a)=>`rgba(${r},${g},${b},${Math.max(0,Math.min(1,a)).toFixed(3)})`;
    const draw=()=>{
      ctx.clearRect(0,0,W,H);
      frame++;
      blobs.forEach(p=>{
        p.phase+=p.speed;
        const swX=Math.max(p.br,Math.min(W-p.br, p.x+Math.sin(p.phase*.7)*12+Math.cos(p.phase*.4)*8));
        const swY=Math.max(p.br,Math.min(H-p.br, p.y+Math.cos(p.phase*.5)*10+Math.sin(p.phase*.6)*6));
        try{
          const gr=ctx.createRadialGradient(swX,swY,0,swX,swY,p.br);
          gr.addColorStop(0,rgba(p.opacity));
          gr.addColorStop(.5,rgba(p.opacity*.5));
          gr.addColorStop(1,rgba(0));
          ctx.fillStyle=gr;
          ctx.beginPath();
          ctx.ellipse(swX,swY,p.br,p.br*.65,p.phase*.3,0,Math.PI*2);
          ctx.fill();
        }catch{}
        p.x+=p.dx;p.y+=p.dy;
        if(p.x<-p.br||p.x>W+p.br)p.dx*=-1;
        if(p.y<-p.br||p.y>H+p.br)p.dy*=-1;
      });
      if(frame%3===0){
        const wx=W*.2+Math.random()*W*.6;
        try{
          const wr=ctx.createRadialGradient(wx,H*.7,0,wx,H*.3,30);
          wr.addColorStop(0,rgba(.015+Math.random()*.018));
          wr.addColorStop(1,rgba(0));
          ctx.fillStyle=wr;
          ctx.beginPath();ctx.ellipse(wx,H*.5,14,40,0,0,Math.PI*2);
          ctx.fill();
        }catch{}
      }
      raf=requestAnimationFrame(draw);
    };
    draw();
    return()=>cancelAnimationFrame(raf);
  },[color]);

  return(
    <canvas ref={ref} style={{
      position:"absolute",inset:0,width:"100%",height:"100%",
      pointerEvents:"none",zIndex:0,borderRadius:10,
    }}/>
  );
}

function MainMenu({decks,onNew,onEdit,onPlay,onRooms,onDelete,onChaos,profile,onTheme,onSignOut}){
  const [buildingChaos,setBuildingChaos]=useState(false);
  const [deleteConfirm,setDeleteConfirm]=useState(null);
  const canvasRef=useRef(null);
  const [deckOrder,setDeckOrder]=useState(()=>decks.map((_,i)=>i));
  const [draggingIdx,setDraggingIdx]=useState(null);
  const [dragOverIdx,setDragOverIdx]=useState(null);
  const dragStartPos=useRef(null);

  // Keep deckOrder in sync if decks change externally
  useEffect(()=>setDeckOrder(decks.map((_,i)=>i)),[decks.length]);

  const sortedDecks=deckOrder.map(i=>decks[i]).filter(Boolean);

  const onDragStart=(e,sortedI)=>{
    setDraggingIdx(sortedI);
    dragStartPos.current={x:e.clientX,y:e.clientY};
    e.dataTransfer.effectAllowed="move";
    e.dataTransfer.setDragImage(e.currentTarget,60,80);
  };
  const onDragOver=(e,sortedI)=>{
    e.preventDefault();
    if(sortedI===draggingIdx)return;
    setDragOverIdx(sortedI);
  };
  const onDrop=(e,sortedI)=>{
    e.preventDefault();
    if(draggingIdx===null||draggingIdx===sortedI){setDraggingIdx(null);setDragOverIdx(null);return;}
    setDeckOrder(prev=>{
      const next=[...prev];
      const [moved]=next.splice(draggingIdx,1);
      next.splice(sortedI,0,moved);
      return next;
    });
    setDraggingIdx(null);setDragOverIdx(null);
  };
  const onDragEnd=()=>{setDraggingIdx(null);setDragOverIdx(null);};

  const handleChaos=async()=>{setBuildingChaos(true);const cards=await buildChaosDeck();setBuildingChaos(false);onChaos(cards);};

  const thumbImg=deck=>{
    if(deck.commander?.imageUri)return deck.commander.imageUri;
    return deck.cards?.find(c=>c.imageUri)?.imageUri||null;
  };

  // Floating rune particles background
  useEffect(()=>{
    const canvas=canvasRef.current;if(!canvas)return;
    const ctx=canvas.getContext("2d");
    let w=canvas.width=canvas.offsetWidth,h=canvas.height=canvas.offsetHeight;
    const runes="ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜ✦✧⚔⚡✴◈⬡◆◇⬢✵⋆";
    const particles=Array.from({length:30},()=>({
      x:Math.random()*w,y:Math.random()*h,vy:-.2-Math.random()*.3,
      r:Math.random()*15+8,op:Math.random()*.15+.04,
      char:runes[Math.floor(Math.random()*runes.length)],
      drift:(Math.random()-.5)*.15,
    }));
    let raf;
    const draw=()=>{
      ctx.clearRect(0,0,w,h);
      particles.forEach(p=>{
        ctx.globalAlpha=p.op;ctx.fillStyle=T.accent;
        ctx.font=`${p.r}px serif`;
        ctx.fillText(p.char,p.x,p.y);
        p.y+=p.vy;p.x+=p.drift;
        if(p.y<-20)p.y=h+20;
        if(p.x<-20)p.x=w+20;if(p.x>w+20)p.x=-20;
      });
      raf=requestAnimationFrame(draw);
    };
    draw();
    const onResize=()=>{w=canvas.width=canvas.offsetWidth;h=canvas.height=canvas.offsetHeight;};
    window.addEventListener("resize",onResize);
    return()=>{cancelAnimationFrame(raf);window.removeEventListener("resize",onResize);};
  },[]);


  // ── Scry N cards ──
  return(
    <div className="mtg-root mtg-menu-root" style={{height:"100vh",background:T.bg,display:"flex",flexDirection:"column",fontFamily:"Crimson Text, serif",overflow:"hidden",position:"relative"}}>
      <canvas ref={canvasRef} style={{position:"absolute",inset:0,width:"100%",height:"100%",pointerEvents:"none"}}/>
      {/* Atmospheric gradient overlays */}
      <div style={{position:"absolute",inset:0,
        background:"radial-gradient(ellipse at 15% 50%,rgba(200,168,112,.03) 0%,transparent 50%),radial-gradient(ellipse at 85% 20%,rgba(96,165,250,.025) 0%,transparent 40%),radial-gradient(ellipse at 50% 100%,rgba(168,85,247,.03) 0%,transparent 50%)",
        pointerEvents:"none"}}/>

      {/* Header */}
      <div style={{display:"flex",alignItems:"center",gap:12,padding:"14px 22px",
        borderBottom:"1px solid rgba(200,168,112,.1)",flexShrink:0,
        background:`linear-gradient(180deg,${T.panel}f2,${T.bg}cc)`,
        backdropFilter:"blur(10px)",position:"relative",zIndex:10}} className="mtg-header mtg-menu-header">
        <div style={{position:"absolute",bottom:0,left:0,right:0,height:1,
          background:"linear-gradient(90deg,transparent,rgba(200,168,112,.3),transparent)"}}/>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{fontSize:26,filter:"drop-shadow(0 0 16px rgba(200,168,112,.5))",animation:"floatSoft 3s ease-in-out infinite"}}>⚔</div>
          <div>
            <div className="shimmer-text" style={{fontFamily:"Cinzel Decorative, serif",fontSize:20,letterSpacing:".08em"}}>MTG Playground</div>
            <div style={{fontSize:8,color:"#3a5a7a",letterSpacing:".2em",fontFamily:"Cinzel, serif"}}>THE ETERNAL ARENA · v4</div>
          </div>
        </div>
        <div style={{flex:1}}/>
        {profile&&(
          <div style={{display:"flex",alignItems:"center",gap:8,
            background:`${T.bg}99`,borderRadius:8,padding:"5px 12px",
            border:"1px solid rgba(200,168,112,.1)"}}>
            {profile.avatarImg?(
              <img src={profile.avatarImg} alt="" style={{width:32,height:32,borderRadius:"50%",objectFit:"cover",border:`1px solid ${T.accent}60`,boxShadow:`0 0 8px ${T.accent}40`}}/>
            ):(
              <span style={{fontSize:20,filter:"drop-shadow(0 0 6px rgba(200,168,112,.3))"}}>{profile.avatar}</span>
            )}
            <div>
              <div style={{fontSize:11,color:T.accent,fontFamily:"Cinzel, serif"}}>{profile.alias}</div>
              <div style={{fontSize:8,color:"#3a5a7a",letterSpacing:".1em"}}>PLANESWALKER</div>
            </div>
          </div>
        )}
        <button onClick={onRooms}
          style={{...btn("rgba(167,139,250,.08)","#a78bfa",{fontFamily:"Cinzel, serif",padding:"8px 16px",border:"1px solid rgba(167,139,250,.2)"}),fontSize:11}}
          onMouseOver={hov} onMouseOut={uhov}>⇄ Multiplayer</button>
        <button onClick={onTheme}
          style={{...btn("rgba(168,85,247,.08)","#a78bfa",{fontFamily:"Cinzel, serif",padding:"8px 14px",border:"1px solid rgba(168,85,247,.2)"}),fontSize:11}}
          onMouseOver={hov} onMouseOut={uhov}>🎨 Theme</button>
        {onSignOut && <button onClick={onSignOut} title="Sign Out"
          style={{...btn("rgba(80,90,110,.15)","#8a99b0",{fontFamily:"Cinzel, serif",padding:"8px 12px",border:"1px solid rgba(80,90,110,.25)"}),fontSize:11}}
          onMouseOver={hov} onMouseOut={uhov}>⎋ Sign Out</button>}
        <button onClick={handleChaos} disabled={buildingChaos}
          style={{...btn("rgba(192,132,252,.08)","#c084fc",{padding:"8px 16px",fontFamily:"Cinzel, serif",border:"1px solid rgba(192,132,252,.2)",opacity:buildingChaos?.7:1}),fontSize:11}}
          onMouseOver={hov} onMouseOut={uhov}>{buildingChaos?"🔮 Brewing…":"🎲 Chaos Deck"}</button>
        <button onClick={onNew}
          style={{...btn("linear-gradient(135deg,#c8a870,#8a6040)",T.bg,{padding:"8px 20px",fontSize:12,fontFamily:"Cinzel, serif",fontWeight:700,boxShadow:"0 6px 20px rgba(200,168,112,.3)",border:`1px solid ${T.accent}60`})}
          } onMouseOver={e=>{e.currentTarget.style.boxShadow="0 10px 30px rgba(200,168,112,.45)";e.currentTarget.style.filter="brightness(1.1)";}}
          onMouseOut={e=>{e.currentTarget.style.boxShadow="0 6px 20px rgba(200,168,112,.3)";e.currentTarget.style.filter="none";}}>
          ✦ New Deck
        </button>
      </div>

      {/* Gallery */}
      <div style={{flex:1,overflowY:"auto",padding:"24px",position:"relative",zIndex:1}}>
        {decks.length===0&&(
          <div className="fade-in" style={{display:"flex",flexDirection:"column",alignItems:"center",
            justifyContent:"center",height:"60vh",gap:16,color:T.border}}>
            <div style={{fontSize:56,filter:"drop-shadow(0 0 20px rgba(200,168,112,.2))",animation:"floatSoft 3s ease-in-out infinite"}}>⚔</div>
            <div style={{fontSize:18,fontFamily:"Cinzel Decorative, serif",color:"#2a4a6a"}}>No decks yet</div>
            <div style={{fontSize:12,color:"#1a2a3a",fontStyle:"italic"}}>Forge your first deck above to begin</div>
          </div>
        )}
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(210px,1fr))",gap:18}}>
          {sortedDecks.map((deck,i)=>{
            const thumb=thumbImg(deck);
            const total=deck.cards?.reduce((s,c)=>s+c.quantity,0)||0;
            const accent=deck.format==="commander"?T.accent:deck.format==="modern"?"#60a5fa":deck.format==="legacy"?"#a78bfa":"#4ade80";
            return(
              <div key={deck.id} className="slide-in"
                draggable
                onDragStart={e=>onDragStart(e,i)}
                onDragOver={e=>onDragOver(e,i)}
                onDrop={e=>onDrop(e,i)}
                onDragEnd={onDragEnd}
                style={{
                  position:"relative",height:240,
                  border:`1px solid ${dragOverIdx===i?accent+"80":"rgba(200,168,112,.08)"}`,
                  borderRadius:10,overflow:"hidden",
                  animationDelay:`${i*.05}s`,
                  transition:"border-color .18s,transform .18s,box-shadow .18s",cursor:"grab",
                  boxShadow:dragOverIdx===i?`0 0 0 2px ${accent}50,0 12px 32px rgba(0,0,0,.7)`:"0 4px 16px rgba(0,0,0,.6)",
                  opacity:draggingIdx===i?.45:1,
                  transform:draggingIdx===i?"scale(.97)":dragOverIdx===i?"scale(1.02)":"none"}}
                onMouseOver={e=>{if(draggingIdx===null){e.currentTarget.style.borderColor=`${accent}40`;e.currentTarget.style.boxShadow=`0 12px 32px rgba(0,0,0,.7),0 0 20px ${accent}10`;}}}
                onMouseOut={e=>{if(draggingIdx===null){e.currentTarget.style.borderColor=`${T.accent}14`;e.currentTarget.style.boxShadow="0 4px 16px rgba(0,0,0,.6)";}}} >

                {/* Ink swirl canvas — sits behind art */}
                <InkSwirlCanvas color={accent} key={deck.id}/>

                {/* Full-bleed art */}
                {thumb?(
                  <img src={thumb} alt="" style={{
                    position:"absolute",inset:0,width:"100%",height:"100%",
                    objectFit:"cover",objectPosition:"top center",
                    transition:"transform .4s"}}
                    onMouseOver={e=>e.target.style.transform="scale(1.04)"}
                    onMouseOut={e=>e.target.style.transform="scale(1)"}/>
                ):(
                  <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",
                    justifyContent:"center",fontSize:48,
                    background:"linear-gradient(135deg,#0a1628,#0d1f3c)"}}>⚔</div>
                )}

                {/* Gradient only right above the buttons — no dead zone */}
                <div style={{position:"absolute",left:0,right:0,bottom:0,
                  height:"55%",
                  background:"linear-gradient(transparent,rgba(4,8,18,.82) 42%,rgba(4,8,18,.97) 72%,rgba(4,8,18,1))",
                  pointerEvents:"none"}}/>

                {/* Format badge */}
                {deck.format&&(
                  <div style={{position:"absolute",top:8,right:8,
                    background:"rgba(5,10,18,.85)",fontSize:8,color:accent,
                    fontFamily:"Cinzel, serif",padding:"2px 7px",borderRadius:4,
                    letterSpacing:".1em",border:`1px solid ${accent}30`,
                    backdropFilter:"blur(4px)"}}>{deck.format.toUpperCase()}</div>
                )}

                {/* Text + buttons pinned to bottom */}
                <div style={{position:"absolute",left:0,right:0,bottom:0,padding:"10px 13px"}}>
                  <div style={{fontFamily:"Cinzel, serif",color:T.accent,fontSize:13,marginBottom:2,
                    overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",
                    textShadow:"0 1px 6px rgba(0,0,0,.9)"}}>
                    {deck.commanders?.length||deck.commander?"⚔ ":""}{deck.name}
                  </div>
                  <div style={{fontSize:9,color:"#6a8aaa",marginBottom:8,fontFamily:"Cinzel, serif",
                    textShadow:"0 1px 4px rgba(0,0,0,.9)"}}>
                    {total} cards{deck.commander?` · Cmdr: ${deck.commander.name}`:""}
                  </div>
                  <div style={{display:"flex",gap:5}}>
                    <button onClick={()=>onEdit(deck)}
                      style={{...btn("rgba(10,20,40,.75)","#8a99b0",{flex:1,fontSize:10,padding:"5px 7px",border:"1px solid rgba(100,130,180,.3)",backdropFilter:"blur(6px)"})}}
                      onMouseOver={hov} onMouseOut={uhov}>Edit</button>
                    <button onClick={()=>onPlay(deck)}
                      style={{...btn(`linear-gradient(135deg,${accent}35,${accent}18)`,accent,{flex:2,fontSize:10,padding:"5px 8px",fontFamily:"Cinzel, serif",border:`1px solid ${accent}50`,backdropFilter:"blur(6px)"})}}
                      onMouseOver={hov} onMouseOut={uhov}>▶ Play</button>
                    {deleteConfirm===deck.id?(
                      <button onClick={()=>{onDelete(deck.id);setDeleteConfirm(null);}}
                        style={{...btn("rgba(248,113,113,.2)","#f87171",{padding:"5px 7px",fontSize:10,border:"1px solid rgba(248,113,113,.35)",backdropFilter:"blur(6px)"})}}
                        onMouseOver={hov} onMouseOut={uhov}>Sure?</button>
                    ):(
                      <button onClick={()=>setDeleteConfirm(deck.id)}
                        style={{...btn("rgba(10,20,40,.6)","#3a4a5a",{padding:"5px 7px",fontSize:12,border:"1px solid transparent",backdropFilter:"blur(6px)"})}}
                        onMouseOver={e=>{e.currentTarget.style.color="#f87171";e.currentTarget.style.borderColor="rgba(248,113,113,.3)";}}
                        onMouseOut={e=>{e.currentTarget.style.color="#3a4a5a";e.currentTarget.style.borderColor="transparent";}}>✕</button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ─── App ─────────────────────────────────────────────────────────── */
export default function MTGPlayground({ authUser = null, initialProfile = null, onProfileSaved = null, onSignOut = null } = {}){
  // Inject fonts and global styles
  useEffect(() => {
    const l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = "https://fonts.googleapis.com/css2?family=Cinzel+Decorative:wght@400;700;900&family=Cinzel:wght@400;600;700&family=Crimson+Text:ital,wght@0,400;0,600;1,400&display=swap";
    if (!document.head.querySelector('link[href*="Cinzel"]')) document.head.appendChild(l);
    if (!document.getElementById('mtg-global-styles')) {
      const s = document.createElement("style");
      s.id = 'mtg-global-styles';
      s.textContent = `
    *{box-sizing:border-box;margin:0;padding:0}
    :root{
      --gold:#c8a870;--gold-bright:#f0d080;--gold-dim:#8a6a40;
      --deep:#050a12;--panel:#080f1c;--border:#1e3a5f;
      --red:#dc2626;--blue:#3b82f6;--green:#16a34a;--white:#f5f0e8;--black:#1a0a2e;
      --fire:#ff6b00;--arcane:#a855f7;--shadow:#0d0014;
    }
    ::-webkit-scrollbar{width:4px;height:4px}
    ::-webkit-scrollbar-track{background:#050a12}
    ::-webkit-scrollbar-thumb{background:linear-gradient(180deg,#c8a870,#3b4a6a);border-radius:2px}
    body{margin:0;background:#050a12;user-select:none;overflow:hidden}
    @keyframes glow{0%,100%{box-shadow:0 0 8px #c8a87050,0 0 20px #c8a87020}50%{box-shadow:0 0 20px #c8a870a0,0 0 50px #c8a87040,0 0 80px #c8a87015}}
    @keyframes glowRed{0%,100%{box-shadow:0 0 8px #dc262650,0 0 20px #dc262620}50%{box-shadow:0 0 20px #dc2626a0,0 0 50px #dc262640}}
    @keyframes glowArcane{0%,100%{box-shadow:0 0 8px #a855f750,0 0 20px #a855f720}50%{box-shadow:0 0 20px #a855f7a0,0 0 50px #a855f740}}
    @keyframes slideIn{from{opacity:0;transform:translateY(-8px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}
    @keyframes slideUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
    @keyframes fadeIn{from{opacity:0}to{opacity:1}}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
    @keyframes pulseBright{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.7;transform:scale(1.05)}}
    @keyframes float{0%,100%{transform:translateY(0) rotate(-4deg)}50%{transform:translateY(-5px) rotate(-4deg)}}
    @keyframes floatSoft{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
    @keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
    @keyframes spinSlow{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
    @keyframes sparkle{0%,100%{opacity:0;transform:scale(0) rotate(0deg)}30%{opacity:1;transform:scale(1) rotate(180deg)}70%{opacity:1;transform:scale(1) rotate(360deg)}}
    @keyframes dragonFly{0%{transform:translateX(-120%) translateY(10%) scaleX(1)}45%{transform:translateX(50%) translateY(-18%) scaleX(1)}50%{transform:translateX(55%) translateY(-18%) scaleX(-1)}100%{transform:translateX(120%) translateY(10%) scaleX(-1)}}
    @keyframes dragonBreath{0%{opacity:0;transform:scaleX(0) scaleY(.5)}20%{opacity:1;transform:scaleX(1) scaleY(1)}80%{opacity:.8;transform:scaleX(1.2) scaleY(.8)}100%{opacity:0;transform:scaleX(1.5) scaleY(.2)}}
    @keyframes explosion{0%{transform:scale(0);opacity:1}60%{transform:scale(1.4);opacity:.9}100%{transform:scale(2.5);opacity:0}}
    @keyframes runeFloat{0%,100%{transform:translateY(0) rotate(0deg);opacity:.3}50%{transform:translateY(-15px) rotate(10deg);opacity:.8}}
    @keyframes cardReveal{from{transform:rotateY(90deg) scale(.8);opacity:0}to{transform:rotateY(0deg) scale(1);opacity:1}}
    @keyframes lifeFlash{0%{transform:scale(1)}30%{transform:scale(1.4)}60%{transform:scale(.9)}100%{transform:scale(1)}}
    @keyframes manaRing{from{stroke-dashoffset:283}to{stroke-dashoffset:0}}
    @keyframes particleBurst{0%{transform:translate(0,0) scale(1);opacity:1}100%{transform:translate(var(--tx),var(--ty)) scale(0);opacity:0}}
    @keyframes shimmer{0%{background-position:-200% center}100%{background-position:200% center}}
    @keyframes borderGlow{0%,100%{border-color:#c8a87050}50%{border-color:#c8a870}}
    @keyframes ritualCircle{from{transform:rotate(0deg)}to{transform:rotate(-360deg)}}
    @keyframes orbPulse{0%,100%{transform:scale(1);filter:brightness(1)}50%{transform:scale(1.15);filter:brightness(1.4)}}
    @keyframes textGlow{0%,100%{text-shadow:0 0 10px #c8a87050}50%{text-shadow:0 0 30px #c8a870,0 0 60px #c8a87080}}
    @keyframes phaseActive{0%{box-shadow:0 0 6px currentColor}50%{box-shadow:0 0 20px currentColor,0 0 40px currentColor}100%{box-shadow:0 0 6px currentColor}}
    @keyframes handCard{from{opacity:0;transform:translateY(20px) scale(.9)}to{opacity:1;transform:translateY(0) scale(1)}}
    @keyframes stackEntry{from{transform:translateX(20px);opacity:0}to{transform:translateX(0);opacity:1}}
    @keyframes menuTitle{0%{letter-spacing:.05em;opacity:.6}50%{letter-spacing:.12em;opacity:1}100%{letter-spacing:.05em;opacity:.6}}
    @keyframes counterBadge{0%{transform:scale(1)}20%{transform:scale(1.6)}100%{transform:scale(1)}}
    @keyframes fireParticle{0%{transform:translateY(0) scale(1);opacity:1}100%{transform:translateY(-60px) scale(0);opacity:0}}
    @keyframes deckCardHover{to{transform:translateY(-3px);box-shadow:0 8px 24px rgba(200,168,112,.2)}}
    @keyframes tapCard{from{transform:rotate(0deg)}to{transform:rotate(90deg)}}
    @keyframes untapCard{from{transform:rotate(90deg)}to{transform:rotate(0deg)}}
    @keyframes zoneHighlight{0%,100%{background:rgba(200,168,112,.04)}50%{background:rgba(200,168,112,.12)}}
    @keyframes cardShake{0%{transform:rotate(0deg)}15%{transform:rotate(-6deg)}30%{transform:rotate(6deg)}45%{transform:rotate(-4deg)}60%{transform:rotate(4deg)}75%{transform:rotate(-2deg)}100%{transform:rotate(0deg)}}
    @keyframes drawFlip{0%{transform:translateY(0) rotateY(0deg) scale(1);opacity:1}30%{transform:translateY(-18px) rotateY(90deg) scale(1.05)}60%{transform:translateY(-12px) rotateY(180deg) scale(1.08)}100%{transform:translateY(40px) translateX(60px) rotateY(0deg) scale(.88);opacity:0}}
    @keyframes cardToGrave{0%{transform:translate(0,0) rotate(0deg) scale(1);opacity:1}50%{transform:translate(var(--gx),var(--gy)) rotate(var(--gr)) scale(.95);opacity:.9}100%{transform:translate(var(--gx2),var(--gy2)) rotate(var(--gr2)) scale(.5);opacity:0}}
    @keyframes cardDiscard{0%{transform:translate(0,0) rotate(0deg) scale(1);opacity:1}100%{transform:translate(var(--dx),var(--dy)) rotate(var(--dr)) scale(.3);opacity:0}}
    @keyframes cmdSummonGlow{0%{box-shadow:0 0 0px transparent}30%{box-shadow:0 0 40px #c8a870,0 0 80px #c8a87080,0 0 120px #c8a87040}60%{box-shadow:0 0 20px #c8a870a0,0 0 50px #c8a87060}100%{box-shadow:0 0 0px transparent}}
    @keyframes cmdSummonRumble{0%,100%{transform:translate(0,0)}10%{transform:translate(-3px,2px)}20%{transform:translate(3px,-2px)}30%{transform:translate(-2px,3px)}40%{transform:translate(2px,-1px)}50%{transform:translate(-1px,2px)}60%{transform:translate(3px,1px)}70%{transform:translate(-2px,-2px)}80%{transform:translate(1px,3px)}90%{transform:translate(-1px,-1px)}}
    @keyframes cmdPortraitPulse{0%,100%{box-shadow:0 0 10px rgba(200,168,112,.4),0 0 20px rgba(200,168,112,.2)}50%{box-shadow:0 0 30px rgba(200,168,112,.9),0 0 60px rgba(200,168,112,.5),0 0 100px rgba(200,168,112,.2)}}
    @keyframes millFly{0%{transform:translate(0,0) rotate(0deg) scale(1);opacity:1;z-index:999}100%{transform:translate(var(--mx),var(--my)) rotate(var(--mr)) scale(.4);opacity:0}}
    @keyframes flyCard{0%{transform:translate(0,0) rotate(0deg) scale(1);opacity:1}60%{opacity:1}100%{transform:translate(var(--fx),var(--fy)) rotate(var(--fr)) scale(.6);opacity:0}}
    .glow-gold{animation:glow 2.5s ease-in-out infinite}
    .glow-red{animation:glowRed 2s ease-in-out infinite}
    .glow-arcane{animation:glowArcane 2s ease-in-out infinite}
    .slide-in{animation:slideIn .22s cubic-bezier(0.34,1.3,0.64,1) forwards}
    .slide-up{animation:slideUp .2s ease forwards}
    .fade-in{animation:fadeIn .25s ease forwards}
    .float-soft{animation:floatSoft 3s ease-in-out infinite}
    .text-glow{animation:textGlow 3s ease-in-out infinite}
    .phase-active{animation:phaseActive 1.5s ease-in-out infinite}
    .drop-target{transition:border-color .12s,background .12s,box-shadow .12s}
    .drop-target.over{border-color:#c8a870!important;background:rgba(200,168,112,.06)!important;box-shadow:inset 0 0 20px rgba(200,168,112,.12),0 0 10px rgba(200,168,112,.1)!important;animation:zoneHighlight 1s ease-in-out infinite}
    .card-3d{transform-style:preserve-3d;perspective:600px;transition:transform .3s cubic-bezier(0.34,1.4,0.64,1),box-shadow .3s;}
    .card-3d:hover{transform:translateY(-4px) rotateX(4deg) rotateY(-2deg);box-shadow:0 16px 32px rgba(0,0,0,.8),0 0 20px rgba(200,168,112,.15)}
    .mana-symbol{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:50%;font-size:8px;font-weight:700;font-family:"Crimson Text",serif;}
    .shimmer-text{background:linear-gradient(90deg,#c8a870,#f0d080,#c8a870,#8a6a40,#c8a870);background-size:200% auto;-webkit-background-clip:text;-webkit-text-fill-color:transparent;animation:shimmer 3s linear infinite;}
    input,textarea,select{outline:none;font-family:"Crimson Text",serif}
    button{cursor:pointer;font-family:"Cinzel",serif}
    .ritual-bg::before{content:'';position:absolute;inset:0;background:radial-gradient(circle at 50% 50%,rgba(168,85,247,.04) 0%,transparent 60%);pointer-events:none;}
    .ember{position:absolute;width:3px;height:3px;border-radius:50%;background:radial-gradient(circle,#ff9900,#ff4400);animation:fireParticle var(--dur) ease-out forwards;pointer-events:none;}
    .orb-W{background:radial-gradient(circle at 35% 35%,#fffde7,#ddd5b8)}
    .orb-U{background:radial-gradient(circle at 35% 35%,#64b5f6,#1565c0)}
    .orb-B{background:radial-gradient(circle at 35% 35%,#7c4dff,#1a0a2e)}
    .orb-R{background:radial-gradient(circle at 35% 35%,#ff7043,#b71c1c)}
    .orb-G{background:radial-gradient(circle at 35% 35%,#66bb6a,#1b5e20)}
    .orb-C{background:radial-gradient(circle at 35% 35%,#90a4ae,#455a64)}
    .orb-X{background:radial-gradient(circle at 35% 35%,#bdbdbd,#616161)}
      `;
      document.head.appendChild(s);
    }
    return () => {}; // styles persist intentionally
  }, []);

  const [view,setView]=useState("loading");
  const [profile,setProfile]=useState(initialProfile || null);
  const [decks,setDecks]=useState([]);
  const [customCards,setCustomCards]=useState([]);
  const [editingDeck,setEditingDeck]=useState(null);
  const [gameState,setGameState]=useState(null);
  const [theme,setTheme]=useState(THEMES[0]);
  const [weather,setWeather]=useState('none');
  const [showThemePicker,setShowThemePicker]=useState(false);
  // v7: net sync handle (created when entering an online game)
  const netRef = useRef(null);
  // v7 Phase 2: which opponent seat index is currently "primary" (rendered by GameBoard).
  // Null = auto-pick first non-me seat.
  const [primaryOppIdx, setPrimaryOppIdx] = useState(null);

  useEffect(()=>{
    (async()=>{
      // v7: profile comes from Supabase via `initialProfile` prop when signed in.
      // Only fall back to localStorage when running without auth (legacy).
      let prof=initialProfile||null,ds=[],cc=[];
      if(!prof){
        try{const r=await storage.get("mtg_profile_v1");if(r)prof=JSON.parse(r.value);}catch{}
      }
      // v7.3: cloud decks. Try cloud first; fall back to localStorage.
      try{
        if(window.__MTG_V7__?.getDecks){
          const cloud=await window.__MTG_V7__.getDecks();
          if(Array.isArray(cloud)&&cloud.length>0) ds=cloud;
          else {
            try{const r=await storage.get("mtg_decks_v3");if(r)ds=JSON.parse(r.value);}catch{}
          }
        } else {
          try{const r=await storage.get("mtg_decks_v3");if(r)ds=JSON.parse(r.value);}catch{}
        }
      }catch{
        try{const r=await storage.get("mtg_decks_v3");if(r)ds=JSON.parse(r.value);}catch{}
      }
      try{const r=await storage.get("mtg_custom_cards");if(r)cc=JSON.parse(r.value);}catch{}
      setProfile(prof);setDecks(ds);setCustomCards(cc);
      setView(prof?"menu":"profile");
    })();
    // v7.6.1: dep array intentionally empty. Previously this useEffect had
    // `[initialProfile]` which caused a catastrophic bug: when the in-game
    // gamemat picker saved the profile via App.jsx.saveProfile, App re-
    // rendered with a new initialProfile prop, this effect re-fired, and
    // setView("menu") kicked the player out of their running game. Only
    // runs once on mount now; the profile state is kept in sync via
    // saveProfile's own setProfile call when the user edits it.
     
  },[]);

  const saveProfile=async p=>{
    setProfile(p);
    // v7: cloud-persist via prop, plus keep a local mirror for offline.
    if(onProfileSaved){ try{ await onProfileSaved(p); }catch(e){ console.warn("[saveProfile cloud]",e); } }
    try{await storage.set("mtg_profile_v1",JSON.stringify(p));}catch{}
    // v7.6.1: DO NOT call setView("menu") here — this function is also invoked
    // from the in-game gamemat picker via window.__MTG_V7__.saveProfile, and
    // switching to "menu" mid-game kicked the player out of their online room.
    // The ProfileSetup form now switches the view at its own callsite.
  };

  const persist=async d=>{
    setDecks(d);
    // v7.3: cloud-primary, local mirror (for offline + fast reload).
    if(window.__MTG_V7__?.saveDecks){
      try{ await window.__MTG_V7__.saveDecks(d); }catch(e){ console.warn("[persist cloud]",e); }
    }
    try{await storage.set("mtg_decks_v3",JSON.stringify(d));}catch{}
  };
  const saveDeck=deck=>{persist(decks.some(d=>d.id===deck.id)?decks.map(d=>d.id===deck.id?deck:d):[...decks,deck]);setView("menu");};

  // v7: after a local state change, broadcast to peers if an online session is active.
  // v7.4 Privacy: Only hand CARDS are masked to opponents. Library, graveyard,
  // exile, command zone, battlefield, playermat, sleeve URI, topRevealed flag
  // and hand COUNT all stay visible. Each peer still overlays their own seat's
  // authoritative data locally (see onRemoteState merge).
  //
  // Additionally: opponents see a face-down stub per card in library (respecting
  // the seat's sleeve URI) so they know the count + see the correct sleeve.
  // If topRevealed is on for that seat, the first library card stays unmasked.
  const maskPrivateZones = useCallback((gs)=>{
    if(!gs || !Array.isArray(gs.players)) return gs;
    return {
      ...gs,
      players: gs.players.map((p,idx)=>{
        const handStub = (c)=>({iid:c?.iid||uid(),faceDown:true,_masked:"hand"});
        const libStub  = (c)=>({iid:c?.iid||uid(),faceDown:true,_masked:"library"});
        const lib = p.library || [];
        // Preserve top card if the seat has topRevealed (or per-iid reveal) set.
        const topRevealedId = p.revealTopOnce;
        let maskedLib;
        if (p.revealTop && lib.length > 0) {
          maskedLib = [lib[0], ...lib.slice(1).map(libStub)];
        } else if (topRevealedId && lib.length > 0 && lib[0]?.iid === topRevealedId) {
          maskedLib = [lib[0], ...lib.slice(1).map(libStub)];
        } else {
          maskedLib = lib.map(libStub);
        }
        return {
          ...p,
          hand:    (p.hand || []).map(handStub),
          library: maskedLib,
          // graveyard, exile, battlefield, commandZone, playermat, deck (for sleeve), etc
          // are passed through unchanged → opponents see them fully.
        };
      }),
    };
  },[]);

  const broadcastIfOnline = useCallback((nextGS)=>{
    if(nextGS?.isOnline && netRef.current){
      try{ netRef.current.broadcast(maskPrivateZones(nextGS)); }catch(e){ console.warn("[netSync.broadcast]",e); }
    }
  },[maskPrivateZones]);

  const updatePlayer=useCallback((idx,fn)=>setGameState(gs=>{
    const next = {...gs,players:gs.players.map((p,i)=>i===idx?fn(p):p)};
    broadcastIfOnline(next);
    return next;
  }),[broadcastIfOnline]);
  const updateGame=useCallback(changes=>setGameState(gs=>{
    const next = {...gs,...changes};
    broadcastIfOnline(next);
    return next;
  }),[broadcastIfOnline]);

  const startGame=(deck,isTwoPlayer=false,isOnline=false,roomId=null,playerIdx=0,otherDeck=null,gamemode=null,extraDecks=null,extraProfiles=null)=>{
    const fmt=gamemode||deck.format||"standard";
    const life=getStartingLife(fmt);
    // Dandan: both players get dandan deck
    const d1=fmt==="dandan"?DANDAN_DECK:deck;
    const d2=fmt==="dandan"?DANDAN_DECK:(otherDeck||deck);
    // v7.4: always stamp my own userId on my profile so opponents can target hand-reveal requests.
    const myProfile = {...profile, userId: authUser?.id};
    const p1=initPlayer(d1,myProfile,life);
    const p2=initPlayer(d2,isTwoPlayer||isOnline?(extraProfiles?.[0]||{alias:"Opponent",avatar:"🧙",gamemat:GAMEMATS[0].bg}):myProfile,life);
    // v7: support 3 or 4 players. extraDecks/extraProfiles arrays hold the
    // additional seats. p3/p4 are only added when an array entry exists.
    const extra=[];
    if(extraDecks && extraDecks[0]){
      extra.push(initPlayer(fmt==="dandan"?DANDAN_DECK:extraDecks[0], extraProfiles?.[1]||{alias:"Player 3",avatar:"🧙",gamemat:GAMEMATS[0].bg}, life));
    }
    if(extraDecks && extraDecks[1]){
      extra.push(initPlayer(fmt==="dandan"?DANDAN_DECK:extraDecks[1], extraProfiles?.[2]||{alias:"Player 4",avatar:"🧙",gamemat:GAMEMATS[0].bg}, life));
    }
    const players=[p1,p2,...extra];

    // v7: stop any stale net sync from a previous game
    if(netRef.current){ netRef.current.stop().catch(()=>{}); netRef.current=null; }

    const initial={phase:0,turn:1,activePlayer:playerIdx,stack:[],players,isTwoPlayer,isOnline,roomId,gamemode:fmt,myPlayerIdx:playerIdx};
    setGameState(initial);
    setView("game");

    // v7: spin up net sync for online games
    if(isOnline && roomId && authUser?.id){
      const sync=new NetSync({
        roomId,
        userId:authUser.id,
        alias: profile?.alias || authUser?.user_metadata?.alias || "Player",
        onRemoteState:(remoteState /*, info */)=>{
          // v2 fix (bug #2): when a remote update lands, we MERGE instead of
          // replacing wholesale. Specifically, the remote peer owns their own
          // seat's `log` and `player.*` state; our local seat is authoritative
          // for our own data. Without this, each broadcast would clobber our
          // local log and chat state written by addLog between broadcasts.
          setGameState(gs=>{
            if(!gs) return remoteState;
            const mine = gs.myPlayerIdx ?? 0;
            const merged = {...remoteState, myPlayerIdx: mine};
            // Keep OUR seat's latest state; accept REMOTE for all other seats.
            if (Array.isArray(gs.players) && Array.isArray(remoteState.players)) {
              merged.players = remoteState.players.map((p, i) => i === mine ? gs.players[i] : p);
            }
            return merged;
          });
        },
      });
      netRef.current=sync;
      // v2 fix (bug #2): expose netSync on a global so InGameChat and
      // other deep components can broadcast events without prop drilling.
      window.__MTG_V7__ = window.__MTG_V7__ || {};
      window.__MTG_V7__.netSync = sync;
      window.__MTG_V7__.mySeat = playerIdx;
      sync.start().then(()=>{
        // Seed remote with our initial state if it's empty (masked for privacy)
        sync.broadcast(maskPrivateZones(initial));
      }).catch(e=>console.warn("[netSync.start]",e));

      // v2 fix (bug #2): subscribe to chat + action-log events and dispatch
      // DOM events that InGameChat + the log UI listen for. Keeps the event
      // flow isolated from gameState (prevents last-write-wins from nuking
      // messages).
      sync.subscribeEvents((ev)=>{
        if (!ev) return;
        if (ev.user_id === authUser.id) return; // skip echoes
        const p = ev.payload || {};
        if (ev.kind === 'chat') {
          window.dispatchEvent(new CustomEvent('mtg:remote-chat', { detail: p }));
        } else if (ev.kind === 'action') {
          window.dispatchEvent(new CustomEvent('mtg:remote-action', { detail: p }));
        } else if (ev.kind === 'zone_request' || ev.kind === 'hand_request') {
          // Someone is asking to see one of MY zones (target=me) — surface a prompt.
          // Legacy `hand_request` kind defaults zone to "hand".
          if (p.targetUserId === authUser.id) {
            const payload = ev.kind === 'zone_request' ? p : {...p, zone:'hand'};
            window.dispatchEvent(new CustomEvent('mtg:zone-request', { detail: payload }));
          }
        } else if (ev.kind === 'zone_reveal' || ev.kind === 'hand_reveal') {
          // Someone approved a reveal — if I requested it, show their zone.
          if (p.requesterUserId === authUser.id) {
            const payload = ev.kind === 'zone_reveal' ? p : {...p, zone:'hand'};
            window.dispatchEvent(new CustomEvent('mtg:zone-reveal', { detail: payload }));
          }
        } else if (ev.kind === 'zone_deny' || ev.kind === 'hand_deny') {
          if (p.requesterUserId === authUser.id) {
            const payload = ev.kind === 'zone_deny' ? p : {...p, zone:'hand'};
            window.dispatchEvent(new CustomEvent('mtg:zone-deny', { detail: payload }));
          }
        }
      });
    }
  };

  // v7: tear down net sync whenever we leave the game view
  useEffect(()=>{
    if(view!=="game" && netRef.current){
      netRef.current.stop().catch(()=>{});
      netRef.current=null;
      if (window.__MTG_V7__) window.__MTG_V7__.netSync = null;
    }
    return ()=>{}; // cleanup on unmount handled elsewhere
  },[view]);

  // v7: switchPlayer cycles through all seats (2, 3, or 4 players).
  const switchPlayer=()=>setGameState(gs=>{
    if(!gs) return gs;
    const n=gs.players.length||2;
    return {...gs,activePlayer:(gs.activePlayer+1)%n};
  });
  const resetGame=()=>{
    if(!gameState)return;
    // v7: reset all seats, not just 2
    const newPlayers = gameState.players.map(ps=>initPlayer(ps.deck,ps.profile,getStartingLife(ps.deck?.format||gameState.gamemode)));
    setGameState({...gameState,phase:0,turn:1,stack:[],players:newPlayers});
  };

  // Apply theme by injecting a CSS override block
  useEffect(()=>{
    let el = document.getElementById('mtg-theme-overrides');
    if(!el){ el=document.createElement('style'); el.id='mtg-theme-overrides'; document.head.appendChild(el); }
    // We override the body background and inject CSS vars that the theme picker previews use
    // For full theme support we also directly set background on key elements via data-theme attribute
    // Update the live theme object so all components read current values
    T.bg       = theme.bg;
    T.panel    = theme.panel;
    T.border   = theme.border;
    T.accent   = theme.accent;
    T.text     = theme.text;
    T.headerBg = theme.headerBg || ('linear-gradient(180deg,'+theme.panel+','+theme.bg+')');
    T.panelTex = theme.panelTex || theme.panel;
    document.body.style.background = theme.bg;
    document.documentElement.setAttribute('data-theme', theme.id);
    el.textContent = `
      [data-theme="${theme.id}"] { --t-bg:${T.bg}; --t-panel:${T.panel}; --t-border:${T.border}; --t-accent:${T.accent}; --t-text:${T.text}; }
      .mtg-root { background: ${T.bg} !important; }
      .mtg-header { background: ${T.headerBg || T.bg} !important; border-bottom-color: ${T.border} !important; }
      .mtg-panel { background: ${T.panel} !important; border-color: ${T.border} !important; }
      .mtg-accent { color: ${T.accent} !important; }
      .mtg-text { color: ${T.text} !important; }
      .mtg-border { border-color: ${T.border} !important; }
      /* Body & global */
      body { background: ${T.bg} !important; }
      /* Card borders */
      .mtg-card-border { border-color: ${T.border} !important; }
      /* Phase bar */
      .mtg-phase-bar { border-color: ${T.accent}40 !important; }
      /* Scrollbar */
      ::-webkit-scrollbar-thumb { background: linear-gradient(180deg, ${T.accent}, ${T.panel}) !important; }
      /* Sidebar */
      .mtg-sidebar { background: ${T.panelTex||T.panel} !important; border-color: ${T.border}30 !important; }
      .mtg-panel-tex { background: ${T.panelTex||T.panel} !important; }
      /* Hand zone */
      .mtg-hand { background: none !important; border: none !important; box-shadow: none !important; outline: none !important; opacity: 0 !important; pointer-events: none !important; }
      .mtg-hand.over { background: none !important; border: none !important; box-shadow: none !important; animation: none !important; }
      /* Buttons base */
      .mtg-btn-primary { background: linear-gradient(135deg, ${T.accent}, ${T.accent}80) !important; }
      /* Zone panels */
      .mtg-zone { background: linear-gradient(160deg, ${T.panel}, ${T.bg}) !important; border-color: ${T.border}30 !important; }
      /* Main menu */
      .mtg-menu-root { background: ${T.bg} !important; }
      .mtg-menu-header { background: linear-gradient(180deg, ${T.panel}ee, ${T.bg}cc) !important; border-bottom-color: ${T.accent}20 !important; }
      .mtg-deck-card { background: linear-gradient(180deg, ${T.panel}f5, ${T.bg}fa) !important; border-color: ${T.border}20 !important; }
      .mtg-deck-card:hover { border-color: ${T.accent}50 !important; }
      /* Deckbuilder */
      .mtg-deckbuilder { background: ${T.bg} !important; }
      /* Context menu */
      .mtg-context-menu { background: linear-gradient(160deg, ${T.panel}, ${T.bg}) !important; border-color: ${T.border} !important; }
      /* Battlefield */
      .mtg-battlefield { }
      /* Game header */
      .mtg-game-header { background: linear-gradient(90deg, ${T.bg}, ${T.panel}80, ${T.bg}) !important; }
      /* Selected card glow */
      .glow-gold { box-shadow: 0 0 8px ${T.accent}50, 0 0 20px ${T.accent}20 !important; }
      /* Title text shimmer */
      .shimmer-text { background: linear-gradient(90deg, ${T.accent}, ${T.text}, ${T.accent}) !important; background-size: 200% auto !important; -webkit-background-clip: text !important; -webkit-text-fill-color: transparent !important; }
    `;
  },[theme]);

  if(view==="loading")return(
    <div style={{height:"100vh",background:T.bg,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:16}}>
      <div style={{fontSize:40,animation:"floatSoft 1.5s ease-in-out infinite",filter:"drop-shadow(0 0 20px rgba(200,168,112,.5))"}}>⚔</div>
      <div className="shimmer-text" style={{fontFamily:"Cinzel Decorative, serif",fontSize:16,letterSpacing:".1em"}}>MTG Playground</div>
      <div style={{fontSize:9,color:"#2a3a5a",fontFamily:"Cinzel, serif",letterSpacing:".2em",animation:"pulse 1.5s ease-in-out infinite"}}>ENTERING THE MULTIVERSE…</div>
    </div>
  );

  if(view==="profile")return<ProfileSetup existing={profile} onSave={async(p)=>{await saveProfile(p); setView("menu");}}/>;
  if(view==="deckbuilder")return<DeckBuilder deck={editingDeck} onSave={saveDeck} onBack={()=>setView("menu")} customCards={customCards}/>;
  if(view==="rooms")return<RoomLobby profile={profile} decks={decks} onBack={()=>setView("menu")} onJoinGame={({roomId,playerIdx=0,myDeck,otherDeck,isOnline,isLocal,gamemode,extraDecks,extraProfiles})=>{
    if(isLocal)startGame(myDeck,true,false,null,0,otherDeck,gamemode,extraDecks,extraProfiles);
    else startGame(myDeck,false,true,roomId,playerIdx,otherDeck,gamemode,extraDecks,extraProfiles);
  }}/>;

  if(view==="game"&&gameState){
    const{phase,turn,stack,players,isTwoPlayer,isOnline,roomId,activePlayer,myPlayerIdx}=gameState;
    // v7: in an online game, "me" is always myPlayerIdx (my seat) regardless of whose turn.
    //     In hotseat, "me" is activePlayer (current-turn seat).
    const myIdx = isOnline ? (myPlayerIdx ?? activePlayer) : activePlayer;
    const player = players[myIdx] || players[0];

    // v7 Phase 2: compute all opponents (indices + player objects).
    const allOppIndices = players.map((_,i)=>i).filter(i=>i!==myIdx);
    const primaryIdx = (primaryOppIdx!=null && allOppIndices.includes(primaryOppIdx))
      ? primaryOppIdx
      : allOppIndices[0];
    const opponent = players[primaryIdx] || players[0];
    const extraOpponents = allOppIndices.filter(i=>i!==primaryIdx).map(i=>({seat:i,player:players[i]}));

    // v7 Phase 2: layout mode based on total player count.
    // 2p  → no extra tiles (v6's native mirrored layout handles it)
    // 3p  → 2 opponent tiles stacked on the right (one is primary=GameBoard-strip, one is OpponentTile)
    // 4p  → 3 opponent tiles in quadrants
    const nPlayers = players.length;
    const{gamemode:gm}=gameState;

    return<>
      <WeatherCanvas weather={weather}/>
      {showThemePicker&&<ThemePicker current={theme} weather={weather} onTheme={setTheme} onWeather={setWeather} onClose={()=>setShowThemePicker(false)}/>}
      <GameBoard
        playerIdx={myIdx} player={player} opponent={opponent}
        phase={phase} turn={turn} stack={stack} gamemode={gm}
        onUpdatePlayer={updatePlayer} onUpdateGame={updateGame}
        onExit={async()=>{
          if(isOnline && roomId){
            try{ const { leaveRoom } = await import("./lib/storage"); await leaveRoom(roomId); }catch(e){ console.warn("[leaveRoom]",e); }
          }
          if(netRef.current){ netRef.current.stop().catch(()=>{}); netRef.current=null; }
          setPrimaryOppIdx(null);
          setView("menu");
        }}
        onSwitchPlayer={isTwoPlayer?switchPlayer:null}
        onReset={resetGame} onChangeDeck={()=>setView("menu")}
        isTwoPlayer={isTwoPlayer} isOnline={isOnline} roomId={roomId} decks={decks}
        authUser={authUser}
        onTheme={()=>setShowThemePicker(true)}/>
      {/* v7 Phase 2: extra opponent tiles for 3p (1 tile) and 4p (2 tiles).
          Tiles float on the right edge, overlaying the sidebar area but
          non-blocking (pointer-events auto only on their content). Clicking
          a tile promotes that opponent to be the primary (GameBoard target). */}
      {extraOpponents.length>0 && (
        <div style={{position:"fixed",top:40,right:196,bottom:160,width:220,
          display:"flex",flexDirection:"column",gap:8,padding:"8px 0",zIndex:500,
          pointerEvents:"none"}}>
          {extraOpponents.map(({seat,player:opp},idx)=>(
            <OpponentTile key={seat} opp={opp} seat={seat} isActive={activePlayer===seat}
              onPromote={()=>setPrimaryOppIdx(seat)}/>
          ))}
        </div>
      )}
    </>;
  }

  return<><WeatherCanvas weather={weather}/>{showThemePicker&&<ThemePicker current={theme} weather={weather} onTheme={setTheme} onWeather={setWeather} onClose={()=>setShowThemePicker(false)}/>}<MainMenu decks={decks} profile={profile} onTheme={()=>setShowThemePicker(true)}
    onNew={()=>{setEditingDeck(null);setView("deckbuilder");}}
    onEdit={d=>{setEditingDeck(d);setView("deckbuilder");}}
    onPlay={d=>startGame(d,false)}
    onRooms={()=>setView("rooms")}
    onDelete={id=>persist(decks.filter(d=>d.id!==id))}
    onSignOut={onSignOut}
    onChaos={cards=>{persist([...decks,{id:uid(),name:"🎲 Chaos Deck",cards,format:"standard"}]);}}/></>
}
