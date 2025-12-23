-- Sample SQL Database Queries
-- For testing file type detection

-- Create tables
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title VARCHAR(200) NOT NULL,
    category VARCHAR(50),
    user_id INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Sample queries
SELECT
    u.username,
    COUNT(d.id) as document_count
FROM users u
LEFT JOIN documents d ON u.id = d.user_id
GROUP BY u.id
ORDER BY document_count DESC;

-- Insert sample data
INSERT INTO users (username, email) VALUES ('testuser', 'test@example.com');
INSERT INTO documents (title, category, user_id) VALUES ('Sample Doc', 'testing', 1);
