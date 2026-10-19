CREATE DATABASE IF NOT EXISTS fagym
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

USE fagym;

CREATE USER IF NOT EXISTS 'fagym_app'@'localhost'
    IDENTIFIED BY 'REPLACE_WITH_A_LONG_RANDOM_PASSWORD';
ALTER USER 'fagym_app'@'localhost'
    IDENTIFIED BY 'REPLACE_WITH_A_LONG_RANDOM_PASSWORD';

CREATE USER IF NOT EXISTS 'fagym_app'@'127.0.0.1'
    IDENTIFIED BY 'REPLACE_WITH_A_LONG_RANDOM_PASSWORD';
ALTER USER 'fagym_app'@'127.0.0.1'
    IDENTIFIED BY 'REPLACE_WITH_A_LONG_RANDOM_PASSWORD';

CREATE TABLE IF NOT EXISTS members (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    full_name VARCHAR(160) NOT NULL,
    phone VARCHAR(40) NOT NULL,
    email VARCHAR(254) NOT NULL,
    plan VARCHAR(32) NOT NULL,
    start_date DATE NOT NULL,
    goal TEXT NOT NULL,
    contact_consent BOOLEAN NOT NULL DEFAULT FALSE,
    photo MEDIUMTEXT NULL,
    submitted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    INDEX idx_members_name (full_name),
    INDEX idx_members_email (email),
    INDEX idx_members_phone (phone)
) ENGINE=InnoDB
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

GRANT SELECT, INSERT, UPDATE, CREATE, INDEX ON fagym.* TO 'fagym_app'@'localhost';
GRANT SELECT, INSERT, UPDATE, CREATE, INDEX ON fagym.* TO 'fagym_app'@'127.0.0.1';
