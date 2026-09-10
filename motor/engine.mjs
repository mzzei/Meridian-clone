/**
 * MOTOR MERIDIAN — engine headless de análise de futebol (pacote de integração).
 *
 * O que isto é: uma camada de composição que roda o pipeline de análise
 * (coleta estruturada F1 → portões de completude/anti-alucinação → análise F2
 * → normalização) SEM navegador, SEM UI e SEM o app Meridian. Consome os
 * módulos de domínio existentes (js/analysis, js/data, js/lib, js/comp) —
 * zero duplicação de lógica: o motor É o mesmo código que roda em produção.
 *
 * Contrato completo: motor/SKILL.md. Prova de isolamento: `node tests/motor.mjs`
 * roda uma análise completa em Node puro.
 *
 * O que NÃO está aqui (de propósito): chat, popups de contexto, biblioteca,
 * export, Service Worker, Worker proxy — tudo isso é produto/integração do
 * integrador. O gate de ambiguidade fica com ele: a query passada ao
 * motor deve estar ANCORADA (times definidos); use o prefixo "PARTIDA:" para
 * declarar isso explicitamente.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Versão do motor. Fonte única: o empacotador carimba este valor no MANIFEST e
 * o CHANGELOG.md descreve o que mudou em cada uma. Confira a sua com:
 *   import { MOTOR_VERSION } from './motor/engine.mjs'
 * ou, em runtime, pelo campo `version` devolvido por createEngine().
 * Correções de probabilidade mudam NÚMEROS exibidos ao usuário final — ao
 * atualizar, leia o CHANGELOG antes de comparar saídas com as da versão antiga.
 */
export const MOTOR_VERSION = '1.0.2';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

// Mesma ordem do CLASSIC do main.js (menos UI/export/demo) — a ordem importa:
// espn antes de football-apis, facts-memory antes de phase1-context, etc.
const CLASSIC_DATA = [
  'js/analysis/prompts.js',
  'js/data/cached-fetch.js',
  'js/data/source-telemetry.js',
  'js/data/espn.js',
  'js/data/football-apis.js',
  'js/data/free-sources.js',
  'js/data/facts-memory.js',
  'js/data/phase1-context.js',
  'js/data/source-health.js',
  'js/data/schedule.js',
];

function _memoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  };
}

// document mínimo: os módulos de dados só tocam DOM em pontos defensivos
// (getElementById que pode devolver null). Nada aqui renderiza.
function _stubDocument() {
  return {
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, remove() {} }),
    body: { appendChild() {} },
    readyState: 'complete',
  };
}

const _noop = () => {};

/**
 * createEngine(config) → { analyzeMatch, chat, routeIntent, setCompetition, version }
 *
 * config:
 *   apiKey     string — chave Anthropic DO INTEGRADOR (obrigatória sem workerUrl)
 *   workerUrl  string — proxy opcional (CORS/secrets); com ele a apiKey pode ir vazia
 *   model      string — modelo da Fase 2 (default 'claude-sonnet-5')
 *   competition string — id EXATO da liga: brsa | libertadores | epl | laliga | ucl
 *                        (default 'brsa'). Id fora dessa lista NÃO lança: getComp cai em
 *                        Brasileirão silenciosamente — por isso o motor avisa pelo log.
 *   searches   number — teto de buscas da F1 (default 2)
 *   dataKeys   {af?, fd?} — chaves opcionais API-Football / football-data (modo direto)
 *   storage    {getItem,setItem,removeItem} — default memória (Node) / localStorage (browser)
 *   onProgress ({status, phase, inTokens, outTokens}) — callback de progresso (opcional)
 *   log        (msg) — logger (default console.log)
 */
export async function createEngine(config = {}) {
  const cfg = {
    model: 'claude-sonnet-5',
    competition: 'brsa',
    searches: 2,
    log: (m) => console.log('[motor]', m),
    onProgress: _noop,
    ...config,
  };
  if (!cfg.apiKey && !cfg.workerUrl)
    throw new Error('motor: forneça apiKey (Anthropic) ou workerUrl (proxy com secret)');

  const g = globalThis;

  // ── Ambiente headless (só preenche o que faltar — no browser, o real vence) ──
  if (typeof g.localStorage === 'undefined') g.localStorage = cfg.storage || _memoryStorage();
  if (typeof g.sessionStorage === 'undefined') g.sessionStorage = _memoryStorage();
  if (typeof g.document === 'undefined') g.document = _stubDocument();
  if (typeof g.window === 'undefined') g.window = g;
  if (typeof g.location === 'undefined')
    g.location = { protocol: 'https:', origin: 'https://motor.local', hostname: 'motor.local', search: '' };

  // ── Host shims (grupo A/C): mesmas assinaturas do app.js, sem DOM ──
  const shims = {
    // config/transporte (espelham app.js:1109-1121)
    getWorkerUrl: () => cfg.workerUrl || '',
    getApiBase: () => cfg.workerUrl || 'https://api.anthropic.com',
    getReqHeaders: (apiKey, betas = []) => {
      const h = { 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01' };
      if (apiKey) h['x-api-key'] = apiKey;
      if (betas.length) h['anthropic-beta'] = betas.join(',');
      return h;
    },
    parseRateLimitHeaders: _noop,
    diagnoseConnection: async () => null,
    // contexto/data
    currentDateFull: () =>
      new Date().toLocaleDateString('pt-BR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
    contextBlock: () => '',
    personaBlock: () => '',
    getChatContext: () => '',
    fetchMemoryContext: async () => '',
    // progresso/UI → callbacks do integrador (ou no-op)
    updateThinkingToks: (u) => cfg.onProgress(u),
    startThinking: _noop,
    stopThinking: _noop,
    updateTokenBar: _noop,
    updateDockTokens: _noop,
    renderCoverageBadge: _noop,
    updateCoverageAfterSearch: _noop,
    toast: (m) => cfg.log(m),
    t: (k) => k,
    esc: (s) => String(s ?? ''),
    textFrom: (v) => (v == null ? '' : typeof v === 'string' ? v : String(v)),
    scrollChat: _noop,
    taReset: _noop,
    showUserBubble: _noop,
    showAgentBubble: () => ({ closest: () => null }),
    clearAttachments: _noop,
  };
  for (const [k, v] of Object.entries(shims)) if (typeof g[k] === 'undefined') g[k] = v;

  // globais de estado que o pipeline consulta
  g.currentModel = cfg.model;
  if (typeof g.modelProfile === 'undefined')
    g.modelProfile = () => ({ label: 'motor', budget: 0, searches: cfg.searches });
  if (typeof g.tokenState === 'undefined')
    g.tokenState = { lastIn: 0, lastOut: 0, sessionIn: 0, sessionOut: 0, sessionIn_p1: 0, sessionOut_p1: 0, runs: 0, sessionCacheRead: 0, sessionCacheSaved: 0, lastCacheCreated: 0, lastCacheRead: 0 };
  if (typeof g.MODEL_PRICE === 'undefined') g.MODEL_PRICE = {};
  if (typeof g._attachments === 'undefined') g._attachments = [];
  if (typeof g._chatThread === 'undefined') g._chatThread = [];
  if (cfg.dataKeys) {
    if (cfg.dataKeys.af) g.localStorage.setItem('meridian_af_key', cfg.dataKeys.af);
    if (cfg.dataKeys.fd) g.localStorage.setItem('meridian_fd_key', cfg.dataKeys.fd);
  }

  // ── Carrega os módulos de dados classic no contexto atual ──
  // runInThisContext: function declarations viram globais (como <script> no browser)
  for (const rel of CLASSIC_DATA) {
    const code = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    vm.runInThisContext(code, { filename: rel });
  }

  // ── ESM de domínio (mesmos arquivos do app) ──
  // lineup/tab-helpers são side-effect (expose() de helpers que o normalize usa via
  // guards silenciosos — sem o import, _lineups sai vazio SEM erro)
  await import(pathToFileURL(path.join(ROOT, 'js/analysis/tab-helpers.js')).href);
  await import(pathToFileURL(path.join(ROOT, 'js/analysis/lineup.js')).href);
  const { state } = await import(pathToFileURL(path.join(ROOT, 'js/state.js')).href);
  const facts = await import(pathToFileURL(path.join(ROOT, 'js/analysis/pipeline-facts.js')).href);
  const run = await import(pathToFileURL(path.join(ROOT, 'js/analysis/pipeline-run.js')).href);
  const norm = await import(pathToFileURL(path.join(ROOT, 'js/analysis/normalize.js')).href);

  state.activeCompId = cfg.competition;

  const { routeUserIntent } = await import(pathToFileURL(path.join(ROOT, 'js/lib/intent.js')).href);
  const comp = await import(pathToFileURL(path.join(ROOT, 'js/comp/competitions.js')).href);

  const _prefillOk = (m) => /claude-haiku/.test(m || '');
  const _noThink = (m) => /claude-sonnet-5/.test(m || '');

  // Id de liga inválido NÃO lança (getComp resolve COMPETITIONS[id] || brsa), então a
  // análise sairia inteira com o campeonato ERRADO — endpoint, rótulo, regras de ticket e
  // tabela do Brasileirão. Erro de integração deve ser audível: avisa pelo log do host.
  function _checkComp(id) {
    if (id && Array.isArray(comp.COMP_ORDER) && !comp.COMP_ORDER.includes(id))
      cfg.log(`competição "${id}" não existe — usando Brasileirão (brsa). Ids válidos: ${comp.COMP_ORDER.join(', ')}`);
    return id;
  }
  _checkComp(cfg.competition);

  function setCompetition(id) { state.activeCompId = _checkComp(id); }

  /** Espelha js/lib/intent.js — decide análise (card) × conversa × pedir times. */
  function routeIntent(userMessage, opts = {}) {
    return routeUserIntent(String(userMessage || ''), { hasAttachments: !!opts.hasAttachments });
  }

  /**
   * chat(userMessage, {signal, history, context}) → interação do usuário final.
   * MESMO comportamento do chat do app (persona + MODO CONVERSA + blocos de
   * grounding + guards anti-JSON/anti-suposição), com uma diferença headless:
   * onde o app abre POPUP, aqui retorna { type:'need_context' } — o host decide
   * como perguntar. Retornos:
   *   { type:'text', text, usage }        — resposta em prosa
   *   { type:'need_context', question, reason } — NADA foi gasto com o LLM
   *                                         (reason 'vague_query') ou a resposta
   *                                         pressupôs partida não ancorada
   *                                         (reason 'presupposed_match')
   */
  async function chat(userMessage, opts = {}) {
    const query = String(userMessage || '').trim();
    if (!query) return { type: 'need_context', question: 'Mensagem vazia — o que você quer saber?', reason: 'empty' };
    const signal = opts.signal || new AbortController().signal;
    const history = Array.isArray(opts.history) ? opts.history.slice(-8) : [];
    const ctxIn = opts.context || {};
    const usage = { inTokens: 0, outTokens: 0 };
    const prog = (u) => cfg.onProgress(u);

    // ── Gate de ambiguidade (zero suposição — ANTES de gastar LLM) ──
    // Mesmo critério do app: pergunta vaga sobre "o jogo" sem âncora em lugar
    // nenhum (mensagem, histórico ou contexto injetado) → devolve a pergunta.
    const histText = history.map((m) => m.content || '').join('\n');
    const anchorPool = [query, histText, ctxIn.scoreboard || '', ctxIn.placaresVerificados || '', ctxIn.attachmentsNote || ''].join('\n');
    if (facts.isVagueMatchQuery(query) && !facts.hasExplicitMatchAnchor(anchorPool) && !/\[Contexto confirmado:/i.test(query)) {
      return {
        type: 'need_context',
        reason: 'vague_query',
        question: 'Qual jogo você quer comentar? Diga os dois times (ex.: "Flamengo x Palmeiras") ou a liga + data.',
      };
    }

    // ── Grounding (mesmos blocos do app; host pode injetar, senão o motor coleta) ──
    const inferred = (g.inferCompIdsFromText ? g.inferCompIdsFromText(query + '\n' + histText) : []) || [];
    const espnIds = inferred.length ? inferred : comp.COMP_ORDER.slice();
    const needsLive = facts._chatNeedsLiveData(query, false);
    const needsScore = facts._chatNeedsScoreVerification(query) || needsLive;
    const hasAnchor = facts.hasExplicitMatchAnchor(query) || facts.hasExplicitMatchAnchor(histText);
    let liveData = ctxIn.scoreboard || '';
    let scoreFacts = ctxIn.placaresVerificados || '';
    if (!liveData && (needsLive || needsScore)) {
      prog({ status: 'resolvendo jogo e status (ESPN)…', phase: 1 });
      liveData = await (g.gatherEspnForChat ? g.gatherEspnForChat(espnIds).catch(() => '') : '');
    }
    if (!scoreFacts && needsScore && hasAnchor) {
      prog({ status: 'confirmando resultado oficial (web)…', phase: 1 });
      scoreFacts = await facts.fetchVerifiedMatchFacts(query, cfg.apiKey, signal, liveData).catch(() => '');
    }
    const metaComp = inferred.length
      ? `=== COMPETIÇÕES INFERIDAS: ${inferred.map((id) => comp.compLabel(id)).join(' · ')} ===`
      : `=== CONTEXTO: pode ser clube OU seleção (não se limite às ligas embutidas do app). ===`;
    const scoreBlock = scoreFacts
      ? `\n\n${scoreFacts}\n\nREGRA: o bloco PLACARES VERIFICADOS é a autoridade máxima. Sua opinião tática pode ser livre; o PLACAR e o STATUS do jogo (FT/LIVE) devem copiar esse bloco. Nunca diga outro placar.`
      : (needsScore && hasAnchor ? `\n\n=== AVISO DE COLETA ===\nNão foi possível montar PLACARES VERIFICADOS nesta passagem. Você DEVE usar web_search agora (2+ fontes P1) antes de afirmar qualquer placar. PROIBIDO inventar placar de memória.\n=== FIM AVISO ===` : '');
    const liveBlock = liveData
      ? `\n\n=== DADOS REAIS ESPN (placares/tabelas; se divergir de PLACARES VERIFICADOS, prevalece PLACARES VERIFICADOS) ===\n${liveData}\n=== FIM ESPN ===`
      : '';
    const attBlock = ctxIn.attachmentsNote ? `\n\n=== ANEXO (processado pelo host) ===\n${ctxIn.attachmentsNote}\n=== FIM ANEXO ===` : '';

    // ── Chamada (mesma persona + MODO CONVERSA + thinking desligado do app) ──
    const body = {
      model: cfg.model,
      max_tokens: (liveData || scoreFacts || attBlock) ? 4500 : 3200,
      system: [
        { type: 'text', text: g.analystSystemPrompt(), cache_control: { type: 'ephemeral' } },
        { type: 'text', text: run.CHAT_BREVITY },
      ],
      messages: [
        ...history,
        { role: 'user', content: `DATA: ${g.currentDateFull()}\n${metaComp}${scoreBlock}${liveBlock}${attBlock}\n\nPERGUNTA: ${query}` },
      ],
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: scoreFacts ? 2 : (hasAnchor ? 4 : 2) }],
    };
    if (_noThink(cfg.model)) body.thinking = { type: 'disabled' };
    const reqHeaders = g.getReqHeaders(cfg.apiKey, []);

    prog({ status: 'respondendo…', phase: 2 });
    let text = '';
    const messages = body.messages;
    for (let iter = 0; iter < 8; iter++) {
      const r = await run.streamOnce({ ...body, messages }, reqHeaders, (u) => prog({ ...u, phase: 2 }), signal);
      usage.inTokens += r.inTokens || 0; usage.outTokens += r.outTokens || 0;
      if (r.stopReason === 'tool_use' || r.stopReason === 'pause_turn') {
        // (ultrareview bug_004): prosa emitida ANTES do pause_turn/tool_use
        // ia para o histórico (allContent) mas nunca para o `text` local — a resposta
        // chegava ao integrador truncada no começo. Acumula a cada continuação.
        text += r.text || '';
        messages.push({ role: 'assistant', content: r.allContent });
        if (r.stopReason === 'tool_use')
          messages.push({ role: 'user', content: r.toolUses.map((t) => ({ type: 'tool_result', tool_use_id: t.id, content: '' })) });
        continue;
      }
      text += r.text || ''; break;
    }

    // ── Guards de saída (mesmos do app) ──
    let clean = g.stripInternalReasoning ? g.stripInternalReasoning(text) : text;
    if (run._chatLooksJson(clean)) {
      const prose = run._chatJsonToProse(clean);
      clean = prose || 'Não consegui montar uma resposta em texto — reformule a pergunta.';
    }
    // resposta pressupôs partida específica em pergunta vaga → contexto, não chute
    if (g.cardPresupposedVagueMatch) {
      const presup = g.cardPresupposedVagueMatch(clean, query);
      if (presup) return { type: 'need_context', reason: 'presupposed_match', question: presup.question || 'Confirme qual partida você quer comentar.', usage };
    }
    return { type: 'text', text: String(clean || '').trim(), usage };
  }

  /**
   * analyzeMatch(query, {signal}) → { analysis, rawFacts, usage }
   * A query deve estar ANCORADA (ex.: 'PARTIDA: Flamengo x Palmeiras') — o gate
   * de ambiguidade é responsabilidade do integrador (ver SKILL.md §Contrato).
   */
  async function analyzeMatch(query, opts = {}) {
    const signal = opts.signal || new AbortController().signal;
    const usage = { p1In: 0, p1Out: 0, p2In: 0, p2Out: 0 };
    const prog = (u) => cfg.onProgress(u);

    // ── Fase 1: coleta estruturada (cascata AF→FD→ESPN + buscas dirigidas) ──
    prog({ status: 'Coleta estruturada…', phase: 1 });
    let rawFacts = null;
    try {
      const r1 = await facts.gatherFacts(query, cfg.apiKey, signal, (u) => prog({ ...u, phase: 1 }), cfg.searches);
      rawFacts = r1.rawFacts; usage.p1In += r1.inTokens || 0; usage.p1Out += r1.outTokens || 0;
    } catch (e1) {
      if (e1.name === 'AbortError' || e1.message === 'cancelled') throw e1;
      cfg.log('F1 falhou (' + e1.message + ') — análise direta sem coleta');
    }

    if (rawFacts) {
      // coerção defensiva (mesma do app): jogadores_chave string → {nome}
      try {
        [rawFacts.mandante, rawFacts.visitante].filter(Boolean).forEach((tm) => {
          if (Array.isArray(tm.jogadores_chave))
            tm.jogadores_chave = tm.jogadores_chave.map((p) => (typeof p === 'string' ? { nome: p } : p));
        });
      } catch {}
      // portões: completude (gap pass) + anti-alucinação de nomes
      const gp = await facts.fillDataGaps(rawFacts, cfg.apiKey, signal, (u) => prog({ ...u, phase: 1 }));
      usage.p1In += gp.inTokens || 0; usage.p1Out += gp.outTokens || 0;
      const lv = await facts.verifyLineupNames(rawFacts, cfg.apiKey, signal, (u) => prog({ ...u, phase: 1 }));
      usage.p1In += lv.inTokens || 0; usage.p1Out += lv.outTokens || 0;
    }

    // pós-jogo declarado na query → placar verificado ANTES da F2 (nunca inferido)
    const posJogo = /\[Contexto confirmado:[^\]]*(p[oó]s[\s-]?jogo|j[aá]\s+disputado)/i.test(query);
    let scoreBlock = '';
    if (posJogo) {
      prog({ status: 'Verificando placar oficial…', phase: 1 });
      scoreBlock = await facts.fetchVerifiedMatchFacts(query, cfg.apiKey, signal, '').catch(() => '');
    }

    // ── Fase 2: análise estruturada (caminho provado: prompt-contrato, sem thinking) ──
    prog({ status: 'Raciocinando…', phase: 2 });
    const useEnriched = !!rawFacts;
    const ctx = useEnriched ? (g.getTournamentCtxString ? g.getTournamentCtxString() : '') : '';
    const finalQuery = (useEnriched ? facts.buildEnrichedQuery(query, rawFacts, ctx) : query)
      + (scoreBlock ? '\n\n' + scoreBlock : '')
      + (posJogo ? '\n[MODO PÓS-JOGO: o jogo já foi disputado — preencha contexto_analise="pos_jogo" e siga a regra de pós-jogo do prompt.]' : '');
    const sysText = useEnriched ? g.getSystemPromptPhase2() : g.getSystemPrompt();
    const reqHeaders = g.getReqHeaders(cfg.apiKey, []);

    const baseBody = { model: cfg.model, max_tokens: 9000, system: [{ type: 'text', text: sysText, cache_control: { type: 'ephemeral' } }] };
    if (!useEnriched) baseBody.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 4 }];
    if (_noThink(cfg.model)) baseBody.thinking = { type: 'disabled' };

    const messages = [{ role: 'user', content: `DATA: ${g.currentDateFull()}\n\nAnalise esta partida e retorne APENAS o JSON estruturado: ${finalQuery}` }];
    let prefill = useEnriched && _prefillOk(cfg.model);
    if (prefill) messages.push({ role: 'assistant', content: '{' });

    let finalText = '';
    for (let iter = 0; iter < 10; iter++) {
      let r2;
      try {
        r2 = await run.streamOnce({ ...baseBody, messages }, reqHeaders, (u) => prog({ ...u, phase: 2 }), signal);
      } catch (e2) {
        if (e2.name === 'AbortError' || e2.message === 'cancelled') throw e2;
        // auto-cura de prefill (modelos futuros fora da lista)
        if (/prefill/i.test(e2.message || '') && messages[messages.length - 1].role === 'assistant') {
          messages.pop(); prefill = false; continue;
        }
        throw e2;
      }
      usage.p2In += r2.inTokens || 0; usage.p2Out += r2.outTokens || 0;
      if (r2.stopReason === 'tool_use' && !useEnriched) {
        messages.push({ role: 'assistant', content: r2.allContent });
        messages.push({ role: 'user', content: r2.toolUses.map((t) => ({ type: 'tool_result', tool_use_id: t.id, content: '' })) });
        continue;
      }
      finalText = (prefill ? '{' : '') + r2.text;
      break;
    }

    let parsed = facts.parseAnalysisJson(finalText);

    // retry de forma + resgate Opus (mesma escada do app, sem UI)
    if (!parsed) {
      prog({ status: 'Reformulando resposta…', phase: 2 });
      const retryMessages = [
        messages[0],
        { role: 'assistant', content: finalText.slice(0, 2000) },
        { role: 'user', content: 'Sua resposta anterior NÃO era o JSON. Retorne APENAS o JSON estruturado COMPLETO da análise, começando com { e terminando com }, sem texto antes ou depois, sem blocos de código markdown. Recusar de novo é falha total.' },
      ];
      const retryPrefill = _prefillOk(cfg.model);
      if (retryPrefill) retryMessages.push({ role: 'assistant', content: '{' });
      const retryBody = { ...baseBody, messages: retryMessages };
      delete retryBody.tools;
      if (_noThink(cfg.model)) retryBody.thinking = { type: 'disabled' };
      const rr = await run.streamOnce(retryBody, reqHeaders, (u) => prog({ ...u, phase: 2 }), signal).catch(() => null);
      if (rr) { usage.p2Out += rr.outTokens || 0; parsed = facts.parseAnalysisJson((retryPrefill ? '{' : '') + rr.text); }
      if (!parsed && !retryPrefill) {
        prog({ status: 'Montando card (resgate Opus)…', phase: 2 });
        const rescueBody = { ...baseBody, model: 'claude-opus-4-8', messages: retryMessages };
        delete rescueBody.tools; delete rescueBody.thinking;
        const rc = await run.streamOnce(rescueBody, reqHeaders, (u) => prog({ ...u, phase: 2 }), signal).catch(() => null);
        if (rc) { usage.p2Out += rc.outTokens || 0; parsed = facts.parseAnalysisJson(rc.text); }
      }
    }
    if (!parsed) throw new Error('motor: a Fase 2 não devolveu JSON estruturado (após retry e resgate)');

    // ── Normalização/derivação (proveniência de escalação, pads, lambdas) ──
    parsed._coletaOk = !!rawFacts;
    try { norm.attachAnalysisDerived(parsed, rawFacts); } catch (e) { cfg.log('attachAnalysisDerived: ' + e.message); }
    try { norm.finalizeAnalysisPads(parsed); } catch (e) { cfg.log('finalizeAnalysisPads: ' + e.message); }

    return { analysis: parsed, rawFacts, usage };
  }

  return { analyzeMatch, chat, routeIntent, setCompetition, version: MOTOR_VERSION };
}
