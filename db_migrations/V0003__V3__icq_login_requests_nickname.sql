-- Добавляем поле nickname в таблицу запросов (нужно для регистрации через SMS)
ALTER TABLE icq_login_requests ADD COLUMN nickname VARCHAR(100) NOT NULL DEFAULT '';
ALTER TABLE icq_login_requests ADD COLUMN request_type VARCHAR(20) NOT NULL DEFAULT 'login';