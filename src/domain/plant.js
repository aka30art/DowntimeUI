export function createPlantState(){
  return {plantOn:true,plantChangedAt:null,stationAssignments:{},stationStatus:{},transitions:[]};
}
function normalize(state){
  const base=createPlantState();
  if(!state||typeof state!=="object")return base;
  return {
    ...base,...state,
    stationAssignments:state.stationAssignments&&typeof state.stationAssignments==="object"?{...state.stationAssignments}:{},
    stationStatus:state.stationStatus&&typeof state.stationStatus==="object"?{...state.stationStatus}:{},
    transitions:Array.isArray(state.transitions)?state.transitions.slice():[]
  };
}
function transition(state,event){
  const transitions=[...state.transitions,{...event,at:event.at instanceof Date?event.at.toISOString():new Date(event.at||Date.now()).toISOString()}];
  return {...state,transitions};
}
export function assignStationOperator(state,{stationId,staffId,stationIds=[],staffIds=[],at=new Date()}={}){
  const current=normalize(state);
  if(!stationIds.includes(stationId))return {ok:false,code:"STATION_NOT_FOUND",state:current};
  if(staffId&&!staffIds.includes(staffId))return {ok:false,code:"STAFF_NOT_FOUND",state:current};
  if(staffId&&Object.entries(current.stationAssignments).some(([otherStation,personId])=>otherStation!==stationId&&personId===staffId))return {ok:false,code:"OPERATOR_ALREADY_ASSIGNED",message:"This operator is already assigned to another station.",state:current};
  const assignments={...current.stationAssignments};
  const previous=assignments[stationId]||null;
  if(staffId)assignments[stationId]=staffId;else delete assignments[stationId];
  if(previous===(staffId||null))return {ok:true,changed:false,state:current};
  return {ok:true,changed:true,state:transition({...current,stationAssignments:assignments},{
    type:"station-assignment",stationId,from:previous,to:staffId||null,at
  })};
}
export function setPlantStatus(state,plantOn,{at=new Date()}={}){
  const current=normalize(state),next=Boolean(plantOn);
  if(current.plantOn===next)return {ok:true,changed:false,state:current};
  const updated=transition({...current,plantOn:next,plantChangedAt:at instanceof Date?at.toISOString():new Date(at).toISOString()},{
    type:"plant-status",from:current.plantOn,to:next,at
  });
  return {ok:true,changed:true,state:updated};
}
export function setStationStatus(state,{stationId,active,stationIds=[],plantOn,at=new Date()}={}){
  const current=normalize(state);
  if(!stationIds.includes(stationId))return {ok:false,code:"STATION_NOT_FOUND",state:current};
  const isPlantOn=typeof plantOn==="boolean"?plantOn:current.plantOn;
  if(active&&!isPlantOn)return {ok:false,code:"PLANT_OFF",message:"A station cannot be started while the plant is switched off.",state:current};
  const next=active?"running":"stopped",previous=current.stationStatus[stationId]||"running";
  if(previous===next)return {ok:true,changed:false,state:current};
  return {ok:true,changed:true,state:transition({...current,stationStatus:{...current.stationStatus,[stationId]:next}},{
    type:"station-status",stationId,from:previous,to:next,at
  })};
}
export function getStationOperationalState(state,stationId){
  const current=normalize(state);
  if(!current.plantOn)return "suspended";
  return current.stationStatus[stationId]||"running";
}
export function getPlantSummary(state,stations=[]){
  const current=normalize(state),list=Array.isArray(stations)?stations:[];
  const stationCounts=list.reduce((result,item)=>{
    const value=getStationOperationalState(current,item.id);
    result[value]=(result[value]||0)+1;
    return result;
  },{running:0,stopped:0,suspended:0});
  const assignedStationIds=Object.keys(current.stationAssignments).filter(id=>Boolean(current.stationAssignments[id]));
  return {
    plantOn:current.plantOn,totalStations:list.length,
    runningStations:stationCounts.running,stoppedStations:stationCounts.stopped,
    suspendedStations:stationCounts.suspended,assignedStations:assignedStationIds.length,
    unassignedStations:Math.max(0,list.length-assignedStationIds.length),
    transitions:current.transitions.length
  };
}
