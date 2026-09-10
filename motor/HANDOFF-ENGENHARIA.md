# HANDOFF DE ENGENHARIA — Motor Meridian (edição para integrador)

Documento para o desenvolvedor que vai integrar e manter o motor. Complementa o
`SKILL.md` (contrato de uso): aqui está o **porquê** de cada decisão e as regras
que não devem ser violadas na manutenção. Não há segredos aqui — chaves de API
são sempre do integrador e nunca acompanham o pacote.

---

## 1. Mapa de módulos (o que é o quê)

| Camada | Arquivos | Papel |
|---|---|---|
| Composição | `motor/engine.mjs` | Monta o ambiente headless e expõe `createEngine`/`analyzeMatch` |
| Orquestração | `js/analysis/pipeline-facts.js`, `js/analysis/pipeline-run.js` | Fase 1 (coleta), portões, Fase 2 (análise), streaming |
| Conhecimento | `js/analysis/prompts.js` | Prompts de sistema das duas fases (o contrato textual do JSON) |
| Derivação | `js/analysis/normalize.js`, `js/analysis/lineup.js`, `js/analysis/tab-helpers.js` | Schema canônico, escalações + proveniência, pads determinísticos |
| Fontes | `js/data/espn.js`, `js/data/football-apis.js`, `js/data/free-sources.js`, `js/data/schedule.js` | ESPN (sempre disponível), API-Football/football-data (opcionais), agenda |
| Infra de coleta | `js/data/phase1-context.js`, `js/data/facts-memory.js`, `js/data/cached-fetch.js`, `js/data/source-telemetry.js`, `js/data/source-health.js` | Cascata, cobertura A/B/C, memória de fatos, cache, telemetria de fontes |
| Base | `js/lib/intent.js`, `js/comp/competitions.js`, `js/state.js`, `js/expose.js`, `js/runtime.js` | Roteamento, ligas, estado, ponte de globais |
| Prova | `tests/motor.mjs` | Análise completa headless com API stubada — o teste de aceitação |
| Versão | `MOTOR_VERSION` em `motor/engine.mjs`, `motor/CHANGELOG.md` | Fonte única da versão (também em `createEngine().version`) e o histórico do que mudou |
| Exemplo | `motor/exemplo-integracao.mjs` | Integração mínima ponta a ponta, para o primeiro teste com chave real |

Dois estilos de módulo convivem por design (o app original roda **sem bundler**):
- **ESM** (`import`/`export`): analysis/, lib/, comp/, state.
- **Classic** (funções globais): data/ e prompts. O `engine.mjs` os carrega via
  `vm.runInThisContext`, na ordem em que dependem uns dos outros.

## 2. Arquitetura em uma página

**Fase 1 — coleta estruturada (modelo barato + web_search).**
A cascata de fontes é `API-Football → football-data → ESPN`; a ESPN é a rede de
segurança imutável (gratuita, sem chave). Antes de buscar, o motor monta a
**cobertura A/B/C** (A = dados estruturados de API; B = escalação/técnico;
C = métricas) e instrui o modelo a buscar **só o que está baixo** — é isso que
mantém o custo de coleta pequeno. A resposta usa structured outputs quando o
acesso aceita; se ele recusar (400), o run rebaixa para o contrato por prompt no
mesmo run, sem quebrar.

**Portões (código, não prompt).** Depois da coleta, duas passagens deterministas:
- `fillDataGaps`: inspeciona o JSON em memória e dispara **uma** busca dirigida
  barata cobrindo só o que faltou (xG, escanteios/jogo, placar exato dos últimos
  5, tabela, stats de titulares, escalação 11+banco+técnico). Coleta completa =
  custo zero.
- `verifyLineupNames`: cruza cada nome de escalação com busca fresca e remove
  jogadores comprovadamente fora do elenco **antes** de a Fase 2 ver o nome.
  "Não achei nada" não invalida ninguém — só evidência positiva remove.

**Fase 2 — análise.** O modelo escolhido recebe os fatos consolidados e devolve
o JSON do relatório por **prompt-contrato**. Escada de recuperação: parse robusto
(`parseAnalysisJson`: cerca markdown + reparo de JSON truncado) → retry de forma
sem tools → **resgate com modelo de tier superior** (nunca rebaixar qualidade no
caminho de erro). Probabilidades de mercados de gols são derivadas **localmente**
(Poisson sobre os lambdas) — o modelo estima parâmetros, não porcentagens.

O recálculo é dirigido pelo **descritor `mercado`** que acompanha cada evento e
cada sugestão (`{tipo, time, linha, direcao, negacao, periodo}`), não por leitura
do texto. E ele tem **escopo declarado**: mercado de gols do jogo inteiro é
recalculado; mercado por time usa a **linha** para escolher o `k` de
`P(time ≥ k)`; mercado de **período** (1º/2º tempo) fica com o valor do modelo,
porque os lambdas são de jogo inteiro e não modelam metade.

**Normalização.** É aqui que a saída do modelo vira produto. Escalações ganham
**proveniência por time** (`api > pesquisa > modelo > inferida`) e o pior nível
dos dois vira o rótulo global — o motor nunca vende estimativa como confirmação.
Lacunas são declaradas no próprio resultado.

Além disso roda uma sequência **determinística**, sempre na mesma ordem, e é ela
que separa uma sugestão factível de uma absurda:

1. xG implausível (fora de 0–4, ou zero) vira ausente — zero seria lido como medição;
2. mercados de gols recalculados por Poisson (escopo acima), com a correção anotada
   no fundamento quando o valor muda;
3. dupla chance reconciliada com seus componentes (1X = vitória + empate);
4. confiança rebaixada quando falta o dado que sustentaria aquele mercado;
5. contexto de prévia sanitizado (nenhum texto afirma que a partida já ocorreu) e
   meta-narração do processo removida do texto entregue;
6. mercado quase certo marcado com `_obvio`, para a interface rotulá-lo como
   âncora em vez de vendê-lo como o achado da análise;
7. desfalque × onze reconciliado — um jogador nunca fica nas duas listas.

## 3. Regras de funcionamento (não violar na manutenção)

1. **Todo parse de saída de LLM passa por `parseAnalysisJson`.** Nunca
   `JSON.parse` seco nem regex de chaves — truncamento no teto de tokens é
   rotina, e o reparo recupera o relatório.
2. **Prefill de assistant (`{`) só em modelos Haiku.** Os modelos atuais das
   famílias Sonnet/Opus rejeitam com 400. O motor detecta a recusa e segue sem
   prefill, mas não o reintroduza como técnica principal.
3. **A Fase 2 roda sem extended thinking.** Raciocínio estendido junto com saída
   JSON longa derruba a taxa de parse: o modelo tende a responder em prosa e o
   relatório se perde. O motor mantém thinking desligado explicitamente nos
   modelos que o ligariam por padrão. **Ao trocar o modelo da Fase 2, verifique o
   comportamento padrão de thinking do modelo novo** — ele muda entre gerações, e
   um modelo que liga raciocínio sozinho quebra o relatório sem erro aparente.
4. **Structured outputs usa `additionalProperties:false` — logo, NUNCA pode um
   campo existir no contrato textual e faltar no schema** (o modelo fica
   proibido de emiti-lo e o dado "some" silenciosamente). Ao evoluir a coleta,
   altere SEMPRE os dois juntos (template textual + schema).
5. **`budget_tokens` e sampling params (`temperature` etc.) devolvem 400 nos
   modelos atuais.** E o padrão de thinking não é estável entre gerações: há
   modelo que roda sem thinking quando o campo é omitido e modelo que liga
   raciocínio adaptativo no mesmo caso. Por isso o motor **declara o que quer**
   em vez de confiar no padrão. Ao introduzir um modelo novo, esse é o primeiro
   ponto a conferir.
6. **Ponte classic↔ESM só com `var`/`function`/atribuição em global** —
   `const`/`let` de script classic não chegam ao objeto global, e a falha é
   silenciosa (o consumidor lê `undefined`).
7. **Nomes de jogador nunca são inventados**: o pipeline só usa o que
   dados/busca trouxeram; incerteza vira "A confirmar" ou lacuna declarada.
8. **Teste anti-regressão precisa de meta-assert** que prove que ele reprova o
   caso ruim — um smoke test que nunca falha é pior que nenhum.
9. **Chat nunca supõe partida nem despeja JSON na resposta**: pergunta vaga sem
   âncora retorna `need_context` ANTES de gastar LLM; resposta que pressupõe
   partida em pergunta vaga vira `need_context`; estrutura JSON do modelo é
   convertida em prosa. As regras de brevidade do chat (`CHAT_BREVITY`) e os
   guards vêm de `pipeline-run.js` — o chat do motor É o chat calibrado, não
   uma reimplementação.
10. **O recálculo só carimba o que mapeia com CERTEZA.** Se o descritor não
   corresponde a uma fórmula de jogo inteiro (período, linha ambígua, mercado que
   não é de gols), o código **não toca e não carimba** — o valor do modelo fica, e
   segue auditável. Carimbo indevido é pior que não mexer: ele mascara o erro e
   ainda blinda o número da revisão posterior.
11. **Falha degrada, não quebra**: fonte fora do ar → cascata segue; coleta
   inteira falha → análise direta com `_coletaOk:false` e confiança menor.

## 4. Como evoluir

- **Nova liga:** adicionar a entrada em `js/comp/competitions.js` (ids ESPN/AF/FD)
  — o resto do pipeline é agnóstico de liga. Atenção ao resolver liga por id:
  `getComp()` devolve `COMPETITIONS[id] || COMPETITIONS.brsa`, ou seja **id
  desconhecido não lança — cai no padrão**. O motor avisa pelo `log` do host
  quando recebe um id fora da lista; trate esse aviso como erro de integração.
- **Nova fonte de dados:** registrar em `js/data/free-sources.js` (fontes sem
  chave) ou seguir o padrão de `football-apis.js` (com chave + throttle +
  detecção de limite de plano). A cascata está em `phase1-context.js`.
- **Novo campo no relatório:** adicionar no contrato textual do prompt da Fase 2
  (`prompts.js`) e no consumo (`normalize.js`); se também entrar na coleta,
  respeitar a regra 4 (paridade template↔schema da Fase 1).
- **Trocar modelos:** `model` no `createEngine`; o resgate usa tier superior por
  princípio — mantenha.

## 5. Rotina de verificação

```bash
node tests/motor.mjs    # análise completa headless, API stubada — deve terminar MOTOR ALL PASSED
```

Rode após qualquer mudança. Para teste com API real, use uma chave própria e um
jogo da rodada; inspecione `analysis.lacunas` e `analysis._lineupsFonte` — os
dois dizem a verdade sobre a qualidade daquela análise.
