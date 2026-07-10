const express = require("express");

const router = express.Router();
const { requireRoles } = require("../middleware/authorize");

const {

    addProduct,
    getProducts,
    updateProduct,
    deleteProduct

} = require("../controllers/companyController");

router.post("/add-product", addProduct);

router.get("/products", getProducts);

router.put("/update-product/:id", updateProduct);

router.delete("/delete-product/:id", requireRoles("manager"), deleteProduct);

const analyticsController = require("../controllers/analyticsController");
router.get("/analytics", analyticsController.getCompanyAnalytics);
router.get("/settings", analyticsController.getCompanySettings);
router.put("/settings", analyticsController.updateCompanySettings);
router.get("/notifications", analyticsController.getNotifications);
router.delete("/notifications/:id", requireRoles("manager"), analyticsController.deleteNotification);
router.get("/employees", analyticsController.getEmployees);
router.delete("/employees/:id", requireRoles("manager"), analyticsController.deleteEmployee);
router.get("/distributor-scorecard", analyticsController.getDistributorScorecard);
router.get("/supply-chain-health", analyticsController.getSupplyChainHealth);
router.get("/inventory/summary", analyticsController.getCompanyInventorySummary);

const distributorInventoryController = require("../controllers/distributorInventoryController");
router.get("/inventory/flow", distributorInventoryController.getInventoryFlowLog);
router.delete("/inventory/flow/:id", requireRoles("manager"), distributorInventoryController.deleteInventoryFlowLog);

module.exports = router;