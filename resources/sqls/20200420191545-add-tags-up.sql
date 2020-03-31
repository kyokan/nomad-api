CREATE TABLE tags (
    id   SERIAL PRIMARY KEY,
    name VARCHAR NOT NULL,
    UNIQUE (name)
);

CREATE TABLE tags_posts (
    tag_id  INTEGER NOT NULL REFERENCES tags(id),
    post_id INTEGER NOT NULL REFERENCES posts(id)
);
