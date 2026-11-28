(()=> {
  'use strict';
  async function loadPublishedCategories(){
    const endpoint=String(window.CENTRAL_CONFIG_ADMIN_API||'').trim();
    const token=window.DowntimeCentral?.session?.token;
    if(!endpoint||!token)return;
    try{
      const response=await fetch(endpoint,{
        method:'POST',
        headers:{
          'Content-Type':'application/json',
          'apikey':String(window.DOWNTIME_CENTRAL_API_KEY||'').trim(),
          'x-downtime-session':token
        },
        body:JSON.stringify({action:'yard-hub-menu'})
      });
      let result={};try{result=await response.json()}catch{}
      if(!response.ok)throw new Error(result.error||'Published machinery category configuration is unavailable.');
      const categories=result.repairMaintenanceCategories?.categories;
      if(!Array.isArray(categories)||!categories.length)return;
      window.dispatchEvent(new CustomEvent('yard-hub:application-structure',{detail:{repairMaintenanceCategories:result.repairMaintenanceCategories,publishedVersion:Number(result.publishedVersion)||0}}));
    }catch(error){
      console.warn('R&M is using its built-in machinery category labels because the published structure could not be loaded.',error);
    }
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',loadPublishedCategories,{once:true});
  else loadPublishedCategories();
})();
