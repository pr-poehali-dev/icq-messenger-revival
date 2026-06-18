CREATE TABLE icq_users (
  id SERIAL PRIMARY KEY,
  uin BIGINT UNIQUE NOT NULL,
  phone VARCHAR(20) UNIQUE NOT NULL,
  nickname VARCHAR(100) NOT NULL DEFAULT '',
  first_name VARCHAR(100) NOT NULL DEFAULT '',
  last_name VARCHAR(100) NOT NULL DEFAULT '',
  status VARCHAR(20) NOT NULL DEFAULT 'offline',
  status_message VARCHAR(255) NOT NULL DEFAULT '',
  avatar_url TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP DEFAULT NOW(),
  last_seen TIMESTAMP DEFAULT NOW()
);

CREATE TABLE icq_sms_codes (
  id SERIAL PRIMARY KEY,
  phone VARCHAR(20) NOT NULL,
  code VARCHAR(6) NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  used BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE icq_sessions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES icq_users(id),
  token VARCHAR(128) UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL
);

CREATE TABLE icq_contacts (
  id SERIAL PRIMARY KEY,
  owner_id INTEGER REFERENCES icq_users(id),
  contact_id INTEGER REFERENCES icq_users(id),
  nickname VARCHAR(100) NOT NULL DEFAULT '',
  group_name VARCHAR(100) NOT NULL DEFAULT 'Общие',
  added_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(owner_id, contact_id)
);

CREATE TABLE icq_messages (
  id SERIAL PRIMARY KEY,
  sender_id INTEGER REFERENCES icq_users(id),
  receiver_id INTEGER REFERENCES icq_users(id),
  content TEXT NOT NULL,
  is_read BOOLEAN DEFAULT FALSE,
  sent_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_icq_messages_sender ON icq_messages(sender_id);
CREATE INDEX idx_icq_messages_receiver ON icq_messages(receiver_id);
CREATE INDEX idx_icq_sessions_token ON icq_sessions(token);
CREATE INDEX idx_icq_users_uin ON icq_users(uin);
CREATE INDEX idx_icq_users_phone ON icq_users(phone);