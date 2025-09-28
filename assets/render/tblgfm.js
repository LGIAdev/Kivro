// assets/js/render/tblgfm.js
// Normalise tout tableau ASCII/Markdown-like en Markdown GFM (texte uniquement).

export function tblToGfm(src){
  const lines = String(src).split(/\r?\n/);
  const out = [];
  let buf = [];

  const isRow = s => /^\s*\|.*\|\s*$/.test(s);
  const isSep = s => /^\s*\|?\s*:?-{3,}:?(?:\s*\|\s*:?-{3,}:?)*\s*\|?\s*$/.test(s);

  const flush = () => {
    if(!buf.length) return;
    out.push(blockToGfm(buf));
    buf = [];
  };

  for(const l of lines){
    if(isRow(l) || isSep(l)) buf.push(l);
    else { flush(); out.push(l); }
  }
  flush();
  return out.join('\n');
}

function blockToGfm(block){
  const rows = block.filter(r => /^\s*\|.*\|\s*$/.test(r));
  if(rows.length === 0) return block.join('\n');

  const parse = r => r.trim().replace(/^\|/,'').replace(/\|$/,'')
                    .split('|').map(c=>c.trim());
  const parsed = rows.map(parse);

  const maxCols = Math.max(...parsed.map(r => r.length));
  for(const r of parsed) while(r.length < maxCols) r.push('');

  const header = parsed[0].map(c => c || ' ');
  const body = parsed.slice(1);

  return [
    `| ${header.join(' | ')} |`,
    ...body.map(r => `| ${r.join(' | ')} |`)
  ].join('\n');
}
