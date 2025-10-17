-- phpMyAdmin SQL Dump
-- version 5.2.1
-- https://www.phpmyadmin.net/
--
-- Host: 127.0.0.1:3306
-- Generation Time: Oct 17, 2025 at 04:37 AM
-- Server version: 9.1.0
-- PHP Version: 8.3.14

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Database: `bantrans_db`
--

DELIMITER $$
--
-- Procedures
--
DROP PROCEDURE IF EXISTS `advance_queue`$$
CREATE DEFINER=`root`@`localhost` PROCEDURE `advance_queue` (IN `departed_trip_id` INT)   BEGIN
    DECLARE affected_route_id INT;
    
    SELECT route_id INTO affected_route_id
    FROM trips
    WHERE trip_id = departed_trip_id;
    
    UPDATE trips
    SET trip_status = 'departed',
        actual_departure_datetime = NOW(),
        is_accepting_bookings = FALSE
    WHERE trip_id = departed_trip_id;
    
    UPDATE trips
    SET queue_position = queue_position - 1,
        is_accepting_bookings = CASE 
            WHEN queue_position = 2 THEN TRUE 
            ELSE FALSE 
        END,
        trip_status = CASE 
            WHEN queue_position = 2 THEN 'boarding' 
            ELSE trip_status 
        END
    WHERE route_id = affected_route_id
      AND queue_position > 1
      AND trip_status IN ('waiting', 'boarding');
    
    INSERT INTO system_log (user_id, action_type, description)
    SELECT 
        driver_id,
        'queue_advanced',
        CONCAT('Queue advanced for route ', affected_route_id, ' after trip ', departed_trip_id, ' departed')
    FROM trips
    WHERE trip_id = departed_trip_id;
END$$

DROP PROCEDURE IF EXISTS `cancel_booking`$$
CREATE DEFINER=`root`@`localhost` PROCEDURE `cancel_booking` (IN `p_booking_id` INT)   BEGIN
    DECLARE v_trip_id INT;
    DECLARE v_seat_count INT;
    DECLARE v_payment_status VARCHAR(20);
    
    SELECT trip_id, seat_count, payment_status 
    INTO v_trip_id, v_seat_count, v_payment_status
    FROM bookings
    WHERE booking_id = p_booking_id;
    
    IF v_payment_status = 'cancelled' THEN
        SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Booking is already cancelled';
    END IF;
    
    UPDATE bookings
    SET payment_status = 'cancelled'
    WHERE booking_id = p_booking_id;
    
    INSERT INTO system_log (action_type, description)
    VALUES (
        'booking_cancelled',
        CONCAT('Booking #', p_booking_id, ' cancelled. ', v_seat_count, ' seat(s) returned to trip #', v_trip_id)
    );
    
    SELECT 'Booking cancelled successfully' AS message;
END$$

DROP PROCEDURE IF EXISTS `create_booking`$$
CREATE DEFINER=`root`@`localhost` PROCEDURE `create_booking` (IN `p_trip_id` INT, IN `p_firstname` VARCHAR(100), IN `p_lastname` VARCHAR(100), IN `p_email` VARCHAR(255), IN `p_phone` VARCHAR(20), IN `p_address` TEXT, IN `p_seat_count` INT, IN `p_booking_type` ENUM('online','walk-in'), IN `p_payment_method` ENUM('cash','gcash','paymaya','online','terminal'), IN `p_payment_reference` VARCHAR(100))   BEGIN
    DECLARE v_fare DECIMAL(8,2);
    DECLARE v_total DECIMAL(10,2);
    DECLARE v_booking_id INT;
    DECLARE v_ticket_reference VARCHAR(20);
    DECLARE v_seats_available INT;
    DECLARE v_trip_status VARCHAR(20);
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;
    
    START TRANSACTION;
    
    SELECT seats_available, fare_price, trip_status
    INTO v_seats_available, v_fare, v_trip_status
    FROM trips
    WHERE trip_id = p_trip_id
    FOR UPDATE;
    
    IF v_trip_status NOT IN ('boarding', 'full') THEN
        SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'This trip is not accepting bookings';
    END IF;
    
    IF v_seats_available < p_seat_count THEN
        SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Not enough seats available';
    END IF;
    
    SET v_total = v_fare * p_seat_count;
    
    -- Generate ticket reference BEFORE insert
    -- Get next booking_id
    SET v_booking_id = (SELECT IFNULL(MAX(booking_id), 0) + 1 FROM bookings);
    SET v_ticket_reference = CONCAT('BT-', YEAR(NOW()), '-', LPAD(v_booking_id, 4, '0'));
    
    -- Insert booking WITH ticket_reference
    INSERT INTO bookings (
        ticket_reference,
        trip_id,
        passenger_firstname,
        passenger_lastname,
        passenger_email,
        passenger_phone,
        passenger_address,
        seat_count,
        booking_type,
        payment_status,
        total_amount
    ) VALUES (
        v_ticket_reference,
        p_trip_id,
        p_firstname,
        p_lastname,
        p_email,
        p_phone,
        p_address,
        p_seat_count,
        p_booking_type,
        'paid',
        v_total
    );
    
    SET v_booking_id = LAST_INSERT_ID();
    
    INSERT INTO payment_log (
        booking_id,
        trip_id,
        description,
        amount,
        payment_method,
        payment_reference,
        payment_datetime
    ) VALUES (
        v_booking_id,
        p_trip_id,
        CONCAT(p_booking_type, ' booking - ', p_seat_count, ' seat(s)'),
        v_total,
        p_payment_method,
        p_payment_reference,
        NOW()
    );
    
    COMMIT;
    
    SELECT 
        v_booking_id AS booking_id,
        p_trip_id AS trip_id,
        v_total AS total_amount,
        v_ticket_reference AS ticket_reference,
        'Booking created successfully' AS message;
END$$

DROP PROCEDURE IF EXISTS `create_trip_in_queue`$$
CREATE DEFINER=`root`@`localhost` PROCEDURE `create_trip_in_queue` (IN `p_route_id` INT, IN `p_vehicle_id` INT, IN `p_driver_id` INT, IN `p_estimated_departure` DATETIME)   BEGIN
    DECLARE v_capacity INT;
    DECLARE v_fare DECIMAL(8,2);
    DECLARE v_duration INT;
    DECLARE v_next_position INT;
    
    SELECT capacity INTO v_capacity
    FROM vehicles
    WHERE vehicle_id = p_vehicle_id;
    
    SELECT fare_price, estimated_duration_minutes 
    INTO v_fare, v_duration
    FROM routes
    WHERE route_id = p_route_id;
    
    SELECT IFNULL(MAX(queue_position), 0) + 1 INTO v_next_position
    FROM trips
    WHERE route_id = p_route_id
      AND trip_status IN ('waiting', 'boarding', 'full');
    
    INSERT INTO trips (
        route_id,
        assigned_vehicle_id,
        driver_id,
        queue_position,
        is_accepting_bookings,
        estimated_departure_time,
        capacity,
        trip_status,
        fare_price,
        estimated_trip_duration_minutes
    ) VALUES (
        p_route_id,
        p_vehicle_id,
        p_driver_id,
        v_next_position,
        CASE WHEN v_next_position = 1 THEN TRUE ELSE FALSE END,
        p_estimated_departure,
        v_capacity,
        CASE WHEN v_next_position = 1 THEN 'boarding' ELSE 'waiting' END,
        v_fare,
        v_duration
    );
    
    INSERT INTO system_log (user_id, action_type, description)
    VALUES (
        p_driver_id,
        'trip_created',
        CONCAT('New trip created in queue position ', v_next_position, ' for route ', p_route_id)
    );
    
    SELECT LAST_INSERT_ID() as trip_id;
END$$

DROP PROCEDURE IF EXISTS `get_available_trips`$$
CREATE DEFINER=`root`@`localhost` PROCEDURE `get_available_trips` ()   BEGIN
    SELECT 
        t.trip_id,
        t.estimated_departure_time,
        t.seats_available,
        t.capacity,
        t.fare_price,
        t.trip_status,
        r.route_id,
        r.origin,
        r.destination,
        r.estimated_duration_minutes,
        v.vehicle_type,
        v.plate_number,
        CONCAT(u.firstname, ' ', u.lastname) AS driver_name
    FROM trips t
    JOIN routes r ON t.route_id = r.route_id
    JOIN vehicles v ON t.assigned_vehicle_id = v.vehicle_id
    JOIN users u ON t.driver_id = u.user_id
    WHERE t.is_accepting_bookings = TRUE
      AND t.trip_status IN ('boarding', 'full')
      AND r.status = 'active'
    ORDER BY r.destination, t.estimated_departure_time;
END$$

DROP PROCEDURE IF EXISTS `get_booking_by_ticket_reference`$$
CREATE DEFINER=`root`@`localhost` PROCEDURE `get_booking_by_ticket_reference` (IN `p_ticket_reference` VARCHAR(20))   BEGIN
    SELECT 
        b.booking_id,
        b.ticket_reference,
        b.trip_id,
        CONCAT(b.passenger_firstname, ' ', b.passenger_lastname) AS passenger_name,
        b.passenger_email,
        b.passenger_phone,
        b.passenger_address,
        b.seat_count,
        b.booking_type,
        b.payment_status,
        b.total_amount,
        b.booking_date,
        t.estimated_departure_time,
        t.trip_status,
        r.origin,
        r.destination,
        r.fare_price,
        v.plate_number,
        v.vehicle_type,
        CONCAT(u.firstname, ' ', u.lastname) AS driver_name,
        u.phone_number AS driver_phone
    FROM bookings b
    JOIN trips t ON b.trip_id = t.trip_id
    JOIN routes r ON t.route_id = r.route_id
    LEFT JOIN vehicles v ON t.assigned_vehicle_id = v.vehicle_id
    LEFT JOIN users u ON t.driver_id = u.user_id
    WHERE b.ticket_reference = p_ticket_reference;
END$$

DROP PROCEDURE IF EXISTS `get_booking_details`$$
CREATE DEFINER=`root`@`localhost` PROCEDURE `get_booking_details` (IN `p_booking_id` INT)   BEGIN
    SELECT 
        b.booking_id,
        b.ticket_reference,
        b.trip_id,
        CONCAT(b.passenger_firstname, ' ', b.passenger_lastname) AS passenger_name,
        b.passenger_email,
        b.passenger_phone,
        b.passenger_address,
        b.seat_count,
        b.booking_type,
        b.payment_status,
        b.total_amount,
        b.booking_date,
        t.estimated_departure_time,
        t.trip_status,
        r.origin,
        r.destination,
        r.fare_price,
        v.plate_number,
        v.vehicle_type,
        CONCAT(u.firstname, ' ', u.lastname) AS driver_name,
        u.phone_number AS driver_phone
    FROM bookings b
    JOIN trips t ON b.trip_id = t.trip_id
    JOIN routes r ON t.route_id = r.route_id
    LEFT JOIN vehicles v ON t.assigned_vehicle_id = v.vehicle_id
    LEFT JOIN users u ON t.driver_id = u.user_id
    WHERE b.booking_id = p_booking_id;
END$$

DROP PROCEDURE IF EXISTS `get_driver_performance_report`$$
CREATE DEFINER=`root`@`localhost` PROCEDURE `get_driver_performance_report` (IN `start_date` DATE, IN `end_date` DATE)   BEGIN
    SELECT 
        u.user_id,
        CONCAT(u.firstname, ' ', u.lastname) AS driver_name,
        COUNT(t.trip_id) AS trips_in_period,
        SUM(t.seats_booked) AS passengers_transported,
        AVG(t.seats_booked) AS avg_passengers_per_trip,
        dd.trips_completed AS lifetime_trips,
        dd.total_distance_driven AS lifetime_distance,
        dd.delayed_trips
    FROM users u
    JOIN driver_details dd ON u.user_id = dd.driver_id
    LEFT JOIN trips t ON u.user_id = t.driver_id 
        AND DATE(t.actual_departure_datetime) BETWEEN start_date AND end_date
        AND t.trip_status IN ('departed', 'arrived')
    WHERE u.role = 'driver'
    GROUP BY u.user_id
    ORDER BY trips_in_period DESC;
END$$

DROP PROCEDURE IF EXISTS `get_revenue_report`$$
CREATE DEFINER=`root`@`localhost` PROCEDURE `get_revenue_report` (IN `start_date` DATE, IN `end_date` DATE)   BEGIN
    SELECT 
        DATE(p.payment_datetime) AS payment_date,
        r.destination,
        COUNT(DISTINCT b.booking_id) AS total_bookings,
        SUM(b.seat_count) AS total_seats_sold,
        SUM(p.amount) AS total_revenue,
        AVG(p.amount) AS average_transaction,
        b.booking_type
    FROM payment_log p
    JOIN bookings b ON p.booking_id = b.booking_id
    JOIN trips t ON b.trip_id = t.trip_id
    JOIN routes r ON t.route_id = r.route_id
    WHERE DATE(p.payment_datetime) BETWEEN start_date AND end_date
    GROUP BY DATE(p.payment_datetime), r.destination, b.booking_type
    ORDER BY payment_date DESC, r.destination;
END$$

DROP PROCEDURE IF EXISTS `get_trip_statistics`$$
CREATE DEFINER=`root`@`localhost` PROCEDURE `get_trip_statistics` (IN `start_date` DATE, IN `end_date` DATE)   BEGIN
    SELECT 
        r.destination,
        COUNT(t.trip_id) AS total_trips,
        SUM(t.seats_booked) AS total_passengers,
        AVG(t.seats_booked) AS avg_passengers_per_trip,
        SUM(CASE WHEN t.seats_booked = t.capacity THEN 1 ELSE 0 END) AS full_trips,
        ROUND(SUM(CASE WHEN t.seats_booked = t.capacity THEN 1 ELSE 0 END) / COUNT(t.trip_id) * 100, 2) AS occupancy_rate
    FROM trips t
    JOIN routes r ON t.route_id = r.route_id
    WHERE DATE(t.actual_departure_datetime) BETWEEN start_date AND end_date
      AND t.trip_status IN ('departed', 'arrived')
    GROUP BY r.destination
    ORDER BY total_trips DESC;
END$$

DROP PROCEDURE IF EXISTS `mark_trip_arrived`$$
CREATE DEFINER=`root`@`localhost` PROCEDURE `mark_trip_arrived` (IN `p_trip_id` INT)   BEGIN
    UPDATE trips
    SET trip_status = 'arrived',
        actual_arrival_datetime = NOW()
    WHERE trip_id = p_trip_id;
    
    SELECT 'Trip marked as arrived successfully' AS message;
END$$

DROP PROCEDURE IF EXISTS `smart_booking`$$
CREATE DEFINER=`root`@`localhost` PROCEDURE `smart_booking` (IN `p_route_id` INT, IN `p_firstname` VARCHAR(100), IN `p_lastname` VARCHAR(100), IN `p_email` VARCHAR(255), IN `p_phone` VARCHAR(20), IN `p_address` TEXT, IN `p_seat_count` INT, IN `p_booking_type` ENUM('online','walk-in'), IN `p_payment_method` ENUM('cash','gcash','paymaya','online','terminal'), IN `p_payment_reference` VARCHAR(100))   BEGIN
    DECLARE v_trip_id INT;
    DECLARE v_seats_available INT;
    
    SELECT trip_id, seats_available
    INTO v_trip_id, v_seats_available
    FROM trips
    WHERE route_id = p_route_id
      AND is_accepting_bookings = TRUE
      AND seats_available >= p_seat_count
      AND trip_status IN ('boarding')
    ORDER BY queue_position
    LIMIT 1;
    
    IF v_trip_id IS NULL THEN
        SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'No trips available with enough seats. Please contact dispatcher.';
    END IF;
    
    CALL create_booking(
        v_trip_id,
        p_firstname,
        p_lastname,
        p_email,
        p_phone,
        p_address,
        p_seat_count,
        p_booking_type,
        p_payment_method,
        p_payment_reference
    );
END$$

DELIMITER ;

-- --------------------------------------------------------

--
-- Table structure for table `bookings`
--

DROP TABLE IF EXISTS `bookings`;
CREATE TABLE IF NOT EXISTS `bookings` (
  `booking_id` int NOT NULL AUTO_INCREMENT,
  `ticket_reference` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `trip_id` int NOT NULL,
  `passenger_firstname` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `passenger_lastname` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `passenger_email` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `passenger_phone` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `passenger_address` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `seat_count` int NOT NULL,
  `booking_type` enum('online','walk-in') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `payment_status` enum('pending','paid','cancelled','refunded') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT 'pending',
  `total_amount` decimal(10,2) NOT NULL,
  `booking_date` datetime DEFAULT CURRENT_TIMESTAMP,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`booking_id`),
  UNIQUE KEY `ticket_reference` (`ticket_reference`),
  KEY `idx_trip` (`trip_id`),
  KEY `idx_email` (`passenger_email`),
  KEY `idx_payment_status` (`payment_status`),
  KEY `idx_booking_type` (`booking_type`),
  KEY `idx_booking_date` (`booking_date`),
  KEY `idx_bookings_trip_payment` (`trip_id`,`payment_status`),
  KEY `idx_ticket_reference` (`ticket_reference`)
) ENGINE=InnoDB AUTO_INCREMENT=15 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Triggers `bookings`
--
DROP TRIGGER IF EXISTS `update_trip_seats_on_booking_cancel`;
DELIMITER $$
CREATE TRIGGER `update_trip_seats_on_booking_cancel` AFTER UPDATE ON `bookings` FOR EACH ROW BEGIN
    IF OLD.payment_status = 'paid' AND NEW.payment_status = 'cancelled' THEN
        UPDATE trips
        SET seats_booked = seats_booked - NEW.seat_count
        WHERE trip_id = NEW.trip_id;
    END IF;
    
    IF OLD.payment_status = 'pending' AND NEW.payment_status = 'paid' THEN
        UPDATE trips
        SET seats_booked = seats_booked + NEW.seat_count
        WHERE trip_id = NEW.trip_id;
    END IF;
END
$$
DELIMITER ;
DROP TRIGGER IF EXISTS `update_trip_seats_on_booking_insert`;
DELIMITER $$
CREATE TRIGGER `update_trip_seats_on_booking_insert` AFTER INSERT ON `bookings` FOR EACH ROW BEGIN
    IF NEW.payment_status = 'paid' THEN
        UPDATE trips
        SET seats_booked = seats_booked + NEW.seat_count
        WHERE trip_id = NEW.trip_id;
    END IF;
END
$$
DELIMITER ;

-- --------------------------------------------------------

--
-- Table structure for table `driver_details`
--

DROP TABLE IF EXISTS `driver_details`;
CREATE TABLE IF NOT EXISTS `driver_details` (
  `driver_id` int NOT NULL,
  `license_number` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `license_expiry` date DEFAULT NULL,
  `qualifications` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `id_picture` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `trips_completed` int DEFAULT '0',
  `total_distance_driven` decimal(10,2) DEFAULT '0.00',
  `delayed_trips` int DEFAULT '0',
  `driver_status` enum('available','on_trip','unavailable','off_duty') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT 'available',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`driver_id`),
  UNIQUE KEY `license_number` (`license_number`),
  KEY `idx_driver_status` (`driver_status`),
  KEY `idx_license_number` (`license_number`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `notifications`
--

DROP TABLE IF EXISTS `notifications`;
CREATE TABLE IF NOT EXISTS `notifications` (
  `notification_id` int NOT NULL AUTO_INCREMENT,
  `creator_id` int NOT NULL,
  `title` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `body` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`notification_id`),
  KEY `creator_id` (`creator_id`),
  KEY `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `payment_log`
--

DROP TABLE IF EXISTS `payment_log`;
CREATE TABLE IF NOT EXISTS `payment_log` (
  `payment_id` int NOT NULL AUTO_INCREMENT,
  `booking_id` int NOT NULL,
  `trip_id` int NOT NULL,
  `description` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `amount` decimal(10,2) NOT NULL,
  `payment_method` enum('cash','gcash','paymaya','online','terminal') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `payment_reference` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `payment_datetime` datetime DEFAULT CURRENT_TIMESTAMP,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`payment_id`),
  KEY `idx_booking` (`booking_id`),
  KEY `idx_trip` (`trip_id`),
  KEY `idx_payment_datetime` (`payment_datetime`),
  KEY `idx_payment_method` (`payment_method`),
  KEY `idx_payment_log_date` (`payment_datetime`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `routes`
--

DROP TABLE IF EXISTS `routes`;
CREATE TABLE IF NOT EXISTS `routes` (
  `route_id` int NOT NULL AUTO_INCREMENT,
  `origin` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `destination` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `distance_km` decimal(6,2) DEFAULT NULL,
  `estimated_duration_minutes` int DEFAULT NULL,
  `fare_price` decimal(8,2) NOT NULL,
  `status` enum('active','inactive') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT 'active',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`route_id`),
  KEY `idx_status` (`status`),
  KEY `idx_destination` (`destination`)
) ENGINE=InnoDB AUTO_INCREMENT=16 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `system_log`
--

DROP TABLE IF EXISTS `system_log`;
CREATE TABLE IF NOT EXISTS `system_log` (
  `log_id` int NOT NULL AUTO_INCREMENT,
  `user_id` int DEFAULT NULL,
  `action_type` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `ip_address` varchar(45) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`log_id`),
  KEY `idx_action_type` (`action_type`),
  KEY `idx_created_at` (`created_at`),
  KEY `idx_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `trips`
--

DROP TABLE IF EXISTS `trips`;
CREATE TABLE IF NOT EXISTS `trips` (
  `trip_id` int NOT NULL AUTO_INCREMENT,
  `route_id` int NOT NULL,
  `assigned_vehicle_id` int DEFAULT NULL,
  `driver_id` int DEFAULT NULL,
  `queue_position` int NOT NULL,
  `is_accepting_bookings` tinyint(1) DEFAULT '0',
  `estimated_departure_time` datetime DEFAULT NULL,
  `actual_departure_datetime` datetime DEFAULT NULL,
  `actual_arrival_datetime` datetime DEFAULT NULL,
  `estimated_trip_duration_minutes` int DEFAULT NULL,
  `capacity` int NOT NULL,
  `seats_booked` int DEFAULT '0',
  `seats_available` int GENERATED ALWAYS AS ((`capacity` - `seats_booked`)) STORED,
  `trip_status` enum('waiting','boarding','full','departed','arrived','cancelled') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT 'waiting',
  `fare_price` decimal(8,2) NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`trip_id`),
  KEY `assigned_vehicle_id` (`assigned_vehicle_id`),
  KEY `idx_queue` (`route_id`,`queue_position`),
  KEY `idx_accepting_bookings` (`route_id`,`is_accepting_bookings`),
  KEY `idx_trip_status` (`trip_status`),
  KEY `idx_estimated_departure` (`estimated_departure_time`),
  KEY `idx_driver` (`driver_id`),
  KEY `idx_trips_route_status` (`route_id`,`trip_status`),
  KEY `idx_trips_driver_status` (`driver_id`,`trip_status`)
) ENGINE=InnoDB AUTO_INCREMENT=19 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Triggers `trips`
--
DROP TRIGGER IF EXISTS `log_trip_departure`;
DELIMITER $$
CREATE TRIGGER `log_trip_departure` AFTER UPDATE ON `trips` FOR EACH ROW BEGIN
    IF NEW.trip_status = 'departed' AND OLD.trip_status != 'departed' THEN
        INSERT INTO system_log (user_id, action_type, description)
        VALUES (
            NEW.driver_id,
            'trip_departed',
            CONCAT('Trip #', NEW.trip_id, ' departed at ', NEW.actual_departure_datetime)
        );
    END IF;
END
$$
DELIMITER ;
DROP TRIGGER IF EXISTS `update_driver_stats_on_arrival`;
DELIMITER $$
CREATE TRIGGER `update_driver_stats_on_arrival` AFTER UPDATE ON `trips` FOR EACH ROW BEGIN
    IF NEW.trip_status = 'arrived' AND OLD.trip_status != 'arrived' AND NEW.driver_id IS NOT NULL THEN
        SET @distance = (SELECT distance_km FROM routes WHERE route_id = NEW.route_id);
        
        UPDATE driver_details
        SET trips_completed = trips_completed + 1,
            total_distance_driven = total_distance_driven + IFNULL(@distance, 0),
            driver_status = 'available'
        WHERE driver_id = NEW.driver_id;
    END IF;
    
    IF NEW.trip_status = 'departed' AND OLD.trip_status != 'departed' AND NEW.driver_id IS NOT NULL THEN
        UPDATE driver_details
        SET driver_status = 'on_trip'
        WHERE driver_id = NEW.driver_id;
    END IF;
END
$$
DELIMITER ;
DROP TRIGGER IF EXISTS `update_trip_status_on_full`;
DELIMITER $$
CREATE TRIGGER `update_trip_status_on_full` BEFORE UPDATE ON `trips` FOR EACH ROW BEGIN
    IF NEW.seats_booked >= NEW.capacity AND NEW.trip_status = 'boarding' THEN
        SET NEW.trip_status = 'full';
    END IF;
END
$$
DELIMITER ;
DROP TRIGGER IF EXISTS `update_vehicle_status_on_trip`;
DELIMITER $$
CREATE TRIGGER `update_vehicle_status_on_trip` AFTER UPDATE ON `trips` FOR EACH ROW BEGIN
    IF NEW.trip_status = 'departed' AND OLD.trip_status != 'departed' AND NEW.assigned_vehicle_id IS NOT NULL THEN
        UPDATE vehicles
        SET vehicle_status = 'in_service'
        WHERE vehicle_id = NEW.assigned_vehicle_id;
    END IF;
    
    IF NEW.trip_status = 'arrived' AND OLD.trip_status != 'arrived' AND NEW.assigned_vehicle_id IS NOT NULL THEN
        UPDATE vehicles
        SET vehicle_status = 'available'
        WHERE vehicle_id = NEW.assigned_vehicle_id;
    END IF;
END
$$
DELIMITER ;

-- --------------------------------------------------------

--
-- Table structure for table `users`
--

DROP TABLE IF EXISTS `users`;
CREATE TABLE IF NOT EXISTS `users` (
  `user_id` int NOT NULL AUTO_INCREMENT,
  `firstname` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `lastname` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `email` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `password` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `phone_number` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `role` enum('admin','dispatcher','driver','passenger') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` enum('active','inactive','blocked') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT 'active',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`),
  UNIQUE KEY `email` (`email`),
  KEY `idx_email` (`email`),
  KEY `idx_role` (`role`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB AUTO_INCREMENT=29 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `user_notifications`
--

DROP TABLE IF EXISTS `user_notifications`;
CREATE TABLE IF NOT EXISTS `user_notifications` (
  `user_notification_id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `notification_id` int NOT NULL,
  `is_read` tinyint(1) DEFAULT '0',
  `read_at` datetime DEFAULT NULL,
  PRIMARY KEY (`user_notification_id`),
  UNIQUE KEY `unique_user_notification` (`user_id`,`notification_id`),
  KEY `idx_user_unread` (`user_id`,`is_read`),
  KEY `idx_notification` (`notification_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `vehicles`
--

DROP TABLE IF EXISTS `vehicles`;
CREATE TABLE IF NOT EXISTS `vehicles` (
  `vehicle_id` int NOT NULL AUTO_INCREMENT,
  `plate_number` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `make` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `model` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `year` int DEFAULT NULL,
  `vehicle_type` enum('van','mini-bus') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `capacity` int NOT NULL,
  `brand` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `vehicle_status` enum('available','in_service','maintenance','retired') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT 'available',
  `last_maintenance_date` date DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`vehicle_id`),
  UNIQUE KEY `plate_number` (`plate_number`),
  KEY `idx_vehicle_status` (`vehicle_status`),
  KEY `idx_vehicle_type` (`vehicle_type`),
  KEY `idx_plate_number` (`plate_number`)
) ENGINE=InnoDB AUTO_INCREMENT=29 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Stand-in structure for view `view_active_bookings`
-- (See below for the actual view)
--
DROP VIEW IF EXISTS `view_active_bookings`;
CREATE TABLE IF NOT EXISTS `view_active_bookings` (
`booking_id` int
,`ticket_reference` varchar(20)
,`trip_id` int
,`passenger_name` varchar(201)
,`passenger_email` varchar(255)
,`passenger_phone` varchar(20)
,`seat_count` int
,`booking_type` enum('online','walk-in')
,`payment_status` enum('pending','paid','cancelled','refunded')
,`total_amount` decimal(10,2)
,`booking_date` datetime
,`estimated_departure_time` datetime
,`trip_status` enum('waiting','boarding','full','departed','arrived','cancelled')
,`origin` varchar(100)
,`destination` varchar(100)
,`plate_number` varchar(20)
,`driver_name` varchar(201)
);

-- --------------------------------------------------------

--
-- Stand-in structure for view `view_daily_revenue`
-- (See below for the actual view)
--
DROP VIEW IF EXISTS `view_daily_revenue`;
CREATE TABLE IF NOT EXISTS `view_daily_revenue` (
`payment_date` date
,`destination` varchar(100)
,`total_bookings` bigint
,`total_seats_sold` decimal(32,0)
,`total_revenue` decimal(32,2)
,`booking_type` enum('online','walk-in')
);

-- --------------------------------------------------------

--
-- Stand-in structure for view `view_driver_performance`
-- (See below for the actual view)
--
DROP VIEW IF EXISTS `view_driver_performance`;
CREATE TABLE IF NOT EXISTS `view_driver_performance` (
`user_id` int
,`driver_name` varchar(201)
,`email` varchar(255)
,`phone_number` varchar(20)
,`license_number` varchar(50)
,`trips_completed` int
,`total_distance_driven` decimal(10,2)
,`delayed_trips` int
,`driver_status` enum('available','on_trip','unavailable','off_duty')
,`trips_today` bigint
);

-- --------------------------------------------------------

--
-- Stand-in structure for view `view_queue_status`
-- (See below for the actual view)
--
DROP VIEW IF EXISTS `view_queue_status`;
CREATE TABLE IF NOT EXISTS `view_queue_status` (
`route_id` int
,`origin` varchar(100)
,`destination` varchar(100)
,`trip_id` int
,`queue_position` int
,`trip_status` enum('waiting','boarding','full','departed','arrived','cancelled')
,`is_accepting_bookings` tinyint(1)
,`estimated_departure_time` datetime
,`seats_booked` int
,`seats_available` int
,`capacity` int
,`plate_number` varchar(20)
,`vehicle_type` enum('van','mini-bus')
,`driver_name` varchar(201)
);

-- --------------------------------------------------------

--
-- Structure for view `view_active_bookings`
--
DROP TABLE IF EXISTS `view_active_bookings`;

DROP VIEW IF EXISTS `view_active_bookings`;
CREATE ALGORITHM=UNDEFINED DEFINER=`root`@`localhost` SQL SECURITY DEFINER VIEW `view_active_bookings`  AS SELECT `b`.`booking_id` AS `booking_id`, `b`.`ticket_reference` AS `ticket_reference`, `b`.`trip_id` AS `trip_id`, concat(`b`.`passenger_firstname`,' ',`b`.`passenger_lastname`) AS `passenger_name`, `b`.`passenger_email` AS `passenger_email`, `b`.`passenger_phone` AS `passenger_phone`, `b`.`seat_count` AS `seat_count`, `b`.`booking_type` AS `booking_type`, `b`.`payment_status` AS `payment_status`, `b`.`total_amount` AS `total_amount`, `b`.`booking_date` AS `booking_date`, `t`.`estimated_departure_time` AS `estimated_departure_time`, `t`.`trip_status` AS `trip_status`, `r`.`origin` AS `origin`, `r`.`destination` AS `destination`, `v`.`plate_number` AS `plate_number`, concat(`u`.`firstname`,' ',`u`.`lastname`) AS `driver_name` FROM ((((`bookings` `b` join `trips` `t` on((`b`.`trip_id` = `t`.`trip_id`))) join `routes` `r` on((`t`.`route_id` = `r`.`route_id`))) left join `vehicles` `v` on((`t`.`assigned_vehicle_id` = `v`.`vehicle_id`))) left join `users` `u` on((`t`.`driver_id` = `u`.`user_id`))) WHERE ((`b`.`payment_status` = 'paid') AND (`t`.`trip_status` in ('boarding','full','departed'))) ORDER BY `t`.`estimated_departure_time` ASC ;

-- --------------------------------------------------------

--
-- Structure for view `view_daily_revenue`
--
DROP TABLE IF EXISTS `view_daily_revenue`;

DROP VIEW IF EXISTS `view_daily_revenue`;
CREATE ALGORITHM=UNDEFINED DEFINER=`root`@`localhost` SQL SECURITY DEFINER VIEW `view_daily_revenue`  AS SELECT cast(`p`.`payment_datetime` as date) AS `payment_date`, `r`.`destination` AS `destination`, count(distinct `b`.`booking_id`) AS `total_bookings`, sum(`b`.`seat_count`) AS `total_seats_sold`, sum(`p`.`amount`) AS `total_revenue`, `b`.`booking_type` AS `booking_type` FROM (((`payment_log` `p` join `bookings` `b` on((`p`.`booking_id` = `b`.`booking_id`))) join `trips` `t` on((`b`.`trip_id` = `t`.`trip_id`))) join `routes` `r` on((`t`.`route_id` = `r`.`route_id`))) WHERE (cast(`p`.`payment_datetime` as date) = curdate()) GROUP BY cast(`p`.`payment_datetime` as date), `r`.`destination`, `b`.`booking_type` ;

-- --------------------------------------------------------

--
-- Structure for view `view_driver_performance`
--
DROP TABLE IF EXISTS `view_driver_performance`;

DROP VIEW IF EXISTS `view_driver_performance`;
CREATE ALGORITHM=UNDEFINED DEFINER=`root`@`localhost` SQL SECURITY DEFINER VIEW `view_driver_performance`  AS SELECT `u`.`user_id` AS `user_id`, concat(`u`.`firstname`,' ',`u`.`lastname`) AS `driver_name`, `u`.`email` AS `email`, `u`.`phone_number` AS `phone_number`, `dd`.`license_number` AS `license_number`, `dd`.`trips_completed` AS `trips_completed`, `dd`.`total_distance_driven` AS `total_distance_driven`, `dd`.`delayed_trips` AS `delayed_trips`, `dd`.`driver_status` AS `driver_status`, count(`t`.`trip_id`) AS `trips_today` FROM ((`users` `u` join `driver_details` `dd` on((`u`.`user_id` = `dd`.`driver_id`))) left join `trips` `t` on(((`u`.`user_id` = `t`.`driver_id`) and (cast(`t`.`actual_departure_datetime` as date) = curdate())))) WHERE (`u`.`role` = 'driver') GROUP BY `u`.`user_id` ;

-- --------------------------------------------------------

--
-- Structure for view `view_queue_status`
--
DROP TABLE IF EXISTS `view_queue_status`;

DROP VIEW IF EXISTS `view_queue_status`;
CREATE ALGORITHM=UNDEFINED DEFINER=`root`@`localhost` SQL SECURITY DEFINER VIEW `view_queue_status`  AS SELECT `r`.`route_id` AS `route_id`, `r`.`origin` AS `origin`, `r`.`destination` AS `destination`, `t`.`trip_id` AS `trip_id`, `t`.`queue_position` AS `queue_position`, `t`.`trip_status` AS `trip_status`, `t`.`is_accepting_bookings` AS `is_accepting_bookings`, `t`.`estimated_departure_time` AS `estimated_departure_time`, `t`.`seats_booked` AS `seats_booked`, `t`.`seats_available` AS `seats_available`, `t`.`capacity` AS `capacity`, `v`.`plate_number` AS `plate_number`, `v`.`vehicle_type` AS `vehicle_type`, concat(`u`.`firstname`,' ',`u`.`lastname`) AS `driver_name` FROM (((`trips` `t` join `routes` `r` on((`t`.`route_id` = `r`.`route_id`))) left join `vehicles` `v` on((`t`.`assigned_vehicle_id` = `v`.`vehicle_id`))) left join `users` `u` on((`t`.`driver_id` = `u`.`user_id`))) WHERE (`t`.`trip_status` in ('waiting','boarding','full')) ORDER BY `r`.`route_id` ASC, `t`.`queue_position` ASC ;

--
-- Constraints for dumped tables
--

--
-- Constraints for table `bookings`
--
ALTER TABLE `bookings`
  ADD CONSTRAINT `bookings_ibfk_1` FOREIGN KEY (`trip_id`) REFERENCES `trips` (`trip_id`) ON DELETE CASCADE;

--
-- Constraints for table `driver_details`
--
ALTER TABLE `driver_details`
  ADD CONSTRAINT `driver_details_ibfk_1` FOREIGN KEY (`driver_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE;

--
-- Constraints for table `notifications`
--
ALTER TABLE `notifications`
  ADD CONSTRAINT `notifications_ibfk_1` FOREIGN KEY (`creator_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE;

--
-- Constraints for table `payment_log`
--
ALTER TABLE `payment_log`
  ADD CONSTRAINT `payment_log_ibfk_1` FOREIGN KEY (`booking_id`) REFERENCES `bookings` (`booking_id`) ON DELETE CASCADE,
  ADD CONSTRAINT `payment_log_ibfk_2` FOREIGN KEY (`trip_id`) REFERENCES `trips` (`trip_id`) ON DELETE CASCADE;

--
-- Constraints for table `system_log`
--
ALTER TABLE `system_log`
  ADD CONSTRAINT `system_log_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE SET NULL;

--
-- Constraints for table `trips`
--
ALTER TABLE `trips`
  ADD CONSTRAINT `trips_ibfk_1` FOREIGN KEY (`route_id`) REFERENCES `routes` (`route_id`) ON DELETE RESTRICT,
  ADD CONSTRAINT `trips_ibfk_2` FOREIGN KEY (`assigned_vehicle_id`) REFERENCES `vehicles` (`vehicle_id`) ON DELETE SET NULL,
  ADD CONSTRAINT `trips_ibfk_3` FOREIGN KEY (`driver_id`) REFERENCES `users` (`user_id`) ON DELETE SET NULL;

--
-- Constraints for table `user_notifications`
--
ALTER TABLE `user_notifications`
  ADD CONSTRAINT `user_notifications_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE,
  ADD CONSTRAINT `user_notifications_ibfk_2` FOREIGN KEY (`notification_id`) REFERENCES `notifications` (`notification_id`) ON DELETE CASCADE;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
