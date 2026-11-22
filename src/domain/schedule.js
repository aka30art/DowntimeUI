const DAY_CODES=["sun","mon","tue","wed","thu","fri","sat"];
export function parseClock(value){
  if(typeof value!=="string"||!/^([01]\d|2[0-3]):[0-5]\d$/.test(value))return null;
  const [hours,minutes]=value.split(":").map(Number);
  return hours*60+minutes;
}
export function intervalMinutes(start,end,{allowOvernight=true}={}){
  const from=typeof start==="number"?start:parseClock(start);
  const to=typeof end==="number"?end:parseClock(end);
  if(from===null||to===null||from<0||from>1439||to<0||to>1439)return null;
  if(to===from)return 0;
  return to<from?(allowOvernight?to+1440-from:null):to-from;
}
export function dateDayCode(value){
  if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
  const date=new Date(value+"T12:00:00.000Z");
  if(Number.isNaN(date.getTime())||date.toISOString().slice(0,10)!==value)return null;
  return DAY_CODES[date.getUTCDay()];
}
function span(start,end){
  const s=parseClock(start),d=intervalMinutes(start,end);
  return s===null||d===null?null:[s,s+d];
}
function applicable(item,day,workDays){
  const days=Array.isArray(item?.days)&&item.days.length?item.days:workDays;
  return days.includes(day);
}
function mergeIntervals(intervals){
  const sorted=intervals.filter(x=>x&&x[1]>x[0]).sort((a,b)=>a[0]-b[0]);
  const result=[];
  for(const current of sorted){
    const last=result[result.length-1];
    if(last&&current[0]<=last[1])last[1]=Math.max(last[1],current[1]);
    else result.push([...current]);
  }
  return result;
}
function breakOverlap(shift,breakPeriod){
  const b=span(breakPeriod.start,breakPeriod.end);
  if(!b)return 0;
  let best=0;
  for(const offset of [-1440,0,1440]){
    const start=b[0]+offset,end=b[1]+offset;
    best=Math.max(best,Math.max(0,Math.min(shift[1],end)-Math.max(shift[0],start)));
  }
  return best;
}
export function calculateScheduleForDate(date,schedule={}){
  const day=dateDayCode(date),workDays=Array.isArray(schedule.workDays)?schedule.workDays:[];
  if(!day||!workDays.includes(day))return {scheduledMinutes:0,breakMinutes:0,netMinutes:0,shifts:[]};
  const shifts=(Array.isArray(schedule.shifts)?schedule.shifts:[])
    .filter(x=>applicable(x,day,workDays))
    .map(x=>({item:x,interval:span(x.start,x.end)}))
    .filter(x=>x.interval);
  const merged=mergeIntervals(shifts.map(x=>x.interval));
  const scheduledMinutes=merged.reduce((sum,x)=>sum+x[1]-x[0],0);
  const breaks=(Array.isArray(schedule.breaks)?schedule.breaks:[]).filter(x=>applicable(x,day,workDays));
  const breakIntervals=[];
  for(const shift of merged){
    for(const br of breaks){
      const b=span(br.start,br.end);
      if(!b)continue;
      for(const offset of [-1440,0,1440]){
        const s=Math.max(shift[0],b[0]+offset),e=Math.min(shift[1],b[1]+offset);
        if(e>s)breakIntervals.push([s,e]);
      }
    }
  }
  const breakMinutes=Math.min(scheduledMinutes,mergeIntervals(breakIntervals).reduce((sum,x)=>sum+x[1]-x[0],0));
  return {scheduledMinutes,breakMinutes,netMinutes:Math.max(0,scheduledMinutes-breakMinutes),shifts:merged.map(([start,end])=>({startMinute:start,endMinute:end}))};
}
export function formatMinutes(value){
  const minutes=Math.max(0,Math.round(Number(value)||0));
  return String(Math.floor(minutes/60)).padStart(2,"0")+"h "+String(minutes%60).padStart(2,"0")+"m";
}

export function calculateCustomScheduleForDate(date,start,end,schedule={}){
  const day=dateDayCode(date);
  if(!day)return null;
  return calculateScheduleForDate(date,{
    workDays:[day],
    shifts:[{id:"actual-shift",name:"Actual shift",start,end,days:[day]}],
    breaks:Array.isArray(schedule.breaks)?schedule.breaks:[]
  });
}
