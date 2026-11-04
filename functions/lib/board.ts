/** The league message board: posts and one level of replies. */

export interface Post {
  id: number;
  userId: number;
  author: string;
  body: string;
  pinned: boolean;
  createdAt: string;
  replies: Post[];
}

const TOP_LEVEL = 100;

/** Pinned posts first, then newest; replies oldest first under each post. */
export async function listPosts(db: D1Database, leagueId: number): Promise<Post[]> {
  const author = "COALESCE(u.name, substr(u.email, 1, instr(u.email, '@') - 1), 'Player')";
  const [top, replies] = await db.batch([
    db.prepare(
      `SELECT p.*, ${author} AS author FROM posts p JOIN users u ON u.id = p.user_id
       WHERE p.league_id = ? AND p.parent_id IS NULL ORDER BY p.pinned DESC, p.created_at DESC, p.id DESC LIMIT ${TOP_LEVEL}`,
    ).bind(leagueId),
    db
      .prepare(`SELECT p.*, ${author} AS author FROM posts p JOIN users u ON u.id = p.user_id WHERE p.league_id = ? AND p.parent_id IS NOT NULL ORDER BY p.created_at, p.id`)
      .bind(leagueId),
  ]);
  const toPost = (r: Record<string, unknown>): Post => ({
    id: r.id as number,
    userId: r.user_id as number,
    author: r.author as string,
    body: r.body as string,
    pinned: !!r.pinned,
    createdAt: r.created_at as string,
    replies: [],
  });
  const posts = (top.results as Record<string, unknown>[]).map(toPost);
  const byId = new Map(posts.map((p) => [p.id, p]));
  for (const r of replies.results as Record<string, unknown>[]) byId.get(r.parent_id as number)?.replies.push(toPost(r));
  return posts;
}

export async function addPost(db: D1Database, leagueId: number, userId: number, body: string, parentId: number | null): Promise<number> {
  if (parentId != null) {
    const parent = await db.prepare('SELECT parent_id FROM posts WHERE id = ? AND league_id = ?').bind(parentId, leagueId).first<{ parent_id: number | null }>();
    if (!parent) throw new Error('not found');
    // Replies to a reply go under the original post.
    if (parent.parent_id != null) parentId = parent.parent_id;
  }
  const row = await db
    .prepare('INSERT INTO posts (league_id, user_id, parent_id, body) VALUES (?, ?, ?, ?) RETURNING id')
    .bind(leagueId, userId, parentId, body)
    .first<{ id: number }>();
  return row!.id;
}

export async function postInfo(db: D1Database, id: number): Promise<{ userId: number; leagueId: number } | null> {
  const r = await db.prepare('SELECT user_id, league_id FROM posts WHERE id = ?').bind(id).first<{ user_id: number; league_id: number }>();
  return r ? { userId: r.user_id, leagueId: r.league_id } : null;
}
