import {DRAFT_STORAGE_KEY,TENANT_STORAGE_KEY,validateConfig} from "../config-core.js";
import {validateDowntimeEntry} from "./downtime.js";
import {validateTaskTemplates} from "./daily-tasks.js";
const isObject=value=>value!==null&&typeof value==="object"&&!Array.isArray(value);
const validTimestamp=value=>typeof value==="string"&&!Number.isNaN(Date.parse(value));
function validDate(value){
  if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const date=new Date(value+"T12:00:00.000Z");
  return !Number.isNaN(date.getTime())&&date.toISOString().slice(0,10)===value;
}
export function validateWorkspaceBackup(backup,currentInstallationId){
  const errors=[];
  if(!isObject(backup))return {ok:false,errors:["Backup file must contain a JSON object."]};
  if(backup.format!=="downtimeui-workspace-backup")errors.push("Backup format is not recognised.");
  if(backup.backupVersion!==1)errors.push("Unsupported workspace backup version.");
  if(!validTimestamp(backup.exportedAt))errors.push("Backup export timestamp is missing or invalid.");
  if(!isObject(backup.configuration))errors.push("Backup configuration is missing.");
  else{
    if(backup.configuration.installed!==true)errors.push("Backup configuration is not an installed workspace.");
    if(!backup.configuration.installationId||backup.configuration.installationId!==currentInstallationId)errors.push("Backup belongs to a different installation.");
    errors.push(...validateConfig(backup.configuration).map(x=>"Backup configuration: "+x));
  }
  const ops=backup.operations;
  if(!isObject(ops))errors.push("Backup operations data is missing.");
  else{
    if(ops.schemaVersion!==1)errors.push("Unsupported operations backup version.");
    if(ops.installationId!==currentInstallationId)errors.push("Operations data belongs to a different installation.");
    if(!isObject(ops.weeks))errors.push("Weekly operations data must be an object.");
    if(!Array.isArray(ops.reports))errors.push("Report archive must be a list.");
    const stationIds=new Set((backup.configuration?.site?.stations||[]).map(x=>x.id));
    const staffIds=new Set((backup.configuration?.staff||[]).map(x=>x.id));
    const taskIds=new Set((backup.configuration?.dailyTasks||[]).map(x=>x.id));
    if(isObject(ops.weeks))for(const [weekKey,week] of Object.entries(ops.weeks)){
      if(!validDate(weekKey))errors.push("Weekly archive contains an invalid week date: "+weekKey+".");
      if(!isObject(week)||!Array.isArray(week.days)){errors.push("Week "+weekKey+" must contain a day list.");continue;}
      if(week.days.length>7)errors.push("Week "+weekKey+" contains more than seven day records.");
      for(let dayIndex=0;dayIndex<week.days.length;dayIndex++){
        const day=week.days[dayIndex];
        if(!isObject(day)){errors.push("Week "+weekKey+" day "+(dayIndex+1)+" is invalid.");continue;}
        if(!validDate(day.date))errors.push("Week "+weekKey+" day "+(dayIndex+1)+" has an invalid date.");
        if(!Array.isArray(day.entries))errors.push("Day "+day.date+" downtime entries must be a list.");
        else{
          const entryIds=new Set();
          day.entries.forEach((entry,index)=>{
            if(!isObject(entry)){errors.push("Day "+day.date+" entry "+(index+1)+" is invalid.");return;}
            if(typeof entry.id!=="string"||!entry.id.trim())errors.push("Day "+day.date+" entry "+(index+1)+" needs an ID.");
            else if(entryIds.has(entry.id))errors.push("Day "+day.date+" contains duplicate downtime entry IDs.");
            else entryIds.add(entry.id);
            errors.push(...validateDowntimeEntry(entry).map(x=>"Day "+day.date+" entry "+(index+1)+": "+x));
            if(entry.stationId&&!stationIds.has(entry.stationId))errors.push("Day "+day.date+" entry references a station outside this installation.");
          });
        }
        if(day.operatorId&&!staffIds.has(day.operatorId))errors.push("Day "+day.date+" references an unknown operator.");
        if(day.dailyTasks!==undefined){
          if(!isObject(day.dailyTasks))errors.push("Day "+day.date+" checklist state is invalid.");
          else{
            const tasks=day.dailyTasks.snapshot;
            if(tasks!==null&&tasks!==undefined){
              errors.push(...validateTaskTemplates(tasks).map(x=>"Day "+day.date+" checklist: "+x));
            }
            if(!Array.isArray(day.dailyTasks.completedTaskIds))errors.push("Day "+day.date+" completed task IDs must be a list.");
            else{
              const allowed=new Set(Array.isArray(tasks)?tasks.map(x=>x.id):[...taskIds]);
              day.dailyTasks.completedTaskIds.forEach(id=>{if(!allowed.has(id))errors.push("Day "+day.date+" completion refers to a task outside its checklist.");});
            }
            if(day.dailyTasks.lockedAt){
              if(!validTimestamp(day.dailyTasks.lockedAt))errors.push("Day "+day.date+" has an invalid checklist lock timestamp.");
              if(!Array.isArray(tasks))errors.push("Day "+day.date+" is locked without an immutable task snapshot.");
            }
          }
        }
      }
    }
    if(Array.isArray(ops.reports)){
      const reportIds=new Set();
      ops.reports.forEach((report,index)=>{
        if(!isObject(report)){errors.push("Report "+(index+1)+" is invalid.");return;}
        if(typeof report.id!=="string"||!report.id.trim())errors.push("Report "+(index+1)+" needs an ID.");
        else if(reportIds.has(report.id))errors.push("Report archive contains duplicate report IDs.");
        else reportIds.add(report.id);
        if(!isObject(report.totals)||!Number.isFinite(report.totals.downtimeMinutes))errors.push("Report "+(index+1)+" has invalid summary totals.");
      });
    }
    if(!isObject(ops.plant))errors.push("Plant state is missing.");
    else{
      if(!["running","stopped"].includes(ops.plant.status))errors.push("Plant status is invalid.");
      if(!isObject(ops.plant.stationStates)||!isObject(ops.plant.assignments))errors.push("Plant station state or assignments are invalid.");
      else{
        for(const [stationId,status] of Object.entries(ops.plant.stationStates)){
          if(!stationIds.has(stationId))errors.push("Plant state references a station outside this installation.");
          if(!["running","down","maintenance","idle"].includes(status))errors.push("Plant station status is invalid.");
        }
        for(const [stationId,staffId] of Object.entries(ops.plant.assignments)){
          if(!stationIds.has(stationId)||!staffIds.has(staffId))errors.push("Plant operator assignment references an unknown station or staff member.");
        }
      }
      if(!Array.isArray(ops.plant.history))errors.push("Plant history must be a list.");
      else ops.plant.history.forEach((event,index)=>{
        if(!isObject(event)||!validTimestamp(event.at)||typeof event.label!=="string")errors.push("Plant history event "+(index+1)+" is invalid.");
      });
    }
  }
  return {ok:errors.length===0,errors:[...new Set(errors)]};
}


export function createWorkspaceBackup(configuration,operations,{exportedAt=new Date()}={}){
  const backup={
    format:"downtimeui-workspace-backup",backupVersion:1,
    exportedAt:exportedAt instanceof Date?exportedAt.toISOString():new Date(exportedAt).toISOString(),
    configuration,operations
  };
  const validation=validateWorkspaceBackup(backup,configuration?.installationId);
  if(!validation.ok)throw new TypeError("Cannot create an invalid workspace backup: "+validation.errors.join(" "));
  return JSON.parse(JSON.stringify(backup));
}
export function restoreWorkspaceBackup(backup,currentInstallationId,{storage=globalThis.localStorage}={}){
  const validation=validateWorkspaceBackup(backup,currentInstallationId);
  if(!validation.ok)return {ok:false,errors:validation.errors};
  if(!storage)return {ok:false,errors:["Local browser storage is unavailable."]};
  const configurationKey=TENANT_STORAGE_KEY;
  const operationsKey="downtimeui:operations:v1:"+currentInstallationId;
  let previousConfiguration,previousOperations,previousDraft;
  try{
    previousConfiguration=storage.getItem(configurationKey);
    previousOperations=storage.getItem(operationsKey);
    previousDraft=storage.getItem(DRAFT_STORAGE_KEY);
    storage.setItem(configurationKey,JSON.stringify(backup.configuration));
    storage.setItem(operationsKey,JSON.stringify(backup.operations));
    storage.removeItem(DRAFT_STORAGE_KEY);
    return {ok:true,errors:[],configuration:JSON.parse(JSON.stringify(backup.configuration)),operations:JSON.parse(JSON.stringify(backup.operations))};
  }catch(error){
    try{
      if(previousConfiguration===null||previousConfiguration===undefined)storage.removeItem(configurationKey);
      else storage.setItem(configurationKey,previousConfiguration);
      if(previousOperations===null||previousOperations===undefined)storage.removeItem(operationsKey);
      else storage.setItem(operationsKey,previousOperations);
      if(previousDraft===null||previousDraft===undefined)storage.removeItem(DRAFT_STORAGE_KEY);
      else storage.setItem(DRAFT_STORAGE_KEY,previousDraft);
    }catch{/* Best-effort rollback if browser storage also rejects recovery writes. */}
    return {ok:false,errors:["Restore failed and the previous local data was retained where browser storage allowed rollback: "+(error?.message||"Storage error")]};
  }
}
