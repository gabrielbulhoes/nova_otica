import { useState, type CSSProperties, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createUser,
  getStores,
  getUsers,
  resetUserPassword,
  updateUser,
  type AdminUser,
  type Role,
} from '../api/client';
import { PageHeader, Loading, Selo, Botao, BotaoPrimario, Codigo } from '../components/ui';
import { Icon } from '../brand/Icon';
import { useAuth } from '../auth/AuthContext';

const roleLabel: Record<Role, string> = { ADMIN: 'Rede (ADMIN)', STORE_MANAGER: 'Gestor de loja' };

/**
 * Falha de gravação: filete de estado à esquerda, ícone e frase em Inter.
 *
 * Substitui o `.badge red` que as duas ocorrências usavam. O chip é mono caixa
 * alta com 0,18em de entreletras — desenho de carimbo curto, não de frase; a
 * mensagem que o servidor devolve ("Já existe um usuário com este e-mail") saía
 * ilegível. O vermelho continua, mas agora é o terceiro canal, depois da palavra
 * e do ícone.
 */
function ErroDeGravacao({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div
      role="alert"
      className="banner"
      style={{
        fontSize: 12.5,
        lineHeight: 1.4,
        color: 'var(--red)',
        borderLeftColor: 'var(--red)',
        ...style,
      }}
    >
      <Icon name="atencao" size={18} />
      <div>{children}</div>
    </div>
  );
}

export function Usuarios() {
  const { user: me } = useAuth();
  const qc = useQueryClient();
  const users = useQuery({ queryKey: ['users'], queryFn: getUsers });
  const stores = useQuery({ queryKey: ['stores'], queryFn: getStores });
  const [creating, setCreating] = useState(false);
  const invalidate = () => qc.invalidateQueries({ queryKey: ['users'] });

  return (
    <>
      {/* O único sólido da tela. Tudo o mais aqui é edição em linha (papel, loja,
          ativo/inativo, senha) — ação por item, que fica em discreto para não
          transformar a tabela numa parede de ouro. Criar uma conta é a ação que
          a tela existe para oferecer e acontece uma vez só. */}
      <PageHeader
        eyebrow="Governança"
        title="Usuários"
        subtitle="Contas de acesso da rede: papéis, lojas, status e senhas."
        actions={
          <BotaoPrimario icone="mais" onClick={() => setCreating(true)}>
            Novo usuário
          </BotaoPrimario>
        }
      />

      {users.isLoading ? (
        <Loading />
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Nome</th>
                <th>E-mail</th>
                <th>Papel</th>
                <th>Loja</th>
                <th>Status</th>
                <th>Último acesso</th>
                <th className="right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {users.data?.rows.map((u) => (
                <UserRow key={u.id} user={u} isSelf={u.id === me?.id} stores={stores.data?.rows ?? []} onChange={invalidate} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating && (
        <CreateUserModal
          stores={stores.data?.rows ?? []}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            invalidate();
          }}
        />
      )}
    </>
  );
}

function UserRow({
  user,
  isSelf,
  stores,
  onChange,
}: {
  user: AdminUser;
  isSelf: boolean;
  stores: { id: string; name: string }[];
  onChange: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const patch = useMutation({
    mutationFn: (body: Parameters<typeof updateUser>[1]) => updateUser(user.id, body),
    onSuccess: () => {
      setError(null);
      onChange();
    },
    onError: (e: unknown) =>
      setError((e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Não foi possível salvar.'),
  });
  const reset = useMutation({
    mutationFn: (password: string) => resetUserPassword(user.id, password),
  });

  const askReset = () => {
    const pwd = window.prompt(`Nova senha para ${user.name} (mín. 6 caracteres):`);
    if (pwd && pwd.length >= 6) reset.mutate(pwd);
    else if (pwd !== null) window.alert('Senha muito curta — nada foi alterado.');
  };

  return (
    <tr style={user.active ? undefined : { opacity: 0.55 }}>
      <td>{user.name}</td>
      <td className="muted">{user.email}</td>
      <td>
        <select
          value={user.role}
          disabled={isSelf || patch.isPending}
          title={isSelf ? 'Você não pode alterar o próprio papel' : undefined}
          onChange={(e) => patch.mutate({ role: e.target.value as Role, storeId: e.target.value === 'ADMIN' ? null : user.storeId })}
        >
          <option value="ADMIN">{roleLabel.ADMIN}</option>
          <option value="STORE_MANAGER">{roleLabel.STORE_MANAGER}</option>
        </select>
      </td>
      <td>
        {user.role === 'STORE_MANAGER' ? (
          <select
            value={user.storeId ?? ''}
            disabled={patch.isPending}
            onChange={(e) => patch.mutate({ storeId: e.target.value || null })}
          >
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        ) : (
          <span className="muted">— rede —</span>
        )}
      </td>
      {/* Ativo e Inativo já vinham escritos, mas o único reforço era o tom — e
          a linha inteira ainda escurece por `opacity`, que some na impressão.
          Com ícone, a conta desligada tem forma própria mesmo em cinza. */}
      <td>
        {user.active ? (
          <Selo tom="green" icone="aprovar" title="A conta entra no console normalmente.">
            Ativo
          </Selo>
        ) : (
          <Selo tom="gray" icone="recusar" title="A conta existe, mas não consegue entrar.">
            Inativo
          </Selo>
        )}
      </td>
      {/* A data/hora vai em <Codigo> (mono, tabular, entreletras zero): é o dado
          que o administrador varre de cima a baixo procurando quem não entra há
          semanas, e essa varredura só funciona com os dígitos alinhados. Já o
          "nunca" NÃO é identificador — é palavra, e fica em Inter. Trocar a
          família por célula, e não por coluna, é o que mantém a regra honesta:
          mono para o que se compara, Inter para o que se lê.
          O e-mail, ao lado, continua em Inter de propósito: tem 20 a 35
          caracteres, é lido inteiro e nunca conferido caractere a caractere. */}
      <td className="muted">
        {user.lastLoginAt ? <Codigo>{new Date(user.lastLoginAt).toLocaleString('pt-BR')}</Codigo> : 'nunca'}
      </td>
      <td className="right">
        <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 4, alignItems: 'stretch' }}>
          <Botao
            variante="discreto"
            pequeno
            icone={user.active ? 'recusar' : 'aprovar'}
            disabled={isSelf || patch.isPending}
            title={isSelf ? 'Você não pode desativar a própria conta' : undefined}
            onClick={() => patch.mutate({ active: !user.active })}
          >
            {user.active ? 'Desativar' : 'Reativar'}
          </Botao>
          {/* O "✓" era um glifo de texto fazendo papel de ícone: renderiza com
              largura diferente em cada sistema e não tem o traço de 1,3 da
              grade. Vira <Icon name="check">, e o rótulo perde o carimbo. */}
          <Botao
            variante="discreto"
            pequeno
            icone={reset.isSuccess ? 'check' : 'sincronizacao'}
            disabled={reset.isPending}
            onClick={askReset}
          >
            {reset.isSuccess ? 'Senha ok' : 'Resetar senha'}
          </Botao>
        </span>
        {error && <ErroDeGravacao style={{ marginTop: 6, marginBottom: 0, textAlign: 'left' }}>{error}</ErroDeGravacao>}
      </td>
    </tr>
  );
}

function CreateUserModal({
  stores,
  onClose,
  onCreated,
}: {
  stores: { id: string; name: string }[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'STORE_MANAGER' as Role, storeId: stores[0]?.id ?? '' });
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () =>
      createUser({
        name: form.name,
        email: form.email,
        password: form.password,
        role: form.role,
        storeId: form.role === 'STORE_MANAGER' ? form.storeId : undefined,
      }),
    onSuccess: onCreated,
    onError: (e: unknown) =>
      setError((e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Não foi possível criar.'),
  });

  return (
    <div className="modal-overlay" onClick={onClose}>
      <form
        className="card modal"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <h3 className="section-title" style={{ marginTop: 0 }}>
          Novo usuário
        </h3>
        <div className="field">
          <label>Nome</label>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required minLength={2} autoFocus />
        </div>
        <div className="field">
          <label>E-mail</label>
          <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
        </div>
        <div className="field">
          <label>Senha inicial (mín. 6)</label>
          <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={6} />
        </div>
        <div className="field">
          <label>Papel</label>
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
            <option value="STORE_MANAGER">{roleLabel.STORE_MANAGER}</option>
            <option value="ADMIN">{roleLabel.ADMIN}</option>
          </select>
        </div>
        {form.role === 'STORE_MANAGER' && (
          <div className="field">
            <label>Loja</label>
            <select value={form.storeId} onChange={(e) => setForm({ ...form, storeId: e.target.value })}>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {error && <ErroDeGravacao style={{ marginBottom: 12 }}>{error}</ErroDeGravacao>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Botao variante="discreto" onClick={onClose}>
            Cancelar
          </Botao>
          {/* O sólido do modal; o da página ("Novo usuário") fica atrás do
              overlay e inacessível enquanto este diálogo existe. */}
          <BotaoPrimario icone="check" type="submit" disabled={save.isPending}>
            {save.isPending ? 'Criando…' : 'Criar'}
          </BotaoPrimario>
        </div>
      </form>
    </div>
  );
}
