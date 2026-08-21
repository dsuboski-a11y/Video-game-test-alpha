export const CSS = `
:root{
  --ink:#cfe3ff; --dim:rgba(207,227,255,.55);
  --panel:rgba(8,13,22,.9); --edge:rgba(120,180,255,.22);
  --t0:#35e0c8; --t1:#ff6b4a;
  --safeT:env(safe-area-inset-top,0px); --safeB:env(safe-area-inset-bottom,0px);
  --safeL:env(safe-area-inset-left,0px); --safeR:env(safe-area-inset-right,0px);
}
#ui{font:600 13px/1.2 ui-monospace,"SF Mono",Menlo,Consolas,monospace;letter-spacing:.02em}

/* ---------------------------------------------------------------- stick --- */
.touchlayer{position:absolute;inset:0;z-index:1;touch-action:none}
.stick{position:absolute;width:104px;height:104px;margin:-52px 0 0 -52px;border-radius:50%;
  border:2px solid rgba(120,180,255,.28);background:rgba(10,18,32,.30);pointer-events:none;z-index:5}
.knob{position:absolute;left:50%;top:50%;width:46px;height:46px;border-radius:50%;
  background:rgba(53,224,200,.35);border:2px solid rgba(53,224,200,.8);
  box-shadow:0 0 18px rgba(53,224,200,.4)}

/* --------------------------------------------------------------- buttons --- */
.btn{position:absolute;display:flex;align-items:center;justify-content:center;
  border-radius:50%;border:2px solid var(--edge);background:var(--panel);color:var(--ink);
  font-weight:700;text-align:center;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);
  transition:transform .06s ease,background .06s ease;z-index:6;user-select:none}
.btn.down{transform:scale(.92);background:rgba(53,224,200,.28)}
.btn.fire{right:calc(18px + var(--safeR));bottom:calc(20px + var(--safeB));width:96px;height:96px;
  font-size:15px;border-color:rgba(255,107,74,.55);background:rgba(60,16,10,.65);color:#ffd9cf}
.btn.mode{right:calc(122px + var(--safeR));bottom:calc(88px + var(--safeB));width:66px;height:66px;font-size:11px}
.btn.grab{right:calc(122px + var(--safeR));bottom:calc(14px + var(--safeB));width:66px;height:66px;font-size:11px}
.btn.build{right:calc(18px + var(--safeR));bottom:calc(126px + var(--safeB));width:66px;height:66px;font-size:11px;
  border-color:rgba(255,209,102,.5);color:#ffe9b0}
.btn.build.ready{box-shadow:0 0 0 0 rgba(255,209,102,.55);animation:pulse 1.8s infinite}
@keyframes pulse{0%{box-shadow:0 0 0 0 rgba(255,209,102,.5)}70%{box-shadow:0 0 0 14px rgba(255,209,102,0)}100%{box-shadow:0 0 0 0 rgba(255,209,102,0)}}
.btn .sub{display:block;font-size:9px;opacity:.6;font-weight:600;margin-top:2px}

/* ------------------------------------------------------------------ top --- */
.topbar{position:absolute;top:calc(6px + var(--safeT));left:calc(10px + var(--safeL));
  right:calc(10px + var(--safeR));display:flex;align-items:flex-start;gap:10px;pointer-events:none;z-index:4}
.money{background:var(--panel);border:1px solid var(--edge);border-radius:10px;padding:6px 10px;
  min-width:110px;backdrop-filter:blur(8px)}
.money b{font-size:18px;color:#ffd166;display:block;line-height:1.05}
.money span{font-size:10px;color:var(--dim)}
.hqs{flex:1;display:flex;flex-direction:column;gap:4px;max-width:280px;margin:0 auto}
.hqrow{display:flex;align-items:center;gap:6px;font-size:10px;color:var(--dim)}
.bar{flex:1;height:7px;border-radius:4px;background:rgba(0,0,0,.55);overflow:hidden;
  border:1px solid rgba(120,180,255,.18)}
.bar i{display:block;height:100%;transition:width .25s linear}
.clock{background:var(--panel);border:1px solid var(--edge);border-radius:10px;padding:6px 9px;font-size:12px}

/* -------------------------------------------------------------- minimap --- */
.minimap{position:absolute;top:calc(6px + var(--safeT));right:calc(10px + var(--safeR));
  width:132px;height:83px;border:1px solid var(--edge);border-radius:8px;background:rgba(4,8,14,.8);
  z-index:4;pointer-events:none}

/* --------------------------------------------------------------- status --- */
.status{position:absolute;left:calc(10px + var(--safeL));bottom:calc(10px + var(--safeB));
  width:132px;display:flex;flex-direction:column;gap:3px;pointer-events:none;z-index:4;opacity:.92}
.status .row{display:flex;align-items:center;gap:5px;font-size:9px;color:var(--dim)}
.status .bar{height:6px}

/* ---------------------------------------------------------- carried chip --- */
.carry{position:absolute;left:50%;transform:translateX(-50%);bottom:calc(12px + var(--safeB));
  display:flex;align-items:center;gap:8px;background:var(--panel);border:1px solid rgba(53,224,200,.5);
  border-radius:12px;padding:7px 10px;z-index:6;backdrop-filter:blur(8px)}
.carry .name{font-size:12px}
.carry .ord{font-size:10px;color:#ffd166}
.carry button{font:inherit;font-size:10px;padding:6px 9px;border-radius:8px;
  border:1px solid var(--edge);background:rgba(53,224,200,.16);color:var(--ink)}

/* --------------------------------------------------------------- panels --- */
.sheet{position:absolute;inset:0;background:rgba(3,6,12,.82);backdrop-filter:blur(10px);
  -webkit-backdrop-filter:blur(10px);z-index:20;display:flex;flex-direction:column;
  padding:calc(12px + var(--safeT)) calc(14px + var(--safeR)) calc(12px + var(--safeB)) calc(14px + var(--safeL));
  overflow:hidden}
.sheet h2{font-size:13px;letter-spacing:.16em;color:var(--dim);font-weight:700;margin-bottom:8px;
  display:flex;justify-content:space-between;align-items:center}
.sheet h2 button{font:inherit;font-size:11px;padding:6px 12px;border-radius:8px;border:1px solid var(--edge);
  background:rgba(255,255,255,.06);color:var(--ink)}
.grid{flex:1;display:grid;grid-template-columns:repeat(auto-fit,minmax(128px,1fr));gap:8px;
  align-content:start;overflow-y:auto;-webkit-overflow-scrolling:touch}
.card{border:1px solid var(--edge);border-radius:10px;background:rgba(10,16,28,.85);padding:9px;
  display:flex;flex-direction:column;gap:3px;text-align:left;color:var(--ink);font:inherit;min-height:76px}
.card:disabled{opacity:.34}
.card.down{background:rgba(53,224,200,.2)}
.card .t{font-size:12px;font-weight:700;display:flex;justify-content:space-between;gap:6px}
.card .c{color:#ffd166;font-size:11px}
.card .b{font-size:9.5px;color:var(--dim);line-height:1.35;font-weight:500}
.card .stats{font-size:9px;color:rgba(120,180,255,.75);display:flex;gap:7px;flex-wrap:wrap}

/* ---------------------------------------------------------------- coach --- */
.coach{position:absolute;top:calc(72px + var(--safeT));left:50%;transform:translateX(-50%);
  display:flex;align-items:center;gap:10px;max-width:min(560px,calc(100vw - 220px));
  background:rgba(8,13,22,.93);border:1px solid rgba(255,209,102,.5);border-radius:12px;
  padding:9px 12px;z-index:9;backdrop-filter:blur(8px);box-shadow:0 6px 24px rgba(0,0,0,.45)}
.coach.ok{border-color:rgba(93,240,138,.75)}
.coach .n{font-size:10px;color:#ffd166;letter-spacing:.1em;flex:none}
.coach.ok .n{color:var(--t0)}
.coach .t{font-size:12px;line-height:1.45;font-weight:500}
.coach button{font:inherit;font-size:10px;padding:6px 9px;border-radius:8px;flex:none;
  border:1px solid var(--edge);background:rgba(255,255,255,.06);color:var(--dim)}

/* --------------------------------------------------------------- toasts --- */
.toasts{position:absolute;top:calc(74px + var(--safeT));left:0;right:0;display:flex;
  flex-direction:column;align-items:center;gap:4px;pointer-events:none;z-index:8}
.toast{background:rgba(8,13,22,.9);border:1px solid var(--edge);border-radius:8px;padding:5px 11px;
  font-size:11px;animation:rise .3s ease}
@keyframes rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}

/* ------------------------------------------------------------ end / menu --- */
.center{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;
  justify-content:center;gap:14px;background:rgba(3,6,12,.9);z-index:30;text-align:center;
  padding:calc(20px + var(--safeT)) 20px calc(20px + var(--safeB))}
.center h1{font-size:34px;letter-spacing:.24em;font-weight:800}
.center h1.win{color:var(--t0)} .center h1.lose{color:var(--t1)}
.center p{font-size:12px;color:var(--dim);max-width:460px;line-height:1.6}
.center .tag{font-size:10px;letter-spacing:.34em;color:var(--dim)}
.center button{font:inherit;font-size:13px;font-weight:700;padding:13px 26px;border-radius:12px;
  border:1px solid var(--edge);background:rgba(53,224,200,.18);color:var(--ink);min-width:200px}
.center button.ghost{background:rgba(255,255,255,.05)}
.center .stats{display:flex;gap:18px;font-size:11px;color:var(--dim)}
.rot{position:absolute;inset:0;display:none;align-items:center;justify-content:center;
  background:#05070d;z-index:40;font-size:13px;color:var(--dim);text-align:center;padding:24px}
`;
