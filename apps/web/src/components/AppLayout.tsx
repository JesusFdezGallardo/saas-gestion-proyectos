import { useQueryClient } from '@tanstack/react-query';
import {
  Link,
  NavLink,
  Navigate,
  Outlet,
  useLocation,
  useNavigate,
  useParams,
} from 'react-router-dom';
import { Bell } from '../features/notifications/Bell';
import { OrgSwitcher } from '../features/orgs/OrgSwitcher';
import { endSession, isUnauthenticated, useMe } from '../lib/auth';
import { useDemoRecovery } from '../lib/demoRecovery';
import { Alert, Loading } from './ui';
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
  useDemoRecovery();

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

  // A URL for an organization you don't belong to (or that does not exist) shows an error in the
  // shell of your own first organization; it never renders the page nor redirects silently.
  const foreign = orgId !== undefined && !me.memberships.some((m) => m.orgId === orgId);
  const current = me.memberships.find((m) => m.orgId === orgId) ?? me.memberships[0];

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
            <UserMenu
              name={me.user.name}
              onLogout={() => void endSession(qc, navigate, '/entrar')}
            />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        {foreign ? (
          <div className="space-y-3">
            <Alert>Esta organización no existe o no tienes acceso a ella.</Alert>
            <Link
              to={current ? `/o/${current.orgId}` : '/'}
              className="text-sm text-accent-700 underline"
            >
              {current ? `Ir a ${current.orgName}` : 'Crear una organización'}
            </Link>
          </div>
        ) : (
          <Outlet />
        )}
      </main>
    </div>
  );
}
