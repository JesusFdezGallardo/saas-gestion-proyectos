import { toSegments, type BoardMemberDto, type CommentDto } from '@kanban/shared';
import { useState } from 'react';
import { Button } from '../../components/ui';
import { relativeTime, shortDateTime } from '../../lib/time';
import { MentionInput } from './MentionInput';

/** A comment body as React text nodes: mentions highlighted, everything else literal. */
export function CommentBody({ body }: { body: string }) {
  return (
    <p className="text-sm break-words whitespace-pre-wrap text-slate-800">
      {toSegments(body).map((s, i) =>
        s.type === 'mention' ? (
          <span
            key={i}
            data-mention={s.userId}
            className="rounded bg-accent-100 px-1 font-medium text-accent-700"
          >
            @{s.name}
          </span>
        ) : (
          s.text
        ),
      )}
    </p>
  );
}

interface Props {
  comments: CommentDto[];
  members: BoardMemberDto[];
  meId: string | undefined;
  onEdit: (commentId: string, body: string) => Promise<unknown>;
  onDelete: (commentId: string) => Promise<unknown>;
}

/** Comments oldest first; the author of a comment can edit and delete it. */
export function CommentList({ comments, members, meId, onEdit, onDelete }: Props) {
  if (comments.length === 0) {
    return <p className="text-sm text-slate-500">Aún no hay comentarios.</p>;
  }
  return (
    <ul className="space-y-3">
      {comments.map((c) => (
        <CommentItem
          key={c.id}
          comment={c}
          members={members}
          own={meId !== undefined && c.authorId === meId}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      ))}
    </ul>
  );
}

function CommentItem({
  comment,
  members,
  own,
  onEdit,
  onDelete,
}: {
  comment: CommentDto;
  members: BoardMemberDto[];
  own: boolean;
  onEdit: Props['onEdit'];
  onDelete: Props['onDelete'];
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (editing === null) return;
    const body = editing.trim();
    if (!body || body.length > 5000) return;
    if (body === comment.body) {
      setEditing(null);
      return;
    }
    setBusy(true);
    try {
      await onEdit(comment.id, body);
      setEditing(null);
    } catch {
      // The caller already showed why; keep the text so nothing is lost.
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await onDelete(comment.id);
    } catch {
      setBusy(false);
    }
  }

  return (
    <li className="rounded-md border border-slate-200 bg-slate-50 p-3">
      <div className="mb-1 flex flex-wrap items-baseline gap-x-2 text-xs text-slate-500">
        <span className="text-sm font-medium text-slate-800">{comment.authorName}</span>
        <time dateTime={comment.createdAt} title={shortDateTime(comment.createdAt)}>
          {relativeTime(comment.createdAt)}
        </time>
        {comment.editedAt && <span>(editado)</span>}
      </div>
      {editing === null ? (
        <CommentBody body={comment.body} />
      ) : (
        <div className="space-y-2">
          <MentionInput
            label="Editar comentario"
            hideLabel
            members={members}
            value={editing}
            maxLength={5000}
            onChange={setEditing}
          />
          <div className="flex gap-2">
            <Button
              type="button"
              onClick={() => void save()}
              disabled={busy || editing.trim().length === 0}
            >
              Guardar
            </Button>
            <Button type="button" variant="secondary" onClick={() => setEditing(null)}>
              Cancelar
            </Button>
          </div>
        </div>
      )}
      {own && editing === null && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          {confirming ? (
            <>
              <span>¿Borrar este comentario?</span>
              <Button type="button" variant="danger" disabled={busy} onClick={() => void remove()}>
                Sí, borrar
              </Button>
              <Button type="button" variant="secondary" onClick={() => setConfirming(false)}>
                Cancelar
              </Button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setEditing(comment.body)}
                className="min-h-9 rounded px-2 text-slate-600 hover:bg-slate-200"
              >
                Editar
              </button>
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="min-h-9 rounded px-2 text-red-700 hover:bg-red-50"
              >
                Borrar
              </button>
            </>
          )}
        </div>
      )}
    </li>
  );
}
