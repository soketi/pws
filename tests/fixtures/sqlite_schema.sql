CREATE TABLE IF NOT EXISTS apps (
    id TEXT NOT NULL PRIMARY KEY,
    key TEXT NOT NULL,
    secret TEXT NOT NULL,
    max_connections INTEGER NOT NULL DEFAULT 200,
    enabled INTEGER NOT NULL DEFAULT 1,
    enable_client_messages INTEGER NOT NULL DEFAULT 1,
    max_backend_events_per_sec INTEGER NOT NULL DEFAULT -1,
    max_client_events_per_sec INTEGER NOT NULL DEFAULT -1,
    max_read_req_per_sec INTEGER NOT NULL DEFAULT -1,
    webhooks TEXT,
    max_presence_members_per_channel INTEGER,
    max_presence_member_size_in_kb INTEGER,
    max_channel_name_length INTEGER,
    max_event_channels_at_once INTEGER,
    max_event_name_length INTEGER,
    max_event_payload_in_kb INTEGER,
    max_event_batch_size INTEGER,
    enable_user_authentication INTEGER NOT NULL DEFAULT 0
);

INSERT INTO apps (
    id,
    key,
    secret
) VALUES (
    'app-id',
    'app-key',
    'app-secret',
    200,
    1,
    1,
    -1,
    -1,
    -1,
    '[]',
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    0
);
