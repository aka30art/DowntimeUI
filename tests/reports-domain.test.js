import assert from "node:assert/strict";
import {buildWeeklyReport} from "../src/domain/reports.js";
const days=[
 {date:"2026-11-16",operator:"A",start:"06:30",stop:"16:00",breakMinutes:75,entries:[{reason:"Blockage",hours:0,minutes:30}]},
 {date:"2026-11-17",operator:"B",start:"06:30",stop:"16:00",breakMinutes:75,entries:[{reason:"Mechanical",hours:1,minutes:0},{reason:"Blockage",hours:0,minutes:15}]}
];
const previous=[{date:"2026-11-09",start:"06:30",stop:"16:00",breakMinutes:75,entries:[{reason:"Blockage",hours:1,minutes:30}]}];
const report=buildWeeklyReport({weekStart:"2026-11-16",days,previousDays:previous,companyName:"Example",siteName:"North",generatedAt:new Date("2026-11-22T05:00:00Z")});
assert.equal(report.companyName,"Example");
assert.equal(report.siteName,"North");
assert.equal(report.totals.netMinutes,990);
assert.equal(report.totals.downtimeMinutes,105);
assert.equal(report.totals.runningMinutes,885);
assert.equal(report.totals.downtimeRate,105/990*100);
assert.equal(report.causes[0].reason,"Mechanical");
assert.equal(report.causes[0].minutes,60);
assert.equal(report.comparison.previousDowntimeMinutes,90);
assert.equal(report.comparison.downtimeDeltaMinutes,15);
assert.ok(report.days.length===2);
assert.equal(buildWeeklyReport({days:[]}).totals.downtimeRate,0);
console.log("Weekly report summaries, downtime causes and previous-week comparison: PASS");
