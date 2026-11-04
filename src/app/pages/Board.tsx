import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { api, type Post } from '../api';
import { useSeason } from '../season';

/** "2h ago", "Yesterday", "Jun 3" from a UTC "YYYY-MM-DD HH:MM:SS". */
export function timeAgo(utc: string): string {
  const t = new Date(`${utc.replace(' ', 'T')}Z`);
  const mins = Math.round((Date.now() - t.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 24 * 60) return `${Math.round(mins / 60)}h ago`;
  if (mins < 48 * 60) return 'yesterday';
  return t.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(t.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) });
}

export function useBoard() {
  const { leagueId } = useSeason();
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (leagueId) await api.board(leagueId).then(setPosts, (e: Error) => setError(e.message));
  }, [leagueId]);
  useEffect(() => {
    void load();
  }, [load]);
  return { posts, error, load };
}

/** League message board: anyone in the league can post and reply. */
export function BoardPage() {
  const { me, admin, leagueId } = useSeason();
  const { posts, error, load } = useBoard();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setProblem(null);
    try {
      await fn();
      await load();
      return true;
    } catch (e) {
      setProblem((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (error) return <p className="error">{error}</p>;
  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0 }}>Message board</h1>
        <span className="spacer" />
        {admin && <Link className="button" to="/admin/contacts">✉ Email everyone</Link>}
      </div>
      {me?.user ? (
        <Compose placeholder="Write to the league…" busy={busy} onSend={(text) => run(() => api.post(leagueId!, text))} />
      ) : (
        <p className="notice small">Sign in with your own account to post. (You’re using the admin password.)</p>
      )}
      {problem && <p className="error">{problem}</p>}
      {!posts ? (
        <p className="empty">Loading…</p>
      ) : !posts.length ? (
        <p className="empty">No messages yet. Be the first to post.</p>
      ) : (
        <ul className="posts">
          {posts.map((p) => (
            <li key={p.id} className={`post ${p.pinned ? 'pinned' : ''}`}>
              <PostBody post={p} mine={p.userId === me?.user?.id} admin={admin} busy={busy}
                onDelete={() => confirm(p.replies.length ? 'Delete this post and its replies?' : 'Delete this post?') && run(() => api.deletePost(p.id))}
                onPin={admin ? () => run(() => api.pinPost(p.id, !p.pinned)) : undefined} />
              {p.replies.length > 0 && (
                <ul className="replies">
                  {p.replies.map((r) => (
                    <li key={r.id}>
                      <PostBody post={r} mine={r.userId === me?.user?.id} admin={admin} busy={busy} onDelete={() => confirm('Delete this reply?') && run(() => api.deletePost(r.id))} />
                    </li>
                  ))}
                </ul>
              )}
              {me?.user && <Reply busy={busy} onSend={(text) => run(() => api.post(leagueId!, text, p.id))} />}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function PostBody({ post, mine, admin, busy, onDelete, onPin }: { post: Post; mine: boolean; admin: boolean; busy: boolean; onDelete: () => void; onPin?: () => void }) {
  return (
    <div className="post-body">
      <div className="post-meta">
        <strong>{post.author}</strong>
        <span className="small muted">{timeAgo(post.createdAt)}</span>
        {post.pinned && <span className="badge playoff">Pinned</span>}
        <span className="spacer" />
        {onPin && <button className="link small" disabled={busy} onClick={onPin}>{post.pinned ? 'Unpin' : 'Pin'}</button>}
        {(mine || admin) && <button className="link small danger" disabled={busy} onClick={onDelete}>Delete</button>}
      </div>
      <p className="post-text">{post.body}</p>
    </div>
  );
}

function Compose({ placeholder, busy, onSend }: { placeholder: string; busy: boolean; onSend: (text: string) => Promise<boolean> }) {
  const [text, setText] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await onSend(text.trim())) setText('');
  };
  return (
    <form className="compose card" onSubmit={submit}>
      <textarea rows={3} maxLength={2000} placeholder={placeholder} value={text} onChange={(e) => setText(e.target.value)} aria-label="Message" />
      <div className="toolbar" style={{ margin: 0 }}>
        <span className="small muted">Everyone in the league can read this.</span>
        <span className="spacer" />
        <button className="primary" type="submit" disabled={busy || !text.trim()}>Post</button>
      </div>
    </form>
  );
}

function Reply({ busy, onSend }: { busy: boolean; onSend: (text: string) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  if (!open) return <button className="link small reply-link" onClick={() => setOpen(true)}>Reply</button>;
  return (
    <form
      className="reply-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await onSend(text.trim())) {
          setText('');
          setOpen(false);
        }
      }}
    >
      <textarea rows={2} maxLength={2000} placeholder="Write a reply…" value={text} onChange={(e) => setText(e.target.value)} aria-label="Reply" autoFocus />
      <div className="toolbar" style={{ margin: 0 }}>
        <button type="button" onClick={() => setOpen(false)}>Cancel</button>
        <button className="primary" type="submit" disabled={busy || !text.trim()}>Reply</button>
      </div>
    </form>
  );
}
