import { useState } from 'react';
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
import { PageHeader, Loading } from '../components/ui';
import { useAuth } from '../auth/AuthContext';

const roleLabel: Record<Role, string> = { ADMIN: 'Rede (ADMIN)', STORE_MANAGER: 'Gestor de loja' };

export function Usuarios() {
  const { user: me } = useAuth();
  const qc = useQueryClient();
  const users = useQuery({ queryKey: ['users'], queryFn: getUsers });
  const stores = useQuery({ queryKey: ['stores'], queryFn: getStores });
  const [creating, setCreating] = useState(false);
  const invalidate = () => qc.invalidateQueries({ queryKey: ['users'] });

  return (
    <>
      <div className="row-between">
        <PageHeader title="Usuários" subtitle="Contas de acesso da rede: papéis, lojas, status e senhas." />
        <button className="btn" onClick={() => setCreating(true)}>
          Novo usuário
        </button>
      </div>

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
      <td>
        <span className={`badge ${user.active ? 'green' : 'gray'}`}>{user.active ? 'Ativo' : 'Inativo'}</span>
      </td>
      <td className="muted">
        {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString('pt-BR') : 'nunca'}
      </td>
      <td className="right">
        <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 4 }}>
          <button
            className="btn ghost sm"
            disabled={isSelf || patch.isPending}
            title={isSelf ? 'Você não pode desativar a própria conta' : undefined}
            onClick={() => patch.mutate({ active: !user.active })}
          >
            {user.active ? 'Desativar' : 'Reativar'}
          </button>
          <button className="btn ghost sm" disabled={reset.isPending} onClick={askReset}>
            {reset.isSuccess ? 'Senha ok ✓' : 'Resetar senha'}
          </button>
        </span>
        {error && (
          <div className="badge red" style={{ display: 'block', marginTop: 6 }}>
            {error}
          </div>
        )}
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
        <h3 style={{ marginTop: 0 }}>Novo usuário</h3>
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
        {error && (
          <div className="badge red" style={{ display: 'block', padding: 10, marginBottom: 12 }}>
            {error}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn" type="submit" disabled={save.isPending}>
            {save.isPending ? 'Criando…' : 'Criar'}
          </button>
        </div>
      </form>
    </div>
  );
}
