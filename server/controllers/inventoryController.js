const db = require("../config/db");
const realtime = require("../utils/realtime");

function toMysqlDatetime(value) {
    const date = value ? new Date(value) : new Date();
    if (Number.isNaN(date.getTime())) {
        return toMysqlDatetime(new Date());
    }
    const pad = (n) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

exports.getInventory = async (req, res) => {
    try {
        const [rows] = await db.promise().query(
            "SELECT * FROM stock_inventory ORDER BY product_name ASC"
        );
        return res.json(rows);
    } catch (error) {
        console.log(error);
        return res.status(500).json({ success: false });
    }
};

exports.getDashboard = async (req, res) => {
    try {
        const [[inventoryRow]] = await db.promise().query(
            `SELECT COUNT(*) AS totalProducts,
                    COALESCE(SUM(quantity), 0) AS totalInventory,
                    SUM(quantity <= min_stock) AS lowStockProducts
             FROM stock_inventory`
        );

        const [[requestsRow]] = await db.promise().query(
            "SELECT COUNT(*) AS stockRequests FROM stock_replenishment_requests WHERE status = 'Pending'"
        );

        const [[distRequestsRow]] = await db.promise().query(
            "SELECT COUNT(*) AS distributorRequests FROM distributor_stock_requests WHERE status = 'Pending'"
        );

        const [[restockedRow]] = await db.promise().query(
            `SELECT COUNT(*) AS restockedProducts
             FROM stock_inventory
             WHERE updated_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)`
        );

        return res.json({
            totalInventory: inventoryRow.totalInventory || 0,
            totalProducts: inventoryRow.totalProducts || 0,
            lowStockProducts: inventoryRow.lowStockProducts || 0,
            stockRequests: requestsRow.stockRequests || 0,
            distributorRequests: distRequestsRow.distributorRequests || 0,
            restockedProducts: restockedRow.restockedProducts || 0
        });
    } catch (error) {
        console.log(error);
        return res.status(500).json({ success: false });
    }
};

exports.updateStock = async (req, res) => {
    try {
        const { product_name, quantity } = req.body;

        if (!product_name || quantity === undefined) {
            return res.status(400).json({ success: false, message: "product_name and quantity required" });
        }

        await db.promise().query(
            `INSERT INTO stock_inventory (product_name, quantity, min_stock)
             VALUES (?, ?, 10)
             ON DUPLICATE KEY UPDATE quantity = ?`,
            [product_name, Number(quantity), Number(quantity)]
        );

        const [rows] = await db.promise().query(
            "SELECT * FROM stock_inventory WHERE UPPER(product_name) = UPPER(?)",
            [product_name]
        );

        realtime.emitAdmin("inventory:updated", rows[0]);
        return res.json({ success: true, message: "Stock updated", item: rows[0] });
    } catch (error) {
        console.log(error);
        return res.status(500).json({ success: false });
    }
};

exports.restockProduct = async (req, res) => {
    try {
        const { product_name, add_quantity } = req.body;

        if (!product_name || !add_quantity) {
            return res.status(400).json({ success: false, message: "product_name and add_quantity required" });
        }

        await db.promise().query(
            `INSERT INTO stock_inventory (product_name, quantity, min_stock)
             VALUES (?, ?, 10)
             ON DUPLICATE KEY UPDATE quantity = quantity + ?`,
            [product_name, Number(add_quantity), Number(add_quantity)]
        );

        const [rows] = await db.promise().query(
            "SELECT * FROM stock_inventory WHERE UPPER(product_name) = UPPER(?)",
            [product_name]
        );

        realtime.emitAdmin("inventory:updated", rows[0]);
        return res.json({ success: true, message: "Product restocked", item: rows[0] });
    } catch (error) {
        console.log(error);
        return res.status(500).json({ success: false });
    }
};

exports.getLowStock = async (req, res) => {
    try {
        const [rows] = await db.promise().query(
            "SELECT * FROM stock_inventory WHERE quantity <= min_stock ORDER BY quantity ASC"
        );
        return res.json(rows);
    } catch (error) {
        console.log(error);
        return res.status(500).json({ success: false });
    }
};

exports.getCompanyInventory = async (req, res) => {
    try {
        const [rows] = await db.promise().query(
            "SELECT * FROM company_inventory ORDER BY id DESC"
        );
        return res.json(rows);
    } catch (error) {
        console.log(error);
        return res.status(500).json({ success: false });
    }
};

exports.addCompanyInventory = async (req, res) => {
    try {
        const {
            company_name,
            product_name,
            sold_products,
            remaining_products,
            total_products,
            min_stock,
            date_time
        } = req.body;

        const normalizedProduct = String(product_name || "").trim();
        if (!company_name || !normalizedProduct) {
            return res.status(400).json({
                success: false,
                message: "company_name and product_name are required"
            });
        }

        const resolvedRemaining = remaining_products != null
            ? Number(remaining_products)
            : Number(total_products || 0) - Number(sold_products || 0);

        if (!Number.isFinite(resolvedRemaining) || resolvedRemaining < 0) {
            return res.status(400).json({
                success: false,
                message: "remaining_products must be zero or greater"
            });
        }

        const [result] = await db.promise().query(
            `INSERT INTO company_inventory
             (company_name, product_name, sold_products, remaining_products, min_stock, total_products, date_time)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                company_name,
                normalizedProduct,
                Number(sold_products || 0),
                resolvedRemaining,
                Number(min_stock || 10),
                Number(total_products || resolvedRemaining + Number(sold_products || 0)),
                toMysqlDatetime(date_time)
            ]
        );

        const [rows] = await db.promise().query(
            "SELECT * FROM company_inventory WHERE id = ?",
            [result.insertId]
        );

        const record = rows[0];
        realtime.emitAdmin("inventory:snapshot", await getAllCompanyInventory());
        return res.json({ success: true, message: "Inventory record added", record });
    } catch (error) {
        console.log(error);
        return res.status(500).json({ success: false });
    }
};

exports.deleteCompanyInventory = async (req, res) => {
    try {
        const id = req.params.id;
        await db.promise().query("DELETE FROM company_inventory WHERE id = ?", [id]);
        realtime.emitAdmin("inventory:snapshot", await getAllCompanyInventory());
        return res.json({ success: true, message: "Inventory record deleted" });
    } catch (error) {
        console.log(error);
        return res.status(500).json({ success: false, message: "Could not delete inventory record" });
    }
};

exports.deleteStockInventory = async (req, res) => {
    try {
        const id = req.params.id;
        const [rows] = await db.promise().query("SELECT * FROM stock_inventory WHERE id = ?", [id]);
        if (!rows.length) {
            return res.status(404).json({ success: false, message: "Stock record not found" });
        }

        await db.promise().query("DELETE FROM stock_inventory WHERE id = ?", [id]);
        realtime.emitAdmin("inventory:updated", null);
        return res.json({ success: true, message: "Stock record deleted" });
    } catch (error) {
        console.log(error);
        return res.status(500).json({ success: false, message: "Could not delete stock record" });
    }
};

exports.deleteDistributorUser = async (req, res) => {
    try {
        const id = req.params.id;
        const [rows] = await db.promise().query(
            "SELECT id, role FROM users WHERE id = ? AND role = 'distributor'",
            [id]
        );
        if (!rows.length) {
            return res.status(404).json({ success: false, message: "Distributor not found" });
        }

        await db.promise().query("DELETE FROM users WHERE id = ?", [id]);
        return res.json({ success: true, message: "Distributor deleted" });
    } catch (error) {
        console.log(error);
        return res.status(500).json({ success: false, message: "Could not delete distributor" });
    }
};

async function getAllCompanyInventory() {
    const [rows] = await db.promise().query("SELECT * FROM company_inventory ORDER BY id DESC");
    return rows.map((row) => ({
        id: row.id,
        dateTime: row.date_time,
        companyName: row.company_name,
        productName: row.product_name,
        soldProducts: row.sold_products,
        remainingProducts: row.remaining_products,
        minStock: row.min_stock,
        totalProducts: row.total_products
    }));
}

exports.getCompanyInventorySnapshot = async (req, res) => {
    try {
        const list = await getAllCompanyInventory();
        return res.json(list);
    } catch (error) {
        console.log(error);
        return res.status(500).json({ success: false });
    }
};

exports.getDistributors = async (req, res) => {
    try {
        const [users] = await db.promise().query(
            "SELECT id, name, email, company_name FROM users WHERE role = 'distributor' ORDER BY name ASC"
        );
        const [legacy] = await db.promise().query("SELECT * FROM distributors ORDER BY id DESC");
        return res.json({ users, legacy });
    } catch (error) {
        console.log(error);
        return res.status(500).json({ success: false });
    }
};
