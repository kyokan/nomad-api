CREATE TABLE tags (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name VARCHAR NOT NULL,
    UNIQUE (name)
);

CREATE TABLE tags_posts (
    tag_id  INTEGER NOT NULL REFERENCES tags(id),
    post_id INTEGER NOT NULL REFERENCES posts(id)
);


CREATE INDEX tags_name_key
ON tags(name);

