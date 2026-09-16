import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { formatBRL, getFichaTecnica, type FichaTecnica } from '../api/client';
import { Codigo, Loading, PageHeader } from '../components/ui';
import { Icon } from '../brand/Icon';

/**
 * A FICHA TÉCNICA DE UMA PEÇA — rodada final · item 02.
 *
 * "Ao clicar em um SKU, deve abrir uma ficha técnica completa."
 *
 * A regra que organiza esta tela: CAMPO SEM DADO APARECE MESMO ASSIM, com
 * travessão. Esconder a linha vazia deixaria a ficha parecendo completa e
 * faria o comprador concluir que a rede sabe o que ela não sabe — e é
 * exatamente o buraco de cadastro que esta rodada existe para expor. Onde o
 * dado tem procedência, ela vem escrita ao lado: "ficha do fornecedor" e
 * "cadastro do ERP" têm confiabilidades diferentes, e quem decide precisa
 * saber qual está lendo.
 */

const FONTE_LEGIVEL: Record<string, string> = {
  ficha: 'ficha do fornecedor',
  erp: 'cadastro do ERP',
  descricao: 'lido da descrição',
  demo: 'demonstração',
};

const traco = <span style={{ color: 'var(--tinta-3)' }}>—</span>;

function Campo({
  rotulo,
  children,
  fonte,
}: {
  rotulo: string;
  children?: React.ReactNode;
  fonte?: string | null;
}) {
  const vazio = children === null || children === undefined || children === '';
  return (
    <div style={{ padding: '7px 0', borderBottom: '1px solid var(--linha)' }}>
      <div className="label" style={{ marginBottom: 2 }}>
        {rotulo}
      </div>
      <div style={{ fontSize: 14 }}>{vazio ? traco : children}</div>
      {fonte && !vazio && (
        <div className="hint" style={{ marginTop: 2 }}>
          {FONTE_LEGIVEL[fonte] ?? fonte}
        </div>
      )}
    </div>
  );
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="card" style={{ marginBottom: 16 }}>
      <h2 style={{ fontSize: 15, marginTop: 0, marginBottom: 6 }}>{titulo}</h2>
      {children}
    </section>
  );
}

const mm = (v: number | null) => (v === null ? null : `${v} mm`);

/**
 * O texto de origem só aparece quando ACRESCENTA alguma coisa.
 *
 * O rótulo da lista fechada carrega o sinônimo entre parênteses ("Máscara
 * (shield)", "Gatinho (cat-eye)"), e comparar com ele inteiro fazia a ficha
 * escrever «Máscara (shield) · no cadastro: "Máscara"» — repetir a mesma
 * palavra com ar de conferência.
 */
const divergeDoRotulo = (original: string | null, rotulo: string): boolean => {
  if (!original) return false;
  const limpo = (t: string) =>
    t
      .replace(/\s*\(.*\)$/, '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  return limpo(original) !== limpo(rotulo);
};

/** Barras do histórico mensal: doze meses, inclusive os vazios. */
function HistoricoMensal({ meses }: { meses: FichaTecnica['vendas']['mensal'] }) {
  const teto = Math.max(1, ...meses.map((m) => m.unidades));
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 120, marginTop: 8 }}>
        {meses.map((m) => (
          <div key={m.mes} style={{ flex: 1, textAlign: 'center' }}>
            <div
              title={`${m.mes}: ${m.unidades} un. · ${formatBRL(m.receita)}`}
              style={{
                height: Math.max(2, Math.round((m.unidades / teto) * 96)),
                background: m.unidades > 0 ? 'var(--ouro)' : 'var(--linha)',
                borderRadius: 2,
              }}
            />
            <div className="hint" style={{ fontSize: 10, marginTop: 4 }}>
              {m.mes.slice(5)}
            </div>
          </div>
        ))}
      </div>
      <p className="hint" style={{ marginTop: 6 }}>
        Unidades por mês nos últimos 12 meses. Mês sem venda aparece vazio — uma linha contínua
        sobre o buraco diria "vendeu sempre".
      </p>
    </div>
  );
}

export function ProductSheet() {
  const { id = '' } = useParams();
  const ficha = useQuery({ queryKey: ['ficha', id], queryFn: () => getFichaTecnica(id), enabled: !!id });

  if (ficha.isLoading) return <Loading />;
  if (ficha.isError || !ficha.data) {
    return (
      <>
        <PageHeader eyebrow="Consulta" title="Ficha técnica" />
        <div className="empty">
          Peça não encontrada. <Link to="/admin/produtos">Voltar para Produtos</Link>
        </div>
      </>
    );
  }

  const f = ficha.data;
  const id90 = f.vendas.periodos.find((p) => p.dias === 90);

  return (
    <>
      <PageHeader
        eyebrow="Consulta · ficha técnica"
        title={f.identificacao.modelo}
        subtitle={[f.identificacao.grife, f.identificacao.tipo].filter(Boolean).join(' · ')}
        actions={
          <Link to="/admin/produtos" className="btn ghost sm">
            <Icon name="buscar" size={15} /> Voltar para Produtos
          </Link>
        }
      />

      <div className="grid-2" style={{ alignItems: 'start' }}>
        <Secao titulo="Identificação">
          <Campo rotulo="SKU">{f.identificacao.sku ? <Codigo>{f.identificacao.sku}</Codigo> : null}</Campo>
          <Campo rotulo="Código no ERP">
            <Codigo>{f.identificacao.externalId}</Codigo>
          </Campo>
          <Campo rotulo="Referência do fornecedor">{f.identificacao.referencia}</Campo>
          <Campo rotulo="Grife">{f.identificacao.grife}</Campo>
          <Campo rotulo="Marca no catálogo do fornecedor">{f.identificacao.marcaCatalogo}</Campo>
          <Campo rotulo="Categoria">{f.identificacao.categoria}</Campo>
          <Campo rotulo="Tipo">{f.identificacao.tipo}</Campo>
          <Campo rotulo="GTIN">{f.identificacao.gtin}</Campo>
        </Secao>

        <Secao titulo="Atributos">
          <Campo rotulo="Gênero" fonte={f.atributos.genero.fonte}>
            {f.atributos.genero.chave ? f.atributos.genero.rotulo : null}
          </Campo>
          <Campo rotulo="Formato da lente" fonte={f.atributos.formatoLente.fonte}>
            {f.atributos.formatoLente.chave ? (
              <>
                {f.atributos.formatoLente.rotulo}
                {divergeDoRotulo(f.atributos.formatoLente.textoOriginal, f.atributos.formatoLente.rotulo) && (
                  <span className="hint"> · no cadastro: “{f.atributos.formatoLente.textoOriginal}”</span>
                )}
              </>
            ) : null}
          </Campo>
          <Campo rotulo="Material da armação" fonte={f.atributos.materialArmacao.fonte}>
            {f.atributos.materialArmacao.chave ? (
              <>
                {f.atributos.materialArmacao.rotulo}
                {divergeDoRotulo(
                  f.atributos.materialArmacao.textoOriginal,
                  f.atributos.materialArmacao.rotulo,
                ) && (
                  <span className="hint"> · no cadastro: “{f.atributos.materialArmacao.textoOriginal}”</span>
                )}
              </>
            ) : null}
          </Campo>
          <Campo rotulo="Cor">{f.atributos.cor}</Campo>
          <Campo rotulo="Dimensões (lente · altura · ponte · haste)">
            {[
              mm(f.atributos.dimensoes.tamanhoLente),
              mm(f.atributos.dimensoes.alturaLente),
              mm(f.atributos.dimensoes.tamanhoPonte),
              mm(f.atributos.dimensoes.tamanhoHaste),
            ].some(Boolean)
              ? [
                  mm(f.atributos.dimensoes.tamanhoLente) ?? '—',
                  mm(f.atributos.dimensoes.alturaLente) ?? '—',
                  mm(f.atributos.dimensoes.tamanhoPonte) ?? '—',
                  mm(f.atributos.dimensoes.tamanhoHaste) ?? '—',
                ].join(' · ')
              : null}
          </Campo>
          <Campo rotulo="Best-seller do fornecedor">
            {f.atributos.bestSellerDoFornecedor
              ? f.atributos.bestSellerNaRede
                ? 'Sim — e gira nesta rede'
                : 'Marcado pelo fornecedor, mas sem giro nesta rede'
              : null}
          </Campo>
        </Secao>

        <Secao titulo="Comercial">
          <Campo rotulo="Preço de venda">{f.comercial.preco === null ? null : formatBRL(f.comercial.preco)}</Campo>
          <Campo rotulo="Custo">
            {f.comercial.custo === null ? null : (
              <>
                {formatBRL(f.comercial.custo)}
                {f.comercial.custoEstimado && <span className="hint"> · estimado (o ERP não trouxe)</span>}
              </>
            )}
          </Campo>
          <Campo rotulo="Margem">{f.comercial.margemPct === null ? null : `${f.comercial.margemPct}%`}</Campo>
          <Campo rotulo="Faixa de preço">{f.comercial.faixa?.rotulo}</Campo>
          <Campo rotulo="Desconto máximo (CDS)">
            {f.comercial.descontoMaximoPct === null ? null : `${f.comercial.descontoMaximoPct}%`}
          </Campo>
        </Secao>

        <Secao titulo="Compra e fornecedor">
          <Campo rotulo="Fornecedor (catálogo de grifes)">{f.compra.fornecedorCanonico}</Campo>
          <Campo rotulo="Última compra">
            {f.compra.ultima ? (
              <>
                {new Date(f.compra.ultima.data).toLocaleDateString('pt-BR')} · {f.compra.ultima.quantidade} un.
                {f.compra.ultima.custoUnitario !== null && ` a ${formatBRL(f.compra.ultima.custoUnitario)}`}
                <div className="hint">
                  {f.compra.ultima.fornecedor} · pedido {f.compra.ultima.pedidoId.slice(0, 10)}
                  {f.compra.ultima.recebidaEm
                    ? ` · recebido em ${new Date(f.compra.ultima.recebidaEm).toLocaleDateString('pt-BR')}`
                    : ' · ainda a caminho'}
                </div>
              </>
            ) : null}
          </Campo>
          <Campo rotulo="Cadastro">
            {f.procedencia.fonteCadastro || f.procedencia.erpEm ? (
              <span className="hint">
                {f.procedencia.fonteCadastro ? FONTE_LEGIVEL[f.procedencia.fonteCadastro] ?? f.procedencia.fonteCadastro : '—'}
                {f.procedencia.cadastroEm &&
                  ` · importado em ${new Date(f.procedencia.cadastroEm).toLocaleDateString('pt-BR')}`}
              </span>
            ) : null}
          </Campo>
        </Secao>
      </div>

      <Secao titulo="Estoque por loja">
        {f.estoque.porLoja.length === 0 ? (
          <p className="hint">Sem posição de estoque nas lojas visíveis para você.</p>
        ) : (
          <>
            <table>
              <thead>
                <tr>
                  <th>Loja</th>
                  <th className="num">Em estoque</th>
                  <th className="num">Reservado</th>
                </tr>
              </thead>
              <tbody>
                {f.estoque.porLoja.map((l) => (
                  <tr key={l.storeId}>
                    <td>{l.loja}</td>
                    <td className="num">{l.quantidade.toLocaleString('pt-BR')}</td>
                    <td className="num">{l.reservado.toLocaleString('pt-BR')}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th>Total em {f.estoque.lojasConsideradas} lojas</th>
                  <th className="num">{f.estoque.total.toLocaleString('pt-BR')}</th>
                  <th className="num">{f.estoque.reservado.toLocaleString('pt-BR')}</th>
                </tr>
              </tfoot>
            </table>
            {f.estoque.aCaminho > 0 && (
              <p className="hint" style={{ marginTop: 8 }}>
                Mais {f.estoque.aCaminho.toLocaleString('pt-BR')} un. a caminho, em pedidos enviados e ainda
                não recebidos.
              </p>
            )}
          </>
        )}
      </Secao>

      <Secao titulo="Vendas e giro">
        <div className="grid-3" style={{ marginBottom: 6 }}>
          {f.vendas.periodos.map((p) => (
            <div key={p.dias}>
              <div className="label">Últimos {p.dias} dias</div>
              <div style={{ fontSize: 20, fontWeight: 600 }}>{p.unidades.toLocaleString('pt-BR')} un.</div>
              <div className="hint">{formatBRL(p.receita)}</div>
            </div>
          ))}
        </div>
        <div className="grid-3">
          <Campo rotulo="Giro">{`${f.vendas.giroDiario.toLocaleString('pt-BR')} un./dia`}</Campo>
          <Campo rotulo="Cobertura">
            {f.vendas.coberturaDias === null ? null : `${Math.round(f.vendas.coberturaDias)} dias`}
          </Campo>
          <Campo rotulo="Sugestão de compra">
            {f.vendas.sugestaoDeCompra > 0 ? `${f.vendas.sugestaoDeCompra} un.` : null}
          </Campo>
        </div>
        {/* A MESMA justificativa da lista de compras (item 07): a ficha não
            pode dizer de uma peça algo diferente do que a tela ao lado diz. */}
        <p className="hint" style={{ marginTop: 8 }}>
          {f.vendas.justificativa}
        </p>
        <HistoricoMensal meses={f.vendas.mensal} />
        {id90 && id90.unidades === 0 && (
          <p className="hint">Sem venda nos últimos 90 dias — o giro acima vem dessa mesma janela.</p>
        )}
      </Secao>

      {f.imagem.url && (
        <Secao titulo="Imagem">
          <img
            src={f.imagem.url}
            alt={`Foto de ${f.identificacao.modelo}`}
            style={{ maxWidth: 320, borderRadius: 4, border: '1px solid var(--linha)' }}
          />
          <p className="hint" style={{ marginTop: 6 }}>
            Origem: {f.imagem.fonte === 'ficha' ? 'ficha do fornecedor' : 'acervo do provador virtual'}.
          </p>
        </Secao>
      )}
    </>
  );
}
