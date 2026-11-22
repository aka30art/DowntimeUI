/** Remove only DOWNTIMEUI-owned browser storage and roll back if removal fails. */
export function factoryResetStorage(storage=globalThis.localStorage,{prefix="downtimeui:"}={}){
  if(!storage)return {ok:false,removedKeys:0,error:"Local browser storage is unavailable."};
  let snapshot=[];
  try{
    for(let i=0;i<storage.length;i++){
      const key=storage.key(i);
      if(typeof key==="string"&&key.startsWith(prefix))snapshot.push([key,storage.getItem(key)]);
    }
    for(const [key] of snapshot)storage.removeItem(key);
    return {ok:true,removedKeys:snapshot.length};
  }catch(error){
    try{for(const [key,value] of snapshot)storage.setItem(key,value);}catch{/* rollback is best-effort */}
    return {ok:false,removedKeys:0,error:error?.message||"Storage reset failed."};
  }
}
