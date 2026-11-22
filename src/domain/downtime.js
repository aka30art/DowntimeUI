import {calculateCustomScheduleForDate,calculateScheduleForDate,intervalMinutes,parseClock} from "./schedule.js";
export function getEntryDurationMinutes(entry){
  if(!entry||typeof entry!=="object")return 0;
  if(Number.isFinite(entry.durationMinutes))return Math.max(0,entry.durationMinutes);
  if(Number.isFinite(entry.minutesTotal))return Math.max(0,entry.minutesTotal);
  return Math.max(0,(Number(entry.hours)||0)*60+(Number(entry.minutes)||0));
}
export function validateDowntimeEntry(entry){
  const errors=[];
  if(!entry||typeof entry!=="object")return ["Downtime entry must be an object."];
  if(typeof entry.area!=="string"||!entry.area.trim())errors.push("Area or station is required.");
  if(typeof entry.reason!=="string"||!entry.reason.trim())errors.push("Downtime reason is required.");
  const duration=getEntryDurationMinutes(entry);
  if(duration<=0)errors.push("Downtime duration must be greater than zero.");
  if(entry.startTime!==undefined&&parseClock(entry.startTime)===null)errors.push("Start time must use HH:MM.");
  if(entry.endTime!==undefined&&parseClock(entry.endTime)===null)errors.push("End time must use HH:MM.");
  return errors;
}
export function calculateDayMetrics(day={},schedule=null){
  let scheduledMinutes=0,breakMinutes=0;
  if(day.start&&day.stop){
    const actual=day.date?calculateCustomScheduleForDate(day.date,day.start,day.stop,schedule||{}):null;
    scheduledMinutes=actual?.scheduledMinutes??(intervalMinutes(day.start,day.stop)??0);
    if(Number.isFinite(day.breakMinutes))breakMinutes=Math.max(0,day.breakMinutes);
    else breakMinutes=actual?.breakMinutes||0;
  } else if(schedule){
    const resolved=calculateScheduleForDate(day.date,schedule);
    scheduledMinutes=resolved.scheduledMinutes;
    breakMinutes=resolved.breakMinutes;
  } else {
    scheduledMinutes=0;breakMinutes=Math.max(0,Number(day.breakMinutes)||0);
  }
  breakMinutes=Math.min(scheduledMinutes,breakMinutes);
  const netMinutes=Math.max(0,scheduledMinutes-breakMinutes);
  const downtimeMinutes=(Array.isArray(day.entries)?day.entries:[])
    .reduce((sum,entry)=>sum+getEntryDurationMinutes(entry),0);
  const runningMinutes=Math.max(0,netMinutes-downtimeMinutes);
  return {
    scheduledMinutes,breakMinutes,netMinutes,downtimeMinutes,runningMinutes,
    downtimeRate:netMinutes?downtimeMinutes/netMinutes*100:0,
    runningRate:netMinutes?runningMinutes/netMinutes*100:0,
    exceedsNetTime:downtimeMinutes>netMinutes
  };
}
export function calculateWeekMetrics(days=[],schedule=null){
  const daily=(Array.isArray(days)?days:[]).map(day=>({date:day.date||null,operator:day.operator||"",start:day.start||"",stop:day.stop||"",metrics:calculateDayMetrics(day,schedule)}));
  const totals=daily.reduce((acc,item)=>{
    for(const key of ["scheduledMinutes","breakMinutes","netMinutes","downtimeMinutes","runningMinutes"])acc[key]+=item.metrics[key];
    return acc;
  },{scheduledMinutes:0,breakMinutes:0,netMinutes:0,downtimeMinutes:0,runningMinutes:0});
  return {...totals,downtimeRate:totals.netMinutes?totals.downtimeMinutes/totals.netMinutes*100:0,
    runningRate:totals.netMinutes?totals.runningMinutes/totals.netMinutes*100:0,daily};
}
export function rankDowntimeCauses(days=[]){
  const totals=new Map();
  for(const day of days||[])for(const entry of day.entries||[]){
    const name=String(entry.reason||"Unknown").trim()||"Unknown";
    totals.set(name,(totals.get(name)||0)+getEntryDurationMinutes(entry));
  }
  return [...totals.entries()].map(([reason,minutes])=>({reason,minutes}))
    .sort((a,b)=>b.minutes-a.minutes||a.reason.localeCompare(b.reason));
}
