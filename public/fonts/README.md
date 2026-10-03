# Fontes do renderer

Estas fontes são usadas tanto pelo preview rápido (navegador, via `FontFace`) quanto pelo
renderer de produção (servidor, via `@napi-rs/canvas`). Usar o mesmo arquivo nos dois lados
é o que mantém o preview o mais próximo possível da arte final.

| Arquivo                  | Família          | Licença     |
|--------------------------|------------------|-------------|
| inter-bold.ttf           | Inter Bold       | SIL OFL 1.1 |
| inter-black.ttf          | Inter Black      | SIL OFL 1.1 |
| montserrat-extrabold.ttf | Montserrat ExtraBold | SIL OFL 1.1 |
| roboto-mono-bold.ttf     | Roboto Mono Bold | Apache 2.0  |

Para adicionar uma fonte: coloque o `.ttf` aqui e registre-a em `src/lib/renderer/fonts.ts`.
Nunca remova ou substitua um arquivo já usado por uma versão de template bloqueada: isso
alteraria a reimpressão de lotes antigos.
