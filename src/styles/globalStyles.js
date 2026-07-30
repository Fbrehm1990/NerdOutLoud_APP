import { C } from "../lib/constants.js";

export const GLOBAL_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Karla:ital,wght@0,400;0,500;0,700;1,400&family=Courier+Prime:wght@400;700&display=swap');
.nol-root { min-height: 100vh; background: radial-gradient(ellipse 90% 55% at 50% -5%, ${C.glow} 0%, ${C.bg} 62%); font-family: 'Karla', sans-serif; color: ${C.text}; }
.nol-root * { box-sizing: border-box; }
@keyframes nol-chase { 0%, 100% { opacity: 0.25; box-shadow: none; } 50% { opacity: 1; box-shadow: 0 0 10px ${C.amber}, 0 0 20px rgba(255,182,39,0.4); } }
@keyframes nol-stamp { 0% { transform: rotate(-14deg) scale(2.1); opacity: 0; } 60% { transform: rotate(-8deg) scale(0.95); opacity: 1; } 100% { transform: rotate(-8deg) scale(1); opacity: 1; } }
@keyframes nol-rise { from { transform: translateY(10px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
@keyframes nol-flicker { 0%, 92%, 100% { opacity: 1; } 94% { opacity: 0.55; } 96% { opacity: 0.9; } }
@keyframes nol-pulse { 0%, 100% { opacity: 0.5; } 50% { opacity: 1; } }
@keyframes nol-slide { from { transform: translateX(100%); } to { transform: translateX(0); } }
.nol-bulb { width: 8px; height: 8px; border-radius: 50%; background: ${C.amber}; animation: nol-chase 1.6s infinite; }
.nol-fade { animation: nol-rise 0.35s ease both; }
.nol-btn { font-family: 'Bebas Neue', sans-serif; font-size: 18px; letter-spacing: 2.5px; background: ${C.amber}; color: #14120A; border: none; border-radius: 6px; padding: 10px 26px 8px; cursor: pointer; transition: all 0.15s ease; }
.nol-btn:hover { background: ${C.amberSoft}; box-shadow: 0 0 16px rgba(255,182,39,0.4); transform: translateY(-1px); }
.nol-btn:active { transform: translateY(0); }
.nol-btn:disabled { background: ${C.panelHi}; color: ${C.faint}; cursor: default; box-shadow: none; transform: none; }
.nol-btn.big { font-size: 24px; padding: 14px 44px 11px; letter-spacing: 4px; box-shadow: 0 0 24px rgba(255,182,39,0.3); }
.nol-ghost { font-family: 'Bebas Neue', sans-serif; font-size: 18px; letter-spacing: 2.5px; background: transparent; color: ${C.muted}; border: 1px solid ${C.edge}; border-radius: 6px; padding: 10px 26px 8px; cursor: pointer; transition: all 0.15s ease; }
.nol-ghost:hover { border-color: ${C.red}; color: ${C.red}; }
.nol-danger-link { color: ${C.faint}; cursor: pointer; font-size: 13px; transition: color 0.15s; }
.nol-danger-link:hover { color: ${C.red}; }
.nol-ticket { position: relative; flex: 1; min-width: 210px; max-width: 300px; cursor: pointer; background: ${C.paper}; border: none; border-radius: 8px; padding: 0; text-align: center; transition: transform 0.15s ease, box-shadow 0.15s ease; box-shadow: 0 4px 14px rgba(0,0,0,0.45); }
.nol-ticket:hover { transform: translateY(-4px) rotate(-0.5deg); box-shadow: 0 12px 28px rgba(0,0,0,0.6), 0 0 22px rgba(255,182,39,0.18); }
.nol-input { background: ${C.bg}; border: 1px solid ${C.edge}; border-radius: 6px; color: ${C.text}; padding: 10px 12px; font-size: 14px; font-family: 'Karla', sans-serif; width: 100%; transition: border-color 0.15s; }
.nol-input:focus { outline: none; border-color: ${C.amber}; }
.nol-row { transition: background 0.15s; }
.nol-row:hover { background: ${C.panelHi}; }
.nol-source { flex: 1; min-width: 140px; cursor: pointer; text-align: left; background: ${C.panel}; border: 1px solid ${C.edge}; border-radius: 10px; padding: 12px 14px; transition: all 0.15s ease; font-family: 'Karla', sans-serif; }
.nol-source:hover { border-color: ${C.edgeHi}; transform: translateY(-2px); }
.nol-source.on { border-color: ${C.amber}; background: ${C.panelHi}; box-shadow: 0 0 20px rgba(255,182,39,0.18); }
.nol-chip { font-family: 'Karla', sans-serif; font-size: 13px; font-weight: 700; padding: 6px 14px; border-radius: 999px; border: 1px solid ${C.edge}; background: transparent; color: ${C.muted}; cursor: pointer; transition: all 0.15s ease; }
.nol-chip:hover { border-color: ${C.edgeHi}; color: ${C.text}; }
.nol-chip.on { background: ${C.amber}; border-color: ${C.amber}; color: #14120A; }
.nol-seg { font-family: 'Bebas Neue', sans-serif; font-size: 17px; letter-spacing: 2px; padding: 8px 22px 6px; cursor: pointer; border: 1px solid ${C.edge}; background: transparent; color: ${C.muted}; transition: all 0.15s ease; }
.nol-seg:first-child { border-radius: 8px 0 0 8px; }
.nol-seg:last-child { border-radius: 0 8px 8px 0; border-left: none; }
.nol-seg.on { background: ${C.amber}; border-color: ${C.amber}; color: #14120A; }
.nol-burger { background: transparent; border: 1px solid ${C.edge}; border-radius: 8px; width: 44px; height: 40px; cursor: pointer; display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 5px; transition: border-color 0.15s; }
.nol-burger:hover { border-color: ${C.amber}; }
.nol-burger span { display: block; width: 20px; height: 2px; background: ${C.text}; border-radius: 2px; }
.nol-bell { position: relative; background: transparent; border: 1px solid ${C.edge}; border-radius: 8px; width: 40px; height: 40px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: border-color 0.15s, background 0.15s; flex-shrink: 0; }
.nol-bell:hover { border-color: ${C.amber}; background: rgba(255,182,39,0.06); }
.nol-bell.has-unread { border-color: rgba(255,182,39,0.4); }
.nol-bell-badge { position: absolute; top: -5px; right: -5px; min-width: 16px; height: 16px; border-radius: 999px; background: ${C.red}; border: 2px solid ${C.bg}; display: flex; align-items: center; justify-content: center; padding: 0 3px; font-family: 'Bebas Neue', sans-serif; font-size: 10px; letter-spacing: 0.02em; color: ${C.paper}; line-height: 1; }
.nol-menu-item { display: block; width: 100%; text-align: left; background: transparent; border: none; border-bottom: 1px solid ${C.edge}; padding: 18px 24px; cursor: pointer; transition: background 0.15s; font-family: 'Karla', sans-serif; }
.nol-menu-item:hover { background: ${C.panelHi}; }
.nol-popcorn-wrap { flex-shrink: 0; display: flex; align-items: flex-end; }
@media (max-width: 720px) { .nol-popcorn-wrap { transform: scale(0.52); transform-origin: bottom center; margin: 0 -34px; } }
input[type=range].nol-range { -webkit-appearance: none; appearance: none; height: 4px; border-radius: 2px; background: ${C.edge}; cursor: pointer; }
input[type=range].nol-range::-webkit-slider-thumb { -webkit-appearance: none; width: 24px; height: 24px; border-radius: 50%; background: ${C.amber}; border: 2px solid #14120A; box-shadow: 0 0 8px rgba(255,182,39,0.5); }
input[type=range].nol-range::-moz-range-thumb { width: 24px; height: 24px; border-radius: 50%; background: ${C.amber}; border: 2px solid #14120A; }
.nol-dual-range { position: relative; height: 22px; display: flex; align-items: center; }
.nol-dual-range .track-bg { position: absolute; left: 0; right: 0; height: 4px; border-radius: 2px; background: ${C.edge}; }
.nol-dual-range .track-fill { position: absolute; height: 4px; border-radius: 2px; background: ${C.amber}; }
.nol-dual-range input[type=range] { position: absolute; left: 0; right: 0; width: 100%; margin: 0; background: transparent; pointer-events: none; -webkit-appearance: none; appearance: none; height: 22px; touch-action: none; }
.nol-dual-range input[type=range]:active, .nol-dual-range input[type=range]:focus { z-index: 3; }
.nol-dual-range input[type=range]::-webkit-slider-runnable-track { background: transparent; height: 22px; }
.nol-dual-range input[type=range]::-moz-range-track { background: transparent; height: 22px; }
.nol-dual-range input[type=range]::-webkit-slider-thumb { pointer-events: auto; -webkit-appearance: none; width: 24px; height: 24px; border-radius: 50%; background: ${C.amber}; border: 2px solid #14120A; box-shadow: 0 0 8px rgba(255,182,39,0.5); cursor: pointer; margin-top: 0; }
.nol-dual-range input[type=range]::-moz-range-thumb { pointer-events: auto; width: 24px; height: 24px; border-radius: 50%; background: ${C.amber}; border: 2px solid #14120A; cursor: pointer; }
@media (prefers-reduced-motion: reduce) { .nol-bulb, .nol-fade { animation: none !important; } .nol-ticket:hover, .nol-btn:hover, .nol-source:hover { transform: none; } }
.nol-btn, .nol-ghost, .nol-chip, .nol-seg, .nol-source, .nol-ticket, .nol-burger, .nol-menu-item { touch-action: manipulation; -webkit-tap-highlight-color: transparent; }
@media (pointer: coarse) {
  input[type=range].nol-range { height: 6px; }
  input[type=range].nol-range::-webkit-slider-thumb { width: 26px; height: 26px; }
  input[type=range].nol-range::-moz-range-thumb { width: 26px; height: 26px; }
  .nol-dual-range input[type=range]::-webkit-slider-thumb { width: 26px; height: 26px; }
  .nol-dual-range input[type=range]::-moz-range-thumb { width: 26px; height: 26px; }
  .nol-chip { padding: 9px 16px; }
  .nol-danger-link { padding: 6px 4px; display: inline-block; }
}
@media (max-width: 640px) {
  .nol-btn.big { width: 100%; font-size: 21px; letter-spacing: 3px; padding: 14px 20px 11px; }
  .nol-source { min-width: 100%; }
  .nol-vs-row { flex-direction: column; }
  .nol-ticket { width: 100%; max-width: 100%; min-width: 0; }
  .nol-input, select.nol-input, textarea.nol-input { font-size: 16px; }
  .nol-stat-row > div { flex: 1 1 30%; min-width: 92px; padding: 10px 8px 8px; }
  .nol-media-badges { flex-basis: 100%; justify-content: flex-start !important; margin: 6px 0 0 66px; }
  .nol-filter-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .nol-filter-grid > div { min-width: 0 !important; flex: none !important; }
  .nol-filter-grid > div:last-child { grid-column: span 1; }
  .nol-howitworks { grid-template-columns: 1fr !important; }
}
@media (max-width: 480px) {
  .nol-live-label { display: none; }
}
@media (max-width: 380px) {
  .nol-media-row { padding-left: 12px !important; padding-right: 12px !important; }
  h1 { font-size: 26px !important; }
}
.nol-media-row { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.nol-media-badges { display: flex; gap: 8px; flex-shrink: 0; }
.nol-howitworks { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.nol-trend-row { display: flex; gap: 12px; overflow-x: auto; padding: 4px 2px 10px; -webkit-overflow-scrolling: touch; scrollbar-width: thin; scrollbar-color: ${C.edge} transparent; }
.nol-theater-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 16px; }
.nol-trend-card { position: relative; flex: 0 0 108px; width: 108px; background: transparent; border: none; padding: 0; cursor: pointer; text-align: left; transition: transform 0.15s ease; touch-action: manipulation; -webkit-tap-highlight-color: transparent; }
.nol-theater-overlay {
  position: absolute; inset: 0; border-radius: 6px;
  background: rgba(5,6,14,0.88); display: flex; flex-direction: column; align-items: stretch;
  justify-content: center; gap: 6px; padding: 10px; opacity: 0; pointer-events: none;
  transition: opacity 0.15s ease;
}
.nol-theater-overlay.revealed { opacity: 1; pointer-events: auto; }
@media (hover: hover) {
  .nol-theater-card:hover .nol-theater-overlay { opacity: 1; pointer-events: auto; }
}
.nol-theater-opt {
  background: ${C.panel}; border: 1px solid ${C.amber}; color: ${C.amber}; border-radius: 5px;
  padding: 7px 4px; font-size: 11px; font-weight: 700; letter-spacing: 0.05em; cursor: pointer;
  text-transform: uppercase; transition: background 0.12s ease, color 0.12s ease;
}
.nol-theater-opt:hover { background: ${C.amber}; color: #14120A; }
.nol-trend-card:hover { transform: translateY(-4px); }
.nol-avatar { flex-shrink: 0; display: flex; align-items: center; justify-content: center; border-radius: 50%; font-family: 'Bebas Neue', sans-serif; letter-spacing: 0.5px; color: #14120A; box-shadow: 0 2px 6px rgba(0,0,0,0.4); }
.nol-react-pill { font-size: 12px; border: 1px solid ${C.edge}; background: ${C.panel}; border-radius: 999px; padding: 3px 9px 1px; cursor: pointer; transition: all 0.15s ease; display: inline-flex; align-items: center; gap: 4px; }
.nol-react-pill:hover { border-color: ${C.amber}; transform: translateY(-1px); }
.nol-react-pill.mine { background: ${C.panelHi}; border-color: ${C.amber}; color: ${C.amberSoft}; }
.nol-spoiler-wrap { position: relative; cursor: pointer; border-radius: 6px; overflow: hidden; }
.nol-spoiler-blur { filter: blur(6px); user-select: none; pointer-events: none; }
.nol-spoiler-tag { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(13,15,30,0.72); font-family: 'Bebas Neue', sans-serif; font-size: 13px; letter-spacing: 0.15em; color: ${C.amberSoft}; text-transform: uppercase; }
.nol-dist-bar { display: flex; align-items: flex-end; gap: 2px; height: 34px; }
.nol-dist-col { flex: 1; background: ${C.edge}; border-radius: 2px 2px 0 0; min-height: 2px; transition: background 0.15s; }
.nol-dist-col.hot { background: ${C.amber}; }
.nol-lobby-header { position: relative; border-radius: 8px 8px 0 0; overflow: hidden; margin: -14px -16px 12px; height: 86px; }
.nol-lobby-header img { width: 100%; height: 100%; object-fit: cover; object-position: center 20%; display: block; }
.nol-lobby-header::after { content: ""; position: absolute; inset: 0; background: linear-gradient(180deg, rgba(13,15,30,0.15) 0%, ${C.bg} 96%); }
.nol-pin { border: 1px solid ${C.amber}; background: rgba(255,182,39,0.07); border-radius: 8px; padding: 10px 12px; margin-bottom: 12px; }
.nol-welcome-row { display: flex; gap: 10px; overflow-x: auto; padding: 2px 2px 8px; -webkit-overflow-scrolling: touch; scrollbar-width: thin; scrollbar-color: ${C.edge} transparent; }
.nol-welcome-card { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; background: ${C.panel}; border: 1px solid ${C.edge}; border-radius: 999px; padding: 6px 14px 6px 6px; white-space: nowrap; }
.nol-welcome-card.newest { border-color: ${C.amber}; box-shadow: 0 0 14px rgba(255,182,39,0.25); animation: nol-rise 0.4s ease both; }
.nol-chat-msgs { overflow-y: auto; padding: 12px 14px; display: flex; flex-direction: column; gap: 12px; }
.nol-chat-composer { display: flex; gap: 8px; padding: 10px 12px; border-top: 1px solid ${C.edge}; background: ${C.panelHi}; }
`;

