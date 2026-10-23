-- ============================================================
-- CSPC Equipment Borrowing System - Database Schema
-- Import this file in phpMyAdmin (XAMPP) or via:
--   mysql -u root -p < schema.sql
-- ============================================================

CREATE DATABASE IF NOT EXISTS cspc_ebs CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE cspc_ebs;

SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS audit_trail;
DROP TABLE IF EXISTS maintenance_logs;
DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS borrowings;
DROP TABLE IF EXISTS requests;
DROP TABLE IF EXISTS equipment;
DROP TABLE IF EXISTS categories;
DROP TABLE IF EXISTS users;

-- ------------------------------------------------------------
-- USERS
-- ------------------------------------------------------------
CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  id_number VARCHAR(30) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(150) NOT NULL,
  email VARCHAR(150),
  role ENUM('student','instructor','staff','admin') NOT NULL DEFAULT 'student',
  department VARCHAR(150),
  program VARCHAR(150),
  photo VARCHAR(255) DEFAULT NULL,
  contact_number VARCHAR(30),
  account_status ENUM('active','inactive') NOT NULL DEFAULT 'active',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- CATEGORIES
-- ------------------------------------------------------------
CREATE TABLE categories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  icon VARCHAR(50) DEFAULT 'box'
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- EQUIPMENT
-- ------------------------------------------------------------
CREATE TABLE equipment (
  id INT AUTO_INCREMENT PRIMARY KEY,
  equipment_code VARCHAR(20) NOT NULL UNIQUE,
  name VARCHAR(150) NOT NULL,
  category_id INT,
  brand_model VARCHAR(150),
  description TEXT,
  specifications JSON,
  condition_status ENUM('Excellent','Good','Fair','Poor') NOT NULL DEFAULT 'Good',
  quantity_total INT NOT NULL DEFAULT 1,
  quantity_available INT NOT NULL DEFAULT 1,
  quantity_reserved INT NOT NULL DEFAULT 0,
  location VARCHAR(150),
  image VARCHAR(255) DEFAULT NULL,
  qr_code_path VARCHAR(255) DEFAULT NULL,
  maintenance_status ENUM('Operational','Scheduled Maintenance','Under Maintenance','Repair Needed','Retired') NOT NULL DEFAULT 'Operational',
  borrowing_rules TEXT,
  status ENUM('active','archived') NOT NULL DEFAULT 'active',
  last_maintenance DATE DEFAULT NULL,
  next_maintenance DATE DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- REQUESTS
-- ------------------------------------------------------------
CREATE TABLE requests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  request_code VARCHAR(20) NOT NULL UNIQUE,
  user_id INT NOT NULL,
  equipment_id INT NOT NULL,
  quantity INT NOT NULL DEFAULT 1,
  purpose VARCHAR(255),
  activity_event VARCHAR(255),
  department_program VARCHAR(150),
  date_needed DATE NOT NULL,
  time_needed TIME,
  expected_return_date DATE NOT NULL,
  expected_return_time TIME,
  supporting_document VARCHAR(255) DEFAULT NULL,
  status ENUM('submitted','under_review','approved','rejected','ready_for_pickup','borrowed','returned','completed','cancelled') NOT NULL DEFAULT 'submitted',
  rejection_reason TEXT,
  reviewed_by INT DEFAULT NULL,
  reviewed_at DATETIME DEFAULT NULL,
  ready_at DATETIME DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (equipment_id) REFERENCES equipment(id) ON DELETE CASCADE,
  FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- BORROWINGS (created once a request is picked up / released)
-- ------------------------------------------------------------
CREATE TABLE borrowings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  request_id INT NOT NULL UNIQUE,
  user_id INT NOT NULL,
  equipment_id INT NOT NULL,
  qr_token VARCHAR(64) NOT NULL UNIQUE,
  borrow_date DATETIME DEFAULT NULL,
  due_date DATETIME NOT NULL,
  return_date DATETIME DEFAULT NULL,
  condition_before ENUM('Excellent','Good','Fair','Poor') DEFAULT 'Good',
  condition_after ENUM('Good','Minor Damage','Damaged','Missing Parts') DEFAULT NULL,
  remarks TEXT,
  released_by INT DEFAULT NULL,
  received_by INT DEFAULT NULL,
  status ENUM('active','returned','overdue') NOT NULL DEFAULT 'active',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (request_id) REFERENCES requests(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (equipment_id) REFERENCES equipment(id) ON DELETE CASCADE,
  FOREIGN KEY (released_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (received_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- NOTIFICATIONS
-- ------------------------------------------------------------
CREATE TABLE notifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  type ENUM('approved','rejected','ready_for_pickup','due_soon','overdue','returned','maintenance','info') NOT NULL DEFAULT 'info',
  title VARCHAR(150) NOT NULL,
  message VARCHAR(255) NOT NULL,
  related_request_id INT DEFAULT NULL,
  is_read TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (related_request_id) REFERENCES requests(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- MAINTENANCE LOGS
-- ------------------------------------------------------------
CREATE TABLE maintenance_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  equipment_id INT NOT NULL,
  problem VARCHAR(255) NOT NULL,
  reported_by INT DEFAULT NULL,
  date_reported DATE NOT NULL,
  assigned_technician VARCHAR(150),
  status ENUM('Scheduled','In Progress','Completed') NOT NULL DEFAULT 'Scheduled',
  completion_date DATE DEFAULT NULL,
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (equipment_id) REFERENCES equipment(id) ON DELETE CASCADE,
  FOREIGN KEY (reported_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- AUDIT TRAIL
-- ------------------------------------------------------------
CREATE TABLE audit_trail (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT DEFAULT NULL,
  action VARCHAR(255) NOT NULL,
  module VARCHAR(100) NOT NULL,
  details VARCHAR(255),
  ip_address VARCHAR(50),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

SET FOREIGN_KEY_CHECKS = 1;

-- Helpful indexes
CREATE INDEX idx_requests_status ON requests(status);
CREATE INDEX idx_requests_user ON requests(user_id);
CREATE INDEX idx_borrowings_status ON borrowings(status);
CREATE INDEX idx_equipment_category ON equipment(category_id);
CREATE INDEX idx_notifications_user ON notifications(user_id, is_read);
CREATE INDEX idx_audit_created ON audit_trail(created_at);
