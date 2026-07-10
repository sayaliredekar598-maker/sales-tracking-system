const express = require("express");
const router = express.Router();
const inventoryController = require("../controllers/inventoryController");
const distributorInventoryController = require("../controllers/distributorInventoryController");
const { requireRoles } = require("../middleware/authorize");

router.get("/dashboard", inventoryController.getDashboard);
router.get("/inventory", inventoryController.getInventory);
router.get("/inventory/low-stock", inventoryController.getLowStock);
router.put("/inventory/stock", inventoryController.updateStock);
router.post("/inventory/restock", inventoryController.restockProduct);
router.delete("/inventory/:id", requireRoles("manager", "superstockist"), inventoryController.deleteStockInventory);
router.get("/distributors", inventoryController.getDistributors);
router.delete("/distributors/:id", requireRoles("manager", "superstockist"), inventoryController.deleteDistributorUser);
router.get("/company-inventory", inventoryController.getCompanyInventory);
router.get("/company-inventory/snapshot", inventoryController.getCompanyInventorySnapshot);
router.post("/company-inventory", inventoryController.addCompanyInventory);
router.delete("/company-inventory/:id", requireRoles("manager", "company"), inventoryController.deleteCompanyInventory);

router.get("/distributor-requests/pending", distributorInventoryController.getPendingDistributorRequests);
router.get("/distributor-requests", distributorInventoryController.getDistributorStockRequests);
router.patch("/distributor-requests/:id/approve", distributorInventoryController.approveDistributorRequest);
router.patch("/distributor-requests/:id/reject", distributorInventoryController.rejectDistributorRequest);
router.delete("/distributor-requests/:id", requireRoles("manager", "superstockist"), distributorInventoryController.deleteDistributorStockRequest);
router.get("/inventory/flow", distributorInventoryController.getInventoryFlowLog);
router.delete("/inventory/flow/:id", requireRoles("manager", "superstockist"), distributorInventoryController.deleteInventoryFlowLog);
router.delete("/distributor-inventory/:id", requireRoles("manager", "superstockist", "distributor"), distributorInventoryController.deleteDistributorInventoryRow);
router.get("/inventory/distributor-overview", distributorInventoryController.getSuperStockistDistributorOverview);

module.exports = router;
