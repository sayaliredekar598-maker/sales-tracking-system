const express = require("express");
const router = express.Router();

const dailyReportController = require("../controllers/dailyReportController");
const { requireRoles } = require("../middleware/authorize");

router.post("/add", dailyReportController.addDailyReport);
router.put("/:id", dailyReportController.updateDailyReport);
router.get("/employee/:employeeId", dailyReportController.getEmployeeReports);
router.delete("/:id", requireRoles("manager", "employee"), dailyReportController.deleteDailyReport);
router.get("/recent/all", dailyReportController.getRecentReports);

module.exports = router;
