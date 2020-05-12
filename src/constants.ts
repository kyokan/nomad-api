export const POST_WITH_META_COLUMNS = 'id, refhash, tld, subdomain, guid, ts, parent, context, content, topic, reply_count, like_count, pin_count';
export const JOIN_SELECT = `SELECT DISTINCT posts.id, posts.refhash, posts.tld, posts.subdomain, posts.guid, posts.ts, posts.parent, posts.context, posts.content, posts.topic, pm.reply_count, pm.like_count, pm.pin_count FROM posts LEFT JOIN post_metadata pm on posts.refhash = pm.post_refhash LEFT JOIN tags on posts.refhash = tags.post_refhash LEFT JOIN reactions re on posts.refhash = re.parent`;

export type UserProfile = {
  profilePicture: string;
  coverImage: string;
  bio: string;
  avatarType: string;
  displayName: string;
  followings: number;
  followers: number;
  blockings: number;
  blockers: number;
}
