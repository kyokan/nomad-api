CREATE TABLE moderations (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    envelope_id     INTEGER NOT NULL REFERENCES envelopes(id),
    reference       VARCHAR NOT NULL,
    moderation_type VARCHAR NOT NULL
);

CREATE INDEX moderations_type
ON moderations(moderation_type);

CREATE INDEX moderations_reference
ON moderations(reference);
