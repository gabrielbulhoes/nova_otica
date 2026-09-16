# Padronização do catálogo — formato da lente e material da armação

Esta é a ordem de operações para deixar a base pronta para a composição do mix
por perfil. Vale para quem opera o servidor; nenhum passo aqui precisa de
credencial nova, e nenhum apaga dado.

## O que muda na base

Duas colunas novas em `ProductAttribute` (`formatoLente` e `materialArmacao`)
com valores de uma **lista fechada**: Retangular, Quadrada, Redonda, Oval,
Aviador, Gatinho, Geométrica, Wayfarer, Máscara, Outros — e Acetato, Metal,
Titânio, Aço inoxidável, Alumínio, Injetado, TR90, Nylon, Madeira, Combinado,
Outros. Mais `Não identificado`, que é **valor**, não ausência.

O texto de origem continua guardado, em `formato` e `material`, exatamente
como cada fonte escreveu. Ele é a auditoria: permite conferir qualquer
classificação e refazer o dicionário de sinônimos sem reimportar nada.

**`NULL` e `Não identificado` são coisas diferentes**, e pedem ações opostas:

| Estado | O que significa | O que fazer |
| --- | --- | --- |
| `NULL` | ninguém olhou ainda | rodar o padronizador |
| `NAO_IDENTIFICADO` | alguém olhou e o dado não permitiu dizer | pedir a ficha ao fornecedor, ou acrescentar a grafia ao dicionário |

## Ordem

### 1. Publicar

O deploy aplica a migração `a16_rodada_final` sozinho, no entrypoint. Nada a
fazer além do `deploy.sh` de sempre.

### 2. Deixar a sincronização rodar uma vez

A sincronização diária passou a gravar os atributos que o ERP **já mandava** e
que eram descartados: gênero, formato do aro, material do aro e das hastes,
cor, dimensões e a primeira foto. É a fonte de maior cobertura da rede.

Duas regras governam essa escrita, e vale conhecê-las antes de conferir
números:

- **O ERP preenche buraco, não sobrescreve ficha.** Onde a planilha do
  fornecedor já escreveu, o ERP passa ao largo.
- **Campo vazio no ERP não apaga nada.** Uma peça que perdeu o gênero no
  cadastro do CDS não zera o gênero que a ficha trouxe.

Depois da primeira sincronização, confira:

```
curl -s https://<host>/health | jq '.atributos'
```

O bloco `padronizacao` mostra quantas peças têm cada campo classificado,
quantas ficaram em `naoIdentificado` e **de qual fonte** cada classificação
veio. Uma base 90% classificada a partir da descrição merece outra confiança
que uma base 90% vinda da ficha do fornecedor — por isso os dois números são
separados.

### 3. Ensaiar a padronização

```
node apps/api/dist/catalogo/padronizar.js
```

**Ensaio por padrão: nada é gravado.** O comando percorre o catálogo inteiro e
imprime o que faria — quantas peças classificaria, por fonte e por campo,
quantas já estão prontas, quantas dependem de ficha do fornecedor, e quantas
estão fora do escopo (relógio, lente e acessório não têm aro nem lente).

O último bloco do relatório é o mais útil no médio prazo: os **30 textos mais
frequentes que o padronizador não entendeu**. Cada linha ali é uma grafia que
algum fornecedor usa e que ainda não está no dicionário de sinônimos. É assim
que o dicionário cresce — com o que chega, não com o que se imagina que possa
chegar.

### 4. Conferir e gravar

Se o relatório fizer sentido:

```
node apps/api/dist/catalogo/padronizar.js --gravar
```

Rodar duas vezes seguidas é seguro: a segunda execução não encontra nada a
fazer. Escrever valor idêntico por cima do que já está lá está explicitamente
impedido — o comando só grava o que **muda**.

### 5. Conferir de novo

```
curl -s https://<host>/health | jq '.atributos.padronizacao'
```

É esse número que autoriza a tela de composição do mix a ser lida como
recomendação. Abaixo de 5% das vendas com ficha completa, a própria tela se
recusa a recomendar e diz por quê; entre 5% e 50% ela recomenda declarando que
a leitura é parcial.

**A resposta é imediata.** Se o número não mudar depois de um `--gravar` que
declarou peças gravadas, é problema de verdade — não é cache. Vale conferir
`versao` no `/health` e o `DATABASE_URL` com que o comando rodou.

> Nem sempre foi assim. Em 16/09/2026 o padronizador gravou 2.559 peças e o
> `/health` seguiu dizendo `formato.naoIdentificado: 989` por um minuto: a
> resposta ficava guardada na memória do processo da API, e o comando — que roda
> por `docker exec`, em outro processo — limpava a memória dele, não a dela. A
> operação foi conferir no banco achando que a gravação tinha falhado. Hoje a
> memória só é reaproveitada enquanto um carimbo lido do banco continuar igual,
> então um `--gravar` de qualquer processo aparece na leitura seguinte.

## Quando chegar uma planilha nova de fornecedor

```
npm run catalogo:importar -- cadastro-fornecedor.xlsx
```

A importação já padroniza junto, com procedência `ficha` — não é preciso rodar
o padronizador depois. Os cabeçalhos são reconhecidos sem acento e por
sinônimos ("Formato", "Formato da armação", "Shape", "Frame material"…), e a
coluna que não casar com sinônimo nenhum é **declarada no relatório** em vez de
ignorada em silêncio.
