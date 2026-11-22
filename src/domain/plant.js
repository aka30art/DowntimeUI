const STATION_STATUSES=new Set(["running","down","maintenance","idle"]);
const PLANT_STATUSES=new Set(["running","stopped"]);
export function createPlantState(){
  return {status:"running",stationStates:{},assignments:{},history:[]};
}
export function normalizePlantState(state){
  const base=createPlantState();
  if(!state||typeof state!=="object")return base;
  return {
    ...base,...state,
    status:PLANT_STATUSES.has(state.status)?state.status:"running",
    stationStates:state.stationStates&&typeof state.stationStates==="object"?{...state.stationStates}:{},
    assignments:state.assignments&&typeof state.assignments==="object"?{...state.assignments}:{},
    history:Array.isArray(state.history)?state.history.slice():[]
  };
}
function eventId(){return "plant_"+Date.now().toString(36)+"_"+Math.random().toString(36).slice(2,8);}
function appendHistory(state,{kind,stationId=null,label,at=new Date(),previous,next}){
  const event={id:eventId(),kind,stationId,at:at instanceof Date?at.toISOString():new Date(at).toISOString(),label};
  if(previous!==undefined)event.previous=previous;
  if(next!==undefined)event.next=next;
  return {...state,history:[...state.history,event].slice(-100)};
}
export function setPlantStatus(state,status,{at=new Date()}={}){
  const current=normalizePlantState(state),next=typeof status==="boolean"?(status?"running":"stopped"):status;
  if(!PLANT_STATUSES.has(next))return {ok:false,code:"INVALID_PLANT_STATUS",state:current};
  if(current.status===next)return {ok:true,changed:false,state:current};
  const updated=appendHistory({...current,status:next},{kind:"plant",label:"Plant status changed to "+next,at,previous:current.status,next});
  return {ok:true,changed:true,state:updated};
}
export function setStationStatus(state,{stationId,status,stationIds=[],stationName="",at=new Date()}={}){
  const current=normalizePlantState(state);
  if(!stationIds.includes(stationId))return {ok:false,code:"STATION_NOT_FOUND",state:current};
  if(!STATION_STATUSES.has(status))return {ok:false,code:"INVALID_STATION_STATUS",state:current};
  const previous=current.stationStates[stationId]||"running";
  if(previous===status)return {ok:true,changed:false,state:current};
  const updated=appendHistory({...current,stationStates:{...current.stationStates,[stationId]:status}},{
    kind:"station",stationId,label:(stationName||"Station")+" · "+previous+" → "+status,at,previous,next:status
  });
  return {ok:true,changed:true,state:updated};
}
export function assignStationOperator(state,{stationId,staffId=null,stationIds=[],staffIds=[],stationName="",staffName="",at=new Date()}={}){
  const current=normalizePlantState(state);
  if(!stationIds.includes(stationId))return {ok:false,code:"STATION_NOT_FOUND",state:current};
  if(staffId&&!staffIds.includes(staffId))return {ok:false,code:"STAFF_NOT_FOUND",state:current};
  if(staffId&&Object.entries(current.assignments).some(([otherStation,personId])=>otherStation!==stationId&&personId===staffId))return {ok:false,code:"OPERATOR_ALREADY_ASSIGNED",message:"This operator is already assigned to another station.",state:current};
  const previous=current.assignments[stationId]||null,next=staffId||null;
  if(previous===next)return {ok:true,changed:false,state:current};
  const assignments={...current.assignments};
  if(next)assignments[stationId]=next;else delete assignments[stationId];
  const updated=appendHistory({...current,assignments},{
    kind:"assignment",stationId,label:(stationName||"Station")+" assigned to "+(next?(staffName||"Operator"):"Unassigned"),at,previous,next
  });
  return {ok:true,changed:true,state:updated};
}
export function getStationOperationalState(state,stationId){
  const current=normalizePlantState(state);
  if(current.status==="stopped")return "suspended";
  return current.stationStates[stationId]||"running";
}
export function getPlantSummary(state,stations=[]){
  const current=normalizePlantState(state),list=Array.isArray(stations)?stations:[];
  const counts={running:0,down:0,maintenance:0,idle:0};
  for(const station of list){
    const value=current.status==="stopped"?"idle":(current.stationStates[station.id]||"running");
    counts[value]=(counts[value]||0)+1;
  }
  const assignedStations=Object.keys(current.assignments).filter(id=>Boolean(current.assignments[id])).length;
  return {status:current.status,totalStations:list.length,stationCounts:counts,
    runningStations:current.status==="stopped"?0:counts.running,
    downStations:counts.down,maintenanceStations:counts.maintenance,idleStations:counts.idle,
    assignedStations,unassignedStations:Math.max(0,list.length-assignedStations),
    historyCount:current.history.length};
}
