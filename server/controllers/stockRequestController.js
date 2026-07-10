const db = require("../config/db");
const realtime = require("../utils/realtime");
const {
    deductCompanyStock,
    getCompanyAvailabilityMap
} = require("../utils/companyInventory");

function toPublicRequest(row) {
    return {
        id: row.id,
        superstockistId: row.superstockist_id,
        superstockistName: row.superstockist_name,
        productName: row.product_name,
        quantity: row.quantity,
        status: row.status,
        notes: row.notes || null,
        reviewedBy: row.reviewed_by || null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        reviewedAt: row.reviewed_at || null
    };
}


async function addSuperStockistStock(connection, productName, quantity) {
    await connection.query(
        `INSERT INTO stock_inventory (product_name, quantity, min_stock)
         VALUES (?, ?, 10)
         ON DUPLICATE KEY UPDATE quantity = quantity + ?`,
        [productName, quantity, quantity]
    );
}

exports.createRequest = async (req, res) => {
    try {
        const { superstockist_id, superstockist_name, product_name, quantity, notes } = req.body;

        if (!superstockist_id || !superstockist_name || !product_name || !quantity) {
            return res.status(400).json({
                success: false,
                message: "superstockist_id, superstockist_name, product_name, and quantity are required"
            });
        }

        const qty = Number(quantity);
        if (!Number.isFinite(qty) || qty <= 0) {
            return res.status(400).json({ success: false, message: "quantity must be greater than 0" });
        }

        const [result] = await db.promise().query(
            `INSERT INTO stock_replenishment_requests
             (superstockist_id, superstockist_name, product_name, quantity, status, notes)
             VALUES (?, ?, ?, ?, 'Pending', ?)`,
            [superstockist_id, superstockist_name, product_name.trim(), qty, notes || null]
        );

        const [rows] = await db.promise().query(
            "SELECT * FROM stock_replenishment_requests WHERE id = ?",
            [result.insertId]
        );

        const request = toPublicRequest(rows[0]);
        realtime.emitStockRequestCreated(request);
        return res.status(201).json({ success: true, message: "Stock request submitted", request });
    } catch (error) {
        console.log(error);
        return res.status(500).json({ success: false, message: "Server error" });
    }
};

exports.getPendingRequests = async (req, res) => {
    try {
        const [rows] = await db.promise().query(
            `SELECT * FROM stock_replenishment_requests
             WHERE status = 'Pending'
             ORDER BY created_at ASC`
        );
        const requests = rows.map(toPublicRequest);
        const availability = await getCompanyAvailabilityMap(requests.map((r) => r.productName));

        return res.json(requests.map((request) => {
            const companyAvailable = availability[request.productName] ?? 0;
            return {
                ...request,
                companyAvailable,
                canApprove: companyAvailable >= Number(request.quantity || 0)
            };
        }));
    } catch (error) {
        console.log(error);
        return res.status(500).json({ success: false });
    }
};

exports.getAllRequests = async (req, res) => {
    try {
        const { status, superstockist_id } = req.query;
        let sql = "SELECT * FROM stock_replenishment_requests WHERE 1=1";
        const params = [];

        if (status) {
            sql += " AND status = ?";
            params.push(status);
        }
        if (superstockist_id) {
            sql += " AND superstockist_id = ?";
            params.push(superstockist_id);
        }

        sql += " ORDER BY created_at DESC";

        const [rows] = await db.promise().query(sql, params);
        return res.json(rows.map(toPublicRequest));
    } catch (error) {
        console.log(error);
        return res.status(500).json({ success: false });
    }
};

exports.approveRequest = async (req, res) => {
    const connection = db.promise();

    try {
        const id = req.params.id;
        const { reviewed_by } = req.body;

        await connection.beginTransaction();

        const [rows] = await connection.query(
            "SELECT * FROM stock_replenishment_requests WHERE id = ? FOR UPDATE",
            [id]
        );

        if (!rows.length) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: "Request not found" });
        }

        const request = rows[0];
        if (request.status !== "Pending") {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                message: `Request is already ${request.status}`
            });
        }

        await deductCompanyStock(connection, request.product_name, Number(request.quantity));
        await addSuperStockistStock(connection, request.product_name, Number(request.quantity));

        const [ssRows] = await connection.query(
            "SELECT quantity FROM stock_inventory WHERE UPPER(product_name) = UPPER(?)",
            [request.product_name]
        );

        await connection.query(
            `INSERT INTO inventory_flow_log
             (event_type, product_name, quantity, from_name, to_name, from_party_id, to_party_id,
              ss_remaining_after, distributor_remaining_after, reference_id)
             VALUES ('company_to_superstockist', ?, ?, 'Company', ?, NULL, ?, ?, NULL, ?)`,
            [
                request.product_name,
                Number(request.quantity),
                request.superstockist_name,
                request.superstockist_id,
                ssRows[0]?.quantity ?? 0,
                id
            ]
        );

        await connection.query(
            `UPDATE stock_replenishment_requests
             SET status = 'Approved',
                 reviewed_by = ?,
                 reviewed_at = NOW(),
                 updated_at = NOW()
             WHERE id = ?`,
            [reviewed_by || "Company", id]
        );

        await connection.commit();

        const [updatedRows] = await db.promise().query(
            "SELECT * FROM stock_replenishment_requests WHERE id = ?",
            [id]
        );
        const [inventoryRows] = await db.promise().query(
            "SELECT * FROM stock_inventory WHERE UPPER(product_name) = UPPER(?)",
            [request.product_name]
        );

        const publicRequest = toPublicRequest(updatedRows[0]);
        realtime.emitStockRequestUpdated(publicRequest, "Approved");
        realtime.emitAdmin("inventory:updated", inventoryRows[0] || null);
        realtime.emitAdmin("inventory:flowUpdated", { eventType: "company_to_superstockist", request: publicRequest });
        realtime.emitAdmin("inventory:snapshot", await getCompanyInventorySnapshot());

        return res.json({
            success: true,
            message: "Stock request approved and inventory updated",
            request: publicRequest
        });
    } catch (error) {
        await connection.rollback().catch(() => {});
        console.log(error);
        return res.status(400).json({
            success: false,
            message: error.message || "Could not approve request"
        });
    }
};

exports.rejectRequest = async (req, res) => {
    try {
        const id = req.params.id;
        const { reviewed_by, notes } = req.body;

        const [rows] = await db.promise().query(
            "SELECT * FROM stock_replenishment_requests WHERE id = ?",
            [id]
        );

        if (!rows.length) {
            return res.status(404).json({ success: false, message: "Request not found" });
        }

        if (rows[0].status !== "Pending") {
            return res.status(400).json({
                success: false,
                message: `Request is already ${rows[0].status}`
            });
        }

        await db.promise().query(
            `UPDATE stock_replenishment_requests
             SET status = 'Rejected',
                 reviewed_by = ?,
                 reviewed_at = NOW(),
                 notes = COALESCE(?, notes),
                 updated_at = NOW()
             WHERE id = ?`,
            [reviewed_by || "Company", notes || null, id]
        );

        const [updatedRows] = await db.promise().query(
            "SELECT * FROM stock_replenishment_requests WHERE id = ?",
            [id]
        );

        const publicRequest = toPublicRequest(updatedRows[0]);
        realtime.emitStockRequestUpdated(publicRequest, "Rejected");

        return res.json({
            success: true,
            message: "Stock request rejected",
            request: publicRequest
        });
    } catch (error) {
        console.log(error);
        return res.status(500).json({ success: false, message: "Server error" });
    }
};

exports.deleteRequest = async (req, res) => {
    try {
        const id = req.params.id;
        const actor = req.actor;

        const [rows] = await db.promise().query(
            "SELECT * FROM stock_replenishment_requests WHERE id = ?",
            [id]
        );

        if (!rows.length) {
            return res.status(404).json({ success: false, message: "Request not found" });
        }

        const request = rows[0];
        if (actor?.role === "superstockist") {
            if (Number(request.superstockist_id) !== Number(actor.id)) {
                return res.status(403).json({
                    success: false,
                    message: "You can only delete your own stock requests"
                });
            }
        }

        await db.promise().query("DELETE FROM stock_replenishment_requests WHERE id = ?", [id]);
        return res.json({ success: true, message: "Stock request deleted" });
    } catch (error) {
        console.log(error);
        return res.status(500).json({ success: false, message: "Could not delete stock request" });
    }
};

async function getCompanyInventorySnapshot() {
    const [rows] = await db.promise().query(
        "SELECT * FROM company_inventory ORDER BY id DESC"
    );
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
