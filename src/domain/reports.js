import {calculateWeekMetrics,rankDowntimeCauses} from "./downtime.js";
export function buildWeeklyReport({weekStart,days=[],previousDays=[],schedule=null,companyName="",siteName="",generatedAt=new Date()}={}){
  const summary=calculateWeekMetrics(days,schedule),previous=previousDays.length?calculateWeekMetrics(previousDays,schedule):null;
  const causes=rankDowntimeCauses(days);
  return {
    weekStart:weekStart||null,companyName,siteName,
    generatedAt:generatedAt instanceof Date?generatedAt.toISOString():new Date(generatedAt).toISOString(),
    days:summary.daily,totals:{
      scheduledMinutes:summary.scheduledMinutes,breakMinutes:summary.breakMinutes,netMinutes:summary.netMinutes,
      downtimeMinutes:summary.downtimeMinutes,runningMinutes:summary.runningMinutes,
      downtimeRate:summary.downtimeRate,runningRate:summary.runningRate
    },
    causes:causes.map(x=>({...x,shareOfDowntime:summary.downtimeMinutes?x.minutes/summary.downtimeMinutes*100:0})),
    comparison:previous?{
      previousDowntimeMinutes:previous.downtimeMinutes,
      downtimeDeltaMinutes:summary.downtimeMinutes-previous.downtimeMinutes,
      previousDowntimeRate:previous.downtimeRate,
      downtimeRateDelta:summary.downtimeRate-previous.downtimeRate
    }:null
  };
}
