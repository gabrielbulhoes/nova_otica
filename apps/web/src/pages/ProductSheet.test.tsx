import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { demoHandle } from '../api/demo';

/*
 * A CHAMADA É INTERCEPTADA, O PAYLOAD NÃO É INVENTADO.
 *
 * O adaptador de demonstração do axios só é instalado quando VITE_DEMO=1, que
 * não é o caso aqui — sem este mock a tela tentaria falar com 127.0.0.1:3000.
 * O que devolvemos é o que o dispatcher da demonstração devolve de verdade,
 * pelo mesmo motivo de sempre: objeto escrito à mão no teste tem os campos que
 * o teste imaginou.
 */
vi.mock('../api/client', async () => {
  const real = await vi.importActual<typeof import('../api/client')>('../api/client');
  const { demoHandle: handle } = await import('../api/demo');
  return {
    ...real,
    getFichaTecnica: async (id: string) => {
      const r = handle({ method: 'get', url: `/products/${id}/ficha`, params: {}, body: {} }) as Record<
        string,
        unknown
      >;
      if (r && typeof r === 'object' && '__status' in r) throw new Error('404');
      return r;
    },
  };
});

import { ProductSheet } from './ProductSheet';

/**
 * A FICHA TÉCNICA — rodada final · item 02.
 *
 * O payload vem do DISPATCHER da demonstração, não de um objeto escrito à mão
 * aqui: um objeto inventado no teste tem os campos que o teste imaginou, e foi
 * exatamente assim que uma coluna saiu vazia numa entrega inteira com
 * typecheck verde — a tela lia um nome e a API mandava outro.
 */
const pedirFicha = (id: string) =>
  demoHandle({ method: 'get', url: `/products/${id}/ficha`, params: {}, body: {} }) as Record<string, any>;

const primeiroProduto = () => {
  const lista = demoHandle({ method: 'get', url: '/products', params: {}, body: {} }) as {
    rows: { id: string }[];
  };
  return lista.rows[0].id;
};

const renderFicha = (id: string) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/admin/produtos/${id}`]}>
        <Routes>
          <Route path="/admin/produtos/:id" element={<ProductSheet />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe('ficha técnica do SKU', () => {
  it('a demonstração responde a rota com o contrato inteiro', () => {
    const f = pedirFicha(primeiroProduto());
    expect(f.identificacao.modelo).toBeTruthy();
    expect(f.identificacao.tipo).toBeTruthy();
    expect(Array.isArray(f.estoque.porLoja)).toBe(true);
    expect(f.estoque.total).toBe(
      f.estoque.porLoja.reduce((a: number, l: { quantidade: number }) => a + l.quantidade, 0),
    );
    // Doze meses SEMPRE, inclusive os vazios.
    expect(f.vendas.mensal).toHaveLength(12);
    expect(f.vendas.justificativa).toContain('Estoque');
    expect(f.comercial.faixa.rotulo).toMatch(/^R\$ /);
  });

  it('peça inexistente devolve 404 em vez de uma ficha vazia', () => {
    expect(pedirFicha('nao-existe').__status).toBe(404);
  });

  it('a tela mostra as seções e o estoque por loja', async () => {
    const id = primeiroProduto();
    const f = pedirFicha(id);
    renderFicha(id);
    expect(await screen.findByText('Identificação')).toBeTruthy();
    expect(screen.getByText('Atributos')).toBeTruthy();
    expect(screen.getByText('Comercial')).toBeTruthy();
    expect(screen.getByText('Estoque por loja')).toBeTruthy();
    expect(screen.getByText('Vendas e giro')).toBeTruthy();
    expect(screen.getByText(`Total em ${f.estoque.porLoja.length} lojas`)).toBeTruthy();
    // A justificativa mínima (item 07) aparece na ficha, não só na compra.
    expect(screen.getByText(f.vendas.justificativa)).toBeTruthy();
  });

  it('campo sem dado aparece com travessão em vez de sumir da ficha', async () => {
    // Uma peça sem ficha do fornecedor existe no dataset de propósito: é o que
    // deixa o buraco de cadastro visível em vez de escondido.
    const lista = demoHandle({ method: 'get', url: '/products', params: {}, body: {} }) as {
      rows: { id: string }[];
    };
    const semFicha = lista.rows
      .map((p) => ({ id: p.id, f: pedirFicha(p.id) }))
      .find((x) => x.f.atributos?.formatoLente?.chave === null);
    expect(semFicha, 'o dataset da demo precisa ter peça sem ficha').toBeTruthy();
    renderFicha(semFicha!.id);
    expect(await screen.findByText('Formato da lente')).toBeTruthy();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });
});
