const express = require("express");
const router = express.Router();

const orderController = require("../controllers/orderController");
const { requireRoles } = require("../middleware/authorize");

router.post("/add", orderController.addOrder);
router.get("/employee/:employeeId", orderController.getEmployeeOrders);
router.get("/product/:productName", orderController.getOrdersByProduct);
router.get("/all", orderController.getAllOrders);
router.patch("/:id/status", orderController.updateOrderStatus);
router.delete("/distributor/:distributorName", requireRoles("manager"), orderController.deleteOrdersByDistributor);
router.delete("/:id", requireRoles("manager", "employee", "distributor", "superstockist"), orderController.deleteOrder);
router.get("/dashboard/:employeeId", orderController.getDashboardSummary);

module.exports = router;
