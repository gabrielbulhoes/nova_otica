import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getAlerts, getSummary } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useScope } from '../lib/scope';
import { Mark } from '../brand/Brand';
import { Icon } from '../brand/Icon';
import { CATEGORIAS, modulosVisiveis, type Categoria, type Modulo } from '../lib/modulos';

/**
 * CENTRAL DE OPERAÇÕES — a tela de entrada do console.
 *
 * O que ela substitui: uma lista de 15 links de texto que, no celular, ocupava
 * cinco linhas antes de qualquer conteúdo e não dizia a que área cada tela
 * pertencia. Aqui as mesmas telas viram sete cartões agrupados por categoria —
 * o usuário lê SETE nomes, não quinze, e cada cartão diz o que se resolve
 * dentro dele.
 *
 * Sobre a aparência: o manual NANOFLOW põe superfície como papel (canto reto,
 * filete de 1px, sem sombra difusa). O arredondado da marca é o CORTE
 * ASSIMÉTRICO — o mesmo do símbolo e do botão —, e é ele que aparece na placa
 * do ícone. Elevação no hover é feita com o filete dourado e uma lavagem, não
 * com sombra: é o vocabulário que o resto do produto já usa.
 */

/** Saudação pela hora local — quem opera a rede abre isso todo dia. */
function saudacao(hora = new Date().getHours()): string {
  if (hora < 12) return 'Bom dia';
  if (hora < 18) return 'Boa tarde';
  return 'Boa noite';
}

/** Primeiro nome: o cabeçalho cumprimenta, não identifica em cartório. */
const primeiroNome = (nome?: string | null) => (nome ?? '').trim().split(/\s+/)[0] ?? '';

/**
 * Normaliza para busca: sem acento e em minúscula, para "estrategia" achar
 * "Estratégia" e "decisoes" achar "Decisões".
 */
const chaveDeBusca = (s: string) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export function Central() {
  const { user, isAdmin } = useAuth();
  const { scope } = useScope();
  const navigate = useNavigate();
  const [busca, setBusca] = useState('');

  const modulos = useMemo(() => modulosVisiveis(isAdmin), [isAdmin]);

  /*
     AVISOS — contagem real, sem endpoint novo.
     As duas consultas são exatamente as que o Painel já faz, com a MESMA chave
     de cache: abrir a Central e depois o Painel não custa uma requisição a
     mais, e o número do cartão é o mesmo número da tela de destino.
  */
  const summary = useQuery({ queryKey: ['summary', scope], queryFn: () => getSummary({ group: scope }) });
  const alerts = useQuery({ queryKey: ['alerts', scope], queryFn: () => getAlerts({ group: scope }) });

  /** Pendências por rota. O cartão soma as das suas páginas. */
  const avisoPorRota: Record<string, number> = {
    '/admin/alertas': alerts.data?.out ?? 0,
    '/admin/transferencias': summary.data?.pendingMovements ?? 0,
  };
  const avisoDoModulo = (m: Modulo) =>
    m.paginas.reduce((soma, p) => soma + (avisoPorRota[p.to] ?? 0), 0);

  /*
     BUSCA GLOBAL — casa o nome do módulo, a descrição E o nome das páginas
     internas. É o que faz o agrupamento não esconder nada: quem procura
     "alertas" acha o cartão Estoque, que é onde Alertas mora agora.
  */
  const termo = chaveDeBusca(busca.trim());
  const filtrados = useMemo(() => {
    if (!termo) return modulos;
    return modulos.filter((m) => {
      const alvo = [m.nome, m.descricao, m.categoria, ...m.paginas.map((p) => p.label)]
        .map(chaveDeBusca)
        .join(' · ');
      return alvo.includes(termo);
    });
  }, [modulos, termo]);

  /** Páginas que casaram, para mostrar dentro do cartão durante a busca. */
  const paginasQueCasam = (m: Modulo) =>
    termo ? m.paginas.filter((p) => chaveDeBusca(p.label).includes(termo)) : [];

  const porCategoria = (c: Categoria) => filtrados.filter((m) => m.categoria === c);
  const totalPendencias = modulos.reduce((s, m) => s + avisoDoModulo(m), 0);

  return (
    <div className="central">
      {/* ── Cabeçalho: marca, saudação, pendências e busca ─────────────── */}
      <header className="central-topo">
        <div className="central-identidade">
          <Mark size={34} decorative className="central-marca" />
          <div style={{ minWidth: 0 }}>
            <p className="eyebrow">Central de operações</p>
            <h1 className="central-titulo">
              {saudacao()}
              {primeiroNome(user?.name) ? `, ${primeiroNome(user?.name)}` : ''}
            </h1>
            <p className="hint central-papel">
              {isAdmin ? 'Gestor da rede' : user?.storeName ?? 'Gestor de loja'}
              {totalPendencias > 0 && (
                <>
                  {' · '}
                  <strong>{totalPendencias}</strong> ponto(s) pedindo atenção
                </>
              )}
            </p>
          </div>
        </div>

        <div className="central-busca">
          <Icon name="buscar" size={17} className="central-busca-icone" />
          <input
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar módulo ou tela…"
            aria-label="Buscar módulo ou tela"
          />
          {busca && (
            <button
              type="button"
              className="central-busca-limpar"
              onClick={() => setBusca('')}
              aria-label="Limpar busca"
            >
              <Icon name="limpar" size={15} />
            </button>
          )}
        </div>
      </header>

      {/* ── Grade de módulos, agrupada por categoria ───────────────────── */}
      {filtrados.length === 0 ? (
        <p className="empty">Nenhum módulo ou tela com “{busca}”.</p>
      ) : (
        CATEGORIAS.filter((c) => porCategoria(c).length > 0).map((categoria) => (
          <section key={categoria} className="central-grupo">
            <div className="central-grupo-topo">
              <hr className="rule-section" />
              <p className="eyebrow">{categoria}</p>
            </div>

            <ul className="central-grade">
              {porCategoria(categoria).map((m) => {
                const aviso = avisoDoModulo(m);
                const casadas = paginasQueCasam(m);
                return (
                  <li key={m.id}>
                    {/*
                       O CARTÃO INTEIRO É O BOTÃO.
                       Um <button> só no "Entrar" deixaria 90% da área do cartão
                       inerte — no toque, é justamente o miolo que o polegar
                       acerta. Como o cartão é o controle, ele carrega o nome
                       acessível completo e o "Entrar" é decoração (aria-hidden),
                       senão o leitor de tela anunciaria dois comandos para um
                       destino só.
                    */}
                    <button
                      type="button"
                      className="modulo-card"
                      onClick={() => navigate(m.destino)}
                      aria-label={`${m.nome}. ${m.descricao}${
                        aviso > 0 ? ` ${aviso} ponto(s) pedindo atenção.` : ''
                      }`}
                    >
                      <span className="modulo-cabeca">
                        <span className="modulo-placa" aria-hidden="true">
                          <Icon name={m.icone} size={26} stroke={1.25} />
                        </span>
                        {aviso > 0 && (
                          <span className="modulo-aviso" aria-hidden="true">
                            {aviso > 99 ? '99+' : aviso}
                          </span>
                        )}
                      </span>

                      <span className="modulo-nome">{m.nome}</span>
                      <span className="modulo-descricao">{m.descricao}</span>

                      {/* Durante a busca, o cartão mostra QUAL página casou —
                          senão o agrupamento pareceria ter engolido a tela. */}
                      {casadas.length > 0 && (
                        <span className="modulo-casadas">
                          {casadas.map((p) => (
                            <span key={p.to} className="modulo-casada">
                              {p.label}
                            </span>
                          ))}
                        </span>
                      )}

                      <span className="modulo-rodape">
                        <span className="modulo-entrar" aria-hidden="true">
                          Entrar <span className="modulo-seta">&#8594;</span>
                        </span>
                        <span className="modulo-badge">{m.categoria}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
