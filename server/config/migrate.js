const db = require("./db");

async function columnExists(table, column) {
    const [rows] = await db.promise().query(
        `SELECT COUNT(*) AS cnt
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = ?
           AND COLUMN_NAME = ?`,
        [table, column]
    );
    return rows[0].cnt > 0;
}

async function tableExists(table) {
    const [rows] = await db.promise().query(
        `SELECT COUNT(*) AS cnt
         FROM INFORMATION_SCHEMA.TABLES
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = ?`,
        [table]
    );
    return rows[0].cnt > 0;
}

async function runMigrations() {
    if (await tableExists("daily_reports")) {
        if (!(await columnExists("daily_reports", "visit_status"))) {
            await db.promise().query(
                "ALTER TABLE daily_reports ADD COLUMN visit_status VARCHAR(50) NULL AFTER shop_address"
            );
        }

        await db.promise().query(`
            ALTER TABLE daily_reports
                MODIFY product VARCHAR(255) NULL,
                MODIFY quantity INT NULL,
                MODIFY sales DECIMAL(12,2) NULL DEFAULT NULL
        `);
    }

    if (!(await tableExists("sales_orders"))) {
        await db.promise().query(`
            CREATE TABLE sales_orders (
                id INT NOT NULL AUTO_INCREMENT,
                user_id INT NOT NULL,
                employee_id VARCHAR(100) DEFAULT NULL,
                employee_name VARCHAR(255) NOT NULL,
                retailer_name VARCHAR(255) NOT NULL,
                distributor_name VARCHAR(255) NOT NULL,
                product_name VARCHAR(255) NOT NULL,
                quantity INT NOT NULL,
                expected_delivery_date DATE DEFAULT NULL,
                order_remarks TEXT,
                status ENUM('Pending','Accepted','Rejected','Processing','Delivered') NOT NULL DEFAULT 'Pending',
                created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                KEY idx_orders_employee (employee_id),
                KEY idx_orders_product (product_name),
                KEY idx_orders_status (status)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
    } else {
        if (!(await columnExists("sales_orders", "shop_address"))) {
            await db.promise().query(
                "ALTER TABLE sales_orders ADD COLUMN shop_address TEXT NULL AFTER retailer_name"
            );
        }
        if (!(await columnExists("sales_orders", "sales_amount"))) {
            await db.promise().query(
                "ALTER TABLE sales_orders ADD COLUMN sales_amount DECIMAL(12,2) NULL DEFAULT 0 AFTER quantity"
            );
        }
        await db.promise().query(`
            ALTER TABLE sales_orders
            MODIFY status ENUM('Pending','Accepted','Rejected','Processing','Delivered') NOT NULL DEFAULT 'Pending'
        `).catch(() => {});
    }

    if (!(await tableExists("company_inventory"))) {
        await db.promise().query(`
            CREATE TABLE company_inventory (
                id INT NOT NULL AUTO_INCREMENT,
                company_name VARCHAR(255) NOT NULL,
                product_name VARCHAR(255) DEFAULT NULL,
                sold_products INT NOT NULL DEFAULT 0,
                remaining_products INT NOT NULL DEFAULT 0,
                min_stock INT NOT NULL DEFAULT 10,
                total_products INT NOT NULL DEFAULT 0,
                date_time DATETIME DEFAULT NULL,
                created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
    } else if (!(await columnExists("company_inventory", "min_stock"))) {
        await db.promise().query(
            "ALTER TABLE company_inventory ADD COLUMN min_stock INT NOT NULL DEFAULT 10 AFTER remaining_products"
        );
    }

    if (!(await tableExists("stock_inventory"))) {
        await db.promise().query(`
            CREATE TABLE stock_inventory (
                id INT NOT NULL AUTO_INCREMENT,
                product_name VARCHAR(255) NOT NULL,
                quantity INT NOT NULL DEFAULT 0,
                min_stock INT NOT NULL DEFAULT 10,
                updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                UNIQUE KEY uniq_product (product_name)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        const products = [
            "GRAVY BASE MIX", "GINGER POWDER", "TURMERIC POWDER", "GARLIC POWDER",
            "TOMATO POWDER", "ONION POWDER", "CORIANDER POWDER", "CHICKEN MASALA",
            "RED CHILLI POWDER", "KASURI METHI", "PANEER MASALA", "GINGER GARLIC MIX",
            "BEETROOT POWDER", "MORINGA POWDER", "SHAHISABZI MASALA"
        ];

        for (const product of products) {
            await db.promise().query(
                "INSERT IGNORE INTO stock_inventory (product_name, quantity, min_stock) VALUES (?, 100, 10)",
                [product]
            );
        }
    }

    if (!(await tableExists("stock_replenishment_requests"))) {
        await db.promise().query(`
            CREATE TABLE stock_replenishment_requests (
                id INT NOT NULL AUTO_INCREMENT,
                superstockist_id INT NOT NULL,
                superstockist_name VARCHAR(255) NOT NULL,
                product_name VARCHAR(255) NOT NULL,
                quantity INT NOT NULL,
                status ENUM('Pending','Approved','Rejected') NOT NULL DEFAULT 'Pending',
                notes TEXT NULL,
                reviewed_by VARCHAR(255) NULL,
                reviewed_at DATETIME NULL,
                created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                KEY idx_stock_req_status (status),
                KEY idx_stock_req_superstockist (superstockist_id),
                KEY idx_stock_req_product (product_name)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
    }

    if (!(await tableExists("distributor_inventory"))) {
        await db.promise().query(`
            CREATE TABLE distributor_inventory (
                id INT NOT NULL AUTO_INCREMENT,
                distributor_id INT NOT NULL,
                distributor_name VARCHAR(255) NOT NULL,
                product_name VARCHAR(255) NOT NULL,
                total_received INT NOT NULL DEFAULT 0,
                dispatched INT NOT NULL DEFAULT 0,
                remaining INT NOT NULL DEFAULT 0,
                min_stock INT NOT NULL DEFAULT 10,
                updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                UNIQUE KEY uniq_dist_product (distributor_id, product_name),
                KEY idx_dist_inv_name (distributor_name)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
    }

    if (!(await tableExists("distributor_stock_requests"))) {
        await db.promise().query(`
            CREATE TABLE distributor_stock_requests (
                id INT NOT NULL AUTO_INCREMENT,
                distributor_id INT NOT NULL,
                distributor_name VARCHAR(255) NOT NULL,
                product_name VARCHAR(255) NOT NULL,
                quantity INT NOT NULL,
                status ENUM('Pending','Dispatched','Rejected') NOT NULL DEFAULT 'Pending',
                notes TEXT NULL,
                reviewed_by VARCHAR(255) NULL,
                reviewed_at DATETIME NULL,
                dispatched_at DATETIME NULL,
                created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                KEY idx_dist_req_status (status),
                KEY idx_dist_req_distributor (distributor_id),
                KEY idx_dist_req_product (product_name)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
    }

    if (!(await tableExists("inventory_flow_log"))) {
        await db.promise().query(`
            CREATE TABLE inventory_flow_log (
                id INT NOT NULL AUTO_INCREMENT,
                event_type ENUM('company_to_superstockist','superstockist_to_distributor','distributor_to_employee') NOT NULL,
                product_name VARCHAR(255) NOT NULL,
                quantity INT NOT NULL,
                from_name VARCHAR(255) NOT NULL,
                to_name VARCHAR(255) NOT NULL,
                from_party_id INT NULL,
                to_party_id INT NULL,
                ss_remaining_after INT NULL,
                distributor_remaining_after INT NULL,
                reference_id INT NULL,
                created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                KEY idx_flow_event (event_type),
                KEY idx_flow_created (created_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
    }

    if (!(await tableExists("daily_report_products"))) {
        await db.promise().query(`
            CREATE TABLE daily_report_products (
                id INT NOT NULL AUTO_INCREMENT,
                report_id INT NOT NULL,
                product_name VARCHAR(255) NOT NULL,
                quantity INT NOT NULL,
                sort_order INT NOT NULL DEFAULT 0,
                created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                KEY idx_drp_report (report_id),
                KEY idx_drp_product (product_name)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
    }

    if (!(await columnExists("sales_orders", "daily_report_id"))) {
        await db.promise().query(
            "ALTER TABLE sales_orders ADD COLUMN daily_report_id INT NULL AFTER user_id"
        );
        await db.promise().query(
            "ALTER TABLE sales_orders ADD KEY idx_orders_daily_report (daily_report_id)"
        ).catch(() => {});
    }

    if (!(await tableExists("notifications"))) {
        await db.promise().query(`
            CREATE TABLE notifications (
                id INT NOT NULL AUTO_INCREMENT,
                sender_id INT NULL,
                receiver_id INT NULL,
                message TEXT NOT NULL,
                created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                KEY idx_notifications_created (created_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
    }

    if (!(await tableExists("company_settings"))) {
        await db.promise().query(`
            CREATE TABLE company_settings (
                id INT NOT NULL DEFAULT 1,
                daily_target DECIMAL(12,2) NOT NULL DEFAULT 100000,
                updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        await db.promise().query(
            "INSERT IGNORE INTO company_settings (id, daily_target) VALUES (1, 100000)"
        );
    }

    console.log("✅ Database migrations applied");
}

module.exports = { runMigrations };
