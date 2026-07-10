const db = require("../config/db");
const realtime = require("../utils/realtime");

const DEFAULT_COMPANY_ID = 1;

function normalizeProducts(body) {
    if (Array.isArray(body.products) && body.products.length) {
        return body.products
            .map((item, index) => ({
                product_name: String(item.product_name || item.product || "").trim(),
                quantity: Number(item.quantity),
                sort_order: index
            }))
            .filter((item) => item.product_name && Number.isFinite(item.quantity) && item.quantity > 0);
    }

    const singleProduct = String(body.product || body.product_name || "").trim();
    const singleQty = Number(body.quantity);
    if (singleProduct && Number.isFinite(singleQty) && singleQty > 0) {
        return [{ product_name: singleProduct, quantity: singleQty, sort_order: 0 }];
    }

    return [];
}

function summarizeProducts(products) {
    if (!products.length) {
        return { product: null, quantity: null };
    }

    const totalQty = products.reduce((sum, item) => sum + item.quantity, 0);
    const names = products.map((item) => item.product_name);

    let product = names[0];
    if (names.length > 1) {
        product = `${names[0]} (+${names.length - 1} more)`;
    }

    return { product, quantity: totalQty };
}

async function insertReportProducts(connection, reportId, products) {
    for (const item of products) {
        await connection.query(
            `INSERT INTO daily_report_products (report_id, product_name, quantity, sort_order)
             VALUES (?, ?, ?, ?)`,
            [reportId, item.product_name, item.quantity, item.sort_order]
        );
    }
}

async function fetchReportProducts(reportIds) {
    if (!reportIds.length) return new Map();

    const placeholders = reportIds.map(() => "?").join(",");
    const [rows] = await db.promise().query(
        `SELECT id, report_id, product_name, quantity, sort_order
         FROM daily_report_products
         WHERE report_id IN (${placeholders})
         ORDER BY sort_order ASC, id ASC`,
        reportIds
    );

    const map = new Map();
    rows.forEach((row) => {
        const list = map.get(row.report_id) || [];
        list.push({
            id: row.id,
            productName: row.product_name,
            quantity: row.quantity,
            sortOrder: row.sort_order
        });
        map.set(row.report_id, list);
    });
    return map;
}

function attachProductsToReports(reports, productMap) {
    return reports.map((report) => {
        const products = productMap.get(report.id) || [];
        if (!products.length && report.product) {
            return {
                ...report,
                products: [{
                    productName: report.product,
                    quantity: report.quantity
                }]
            };
        }
        return { ...report, products };
    });
}

exports.addDailyReport = async (req, res) => {
    const connection = db.promise();

    try {
        const {
            user_id,
            employee_id,
            employee_name,
            date_time,
            location,
            retailer_name,
            shop_name,
            shop_address,
            visit_status,
            delivery_date,
            sales,
            notes,
            distributor_name
        } = req.body;

        const products = normalizeProducts(req.body);
        const summary = summarizeProducts(products);
        const resolvedShopName = shop_name || retailer_name;

        if (!user_id || !employee_name || !date_time || !location || !resolvedShopName) {
            return res.status(400).json({
                success: false,
                message: "Missing required report fields"
            });
        }

        if (distributor_name && !products.length) {
            return res.status(400).json({
                success: false,
                message: "Add at least one product with quantity when sending an order to the distributor"
            });
        }

        await connection.beginTransaction();

        const [result] = await connection.query(
            `INSERT INTO daily_reports
             (company_id, user_id, employee_id, employee_name, date_time, location,
              shop_name, shop_address, visit_status, product, quantity, delivery_date, sales, notes, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                DEFAULT_COMPANY_ID,
                user_id,
                employee_id || null,
                employee_name,
                date_time,
                location,
                resolvedShopName,
                shop_address || null,
                visit_status || "Visited",
                summary.product,
                summary.quantity,
                delivery_date || null,
                sales ? Number(sales) : null,
                notes || null,
                "Submitted"
            ]
        );

        const reportId = result.insertId;

        if (products.length) {
            await insertReportProducts(connection, reportId, products);
        }

        const orders = [];
        const totalSales = sales ? Number(sales) : 0;
        const salesPerOrder = products.length ? totalSales / products.length : 0;

        if (products.length && distributor_name) {
            for (const item of products) {
                const [orderResult] = await connection.query(
                    `INSERT INTO sales_orders
                     (user_id, daily_report_id, employee_id, employee_name, retailer_name, shop_address,
                      distributor_name, product_name, quantity, sales_amount,
                      expected_delivery_date, order_remarks, status)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending')`,
                    [
                        user_id,
                        reportId,
                        employee_id || null,
                        employee_name,
                        resolvedShopName,
                        shop_address || null,
                        distributor_name,
                        item.product_name,
                        item.quantity,
                        salesPerOrder,
                        delivery_date || null,
                        notes || null
                    ]
                );

                const [orderRows] = await connection.query(
                    "SELECT * FROM sales_orders WHERE id = ?",
                    [orderResult.insertId]
                );
                orders.push(orderRows[0]);
            }

            const productSummary = products
                .map((item) => `${item.product_name} (${item.quantity})`)
                .join(", ");

            await connection.query(
                `INSERT INTO notifications (sender_id, receiver_id, message)
                 VALUES (?, NULL, ?)`,
                [
                    user_id,
                    `${employee_name} sent order for ${productSummary} to ${distributor_name}`
                ]
            );
        }

        await connection.commit();

        const [rows] = await db.promise().query(
            "SELECT * FROM daily_reports WHERE id = ?",
            [reportId]
        );

        const productMap = await fetchReportProducts([reportId]);
        const report = attachProductsToReports(rows, productMap)[0];

        orders.forEach((order) => realtime.emitOrderSubmitted(order));
        realtime.emitDailyReportSubmitted(report);

        const orderCount = orders.length;
        return res.json({
            success: true,
            message: orderCount
                ? `Daily report saved and ${orderCount} order${orderCount > 1 ? "s" : ""} sent to distributor`
                : "Daily report saved successfully",
            report,
            orders,
            order: orders[0] || null
        });
    } catch (error) {
        await connection.rollback().catch(() => {});
        console.log(error);
        return res.status(500).json({
            success: false,
            message: error.message || "Daily report save failed"
        });
    }
};

exports.updateDailyReport = async (req, res) => {
    const connection = db.promise();

    try {
        const reportId = req.params.id;
        const employeeId = req.body.employee_id;
        const {
            date_time,
            location,
            retailer_name,
            shop_address,
            visit_status,
            delivery_date,
            sales,
            notes
        } = req.body;

        const products = normalizeProducts(req.body);
        const summary = summarizeProducts(products);

        await connection.beginTransaction();

        const [result] = await connection.query(
            `UPDATE daily_reports
             SET date_time = ?, location = ?, shop_name = ?, shop_address = ?,
                 visit_status = ?, product = ?, quantity = ?, delivery_date = ?,
                 sales = ?, notes = ?
             WHERE id = ? AND employee_id = ?`,
            [
                date_time,
                location,
                retailer_name,
                shop_address || null,
                visit_status,
                summary.product,
                summary.quantity,
                delivery_date || null,
                sales ? Number(sales) : null,
                notes || null,
                reportId,
                employeeId
            ]
        );

        if (result.affectedRows === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: "Report not found" });
        }

        await connection.query("DELETE FROM daily_report_products WHERE report_id = ?", [reportId]);

        if (products.length) {
            await insertReportProducts(connection, reportId, products);
        }

        await connection.commit();

        const [rows] = await db.promise().query(
            "SELECT * FROM daily_reports WHERE id = ?",
            [reportId]
        );
        const productMap = await fetchReportProducts([Number(reportId)]);

        return res.json({
            success: true,
            message: "Report updated successfully",
            report: attachProductsToReports(rows, productMap)[0]
        });
    } catch (error) {
        await connection.rollback().catch(() => {});
        console.log(error);
        return res.status(500).json({ success: false });
    }
};

exports.getEmployeeReports = async (req, res) => {
    try {
        const employeeId = req.params.employeeId;
        const search = String(req.query.search || "").trim();

        let sql = `SELECT * FROM daily_reports WHERE employee_id = ?`;
        const params = [employeeId];

        if (search) {
            sql += ` AND (
                shop_name LIKE ? OR shop_address LIKE ? OR product LIKE ? OR notes LIKE ? OR location LIKE ?
                OR id IN (
                    SELECT report_id FROM daily_report_products
                    WHERE product_name LIKE ?
                )
            )`;
            const term = `%${search}%`;
            params.push(term, term, term, term, term, term);
        }

        sql += " ORDER BY id DESC";

        const [rows] = await db.promise().query(sql, params);
        const productMap = await fetchReportProducts(rows.map((row) => row.id));
        return res.json(attachProductsToReports(rows, productMap));
    } catch (error) {
        console.log(error);
        return res.status(500).json({ success: false });
    }
};

exports.deleteDailyReport = async (req, res) => {
    const connection = db.promise();

    try {
        const reportId = req.params.id;
        const employeeId = req.query.employeeId;
        const actor = req.actor;

        await connection.beginTransaction();

        let deleteSql = "DELETE FROM daily_reports WHERE id = ?";
        const deleteParams = [reportId];

        if (actor?.role === "employee") {
            const empId = actor.empId || String(actor.id);
            deleteSql += " AND employee_id = ?";
            deleteParams.push(empId);
        } else if (employeeId) {
            deleteSql += " AND employee_id = ?";
            deleteParams.push(employeeId);
        } else if (actor?.role !== "manager") {
            await connection.rollback();
            return res.status(403).json({ success: false, message: "Not authorized to delete this report" });
        }

        await connection.query(
            "DELETE FROM sales_orders WHERE daily_report_id = ? AND status = 'Pending'",
            [reportId]
        );
        await connection.query("DELETE FROM daily_report_products WHERE report_id = ?", [reportId]);

        const [result] = await connection.query(deleteSql, deleteParams);

        if (result.affectedRows === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: "Report not found" });
        }

        await connection.commit();
        return res.json({ success: true, message: "Report deleted successfully" });
    } catch (error) {
        await connection.rollback().catch(() => {});
        console.log(error);
        return res.status(500).json({ success: false });
    }
};

exports.getRecentReports = async (req, res) => {
    try {
        const [rows] = await db.promise().query(
            "SELECT * FROM daily_reports ORDER BY id DESC LIMIT 50"
        );
        const productMap = await fetchReportProducts(rows.map((row) => row.id));
        return res.json(attachProductsToReports(rows, productMap));
    } catch (error) {
        console.log(error);
        return res.status(500).json({ success: false });
    }
};
