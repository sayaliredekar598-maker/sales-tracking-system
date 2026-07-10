const db = require("../config/db");
const realtime = require("../utils/realtime");
const distributorInventoryController = require("./distributorInventoryController");

exports.getDashboard = async (req, res) => {
    try {
        const distributor = String(req.query.distributor || "").trim();
        const distributorId = req.query.distributor_id;

        let baseSql = "FROM sales_orders WHERE 1=1";
        const params = [];

        if (distributor) {
            baseSql += " AND distributor_name LIKE ?";
            params.push(`%${distributor}%`);
        }

        const [[totals]] = await db.promise().query(
            `SELECT
                COUNT(*) AS totalOrders,
                SUM(status = 'Pending') AS pendingOrders,
                SUM(status = 'Accepted') AS acceptedOrders,
                SUM(status = 'Delivered') AS deliveredOrders
             ${baseSql}`,
            params
        );

        let stockSql = "SELECT COALESCE(SUM(remaining), 0) AS availableStock FROM distributor_inventory WHERE 1=1";
        const stockParams = [];

        if (distributorId) {
            stockSql += " AND distributor_id = ?";
            stockParams.push(distributorId);
        } else if (distributor) {
            stockSql += " AND distributor_name LIKE ?";
            stockParams.push(`%${distributor}%`);
        }

        const [stockRows] = await db.promise().query(stockSql, stockParams);

        return res.json({
            totalOrders: totals.totalOrders || 0,
            pendingOrders: totals.pendingOrders || 0,
            acceptedOrders: totals.acceptedOrders || 0,
            deliveredOrders: totals.deliveredOrders || 0,
            availableStock: stockRows[0]?.availableStock || 0
        });
    } catch (error) {
        console.log(error);
        return res.status(500).json({ success: false });
    }
};

exports.getOrders = async (req, res) => {
    try {
        const distributor = String(req.query.distributor || "").trim();
        const status = String(req.query.status || "").trim();

        let sql = "SELECT * FROM sales_orders WHERE 1=1";
        const params = [];

        if (distributor) {
            sql += " AND distributor_name LIKE ?";
            params.push(`%${distributor}%`);
        }
        if (status) {
            sql += " AND status = ?";
            params.push(status);
        }

        sql += " ORDER BY id DESC";
        const [rows] = await db.promise().query(sql, params);
        return res.json(rows);
    } catch (error) {
        console.log(error);
        return res.status(500).json({ success: false });
    }
};

exports.acceptOrder = async (req, res) => {
    req.body.status = "Accepted";
    return updateStatus(req, res);
};

exports.rejectOrder = async (req, res) => {
    req.body.status = "Rejected";
    return updateStatus(req, res);
};

exports.updateDeliveryStatus = async (req, res) => {
    return updateStatus(req, res);
};

async function updateStatus(req, res) {
    try {
        const orderId = req.params.id;
        const { status } = req.body;
        const allowed = ["Accepted", "Rejected", "Processing", "Delivered"];

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

        if (status === "Delivered" && order.product_name) {
            try {
                await distributorInventoryController.deductDistributorStockOnDelivery(
                    order.distributor_name,
                    order.product_name,
                    order.quantity,
                    order.id
                );
            } catch (invErr) {
                console.log(invErr.message);
                return res.status(400).json({
                    success: false,
                    message: invErr.message || "Insufficient distributor stock to complete delivery"
                });
            }
        }

        realtime.emitOrderStatusChanged(order);

        return res.json({ success: true, message: `Order ${status.toLowerCase()}`, order });
    } catch (error) {
        console.log(error);
        return res.status(500).json({ success: false });
    }
}

exports.notifyLowStock = async (req, res) => {
    try {
        const { product_name, message } = req.body;
        const [lowStock] = await db.promise().query(
            "SELECT * FROM stock_inventory WHERE quantity <= min_stock ORDER BY quantity ASC"
        );

        realtime.emitAdmin("notification:superstockist", {
            title: "Low Stock Alert",
            message: message || `Low stock for ${product_name || "multiple products"}`,
            products: lowStock
        });

        return res.json({ success: true, message: "Super Stockist notified", lowStock });
    } catch (error) {
        console.log(error);
        return res.status(500).json({ success: false });
    }
};
