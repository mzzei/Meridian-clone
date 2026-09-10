/**
 * Smoke test do MOTOR — análise completa em Node puro, sem navegador.
 * node tests/motor.mjs
 *
 * Stub de fetch: /v1/messages devolve fixtures (F1 rawFacts, F2 card);
 * chamadas externas (ESPN etc.) devolvem 404 — o motor precisa degradar
 * sem quebrar. Se este teste passa, o pacote é integrável fora do app.
 */
import { createEngine } from '../motor/engine.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let failed = 0;
const assert = (c, m) => { if (!c) { console.error('FAIL', m); failed++; } else console.log('PASS', m); };

// ── Manifesto do pacote: todo arquivo listado precisa existir ──
{
  const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const manifest = fs.readFileSync(path.join(ROOT, 'motor/MANIFEST.txt'), 'utf8')
    .split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  const missing = manifest.filter((rel) => !fs.existsSync(path.join(ROOT, rel)));
  assert(manifest.length >= 20 && missing.length === 0,
    `package manifest complete (${manifest.length} files${missing.length ? '; MISSING: ' + missing.join(', ') : ''})`);
}

const F1 = JSON.stringify({
  mandante: { nome: 'Flamengo', tecnico: 'Filipe Luís', xg_marcado: 1.7, xg_sofrido: 1.0, resultados_recentes: ['V 2x0 Fluminense'], jogadores_chave: [{ nome: 'Pedro', posicao: 'ATA', gols: 12, cartoes_amarelos: 2, finalizacoes_no_gol_por_jogo: 1.5, faltas_cometidas_por_jogo: 0.8, rating_medio: 7.5 }], onze_provavel: Array.from({ length: 11 }, (_, i) => ({ nome: 'J' + i, posicao: 'P' })), banco: ['B1'], formacao: '4-2-3-1', escanteios_por_jogo: 6.1, escanteios_sofridos_por_jogo: 3.9 },
  visitante: { nome: 'Palmeiras', tecnico: 'Abel', xg_marcado: 1.5, xg_sofrido: 0.9, resultados_recentes: ['V 1x0 Corinthians'], jogadores_chave: [{ nome: 'Estêvão', posicao: 'PD', gols: 8, cartoes_amarelos: 3, finalizacoes_no_gol_por_jogo: 1.2, faltas_cometidas_por_jogo: 0.9, rating_medio: 7.7 }], onze_provavel: Array.from({ length: 11 }, (_, i) => ({ nome: 'V' + i, posicao: 'P' })), banco: ['B2'], formacao: '4-2-3-1', escanteios_por_jogo: 5.2, escanteios_sofridos_por_jogo: 4.1 },
  contexto_fase: 'Rodada 19', grupo_classificacao: '', lacunas: [],
});

const F2 = JSON.stringify({
  contexto_analise: 'previa', partida: 'Flamengo × Palmeiras', fase: 'Brasileirão Série A', confianca_geral: 'medio',
  mandante: { nome: 'Flamengo', xg_marcado: 1.7, xg_sofrido: 1.0, escalacao_status: 'provavel', jogadores_chave: ['Pedro'] },
  visitante: { nome: 'Palmeiras', xg_marcado: 1.5, xg_sofrido: 0.9, escalacao_status: 'provavel', jogadores_chave: ['Estêvão'] },
  lambda: { home_low: 1.1, home_mid: 1.5, home_high: 1.9, home_logic: 'x', away_low: 0.8, away_mid: 1.1, away_high: 1.4, away_logic: 'y' },
  eventos_provaveis: [{ evento: 'Under 3.5', probabilidade: 0.65, fundamento: 'f' }],
  sugestoes_ticket: [{ descricao: 'Under 3.5', probabilidade: 0.65, fundamento: 'f', confianca: 'alta' }],
  tendencias: ['t'], fatores_decisivos: ['fd'], incerteza: [{ fator: 'x', impacto: 'medio' }],
  lacunas: [],
});

const sse = (text) => {
  const events = [
    { type: 'message_start', message: { usage: { input_tokens: 100 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', usage: { output_tokens: 200 }, delta: { stop_reason: 'end_turn' } },
  ];
  const body = events.map((e) => 'data: ' + JSON.stringify(e)).join('\n\n') + '\n\n';
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
};

let anthropicCalls = 0;
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.includes('/v1/messages')) {
    anthropicCalls++;
    let b = null; try { b = JSON.parse(opts.body); } catch {}
    if (b && b.stream) return sse(F2);
    return new Response(JSON.stringify({ stop_reason: 'end_turn', usage: { input_tokens: 50, output_tokens: 80 }, content: [{ type: 'text', text: F1 }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  // ESPN/AF/FD indisponíveis: o motor degrada, não quebra
  return new Response('', { status: 404 });
};

const progress = [];
const avisos = [];   // log do host — o motor avisa erro de integração por aqui
const engine = await createEngine({
  apiKey: 'sk-ant-motor-smoke-test',
  model: 'claude-sonnet-5',
  competition: 'brsa',
  searches: 1,
  onProgress: (u) => { if (u && u.status) progress.push(u.status); },
  log: (m) => { avisos.push(String(m)); },
});
assert(typeof engine.analyzeMatch === 'function', 'engine created headless (no browser globals required)');

const { analysis, rawFacts, usage } = await engine.analyzeMatch('PARTIDA: Flamengo x Palmeiras');

assert(analysis && analysis.partida === 'Flamengo × Palmeiras', 'analysis JSON returned');
assert(analysis.mandante && analysis.mandante.nome === 'Flamengo', 'mandante present');
assert(Array.isArray(analysis.sugestoes_ticket) && analysis.sugestoes_ticket.length > 0, 'ticket suggestions present');
assert(analysis._coletaOk === true, 'F1 collection succeeded and flagged');
assert(rawFacts && rawFacts.mandante.escanteios_por_jogo === 6.1, 'rawFacts flow through (incl. escanteios — shell 101)');
assert(analysis._lineups && analysis._lineupsFonte, 'normalize attached lineups + proveniência (' + (analysis._lineupsFonte || '?') + ')');
assert(usage.p1In > 0 && usage.p2Out > 0, 'usage accounted per phase');
assert(progress.some((s) => /Coleta/i.test(s)) && progress.some((s) => /Raciocinando/i.test(s)), 'onProgress callback received both phases');
assert(anthropicCalls >= 2, 'F1 + F2 called the API (' + anthropicCalls + ' calls)');
assert(typeof document === 'object' && document.getElementById('x') === null, 'document is the headless stub (no real DOM)');

// ── Chat + routeIntent (mesmo comportamento do app, headless) ──
{
  // roteamento espelha intent.js
  assert(engine.routeIntent('PARTIDA: Flamengo x Palmeiras').mode === 'analysis', 'routeIntent: query ancorada → analysis');
  assert(engine.routeIntent('qual a filosofia do Abel Ferreira?').mode === 'chat', 'routeIntent: pergunta → chat');
  const rNeed = engine.routeIntent('análise completa');
  assert(rNeed.mode === 'need_teams' || rNeed.mode === 'chat', 'routeIntent: pedido sem times → need_teams/chat (' + rNeed.mode + ')');

  // gate de ambiguidade: pergunta vaga SEM âncora → need_context SEM gastar LLM
  const before = anthropicCalls;
  const vague = await engine.chat('qual sua opinião sobre o jogo de hoje?');
  assert(vague.type === 'need_context' && vague.reason === 'vague_query', 'chat: vago sem âncora → need_context');
  assert(anthropicCalls === before, 'chat: gate NÃO gastou chamada de API');

  // chat ancorado: responde em prosa com a persona + MODO CONVERSA no system
  let chatBody = null;
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes('/v1/messages')) {
      let b = null; try { b = JSON.parse(opts.body); } catch {}
      if (b && Array.isArray(b.system) && b.system.some((s) => /MODO CONVERSA/.test(s.text || ''))) {
        chatBody = b;
        return sse('O clássico tende a poucos gols; o mercado de cartões costuma pagar melhor.');
      }
    }
    return prevFetch(url, opts);
  };
  const reply = await engine.chat('Flamengo x Palmeiras: qual mercado tem melhor valor?', {
    history: [{ role: 'user', content: 'contexto anterior' }, { role: 'assistant', content: 'ok' }],
    context: { placaresVerificados: '=== PLACARES VERIFICADOS ===\n• Flamengo 2 x 1 Palmeiras | FT\n=== FIM ===' },
  });
  globalThis.fetch = prevFetch;
  assert(reply.type === 'text' && /cartões/.test(reply.text), 'chat: resposta em prosa entregue');
  assert(reply.usage.outTokens > 0, 'chat: usage contabilizado');
  assert(chatBody && chatBody.system.length === 2 && /ANALISTA|analista|futebol/i.test(chatBody.system[0].text), 'chat: persona real do app no system[0]');
  assert(chatBody.thinking && chatBody.thinking.type === 'disabled', 'chat: thinking desligado (Sonnet 5)');
  assert(chatBody.messages.length === 3, 'chat: history (2) + turno atual');
  assert(/PLACARES VERIFICADOS/.test(chatBody.messages[2].content) && /autoridade máxima/.test(chatBody.messages[2].content), 'chat: bloco de placares injetado + regra de autoridade');
  assert(chatBody.tools && chatBody.tools[0].name === 'web_search', 'chat: web_search disponível');

  // resposta em JSON nunca vaza crua: extrai prosa (guard do app)
  globalThis.fetch = async (url, opts) => {
    let b = null; try { b = JSON.parse(opts.body); } catch {}
    if (b && Array.isArray(b.system) && b.system.some((s) => /MODO CONVERSA/.test(s.text || '')))
      return sse('{"resposta":"O favoritismo é do mandante pelo retrospecto recente no clássico."}');
    return prevFetch(url, opts);
  };
  const jsonReply = await engine.chat('Flamengo x Palmeiras: quem é favorito?');
  globalThis.fetch = prevFetch;
  assert(jsonReply.type === 'text' && /favoritismo é do mandante/.test(jsonReply.text) && !/[{}"]/.test(jsonReply.text.slice(0, 5)), 'chat: JSON do modelo vira prosa (nunca cru)');
}

// ── Shell 126 (ultrareview bug_004): prosa emitida ANTES de pause_turn não pode
// ser perdida — o loop de chat deve ACUMULAR o texto entre continuações.
{
  const ssePause = (text, stop) => {
    const events = [
      { type: 'message_start', message: { usage: { input_tokens: 50 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', usage: { output_tokens: 20 }, delta: { stop_reason: stop } },
    ];
    return new Response(events.map((e) => 'data: ' + JSON.stringify(e)).join('\n\n') + '\n\n', { status: 200 });
  };
  let chatCall = 0;
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes('/v1/messages')) {
      let b = null; try { b = JSON.parse(opts.body); } catch {}
      if (b && Array.isArray(b.system) && b.system.some((s) => /MODO CONVERSA/.test(s.text || ''))) {
        chatCall++;
        // 1ª chamada: prosa inicial + pause_turn (continuação server-side de busca);
        // 2ª: conclusão + end_turn. O bug antigo devolvia SÓ a parte B.
        return chatCall === 1 ? ssePause('De acordo com as últimas informações, ', 'pause_turn')
                              : ssePause('o Palmeiras é favorito por retrospecto.', 'end_turn');
      }
    }
    return prevFetch(url, opts);
  };
  const replyP = await engine.chat('Flamengo x Palmeiras: quem é favorito?');
  globalThis.fetch = prevFetch;
  assert(replyP.type === 'text', 'pause_turn chat still resolves to text');
  assert(replyP.text === 'De acordo com as últimas informações, o Palmeiras é favorito por retrospecto.', `pre-pause prose PRESERVED (got: "${replyP.text.slice(0, 60)}")`);
  assert(chatCall === 2, 'loop continued through pause_turn exactly once');
}

// ── Versionamento do pacote (1.0.0) ────────────────────────────────────────
// Sem carimbo, o integrador não sabe qual build tem e nós não temos como avisar
// "atualize — sua versão erra probabilidade de mercado de cartão".
{
  const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
  const eng = await import("../motor/engine.mjs");
  assert(typeof eng.MOTOR_VERSION === 'string' && /^\d+\.\d+\.\d+$/.test(eng.MOTOR_VERSION), `MOTOR_VERSION exported as semver (got: ${eng.MOTOR_VERSION})`);
  // runtime: o integrador consegue checar sem ler arquivo. Reusa a instância criada no
  // topo — createEngine é UMA VEZ POR PROCESSO (os classic reavaliam no mesmo contexto
  // VM e uma 2ª chamada estoura em const duplicada); documentado no SKILL.
  assert(engine.version === eng.MOTOR_VERSION, 'createEngine() exposes the same version');
  // CHANGELOG existe, está no MANIFEST e documenta ESTA versão no topo
  const manifest = fs.readFileSync(path.join(ROOT, 'motor/MANIFEST.txt'), 'utf8');
  assert(manifest.includes('motor/CHANGELOG.md'), 'CHANGELOG ships in the package');
  const cl = fs.readFileSync(path.join(ROOT, 'motor/CHANGELOG.md'), 'utf8');
  const top = cl.match(/^## (\d+\.\d+\.\d+)/m);
  assert(top && top[1] === eng.MOTOR_VERSION, `CHANGELOG documents the current version (top: ${top && top[1]})`);
  // o changelog é para o INTEGRADOR: sem vocabulário interno nem numeração de shell
  assert(!/shell \d|vendáve|comprador|\bdo dono\b/i.test(cl), 'CHANGELOG speaks integrator language (no internal vocabulary)');
  // correções que mudam número exibido precisam estar sinalizadas
  assert(/⚠/.test(cl) && /Probabilidades \(números mudam\)/.test(cl), 'probability-changing fixes are flagged for regression comparison');
  // o empacotador carimba a versão e aborta se o changelog dessincronizar
  // O empacotador NÃO é entregue: rodando a partir do pacote, este arquivo não existe.
  // Sem o guard, a suíte crashava com ENOENT logo no passo 1 do checklist do integrador.
  const pkgPath = path.join(ROOT, 'tools/package-motor.mjs');
  if (fs.existsSync(pkgPath)) {
    const pkg = fs.readFileSync(pkgPath, 'utf8');
    assert(pkg.includes('MOTOR_VERSION') && pkg.includes('CHANGELOG desatualizado'), 'packager stamps version and guards changelog sync');
    assert(/# Motor Meridian \$\{VERSION\}/.test(pkg), 'MANIFEST header carries the version for the integrator');
    assert(pkg.includes('cwd: STAGING'), 'o build roda a suíte com os arquivos do PACOTE antes de zipar');
  }
}

// 1.0.1 — contrato: id de liga inválido é erro de integração e não pode passar mudo.
//   getComp() resolve COMPETITIONS[id] || brsa, então id errado NÃO lança: a análise sai
//   inteira com o campeonato ERRADO. O SKILL.md chegou a documentar "premier" (o id real
//   é "epl") — um integrador de Premier League receberia Brasileirão em silêncio.
{
  const antes = avisos.length;
  engine.setCompetition("premier");
  const avisou = avisos.slice(antes).join(" | ");
  assert(/premier/.test(avisou) && /epl/.test(avisou), "invalid competition id warns through host log (got: " + avisou + ")");
  const antes2 = avisos.length;
  engine.setCompetition("epl");
  assert(avisos.length === antes2, "meta: valid id (epl) does NOT warn — o aviso discrimina");
  engine.setCompetition("brsa");

  const skill = fs.readFileSync(new URL("../motor/SKILL.md", import.meta.url), "utf8");
  assert(/competition:[^\n]*\bepl\b/.test(skill), "SKILL.md lists the real Premier League id (epl)");
  assert(!/\|\s*premier\s*\|/.test(skill), "SKILL.md no longer offers the bogus id premier");
  assert(/COMPETITIONS\[id\]\s*\|\|\s*COMPETITIONS\.brsa/.test(skill), "SKILL.md warns that an unknown id silently becomes brsa");
  assert(/hasAttachments/.test(skill), "SKILL.md documents routeIntent 2nd arg (attachments never trigger the report)");
  assert(/'empty'/.test(skill), "SKILL.md documents the empty reason from chat()");
  assert(skill.includes("`…[].mercado`"), "SKILL.md documents the mercado descriptor (shell 130)");
  assert(skill.includes("`…[]._obvio`"), "SKILL.md documents the _obvio anchor flag (shell 132)");
}
// 1.0.2 — o pacote é lido por gente (e por agentes) de fora. Dois riscos distintos:
//   (a) o contrato não dizer quais modelos entram na FATURA — o `model` da config só
//       controla a Fase 2, mas Haiku e Opus rodam por conta própria;
//   (b) os .md carregarem processo interno (numeração de shell, "o app", jargão de
//       manutenção), que não significa nada para quem está de fora e só confunde.
{
  const skill = fs.readFileSync(new URL("../motor/SKILL.md", import.meta.url), "utf8");
  const heng  = fs.readFileSync(new URL("../motor/HANDOFF-ENGENHARIA.md", import.meta.url), "utf8");
  const chg   = fs.readFileSync(new URL("../motor/CHANGELOG.md", import.meta.url), "utf8");

  // (a) custo: a tabela por etapa tem de existir e nomear os três caminhos
  assert(skill.includes("## Modelos e custo"), "SKILL.md tem a seção Modelos e custo");
  assert(/Haiku 4.5/.test(skill) && /Opus 4.8/.test(skill),
    "SKILL.md nomeia os modelos que rodam fora do `model` configurado");
  assert(/s[óo] a Fase 2 e o chat/i.test(skill),
    "SKILL.md diz explicitamente que `model` cobre só Fase 2 + chat");

  // (b) documentos limpos — mesma régua do empacotador
  const REGUA = /\bshell \d+|\bdo app\b|\bno app\b|auto-cura|n[ãa]o re-tentar|call de handover|regra dura do produto|\bdo dono\b|vend[áa]vel|comprador/i;
  for (const [nome, txt] of [["SKILL.md", skill], ["HANDOFF-ENGENHARIA.md", heng], ["CHANGELOG.md", chg]]) {
    const hit = txt.match(REGUA);
    assert(!hit, `${nome} sem vocabulário interno (achei: ${hit && hit[0]})`);
  }
  // meta (inv. 35): a régua REPROVA mesmo — senão os asserts acima são decorativos
  assert(REGUA.test("nota de rodapé do shell 99"), "meta: a régua de documentos pega processo interno");

  // 1.0.2 — o contrato tem de bater com o que o engine REALMENTE exige. Três armadilhas
  //   que só apareceriam para o dev do cliente, no meio da integração:
  assert(!/roda em Node ou browser/i.test(skill),
    "SKILL.md não promete browser (engine importa node:vm/node:fs, não há caminho web)");
  assert(/N[ãa]o roda em browser/i.test(skill), "SKILL.md diz explicitamente que não roda em browser");
  const eng2 = fs.readFileSync(new URL("../motor/engine.mjs", import.meta.url), "utf8");
  assert(eng2.includes("node:vm") && eng2.includes("vm.runInThisContext"),
    "meta: o engine realmente depende de node:vm (o claim removido era falso mesmo)");  assert(/irm[ãa]os?/.test(skill) && skill.includes("__dirname"),
    "SKILL.md avisa que motor/ e js/ precisam ser irmãs (engine resolve __dirname/../js)");
  assert(/LAN[ÇC]A exce/i.test(skill) && skill.includes("try/catch"),
    "SKILL.md lista o que lança exceção (a Fase 2 quebra, não degrada)");
  assert(/Zero depend[êe]ncias/i.test(skill) && /Node 18/.test(skill),
    "SKILL.md declara runtime mínimo e ausência de dependências");
  // A seção "Como o motor raciocina" responde as perguntas que o integrador faz quando
  //   precisa defender um número ("de onde saiu isso?"). Sem ela, cada dúvida vira
  //   pergunta para nós; com ela, o pacote se explica sozinho.
  assert(skill.includes("## Como o motor raciocina"), "SKILL.md tem a seção de raciocínio");
  assert(/últimos 5 jogos com placar exato/.test(skill), "raciocínio: declara o recorte de dados da coleta");
  assert(/_lineupsFonte/.test(skill) && /inferida/.test(skill),
    "raciocínio: explica a proveniência da escalação e o selo por time");
  assert(/recalculados por Poisson/.test(skill) && /o código vence/.test(skill),
    "raciocínio: declara quem decide a aritmética quando modelo e código discordam");
  assert(/_obvio/.test(skill) && /confiança é rebaixada/.test(skill),
    "raciocínio: cobre marcação de âncora e rebaixamento de confiança sem lastro");
  assert(/em uma passagem/.test(skill),
    "raciocínio: deixa claro que a ponderação acontece numa etapa só (expectativa correta)");
  // Os DOIS documentos entregues têm de contar a MESMA história. O contrato de engenharia
  //   chegou a manter um parágrafo que já tinha saído do SKILL.md — história de um limite
  //   observado em outro acesso de API, com instrução de não re-testar. Passou pelo guard
  //   só por conjugação. Estes asserts amarram os dois.
  assert(!/limite de compila[çc][ãa]o da API/i.test(heng),
    "engenharia não conta história de limite de gramática de outro acesso de API");
  assert(/comportamento padr[ãa]o de thinking/i.test(heng) && /comportamento padr[ãa]o de thinking/i.test(skill),
    "a regra útil sobre thinking está nos DOIS documentos entregues");
  assert(/descritor `mercado`/.test(heng) && /per[íi]odo/i.test(heng),
    "engenharia declara o escopo do recálculo (descritor + período fora do escopo)");
  assert(/COMPETITIONS.brsa/.test(heng),
    "engenharia avisa que id de liga desconhecido cai no padrão sem lançar");
  assert(/MOTOR_VERSION/.test(heng), "engenharia mapeia onde vive a versão do motor");
  assert(/_obvio/.test(heng) && /dupla chance reconciliada/i.test(heng),
    "engenharia lista a sequência determinística da normalização");
  // o empacotador precisa aplicar essa régua nos .md, senão nada impede a regressão
  const pkgUrl = new URL("../tools/package-motor.mjs", import.meta.url);
  if (fs.existsSync(pkgUrl)) {
    const pkg2 = fs.readFileSync(pkgUrl, "utf8");
    assert(pkg2.includes("FORBIDDEN_DOCS") && pkg2.includes("endsWith('.md')"),
    "empacotador audita .md com régua própria (aborta o build no vazamento)");
  }
}
console.log(failed ? `\n${failed} FAILED` : '\nMOTOR ALL PASSED');
process.exit(failed ? 1 : 0);
