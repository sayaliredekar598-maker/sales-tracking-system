const express = require("express");
const router = express.Router();
const stockRequestController = require("../controllers/stockRequestController");
const { requireRoles } = require("../middleware/authorize");

router.post("/", stockRequestController.createRequest);
router.get("/pending", stockRequestController.getPendingRequests);
router.get("/", stockRequestController.getAllRequests);
router.patch("/:id/approve", stockRequestController.approveRequest);
router.patch("/:id/reject", stockRequestController.rejectRequest);
router.delete("/:id", requireRoles("manager", "superstockist"), stockRequestController.deleteRequest);

module.exports = router;
