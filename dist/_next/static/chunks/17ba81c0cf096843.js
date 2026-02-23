(globalThis.TURBOPACK||(globalThis.TURBOPACK=[])).push(["object"==typeof document?document.currentScript:void 0,4180,e=>{"use strict";var t=e.i(26659),a=e.i(19621);e.i(69695);var r=e.i(30676),i=e.i(29584);let n={glass:{xPct:19,yPct:44},friday:{xPct:43,yPct:49},yuri:{xPct:21,yPct:82},jarvis:{xPct:42,yPct:83},epstein:{xPct:77,yPct:78}},s=[{key:"yuri",label:"Yuri",spriteIndex:0},{key:"friday",label:"Friday",spriteIndex:1},{key:"jarvis",label:"Jarvis",spriteIndex:2},{key:"glass",label:"Glass",spriteIndex:3},{key:"epstein",label:"Epstein",spriteIndex:4}],l=[{xPct:16,yPct:22},{xPct:30,yPct:20},{xPct:35,yPct:45},{xPct:44,yPct:30},{xPct:52,yPct:56},{xPct:66,yPct:20},{xPct:79,yPct:30},{xPct:74,yPct:78},{xPct:90,yPct:86}];function c(e){return"active"===e||"busy"===e?"#22c55e":"idle"===e?"#f59e0b":"#94a3b8"}function o(e,t,a){return Math.max(t,Math.min(a,e))}async function d(e){let t=new Image;t.src="/characters-ref.jpg",await t.decode();let a=32*e,r=document.createElement("canvas");r.width=128,r.height=36;let i=r.getContext("2d",{alpha:!0});i.imageSmoothingEnabled=!1;let n=[0,1,0,1];for(let e=0;e<4;e++)i.clearRect(32*e,0,32,36),i.drawImage(t,a,0,32,36,32*e,n[e],32,36);return r.toDataURL("image/png")}function p(){let e=(0,r.useQuery)(i.api.agents.getAll,{}),p=(0,r.useQuery)(i.api.agentRuns.getRecent,{status:"running",limit:100}),x=(0,a.useMemo)(()=>s.map(t=>{let a=function(e,t,a){if(!e)return;let r=t.toLowerCase(),i=a.toLowerCase();return e.find(e=>(e.handle??"").toLowerCase()===r)||e.find(e=>(e.name??"").toLowerCase()===i)}(e,t.key,t.label),r=a?.status??"offline",i=(p??[]).find(e=>{let a=String(e.agentId??"").toLowerCase(),r=String(e.agentName??"").toLowerCase();return a===t.key||r===t.label.toLowerCase()});return{key:t.key,label:t.label,status:r,task:i?.task??a?.currentTask}}),[e,p]),[u,f]=(0,a.useState)("friday"),g=x.find(e=>e.key===u),[y,b]=(0,a.useState)({});(0,a.useEffect)(()=>{let e=!1;return(async()=>{let t={};for(let e of s)t[e.key]=await d(e.spriteIndex);e||b(t)})(),()=>{e=!0}},[]);let m=(0,a.useRef)({}),h=(0,a.useRef)(0),k=(0,a.useRef)({}),[P,w]=(0,a.useState)(0);return(0,a.useEffect)(()=>{for(let e of s){if(m.current[e.key])continue;let t=n[e.key];m.current[e.key]={x:t.xPct,y:t.yPct,tx:t.xPct,ty:t.yPct,waitUntil:0,frame:0},k.current[e.key]=0}},[]),(0,a.useEffect)(()=>{let e=0,t=a=>{if(e=requestAnimationFrame(t),a-h.current<50)return;let r=Math.min(.08,(a-h.current)/1e3||.05);for(let e of(h.current=a,x)){let t=m.current[e.key];if(!t)continue;let c="offline"===e.status,d="active"===e.status||"busy"===e.status,p="idle"===e.status;if(c)t.tx=86,t.ty=86;else if(d){let a=n[e.key];t.tx=a.xPct,t.ty=a.yPct}else if(p){var i,s;if(1.2>(i={xPct:t.x,yPct:t.y},s={xPct:t.tx,yPct:t.ty},Math.hypot(i.xPct-s.xPct,i.yPct-s.yPct))&&a>t.waitUntil){let r=function(e){let t=e>>>0;return()=>{t|=0;let e=Math.imul((t=t+0x6d2b79f5|0)^t>>>15,1|t);return(((e=e+Math.imul(e^e>>>7,61|e)^e)^e>>>14)>>>0)/0x100000000}}(999*e.key.charCodeAt(0)+Math.floor(a/1e3)),i=l[Math.floor(r()*l.length)];t.tx=i.xPct,t.ty=i.yPct,t.waitUntil=a+(1500+2500*r())}}let x=d?10:c?5:6,u=t.tx-t.x,f=t.ty-t.y,g=Math.hypot(u,f),y=g>.3;if(y){let e=x*r/Math.max(g,1e-4);t.x+=u*o(e,0,1),t.y+=f*o(e,0,1)}let b=(k.current[e.key]??0)+(y?r:0);k.current[e.key]=b,y?t.frame=Math.floor(b/.14)%4:t.frame=0}w(e=>(e+1)%1e5)};return e=requestAnimationFrame(t),()=>cancelAnimationFrame(e)},[x]),(0,t.jsxs)("div",{className:"officeRoot",children:[(0,t.jsx)("style",{children:`
        .officeRoot{display:flex;gap:16px;padding:16px;min-height:calc(100vh - 64px);background:#0b1220;color:#e5e7eb;}
        @media (max-width: 900px){.officeRoot{flex-direction:column;}}

        .sceneWrap{flex:1;min-width:320px;display:flex;justify-content:center;align-items:flex-start;}
        .scene{
          position:relative;
          width:min(980px, 100%);
          aspect-ratio: 1308 / 521;
          background-image:url('/office-bg.jpg');
          background-size:100% 100%;
          background-repeat:no-repeat;
          image-rendering: pixelated;
          border:1px solid rgba(255,255,255,0.08);
          border-radius:12px;
          overflow:hidden;
          box-shadow: 0 10px 30px rgba(0,0,0,0.35);
        }

        .marker{position:absolute;left:0;top:0;transform:translate(-50%,-100%);cursor:pointer;user-select:none;}
        .marker:focus{outline:none;}

        .sprite{
          width:32px;height:36px;
          background-repeat:no-repeat;
          image-rendering: pixelated;
          transform-origin: 50% 85%;
          transform: scale(2.5);
          filter: drop-shadow(0px 2px 0px rgba(0,0,0,0.35));
        }

        .tag{
          margin-top:10px;
          display:inline-flex;align-items:center;gap:8px;
          padding:6px 10px;
          background: rgba(2,6,23,0.78);
          border:1px solid rgba(255,255,255,0.10);
          border-radius:999px;
          font: 600 12px/1.1 ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto;
          letter-spacing: 0.2px;
          white-space:nowrap;
        }
        .dot{width:8px;height:8px;border-radius:999px;box-shadow:0 0 0 2px rgba(0,0,0,0.35);}
        .selectedRing{box-shadow:0 0 0 2px rgba(148,163,184,0.35), 0 0 0 4px rgba(59,130,246,0.35); border-radius:10px; padding:2px;}

        .panel{
          width:360px;max-width:100%;
          background:rgba(2,6,23,0.75);
          border:1px solid rgba(255,255,255,0.10);
          border-radius:12px;
          padding:14px;
          height:fit-content;
          position:sticky;top:16px;
          backdrop-filter: blur(8px);
        }
        .panel h2{margin:0 0 10px 0;font:700 16px/1.2 ui-sans-serif, system-ui;}
        .panelRow{display:flex;align-items:center;justify-content:space-between;gap:10px;}
        .pill{display:inline-flex;align-items:center;gap:8px;padding:6px 10px;border-radius:999px;border:1px solid rgba(255,255,255,0.12);background:rgba(15,23,42,0.6);}
        .task{margin-top:12px;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,0.10);background:rgba(15,23,42,0.55);color:#d1d5db;white-space:pre-wrap;}
        .hint{margin-top:10px;color:#94a3b8;font-size:12px;}
      `}),(0,t.jsx)("div",{className:"sceneWrap",children:(0,t.jsx)("div",{className:"scene","aria-label":"Pixel office",children:s.map(e=>{let a=x.find(t=>t.key===e.key),r=u===e.key,i=m.current[e.key];if(!a||!i)return null;let n="offline"===a.status,s=`${i.x}%`,l=`${i.y}%`,o=y[e.key],d=-(32*i.frame);return(0,t.jsxs)("button",{className:"marker",style:{left:s,top:l,background:"transparent",border:"none",padding:0,opacity:n?.45:1},onClick:()=>f(e.key),title:e.label,children:[(0,t.jsx)("div",{className:r?"selectedRing":void 0,children:(0,t.jsx)("div",{className:"sprite",style:{backgroundImage:o?`url('${o}')`:"none",backgroundSize:"128px 36px",backgroundPosition:`${d}px 0px`}})}),(0,t.jsxs)("div",{className:"tag",children:[(0,t.jsx)("span",{className:"dot",style:{background:c(a.status)}}),(0,t.jsx)("span",{children:e.label})]})]},e.key)})})}),(0,t.jsxs)("aside",{className:"panel","aria-label":"Agent details",children:[(0,t.jsxs)("div",{className:"panelRow",children:[(0,t.jsxs)("h2",{style:{display:"flex",alignItems:"center",gap:10},children:[(0,t.jsx)("span",{className:"dot",style:{background:c(g?.status??"offline")}}),(0,t.jsx)("span",{children:g?.label??"Agent"})]}),(0,t.jsxs)("span",{className:"pill",children:[(0,t.jsx)("span",{style:{color:"#94a3b8",fontSize:12},children:"Status"}),(0,t.jsx)("span",{style:{fontWeight:700,textTransform:"capitalize"},children:g?.status??"offline"})]})]}),(0,t.jsx)("div",{className:"task",children:g?.task?g.task:"No active task."}),(0,t.jsx)("div",{className:"hint",children:"Click a character in the office to switch agents."})]})]})}e.s(["default",()=>p])}]);