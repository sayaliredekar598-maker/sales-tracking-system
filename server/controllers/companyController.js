const db = require("../config/db");

// ===============================
// Add Product
// ===============================

exports.addProduct = (req, res) => {

    const {
        company_id,
        product_name,
        price,
        quantity,
        image,
        description
    } = req.body;

    const sql = `
        INSERT INTO products
        (company_id, product_name, price, quantity, image, description)
        VALUES (?, ?, ?, ?, ?, ?)
    `;

    db.query(
        sql,
        [
            company_id,
            product_name,
            price,
            quantity,
            image,
            description
        ],
        (err, result) => {

            if (err) {
                console.log(err);
                return res.status(500).json({
                    success: false,
                    message: "Product Add Failed"
                });
            }

            res.json({
                success: true,
                message: "Product Added Successfully"
            });

        }
    );

};

// ===============================
// Get All Products
// ===============================

exports.getProducts = (req, res) => {

    const sql = `
        SELECT *
        FROM products
        ORDER BY id DESC
    `;

    db.query(sql, (err, result) => {

        if (err) {

            return res.status(500).json({
                success: false
            });

        }

        res.json(result);

    });

};

// ===============================
// Update Product
// ===============================

exports.updateProduct = (req, res) => {

    const id = req.params.id;

    const {
        product_name,
        price,
        quantity,
        image,
        description
    } = req.body;

    const sql = `
        UPDATE products
        SET
        product_name=?,
        price=?,
        quantity=?,
        image=?,
        description=?
        WHERE id=?
    `;

    db.query(
        sql,
        [
            product_name,
            price,
            quantity,
            image,
            description,
            id
        ],
        (err) => {

            if (err) {

                return res.status(500).json({
                    success: false
                });

            }

            res.json({
                success: true,
                message: "Product Updated Successfully"
            });

        }
    );

};

// ===============================
// Delete Product
// ===============================

exports.deleteProduct = (req, res) => {

    const id = req.params.id;

    db.query(
        "DELETE FROM products WHERE id=?",
        [id],
        (err) => {

            if (err) {

                return res.status(500).json({
                    success: false
                });

            }

            res.json({
                success: true,
                message: "Product Deleted Successfully"
            });

        }
    );

};