# Dados necessários para operar com dados reais

Documento para envio ao cliente. O sistema já está pronto para receber os
dados — a inteligência de estoque (sugestões de compra, redistribuição entre
lojas e alertas) opera sobre **vendas por loja**, **estoque por loja**,
**catálogo com custo** e **prazos de fornecedores**. Precisamos de UMA das
duas opções abaixo (A é a preferida) **mais** os itens da seção 3, que só o
cliente possui em qualquer cenário.

---

## Opção A (preferida) — Acesso à API Sellbie/CDS

O conector já está implementado; falta apenas o acesso e a confirmação dos
formatos. Precisamos de:

1. **URL base da API** (ex.: `https://api.<dominio-cds>.com.br`).
2. **Credenciais**: token/API key **ou** usuário e senha (basic auth) — o
   conector suporta os dois. Se possível, uma credencial de
   homologação/somente leitura.
3. **Confirmação da janela de uso** — hoje operamos 06:00–07:00 (horário de
   Brasília), conforme a regra informada. Se a janela for outra, basta nos
   dizer.
4. **Um exemplo real de resposta JSON de cada rota** (pode ser capturado no
   Postman/navegador; pode anonimizar CPF/nome). É isso que nos permite
   ajustar os normalizadores com precisão:

| Rota | Alimenta | Campos que esperamos encontrar |
| --- | --- | --- |
| `sellbie/lojas` | Filiais | `idFilial`, `nome`, `cidade`, `uf`, `ativo` |
| `sellbie/vendedores` | Vendedores | `funcionario`, `nome`, `idFilial`, `ativo` |
| `sellbie/cores` | Catálogo | `codigo`, `nome/descricao` |
| `sellbie/tamanhos` | Catálogo | `codigo`, `nome/descricao` |
| `sellbie/produtos` | Catálogo | `prodCodigo`, `sku`, `descricao`, `marca`, `categoria`, `corCodigo`, `tamanhoCodigo`, `precoVenda`, **`precoCusto`**, `ativo` |
| `sellbie/clientes` | Clientes | `cpfCnpj`, `nome`, `email`, `telefone`, `cidade`, `uf` |
| `sellbie/vendas` | Vendas (cabeçalho) | `idVenda`, `idFilial`, `funcionario`, `cpfCnpj`, `dataVenda`, `valorTotal`, `desconto`, `situacao` |
| `sellbie/detalhesVendas` | Itens de venda | `idVenda`, `prodCodigo`, `quantidade`, `valorUnitario`, `valorTotal` |
| `sellbie/pagamentosVendas` | Pagamentos | `idVenda`, `formaPagamento`, `valor`, `parcelas` |
| `sellbie/estoque?cod_loja=` | Saldo por loja | `idFilial`, `prodCodigo`, `quantidade`, `disponivel` |

5. **Filtro por período**: confirmar se `vendas`/`detalhesVendas` aceitam
   `date_start`/`date_end` (aaaa-mm-dd) — usamos isso para importar o
   histórico e para o sync diário incremental.
6. **Histórico**: autorização para importar os **últimos 12 meses de vendas**
   na primeira carga (as previsões de demanda e sazonalidade dependem disso;
   o mínimo utilizável é 90 dias).

> Perguntas úteis para repassar ao suporte da CDS: existe paginação? Qual o
> limite de registros por chamada? Há rate limit além da janela de horário?

---

## Opção B — Exportação por planilhas (se a API não for viável)

Aceitamos `.xlsx` ou `.csv` (separador `;`, datas `aaaa-mm-dd`, decimais com
vírgula ou ponto — só manter consistente). Um arquivo/aba por tabela, com
**exatamente estas colunas** (a ordem não importa; linhas de cabeçalho na
primeira linha):

**1. lojas** — `codigo_loja`, `nome`, `cidade`, `uf`, `ativa (S/N)`

**2. produtos** — `codigo_produto`, `sku`, `descricao`, `marca`, `categoria`,
`cor`, `tamanho`, `preco_venda`, `preco_custo`, `ativo (S/N)`

**3. estoque_atual** — `codigo_loja`, `codigo_produto`, `quantidade`,
`disponivel` *(foto do dia; ideal: export diário automatizado)*

**4. vendas** — `codigo_venda`, `codigo_loja`, `data_venda`, `valor_total`,
`desconto`, `situacao` *(últimos 12 meses)*

**5. itens_venda** — `codigo_venda`, `codigo_produto`, `quantidade`,
`valor_unitario`, `valor_total`

**6. pagamentos** *(opcional, alimenta o BI)* — `codigo_venda`,
`forma_pagamento`, `valor`, `parcelas`

**7. clientes** *(opcional)* — `cpf_cnpj`, `nome`, `email`, `telefone`,
`cidade`, `uf`

Pontos de atenção:
- `codigo_produto` e `codigo_loja` devem ser **os mesmos** em todas as
  planilhas (é a chave que liga tudo).
- Vendas **por item e por loja** são indispensáveis — total mensal
  consolidado não serve para o motor de redistribuição.
- Se as planilhas forem o caminho definitivo (não só a carga inicial),
  precisamos combinar a **frequência** (estoque: diário; vendas: diário ou
  semanal) e o meio de envio (pasta compartilhada, e-mail, FTP).

---

## 3. Dados que só o cliente tem (necessários nas duas opções)

1. **Custo dos produtos** — se não vier no cadastro (`precoCusto`), uma
   planilha `codigo_produto` × `custo`. Sem isso, estimamos 55% do preço de
   venda e os valores de capital ficam aproximados.
2. **Fornecedores e prazos** — tabela simples, uma linha por
   fornecedor/marca:

   | fornecedor (marca) | prazo de entrega (dias corridos, do pedido ao recebimento) | pedido mínimo (R$ ou un., se houver) | contato/e-mail do representante |
   | --- | --- | --- | --- |

   O prazo alimenta o ponto de reposição e o "pedir até"; o contato prepara o
   envio automático de pedidos no futuro.
3. **Estoque mínimo por produto** (opcional) — se a rede já trabalha com
   mínimos definidos, importamos; senão o sistema calcula pelos próprios
   dados de venda.
4. **Janela/horário permitido** de consumo da API (se Opção A) e o
   responsável técnico na CDS/Sellbie para dúvidas de integração.

---

## Checklist para enviar ao cliente (copiar/colar)

```
[ ] URL base da API Sellbie/CDS + credenciais (token OU usuário/senha)
[ ] 1 exemplo real de resposta JSON de cada rota (10 rotas listadas acima)
[ ] Confirmação da janela de uso da API (hoje: 06:00–07:00)
[ ] Autorização para importar 12 meses de histórico de vendas
    — OU, sem API: planilhas 1–5 (lojas, produtos, estoque, vendas, itens)
[ ] Custo dos produtos (se não vier no cadastro)
[ ] Tabela de fornecedores: marca × prazo de entrega × pedido mínimo × contato
[ ] Contato técnico na CDS/Sellbie
```

Com o item “exemplos de payload” em mãos, o ajuste dos normalizadores é
pontual (2 arquivos: `types.ts` e `mappers.ts`) — o restante do sistema não
muda.
