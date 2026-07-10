const db = require("../config/db");
const realtime = require("../utils/realtime");

exports.addOrder = async (req, res) => {
    try {
        const {
            user_id,
            employee_id,
            employee_name,
            retailer_name,
            shop_address,
            distributor_name,
            product_name,
            quantity,
            sales_amount,
            expected_delivery_date,
            order_remarks
        } = req.body;

        if (!user_id || !employee_name || !retailer_name || !distributor_name || !product_name || !quantity) {
            return res.status(400).json({ success: false, message: "Missing required order fields" });
        }

        const [result] = await db.promise().query(
            `INSERT INTO sales_orders
             (user_id, employee_id, employee_name, retailer_name, shop_address,
              distributor_name, product_name, quantity, sales_amount,
              expected_delivery_date, order_remarks, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending')`,
            [
                user_id,
                employee_id || null,
                employee_name,
                retailer_name,
                shop_address || null,
                distributor_name,
                product_name,
                Number(quantity),
                sales_amount ? Number(sales_amount) : 0,
                expected_delivery_date || null,
                order_remarks || null
            ]
        );

        await db.promise().query(
            `INSERT INTO notifications (sender_id, receiver_id, message) VALUES (?, NULL, ?)`,
            [user_id, `${employee_name} submitted order for ${product_name} (${quantity} units)`]
        );

        const [rows] = await db.promise().query("SELECT * FROM sales_orders WHERE id = ?", [result.insertId]);
        const order = rows[0];
        realtime.emitOrderSubmitted(order);

        return res.status(201).json({ success: true, message: "Order submitted successfully", order });
    } catch (error) {
        console.log(error);
        return res.status(500).json({ success: false, message: "Order submission failed" });
    }
};

exports.getEmployeeOrders = async (req, res) => {
    try {
        const employeeId = req.params.employeeId;
        const search = String(req.query.search || "").trim();
        const status = String(req.query.status || "").trim();

        let sql = "SELECT * FROM sales_orders WHERE employee_id = ?";
        const params = [employeeId];

        if (status) { sql += " AND status = ?"; params.push(status); }
        if (search) {
            sql += ` AND (retailer_name LIKE ? OR distributor_name LIKE ? OR product_name LIKE ? OR order_remarks LIKE ?)`;
            const term = `%${search}%`;
            params.push(term, term, term, term);
        }

        sql += " ORDER BY id DESC";
        const [rows] = await db.promise().query(sql, params);
        return res.json(rows);
    } catch (error) {
        console.log(error);
        return res.status(500).json({ success: false });
    }
};

exports.getOrdersByProduct = async (req, res) => {
    try {
        const productName = decodeURIComponent(req.params.productName);
        const [rows] = await db.promise().query(
            "SELECT * FROM sales_orders WHERE UPPER(product_name) = UPPER(?) ORDER BY id DESC",
            [productName]
        );
        return res.json(rows);
    } catch (error) {
        console.log(error);
        return res.status(500).json({ success: false });
    }
};

exports.getAllOrders = async (req, res) => {
    try {
        const status = String(req.query.status || "").trim();
        const distributor = String(req.query.distributor || "").trim();

        let sql = "SELECT * FROM sales_orders WHERE 1=1";
        const params = [];

        if (status) { sql += " AND status = ?"; params.push(status); }
        if (distributor) { sql += " AND distributor_name LIKE ?"; params.push(`%${distributor}%`); }

        sql += " ORDER BY id DESC";
        const [rows] = await db.promise().query(sql, params);
        return res.json(rows);
    } catch (error) {
        console.log(error);
        return res.status(500).json({ success: false });
    }
};

exports.updateOrderStatus = async (req, res) => {
    try {
        const orderId = req.params.id;
        const { status } = req.body;
        const allowed = ["Pending", "Accepted", "Rejected", "Processing", "Delivered"];

        if (!allowed.includes(status)) {
            return res.status(400).json({ success: false, message: "Invalid status" });
        }

        const [result] = await db.promise().query(
            "UPDATE sales_orders SET status = ? WHERE id = ?",
            [status, orderId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: "Order not found" });
        }

        const [rows] = await db.promise().query("SELECT * FROM sales_orders WHERE id = ?", [orderId]);
        const order = rows[0];
        realtime.emitOrderStatusChanged(order);

        return res.json({ success: true, message: "Order status updated", order });
    } catch (error) {
        console.log(error);
        return res.status(500).json({ success: false });
    }
};

exports.deleteOrder = async (req, res) => {
    try {
        const orderId = req.params.id;
        const actor = req.actor;
        const legacyEmployeeId = req.query.employeeId;

        const [rows] = await db.promise().query("SELECT * FROM sales_orders WHERE id = ?", [orderId]);
        if (!rows.length) {
            return res.status(404).json({ success: false, message: "Order not found" });
        }

        const order = rows[0];

        if (actor?.role === "employee") {
            const empId = actor.empId || String(actor.id);
            if (order.employee_id !== empId || order.status !== "Pending") {
                return res.status(403).json({
                    success: false,
                    message: "You can only delete your own pending orders"
                });
            }
        } else if (actor?.role === "distributor") {
            const distName = String(actor.name || "").trim().toLowerCase();
            const orderDist = String(order.distributor_name || "").trim().toLowerCase();
            if (!distName || !orderDist.includes(distName)) {
                return res.status(403).json({
                    success: false,
                    message: "You can only delete orders assigned to you"
                });
            }
        } else if (actor?.role === "superstockist" || actor?.role === "manager") {
            /* allowed */
        } else if (legacyEmployeeId) {
            const [result] = await db.promise().query(
                "DELETE FROM sales_orders WHERE id = ? AND employee_id = ? AND status = 'Pending'",
                [orderId, legacyEmployeeId]
            );
            if (result.affectedRows === 0) {
                return res.status(404).json({ success: false, message: "Order not found or cannot be deleted" });
            }
            return res.json({ success: true, message: "Order deleted successfully" });
        } else {
            return res.status(403).json({ success: false, message: "Not authorized to delete this order" });
        }

        await db.promise().query("DELETE FROM sales_orders WHERE id = ?", [orderId]);
        realtime.emitAdmin("order:deleted", { id: Number(orderId) });
        return res.json({ success: true, message: "Order deleted successfully" });
    } catch (error) {
        console.log(error);
        return res.status(500).json({ success: false, message: "Could not delete order" });
    }
};

exports.deleteOrdersByDistributor = async (req, res) => {
    try {
        const distributorName = decodeURIComponent(req.params.distributorName || "").trim();
        if (!distributorName) {
            return res.status(400).json({ success: false, message: "Distributor name is required" });
        }

        const [result] = await db.promise().query(
            "DELETE FROM sales_orders WHERE distributor_name = ?",
            [distributorName]
        );

        return res.json({
            success: true,
            message: `Deleted ${result.affectedRows} order record(s) for ${distributorName}`
        });
    } catch (error) {
        console.log(error);
        return res.status(500).json({ success: false, message: "Could not delete distributor orders" });
    }
};

exports.getDashboardSummary = async (req, res) => {
    try {
        const employeeId = req.params.employeeId;
        const today = new Date().toISOString().slice(0, 10);

        const [[ordersRow]] = await db.promise().query(
            "SELECT COUNT(*) AS totalOrders FROM sales_orders WHERE employee_id = ?",
            [employeeId]
        );
        const [[reportsRow]] = await db.promise().query(
            "SELECT COUNT(*) AS totalReports FROM daily_reports WHERE employee_id = ?",
            [employeeId]
        );
        const [[salesRow]] = await db.promise().query(
            `SELECT COALESCE(SUM(sales_amount), 0) AS totalSales,
                    COALESCE(SUM(quantity), 0) AS productsSold
             FROM sales_orders WHERE employee_id = ?`,
            [employeeId]
        );
        const [[visitsRow]] = await db.promise().query(
            `SELECT COUNT(*) AS todayVisits FROM daily_reports
             WHERE employee_id = ? AND DATE(date_time) = ?`,
            [employeeId, today]
        );
        const [recentOrders] = await db.promise().query(
            "SELECT * FROM sales_orders WHERE employee_id = ? ORDER BY id DESC LIMIT 10",
            [employeeId]
        );

        return res.json({
            totalOrders: ordersRow.totalOrders,
            totalReports: reportsRow.totalReports,
            totalSales: salesRow.totalSales,
            productsSold: salesRow.productsSold,
            todayVisits: visitsRow.todayVisits,
            productsOrdered: salesRow.productsSold,
            recentOrders
        });
    } catch (error) {
        console.log(error);
        return res.status(500).json({ success: false });
    }
};
