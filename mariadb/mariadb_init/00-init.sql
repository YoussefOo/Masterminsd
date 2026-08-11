-- ====================================================
-- GEN1002 Informatik-Projekt - SoSe26 - Süß/Rupp
-- Initial Schema & Configuration (Aktualisiert)
-- ============================================

SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- 1. Datenbank auswählen
USE codecracker;

-- 2. Tabelle für Todos
CREATE TABLE IF NOT EXISTS todos (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  text VARCHAR(100) NOT NULL,
  done BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_todos_done (done),
  KEY idx_todos_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- 3. Tabelle für Benutzer (users)
-- Hinzugefügt: score für Punkte-System, status für Lobby-Bereitschaft
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'PLAYER',
  score INT DEFAULT 0,
  status VARCHAR(20) DEFAULT 'ausstehend',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;