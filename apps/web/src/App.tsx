import { Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from './components/AppLayout';
import { Card, Loading } from './components/ui';
import { LoginPage } from './features/auth/LoginPage';
import { RegisterPage } from './features/auth/RegisterPage';
import { BoardPage } from './features/board/BoardPage';
import { MailboxPage } from './features/mailbox/MailboxPage';
import { SettingsPage } from './features/settings/SettingsPage';
import { AcceptInvitePage } from './features/orgs/AcceptInvitePage';
import { MembersPage } from './features/orgs/MembersPage';
import { NewOrgForm } from './features/orgs/OrgSwitcher';
import { ProjectsPage } from './features/orgs/ProjectsPage';
import { isUnauthenticated, useMe } from './lib/auth';
import { Toaster } from './lib/toast';

/** `/` goes to the first organization, or to the login without a session. */
function Home() {
  const { data: me, error, isPending } = useMe();
  if (isPending) return <Loading />;
  if (!me) {
    return isUnauthenticated(error) ? (
      <Navigate to="/entrar" replace />
    ) : (
      <p className="p-6 text-center text-sm text-red-700">No se ha podido cargar la sesión.</p>
    );
  }
  const first = me.memberships[0];
  if (first) return <Navigate to={`/o/${first.orgId}`} replace />;
  return (
    <main className="mx-auto max-w-sm px-4 py-12">
      <h1 className="mb-4 text-xl font-semibold">Crea tu primera organización</h1>
      <Card>
        <NewOrgForm />
      </Card>
    </main>
  );
}

export function App() {
  return (
    <>
      <Routes>
        <Route path="/entrar" element={<LoginPage />} />
        <Route path="/registro" element={<RegisterPage />} />
        <Route path="/invitacion/:token" element={<AcceptInvitePage />} />
        <Route path="/" element={<Home />} />
        <Route element={<AppLayout />}>
          <Route path="/o/:orgId" element={<ProjectsPage />} />
          <Route path="/o/:orgId/p/:projectId" element={<BoardPage />} />
          <Route path="/o/:orgId/miembros" element={<MembersPage />} />
          <Route path="/buzon" element={<MailboxPage />} />
          <Route path="/ajustes" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Toaster />
    </>
  );
}
