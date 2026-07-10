const db = require("../config/db");

const DEFAULT_MIN_STOCK = 10;

async function getCompanyAvailableForProduct(productName, connection = null) {
    const normalized = String(productName || "").trim();
    if (!normalized) return 0;

    const query = connection ? connection.query.bind(connection) : db.promise().query.bind(db.promise());
    const [rows] = await query(
        `SELECT COALESCE(SUM(remaining_products), 0) AS available
         FROM company_inventory
         WHERE remaining_products > 0
           AND UPPER(TRIM(product_name)) = UPPER(TRIM(?))`,
        [normalized]
    );

    return Number(rows[0]?.available || 0);
}

async function getCompanyAvailabilityMap(productNames) {
    const unique = [...new Set(
        (productNames || [])
            .map((name) => String(name || "").trim())
            .filter(Boolean)
    )];

    const map = {};
    await Promise.all(unique.map(async (name) => {
        map[name] = await getCompanyAvailableForProduct(name);
    }));

    return map;
}

async function deductCompanyStock(connection, productName, quantity) {
    const normalizedProduct = String(productName || "").trim();
    if (!normalizedProduct) {
        throw new Error("Product name is required for company stock deduction.");
    }

    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
        throw new Error("Invalid quantity for stock deduction.");
    }

    const [rows] = await connection.query(
        `SELECT id, remaining_products
         FROM company_inventory
         WHERE remaining_products > 0
           AND UPPER(TRIM(product_name)) = UPPER(TRIM(?))
         ORDER BY id ASC
         FOR UPDATE`,
        [normalizedProduct]
    );

    const available = rows.reduce((sum, row) => sum + Number(row.remaining_products || 0), 0);
    if (available < qty) {
        throw new Error(
            `Insufficient company inventory for ${normalizedProduct}. Available: ${available}, requested: ${qty}`
        );
    }

    let remaining = qty;
    for (const row of rows) {
        if (remaining <= 0) break;
        const deduct = Math.min(Number(row.remaining_products), remaining);
        await connection.query(
            `UPDATE company_inventory
             SET remaining_products = remaining_products - ?,
                 sold_products = sold_products + ?
             WHERE id = ?`,
            [deduct, deduct, row.id]
        );
        remaining -= deduct;
    }
}

async function getCompanyLowStockProducts() {
    const [rows] = await db.promise().query(
        `SELECT MAX(product_name) AS product_name,
                COALESCE(SUM(remaining_products), 0) AS available,
                COALESCE(MAX(min_stock), ?) AS min_stock
         FROM company_inventory
         WHERE product_name IS NOT NULL AND TRIM(product_name) <> ''
         GROUP BY UPPER(TRIM(product_name))
         HAVING available <= min_stock
         ORDER BY available ASC`,
        [DEFAULT_MIN_STOCK]
    );

    return rows.map((row) => ({
        productName: row.product_name,
        available: Number(row.available || 0),
        minStock: Number(row.min_stock || DEFAULT_MIN_STOCK)
    }));
}

async function getCompanyProductSummary() {
    const [rows] = await db.promise().query(
        `SELECT MAX(product_name) AS product_name,
                COALESCE(SUM(remaining_products), 0) AS available,
                COALESCE(MAX(min_stock), ?) AS min_stock
         FROM company_inventory
         WHERE product_name IS NOT NULL AND TRIM(product_name) <> ''
         GROUP BY UPPER(TRIM(product_name))
         ORDER BY product_name ASC`,
        [DEFAULT_MIN_STOCK]
    );

    return rows.map((row) => {
        const available = Number(row.available || 0);
        const minStock = Number(row.min_stock || DEFAULT_MIN_STOCK);
        return {
            productName: row.product_name,
            available,
            minStock,
            isLowStock: available <= minStock
        };
    });
}

module.exports = {
    DEFAULT_MIN_STOCK,
    getCompanyAvailableForProduct,
    getCompanyAvailabilityMap,
    deductCompanyStock,
    getCompanyLowStockProducts,
    getCompanyProductSummary
};
