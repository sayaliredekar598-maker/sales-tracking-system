const express = require("express");
const router = express.Router();
const distributorController = require("../controllers/distributorController");
const distributorInventoryController = require("../controllers/distributorInventoryController");
const { requireRoles } = require("../middleware/authorize");

router.get("/dashboard", distributorController.getDashboard);
router.get("/orders", distributorController.getOrders);
router.patch("/orders/:id/accept", distributorController.acceptOrder);
router.patch("/orders/:id/reject", distributorController.rejectOrder);
router.patch("/orders/:id/status", distributorController.updateDeliveryStatus);
router.post("/notify-low-stock", distributorController.notifyLowStock);

router.get("/inventory", distributorInventoryController.getDistributorInventory);
router.get("/inventory/dashboard", distributorInventoryController.getDistributorInventoryDashboard);
router.post("/stock-requests", distributorInventoryController.createDistributorStockRequest);
router.get("/stock-requests", distributorInventoryController.getDistributorStockRequests);
router.delete("/stock-requests/:id", requireRoles("manager", "superstockist", "distributor"), distributorInventoryController.deleteDistributorStockRequest);
router.delete("/inventory/:id", requireRoles("manager", "superstockist", "distributor"), distributorInventoryController.deleteDistributorInventoryRow);

module.exports = router;
