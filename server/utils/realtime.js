const db = require("../config/db");

let io = null;

const liveEmployees = new Map();

function init(ioInstance) {
    io = ioInstance;
}

function initialsOf(name) {
    return String(name || "E")
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part.charAt(0).toUpperCase())
        .join("") || "E";
}

function upsertLiveEmployee(payload) {
    const id = payload.id || payload.employeeId || payload.employeeName;
    if (!id) return null;

    const existing = liveEmployees.get(String(id)) || {};
    const employee = {
        id: String(id),
        name: payload.name || payload.employeeName || existing.name || "Employee",
        initials: initialsOf(payload.name || payload.employeeName || existing.name),
        lat: payload.lat ?? payload.latitude ?? existing.lat ?? null,
        lng: payload.lng ?? payload.longitude ?? existing.lng ?? null,
        isGpsOn: true,
        status: payload.status || "Active",
        lastSeen: Date.now()
    };

    liveEmployees.set(String(id), employee);
    return employee;
}

function emitAdmin(event, payload) {
    if (io) io.emit(event, payload);
}

async function refreshAndEmitAdminSummary() {
    if (!io) return;

    try {
        const [[reportsRow]] = await db.promise().query(
            "SELECT COUNT(*) AS totalReports FROM daily_reports WHERE DATE(date_time) = CURDATE()"
        );
        const [[reportSalesRow]] = await db.promise().query(
            `SELECT COALESCE(SUM(sales), 0) AS todayReportSales
             FROM daily_reports
             WHERE DATE(date_time) = CURDATE() AND sales IS NOT NULL`
        );
        const [[salesRow]] = await db.promise().query(
            `SELECT COALESCE(SUM(sales_amount), 0) AS todaySales,
                    COALESCE(SUM(quantity), 0) AS todayProducts
             FROM sales_orders WHERE DATE(created_at) = CURDATE()`
        );
        const [[employeeRow]] = await db.promise().query(
            "SELECT COUNT(*) AS totalEmployees FROM users WHERE role = 'employee'"
        );

        emitAdmin("admin:summary", {
            totalEmployees: employeeRow.totalEmployees,
            activeEmployees: getLiveEmployees().length,
            todaySales: salesRow.todaySales,
            todayProducts: salesRow.todayProducts,
            todayReports: reportsRow.totalReports,
            todayReportSales: reportSalesRow.todayReportSales
        });
    } catch (error) {
        console.log(error);
    }
}

function distributorRooms(distributorId, distributorName) {
    const rooms = [];
    if (distributorId) rooms.push(`distributor:${distributorId}`);
    const name = String(distributorName || "").trim().toLowerCase();
    if (name) rooms.push(`distributor:name:${name}`);
    return rooms;
}

function emitToDistributor(distributorId, distributorName, event, payload) {
    if (!io) return;
    distributorRooms(distributorId, distributorName).forEach((room) => {
        io.to(room).emit(event, payload);
    });
}

function emitEmployeeLocation(data) {
    const employee = upsertLiveEmployee({
        id: data.employeeId || data.employeeName,
        employeeId: data.employeeId,
        employeeName: data.employeeName,
        name: data.employeeName,
        lat: data.latitude,
        lng: data.longitude
    });

    if (!employee) return;

    emitAdmin("admin:employeeUpdate", employee);
    emitAdmin("admin:activity", {
        type: "gps_on",
        employee,
        message: `${employee.name} location updated`,
        timestamp: Date.now()
    });
}

function emitDailyReportSubmitted(report) {
    emitAdmin("admin:reportSubmitted", report);
    emitAdmin("admin:activity", {
        type: "report",
        employee: { name: report.employee_name, initials: initialsOf(report.employee_name) },
        message: `${report.employee_name} submitted a daily visit report`,
        timestamp: Date.now()
    });
    refreshAndEmitAdminSummary().catch(() => {});
}

function emitOrderSubmitted(order) {
    emitAdmin("order:submitted", order);
    emitAdmin("notification:distributor", {
        title: "New Order Assigned",
        message: `${order.employee_name} placed an order for ${order.product_name}`,
        order
    });
    emitAdmin("notification:superstockist", {
        title: "Product Requirement",
        message: `${order.quantity} units of ${order.product_name} required`,
        order
    });
    emitAdmin("notification:manager", {
        title: "New Sales Order",
        message: `${order.employee_name} ordered ${order.product_name} for ${order.retailer_name}`,
        order
    });
    emitAdmin("admin:activity", {
        type: "order",
        employee: { name: order.employee_name, initials: initialsOf(order.employee_name) },
        message: `${order.employee_name} submitted a new order`,
        timestamp: Date.now()
    });
    refreshAndEmitAdminSummary().catch(() => {});
}

function emitOrderStatusChanged(order) {
    emitAdmin("order:statusChanged", order);
    emitAdmin("admin:activity", {
        type: "order_status",
        employee: { name: order.employee_name, initials: initialsOf(order.employee_name) },
        message: `Order #${order.id} is now ${order.status}`,
        timestamp: Date.now()
    });
}

function emitStockRequestCreated(request) {
    emitAdmin("stock:requestCreated", request);
    emitAdmin("notification:manager", {
        title: "Stock Replenishment Request",
        message: `${request.superstockistName} requested ${request.quantity} units of ${request.productName}`,
        request
    });
    emitAdmin("admin:activity", {
        type: "stock_request",
        employee: { name: request.superstockistName, initials: initialsOf(request.superstockistName) },
        message: `${request.superstockistName} requested ${request.quantity} units of ${request.productName}`,
        timestamp: Date.now()
    });
}

function emitStockRequestUpdated(request, action) {
    emitAdmin("stock:requestUpdated", { request, action });
    emitAdmin("notification:superstockist", {
        title: `Stock Request ${action}`,
        message: `Your request for ${request.quantity} units of ${request.productName} was ${action.toLowerCase()}`,
        request
    });
    emitAdmin("admin:activity", {
        type: "stock_request_status",
        employee: { name: request.superstockistName, initials: initialsOf(request.superstockistName) },
        message: `Stock request #${request.id} for ${request.productName} was ${action.toLowerCase()}`,
        timestamp: Date.now()
    });
}

function emitDistributorStockRequestCreated(request) {
    emitAdmin("distributorStock:requestCreated", request);
    emitAdmin("notification:superstockist", {
        title: "Distributor Stock Request",
        message: `${request.distributorName} requested ${request.quantity} units of ${request.productName}`,
        request
    });
    emitAdmin("notification:distributor", {
        title: "Stock Request Submitted",
        message: `Your request for ${request.quantity} units of ${request.productName} was sent to Super Stockist`,
        request
    });
}

function emitDistributorStockRequestUpdated(request, action) {
    emitAdmin("distributorStock:requestUpdated", { request, action });
    emitAdmin("notification:distributor", {
        title: `Stock Request ${action}`,
        message: `Your request for ${request.quantity} units of ${request.productName} was ${action.toLowerCase()}`,
        request
    });
}

function emitDistributorStockDispatched(payload) {
    const distributorId = payload.distributorId || payload.request?.distributorId;
    const distributorName = payload.distributorName || payload.request?.distributorName;
    const snapshotPayload = (payload.distributorInventoryList || payload.items) ? {
        distributorId,
        distributorName,
        items: payload.distributorInventoryList || payload.items,
        summary: payload.summary,
        totalStock: payload.summary?.totalStock,
        dispatchedStock: payload.summary?.dispatchedStock,
        remainingStock: payload.summary?.remainingStock,
        updatedAt: new Date().toISOString()
    } : null;

    emitAdmin("distributorStock:dispatched", payload);
    emitAdmin("inventory:flowUpdated", payload);
    emitToDistributor(distributorId, distributorName, "distributorStock:dispatched", payload);
    if (snapshotPayload) {
        emitAdmin("distributorStock:inventorySnapshot", snapshotPayload);
        emitToDistributor(distributorId, distributorName, "distributorStock:inventorySnapshot", snapshotPayload);
    }
    emitAdmin("notification:distributor", {
        title: "Stock Dispatched",
        message: `${payload.request.quantity} units of ${payload.request.productName} added to your inventory`,
        request: payload.request
    });
    emitAdmin("notification:superstockist", {
        title: "Stock Dispatched",
        message: `Dispatched ${payload.request.quantity} units of ${payload.request.productName} to ${payload.request.distributorName}. SS remaining: ${payload.ssRemaining}`,
        request: payload.request
    });
}

function emitDistributorInventoryUpdated(payload) {
    const snapshotPayload = (payload.distributorInventoryList || payload.items) ? {
        distributorId: payload.distributorId,
        distributorName: payload.distributorName,
        items: payload.distributorInventoryList || payload.items,
        summary: payload.summary,
        totalStock: payload.summary?.totalStock,
        dispatchedStock: payload.summary?.dispatchedStock,
        remainingStock: payload.summary?.remainingStock,
        updatedAt: new Date().toISOString()
    } : null;

    emitAdmin("distributorStock:updated", payload);
    emitAdmin("inventory:flowUpdated", payload);
    emitToDistributor(payload.distributorId, payload.distributorName, "distributorStock:updated", payload);
    if (snapshotPayload) {
        emitAdmin("distributorStock:inventorySnapshot", snapshotPayload);
        emitToDistributor(payload.distributorId, payload.distributorName, "distributorStock:inventorySnapshot", snapshotPayload);
    }
}

function getLiveEmployees() {
    return [...liveEmployees.values()];
}

module.exports = {
    init,
    emitEmployeeLocation,
    emitDailyReportSubmitted,
    emitOrderSubmitted,
    emitOrderStatusChanged,
    emitStockRequestCreated,
    emitStockRequestUpdated,
    emitDistributorStockRequestCreated,
    emitDistributorStockRequestUpdated,
    emitDistributorStockDispatched,
    emitDistributorInventoryUpdated,
    getLiveEmployees,
    upsertLiveEmployee,
    emitAdmin,
    refreshAndEmitAdminSummary,
    initialsOf
};
