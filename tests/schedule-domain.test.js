import assert from "node:assert/strict";
import {calculateScheduleForDate,dateDayCode,formatMinutes,intervalMinutes,parseClock} from "../src/domain/schedule.js";
import {calculateDayMetrics,calculateWeekMetrics,getEntryDurationMinutes,rankDowntimeCauses,validateDowntimeEntry} from "../src/domain/downtime.js";
assert.equal(parseClock("06:30"),390);
assert.equal(parseClock("24:00"),null);
assert.equal(intervalMinutes("06:30","16:00"),570);
assert.equal(intervalMinutes("22:00","06:00"),480);
assert.equal(intervalMinutes("08:00","08:00"),0);
assert.equal(dateDayCode("2026-11-23"),"mon");
assert.equal(dateDayCode("2026-99-99"),null);
assert.equal(formatMinutes(495),"08h 15m");
const schedule={workDays:["mon","tue","wed","thu","fri"],shifts:[{id:"night",name:"Night shift",start:"22:00",end:"06:00"}],breaks:[{id:"meal",name:"Meal break",start:"00:30",end:"01:00"}]};
const night=calculateScheduleForDate("2026-11-23",schedule);
assert.equal(night.scheduledMinutes,480);
assert.equal(night.breakMinutes,30);
assert.equal(night.netMinutes,450);
assert.equal(calculateScheduleForDate("2026-11-22",schedule).scheduledMinutes,0);
const overlap=calculateScheduleForDate("2026-11-23",{workDays:["mon"],shifts:[
 {id:"s1",name:"Shift A",start:"06:00",end:"14:00"},{id:"s2",name:"Shift B",start:"12:00",end:"20:00"}
],breaks:[{id:"b1",name:"Break",start:"12:30",end:"13:00"}]});
assert.equal(overlap.scheduledMinutes,840,"overlapping shift intervals must not double-count scheduled time");
assert.equal(overlap.breakMinutes,30);
const daily=calculateDayMetrics({date:"2026-11-23",start:"06:30",stop:"16:00",breakMinutes:75,entries:[{hours:0,minutes:31}]});
assert.equal(daily.scheduledMinutes,570);
assert.equal(daily.breakMinutes,75);
assert.equal(daily.netMinutes,495);
assert.equal(daily.downtimeMinutes,31);
assert.equal(daily.runningMinutes,464);
assert.equal(daily.downtimeRate,31/495*100);
assert.equal(daily.runningRate,464/495*100);
assert.equal(daily.exceedsNetTime,false);
const actualShift=calculateDayMetrics({date:"2026-11-23",start:"07:00",stop:"16:00",entries:[]},{workDays:["mon"],shifts:[{id:"s",name:"Day",start:"06:30",end:"16:00"}],breaks:[{id:"b",name:"Meal",start:"12:00",end:"12:30"}]});
assert.equal(actualShift.scheduledMinutes,540,"Actual recorded shift overrides the planned shift window.");
assert.equal(actualShift.breakMinutes,30,"Configured breaks must be clipped to actual shift time.");
assert.equal(actualShift.netMinutes,510,"Net available time uses actual start/finish and break overlap.");
const overnightActual=calculateDayMetrics({date:"2026-11-23",start:"22:00",stop:"06:00",entries:[]},{workDays:["mon"],shifts:[],breaks:[{id:"b",name:"Overnight break",start:"00:30",end:"01:00"}]});
assert.equal(overnightActual.scheduledMinutes,480);
assert.equal(overnightActual.breakMinutes,30,"Overnight actual shift includes cross-midnight break deductions.");
const excessive=calculateDayMetrics({start:"08:00",stop:"09:00",breakMinutes:0,entries:[{durationMinutes:75}]});
assert.equal(excessive.runningMinutes,0);
assert.equal(excessive.exceedsNetTime,true);
assert.equal(excessive.downtimeRate,125);
const weekly=calculateWeekMetrics([
 {date:"2026-11-23",start:"06:30",stop:"16:00",breakMinutes:75,entries:[{hours:0,minutes:31}]},
 {date:"2026-11-24",start:"06:30",stop:"16:00",breakMinutes:75,entries:[{hours:1,minutes:0}]}
]);
assert.equal(weekly.netMinutes,990);
assert.equal(weekly.downtimeMinutes,91);
assert.equal(weekly.runningMinutes,899);
assert.equal(weekly.downtimeRate,91/990*100,"weekly rate must be weighted from aggregate minutes, not daily percentage averages");
assert.equal(getEntryDurationMinutes({hours:-1,minutes:5}),0);
assert.deepEqual(validateDowntimeEntry({area:"",reason:"",hours:0,minutes:0}).length,3);
assert.deepEqual(rankDowntimeCauses([{entries:[{reason:"Blockage",durationMinutes:30},{reason:"Mechanical",durationMinutes:45},{reason:"Blockage",durationMinutes:10}]}]),[
 {reason:"Mechanical",minutes:45},{reason:"Blockage",minutes:40}
]);
console.log("Schedule, downtime metrics and weighted weekly calculations: PASS");
