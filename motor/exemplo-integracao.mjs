/**
 * Exemplo de integração — node motor/exemplo-integracao.mjs "PARTIDA: Time A x Time B"
 * A chave vem da variável de ambiente ANTHROPIC_KEY (nunca de arquivo/chat).
 */
import { createEngine } from './engine.mjs';

const apiKey = process.env.ANTHROPIC_KEY;
if (!apiKey || !apiKey.startsWith('sk-ant-')) {
  console.error('Defina a variável de ambiente ANTHROPIC_KEY antes de rodar.');
  process.exit(1);
}

const t0 = Date.now();
const engine = await createEngine({
  apiKey,
  model: 'claude-sonnet-5',
  competition: 'brsa',
  searches: 2,
  onProgress: (u) => { if (u && u.status) console.log(`  [F${u.phase || '?'}] ${u.status}`); },
  log: (m) => console.log('  [log]', m),
});

console.log('Analisando: Botafogo x Vitória (Brasileirão Série A — jogo real de hoje)…\n');
const query = process.argv[2] || 'PARTIDA: Botafogo x Vitória';
const { analysis, rawFacts, usage } = await engine.analyzeMatch(query);

const a = analysis;
const secs = Math.round((Date.now() - t0) / 1000);
console.log('\n════════ RESULTADO ════════');
console.log('partida:', a.partida, '| contexto:', a.contexto_analise, '| confiança:', a.confianca_geral);
console.log('coletaOk:', a._coletaOk, '| lineupsFonte:', a._lineupsFonte || '(nenhuma)');
console.log('xG mandante:', a.mandante?.xg_marcado, '/', a.mandante?.xg_sofrido, '| visitante:', a.visitante?.xg_marcado, '/', a.visitante?.xg_sofrido);
console.log('rawFacts escanteios (mand):', rawFacts?.mandante?.escanteios_por_jogo, '· sofridos:', rawFacts?.mandante?.escanteios_sofridos_por_jogo);
console.log('resultados_recentes (mand):', JSON.stringify((rawFacts?.mandante?.resultados_recentes || []).slice(0, 3)));
console.log('eventos:', (a.eventos_provaveis || []).length, '| tickets:', (a.sugestoes_ticket || []).length, '| duelos:', (a.confronto_tatico?.duelos_chave || []).length);
console.log('tickets:', (a.sugestoes_ticket || []).map((t) => `${t.descricao} (${Math.round((t.probabilidade || 0) * 100)}%)`).join(' · '));
console.log('LACUNAS declaradas:', (a.lacunas || []).length);
(a.lacunas || []).forEach((l) => console.log('  ·', String(l).slice(0, 140)));
console.log(`\ntokens: F1 ${usage.p1In}+${usage.p1Out} · F2 ${usage.p2In}+${usage.p2Out} · ${secs}s`);
console.log(analysis.partida ? '\nANÁLISE REAL OK' : '\nFALHOU');
process.exit(0);
