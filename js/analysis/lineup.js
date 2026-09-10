import { expose } from '../expose.js';
/* js/analysis/lineup.js — mapa de escalação / formação */
// ── Escalação provável: mapa de campo ──
// Fonte preferida: onze_provavel estruturado (Fase 1). Se não veio, DERIVA as linhas
// do TEXTO de escalação (que o modelo preenche de forma confiável) — pelo próprio
// agrupamento do texto (linhas separadas por ';') ou fatiando pela formação. Assim o
// mapa aparece mesmo quando o campo estruturado novo falha.
function _posBucket(p){
  const s=String(p||'').toLowerCase();
  if(/gol|gk|goleiro|keeper/.test(s))return 'GK';
  if(/zag|lat|lad|lae|ala|def|cb|\blb\b|\brb\b|central|terceiro/.test(s))return 'DEF';
  if(/vol|mei|mid|\bcm\b|\bdm\b|\bam\b|interior|armador/.test(s))return 'MID';
  if(/ata|pon|centroav|\bst\b|\bfw\b|wing|extremo|frente/.test(s))return 'ATA';
  return 'MID';
}
function _posShort(p){const s=String(p||'').trim().toUpperCase();return s?esc(s.slice(0,3)):'•';}
function _pitchPlayer(p){return `<div class="p-player"><div class="p-dot">${_posShort(p.posicao)}</div><div class="p-name" title="${esc(p.nome)}">${esc(p.nome)}</div></div>`;}
// Chave normalizada local: _lvKey vivia no MÓDULO pipeline-facts (não global);
// a referência nua aqui lançava ReferenceError → normalizeLineupTeam SEMPRE quebrava →
// try/catch do attachAnalysisDerived engolia → _lineups nunca montado → aba Escalação
// vazia MESMO com dados (4º assassino silencioso: MODEL_PRICE, prefill, ctSideSection, este).
function _luKey(s){return String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]+/g,' ').trim();}
// Item do banco pode chegar como STRING (schema F1) ou OBJETO {nome,posicao} em
// cards de caminhos antigos — cru no esc() viraria "[object Object]" (
// mesma família do fix de jogadores_chave/desfalques do 96/render).
function _bancoLbl(b){
  if(typeof b==='string')return b;
  if(b&&typeof b==='object')return b.nome||b.jogador||'';
  return b==null?'':String(b);
}
// Técnico NÃO entra no mapa do campo — só em pitch-meta (fora do quadrado).
function _isCoachLike(nome,pos,coachName){
  const n=String(nome||'').trim(),p=String(pos||'').trim().toLowerCase();
  if(!n)return true;
  if(/^(tec|téc|trein|coach|manager|dt)\b/.test(p)||/t[eé]cnic|treinador|coach|manager/.test(p))return true;
  if(/^\s*(t[eé]cnic[oa]s?|treinador(?:es)?|coach|manager)\b/i.test(n))return true;
  // Igualdade exata de chave (sem includes) — evita apagar jogador homônimo do técnico
  if(coachName){
    const a=_luKey(n),b=_luKey(coachName);
    if(a&&b&&a===b)return true;
  }
  return false;
}
// Fronteira canônica: limpa onze/banco/texto e monta linhas do mapa.
// Preferência (fix v1 / commit mapa): (1) rows já válidas → (2) texto da escalação
// (linhas por ';' ou fatia pela formação) → (3) onze fatiado pela formação real
// (4-2-3-1 etc., NÃO o bucket rígido GK/DEF/MID/ATA que colapsava o campo).
function normalizeLineupTeam(t){
  if(!t)return null;
  const coach=t.tecnico||'';
  const formacao=t.formacao||'';
  let onze=_filterOutCoach(Array.isArray(t.onze)?t.onze:[],coach).filter(p=>p&&p.nome);
  let rows=null;
  if(Array.isArray(t.rows)&&t.rows.length){
    rows=t.rows.map(r=>_filterOutCoach(r,coach)).filter(r=>r.length);
    if(!rows.length)rows=null;
  }
  const escalacao_str=_stripCoachFromLineupText(t.escalacao_str||'')||(t.escalacao_str||'');
  if(!rows&&escalacao_str){
    rows=_lineupRowsFromText(escalacao_str,formacao,coach);
  }
  if(!rows&&onze.length>=7){
    rows=_rowsFromOnze(onze,formacao);
  }
  const banco=_filterOutCoach((Array.isArray(t.banco)?t.banco:[]).map(x=>({nome:typeof x==='string'?x:(x&&x.nome)||textFrom(x),posicao:''})),coach).map(p=>p.nome).filter(Boolean);
  // Proveniência: fonte dos DADOS do time e da FORMAÇÃO (número),
  // propagada até o badge do pitch. Ordem de confiança: api > pesquisa > modelo > inferida.
  const fonte=t.fonte||'inferida';               // de onde veio o XI/escalação do time
  const formacaoFonte=t.formacaoFonte||(formacao?fonte:'inferida'); // de onde veio o "4-2-3-1"
  // Se montou linhas, o render usa rows (onze vazio evita o path de 4 buckets).
  return{nome:t.nome||'',formacao,tecnico:coach,banco,escalacao_str,onze:rows?[]:onze,rows,fonte,formacaoFonte};
}
// Metadados de proveniência para UI (badge + chip de formação).
const _LU_FONTE_META={
  api:{label:'confirmada',cls:'pitch-src-api'},
  pesquisa:{label:'pesquisa',cls:'pitch-src-pesq'},
  modelo:{label:'estimativa',cls:'pitch-src-mod'},
  inferida:{label:'inferida',cls:'pitch-src-inf'}
};
// Ranking de confiança (maior = melhor) — usado no pior-nível do rodapé.
const _LU_FONTE_RANK={api:3,pesquisa:2,modelo:1,inferida:0};
function _luWorseFonte(a,b){
  const ra=_LU_FONTE_RANK[a]??0,rb=_LU_FONTE_RANK[b]??0;
  return ra<=rb?(a||'inferida'):(b||'inferida');
}
function _stripCoachFromLineupText(text){
  // Remove "Técnico: Nome", "Treinador - Nome" e trechos similares do texto da escalação
  return String(text||'')
    .replace(/\b(t[eé]cnic[oa]s?|treinador(?:es)?|coach(?:es)?|manager|comiss[aã]o t[eé]cnica)\s*[:：\-–]\s*[^;|\n]*/gi,'')
    .replace(/(^|[;|])\s*(t[eé]cnic[oa]s?|treinador(?:es)?|coach)\s+[^;|]*/gi,'$1')
    .replace(/\s{2,}/g,' ')
    .replace(/;\s*;/g,';')
    .trim();
}
function _filterOutCoach(players,coachName){
  return(Array.isArray(players)?players:[]).filter(p=>{
    if(!p)return false;
    const nome=typeof p==='string'?p:(p.nome||'');
    const pos=typeof p==='object'?(p.posicao||''):'';
    return nome&&!_isCoachLike(nome,pos,coachName);
  }).map(p=>{
    if(typeof p==='string')return{nome:p,posicao:''};
    return p;
  });
}
// Formação "n-n-n(-n)": aceita separadores -, :, – (en-dash). "/" fica DE FORA de
// propósito — é o divisor de variações ("4-3-3 / 4-2-3-1") e, incluído, o match ganancioso
// atravessaria as duas formações num shape inválido. Sem flag /g → seguro reusar com .match.
const _FORM_RE=/\d(?:\s*[-:–]\s*\d){2,3}/;
function _formationGroups(f){
  // Usa só o PRIMEIRO padrão do texto — times/técnicos costumam citar variações.
  const m=String(f||'').match(_FORM_RE);
  if(!m)return null;
  const nums=m[0].match(/\d+/g);
  if(!nums||nums.length<2||nums.length>4)return null;
  const g=nums.map(Number),outfield=g.reduce((a,b)=>a+b,0);
  if(outfield<9||outfield>10)return null;
  return [1,...g]; // GK + linhas defesa→ataque
}
function _cleanName(s){
  const out=String(s||'').replace(/^\s*\d+[-\d]*\s*[:：\-–]?\s*/,'').replace(/\([^)]*\)/g,'').replace(/\[[^\]]*\]/g,'').replace(/^[·•\-–\s]+/,'').replace(/[.\s]+$/,'').trim();
  // Um slot titular inteiramente entre colchetes (ex.: "[substituto a confirmar]") não pode
  // simplesmente desaparecer — isso desalinharia o resto da escalação com a formação real.
  if(!out&&/\[[^\]]*\]/.test(String(s||'')))return 'A confirmar';
  return out;
}
// Infere a posição de cada jogador pela LINHA e pela FORMAÇÃO (rows em ordem GK→ataque):
// laterais nas pontas da defesa, zagueiros no miolo; volante na linha de meio mais baixa,
// meias acima; pontas nas laterais do ataque, centroavante no meio. Respeita posição já
// preenchida (caminho estruturado com onze_provavel). Só rotula se o 1º grupo é o goleiro.
function _assignRoles(rows){
  if(!rows||!rows.length)return rows;
  const n=rows.length;
  if(!(rows[0]&&rows[0].length===1))return rows; // shape não-padrão → mantém pontos simples
  const firstMid=2,lastMid=n-2; // faixa de linhas de meio (quando há)
  rows.forEach((line,li)=>{
    const len=line.length;
    line.forEach((p,si)=>{
      if(p.posicao)return;
      const edge=(si===0||si===len-1);
      if(li===0)p.posicao='GOL';
      else if(li===1)p.posicao=(len>=4&&edge)?'LAT':'ZAG';        // defesa
      else if(li===n-1)p.posicao=(len>=3&&edge)?'PON':'ATA';       // ataque
      else p.posicao=(lastMid>firstMid&&li===firstMid)?'VOL':'MEI';// meio (linha baixa=VOL)
    });
  });
  return rows;
}
// Retorna linhas [GK, ...defesa→ataque] de objetos {nome,posicao} a partir do texto.
// coachName opcional: remove o técnico se ele vazar no texto da escalação.
function _lineupRowsFromText(text,formacao,coachName){
  if(!text)return null;
  // Remove o segmento de banco/suplentes (o app já mostra "banco" à parte via t.banco, e nomes
  // de reserva vazariam pra última linha titular). Limita a remoção ao PRÓPRIO segmento — até o
  // próximo ';' — em vez de apagar até o fim: senão, se a fonte cita o banco ANTES do onze
  // ("Reservas: X, Y; 4-3-3: ..."), a escalação inteira depois dele seria destruída.
  let noBench=text.replace(/\b(banco|bench|suplentes|reservas)\s*:[^;]*/gi,'').trim();
  noBench=_stripCoachFromLineupText(noBench);
  // Segurança: se ainda assim a remoção esvaziou tudo, cai pro texto completo (ainda sem técnico).
  const base=noBench||_stripCoachFromLineupText(text.trim())||text.trim();
  const mkPlayer=nm=>({nome:nm,posicao:''});
  const keepName=nm=>{const c=_cleanName(nm);return c&&!_isCoachLike(c,'',coachName)?c:null;};
  // Nomes numa linha são separados por vírgula E, com frequência na imprensa pt/es, pelo
  // conectivo " e "/" y " antes do último ("Romero, Lisandro Martínez e Tagliafico") ou por "&".
  const NAME_SEP=/,|\s+[ey]\s+|\s*&\s*/i;
  const parse=(str)=>{
    if(!str)return null;
    const fMatch=str.match(_FORM_RE);
    const fUse=(formacao||(fMatch?fMatch[0].replace(/\s/g,''):'')||'').trim();
    // Tira a formação do corpo (com o ':'/'–' que costuma segui-la) pra não virar "nome".
    const clean=str.replace(new RegExp(_FORM_RE.source+'\\s*[:：\\-–]?'),' ').trim();
    const groups=_formationGroups(fUse);
    // Caso A (prioritário): o texto separa as linhas por ';' num shape VÁLIDO de escalação
    // (goleiro sozinho na 1ª linha, 10-11 no total). Essa segmentação é a formação real como
    // a FONTE escreveu, jogador a jogador — mais confiável do que fatiar pelo campo "formacao"
    // coletado à parte (os dois podem divergir e o fatiamento moveria jogador de linha).
    const segs=clean.split(/[;\n|]/).map(s=>s.trim()).filter(Boolean);
    if(segs.length>=3){
      const rows=segs.map(s=>s.split(NAME_SEP).map(keepName).filter(Boolean).map(mkPlayer)).filter(r=>r.length);
      const total=rows.reduce((a,r)=>a+r.length,0);
      if(total>=10&&total<=11&&rows[0]&&rows[0].length===1)return _assignRoles(rows);
    }
    // Caso B (fallback): nomes corridos sem estrutura de linhas → fatia pela formação real.
    const names=clean.split(new RegExp('[;]|'+NAME_SEP.source,'i')).map(keepName).filter(Boolean);
    if(names.length>=10&&names.length<=11&&groups){
      let i=0;const rows=groups.map(g=>{const r=names.slice(i,i+g).map(mkPlayer);i+=g;return r;});
      return _assignRoles(rows);
    }
    return null;
  };
  return parse(base)||(base!==text.trim()?parse(_stripCoachFromLineupText(text.trim())||text.trim()):null);
}
// Rank horizontal no mapa (ataque em cima): esquerda do ecrã = lado esquerdo do time.
// LAE/LE/LB/ponta esq. → baixo; LAD/LD/RB/ponta dir. → alto.
function _posXRank(pos){
  const s=String(pos||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  if(!s)return 50;
  if(/\b(lae|le|lb|lwb|pe|pde|lw)\b/.test(s)||/lat(?:eral)?\s*esq|esq(?:uerdo|uerda)?\s*lat/.test(s)||/ponta\s*esq|extremo\s*esq/.test(s))return 12;
  if(/\b(lad|ld|rb|rwb|pd|pod|rw)\b/.test(s)||/lat(?:eral)?\s*dir|dir(?:eito|eita)?\s*lat/.test(s)||/ponta\s*dir|extremo\s*dir/.test(s))return 88;
  if(/\b(pon|wing|extremo)\b/.test(s)){
    if(/esq|\bl\b/.test(s))return 18;
    if(/dir|\br\b/.test(s))return 82;
    return 50;
  }
  return 50;
}
// Ordena uma linha L→R no mapa. Com LAD/LAE (etc.) usa o rank; sem lados explícitos,
// mantém a ordem da fonte (já fatiada pela formação / texto).
function _orderLineL2R(line){
  if(!line||line.length<=1)return line||[];
  const ranked=line.map((p,i)=>({p,i,r:_posXRank(p&&p.posicao)}));
  if(!ranked.some(x=>x.r<=25||x.r>=75))return line;
  ranked.sort((a,b)=>a.r-b.r||a.i-b.i);
  return ranked.map(x=>x.p);
}
// Onze estruturado (ordem goleiro→ataque) → linhas reais da formação (4-2-3-1, 3-5-2…).
// Evita o bug clássico de empilhar tudo em 4 faixas GK/DEF/MID/ATA (meio vira uma linha só).
function _rowsFromOnze(onze,formacao){
  const list=(Array.isArray(onze)?onze:[]).filter(p=>p&&p.nome).slice(0,11);
  if(list.length<7)return null;
  const groups=_formationGroups(formacao);
  if(groups){
    const need=groups.reduce((a,b)=>a+b,0);
    if(list.length>=need&&list.length<=11){
      let i=0;
      const rows=groups.map(g=>{const r=list.slice(i,i+g).map(p=>({nome:p.nome,posicao:p.posicao||''}));i+=g;return r;});
      if(rows.every(r=>r.length))return _assignRoles(rows);
    }
  }
  // Sem formação: faixas finas por papel (VOL separado de MEI/armadores; ATA separado).
  const fine={GK:[],DEF:[],VOL:[],MEI:[],ATA:[]};
  list.forEach(p=>{
    const s=String(p.posicao||'').toLowerCase();
    if(/gol|gk|goleiro|keeper/.test(s))fine.GK.push(p);
    else if(/zag|lat|lad|lae|ala|def|cb|\blb\b|\brb\b|central|terceiro/.test(s))fine.DEF.push(p);
    else if(/vol|\bdm\b|mdc|trave/.test(s))fine.VOL.push(p);
    else if(/ata|pon|centroav|\bst\b|\bfw\b|wing|extremo|frente/.test(s))fine.ATA.push(p);
    else fine.MEI.push(p);
  });
  if(fine.GK.length||fine.DEF.length||fine.ATA.length){
    const rows=[fine.GK,fine.DEF,fine.VOL,fine.MEI,fine.ATA].filter(r=>r.length);
    if(rows.reduce((a,r)=>a+r.length,0)>=7)return _assignRoles(rows.map(r=>r.map(p=>({nome:p.nome,posicao:p.posicao||''}))));
  }
  // Último recurso: 1-4-3-3 se a lista já veio na ordem canônica.
  if(list.length>=10){
    const o=list.map(p=>({nome:p.nome,posicao:p.posicao||''}));
    return _assignRoles([o.slice(0,1),o.slice(1,5),o.slice(5,8),o.slice(8,11)].filter(r=>r.length));
  }
  return null;
}
function _pitchRows(rows){ // rows em ordem GK→ataque; exibe ataque em cima; L→R por lado
  return `<div class="pitch">${[...rows].reverse().map(r=>{
    if(!r||!r.length)return'';
    return`<div class="p-row">${_orderLineL2R(r).map(_pitchPlayer).join('')}</div>`;
  }).join('')}</div>`;
}
function _pitchTeam(t){
  if(!t)return '<div></div>';
  const model=buildPitchModel(t);
  const L=model.meta||{};
  const nome=esc(L.nome||'—');
  const coach=L.tecnico||'';
  let body='';
  if(model.rows&&model.rows.length){
    body=_pitchRows(model.rows);
  }else if(L.escalacao_str){
    body=`<div class="pitch-fallback">${esc(L.escalacao_str)}</div>`;
  }else{
    body=`<div class="pitch-fallback" style="color:var(--muted)">Onze provável não coletado nesta análise.</div>`;
  }
  const banco=Array.isArray(L.banco)?L.banco:[];
  // Badge de proveniência por time (PARTE X): api|pesquisa|modelo|inferida.
  const fonte=L.fonte||'inferida';
  const fMeta=_LU_FONTE_META[fonte]||_LU_FONTE_META.inferida;
  const srcBadge=`<span class="pitch-src ${fMeta.cls}" title="Origem da escalação">${fMeta.label}</span>`;
  // Chip de formação HONESTO: número só quando veio de fonte confiável (api/pesquisa).
  // 'modelo' → mostra mas marcado "não confirmada"; 'inferida' → sem chip (não inventar "4-2-3-1").
  const ff=L.formacaoFonte||'inferida';
  let formChip='';
  if(L.formacao&&(ff==='api'||ff==='pesquisa'))formChip=`<span class="pitch-form">${esc(L.formacao)}</span>`;
  else if(L.formacao&&ff==='modelo')formChip=`<span class="pitch-form pitch-form-unconf" title="Formação estimada pelo modelo, não confirmada por fonte">${esc(L.formacao)} · não confirmada</span>`;
  return `<div class="pitch-team">
    <div class="pitch-hd"><div class="tname" style="margin-bottom:0">${nome}</div>${srcBadge}${formChip}</div>
    ${body}
    ${coach?`<div class="pitch-meta">👔 Técnico: <b>${esc(coach)}</b></div>`:''}
    ${banco.length?`<div class="pitch-meta">🪑 Banco: ${banco.map(_bancoLbl).filter(Boolean).map(esc).join(' · ')}</div>`:''}
  </div>`;
}


/** Modelo único de campo: uma entrada, uma saída {rows, source}. */
function buildPitchModel(team){
  const L=normalizeLineupTeam(team)||{};
  if(Array.isArray(L.rows)&&L.rows.length)return{rows:L.rows,source:'rows',meta:L};
  if(L.escalacao_str){
    const fromText=_lineupRowsFromText(L.escalacao_str,L.formacao||'',L.tecnico||'');
    if(fromText&&fromText.length)return{rows:fromText,source:'text',meta:L};
  }
  if((L.onze||[]).length>=7){
    const fromOnze=_rowsFromOnze(L.onze,L.formacao||'');
    if(fromOnze&&fromOnze.length)return{rows:fromOnze,source:'formation',meta:L};
    // legado 4 faixas
    const buckets={GK:[],DEF:[],MID:[],ATA:[]};
    L.onze.slice(0,11).forEach(p=>buckets[_posBucket(p.posicao)].push(p));
    if(!buckets.GK.length&&!buckets.DEF.length&&!buckets.ATA.length&&buckets.MID.length>=7){
      const o=buckets.MID;buckets.GK=[o[0]];buckets.DEF=o.slice(1,5);buckets.MID=o.slice(5,8);buckets.ATA=o.slice(8,11);
    }
    const legacy=[buckets.GK,buckets.DEF,buckets.MID,buckets.ATA].filter(r=>r.length);
    if(legacy.length)return{rows:legacy,source:'legacy_buckets',meta:L};
  }
  return{rows:null,source:'empty',meta:L};
}


expose({
  buildPitchModel,
  normalizeLineupTeam,
  _rowsFromOnze,
  _orderLineL2R,
  _lineupRowsFromText,
  _pitchTeam,
  _posBucket,
  _luWorseFonte,
  _LU_FONTE_META,
});
export {
  buildPitchModel,
  normalizeLineupTeam,
  _rowsFromOnze,
  _orderLineL2R,
  _lineupRowsFromText,
  _pitchTeam,
  _posBucket,
  _luWorseFonte,
  _LU_FONTE_META,
};
