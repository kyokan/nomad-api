export const SELECT_POSTS = `
SELECT e.id as envelope_id, p.id as post_id, e.tld, e.subdomain, e.network_id, e.refhash, e.created_at, p.body,
    p.title, p.reference, p.topic, p.reply_count, p.like_count, p.pin_count, e.type as message_type, e.subtype as message_subtype,
    p.video_url, p.thumbnail_url
FROM posts p
JOIN envelopes e ON p.envelope_id = e.id
`;
