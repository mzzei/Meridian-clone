/* js/analysis/pipeline-run.js — ESM (runChat, runAnalysis, streamOnce)
 * Passo 5: intent + facts + competitions + state por import.
 * UI/API shell em call-time via _h() (não precisa de chave para carregar o módulo).
 */
import { expose } from '../expose.js';
import { host } from '../runtime.js';
import { state, setRunning } from '../state.js';
import { compLabel, COMP_ORDER } from '../comp/competitions.js';
import { routeUserIntent } from '../lib/intent.js';
import {
  gatherFacts,
  hasExplicitMatchAnchor,
  isVagueMatchQuery,
  _chatNeedsLiveData,
  _chatNeedsScoreVerification,
  fetchVerifiedMatchFacts,
  parseAnalysisJson,
  stripCites,
  buildEnrichedQuery,
  fillDataGaps,
  verifyLineupNames,
  verifyAnalysis,
} from './pipeline-facts.js';
import { attachAnalysisDerived, finalizeAnalysisPads } from './normalize.js';

function _h(name) {
  const fn = host()[name];
  if (typeof fn === 'function') return fn;
  throw new Error('[pipeline-run] host missing: ' + name);
}

// MODO CONVERSA (shell 88; içada p/ escopo de módulo anterior — o motor
// o motor headless reusa o MESMO texto): resposta SUCINTA em texto, sem card/tickets/
// listões e sem overthink. O usuário pediu conversa direta.
const CHAT_BREVITY='MODO CONVERSA — RESPOSTA SUCINTA E DIRETA:\n'
  +'- Responda em TEXTO CORRIDO curto (1–4 frases; no máx. um parágrafo). Vá direto ao ponto.\n'
  +'- Responda SÓ o que foi perguntado. NÃO gere card, tickets, tabela, JSON, seções numeradas nem listas longas.\n'
  +'- NÃO repita dados que o usuário não pediu; nada de "raciocínio em voz alta" ou autocorreção — entregue a versão final.\n'
  +'- Fundamente no que já está na conversa/dados; se faltar um dado essencial, diga em UMA linha em vez de inventar.\n'
  +'- Sem alucinação: fatos voláteis (placar, escalação, lesões) só se vierem dos dados desta conversa.';
const _CHAT_BREVITY=CHAT_BREVITY; // alias interno histórico (call sites do runChat)
// Chat = prosa. Se o modelo devolver estrutura, NUNCA despejar cru na bolha
//: detecta e tenta extrair um campo de texto legível antes de desistir.
function _chatLooksJson(s){
  const t=String(s||'').trim().replace(/^```(?:json)?\s*/i,'');
  return t.startsWith('{')||t.startsWith('[');
}
function _chatJsonToProse(s){
  // Invariante 33: parse de saída de LLM SEMPRE via parseAnalysisJson
  // (strip de cercas + repairJson). O `JSON.parse` cru anterior lançava quando o
  // modelo truncava no max_tokens e DESCARTAVA texto recuperável.
  const o=parseAnalysisJson(s);
  if(!o||typeof o!=='object')return '';
  const KEYS=['resposta','texto','text','mensagem','analise','resumo','conclusao','comentario'];
  for(const k of KEYS){
    const v=o[k];
    if(typeof v==='string'&&v.trim().length>20)return v.trim();
  }
  return '';
}
async function runChat(){
  if(state.running)return; // state.running via bridge
  const apiKey=document.getElementById('api-key-input').value.trim();
  const query=document.getElementById('match-input').value.trim();
  const atts=globalThis._attachments.slice();
  if(!query&&!atts.length){document.getElementById('match-input').focus();return;}
  const skipBubble=!!globalThis._skipNextUserBubble;globalThis._skipNextUserBubble=false;
  if(!skipBubble)_h('showUserBubble')(query,atts);
  const ta=document.getElementById('match-input');_h('taReset')(ta);if(!skipBubble)_h('clearAttachments')();
  if(!apiKey&&!_h('getWorkerUrl')()){
    _h('showAgentBubble')(_h('t')('no_key_chat'));
    return;
  }

  // ═══ GATE DE AMBIGUIDADE (cliente) ═══
  // "opinião sobre o jogo de hoje" SEM times → popup ANTES do LLM.
  // Zero suposição de partida. Zero raciocínio/scripts no chat.
  const histPeek=globalThis._chatThread.slice(-6).map(m=>m.content||'').join('\n');
  const skipVague=!!globalThis._skipVagueGateOnce;globalThis._skipVagueGateOnce=false;
  const vague=!skipVague&&isVagueMatchQuery(query)&&!atts.length
    &&!hasExplicitMatchAnchor((_h('getChatContext')()||'')+'\n'+histPeek+'\n'+query)
    &&!/\[Contexto confirmado:/i.test(query);
  if(vague){
    state.running=true;setRunBtn(true);
    globalThis._chatThread.push({role:'user',content:query});
    globalThis._chatThread.push({role:'assistant',content:'[pedido de contexto via popup]'});
    const inferredGate=_h('inferCompIdsFromText')((query||'')+'\n'+histPeek);
    const espnIdsGate=inferredGate.length?inferredGate:COMP_ORDER.slice();
    try{
      _h('startThinking')();
      const lbl=document.getElementById('thk-label');
      if(lbl)lbl.textContent='listando jogos de hoje…';
      await _h('openMatchPickerPopup')(query,espnIdsGate);
    }catch{
      _h('openContextPromptPopup')({
        question:'Qual jogo você quer analisar ou comentar?',
        options:[
          {id:'a',label:'Jogo de clube de hoje (informo times/liga)'},
          {id:'b',label:'Jogo de seleção / copa de hoje (informo times)'}
        ]
      },query);
    }finally{
      _h('stopThinking')(true);
      state.running=false;state.abort=null;setRunBtn(false);
    }
    return;
  }

  state.running=true;state.abort=new AbortController();
  document.getElementById('error-box').style.display='none';
  setRunBtn(true);
  // O thread guarda só texto (stub p/ anexos) — base64 jamais persiste no histórico.
  const histStub=atts.length?[query,...atts.map(a=>`[anexo: ${a.name}]`)].filter(Boolean).join('\n'):query;
  globalThis._chatThread.push({role:'user',content:histStub});
  // Bolha oculta desde a criação (sem flash do chip amarelo). Só thk-compact no loading.
  // Reaparece apenas se houver prosa/erro; card/popup removem a linha.
  const bubble=_h('showAgentBubble')('',{hidden:true});
  const _agentRow=bubble.closest('.msg-agent-chat');
  const _revealAgent=()=>{if(_agentRow){_agentRow.style.display='';_h('scrollChat')();}};
  _h('startThinking')();
  try{
    // Multi-liga + verificação de placar (seleções/amistosos fora do COMP_ORDER).
    const histText=globalThis._chatThread.slice(-8).map(m=>m.content||'').join('\n');
    const inferred=_h('inferCompIdsFromText')((query||'')+'\n'+histText);
    const espnIds=inferred.length?inferred:COMP_ORDER.slice();
    const needsLive=_chatNeedsLiveData(query,atts.length);
    const needsScore=_chatNeedsScoreVerification(query)||needsLive;
    const hasAnchor=hasExplicitMatchAnchor(query)||hasExplicitMatchAnchor(_h('getChatContext')()||'')||atts.length>0;
    let liveData='', scoreFacts='';
    if(needsLive||needsScore){
      const lbl=document.getElementById('thk-label');
      if(lbl)lbl.textContent='resolvendo jogo e status (ESPN)…';
      // 1) ESPN primeiro (pista estruturada)
      liveData=await _h('gatherEspnForChat')(espnIds).catch(()=>'');
      // 2) Verificador de placar SÓ com âncora clara — se vago, não deixa o Haiku "escolher" um jogo
      if(needsScore&&hasAnchor){
        if(lbl)lbl.textContent='confirmando resultado oficial (web)…';
        scoreFacts=await fetchVerifiedMatchFacts(query,apiKey,state.abort.signal,liveData).catch(()=>'');
        if(!scoreFacts){
          if(lbl)lbl.textContent='segunda passagem: full-time / resultado final…';
          const retryQ=`${query}\n\n[Instrução ao verificador: identifique o jogo mais recente compatível; confirme se está FT ou LIVE; busque "full time" / "resultado final" / scoreboard oficial — NÃO assuma placar na query.]`;
          scoreFacts=await fetchVerifiedMatchFacts(retryQ,apiKey,state.abort.signal,liveData).catch(()=>'');
        }
      }
    }
    const metaComp=inferred.length
      ? `=== COMPETIÇÕES INFERIDAS: ${inferred.map(id=>compLabel(id)).join(' · ')} ===`
      : `=== CONTEXTO: pode ser clube OU seleção (não se limite às ligas embutidas do app). ===`;
    const scoreBlock=scoreFacts
      ? `\n\n${scoreFacts}\n\nREGRA: o bloco PLACARES VERIFICADOS é a autoridade máxima. Sua opinião tática pode ser livre; o PLACAR e o STATUS do jogo (FT/LIVE) devem copiar esse bloco. Nunca diga outro placar.`
      : (needsScore&&hasAnchor?`\n\n=== AVISO DE COLETA ===\nNão foi possível montar PLACARES VERIFICADOS nesta passagem. Você DEVE usar web_search agora (2+ fontes P1) antes de afirmar qualquer placar. PROIBIDO inventar placar de memória.\n=== FIM AVISO ===`:'');
    const liveBlock=liveData
      ? `\n\n=== DADOS REAIS ESPN (placares/tabelas; se divergir de PLACARES VERIFICADOS, prevalece PLACARES VERIFICADOS) ===\n${liveData}\n=== FIM ESPN ===\n\nREGRA DURA: se houver VÁRIOS jogos no bloco ESPN e o usuário NÃO nomeou times, NÃO escolha um sozinho — responda APENAS com context_prompt listando 2 jogos concretos do bloco.`
      :'';
    const effectiveQuery=`${query||'(sem texto — analise o anexo)'}\n\n${metaComp}${scoreBlock}${liveBlock}`;
    let trimmedThread=globalThis._chatThread.length>20?globalThis._chatThread.slice(-20):globalThis._chatThread;
    if(trimmedThread.length>0&&trimmedThread[0].role!=='user')trimmedThread=trimmedThread.slice(1);
    // Mídia/dados só no turno atual (efêmeros)
    let reqMessages=trimmedThread;
    if(atts.length||liveData||scoreFacts||needsScore){
      const lastContent=atts.length?_h('buildUserContent')(effectiveQuery,atts):effectiveQuery;
      reqMessages=trimmedThread.slice(0,-1).concat([{role:'user',content:lastContent}]);
    }else{
      reqMessages=trimmedThread.slice(0,-1).concat([{role:'user',content:effectiveQuery}]);
    }
    // Chat: thinking estendido SEMPRE desligado (segurança UX — raciocínio/tool
    // monologue não pode vazar na bolha). Profundidade por modelo é só da análise padrão.
    const _chatBase=(atts.length||liveData||scoreFacts)?4500:3200;
    const _searchUses=scoreFacts?2:(hasAnchor?4:2);
    const _chatBody={model:globalThis.currentModel,max_tokens:_chatBase,
      system:[
        {type:'text',text:_h('analystSystemPrompt')(),cache_control:{type:'ephemeral'}},
        {type:'text',text:_CHAT_BREVITY}
      ],
      messages:reqMessages,stream:true,
      tools:[{type:'web_search_20250305',name:'web_search',max_uses:_searchUses}]};
    // Sonnet 5 liga adaptive thinking quando `thinking` é OMITIDO (mudança vs 4.6,
    // que rodava sem thinking) → desligar explicitamente; Opus 4.8 aceita disabled.
    // Haiku (modelo antigo): omitir = sem thinking, não enviar o campo.
    if(_noThinkModel(globalThis.currentModel))_chatBody.thinking={type:'disabled'};
    if(_h('getWorkerUrl')())_chatBody.diagnostics={previous_message_id:_lastChatId};
    const res=await fetch(_h('getApiBase')()+'/v1/messages',{
      method:'POST',
      headers:_h('getReqHeaders')(apiKey,_h('getWorkerUrl')()?['cache-diagnosis-2026-04-07']:[]),
      body:JSON.stringify(_chatBody),
      signal:state.abort.signal
    });
    _h('parseRateLimitHeaders')(res);if(!res.ok)throw new Error(`Erro ${res.status}`);
    let text='';const reader=res.body.getReader(),dec=new TextDecoder();
    // Streaming: NUNCA pinta thinking/tool noise; JSON → placeholder; prosa limpa → stream.
    let _isJson=null;
    let _isCtxProse=false;
    let _isNoise=false;
    // Status de espera fica só no thk-compact (não reabre a bolha "trabalhando…")
    const _paint=()=>{
      const lead=text.replace(/^\s+/,'');
      if(!lead)return;
      // noise interno (raciocínio/scripts) — não mostra bolha
      if(_h('isInternalModelNoise')(lead)||_h('isInternalModelNoise')(text)){
        _isNoise=true;
        if(_agentRow)_agentRow.style.display='none';
        return;
      }
      if(_isJson===null){
        _isJson=lead.startsWith('{')||/^```(?:json)?\s*\{/i.test(lead)||/"context_prompt"\s*:/.test(lead)||/"card"\s*:/.test(lead);
        if(_isJson){
          // card/json: mantém bolha oculta; thk-label indica progresso
          if(_agentRow)_agentRow.style.display='none';
          const lb=document.getElementById('thk-label');if(lb)lb.textContent='montando análise…';
        }
      }
      if(!_isJson&&!_isCtxProse&&text.length>40&&_h('detectProseContextPrompt')(text)){
        _isCtxProse=true;
        if(_agentRow)_agentRow.style.display='none';
        const lb=document.getElementById('thk-label');if(lb)lb.textContent='precisando de contexto…';
        return;
      }
      if(_isCtxProse||_isJson)return;
      // prosa: só pinta se NÃO for monólogo interno
      const clean=_h('stripInternalReasoning')(text);
      if(!clean||_h('isInternalModelNoise')(clean)){
        if(_agentRow)_agentRow.style.display='none';
        return;
      }
      _revealAgent();
      bubble.innerHTML=_h('simpleMd')(clean);_h('scrollChat')();
    };
    // (review local): decode SEM {stream:true} + split sem buffer de linha —
    // (a) acento partido entre chunks virava U+FFFD ("an�lise"; pt-BR é cheio de multibyte);
    // (b) evento SSE partido entre chunks era PERDIDO INTEIRO (a metade 1 não parseia e cai
    // no catch, a metade 2 não começa com "data:") — texto sumia da resposta em silêncio.
    // Mesmo padrão que o streamOnce já usava certo.
    let _buf='';
    while(true){
      const{done,value}=await reader.read();if(done)break;
      _buf+=dec.decode(value,{stream:true});
      const _lines=_buf.split('\n');_buf=_lines.pop()??'';
      for(const line of _lines){
        if(!line.startsWith('data:'))continue;
        const d=line.slice(5).trim();if(d==='[DONE]')continue;
        try{const j=JSON.parse(d);
          // SOMENTE text_delta vira conteúdo — thinking_delta / tool nunca entram na bolha
          if(j.type==='content_block_delta'&&j.delta?.type==='text_delta'){text+=j.delta.text;_paint();}
          // ignora thinking_delta, input_json_delta, signatures etc. de propósito
          if(j.type==='message_start'){
            if(j.message?.usage){
              globalThis.tokenState.lastIn=j.message.usage.input_tokens||0;globalThis.tokenState.sessionIn+=globalThis.tokenState.lastIn;
              const _chatCR=j.message.usage.cache_read_input_tokens||0;
              if(_chatCR>0){globalThis.tokenState.sessionCacheRead+=_chatCR;const _cP=(globalThis.MODEL_PRICE||{})[globalThis.currentModel]||(globalThis.MODEL_PRICE||{})['claude-sonnet-5']||{crs:0};globalThis.tokenState.sessionCacheSaved+=(_chatCR*(_cP.crs||0))/1e6;}
            }
            if(j.message?.id)_lastChatId=j.message.id;
            if(j.message?.diagnostics?.cache_miss_reason)console.debug('[cache-diag chat] miss:',j.message.diagnostics.cache_miss_reason.type);
          }
          if(j.type==='message_delta'&&j.usage){globalThis.tokenState.lastOut=(j.usage.output_tokens||0);globalThis.tokenState.sessionOut+=j.usage.output_tokens||0;}
        }catch{globalThis.meridianFail?.('sse-chat-parse');} // falha contada, não muda o fluxo
      }
    }
    // Pós-processamento: limpa raciocínio, extrai JSON, bloqueia suposição de jogo
    text=_h('stripInternalReasoning')(text);
    const _ctxP=_h('resolveContextPrompt')(text);
    if(_ctxP){
      const row=bubble.closest('.msg-agent-chat');if(row)row.remove();else bubble.innerHTML='';
      const lastUser=(globalThis._chatThread.length&&globalThis._chatThread[globalThis._chatThread.length-1].role==='user')
        ?globalThis._chatThread[globalThis._chatThread.length-1].content:query;
      globalThis._chatThread.push({role:'assistant',content:'[pedido de contexto via popup]'});
      _h('openContextPromptPopup')(_ctxP,lastUser);
      _h('stopThinking')(true);setTimeout(()=>{_h('updateTokenBar')();_h('updateDockTokens')();},400);
    }else{
      // CHAT = CONVERSA em TEXTO: sem "card" espalhafatoso. O caminho de card
      // estruturado (chatCardFrom/renderChatCard/cardToPlain) foi removido na decomposição
      // do monólito (26fbf9e) e derrubava o chat com "host missing: chatCardFrom" — e, além
      // do bug, o card não é o que o usuário quer aqui: resposta sucinta em prosa é o certo.
      let clean=stripCites(_h('stripInternalReasoning')(text||'')); // tags <cite> da busca nunca chegam à bolha
      // JSON no chat: o consumidor de card saiu no 88 — sem isto, um retorno
      // estruturado era DESPEJADO CRU na bolha. Tenta extrair o campo de texto; se não
      // der, pede reformulação em vez de mostrar `{...}` para o usuário.
      if(_chatLooksJson(clean)){
        const _prose=_chatJsonToProse(clean);
        clean=_prose||'';
        if(!_prose){
          _revealAgent();
          bubble.innerHTML=_h('simpleMd')('A resposta veio em formato estruturado, não em conversa. Pergunte de novo em uma frase — ex.: "esse jogo tende a ser truncado?".');
          globalThis._chatThread.push({role:'assistant',content:'[resposta estruturada descartada — pedido de reformulação]'});
          _h('stopThinking')(true);setTimeout(()=>{_h('updateTokenBar')();_h('updateDockTokens')();},1300);
          return;
        }
      }
      if(!clean||_h('isInternalModelNoise')(clean)){
        // fallback: se o modelo só vomitou raciocínio, pede contexto em vez de mostrar lixo
        if(isVagueMatchQuery(query)||needsScore){
          const row=bubble.closest('.msg-agent-chat');if(row)row.remove();else bubble.innerHTML='';
          globalThis._chatThread.push({role:'assistant',content:'[pedido de contexto via popup]'});
          await _h('openMatchPickerPopup')(query,espnIds);
        }else{
          _revealAgent();
          bubble.innerHTML=_h('simpleMd')('Não consegui montar uma resposta limpa. Reformule com times e competição (ex.: "Flamengo x Palmeiras hoje").');
          globalThis._chatThread.push({role:'assistant',content:'[resposta sanitizada — pedido de reformulação]'});
        }
      }else{
        // Gate de suposição (invariante 18) — restaurado no caminho de PROSA:
        // pergunta vaga + resposta que nomeia um confronto/placar específico = o agente
        // escolheu o jogo sozinho → popup de confirmação, não renderiza a suposição.
        const _presup=_h('cardPresupposedVagueMatch')(clean,query);
        if(_presup){
          const row=bubble.closest('.msg-agent-chat');if(row)row.remove();else bubble.innerHTML='';
          globalThis._chatThread.push({role:'assistant',content:'[pedido de contexto via popup]'});
          _h('openContextPromptPopup')(_presup,query);
        }else{
          _revealAgent();
          bubble.innerHTML=_h('simpleMd')(clean);
          globalThis._chatThread.push({role:'assistant',content:clean});
        }
      }
      _h('stopThinking')(true);setTimeout(()=>{_h('updateTokenBar')();_h('updateDockTokens')();},1300);
    }
  }catch(e){
    _h('stopThinking')(false);
    _revealAgent();
    if(e?.name==='AbortError')bubble.innerHTML='<em>Parado.</em>';
    else bubble.innerHTML=_h('simpleMd')('Erro: '+e.message);
    globalThis._chatThread.pop();
  }finally{state.running=false;state.abort=null;setRunBtn(false);}
}

// Flexible analyst persona — multi-campeonato + double-check de contexto
/* prompts: analystSystemPrompt → js/analysis/prompts.js */

// Diagnóstico visível no rodapé do modo simplificado: shell + motivo da
// queda — o print do usuário passa a conter tudo que é preciso para depurar.
function _fallbackDiagLine(){
  try{
    const lf=globalThis._lastAnalysisFail;
    const shell=globalThis.SHELL_VERSION||'?';
    if(!lf)return `<br><span style="opacity:.7">shell ${shell} · sem diagnóstico registrado</span>`;
    const det=String(lf.msg||lf.sample||'').replace(/</g,'&lt;').slice(0,200);
    return `<br><span style="opacity:.7">shell ${shell} · diagnóstico [${lf.stage}]: ${det}</span>`;
  }catch{return'';}
}
function showFallbackCard(query){
  const ts=new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
  const el=document.createElement('div');
  el.innerHTML=`<div class="a-card">
    <div class="a-hdr">
      <div class="a-agent"><div class="a-ball a-ball-plain">${_h('brandStar')()}</div></div>
      <div class="a-hdr-r"><span class="a-ts">${ts}</span></div>
    </div>
    <div class="a-subtitle">Análise em texto · modo simplificado</div>
    <div class="a-title">${_h('esc')(query||'Análise').slice(0,80)}</div>
    <div class="a-tc" style="padding:1rem 1.25rem;line-height:1.6"><span class="ldot" style="display:inline-block;margin:4px"></span></div>
    <div class="disc">Gerada em texto livre porque o relatório estruturado não pôde ser montado nesta resposta. Pode ser exportada normalmente; para o relatório de 7 abas, tente de novo.${_fallbackDiagLine()}</div>
  </div>`;
  const card=el.firstElementChild;
  card.dataset.hid='fb'+Date.now().toString(36);
  document.getElementById('empty-state').style.display='none';
  document.getElementById('conversation').appendChild(card);
  _h('scrollChat')();
  return card.querySelector('.a-tc');
}
// Modelos que ligam adaptive thinking quando `thinking` é OMITIDO (Sonnet 5+):
// nesses, enviar {type:'disabled'} explícito. Modelos antigos (Haiku 4.5): omitir
// já significa sem thinking — não enviar o campo (evita 400 em modelos que não o aceitam).
function _noThinkModel(m){return /claude-sonnet-5/.test(m||'');}
// THINKING NA F2: REMOVIDO anterior (era opt-in anterior–97). Motivo: o
// o acesso de API usado recusou TODAS as gramáticas de structured outputs da F2 com
// "compiled grammar is too large" — o schema ingênuo (93), o compacto (93), o
// deduplicado com $defs (96) e o agrupado com topo de 5 props (97). Sem gramática,
// thinking na F2 é proibido (desastre de prosa anterior/71). NÃO REINTRODUZIR
// sem a API elevar o limite de gramática. Limpeza do memo antigo:
try{localStorage.removeItem('meridian_f2_grammar_blocked');}catch{}
// Sonnet 5 REJEITA prefill de assistant (400 real 07/2026: "This model does not
// support assistant message prefill. The conversation must end with a user
// message."). Haiku 4.5 / Opus 4.8 aceitam. Há auto-cura no loop da Fase 2 para
// modelos futuros que rejeitem sem estarem listados aqui.
// PREFILL: removido em Sonnet 5, Opus 4.6/4.7/4.8, Sonnet 4.6 e Fable 5 — todos
// devolvem 400 ("does not support assistant message prefill"; erro real do usuário
// anterior com Sonnet 5). Só Haiku 4.5 (e modelos anteriores) ainda aceitam.
// Substituto oficial nos modelos novos = structured outputs (output_config.format).
function _prefillOk(m){return /claude-haiku/.test(m||'');}
async function conversationalFallback(query,apiKey,reqHeaders,signal){
  const ctx=getTournamentCtxString?_h('getTournamentCtxString')():'';
  const bubble=showFallbackCard(query);
  const res=await fetch(_h('getApiBase')()+'/v1/messages',{
    method:'POST',
    headers:reqHeaders,
    body:JSON.stringify({model:globalThis.currentModel,max_tokens:3500,
      system:[{type:'text',text:_h('analystSystemPrompt')(),cache_control:{type:'ephemeral'}}],
      messages:[{role:'user',content:`DATA: ${_h('currentDateFull')()}${ctx?`\n\nContexto do torneio:\n${ctx}`:''}\n\n${query}\n\n(Formato desta resposta: TEXTO CORRIDO analítico, sem JSON — este é o modo simplificado. Escreva em VERSÃO FINAL revisada: sem autocorreções no meio da frase, sem hesitação, sem raciocínio em voz alta.)`}],
      ...(_noThinkModel(globalThis.currentModel)?{thinking:{type:'disabled'}}:{}),
      stream:true}),
    signal
  });
  _h('parseRateLimitHeaders')(res);
  if(!res.ok){const e=await res.json().catch(()=>({}));throw new Error(e.error?.message||`Erro ${res.status}`);}
  let text='';const reader=res.body.getReader(),dec=new TextDecoder();
  let _buf=''; // mesmo fix de UTF-8 + evento partido do runChat (ver comentário lá)
  while(true){
    const{done,value}=await reader.read();if(done)break;
    _buf+=dec.decode(value,{stream:true});
    const _lines=_buf.split('\n');_buf=_lines.pop()??'';
    for(const line of _lines){
      if(!line.startsWith('data:'))continue;
      const d=line.slice(5).trim();if(d==='[DONE]')continue;
      try{const j=JSON.parse(d);
        if(j.type==='content_block_delta'&&j.delta?.type==='text_delta'){text+=j.delta.text;bubble.innerHTML=_h('simpleMd')(text);_h('scrollChat')();}
        if(j.type==='message_start'&&j.message?.usage){globalThis.tokenState.lastIn=j.message.usage.input_tokens||0;globalThis.tokenState.sessionIn+=globalThis.tokenState.lastIn;}
        if(j.type==='message_delta'&&j.usage){globalThis.tokenState.lastOut=j.usage.output_tokens||0;globalThis.tokenState.sessionOut+=j.usage.output_tokens||0;}
      }catch{globalThis.meridianFail?.('sse-chat-parse');}
    }
  }
  if(!text)throw new Error('sem resposta');
  globalThis._chatThread.push({role:'user',content:query});
  globalThis._chatThread.push({role:'assistant',content:text});
  setTimeout(()=>{_h('updateTokenBar')();_h('updateDockTokens')();},1300);
  return text;
}

// ─── Main analysis ────────────────────────────────────────────────────────
function toggleRun(){
  if(state.running){cancelAnalysis();return;}
  const q=document.getElementById('match-input').value.trim();
  const route=routeUserIntent(q,{hasAttachments:!!(globalThis._attachments&&globalThis._attachments.length)});
  if(route.mode==='need_teams'){
    _h('toast')('Para análise completa, diga os times: ex. Flamengo x Palmeiras');
    document.getElementById('match-input').focus();
    return;
  }
  if(route.mode==='analysis'){
    if(route.reason==='explicit_full')_h('toast')('Gerando análise padrão (7 abas)…');
    runAnalysis();
    return;
  }
  runChat();
}
function openHelpAnalysis(){
  const ov=document.getElementById('help-analysis-ov');
  if(ov){ov.style.display='flex';ov.setAttribute('aria-hidden','false');}
}
function closeHelpAnalysis(e){
  if(e&&e.target&&e.target!==document.getElementById('help-analysis-ov')&&!e.target.closest?.('.help-x'))return;
  const ov=document.getElementById('help-analysis-ov');
  if(ov){ov.style.display='none';ov.setAttribute('aria-hidden','true');}
}
function cancelAnalysis(){if(state.running&&state.abort){try{state.abort.abort();}catch(e){}}}
function setRunBtn(running){
  const b=document.getElementById('run-btn');
  b.classList.toggle('i-stop',running);
  if(running)b.textContent=_h('t')('btn_stop');
  else b.textContent=(globalThis._attachments.length||globalThis._chatThread.length>0)?_h('t')('btn_send'):_h('t')('btn_analyze');
}

// Condensa a análise estruturada num texto curto para servir de MEMÓRIA em follow-ups
// de chat (grounding sem re-gastar tokens de coleta). Mantém os fatos-chave, não os
// fundamentos longos de cada ticket.
function _analysisSummaryForThread(d){
  if(!d||typeof d!=='object')return 'Análise estruturada gerada nesta conversa.';
  const L=[],tm=d.mandante||{},tv=d.visitante||{};
  L.push(`[ANÁLISE ESTRUTURADA JÁ ENTREGUE NESTA CONVERSA — ${d.partida||'partida'}${d.fase?' · '+d.fase:''}${d.data_hora?' · '+d.data_hora:''}${d.sede?' · '+d.sede:''}]`);
  if(tm.nome||tv.nome){
    L.push(`${tm.nome||'Mandante'}: posição ${tm.ranking_fifa||'?'}; forma ${tm.forma_recente||'?'}; xG ${tm.xg_marcado??'?'}/${tm.xg_sofrido??'?'}; escalação ${tm.escalacao||'?'}; desfalques ${(tm.desfalques||[]).map(textFrom).filter(Boolean).join(', ')||'nenhum'}.`);
    L.push(`${tv.nome||'Visitante'}: posição ${tv.ranking_fifa||'?'}; forma ${tv.forma_recente||'?'}; xG ${tv.xg_marcado??'?'}/${tv.xg_sofrido??'?'}; escalação ${tv.escalacao||'?'}; desfalques ${(tv.desfalques||[]).map(textFrom).filter(Boolean).join(', ')||'nenhum'}.`);
  }
  const tcm=d.tecnico_mandante||{},tcv=d.tecnico_visitante||{};
  if(tcm.nome||tcv.nome)L.push(`Técnicos: ${tcm.nome||'?'} (${tcm.formacao||'?'}, ${tcm.filosofia||''}) x ${tcv.nome||'?'} (${tcv.formacao||'?'}, ${tcv.filosofia||''}).`);
  if(d.lambda)L.push(`Lambdas (gols esperados): ${tm.nome||'mandante'} ${d.lambda.home_mid??'?'}, ${tv.nome||'visitante'} ${d.lambda.away_mid??'?'}.`);
  if(Array.isArray(d.eventos_provaveis)&&d.eventos_provaveis.length)L.push('Eventos prováveis: '+d.eventos_provaveis.slice(0,6).map(e=>`${e.evento} ${Math.round((e.probabilidade||0)*100)}%`).join('; ')+'.');
  if(Array.isArray(d.sugestoes_ticket)&&d.sugestoes_ticket.length)L.push('Tickets: '+d.sugestoes_ticket.slice(0,6).map(x=>`${x.descricao} (${Math.round((x.probabilidade||0)*100)}%, ${x.confianca||''})`).join('; ')+'.');
  if(Array.isArray(d.fatores_decisivos)&&d.fatores_decisivos.length)L.push('Fatores decisivos: '+d.fatores_decisivos.slice(0,5).map(textFrom).filter(Boolean).join('; ')+'.');
  if(d.confronto_tatico&&d.confronto_tatico.conclusao)L.push('Síntese tática: '+d.confronto_tatico.conclusao);
  if(Array.isArray(d.lacunas)&&d.lacunas.length)L.push('Lacunas conhecidas: '+d.lacunas.slice(0,4).map(textFrom).filter(Boolean).join('; ')+'.');
  L.push('(Base factual desta partida — use como memória para perguntas de acompanhamento; não repita a coleta se a resposta já estiver aqui.)');
  return L.join('\n');
}
async function runAnalysis(){
  if(state.running)return;
  const apiKey=document.getElementById('api-key-input').value.trim();
  if(!apiKey&&!_h('getWorkerUrl')()){
    const q=document.getElementById('match-input').value.trim();
    _h('showUserBubble')(q);_h('taReset')(document.getElementById('match-input'));
    _h('showAgentBubble')(_h('t')('no_key_analyze'));
    return;
  }
  let query=document.getElementById('match-input').value.trim();
  if(!query){document.getElementById('match-input').focus();return;}
  const skipBubble=!!globalThis._skipNextUserBubble;globalThis._skipNextUserBubble=false;

  // Competição da ANÁLISE inferida da própria query (keyword de liga OU clube —
  // shell 74). Sem isso, "Flamengo x Palmeiras" com a UI em outra liga colava a
  // tabela errada no contexto e a Fase 2 travava pedindo esclarecimento.
  try{
    const _inf=_h('inferCompIdsFromText')(query);
    if(_inf&&_inf.length&&_inf[0]!==state.activeCompId&&typeof setAnalysisCompId==='function'){
      setAnalysisCompId(_inf[0]);
      _h('toast')('Competição da análise: '+compLabel(_inf[0]));
    }
  }catch{}

  // ═══ GATE DE CONTEXTO DA ANÁLISE ═══
  // Mesmo princípio do chat (popup ANTES do modelo — handoff §7.2 / invariante 18),
  // estendido à análise padrão: confronto sem âncora em jogo REAL (agenda-união +
  // scoreboard ESPN) → popup de contexto (prévia × pós-jogo). A ambiguidade se
  // resolve com o usuário ANTES do pipeline — nunca vira prosa na Fase 2.
  const _confirmed=/\[Contexto confirmado:/i.test(query)||/^PARTIDA:/i.test(query);
  if(!_confirmed){
    try{
      // prefixo de comando ("análise completa/padrão", "relatório…") atrapalha o parse
      // de times (guarda anti-lixo) — remove antes de extrair o confronto
      const _qTeams=query.replace(/^\s*(an[aá]lise\s+(completa|padr[aã]o)|relat[oó]rio\s+completo|pipeline\s+completo)[:\s—-]*/i,'');
      const _teams=_h('parseMatchTeamsFromQuery')(_qTeams);
      if(_teams.length===2){
        const _anchor=await _h('findScheduledMatchForAnalysis')(_teams,state.activeCompId);
        if(_anchor&&_anchor.line){
          // ancora o card no jogo real — a Fase 2 não precisa supor nada
          query+='\n[Jogo identificado na agenda: '+_anchor.line+']';
        }else{
          if(!skipBubble)_h('showUserBubble')(query);
          _h('taReset')(document.getElementById('match-input'));
          globalThis._chatThread.push({role:'user',content:query});
          globalThis._chatThread.push({role:'assistant',content:'[pedido de contexto via popup]'});
          _h('openContextPromptPopup')({
            question:'Não encontrei jogo agendado ou recente entre '+_teams[0]+' e '+_teams[1]+'. Qual é o contexto da análise?',
            options:[
              {id:'previa',label:'Prévia do próximo confronto oficial em '+compLabel(state.activeCompId)},
              {id:'pos',label:'Jogo já disputado — análise pós-jogo com placar verificado'}
            ]
          },query);
          globalThis._ctxResumeMode='analysis'; // popup reenvia para runAnalysis
          return;
        }
      }
    }catch{}
  }

  state.abort=new AbortController();state.pendingQuery=query;
  if(typeof setRunning==='function')setRunning(true,state.abort,query);else state.running=true;
  document.getElementById('error-box').style.display='none';
  setRunBtn(true);
  const ks=document.getElementById('key-status');ks.textContent='Analisando…';ks.style.color='var(--muted)';

  _h('taReset')(document.getElementById('match-input'));
  if(!skipBubble)_h('showUserBubble')(query); // reenvio pós-popup não duplica a bolha
  _h('startThinking')();

  const effort=globalThis.modelProfile(); // {label,budget,searches} — perfil por modelo
  // diagnostics + beta cache-diagnosis são internos do proxy; em modo browser direto quebram o CORS → só com Worker
  const reqHeaders=_h('getReqHeaders')(apiKey,_h('getWorkerUrl')()?['cache-diagnosis-2026-04-07']:[]);

  let finalText='',lastIn=0,lastOut=0,lastCacheCreated=0,lastCacheRead=0;

  try{
    // ── Fase 1: Haiku coleta fatos via web_search ─────────────────────────
    _h('updateThinkingToks')({status:'Coleta estruturada…',phase:1});
    let rawFacts=null,p1in=0,p1out=0;
    try{
      const r1=await gatherFacts(query,apiKey,state.abort.signal,(upd)=>_h('updateThinkingToks')({...upd,phase:1}),effort.searches??1);
      rawFacts=r1.rawFacts;p1in=r1.inTokens;p1out=r1.outTokens;
      // Anti-fantasma: status só com fontes ativas (não lista vazios)
      if(r1.statusHuman)_h('updateThinkingToks')({status:r1.statusHuman,phase:1});
    }catch(e1){
      if(e1.message==='cancelled'||e1.name==='AbortError')throw e1;
      // Diagnóstico Fase 1: erro de API/rede na coleta — antes morria mudo
      try{globalThis._lastAnalysisFail={ts:Date.now(),stage:'fase1-error',model:globalThis.currentModel,msg:String(e1&&e1.message||e1).slice(0,400)};console.warn('[analysis-fail] fase1-error',globalThis._lastAnalysisFail);}catch{}
      _h('updateThinkingToks')({status:'Pesquisa falhou, analisando diretamente…',phase:1});
    }
    globalThis.tokenState.sessionIn+=p1in;globalThis.tokenState.sessionOut+=p1out;
    globalThis.tokenState.sessionIn_p1+=p1in;globalThis.tokenState.sessionOut_p1+=p1out;
    _thkP1Toks=p1in+p1out;

    // Portão de completude: preenche dados-chave faltantes (stats de titulares citados
    // E posição na tabela) — custo zero se a coleta já veio completa; senão, UMA
    // busca-alvo Haiku + web_search cobrindo os dois. Antes do portão: se a coleta
    // regrediu a STRINGS em jogadores_chave (ex.: auto-cura desligou structured outputs),
    // coage cada nome a objeto {nome} — o portão então detecta os stats vazios e busca.
    if(rawFacts){
      try{[rawFacts.mandante,rawFacts.visitante].filter(Boolean).forEach(tm=>{
        if(Array.isArray(tm.jogadores_chave))tm.jogadores_chave=tm.jogadores_chave.map(p=>typeof p==='string'?{nome:p}:p);
      });}catch(_){}
      const g=await fillDataGaps(rawFacts,apiKey,state.abort.signal,(upd)=>_h('updateThinkingToks')({...upd,phase:1}));
      globalThis.tokenState.sessionIn+=g.inTokens;globalThis.tokenState.sessionOut+=g.outTokens;
      globalThis.tokenState.sessionIn_p1+=g.inTokens;globalThis.tokenState.sessionOut_p1+=g.outTokens;
      _thkP1Toks+=g.inTokens+g.outTokens;
      // Portão anti-alucinação: cruza cada nome da escalação com busca fresca e escova os
      // comprovadamente fora do elenco ANTES da Fase 2 — a escalação errada não chega ao render.
      const lv=await verifyLineupNames(rawFacts,apiKey,state.abort.signal,(upd)=>_h('updateThinkingToks')({...upd,phase:1}));
      globalThis.tokenState.sessionIn+=lv.inTokens;globalThis.tokenState.sessionOut+=lv.outTokens;
      globalThis.tokenState.sessionIn_p1+=lv.inTokens;globalThis.tokenState.sessionOut_p1+=lv.outTokens;
      _thkP1Toks+=lv.inTokens+lv.outTokens;
    }

    // ── Modo PÓS-JOGO: placar sacro VERIFICADO antes da Fase 2 ──
    // Escolha "jogo já disputado" no gate → o card abre com placar do verificador
    // (fetchVerifiedMatchFacts, mesmo do chat) — nunca placar inferido pelo modelo.
    const _posJogo=/\[Contexto confirmado:[^\]]*(p[oó]s[\s-]?jogo|j[aá]\s+disputado)/i.test(query);
    let _scoreBlock='';
    if(_posJogo){
      _h('updateThinkingToks')({status:'Verificando placar oficial…',phase:1});
      _scoreBlock=await fetchVerifiedMatchFacts(query,apiKey,state.abort.signal,'').catch(()=>'');
    }

    // ── Fase 2: modelo escolhido analisa (sem ferramentas se fatos OK) ────
    _h('updateThinkingToks')({status:'Raciocinando…',phase:2});
    const useEnriched=!!rawFacts;
    const ctx=useEnriched?_h('getTournamentCtxString')():'';
    const finalQuery=(useEnriched?buildEnrichedQuery(query,rawFacts,ctx):query)
      +(_scoreBlock?'\n\n'+_scoreBlock:'')
      +(_posJogo?'\n[MODO PÓS-JOGO: o jogo já foi disputado — preencha contexto_analise="pos_jogo" e siga a regra de pós-jogo do prompt.]':'');
    const sysText=useEnriched?_h('getSystemPromptPhase2')():_h('getSystemPrompt')();
    const memCtx=await _h('fetchMemoryContext')();
    // Teto generoso: o JSON estruturado cheio passa de 6k tokens e truncava (→ fallback).
    // Cobra-se pelo uso real, não pelo teto, então elevar não aumenta custo. Soma-se o
    // budget de raciocínio porque thinking consome desse mesmo teto.
    const baseBody={model:globalThis.currentModel,max_tokens:9000,system:[{type:'text',text:sysText,cache_control:{type:'ephemeral'}}]};
    if(_h('getWorkerUrl')())baseBody.diagnostics={previous_message_id:_lastAnalysisId};
    if(!useEnriched)baseBody.tools=[{type:'web_search_20250305',name:'web_search',max_uses:4}];
    // Thinking na F2: REMOVIDO — ver nota em _noThinkModel. A F2 roda
    // SEMPRE no caminho provado: sem thinking (disabled explícito no Sonnet 5),
    // prompt-contrato + parseAnalysisJson, prefill '{' onde o modelo aceita.
    if(_noThinkModel(globalThis.currentModel)){
      baseBody.thinking={type:'disabled'};
    }
    const messages=[{role:'user',content:`DATA: ${_h('currentDateFull')()}${memCtx}\n\nAnalise esta partida/contexto de ${compLabel(state.activeCompId)} e retorne APENAS o JSON estruturado: ${finalQuery}${_h('contextBlock')()}`}];
    // PREFILL '{': com thinking OFF e sem tools, pré-preencher o assistant
    // com "{" OBRIGA a API a continuar o objeto — prosa/recusa ("o jogo ainda não
    // aconteceu…") fica estruturalmente impossível. Só no caminho enriquecido (sem
    // tools; prefill + tool_use não combinam). Comprovado: ainda caía em
    // prosa mesmo com a regra ENTREGA OBRIGATÓRIA no prompt.
    let _prefill=useEnriched&&(!baseBody.thinking||baseBody.thinking.type==='disabled')&&_prefillOk(globalThis.currentModel);
    if(_prefill)messages.push({role:'assistant',content:'{'});
    let _newAnalysisId=null;

    for(let iter=0;iter<10;iter++){
      let _r2,_netAttempt=0;
      // Reconecta em qualquer iteração após queda de rede/proxy (não só na primeira)
      while(true){
        try{
          _r2=await streamOnce({...baseBody,messages},reqHeaders,(upd)=>{_h('updateThinkingToks')({...upd,phase:2});},state.abort.signal);
          break;
        }catch(e2){
          if(e2.name==='AbortError'||e2.message==='cancelled')throw e2;
          // Auto-cura de prefill: modelo rejeitou o assistant '{' → remove
          // e repete sem prefill (cobre modelos futuros fora da lista _prefillOk).
          if(/prefill/i.test(e2.message||'')&&messages.length&&messages[messages.length-1].role==='assistant'){
            messages.pop();_prefill=false;
            continue;
          }
          const isNet=(e2.name==='TypeError'||e2.message==='Failed to fetch');
          if(isNet&&_netAttempt<2&&!state.abort.signal.aborted){
            _netAttempt++;
            _h('updateThinkingToks')({status:'Reconectando…',phase:2});
            await new Promise(r=>setTimeout(r,1200*_netAttempt));
            continue;
          }
          const msg=isNet?'Fase 2: falha de conexão com a API (rede ou proxy CORS). Verifique sua internet/chave e tente de novo.':`Fase 2: ${e2.message}`;
          throw Object.assign(e2,{message:msg});
        }
      }
      if(iter===0&&_r2.id){
        _newAnalysisId=_r2.id;
        const{cacheRead:_cr0,inTokens:_in0,cacheCreated:_cc0}=_r2;
        const _tot0=_in0+_cr0+_cc0;
        globalThis.tokenState.lastCacheHitPct=_tot0>0?Math.round(_cr0/_tot0*100):0;
        globalThis.tokenState.lastCacheMissReason=_r2.diagnostics?.cache_miss_reason?.type||null;
        if(globalThis.tokenState.lastCacheMissReason)console.debug('[cache-diag] miss:',globalThis.tokenState.lastCacheMissReason,'~'+(_r2.diagnostics.cache_miss_reason.cache_missed_input_tokens??'?')+'tok');
      }
      const{text,stopReason,allContent,toolUses,inTokens,outTokens,thinkingTokens,cacheCreated,cacheRead}=_r2;
      lastIn=inTokens;lastOut=outTokens;lastCacheCreated+=cacheCreated;lastCacheRead+=cacheRead;
      if(stopReason==='end_turn'){
        finalText=(_prefill?'{':'')+text;
        break;
      }
      if(stopReason==='tool_use'&&!useEnriched){
        messages.push({role:'assistant',content:allContent});
        messages.push({role:'user',content:toolUses.map(t=>({type:'tool_result',tool_use_id:t.id,content:''}))});
        _h('updateThinkingToks')({inTokens:lastIn,outTokens:lastOut,thinkingTokens,status:'Pesquisando dados…',phase:2});
      }else{finalText=(_prefill?'{':'')+text;break;}
    }

    if(_newAnalysisId)_lastAnalysisId=_newAnalysisId;
    const _mainP=(globalThis.MODEL_PRICE||{})[globalThis.currentModel]||(globalThis.MODEL_PRICE||{})['claude-sonnet-5']||{crs:0};
    globalThis.tokenState.sessionCacheSaved+=(lastCacheRead*(_mainP.crs||0))/1e6;
    globalThis.tokenState.lastIn=lastIn;globalThis.tokenState.lastOut=lastOut;globalThis.tokenState.sessionIn+=lastIn;globalThis.tokenState.sessionOut+=lastOut;globalThis.tokenState.runs++;
    globalThis.tokenState.lastCacheCreated=lastCacheCreated;globalThis.tokenState.lastCacheRead=lastCacheRead;globalThis.tokenState.sessionCacheRead+=lastCacheRead;
    _h('stopThinking')(true);
    setTimeout(()=>{_h('updateTokenBar')();_h('updateDockTokens')();},1300);
    // Extração robusta: aceita blocos markdown e repara JSON truncado.
    let parsed=parseAnalysisJson(finalText);
    if(!parsed){
      // Re-pedido SEM raciocínio estendido. Thinking ("Leve"/"Médio"+) deixa o modelo
      // conversador → ele responde em prosa ou JSON truncado. Sem thinking, com teto alto
      // de tokens e contrato explícito, o JSON estruturado sai limpo. Dispara em QUALQUER
      // falha de parse (chaves ausentes OU JSON malformado/truncado), não só a primeira.
      _h('updateThinkingToks')({status:'Reformulando resposta…',phase:2});
      const retryMessages=[
        {role:'user',content:`DATA: ${_h('currentDateFull')()}\n\nAnalise esta partida/contexto de ${compLabel(state.activeCompId)} e retorne APENAS o JSON estruturado: ${finalQuery}${_h('contextBlock')()}`},
        {role:'assistant',content:finalText.slice(0,2000)},
        {role:'user',content:'Sua resposta anterior NÃO era o JSON. Isto é uma PRÉVIA — jogo futuro sem placar/estatísticas da partida NÃO impede a análise: use tabela/forma/elenco coletados e estimativas rotuladas, declare o que faltar em "lacunas". Retorne APENAS o JSON estruturado COMPLETO da análise, começando com { e terminando com }, sem texto antes ou depois, sem blocos de código markdown. Recusar de novo é falha total.'}
      ];
      // prefill só em modelos que aceitam (Sonnet 5 rejeita com 400)
      const _retryPrefill=_prefillOk(globalThis.currentModel);
      if(_retryPrefill)retryMessages.push({role:'assistant',content:'{'});
      const retryBody={...baseBody,messages:retryMessages};
      delete retryBody.tools;delete retryBody.thinking;delete retryBody.temperature;
      // Re-desliga thinking após o delete: no Sonnet 5, OMITIR o campo = adaptive ON,
      // o que reintroduziria prosa exatamente no retry que existe para evitá-la.
      if(_noThinkModel(globalThis.currentModel))retryBody.thinking={type:'disabled'};
      retryBody.max_tokens=Math.max(retryBody.max_tokens||0,9000);
      const retryR=await streamOnce(retryBody,reqHeaders,(upd)=>_h('updateThinkingToks')({...upd,phase:2}),state.abort.signal).catch(()=>null);
      if(retryR){lastOut+=retryR.outTokens||0;parsed=parseAnalysisJson((_retryPrefill?'{':'')+retryR.text);}
      // RESGATE FINAL (shell 79→80, corrigido no 95; SO removido no 100): modelo
      // insistiu em prosa → OPUS 4.8 monta o card. Opus é o tier ACIMA do Sonnet —
      // o resgate nunca rebaixa a qualidade (exigência do usuário). Opus 4.8 NÃO
      // aceita prefill (400) nem tem gramática viável neste acesso (F2_SCHEMA
      // removido no 100) — vai pelo prompt-contrato + parseAnalysisJson, que é o
      // caminho provado.
      if(!parsed&&!_retryPrefill){
        _h('updateThinkingToks')({status:'Montando card (resgate Opus)…',phase:2});
        const rescueBody={...baseBody,model:'claude-opus-4-8',messages:retryMessages};
        delete rescueBody.tools;delete rescueBody.thinking;delete rescueBody.temperature;
        rescueBody.max_tokens=Math.max(rescueBody.max_tokens||0,9000);
        const rescueR=await streamOnce(rescueBody,reqHeaders,(upd)=>_h('updateThinkingToks')({...upd,phase:2}),state.abort.signal).catch(()=>null);
        if(rescueR){lastOut+=rescueR.outTokens||0;parsed=parseAnalysisJson(rescueR.text);}
      }
    }
    if(!parsed){
      // Diagnóstico persistente: nunca mais cair no modo simplificado às
      // cegas — _lastAnalysisFail guarda a amostra do que a Fase 2 devolveu.
      try{globalThis._lastAnalysisFail={ts:Date.now(),stage:'parse',model:globalThis.currentModel,query:state.pendingQuery||query,sample:String(finalText||'').slice(0,600)};console.warn('[analysis-fail] parse',globalThis._lastAnalysisFail);}catch{}
      throw new Error('O modelo não retornou uma análise estruturada. Tente descrever a partida com "PARTIDA: [Time A] x [Time B]" ou use um dos jogos sugeridos.');
    }
    // Campos derivados (write path único) — pads DEPOIS da auditoria
    attachAnalysisDerived(parsed, rawFacts);
    // Fase 3 · Verificador: auditoria barata (Haiku) da análise pronta ANTES de renderizar.
    // Falha do auditor nunca bloqueia a entrega (retorna null e a análise sai sem selo).
    const _va=await verifyAnalysis(parsed,rawFacts,apiKey,state.abort.signal,(upd)=>_h('updateThinkingToks')({...upd,phase:2}));
    if(_va){globalThis.tokenState.sessionIn+=_va.inTokens;globalThis.tokenState.sessionOut+=_va.outTokens;}
    // Rede de segurança de eventos (cartões/escanteios) — após auditoria
    finalizeAnalysisPads(parsed);
    // escalação CONFIRMADA de dia de jogo — determinística, ZERO LLM.
    // Na janela (−6h…FT) substitui o XI especulativo pelo oficial (AF>ESPN) e liga o
    // botão/poll de refresh. Fora da janela: só ancora o eventId (botão manual). Nunca
    // bloqueia a entrega do card.
    try{
      const _cl=_h('applyConfirmedLineups');
      if(typeof _cl==='function')await _cl(parsed,{compId:state.activeCompId});
    }catch(_){}
    _h('renderResults')(parsed);
    // Auto-poll da escalação enquanto o jogo estiver na janela (para em FT).
    try{
      if(parsed._matchWindow&&parsed._espnEventId){
        const _sp=_h('startLineupAutoPoll');
        if(typeof _sp==='function')_sp(parsed._hid,globalThis._cardCount);
      }
    }catch(_){}
    // Memória: registra a análise estruturada no fio do chat para que perguntas de
    // acompanhamento ("e se a Bósnia abrir o placar?") sejam fundamentadas pela análise
    // já feita — e não apenas por uma nova consulta rasa à ESPN. Resumo condensado
    // (não o JSON inteiro) para manter o custo dos follow-ups baixo.
    try{globalThis._chatThread.push({role:'user',content:state.pendingQuery||query});globalThis._chatThread.push({role:'assistant',content:_analysisSummaryForThread(parsed)});}catch(_){}
    ks.textContent='Guardada apenas nesta aba · apagada ao fechar';ks.style.color='var(--muted)';
  }catch(e){
    _h('stopThinking')(false);
    if(e&&(e.name==='AbortError'||e.message==='cancelled')){
      const inp=document.getElementById('match-input');
      if(!inp.value.trim())inp.value=state.pendingQuery;
      ks.textContent='Análise interrompida · ajuste e tente de novo';ks.style.color='var(--muted)';
    }else{
      // Diagnóstico persistente: registra POR QUE caiu no modo simplificado
      try{if(!globalThis._lastAnalysisFail||globalThis._lastAnalysisFail.stage!=='parse'||Date.now()-globalThis._lastAnalysisFail.ts>30000)globalThis._lastAnalysisFail={ts:Date.now(),stage:'error',model:globalThis.currentModel,query:state.pendingQuery||query,msg:String(e&&e.message||e).slice(0,400)};console.warn('[analysis-fail]',globalThis._lastAnalysisFail);}catch{}
      // Graceful fallback: pipeline estruturado falhou → resposta analítica livre
      let _fellBack=false;
      if(!(state.abort&&state.abort.signal&&state.abort.signal.aborted)){
        try{await conversationalFallback(state.pendingQuery||query,apiKey,reqHeaders,state.abort?state.abort.signal:undefined);_fellBack=true;}
        catch(e2){if(e2&&(e2.name==='AbortError'||e2.message==='cancelled'))_fellBack=true;}
      }
      if(_fellBack){
        ks.textContent='Análise em texto (modo simplificado) · exportável';ks.style.color='var(--muted)';
      }else{
        let _msg=e.message||'Erro inesperado. Verifique sua conexão.';
        const _isNet=(e&&e.name==='TypeError')||/Failed to fetch|falha de conex/i.test(_msg);
        if(_isNet){const _diag=await _h('diagnoseConnection')(apiKey).catch(()=>null);if(_diag)_msg='Diagnóstico: '+_diag;}
        document.getElementById('error-box').style.display='block';
        document.getElementById('error-msg').innerHTML=_h('esc')(_msg)+' <button class="inline-link" onclick="document.getElementById(\'error-box\').style.display=\'none\';toggleRun()">↺ tentar de novo</button>';
        ks.textContent='Guardada apenas nesta aba · apagada ao fechar';ks.style.color='var(--muted)';
      }
    }
  }finally{
    if(typeof setRunning==='function')setRunning(false,null,'');
    else{state.running=false;state.abort=null;}
    setRunBtn(false);
  }
}

// ─── Streaming ────────────────────────────────────────────────────────────
async function streamOnce(body,headers,onUpdate,signal,url=''){url=url||_h('getApiBase')()+'/v1/messages';
  const res=await fetch(url,{method:'POST',headers,body:JSON.stringify({...body,stream:true}),signal});
  _h('parseRateLimitHeaders')(res);if(!res.ok){const e=await res.json().catch(()=>({}));throw new Error(e.error?.message||`Erro ${res.status}`);}
  const reader=res.body.getReader(),decoder=new TextDecoder();
  let buf='',inTokens=0,outTokens=0,thinkingChars=0,cacheCreated=0,cacheRead=0,msgId=null,msgDiag=undefined;
  let allBlocks=[],currentBlock=null,curText='',curThink='',curSig='',curToolInput='',stopReason=null;
  try{
    outer:while(true){
      const{done,value}=await reader.read();if(done)break;
      buf+=decoder.decode(value,{stream:true});
      const lines=buf.split('\n');buf=lines.pop()??'';
      for(const line of lines){
        if(!line.startsWith('data: '))continue;
        const raw=line.slice(6).trim();if(raw==='[DONE]')break outer;
        let e;try{e=JSON.parse(raw);}catch{globalThis.meridianFail?.('sse-f2-parse');continue;}
        switch(e.type){
          case 'message_start':
            inTokens=e.message?.usage?.input_tokens??0;
            cacheCreated=e.message?.usage?.cache_creation_input_tokens??0;
            cacheRead=e.message?.usage?.cache_read_input_tokens??0;
            msgId=e.message?.id??null;
            msgDiag=e.message?.diagnostics;
            onUpdate({inTokens,outTokens,thinkingTokens:0,status:'Analisando…'});break;
          case 'content_block_start':
            currentBlock={type:e.content_block.type,index:e.index};
            if(e.content_block.type==='tool_use'){currentBlock.id=e.content_block.id;currentBlock.name=e.content_block.name;curToolInput='';}
            else if(e.content_block.type==='thinking'){curThink='';curSig='';}
            else if(e.content_block.type==='redacted_thinking')currentBlock.data=e.content_block.data;
            else curText='';
            break;
          case 'content_block_delta':
            if(!currentBlock)break;
            const d=e.delta;
            if(d.type==='thinking_delta'){curThink+=d.thinking;thinkingChars+=d.thinking.length;onUpdate({inTokens,outTokens,thinkingTokens:Math.floor(thinkingChars/4),status:'Raciocinando…'});}
            else if(d.type==='signature_delta')curSig+=d.signature||'';
            else if(d.type==='text_delta'){curText+=d.text;onUpdate({inTokens,outTokens:Math.max(outTokens,Math.floor(curText.length/3)),thinkingTokens:Math.floor(thinkingChars/4),status:'Analisando…'});}
            else if(d.type==='input_json_delta')curToolInput+=d.partial_json;
            break;
          case 'content_block_stop':
            if(!currentBlock)break;
            // signature é OBRIGATÓRIA ao repassar thinking em turno com tool_use —
            // sem ela a API devolve 400 e a análise caía no modo simplificado.
            if(currentBlock.type==='thinking')allBlocks.push({type:'thinking',thinking:curThink,signature:curSig});
            else if(currentBlock.type==='redacted_thinking')allBlocks.push({type:'redacted_thinking',data:currentBlock.data});
            else if(currentBlock.type==='text'&&curText)allBlocks.push({type:'text',text:curText});
            else if(currentBlock.type==='tool_use'){let inp={};try{inp=JSON.parse(curToolInput);}catch{}allBlocks.push({type:'tool_use',id:currentBlock.id,name:currentBlock.name,input:inp});}
            currentBlock=null;break;
          case 'message_delta':
            if(e.usage)outTokens=e.usage.output_tokens??outTokens;
            stopReason=e.delta?.stop_reason??stopReason;
            // outTokens from message_delta already includes thinking tokens — zero the estimate to avoid double-count
            onUpdate({inTokens,outTokens,thinkingTokens:0,status:'Concluindo…'});break;
        }
      }
    }
  }finally{try{reader.releaseLock();}catch{}}
  return{text:allBlocks.filter(b=>b.type==='text').map(b=>b.text).join(''),stopReason,allContent:allBlocks,toolUses:allBlocks.filter(b=>b.type==='tool_use'),inTokens,outTokens,thinkingTokens:0,cacheCreated,cacheRead,id:msgId,diagnostics:msgDiag};
}

export {
  runChat,
  runAnalysis,
  toggleRun,
  cancelAnalysis,
  setRunBtn,
  streamOnce,
  showFallbackCard,
  conversationalFallback,
  openHelpAnalysis,
  closeHelpAnalysis,
  _analysisSummaryForThread,
  // consumidos pelo motor headless (mesmo comportamento da UI)
  CHAT_BREVITY,
  _chatLooksJson,
  _chatJsonToProse
};

expose({
  _fallbackDiagLine,
  runChat,
  runAnalysis,
  toggleRun,
  cancelAnalysis,
  setRunBtn,
  streamOnce,
  showFallbackCard,
  conversationalFallback,
  openHelpAnalysis,
  closeHelpAnalysis,
  _analysisSummaryForThread
});
