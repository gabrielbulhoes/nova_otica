import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getProducts, getCategories, formatBRL } from '../api/client';
import { PageHeader, Loading, Codigo } from '../components/ui';
import { Icon } from '../brand/Icon';
import { useScope } from '../lib/scope';

export function Products() {
  const { scope } = useScope();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');

  const categories = useQuery({ queryKey: ['categories', scope], queryFn: () => getCategories({ group: scope }) });
  const products = useQuery({
    queryKey: ['products', search, category, scope],
    queryFn: () =>
      getProducts({ search: search || undefined, category: category || undefined, group: scope, limit: 200 }),
  });

  return (
    <>
      {/* Nenhum botão sólido: o catálogo é espelho da fonte (Sellbie). Não se
          cria nem se edita produto aqui — a tela não tem ação principal, e
          inventar uma seria mentir sobre o que ela faz. */}
      <PageHeader
        eyebrow="Consulta"
        title="Produtos"
        subtitle="Catálogo sincronizado da fonte (Sellbie)."
      />

      <div className="toolbar">
        <input
          aria-label="Buscar por descrição, SKU ou marca"
          placeholder="Buscar por descrição, SKU ou marca…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ minWidth: 260 }}
        />
        <select aria-label="Filtrar por categoria" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">Todas as categorias</option>
          {categories.data?.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        {products.isLoading ? (
          <Loading />
        ) : products.data && products.data.rows.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th>Código</th>
                <th>Descrição</th>
                <th>Marca</th>
                <th>Categoria</th>
                <th>Cor</th>
                <th>Tam.</th>
                <th className="num">Preço</th>
              </tr>
            </thead>
            <tbody>
              {products.data.rows.map((p) => (
                <tr key={p.id}>
                  {/* Código fica à ESQUERDA de propósito: `.num` é para
                      grandeza (quantidade, dinheiro), que se compara pelo
                      alinhamento das casas. Identificador não se soma nem se
                      compara — alinhá-lo à direita sugeriria uma ordem de
                      magnitude que ele não tem.

                      ONDA 6 · e agora ele vai em <Codigo>. Medido nesta build:
                      as seis telas de operação tinham ZERO `.codigo` — o SKU, o
                      número da venda e a data/hora saíam todos em Inter
                      proporcional, junto do texto descritivo. É o outro lado da
                      dosagem: a mono estava sobrando onde se LÊ e faltando
                      exatamente onde ela é função. "RB4446L" contra "RB4446I" é
                      comparação caractere a caractere, e é a largura fixa que
                      faz a diferença saltar. Caixa normal, entreletras zero —
                      caixa alta espaçada atrapalharia essa mesma comparação. */}
                  <td>
                    <Codigo>{p.externalId}</Codigo>
                  </td>
                  <td>{p.description}</td>
                  {/* ONDA 6 · A COLUNA "MARCA" TRAZ A RAZÃO SOCIAL, NÃO A MARCA.
                      Medido nesta build, a 1440px: a fonte devolve "LUXOTTICA
                      BRASIL PRODUTOS OTICOS E ESPORTIVOS LTDA" (50 caracteres)
                      onde o gestor espera "Ray-Ban". O efeito é duplo e é o
                      próprio "ficou mais confusa as informações": a coluna
                      ocupava 367px — praticamente o mesmo que DESCRIÇÃO, com
                      375px, que é a coluna que se lê —, e 118 das 440 linhas
                      saíam com duas linhas de altura por causa dela.

                      Não mexo no DADO: corrigir o mapeamento fabricante ×
                      marca é assunto da camada de integração, e inventar aqui
                      um "Ray-Ban" que a fonte não mandou seria mentir sobre o
                      catálogo. O que se corrige é a LARGURA, que é problema de
                      legibilidade: uma linha só, com reticências, teto de
                      220px, e o nome inteiro no `title`. Nada se perde e a
                      largura devolvida vai para a descrição — onde a marca de
                      verdade, aliás, já está escrita ("... OCULOS RAY BAN"). */}
                  <td
                    title={p.brand ?? undefined}
                    style={{
                      maxWidth: 220,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {p.brand ?? '—'}
                  </td>
                  <td>{p.category ?? '—'}</td>
                  <td>{p.color?.name ?? '—'}</td>
                  <td>{p.size?.name ?? '—'}</td>
                  <td className="num">{formatBRL(p.price)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div
            className="empty"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}
          >
            <Icon name="buscar" size={18} />
            <span>Nenhum produto encontrado. Ajuste a busca ou a categoria.</span>
          </div>
        )}
      </div>
      {products.data && (
        // ONDA 6 · era `.label`. `.label` NOMEIA um dado ("Unidades em
        // estoque") e vem em Inter 600 — semibold. Isto aqui não nomeia nada:
        // é uma frase de rodapé que conta o que a tabela mostra. Em 600 ela
        // pesa o mesmo que o rótulo de um indicador e disputa atenção com a
        // tabela inteira. `.hint` é o papel certo: Inter 12/400.
        <p className="hint" style={{ marginTop: 10 }}>
          {products.data.rows.length.toLocaleString('pt-BR')} de{' '}
          {products.data.total.toLocaleString('pt-BR')} produtos
        </p>
      )}
    </>
  );
}
