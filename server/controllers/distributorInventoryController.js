const db = require("../config/db");
const realtime = require("../utils/realtime");

function toPublicDistributorRequest(row) {
    return {
        id: row.id,
        distributorId: row.distributor_id,
        distributorName: row.distributor_name,
        productName: row.product_name,
        quantity: row.quantity,
        status: row.status,
        notes: row.notes || null,
        reviewedBy: row.reviewed_by || null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        reviewedAt: row.reviewed_at || null,
        dispatchedAt: row.dispatched_at || null
    };
}

function toPublicInventoryRow(row) {
    return {
        id: row.id,
        distributorId: row.distributor_id,
        distributorName: row.distributor_name,
        productName: row.product_name,
        totalStock: Number(row.total_received) || 0,
        dispatchedStock: Number(row.dispatched) || 0,
        remainingStock: Number(row.remaining) || 0,
        minStock: Number(row.min_stock) || 0,
        updatedAt: row.updated_at
    };
}

function applyDistributorFilter(sql, params, distributorId, distributorName) {
    if (distributorId && distributorName) {
        sql += " AND (distributor_id = ? OR distributor_name LIKE ?)";
        params.push(Number(distributorId), `%${distributorName}%`);
    } else if (distributorId) {
        sql += " AND distributor_id = ?";
        params.push(Number(distributorId));
    } else if (distributorName) {
        sql += " AND distributor_name LIKE ?";
        params.push(`%${distributorName}%`);
    }
    return sql;
}

async function buildFullDistributorInventory(distributorId, distributorName) {
    const [products] = await db.promise().query(
        "SELECT product_name, min_stock FROM stock_inventory ORDER BY product_name ASC"
    );

    let distSql = "SELECT * FROM distributor_inventory WHERE 1=1";
    const distParams = [];
    distSql = applyDistributorFilter(distSql, distParams, distributorId, distributorName);
    const [distRows] = await db.promise().query(distSql, distParams);

    const distMap = new Map();
    distRows.forEach((row) => {
        distMap.set(String(row.product_name).trim().toUpperCase(), row);
    });

    return products.map((product) => {
        const dist = distMap.get(String(product.product_name).trim().toUpperCase());
        const totalReceived = Number(dist?.total_received) || 0;
        const dispatched = Number(dist?.dispatched) || 0;
        const remaining = Number(dist?.remaining) || 0;
        const minStock = Number(dist?.min_stock) || Number(product.min_stock) || 10;

        return {
            id: dist?.id || null,
            distributorId: dist?.distributor_id || (distributorId ? Number(distributorId) : null),
            distributorName: dist?.distributor_name || distributorName || null,
            productName: product.product_name,
            totalStockAvailable: totalReceived,
            stockReceived: totalReceived,
            dispatchedStock: dispatched,
            remainingStock: remaining,
            availableQuantity: remaining,
            minStock,
            updatedAt: dist?.updated_at || null
        };
    });
}

function summarizeInventoryItems(items) {
    return {
        totalStock: items.reduce((sum, item) => sum + item.stockReceived, 0),
        dispatchedStock: items.reduce((sum, item) => sum + item.dispatchedStock, 0),
        remainingStock: items.reduce((sum, item) => sum + item.remainingStock, 0),
        lowStockProducts: items.filter((item) => item.remainingStock <= item.minStock).length
    };
}

function toPublicFlowRow(row) {
    return {
        id: row.id,
        eventType: row.event_type,
        productName: row.product_name,
        quantity: row.quantity,
        fromName: row.from_name,
        toName: row.to_name,
        ssRemainingAfter: row.ss_remaining_after,
        distributorRemainingAfter: row.distributor_remaining_after,
        referenceId: row.reference_id,
        createdAt: row.created_at
    };
}

async function logInventoryFlow(connection, payload) {
    await connection.query(
        `INSERT INTO inventory_flow_log
         (event_type, product_name, quantity, from_name, to_name, from_party_id, to_party_id,
          ss_remaining_after, distributor_remaining_after, reference_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            payload.event_type,
            payload.product_name,
            payload.quantity,
            payload.from_name,
            payload.to_name,
            payload.from_party_id || null,
            payload.to_party_id || null,
            payload.ss_remaining_after ?? null,
            payload.distributor_remaining_after ?? null,
            payload.reference_id || null
        ]
    );
}

async function getSsRemaining(connection, productName) {
    const [rows] = await connection.query(
        "SELECT quantity FROM stock_inventory WHERE UPPER(product_name) = UPPER(?)",
        [productName]
    );
    return rows[0]?.quantity ?? 0;
}

async function getDistributorRemaining(connection, distributorId, productName) {
    const [rows] = await connection.query(
        `SELECT remaining FROM distributor_inventory
         WHERE distributor_id = ? AND UPPER(product_name) = UPPER(?)`,
        [distributorId, productName]
    );
    return rows[0]?.remaining ?? 0;
}

async function buildDistributorInventorySnapshot(distributorId, distributorName) {
    const items = await buildFullDistributorInventory(distributorId, distributorName);
    const summary = summarizeInventoryItems(items);
    return {
        distributorId: distributorId ? Number(distributorId) : null,
        distributorName: distributorName || null,
        items,
        ...summary,
        updatedAt: new Date().toISOString()
    };
}

exports.getDistributorInventory = async (req, res) => {
    try {
        const distributorId = req.query.distributor_id;
        const distributorName = String(req.query.distributor || "").trim();
        const items = await buildFullDistributorInventory(distributorId, distributorName);
        return res.json(items);
    } catch (error) {
        console.log(error);
        return res.status(500).json({ success: false });
    }
};

exports.getDistributorInventoryDashboard = async (req, res) => {
    try {
        const distributorId = req.query.distributor_id;
        const distributorName = String(req.query.distributor || "").trim();
        const snapshot = await buildDistributorInventorySnapshot(distributorId, distributorName);

        let pendingSql = "SELECT COUNT(*) AS pendingRequests FROM distributor_stock_requests WHERE status = 'Pending'";
        const pendingParams = [];
        if (distributorId && distributorName) {
            pendingSql += " AND (distributor_id = ? OR distributor_name LIKE ?)";
            pendingParams.push(Number(distributorId), `%${distributorName}%`);
        } else if (distributorId) {
            pendingSql += " AND distributor_id = ?";
            pendingParams.push(Number(distributorId));
        } else if (distributorName) {
            pendingSql += " AND distributor_name LIKE ?";
            pendingParams.push(`%${distributorName}%`);
        }

        const [[pendingRow]] = await db.promise().query(pendingSql, pendingParams);

        return res.json({
            ...snapshot,
            pendingRequests: Number(pendingRow?.pendingRequests) || 0
        });
    } catch (error) {
        console.log(error);
        return res.status(500).json({ success: false });
    }
};

exports.getDistributorInventorySnapshot = buildDistributorInventorySnapshot;

exports.createDistributorStockRequest = async (req, res) => {
    try {
        const { distributor_id, distributor_name, product_name, quantity, notes } = req.body;

        if (!distributor_id || !distributor_name || !product_name || !quantity) {
            return res.status(400).json({
                success: false,
                message: "distributor_id, distributor_name, product_name, and quantity are required"
            });
        }

        const qty = Number(quantity);
        if (!Number.isFinite(qty) || qty <= 0) {
            return res.status(400).json({ success: false, message: "quantity must be greater than 0" });
        }

        const [result] = await db.promise().query(
            `INSERT INTO distributor_stock_requests
             (distributor_id, distributor_name, product_name, quantity, status, notes)
             VALUES (?, ?, ?, ?, 'Pending', ?)`,
            [distributor_id, distributor_name, product_name.trim(), qty, notes || null]
        );

        const [rows] = await db.promise().query(
            "SELECT * FROM distributor_stock_requests WHERE id = ?",
            [result.insertId]
        );

        const request = toPublicDistributorRequest(rows[0]);
        realtime.emitDistributorStockRequestCreated(request);
        return res.status(201).json({ success: true, message: "Stock request submitted to Super Stockist", request });
    } catch (error) {
        console.log(error);
        return res.status(500).json({ success: false, message: "Server error" });
    }
};

exports.getDistributorStockRequests = async (req, res) => {
    try {
        const distributorId = req.query.distributor_id;
        const distributorName = String(req.query.distributor || "").trim();
        const { status } = req.query;
        let sql = "SELECT * FROM distributor_stock_requests WHERE 1=1";
        const params = [];

        sql = applyDistributorFilter(sql, params, distributorId, distributorName);
        if (status) {
            sql += " AND status = ?";
            params.push(status);
        }

        sql += " ORDER BY created_at DESC";
        const [rows] = await db.promise().query(sql, params);
        return res.json(rows.map(toPublicDistributorRequest));
    } catch (error) {
        console.log(error);
        return res.status(500).json({ success: false });
    }
};

exports.getPendingDistributorRequests = async (req, res) => {
    try {
        const [rows] = await db.promise().query(
            `SELECT * FROM distributor_stock_requests
             WHERE status = 'Pending'
             ORDER BY created_at ASC`
        );
        return res.json(rows.map(toPublicDistributorRequest));
    } catch (error) {
        console.log(error);
        return res.status(500).json({ success: false });
    }
};

exports.approveDistributorRequest = async (req, res) => {
    const connection = db.promise();

    try {
        const id = req.params.id;
        const { reviewed_by } = req.body;

        await connection.beginTransaction();

        const [rows] = await connection.query(
            "SELECT * FROM distributor_stock_requests WHERE id = ? FOR UPDATE",
            [id]
        );

        if (!rows.length) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: "Request not found" });
        }

        const request = rows[0];
        if (request.status !== "Pending") {
            await connection.rollback();
            return res.status(400).json({ success: false, message: `Request is already ${request.status}` });
        }

        const [ssRows] = await connection.query(
            "SELECT quantity FROM stock_inventory WHERE UPPER(product_name) = UPPER(?) FOR UPDATE",
            [request.product_name]
        );

        const ssQty = Number(ssRows[0]?.quantity || 0);
        const reqQty = Number(request.quantity);

        if (ssQty < reqQty) {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                message: `Insufficient Super Stockist stock for ${request.product_name}. Available: ${ssQty}, requested: ${reqQty}`
            });
        }

        await connection.query(
            "UPDATE stock_inventory SET quantity = quantity - ? WHERE UPPER(product_name) = UPPER(?)",
            [reqQty, request.product_name]
        );

        await connection.query(
            `INSERT INTO distributor_inventory
             (distributor_id, distributor_name, product_name, total_received, dispatched, remaining, min_stock)
             VALUES (?, ?, ?, ?, 0, ?, 10)
             ON DUPLICATE KEY UPDATE
                total_received = total_received + VALUES(total_received),
                remaining = remaining + VALUES(remaining)`,
            [request.distributor_id, request.distributor_name, request.product_name, reqQty, reqQty]
        );

        await connection.query(
            `UPDATE distributor_stock_requests
             SET status = 'Dispatched',
                 reviewed_by = ?,
                 reviewed_at = NOW(),
                 dispatched_at = NOW(),
                 updated_at = NOW()
             WHERE id = ?`,
            [reviewed_by || "Super Stockist", id]
        );

        const ssRemaining = await getSsRemaining(connection, request.product_name);
        const distRemaining = await getDistributorRemaining(
            connection,
            request.distributor_id,
            request.product_name
        );

        await logInventoryFlow(connection, {
            event_type: "superstockist_to_distributor",
            product_name: request.product_name,
            quantity: reqQty,
            from_name: "Super Stockist",
            to_name: request.distributor_name,
            to_party_id: request.distributor_id,
            ss_remaining_after: ssRemaining,
            distributor_remaining_after: distRemaining,
            reference_id: id
        });

        await connection.commit();

        const [updatedRows] = await db.promise().query(
            "SELECT * FROM distributor_stock_requests WHERE id = ?",
            [id]
        );
        const [inventoryRows] = await db.promise().query(
            "SELECT * FROM stock_inventory WHERE UPPER(product_name) = UPPER(?)",
            [request.product_name]
        );

        const publicRequest = toPublicDistributorRequest(updatedRows[0]);
        const distributorInventoryList = await buildFullDistributorInventory(
            request.distributor_id,
            request.distributor_name
        );
        const summary = summarizeInventoryItems(distributorInventoryList);
        const flowPayload = {
            distributorId: request.distributor_id,
            distributorName: request.distributor_name,
            request: publicRequest,
            ssRemaining,
            distributorRemaining: distRemaining,
            inventory: inventoryRows[0] || null,
            distributorInventory: distributorInventoryList.find(
                (item) => item.productName.toUpperCase() === request.product_name.toUpperCase()
            ) || null,
            distributorInventoryList,
            summary
        };

        realtime.emitDistributorStockDispatched(flowPayload);
        realtime.emitAdmin("inventory:updated", inventoryRows[0] || null);

        return res.json({
            success: true,
            message: "Stock dispatched to distributor",
            request: publicRequest,
            ssRemaining,
            distributorRemaining: distRemaining
        });
    } catch (error) {
        await connection.rollback().catch(() => {});
        console.log(error);
        return res.status(400).json({ success: false, message: error.message || "Could not dispatch stock" });
    }
};

exports.rejectDistributorRequest = async (req, res) => {
    try {
        const id = req.params.id;
        const { reviewed_by, notes } = req.body;

        const [rows] = await db.promise().query(
            "SELECT * FROM distributor_stock_requests WHERE id = ?",
            [id]
        );

        if (!rows.length) {
            return res.status(404).json({ success: false, message: "Request not found" });
        }

        if (rows[0].status !== "Pending") {
            return res.status(400).json({ success: false, message: `Request is already ${rows[0].status}` });
        }

        await db.promise().query(
            `UPDATE distributor_stock_requests
             SET status = 'Rejected',
                 reviewed_by = ?,
                 reviewed_at = NOW(),
                 notes = COALESCE(?, notes),
                 updated_at = NOW()
             WHERE id = ?`,
            [reviewed_by || "Super Stockist", notes || null, id]
        );

        const [updatedRows] = await db.promise().query(
            "SELECT * FROM distributor_stock_requests WHERE id = ?",
            [id]
        );

        const publicRequest = toPublicDistributorRequest(updatedRows[0]);
        realtime.emitDistributorStockRequestUpdated(publicRequest, "Rejected");

        return res.json({ success: true, message: "Stock request rejected", request: publicRequest });
    } catch (error) {
        console.log(error);
        return res.status(500).json({ success: false, message: "Server error" });
    }
};

exports.getInventoryFlowLog = async (req, res) => {
    try {
        const limit = Math.min(Number(req.query.limit) || 50, 200);
        const [rows] = await db.promise().query(
            `SELECT * FROM inventory_flow_log
             ORDER BY created_at DESC
             LIMIT ?`,
            [limit]
        );
        return res.json(rows.map(toPublicFlowRow));
    } catch (error) {
        console.log(error);
        return res.status(500).json({ success: false });
    }
};

exports.getSuperStockistDistributorOverview = async (req, res) => {
    try {
        const [[pendingRow]] = await db.promise().query(
            "SELECT COUNT(*) AS pendingDistributorRequests FROM distributor_stock_requests WHERE status = 'Pending'"
        );

        const [inventory] = await db.promise().query(
            "SELECT * FROM stock_inventory ORDER BY product_name ASC"
        );

        const [distributorStock] = await db.promise().query(
            `SELECT id, distributor_id, distributor_name, product_name, total_received, dispatched, remaining
             FROM distributor_inventory
             ORDER BY distributor_name ASC, product_name ASC`
        );

        const [recentDispatches] = await db.promise().query(
            `SELECT * FROM distributor_stock_requests
             WHERE status = 'Dispatched'
             ORDER BY dispatched_at DESC
             LIMIT 20`
        );

        return res.json({
            pendingDistributorRequests: pendingRow.pendingDistributorRequests || 0,
            inventory,
            distributorStock: distributorStock.map((row) => ({
                id: row.id,
                distributorId: row.distributor_id,
                distributorName: row.distributor_name,
                productName: row.product_name,
                totalStock: row.total_received,
                dispatchedStock: row.dispatched,
                remainingStock: row.remaining
            })),
            recentDispatches: recentDispatches.map(toPublicDistributorRequest)
        });
    } catch (error) {
        console.log(error);
        return res.status(500).json({ success: false });
    }
};

exports.dispatchStockToDistributor = async (distributorId, distributorName, productName, quantity, referenceId) => {
    const connection = db.promise();
    await connection.beginTransaction();

    try {
        const [ssRows] = await connection.query(
            "SELECT quantity FROM stock_inventory WHERE UPPER(product_name) = UPPER(?) FOR UPDATE",
            [productName]
        );
        const ssQty = Number(ssRows[0]?.quantity || 0);
        if (ssQty < quantity) {
            throw new Error(`Insufficient Super Stockist stock for ${productName}`);
        }

        await connection.query(
            "UPDATE stock_inventory SET quantity = quantity - ? WHERE UPPER(product_name) = UPPER(?)",
            [quantity, productName]
        );

        await connection.query(
            `INSERT INTO distributor_inventory
             (distributor_id, distributor_name, product_name, total_received, dispatched, remaining, min_stock)
             VALUES (?, ?, ?, ?, 0, ?, 10)
             ON DUPLICATE KEY UPDATE
                total_received = total_received + VALUES(total_received),
                remaining = remaining + VALUES(remaining)`,
            [distributorId, distributorName, productName, quantity, quantity]
        );

        const ssRemaining = await getSsRemaining(connection, productName);
        const distRemaining = await getDistributorRemaining(connection, distributorId, productName);

        await logInventoryFlow(connection, {
            event_type: "superstockist_to_distributor",
            product_name: productName,
            quantity,
            from_name: "Super Stockist",
            to_name: distributorName,
            to_party_id: distributorId,
            ss_remaining_after: ssRemaining,
            distributor_remaining_after: distRemaining,
            reference_id: referenceId
        });

        await connection.commit();
        return { ssRemaining, distRemaining };
    } catch (error) {
        await connection.rollback().catch(() => {});
        throw error;
    }
};

exports.deductDistributorStockOnDelivery = async (distributorName, productName, quantity, orderId) => {
    const connection = db.promise();
    await connection.beginTransaction();

    try {
        const [users] = await connection.query(
            "SELECT id, name FROM users WHERE role = 'distributor' AND name LIKE ? LIMIT 1",
            [`%${distributorName}%`]
        );

        const distributorId = users[0]?.id;
        if (!distributorId) {
            await connection.rollback();
            return null;
        }

        const [invRows] = await connection.query(
            `SELECT * FROM distributor_inventory
             WHERE distributor_id = ? AND UPPER(product_name) = UPPER(?)
             FOR UPDATE`,
            [distributorId, productName]
        );

        if (!invRows.length || Number(invRows[0].remaining) < quantity) {
            await connection.rollback();
            throw new Error(`Insufficient distributor stock for ${productName}`);
        }

        await connection.query(
            `UPDATE distributor_inventory
             SET dispatched = dispatched + ?,
                 remaining = remaining - ?
             WHERE distributor_id = ? AND UPPER(product_name) = UPPER(?)`,
            [quantity, quantity, distributorId, productName]
        );

        const distRemaining = await getDistributorRemaining(connection, distributorId, productName);
        const ssRemaining = await getSsRemaining(connection, productName);

        await logInventoryFlow(connection, {
            event_type: "distributor_to_employee",
            product_name: productName,
            quantity,
            from_name: distributorName,
            to_name: "Sales Executive",
            from_party_id: distributorId,
            ss_remaining_after: ssRemaining,
            distributor_remaining_after: distRemaining,
            reference_id: orderId
        });

        await connection.commit();

        const payload = {
            distributorId,
            distributorName,
            productName,
            quantity,
            distributorRemaining: distRemaining,
            orderId
        };
        const distributorInventoryList = await buildFullDistributorInventory(distributorId, distributorName);
        payload.distributorInventoryList = distributorInventoryList;
        payload.summary = summarizeInventoryItems(distributorInventoryList);

        realtime.emitDistributorInventoryUpdated(payload);
        realtime.emitAdmin("inventory:flowUpdated", payload);

        return payload;
    } catch (error) {
        await connection.rollback().catch(() => {});
        throw error;
    }
};

exports.deleteInventoryFlowLog = async (req, res) => {
    try {
        const id = req.params.id;
        const [result] = await db.promise().query("DELETE FROM inventory_flow_log WHERE id = ?", [id]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: "Flow log entry not found" });
        }
        realtime.emitAdmin("inventory:flowUpdated", { eventType: "deleted", id: Number(id) });
        return res.json({ success: true, message: "Inventory flow entry deleted" });
    } catch (error) {
        console.log(error);
        return res.status(500).json({ success: false, message: "Could not delete flow entry" });
    }
};

exports.deleteDistributorInventoryRow = async (req, res) => {
    try {
        const id = req.params.id;
        const actor = req.actor;

        const [rows] = await db.promise().query("SELECT * FROM distributor_inventory WHERE id = ?", [id]);
        if (!rows.length) {
            return res.status(404).json({ success: false, message: "Inventory record not found" });
        }

        const row = rows[0];
        if (actor?.role === "distributor" && Number(row.distributor_id) !== Number(actor.id)) {
            return res.status(403).json({ success: false, message: "Not authorized to delete this record" });
        }

        await db.promise().query("DELETE FROM distributor_inventory WHERE id = ?", [id]);
        realtime.emitDistributorInventoryUpdated({
            distributorId: row.distributor_id,
            distributorName: row.distributor_name,
            productName: row.product_name
        });
        return res.json({ success: true, message: "Distributor inventory record deleted" });
    } catch (error) {
        console.log(error);
        return res.status(500).json({ success: false, message: "Could not delete inventory record" });
    }
};

exports.deleteDistributorStockRequest = async (req, res) => {
    try {
        const id = req.params.id;
        const actor = req.actor;

        const [rows] = await db.promise().query(
            "SELECT * FROM distributor_stock_requests WHERE id = ?",
            [id]
        );
        if (!rows.length) {
            return res.status(404).json({ success: false, message: "Stock request not found" });
        }

        const request = rows[0];
        if (actor?.role === "distributor" && Number(request.distributor_id) !== Number(actor.id)) {
            return res.status(403).json({ success: false, message: "Not authorized to delete this request" });
        }

        await db.promise().query("DELETE FROM distributor_stock_requests WHERE id = ?", [id]);
        return res.json({ success: true, message: "Stock request deleted" });
    } catch (error) {
        console.log(error);
        return res.status(500).json({ success: false, message: "Could not delete stock request" });
    }
};
