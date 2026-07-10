const db = require("../config/db");
const realtime = require("../utils/realtime");
const { getDistributorInventorySnapshot } = require("../controllers/distributorInventoryController");

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

module.exports = (io) => {
    realtime.init(io);

    console.log("✅ Socket.IO Connected");

    io.on("connection", (socket) => {
        console.log("User Connected :", socket.id);

        socket.on("admin:join", async () => {
            try {
                const [[ordersRow]] = await db.promise().query(
                    "SELECT COUNT(*) AS totalOrders FROM sales_orders"
                );
                const [[reportsRow]] = await db.promise().query(
                    "SELECT COUNT(*) AS totalReports FROM daily_reports WHERE DATE(date_time) = CURDATE()"
                );
                const [[salesRow]] = await db.promise().query(
                    `SELECT COALESCE(SUM(sales_amount), 0) AS todaySales,
                            COALESCE(SUM(quantity), 0) AS todayProducts
                     FROM sales_orders WHERE DATE(created_at) = CURDATE()`
                );
                const [[reportSalesRow]] = await db.promise().query(
                    `SELECT COALESCE(SUM(sales), 0) AS todayReportSales
                     FROM daily_reports
                     WHERE DATE(date_time) = CURDATE() AND sales IS NOT NULL`
                );
                const [[employeeRow]] = await db.promise().query(
                    "SELECT COUNT(*) AS totalEmployees FROM users WHERE role = 'employee'"
                );

                const [recentReports] = await db.promise().query(
                    `SELECT id, employee_id, employee_name, shop_name, location, visit_status,
                            product, sales, date_time, notes, quantity
                     FROM daily_reports ORDER BY id DESC LIMIT 20`
                );

                const reportIds = recentReports.map((r) => r.id);
                const productsByReport = {};
                if (reportIds.length) {
                    const placeholders = reportIds.map(() => "?").join(",");
                    const [productRows] = await db.promise().query(
                        `SELECT report_id, product_name, quantity
                         FROM daily_report_products
                         WHERE report_id IN (${placeholders})
                         ORDER BY sort_order ASC, id ASC`,
                        reportIds
                    );
                    productRows.forEach((row) => {
                        if (!productsByReport[row.report_id]) productsByReport[row.report_id] = [];
                        productsByReport[row.report_id].push({
                            productName: row.product_name,
                            quantity: row.quantity
                        });
                    });
                }

                const enrichedReports = recentReports.map((report) => ({
                    ...report,
                    products: productsByReport[report.id] || (
                        report.product
                            ? [{ productName: report.product, quantity: report.quantity }]
                            : []
                    )
                }));

                socket.emit("admin:snapshot", {
                    employees: realtime.getLiveEmployees(),
                    recentReports: enrichedReports,
                    summary: {
                        totalEmployees: employeeRow.totalEmployees,
                        activeEmployees: realtime.getLiveEmployees().length,
                        todaySales: salesRow.todaySales,
                        todayProducts: salesRow.todayProducts,
                        todayReports: reportsRow.totalReports,
                        todayReportSales: reportSalesRow.todayReportSales,
                        totalOrders: ordersRow.totalOrders
                    }
                });
            } catch (error) {
                console.log(error);
            }
        });

        socket.on("inventory:subscribe", async () => {
            try {
                const list = await getCompanyInventorySnapshot();
                socket.emit("inventory:snapshot", list);
            } catch (error) {
                console.log(error);
            }
        });

        socket.on("distributor:inventory:subscribe", async (data) => {
            try {
                const distributorId = data?.distributorId || data?.distributor_id;
                const distributorName = String(data?.distributorName || data?.distributor || "").trim();
                if (distributorId) socket.join(`distributor:${distributorId}`);
                if (distributorName) socket.join(`distributor:name:${distributorName.toLowerCase()}`);
                const snapshot = await getDistributorInventorySnapshot(distributorId, distributorName);
                socket.emit("distributorStock:inventorySnapshot", snapshot);
            } catch (error) {
                console.log(error);
            }
        });

        socket.on("employeeLocation", async (data) => {
            realtime.emitEmployeeLocation(data);
            try {
                await db.promise().query(
                    "INSERT INTO locations (name, lat, lng) VALUES (?, ?, ?)",
                    [data.employeeName || "Employee", data.latitude, data.longitude]
                );
            } catch (error) {
                console.log(error);
            }
        });

        socket.on("employee:status", (data) => io.emit("employee:status", data));
        socket.on("employee:report", (data) => io.emit("employee:report", data));

        socket.on("disconnect", () => {
            console.log("User Disconnected :", socket.id);
        });
    });
};
