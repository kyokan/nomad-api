CREATE TABLE files (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    filename    VARCHAR NOT NULL,
    mime_type   VARCHAR NOT NULL,
    content     BLOB    NOT NULL
);
