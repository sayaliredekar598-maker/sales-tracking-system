const db = require("../config/db");
const {
    getCompanyLowStockProducts,
    getCompanyProductSummary
} = require("../utils/companyInventory");

function percentChange(current, previous) {
    const cur = Number(current || 0);
    const prev = Number(previous || 0);
    if (prev === 0) {
        return cur > 0 ? 100 : 0;
    }
    return Math.round(((cur - prev) / prev) * 100);
}

async function getDailyTarget() {
    const [[row]] = await db.promise().query(
        "SELECT daily_target FROM company_settings WHERE id = 1 LIMIT 1"
    );
    return Number(row?.daily_target || 100000);
}

exports.getCompanyAnalytics = async (req, res) => {
    try {
        const [[salesRow]] = await db.promise().query(
            `SELECT COALESCE(SUM(sales_amount), 0) AS totalSales,
                    COUNT(*) AS totalOrders,
                    COALESCE(SUM(quantity), 0) AS totalProductsSold
             FROM sales_orders`
        );

        const [[todaySalesRow]] = await db.promise().query(
            `SELECT COALESCE(SUM(sales_amount), 0) AS todaySales,
                    COALESCE(SUM(quantity), 0) AS todayProducts
             FROM sales_orders WHERE DATE(created_at) = CURDATE()`
        );

        const [[yesterdaySalesRow]] = await db.promise().query(
            `SELECT COALESCE(SUM(sales_amount), 0) AS yesterdaySales,
                    COALESCE(SUM(quantity), 0) AS yesterdayProducts
             FROM sales_orders WHERE DATE(created_at) = CURDATE() - INTERVAL 1 DAY`
        );

        const [[reportsRow]] = await db.promise().query(
            "SELECT COUNT(*) AS totalReports FROM daily_reports"
        );

        const [[inventoryRow]] = await db.promise().query(
            `SELECT COALESCE(SUM(quantity), 0) AS totalInventory,
                    SUM(quantity <= min_stock) AS lowStockCount
             FROM stock_inventory`
        );

        const [topProducts] = await db.promise().query(
            `SELECT product_name, SUM(quantity) AS total_qty, SUM(sales_amount) AS total_sales
             FROM sales_orders
             GROUP BY product_name
             ORDER BY total_qty DESC
             LIMIT 10`
        );

        const [recentOrders] = await db.promise().query(
            "SELECT * FROM sales_orders ORDER BY id DESC LIMIT 50"
        );

        const [recentReports] = await db.promise().query(
            "SELECT * FROM daily_reports ORDER BY id DESC LIMIT 20"
        );

        const [lowStock] = await db.promise().query(
            "SELECT * FROM stock_inventory WHERE quantity <= min_stock ORDER BY quantity ASC"
        );

        const dailyTarget = await getDailyTarget();

        return res.json({
            totalSales: salesRow.totalSales,
            totalRevenue: salesRow.totalSales,
            totalOrders: salesRow.totalOrders,
            totalReports: reportsRow.totalReports,
            totalProductsSold: salesRow.totalProductsSold,
            totalInventory: inventoryRow.totalInventory,
            lowStockCount: inventoryRow.lowStockCount,
            topProducts,
            recentOrders,
            recentReports,
            lowStock,
            trends: {
                todaySales: todaySalesRow.todaySales,
                yesterdaySales: yesterdaySalesRow.yesterdaySales,
                salesChangePercent: percentChange(todaySalesRow.todaySales, yesterdaySalesRow.yesterdaySales),
                todayProducts: todaySalesRow.todayProducts,
                yesterdayProducts: yesterdaySalesRow.yesterdayProducts,
                productsChangePercent: percentChange(todaySalesRow.todayProducts, yesterdaySalesRow.yesterdayProducts)
            },
            dailyTarget
        });
    } catch (error) {
        console.log(error);
        return res.status(500).json({ success: false });
    }
};

exports.getCompanySettings = async (req, res) => {
    try {
        const dailyTarget = await getDailyTarget();
        return res.json({ dailyTarget });
    } catch (error) {
        console.log(error);
        return res.status(500).json({ success: false });
    }
};

exports.updateCompanySettings = async (req, res) => {
    try {
        const dailyTarget = Number(req.body.dailyTarget ?? req.body.daily_target);
        if (!Number.isFinite(dailyTarget) || dailyTarget <= 0) {
            return res.status(400).json({ success: false, message: "Daily target must be a positive number" });
        }

        await db.promise().query(
            `INSERT INTO company_settings (id, daily_target) VALUES (1, ?)
             ON DUPLICATE KEY UPDATE daily_target = VALUES(daily_target)`,
            [dailyTarget]
        );

        return res.json({ success: true, dailyTarget });
    } catch (error) {
        console.log(error);
        return res.status(500).json({ success: false });
    }
};

exports.getNotifications = async (req, res) => {
    try {
        const limit = Math.min(Number(req.query.limit) || 50, 100);
        const [rows] = await db.promise().query(
            `SELECT n.id, n.sender_id, n.receiver_id, n.message, n.created_at,
                    u.name AS sender_name
             FROM notifications n
             LEFT JOIN users u ON u.id = n.sender_id
             ORDER BY n.id DESC
             LIMIT ?`,
            [limit]
        );
        return res.json(rows);
    } catch (error) {
        console.log(error);
        return res.status(500).json({ success: false });
    }
};

exports.getEmployees = async (req, res) => {
    try {
        const [rows] = await db.promise().query(
            `SELECT u.id, u.name, u.email, u.empId,
                    (SELECT COUNT(*) FROM daily_reports dr
                     WHERE dr.employee_id = u.empId AND DATE(dr.date_time) = CURDATE()) AS today_reports,
                    (SELECT COUNT(*) FROM sales_orders so
                     WHERE so.employee_id = u.empId AND DATE(so.created_at) = CURDATE()) AS today_orders
             FROM users u
             WHERE u.role = 'employee'
             ORDER BY u.name ASC`
        );
        return res.json(rows);
    } catch (error) {
        console.log(error);
        return res.status(500).json({ success: false });
    }
};

exports.getDistributorScorecard = async (req, res) => {
    try {
        const [rows] = await db.promise().query(
            `SELECT distributor_name,
                    COUNT(*) AS total_orders,
                    SUM(status = 'Pending') AS pending,
                    SUM(status = 'Accepted') AS accepted,
                    SUM(status = 'Processing') AS processing,
                    SUM(status = 'Delivered') AS delivered,
                    SUM(status = 'Rejected') AS rejected,
                    COALESCE(SUM(sales_amount), 0) AS total_sales,
                    COALESCE(SUM(quantity), 0) AS total_quantity
             FROM sales_orders
             GROUP BY distributor_name
             ORDER BY total_orders DESC`
        );

        const scorecard = rows.map((row) => {
            const total = Number(row.total_orders || 0);
            const rejected = Number(row.rejected || 0);
            const fulfilled = Number(row.delivered || 0);
            const actionable = total - rejected;
            const fulfillmentRate = actionable > 0 ? Math.round((fulfilled / actionable) * 100) : 0;
            const acceptanceRate = total > 0
                ? Math.round(((total - rejected) / total) * 100)
                : 0;

            return {
                distributorName: row.distributor_name,
                totalOrders: total,
                pending: Number(row.pending || 0),
                accepted: Number(row.accepted || 0),
                processing: Number(row.processing || 0),
                delivered: fulfilled,
                rejected,
                totalSales: Number(row.total_sales || 0),
                totalQuantity: Number(row.total_quantity || 0),
                acceptanceRate,
                fulfillmentRate
            };
        });

        return res.json(scorecard);
    } catch (error) {
        console.log(error);
        return res.status(500).json({ success: false });
    }
};

exports.getSupplyChainHealth = async (req, res) => {
    try {
        const [[companyRow]] = await db.promise().query(
            `SELECT COALESCE(SUM(remaining_products), 0) AS companyRemaining,
                    COUNT(*) AS companySkuCount
             FROM company_inventory`
        );

        const [[ssRow]] = await db.promise().query(
            `SELECT COALESCE(SUM(quantity), 0) AS ssTotalStock,
                    SUM(quantity <= min_stock) AS ssLowStockCount
             FROM stock_inventory`
        );

        const [[distRow]] = await db.promise().query(
            `SELECT COALESCE(SUM(remaining), 0) AS distributorRemaining,
                    COALESCE(SUM(total_received), 0) AS distributorReceived,
                    COUNT(DISTINCT distributor_id) AS distributorCount
             FROM distributor_inventory`
        );

        const [[pendingSsToCompany]] = await db.promise().query(
            "SELECT COUNT(*) AS cnt FROM stock_replenishment_requests WHERE status = 'Pending'"
        );

        const [[pendingDistToSs]] = await db.promise().query(
            "SELECT COUNT(*) AS cnt FROM distributor_stock_requests WHERE status = 'Pending'"
        );

        const [ssLowStock] = await db.promise().query(
            "SELECT product_name, quantity, min_stock FROM stock_inventory WHERE quantity <= min_stock ORDER BY quantity ASC LIMIT 10"
        );

        const [companyLowStock] = await db.promise().query(
            `SELECT MAX(product_name) AS product_name,
                    COALESCE(SUM(remaining_products), 0) AS available,
                    COALESCE(MAX(min_stock), 10) AS min_stock
             FROM company_inventory
             WHERE product_name IS NOT NULL AND TRIM(product_name) <> ''
             GROUP BY UPPER(TRIM(product_name))
             HAVING available <= min_stock
             ORDER BY available ASC
             LIMIT 10`
        );

        const [pendingDistributorRequests] = await db.promise().query(
            `SELECT id, distributor_name, product_name, quantity, created_at
             FROM distributor_stock_requests
             WHERE status = 'Pending'
             ORDER BY created_at DESC
             LIMIT 20`
        );

        return res.json({
            companyRemaining: Number(companyRow.companyRemaining || 0),
            companySkuCount: Number(companyRow.companySkuCount || 0),
            ssTotalStock: Number(ssRow.ssTotalStock || 0),
            ssLowStockCount: Number(ssRow.ssLowStockCount || 0),
            distributorRemaining: Number(distRow.distributorRemaining || 0),
            distributorReceived: Number(distRow.distributorReceived || 0),
            distributorCount: Number(distRow.distributorCount || 0),
            pendingSsToCompany: Number(pendingSsToCompany.cnt || 0),
            pendingDistToSs: Number(pendingDistToSs.cnt || 0),
            ssLowStock,
            companyLowStock: companyLowStock.map((row) => ({
                productName: row.product_name,
                available: Number(row.available || 0),
                minStock: Number(row.min_stock || 10)
            })),
            pendingDistributorRequests
        });
    } catch (error) {
        console.log(error);
        return res.status(500).json({ success: false });
    }
};

exports.getCompanyInventorySummary = async (req, res) => {
    try {
        const summary = await getCompanyProductSummary();
        const lowStock = await getCompanyLowStockProducts();
        return res.json({ summary, lowStock });
    } catch (error) {
        console.log(error);
        return res.status(500).json({ success: false });
    }
};

exports.deleteEmployee = async (req, res) => {
    try {
        const id = req.params.id;
        const [rows] = await db.promise().query(
            "SELECT id, role FROM users WHERE id = ? AND role = 'employee'",
            [id]
        );
        if (!rows.length) {
            return res.status(404).json({ success: false, message: "Employee not found" });
        }

        await db.promise().query("DELETE FROM users WHERE id = ?", [id]);
        return res.json({ success: true, message: "Employee deleted" });
    } catch (error) {
        console.log(error);
        return res.status(500).json({ success: false, message: "Could not delete employee" });
    }
};

exports.deleteNotification = async (req, res) => {
    try {
        const id = req.params.id;
        const [result] = await db.promise().query("DELETE FROM notifications WHERE id = ?", [id]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: "Notification not found" });
        }
        return res.json({ success: true, message: "Notification deleted" });
    } catch (error) {
        console.log(error);
        return res.status(500).json({ success: false, message: "Could not delete notification" });
    }
};
