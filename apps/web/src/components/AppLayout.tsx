import { useQueryClient } from '@tanstack/react-query';
import { NavLink, Navigate, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Bell } from '../features/notifications/Bell';
import { OrgSwitcher } from '../features/orgs/OrgSwitcher';
import { api } from '../lib/api';
import { isUnauthenticated, useMe } from '../lib/auth';
import { closeSocket } from '../lib/socket';
import { Loading } from './ui';
import { UserMenu } from './UserMenu';

const navClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-md px-3 py-1.5 text-sm font-medium ${
    isActive ? 'bg-accent-100 text-accent-700' : 'text-slate-600 hover:bg-slate-100'
  }`;

/** Shell for every signed-in page: redirects without a session, header with org switcher. */
export function AppLayout() {
  const { data: me, error, isPending } = useMe();
  const { orgId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();

  if (isPending) return <Loading />;
  if (!me) {
    if (isUnauthenticated(error)) {
      return (
        <Navigate
          to={`/entrar?volver=${encodeURIComponent(location.pathname + location.search)}`}
          replace
        />
      );
    }
    return (
      <p className="p-6 text-center text-sm text-red-700">No se ha podido cargar la sesión.</p>
    );
  }

  const current = me.memberships.find((m) => m.orgId === orgId) ?? me.memberships[0];
  // A URL for an organization you don't belong to goes to your own first one.
  if (orgId && !me.memberships.some((m) => m.orgId === orgId)) {
    return <Navigate to={current ? `/o/${current.orgId}` : '/'} replace />;
  }

  async function logout() {
    await api('POST', '/api/auth/logout').catch(() => undefined);
    closeSocket();
    // Leave first so no mounted query refetches (and 401s) while the cache is emptied.
    navigate('/entrar', { replace: true });
    qc.clear();
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2">
          <span className="text-sm font-semibold text-accent-600">Kanban</span>
          {current && <OrgSwitcher me={me} currentOrgId={current.orgId} />}
          <nav aria-label="Principal" className="flex flex-wrap items-center gap-1">
            {current && (
              <>
                <NavLink to={`/o/${current.orgId}`} end className={navClass}>
                  Proyectos
                </NavLink>
                <NavLink to={`/o/${current.orgId}/miembros`} className={navClass}>
                  Miembros
                </NavLink>
              </>
            )}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <Bell />
            <UserMenu name={me.user.name} onLogout={() => void logout()} />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
