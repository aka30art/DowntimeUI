(()=>{
  'use strict';
  const API=window.REPAIR_MAINTENANCE_API||'https://ygwfipksbbprqynvbklk.supabase.co/functions/v1/repair-maintenance-api';
  const KEY=window.DOWNTIME_CENTRAL_API_KEY||'';
  const $=id=>document.getElementById(id);
  async function checkAccess(){
    const session=window.DowntimeCentral?.session;
    if(!session?.token)throw new Error('Your YARD HUB session has expired. Sign in again.');
    const response=await fetch(API,{method:'POST',headers:{'Content-Type':'application/json','apikey':KEY,'x-downtime-session':session.token},body:JSON.stringify({action:'access'})});
    let data={};try{data=await response.json()}catch{}
    if(!response.ok)throw new Error(data.error||'R&M access is not enabled for this account.');
    if(data.permissions?.canAccessYardHub!==true||data.permissions?.canAccessRepairMaintenance!==true)throw new Error('R&M access is not enabled for this account.');
    return data;
  }
  function applyAccess(allowed,message=''){
    const button=$('launchRepairMaintenanceBtn'),status=$('yardRepairStatus');
    if(button){button.disabled=!allowed;button.classList.toggle('yard-tile-locked',!allowed);button.classList.toggle('yard-tile-active',allowed)}
    if(status)status.textContent=allowed?'LIVE MODULE':(message?'ACCESS RESTRICTED':'CHECKING ACCESS');
  }
  async function refreshAccess(){
    applyAccess(false,'');
    try{await checkAccess();applyAccess(true)}
    catch(error){applyAccess(false,error.message)}
  }
  async function openRM(){
    const button=$('launchRepairMaintenanceBtn'),status=$('yardRepairStatus');
    if(button?.dataset.busy==='true')return;
    if(button){button.dataset.busy='true';button.disabled=true}
    if(status)status.textContent='CHECKING ACCESS…';
    try{await checkAccess();window.location.assign('repair-maintenance.html')}
    catch(error){applyAccess(false,error.message);window.alert(error.message||'Unable to open R&M.')}
    finally{if(button)button.dataset.busy='false'}
  }
  document.addEventListener('DOMContentLoaded',()=>{
    const button=$('launchRepairMaintenanceBtn');
    if(button){button.addEventListener('click',openRM);button.disabled=true}
    window.addEventListener('yard-hub:shown',refreshAccess);
    const hub=$('yardHub');if(hub&&!hub.hidden)refreshAccess();
  });
})();
