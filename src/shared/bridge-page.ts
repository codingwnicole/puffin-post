// Server-rendered pages outside the app (sign-in confirmation, share not-found, report thanks, embeds) use the
// Writer's Desk paper look. Values mirror the tokens in src/web/redesign.css; light-dark() follows the viewer's
// system theme. These pages have a locked-down CSP (inline styles only, no web fonts), so the font stacks fall back
// to system serifs and sans-serifs.
export const BRIDGE_TOKENS = `:root{color-scheme:light dark;--paper:light-dark(#F3EEE5,#1C1A17);--sheet:light-dark(#FBF8F2,#262320);--sheet-2:light-dark(#F5EFE6,#2E2A26);--ink:light-dark(#2D2925,#EFE8DC);--ink-2:light-dark(#5C544B,#BDB3A6);--subtle:light-dark(#6B6156,#9A9084);--line:light-dark(#E3DACC,#3B3631);--accent:light-dark(#56715B,#A3C0A4);--on-accent:light-dark(#FBF8F2,#1C1A17);--focus:light-dark(#2F5F63,#9CCBCF);--lamp:light-dark(rgb(255 232 196/.7),rgb(255 196 130/.07));--e1:0 1px 2px rgb(45 41 37/.06),0 3px 10px rgb(45 41 37/.05);--e2:0 2px 4px rgb(45 41 37/.05),0 12px 26px -10px rgb(45 41 37/.24);--display:"Young Serif","Iowan Old Style","Palatino Linotype",Georgia,serif;--ui:"Figtree","Segoe UI",system-ui,-apple-system,sans-serif}
@media(prefers-color-scheme:dark){:root{--e1:0 1px 2px rgb(0 0 0/.3),0 3px 10px rgb(0 0 0/.25);--e2:0 2px 4px rgb(0 0 0/.3),0 12px 26px -10px rgb(0 0 0/.6)}}
*{box-sizing:border-box}:focus-visible{outline:2px solid var(--focus);outline-offset:3px}
.mark{width:34px;height:34px;flex:none;border-radius:10px;display:grid;place-items:center;background:var(--accent);color:var(--on-accent);font:700 12px/1 var(--ui);letter-spacing:.04em;box-shadow:inset 0 -2px 0 rgb(0 0 0/.12)}
.button{display:flex;align-items:center;justify-content:center;min-height:48px;padding:12px 18px;border:0;border-radius:10px;background:var(--accent);color:var(--on-accent);font:600 16px/1.2 var(--ui);text-decoration:none;cursor:pointer}.button:hover{filter:brightness(1.06)}`

export const BRIDGE_CSS = `${BRIDGE_TOKENS}
body{min-width:320px;min-height:100dvh;margin:0;display:grid;place-items:center;padding:24px 16px;background:radial-gradient(900px 520px at 8% -8%,var(--lamp),transparent 65%) no-repeat,var(--paper);color:var(--ink);font:16px/1.6 var(--ui)}
main{width:min(100%,32rem)}
.brand{display:flex;align-items:center;gap:10px;margin:0 0 20px 4px;color:var(--ink);font:400 17px/1.15 var(--display)}
.sheet{padding:clamp(24px,6vw,36px);border-radius:14px;background:var(--sheet);box-shadow:var(--e2)}
h1{margin:0;font:400 clamp(28px,6vw,36px)/1.15 var(--display);letter-spacing:-.01em;text-wrap:balance}
p{margin:14px 0 0;color:var(--ink-2)}
.sheet .button{width:100%;margin-top:24px}
.identity{margin-top:20px;padding:12px 14px;border-radius:10px;background:var(--sheet-2);box-shadow:inset 0 0 0 1px var(--line);color:var(--ink);overflow-wrap:anywhere}.identity strong{display:block}
.fine{font-size:14px;color:var(--subtle)}
.foot{margin:16px 4px 0;font-size:13px;color:var(--subtle);text-align:center}`

export const BRIDGE_BRAND = '<div class="brand"><span class="mark" aria-hidden="true">RP</span><span>RP Thread Buddy</span></div>'

/** A whole bridge page. `title` and `body` must already be HTML-escaped by the caller. */
export function bridgePage(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${title} &middot; RP Thread Buddy</title><style>${BRIDGE_CSS}</style></head><body><main>${BRIDGE_BRAND}<section class="sheet">${body}</section></main></body></html>`
}
