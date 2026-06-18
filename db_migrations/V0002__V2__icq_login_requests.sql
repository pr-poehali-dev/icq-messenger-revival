-- Login requests: запросы на подтверждение входа
CREATE TABLE icq_login_requests (
  id SERIAL PRIMARY KEY,
  token VARCHAR(64) UNIQUE NOT NULL,
  phone VARCHAR(20) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL
);

CREATE INDEX idx_icq_login_requests_token ON icq_login_requests(token);
CREATE INDEX idx_icq_login_requests_phone ON icq_login_requests(phone);