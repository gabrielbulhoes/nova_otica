import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/*
 * A CHAMADA É INTERCEPTADA, O PAYLOAD NÃO É INVENTADO — mesma disciplina da
 * ficha técnica: o que a tela recebe é o que o dispatcher da demonstração
 * devolve de verdade. Objeto escrito à mão no teste tem os campos que o teste
 * imaginou, e foi assim que uma coluna saiu vazia numa entrega verde.
 */
vi.mock('../api/client', async () => {
  const real = await vi.importActual<typeof import('../api/client')>('../api/client');
  const { demoHandle } = await import('../api/demo');
  const chamar = (url: string, params: Record<string, unknown> = {}) =>
    demoHandle({
      method: 'get',
      url,
      params: params as Record<string, string | string[] | undefined>,
      body: {},
    }) as never;
  return {
    ...real,
    getStores: async () => chamar('/stores'),
    getPlanningOverview: async (p: Record<string, unknown>) => chamar('/planning/overview', p),
    getPurchaseSuggestions: async (p: Record<string, unknown>) => chamar('/planning/purchase-suggestions', p),
    getRebalancePlan: async (p: Record<string, unknown>) => chamar('/planning/rebalance', p),
    getOpcoesDeFiltro: async (p: Record<string, unknown>) => chamar('/planning/filtros', p),
    getPurchaseOrders: async (p: Record<string, unknown>) => chamar('/planning/purchase-orders', p),
    getSupplierSettings: async () => chamar('/planning/suppliers'),
    getPurchaseOrderHistory: async () => chamar('/planning/purchase-orders/history'),
    getFilaDeDistribuicao: async () => chamar('/planning/fila-de-distribuicao'),
    getMixDeGrifes: async () => chamar('/planning/brand-mix'),
    getMixPorLoja: async () => chamar('/planning/mix-por-loja'),
    getMixPorPerfil: async (p: Record<string, unknown>) => chamar('/planning/mix-por-perfil', p),
  };
});

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ isAdmin: true, user: { role: 'ADMIN' } }),
}));

import { Planning } from './Planning';

/**
 * AS DUAS PORTAS QUE O CLIENTE PEDIU — rodada final final · itens 01 e 02.
 *
 *  01 · "Adicionar um botão para que os parâmetros possam ser escolhidos antes
 *        de iniciar o carregamento dos gráficos."
 *  02 · "Criar filtro de compra na barra de menu lateral, com um botão para
 *        cada fornecedor onde aparecerá apenas o pedido desse fornecedor."
 *
 * São de INTERFACE, e por isso são testadas na interface: o motor já estava
 * certo nos dois casos (os pedidos sempre vieram agrupados por fornecedor), e
 * um teste de API passaria verde sem que nenhuma das duas portas existisse.
 */
const renderPlanejamento = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/admin/planejamento']}>
        <Planning />
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe('item 01 · a tela não calcula nada antes de alguém pedir', () => {
  it('chega com o convite e o botão, não com a tabela', async () => {
    renderPlanejamento();
    expect(screen.getByText(/Escolha o recorte e carregue/i)).toBeTruthy();
    // DOIS botões de carregar: o da barra e o do convite no meio da tela. É
    // deliberado — quem chega olha para o centro, quem volta olha para a barra.
    expect(screen.getAllByRole('button', { name: /Carregar/i })).toHaveLength(2);
    // O que não pode estar na tela: qualquer número de compra calculado.
    expect(screen.queryByText(/Pedidos por fornecedor/i)).toBeNull();
  });

  it('o clique em Carregar traz a tela inteira', async () => {
    const u = userEvent.setup();
    renderPlanejamento();
    await u.click(screen.getAllByRole('button', { name: /Carregar/i })[0]);
    await waitFor(() => expect(screen.getByText(/O que fazer hoje/i)).toBeTruthy());
    expect(screen.queryByText(/Escolha o recorte e carregue/i)).toBeNull();
  });

  it('mexer num parâmetro AVISA que os números são do recorte anterior', async () => {
    /*
     * O aviso é a metade que impede a correção de criar um defeito pior: com o
     * conteúdo antigo na tela sob um rótulo novo, a página passaria a mentir
     * silenciosamente — que é pior que demorar a carregar.
     */
    const u = userEvent.setup();
    renderPlanejamento();
    await u.click(screen.getAllByRole('button', { name: /Carregar/i })[0]);
    await waitFor(() => expect(screen.getByText(/O que fazer hoje/i)).toBeTruthy());

    await u.selectOptions(screen.getByLabelText('Período de análise'), '30');
    expect(screen.getByText(/ainda são do recorte anterior/i)).toBeTruthy();

    // E aplicar faz o aviso sumir.
    await u.click(screen.getAllByRole('button', { name: /Aplicar/i })[0]);
    await waitFor(() => expect(screen.queryByText(/ainda são do recorte anterior/i)).toBeNull());
  });
});

describe('item 02 · um botão por fornecedor, e só o pedido dele', () => {
  const abrirCompras = async (u: ReturnType<typeof userEvent.setup>) => {
    // A JANELA DE 30 DIAS não é detalhe do teste: é o recorte em que o catálogo
    // da demonstração tem compra a fazer. Com 90 dias o estoque cobre tudo e a
    // lista sai vazia — o teste passaria a provar que não há trilho.
    await u.selectOptions(screen.getByLabelText('Período de análise'), '30');
    await u.click(screen.getAllByRole('button', { name: /Carregar/i })[0]);
    await waitFor(() => expect(screen.getByText(/O que fazer hoje/i)).toBeTruthy());
    await u.click(screen.getByRole('button', { name: /Comprar de fornecedor/i }));
    await waitFor(() => expect(screen.getByText(/Pedidos por fornecedor/i)).toBeTruthy());
  };

  it('o trilho lista os fornecedores do recorte, com itens e valor', async () => {
    const u = userEvent.setup();
    renderPlanejamento();
    await abrirCompras(u);

    const trilho = await screen.findByRole('navigation', { name: /Filtro por fornecedor/i });
    const botoes = within(trilho).getAllByRole('button');
    // "Todos" + pelo menos um fornecedor.
    expect(botoes.length).toBeGreaterThan(1);
    expect(botoes[0].textContent).toMatch(/Todos os fornecedores/i);
    // Cada botão carrega o que decide a escolha — sem isso o trilho seria uma
    // lista de nomes e o comprador abriria um a um para achar o urgente.
    expect(botoes[1].textContent).toMatch(/\d+ it(em|ens)/);
    expect(botoes[1].textContent).toMatch(/R\$/);
  });

  it('escolher um fornecedor deixa na tela só o pedido dele', async () => {
    const u = userEvent.setup();
    renderPlanejamento();
    await abrirCompras(u);

    const trilho = await screen.findByRole('navigation', { name: /Filtro por fornecedor/i });
    const botoes = within(trilho).getAllByRole('button');
    if (botoes.length < 3) return; // demonstração com um fornecedor só: nada a provar

    const escolhido = botoes[1].querySelector('.trilho-nome')!.textContent!;
    const outro = botoes[2].querySelector('.trilho-nome')!.textContent!;
    await u.click(botoes[1]);

    await waitFor(() => expect(botoes[1].getAttribute('aria-pressed')).toBe('true'));
    expect(screen.getByText(/Mostrando só/i)).toBeTruthy();

    // O card do outro fornecedor sai da lista — mas o BOTÃO dele continua no
    // trilho, senão escolher um fornecedor tiraria a porta de volta.
    const cards = document.querySelectorAll('.compras-com-trilho > div:last-child .card');
    const textos = [...cards].map((c) => c.textContent ?? '').join(' ');
    expect(textos).toContain(escolhido);
    expect(textos).not.toContain(outro);
    expect(within(trilho).getAllByRole('button').length).toBe(botoes.length);
  });

  it('"Todos os fornecedores" devolve a lista inteira', async () => {
    const u = userEvent.setup();
    renderPlanejamento();
    await abrirCompras(u);

    const trilho = await screen.findByRole('navigation', { name: /Filtro por fornecedor/i });
    const botoes = within(trilho).getAllByRole('button');
    if (botoes.length < 3) return;

    await u.click(botoes[1]);
    await waitFor(() => expect(screen.getByText(/Mostrando só/i)).toBeTruthy());
    await u.click(botoes[0]);
    await waitFor(() => expect(screen.queryByText(/Mostrando só/i)).toBeNull());
    expect(botoes[0].getAttribute('aria-pressed')).toBe('true');
  });
});
