export function validateTaskTemplates(templates){
  const errors=[];
  if(!Array.isArray(templates))return ["Daily task templates must be a list."];
  const ids=new Set(),names=new Set();
  templates.forEach((task,index)=>{
    if(!task||typeof task!=="object"){errors.push("Task "+(index+1)+" must be an object.");return;}
    if(typeof task.id!=="string"||!task.id.trim())errors.push("Task "+(index+1)+" needs a stable ID.");
    else if(ids.has(task.id))errors.push("Task IDs must be unique.");else ids.add(task.id);
    const name=typeof task.name==="string"?task.name.trim():"";
    if(!name)errors.push("Task "+(index+1)+" needs a name.");
    const key=name.toLocaleLowerCase();
    if(name&&names.has(key))errors.push("Task names must be unique: "+name+".");
    if(name)names.add(key);
    if(name.length>100)errors.push("Task names must be 100 characters or fewer.");
  });
  return errors;
}
export function createDailyTaskState(){
  return {snapshot:null,completedTaskIds:[],lockedAt:null,lockedBy:null};
}
export function visibleDailyTasks(dayState,templates=[]){
  if(dayState?.snapshot&&Array.isArray(dayState.snapshot))return dayState.snapshot.map(x=>({...x}));
  return (Array.isArray(templates)?templates:[]).map(x=>({id:x.id,name:x.name}));
}
export function setTaskCompletion(dayState,taskId,completed){
  const current=dayState&&typeof dayState==="object"?dayState:createDailyTaskState();
  if(current.lockedAt)return {ok:false,code:"DAY_LOCKED",message:"Daily tasks are saved and locked for this day.",state:current};
  const tasks=visibleDailyTasks(current,[]);
  if(!tasks.some(x=>x.id===taskId))return {ok:false,code:"TASK_NOT_FOUND",message:"Task is not part of this day's checklist.",state:current};
  const done=new Set(Array.isArray(current.completedTaskIds)?current.completedTaskIds:[]);
  if(completed)done.add(taskId);else done.delete(taskId);
  return {ok:true,state:{...current,completedTaskIds:[...done]}};
}
export function saveAndLockDailyTasks(dayState,templates=[],{actorId=null,now=new Date()}={}){
  const current=dayState&&typeof dayState==="object"?dayState:createDailyTaskState();
  if(current.lockedAt)return {ok:true,alreadyLocked:true,state:current};
  const errors=validateTaskTemplates(templates);
  if(errors.length)return {ok:false,errors,state:current};
  if(!templates.length)return {ok:false,errors:["Add at least one daily task before saving and locking."],state:current};
  const snapshot=templates.map(task=>({id:task.id,name:task.name.trim()}));
  const allowed=new Set(snapshot.map(x=>x.id));
  const timestamp=now instanceof Date?now.toISOString():new Date(now).toISOString();
  return {ok:true,alreadyLocked:false,state:{
    ...current,snapshot,completedTaskIds:(Array.isArray(current.completedTaskIds)?current.completedTaskIds:[]).filter(id=>allowed.has(id)),
    lockedAt:timestamp,lockedBy:actorId
  }};
}
export function completedTaskCount(dayState){
  const tasks=visibleDailyTasks(dayState,[]),done=new Set(dayState?.completedTaskIds||[]);
  return tasks.filter(task=>done.has(task.id)).length;
}
