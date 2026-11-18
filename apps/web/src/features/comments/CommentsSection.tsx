import type { BoardMemberDto } from '@kanban/shared';
import { useState, type FormEvent } from 'react';
import { Alert, Button, Loading } from '../../components/ui';
import { useMe } from '../../lib/auth';
import { errorMessage } from '../../lib/errors';
import { CommentList } from './CommentList';
import { MentionInput } from './MentionInput';
import { useCommentActions, useComments } from './useComments';

/** «Comentarios» of the card modal: thread plus the form for a new comment. */
export function CommentsSection({
  orgId,
  cardId,
  members,
}: {
  orgId: string;
  cardId: string;
  members: BoardMemberDto[];
}) {
  const { data: me } = useMe();
  const comments = useComments(orgId, cardId);
  const actions = useCommentActions(orgId, cardId);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  const body = draft.trim();
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!body || body.length > 5000 || sending) return;
    setSending(true);
    try {
      await actions.create(body);
      setDraft('');
    } catch {
      // Toast already shown; keep the draft.
    } finally {
      setSending(false);
    }
  }

  return (
    <section aria-labelledby={`comments-${cardId}`} className="mt-6 border-t border-slate-200 pt-4">
      <h3 id={`comments-${cardId}`} className="mb-3 text-base font-semibold">
        Comentarios
      </h3>
      {comments.isPending ? (
        <Loading label="Cargando comentarios…" />
      ) : comments.isError ? (
        <Alert>{errorMessage(comments.error)}</Alert>
      ) : (
        <CommentList
          comments={comments.data}
          members={members}
          meId={me?.user.id}
          onEdit={actions.edit}
          onDelete={actions.remove}
        />
      )}
      <form onSubmit={(e) => void submit(e)} className="mt-4 space-y-2">
        <MentionInput
          label="Escribe un comentario"
          members={members}
          value={draft}
          maxLength={5000}
          placeholder="Escribe @ para mencionar a alguien"
          onChange={setDraft}
        />
        <Button type="submit" disabled={!body || sending}>
          {sending ? 'Enviando…' : 'Comentar'}
        </Button>
      </form>
    </section>
  );
}
