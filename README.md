# Motor Meridian

Versão atual: **1.0.2** — o que mudou está em [`motor/CHANGELOG.md`](motor/CHANGELOG.md).

Motor headless de análise de futebol pré e pós-jogo, multi-liga, com chat calibrado.
Roda em Node, sem interface própria: a apresentação é sua.

## Comece por aqui

1. **`node tests/motor.mjs`** — precisa terminar em `MOTOR ALL PASSED`. Roda sem chave
   nenhuma (tudo com stubs) e prova que o pacote carrega e compõe nesta máquina.
2. **[`motor/SKILL.md`](motor/SKILL.md)** — o contrato de uso: requisitos, entrada, saída,
   modelos e custo, e a seção "Como o motor raciocina", que explica de onde sai cada número.
3. **`node motor/exemplo-integracao.mjs "PARTIDA: Time A x Time B"`** com a sua chave em
   `ANTHROPIC_KEY`, num jogo real da rodada — é o primeiro teste com API de verdade.
4. **[`motor/HANDOFF-ENGENHARIA.md`](motor/HANDOFF-ENGENHARIA.md)** — o porquê de cada
   decisão e as regras que não devem ser violadas na manutenção.

## Dois pontos que evitam a maior parte do atrito inicial

- **Mantenha a estrutura de pastas.** O motor resolve os módulos a partir da própria
  localização, então `motor/` e `js/` precisam ser pastas irmãs. Copiar só o `engine.mjs`
  para dentro do seu projeto quebra o carregamento.
- **O `model` da configuração controla só a Fase 2 e o chat.** Outras etapas chamam
  modelos próprios e entram na sua fatura; a tabela por etapa está no `SKILL.md`.

## Atualizações

Cada versão chega como um commit novo aqui. `git pull`, confira o diff e leia o
`CHANGELOG.md` — correções que **mudam números exibidos** vêm marcadas com ⚠, para você
saber quando uma diferença em teste de regressão é legítima.

Para confirmar em runtime qual versão está rodando:

```js
const engine = await createEngine({ apiKey });
console.log(engine.version);
```
