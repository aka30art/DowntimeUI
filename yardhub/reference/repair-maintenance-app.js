(()=>{
  'use strict';
  const API=window.REPAIR_MAINTENANCE_API||'https://ygwfipksbbprqynvbklk.supabase.co/functions/v1/repair-maintenance-api';
  const API_KEY=window.DOWNTIME_CENTRAL_API_KEY||'';
  const MACHINES=[
    {key:'KIVERCO_PICKING_LINE',label:'KIVERCO \u2013 PICKING LINE',sub:'CONVEYOR & SORTING SYSTEM',icon:'assets/rm-icons/kiverco.svg'},
    {key:'TANNA_SHREDDER',label:'TANNA \u2013 SHREDDER',sub:'SHREDDING EQUIPMENT',icon:'assets/rm-icons/tanna.svg'},
    {key:'FORKLIFT',label:'FORKLIFT',sub:'FORKLIFT FLEET',icon:'assets/rm-icons/forklift.svg'},
    {key:'TELEHANDLER',label:'TELEHANDLER',sub:'TELEHANDLER FLEET',icon:'assets/rm-icons/telehandler.svg'},
    {key:'EXCAVATORS_360',label:'360 EXCAVATORS',sub:'EXCAVATOR FLEET',icon:'assets/rm-icons/excavators_360.svg'},
    {key:'OTHER_EQUIPMENT',label:'OTHER EQUIPMENT',sub:'ADDITIONAL MACHINERY',icon:'assets/rm-icons/other_equipment.svg'}
  ];
  const PRIORITIES=['HIGH','MEDIUM','LOW'];
  const STATUSES=['OPEN','PERM. FIX'];
  const $=id=>document.getElementById(id);
  let access=null,currentMachine=null,currentAsset=null,currentFault=null,allEquipmentMode=false,faults=[],machinePresets=[],machineModels=[],machineSettings={model_dropdown_enabled:true,asset_selector_enabled:true,registration_enabled:true},modelDropdownDraft=true,assetSelectorDraft=true,registrationDraft=true,assets=[],settingsAssets=[],settingsSelectedAssetId='',unassignedCount=0,unassignedMode=false,editingAssetId=null,editingAssetRecord=null,assetEditorFromSettings=false,assetEditorDashboardVisible=false,busy=false,exportOffset=0,exportsLoading=false;
  const sessionToken=()=>window.DowntimeCentral?.session?.token||'';
  const headers=()=>({'Content-Type':'application/json','apikey':API_KEY,'x-downtime-session':sessionToken()});
  async function api(action,body={},timeoutMs=15000){
    if(!sessionToken())throw new Error('Your YARD HUB session has expired. Return to YARD HUB and sign in again.');
    const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),timeoutMs);let response;try{response=await fetch(API,{method:'POST',headers:headers(),body:JSON.stringify({action,...body}),signal:controller.signal})}catch(error){if(error.name==='AbortError')throw new Error('R&M request timed out after '+Math.ceil(timeoutMs/1000)+' seconds. Check your connection and retry.');throw new Error('Session verification could not reach the R&M service. Check your connection and retry.')}finally{clearTimeout(timeout)}
    let data={};try{data=await response.json()}catch{}
    if(!response.ok)throw new Error(data.error||`R&M request failed (${response.status}).`);
    return data;
  }
  function say(message,target='dashboardStatus',kind=''){
    const el=$(target);if(!el)return;el.hidden=false;el.textContent=message;el.className='statusbar'+(kind?' '+kind:'');
  }
  function clearStatus(target){const el=$(target);if(!el)return;el.textContent='';el.className='statusbar';el.hidden=true;}
  function safe(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function machine(key){return MACHINES.find(m=>m.key===key)||MACHINES[0]}
  function openCustomCategory(category){
    $('customCategoryTitle').textContent=category.label||'MACHINERY CATEGORY';
    $('customCategoryDescription').textContent=category.sub||'CUSTOM R&M CATEGORY';
    $('customCategoryStatus').textContent='“'+(category.label||'This category')+'” is registered in the application structure, but it does not yet have a dedicated machine data type or operational workflow. Existing machine records, reports and permissions remain unchanged.';
    setView('customCategoryView');
  }
  function applyMachineCategoryConfig(categories){
    if(!Array.isArray(categories)||!categories.length)return;
    const existing=new Map(MACHINES.map(item=>[item.key,item]));
    const ordered=categories.slice().sort((a,b)=>Number(a.order)-Number(b.order));
    const next=ordered.map(category=>{
      const item=existing.get(category.key)||{key:category.key,icon:category.icon||'assets/rm-icons/other_equipment.svg'};
      item.label=category.label;item.sub=category.sub||'';item.icon=category.icon||item.icon;item.enabled=category.enabled!==false;item.kind=category.kind||'native';item.order=Number(category.order)||0;
      return item;
    });
    MACHINES.splice(0,MACHINES.length,...next);
    const grid=$('machineGrid');
    if(grid){
      grid.querySelectorAll('[data-custom-category="true"]').forEach(button=>button.remove());
      const nativeButtons=new Map(Array.from(grid.querySelectorAll('.machine-card[data-machine]:not([data-custom-category])')).map(button=>[button.dataset.machine,button]));
      ordered.forEach(category=>{
        let button;
        if(category.kind==='custom'){
          button=document.createElement('button');button.type='button';button.className='machine-card';button.dataset.machine=category.key;button.dataset.customCategory='true';
          const art=document.createElement('span');art.className='machine-art';const icon=document.createElement('span');icon.className='rm-custom-category-icon';icon.textContent=String(category.label||'').trim().split(/\\s+/).map(part=>part[0]||'').join('').slice(0,2).toUpperCase();art.append(icon);
          const copy=document.createElement('span');copy.className='machine-copy';const title=document.createElement('strong');title.textContent=category.label;const description=document.createElement('small');description.textContent=category.sub||'CUSTOM MACHINERY CATEGORY';const open=document.createElement('span');open.className='machine-open';open.textContent='OPEN WORKSPACE →';copy.append(title,description,open);button.append(art,copy);
          button.addEventListener('click',()=>openCustomCategory(category));
        }else button=nativeButtons.get(category.key);
        if(!button)return;
        button.hidden=category.enabled===false;
        const title=button.querySelector('strong'),description=button.querySelector('small');
        if(title)title.textContent=category.label;if(description)description.textContent=category.sub||'';
        grid.append(button);
      });
      nativeButtons.forEach((button,key)=>{if(!ordered.some(category=>category.key===key))button.hidden=true});
    }
    const settingsGrid=$('settingsMachineGrid');
    if(settingsGrid){
      const buttons=new Map(Array.from(settingsGrid.querySelectorAll('.machine-card[data-settings-machine]')).map(button=>[button.dataset.settingsMachine,button]));
      ordered.filter(category=>category.kind!=='custom').forEach(category=>{
        const button=buttons.get(category.key);if(!button)return;
        button.hidden=category.enabled===false;
        const title=button.querySelector('strong'),description=button.querySelector('small');
        if(title)title.textContent=category.label;if(description)description.textContent=category.sub||'';
        settingsGrid.append(button);
      });
    }
    ['reportMachineType','pdfExportsMachineType'].forEach(id=>{
      const select=$(id);if(!select)return;
      ordered.filter(category=>category.kind!=='custom').forEach(category=>{
        const option=Array.from(select.options).find(item=>item.value===category.key);if(!option)return;
        option.textContent=category.label;option.hidden=category.enabled===false;select.append(option);
      });
    });
  }
  function priorityClass(value){return String(value||'LOW').toLowerCase()}
  function setView(id){['selectorView','settingsView','dashboardView','customCategoryView'].forEach(view=>$(view).hidden=view!==id);}
  function showOverlay(id){$(id)?.classList.add('open');document.body.style.overflow='hidden'}
  function closeOverlay(id){$(id)?.classList.remove('open');if(!document.querySelector('.overlay.open'))document.body.style.overflow=''}
  function setBusy(value){busy=value;document.querySelectorAll('button').forEach(b=>{if(b.dataset.busyControl==='true')b.disabled=value})}
  function renderSelector(){setView('selectorView');$('selectorStatus').textContent='Select a machinery category to view its fault register.';}
  function canOpenMachineryConfiguration(){return access?.canReadRepairMaintenanceMachinery===true||access?.canAddRepairMaintenanceMachinery===true||access?.canEditRepairMaintenance===true||access?.canManageRepairMaintenanceMachinery===true||access?.canManageRepairMaintenancePresets===true;}
  function canManageRmsPresets(){return access?.canManageRepairMaintenancePresets===true;}
  function renderSettingsSelector(){if(!canOpenMachineryConfiguration()){say('R&M MACHINERY EDIT or R&M SETTINGS permission is required to manage configuration.','selectorStatus','error');return}setView('settingsView');$('settingsStatus').textContent='Select a machinery category to configure its R&M settings.';}
  async function openMachineSettings(key){
    if(!canOpenMachineryConfiguration()){say('R&M MACHINERY EDIT or R&M SETTINGS permission is required to manage machine settings.','settingsStatus','error');return}
    currentMachine=machine(key);machinePresets=[];machineModels=[];
    settingsSelectedAssetId=currentMachine.key===currentAsset?.machine_type?currentAsset.id:'';
    $('presetMachineTitle').textContent=currentMachine.label;
    setRmsSettingsTab('machinery');
    clearStatus('machineSettingsModalStatus');
    try{
      await Promise.all([refreshMachinePresets(),refreshMachineConfiguration()]);
      $('presetMachineTitle').textContent=currentMachine.label;
      showOverlay('presetsOverlay');
      say(currentMachine.label+' settings loaded.',machineSettingsStatusTarget(),'ok');
    }catch(error){say(error.message,'settingsStatus','error')}
  }
  function setRmsSettingsTab(tab='machinery'){
    const selected=tab==='area-parts'&&canManageRmsPresets()?'area-parts':'machinery';
    const areaPartsTab=$('rmsTabAreaParts');if(areaPartsTab)areaPartsTab.hidden=!canManageRmsPresets();
    document.querySelectorAll('[data-rms-tab]').forEach(button=>{
      const active=button.dataset.rmsTab===selected;
      button.classList.toggle('active',active);
      button.setAttribute('aria-selected',active?'true':'false');
      button.tabIndex=active?0:-1;
    });
    document.querySelectorAll('[data-rms-panel]').forEach(panel=>{panel.hidden=panel.dataset.rmsPanel!==selected});
  }
  function machineSettingsStatusTarget(){
    if($('presetsOverlay')?.classList.contains('open'))return 'machineSettingsModalStatus';
    return $('settingsView')&&!$('settingsView').hidden?'settingsStatus':'dashboardStatus';
  }
  function renderStats(){
    $('totalCount').textContent=faults.length;
    $('highCount').textContent=faults.filter(f=>f.priority==='HIGH').length;
    $('mediumCount').textContent=faults.filter(f=>f.priority==='MEDIUM').length;
    $('lowCount').textContent=faults.filter(f=>f.priority==='LOW').length;
  }
  function orderedFaults(){
    const list=[...faults],mode=$('sortSelect').value;
    const timestamp=fault=>{const value=Date.parse(fault.created_at||'');return Number.isFinite(value)?value:0};
    const newestFirst=(a,b)=>timestamp(b)-timestamp(a);
    if(mode==='priority')list.sort((a,b)=>PRIORITIES.indexOf(a.priority)-PRIORITIES.indexOf(b.priority)||newestFirst(a,b));
    else if(mode==='newest')list.sort(newestFirst);
    else if(mode==='oldest')list.sort((a,b)=>timestamp(a)-timestamp(b));
    return list;
  }
  function renderRows(){
    renderStats();const host=$('faultRows');host.replaceChildren();const list=orderedFaults();
    if(!list.length){const empty=document.createElement('div');empty.className='empty';empty.textContent='No faults or defects are currently recorded for this machine.';host.append(empty);return}
    list.forEach((fault,index)=>{
      const row=document.createElement('button');row.type='button';row.className='faultrow';row.setAttribute('aria-label',`Open fault ${fault.fault_name}, priority ${fault.priority}`);
      const equipmentName=fault.equipment_name||assets.find(asset=>asset.id===fault.asset_id)?.name||(unassignedMode?'UNASSIGNED / LEGACY':currentAsset?.name||currentMachine?.label)||'—';
      row.innerHTML=`<span class="fault-card-top"><span class="rownum">${String(index+1).padStart(2,'0')}</span><span class="equipment-name">${safe(equipmentName)}</span><span class="priority-pill ${priorityClass(fault.priority)}">${safe(fault.priority)}</span></span><span class="fault-card-body"><span class="faultname">${safe(fault.fault_name)}</span><span class="description">${safe(fault.description)}</span></span>`;
      row.addEventListener('click',()=>openDetails(fault.id,index+1));host.append(row);
    });
  }
  function renderPresetSelect(){
    const select=$('newFaultName');if(!select)return;
    select.replaceChildren();
    const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent='SELECT AREA / PART';placeholder.disabled=true;placeholder.selected=true;select.appendChild(placeholder);
    machinePresets.forEach(preset=>{const option=document.createElement('option');option.value=preset.id;option.textContent=preset.name;option.dataset.other=preset.is_other?'true':'false';select.appendChild(option)});
    setOtherAreaVisibility();
  }
  function selectedPreset(){return machinePresets.find(preset=>preset.id===$('newFaultName')?.value)||null}
  function setOtherAreaVisibility(){
    const other=selectedPreset()?.is_other===true,field=$('newFaultOtherField'),input=$('newFaultOther');
    if(field)field.hidden=!other;
    if(input){input.required=other;input.disabled=!other;if(!other)input.value=''}
  }
  async function refreshMachinePresets(){
    if(!currentMachine)return;
    const result=await api('preset-list',{machineType:currentMachine.key});
    machinePresets=Array.isArray(result.presets)?result.presets:[];
    renderPresetSelect();renderPresetManager();
  }
  async function refreshMachineConfiguration(){
    if(!currentMachine)return;
    const assetRequest=access?.canReadRepairMaintenanceMachinery===true
      ?api('asset-list',{machineType:currentMachine.key})
      :Promise.resolve({assets:[]});
    const [settingsResult,modelsResult,assetResult]=await Promise.all([
      api('settings-get',{machineType:currentMachine.key}),
      api('model-list',{machineType:currentMachine.key}),
      assetRequest
    ]);
    machineSettings=settingsResult.settings||{model_dropdown_enabled:true,asset_selector_enabled:true,registration_enabled:true};
    modelDropdownDraft=machineSettings.model_dropdown_enabled===true;
    assetSelectorDraft=machineSettings.asset_selector_enabled===true;
    registrationDraft=machineSettings.registration_enabled!==false;
    renderAssetSelect();
    machineModels=Array.isArray(modelsResult.models)?modelsResult.models:[];
    settingsAssets=Array.isArray(assetResult.assets)?assetResult.assets:[];
    const currentId=currentMachine.key===currentAsset?.machine_type?currentAsset.id:'';
    if(!settingsAssets.some(asset=>asset.id===settingsSelectedAssetId)){
      settingsSelectedAssetId=currentId&&settingsAssets.some(asset=>asset.id===currentId)?currentId:'';
    }
    const toggle=$('modelDropdownEnabled'),save=$('saveModelDropdownSettings');
    if(toggle)toggle.checked=modelDropdownDraft;
    if(save)save.disabled=true;
    const assetToggle=$('assetSelectorEnabled'),assetSave=$('saveAssetSelectorSettings');
    if(assetToggle)assetToggle.checked=assetSelectorDraft;
    if(assetSave)assetSave.disabled=true;
    const registrationToggle=$('registrationEnabled'),registrationSave=$('saveRegistrationSettings');
    if(registrationToggle)registrationToggle.checked=registrationDraft;
    if(registrationSave)registrationSave.disabled=true;
    renderMachineModelManager();
    renderSettingsAssetManager();
  }
  function renderSettingsAssetManager(){
    const section=$('settingsMachinerySection');
    if(!section)return;
    const canRead=access?.canReadRepairMaintenanceMachinery===true;
    const canEdit=access?.canEditRepairMaintenance===true;
    const canManage=access?.canDeleteRepairMaintenance===true;
    const canAdd=access?.canAddRepairMaintenanceMachinery===true;
    section.hidden=!(canRead||canAdd||canEdit||canManage);
    const add=$('settingsAddMachineryButton');
    if(add)add.hidden=!canAdd;
    ['settingsRegistrationSection','settingsModelDropdownSection','settingsAssetSelectorSection'].forEach(id=>{const option=$(id);if(option)option.hidden=!canManageRmsPresets();});
    const areaPartsTab=$('rmsTabAreaParts');if(areaPartsTab)areaPartsTab.hidden=!canManageRmsPresets();
  }
  function updateRegistrationSaveState(){
    const save=$('saveRegistrationSettings');
    if(save)save.disabled=registrationDraft===(machineSettings.registration_enabled!==false);
  }
  function handleRegistrationDraftChange(){
    if(access?.canManageRepairMaintenancePresets!==true)return;
    registrationDraft=$('registrationEnabled').checked;
    updateRegistrationSaveState();
    clearStatus('machineSettingsModalStatus');
  }
  async function saveRegistrationSetting(){
    if(!currentMachine||access?.canManageRepairMaintenancePresets!==true)return;
    const button=$('saveRegistrationSettings');
    if(!button||registrationDraft===(machineSettings.registration_enabled!==false))return;
    button.disabled=true;button.textContent='SAVING…';
    try{
      const result=await api('settings-update',{machineType:currentMachine.key,registrationEnabled:registrationDraft});
      machineSettings=result.settings||{...machineSettings,registration_enabled:registrationDraft};
      registrationDraft=machineSettings.registration_enabled!==false;
      $('registrationEnabled').checked=registrationDraft;
      updateRegistrationSaveState();
      say(registrationDraft?'Fleet Number / Registration field enabled for this category.':'Fleet Number / Registration field hidden for this category. Existing values are preserved.',machineSettingsStatusTarget(),'ok');
    }catch(error){updateRegistrationSaveState();say(error.message,machineSettingsStatusTarget(),'error')}
    finally{button.textContent='SAVE SETTINGS';updateRegistrationSaveState()}
  }
  function updateModelDropdownSaveState(){
    const save=$('saveModelDropdownSettings');
    if(save)save.disabled=modelDropdownDraft=== (machineSettings.model_dropdown_enabled===true);
  }
  function updateAssetSelectorVisibility(){
    const host=$('machineAssetControls');
    if(host)host.hidden=access?.canReadRepairMaintenanceMachinery!==true||machineSettings.asset_selector_enabled!==true;
  }
  function updateAssetSelectorSaveState(){
    const save=$('saveAssetSelectorSettings');
    if(save)save.disabled=assetSelectorDraft===(machineSettings.asset_selector_enabled===true);
  }
  async function saveAssetSelectorSetting(){
    if(!currentMachine||access?.canManageRepairMaintenancePresets!==true)return;
    const button=$('saveAssetSelectorSettings');
    if(!button||assetSelectorDraft===(machineSettings.asset_selector_enabled===true))return;
    button.disabled=true;button.textContent='SAVING…';
    try{
      const result=await api('settings-update',{machineType:currentMachine.key,assetSelectorEnabled:assetSelectorDraft});
      machineSettings=result.settings||{...machineSettings,asset_selector_enabled:assetSelectorDraft};
      assetSelectorDraft=machineSettings.asset_selector_enabled===true;
      $('assetSelectorEnabled').checked=assetSelectorDraft;
      updateAssetSelectorVisibility();
      renderAssetSelect();
      updateAssetSelectorSaveState();
      const activeCount=assets.filter(asset=>asset.status==='ACTIVE').length;
      if(!assetSelectorDraft&&!currentAsset&&activeCount>1){
        setRegisterMessage('The registered-machine menu is disabled in R&M settings. Enable it to choose an individual machine and open its fault register.');
      }else if(assetSelectorDraft&&!currentAsset&&activeCount>1){
        setRegisterMessage('Select a registered machine from the dropdown to view its own fault register.');
      }
      say(assetSelectorDraft?'Registered-machine menu saved: ENABLED. The dashboard selector is visible.':'Registered-machine menu saved: DISABLED. The dashboard selector is hidden.',machineSettingsStatusTarget(),'ok');
    }catch(error){
      updateAssetSelectorSaveState();
      say(error.message,machineSettingsStatusTarget(),'error');
    }finally{
      button.textContent='SAVE SETTINGS';
      updateAssetSelectorSaveState();
    }
  }
  async function saveModelDropdownSetting(){
    if(!currentMachine||access?.canManageRepairMaintenancePresets!==true)return;
    const button=$('saveModelDropdownSettings');
    if(!button||modelDropdownDraft===(machineSettings.model_dropdown_enabled===true))return;
    button.disabled=true;button.textContent='SAVING…';
    try{
      const result=await api('settings-update',{machineType:currentMachine.key,modelDropdownEnabled:modelDropdownDraft});
      machineSettings=result.settings||{...machineSettings,model_dropdown_enabled:modelDropdownDraft};
      modelDropdownDraft=machineSettings.model_dropdown_enabled===true;
      $('modelDropdownEnabled').checked=modelDropdownDraft;
      renderAssetSelect();
      updateModelDropdownSaveState();
      say(modelDropdownDraft?'Individual machinery scroll-down menu ENABLED for this category.':'Individual machinery scroll-down menu DISABLED for this category; the menu is hidden.',machineSettingsStatusTarget(),'ok');
    }catch(error){
      updateModelDropdownSaveState();
      say(error.message,machineSettingsStatusTarget(),'error');
    }finally{
      button.textContent='SAVE SETTINGS';
      updateModelDropdownSaveState();
    }
  }
  function renderMachineModelManager(){
    const host=$('machineModelItems');if(!host)return;host.replaceChildren();
    const canRead=access?.canReadRepairMaintenanceMachinery===true;
    const canEdit=access?.canEditRepairMaintenance===true;
    const canManage=access?.canDeleteRepairMaintenance===true;
    if(canRead)settingsAssets.filter(asset=>asset.status==='ACTIVE').forEach(asset=>{
      const row=document.createElement('div');row.className='rms-unified-asset-row';
      const copy=document.createElement('div');copy.className='rms-unified-asset-copy';
      const name=document.createElement('strong');name.textContent=asset.make_model||asset.name||'UNNAMED MACHINE';copy.appendChild(name);
      const meta=document.createElement('small');meta.textContent=[asset.asset_code,asset.make_model].filter(Boolean).join(' · ')||'REGISTERED MACHINE';copy.appendChild(meta);row.appendChild(copy);
      if(canEdit){
        const edit=document.createElement('button');edit.type='button';edit.className='btn compact';edit.textContent='EDIT';edit.addEventListener('click',()=>openAssetEditor(asset));row.appendChild(edit);
      }
      if(canManage){
        const remove=document.createElement('button');remove.type='button';remove.className='btn danger compact';remove.textContent='DELETE';remove.setAttribute('aria-label','Delete '+(asset.make_model||asset.name||'machine'));remove.addEventListener('click',()=>deleteRegisteredMachine(asset));row.appendChild(remove);
      }
      host.appendChild(row);
    });
    if(!host.children.length){const empty=document.createElement('p');empty.className='empty';empty.textContent='No registered machines have been added for this category yet.';host.appendChild(empty)}
  }
  async function deleteRegisteredMachine(asset){
    if(!currentMachine||!asset||access?.canDeleteRepairMaintenance!==true)return;
    const name=asset.make_model||asset.name||'this machine';
    if(!window.confirm('Permanently delete “'+name+'” from '+currentMachine.label+'? This is only allowed when the machine has no linked fault history. Machines with history must be archived instead.'))return;
    try{
      await api('asset-delete',{machineType:currentMachine.key,assetId:asset.id});
      if(settingsSelectedAssetId===asset.id)settingsSelectedAssetId='';
      await refreshMachineConfiguration();
      if($('dashboardView')&&!$('dashboardView').hidden)await syncDashboardAssetsAfterSettings(currentAsset?.id===asset.id?'':currentAsset?.id||'');
      say('Machine permanently deleted from the register.','machineSettingsModalStatus','ok');
    }catch(error){
      const message=error.message.includes('linked fault history')
        ?error.message+' Open EDIT for this machine and choose ARCHIVE MACHINE to retain its history.'
        :error.message;
      say(message,machineSettingsStatusTarget(),'error');
    }
  }
  function renderAssetModelField(value=''){
    const manualField=$('assetMakeModelManualField'),selectField=$('assetMakeModelSelectField');
    const customField=$('assetMakeModelOtherField'),select=$('assetMakeModelSelect'),manual=$('assetMakeModel');
    if(!manualField||!selectField||!customField||!select||!manual)return;
    if(machineSettings.model_dropdown_enabled===true){
      manualField.hidden=true;selectField.hidden=false;
      select.replaceChildren();
      const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent='SELECT MAKE / MODEL';select.appendChild(placeholder);
      machineModels.forEach(model=>{const option=document.createElement('option');option.value=model.name;option.textContent=model.name;select.appendChild(option)});
      const other=document.createElement('option');other.value='__CUSTOM__';other.textContent='OTHER — ENTER MANUALLY';select.appendChild(other);
      if(value&&machineModels.some(model=>model.name===value)){select.value=value;customField.hidden=true;$('assetMakeModelOther').value=''}
      else if(value){select.value='__CUSTOM__';customField.hidden=false;$('assetMakeModelOther').value=value}
      else{select.value='';customField.hidden=true;$('assetMakeModelOther').value=''}
    }else{
      manualField.hidden=false;selectField.hidden=true;customField.hidden=true;
      manual.value=value||'';select.value='';
    }
  }
  function selectedAssetMakeModel(){
    if(machineSettings.model_dropdown_enabled!==true)return $('assetMakeModel').value.trim();
    const selected=$('assetMakeModelSelect').value;
    return selected==='__CUSTOM__' ? $('assetMakeModelOther').value.trim() : selected;
  }
  function handleModelDropdownDraftChange(){
    if(access?.canManageRepairMaintenancePresets!==true)return;
    modelDropdownDraft=$('modelDropdownEnabled').checked;
    updateModelDropdownSaveState();
    clearStatus('machineSettingsModalStatus');
  }
  function handleAssetSelectorDraftChange(){
    if(access?.canManageRepairMaintenancePresets!==true)return;
    assetSelectorDraft=$('assetSelectorEnabled').checked;
    updateAssetSelectorSaveState();
    clearStatus('machineSettingsModalStatus');
  }
  async function addMachineModel(event){
    event.preventDefault();if(!currentMachine||access?.canAddRepairMaintenanceMachinery!==true)return;
    const name=$('newModelName').value.trim();if(!name)return;
    const button=$('addModelSave');button.disabled=true;button.textContent='SAVING…';
    try{const result=await api('model-add',{machineType:currentMachine.key,name});$('newModelName').value='';await refreshMachineConfiguration();await syncDashboardAssetsAfterSettings(result.asset?.id||'');say('Registered machine added to this category and is immediately selectable.',machineSettingsStatusTarget(),'ok')}
    catch(error){say(error.message,machineSettingsStatusTarget(),'error')}
    finally{button.disabled=false;button.textContent='ADD MACHINE'}
  }
  async function removeMachineModel(model){
    if(!currentMachine||!model)return;
    if(!window.confirm('Archive “'+model.name+'” from '+currentMachine.label+'? Its fault history will be preserved.'))return;
    try{await api('model-delete',{machineType:currentMachine.key,modelId:model.id});await refreshMachineConfiguration();say('Registered machine archived. Its fault history and historical records were preserved.',machineSettingsStatusTarget(),'ok')}
    catch(error){say(error.message,machineSettingsStatusTarget(),'error')}
  }
  function setRegisterMessage(message){
    faults=[];renderStats();const host=$('faultRows');host.replaceChildren();
    const empty=document.createElement('div');empty.className='empty';empty.textContent=message;host.appendChild(empty);
  }
  function renderAssetSelect(){
    const select=$('machineAssetSelect');if(!select)return;
    const previous=allEquipmentMode?'__ALL_EQUIPMENT__':currentAsset?.id||select.value;
    select.replaceChildren();
    const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent='SELECT REGISTERED MACHINE';select.appendChild(placeholder);
    if(currentMachine?.key==='OTHER_EQUIPMENT'){
      const all=document.createElement('option');all.value='__ALL_EQUIPMENT__';all.textContent='ALL EQUIPMENT — COMBINED REGISTER';select.appendChild(all);
    }
    assets.forEach(asset=>{
      const option=document.createElement('option');option.value=asset.id;
      option.textContent=[asset.asset_code,asset.name,asset.make_model,asset.status==='ARCHIVED'?'ARCHIVED':null].filter(Boolean).join(' · ');
      select.appendChild(option);
    });
    if(unassignedCount>0){const legacy=document.createElement('option');legacy.value='__UNASSIGNED__';legacy.textContent='UNASSIGNED / LEGACY FAULTS ('+unassignedCount+')';select.appendChild(legacy)}
    updateAssetSelectorVisibility();
    select.value=[...select.options].some(option=>option.value===previous)?previous:'';
  }
  async function syncDashboardAssetsAfterSettings(preferredId=''){
    if(!currentMachine)return;
    const result=await api('asset-list',{machineType:currentMachine.key});
    assets=Array.isArray(result.assets)?result.assets:[];
    unassignedCount=Number(result.unassignedCount)||0;
    renderAssetSelect();
    const target=preferredId&&assets.some(asset=>asset.id===preferredId)?preferredId:
      (currentAsset&&assets.some(asset=>asset.id===currentAsset.id)?currentAsset.id:'');
    if(target){$('machineAssetSelect').value=target;await selectMachineAsset(target)}
    else{
      currentAsset=null;unassignedMode=false;
      const active=assets.filter(asset=>asset.status==='ACTIVE');
      if(currentMachine.key==='OTHER_EQUIPMENT'&&assets.length){$('machineAssetSelect').value='__ALL_EQUIPMENT__';await selectMachineAsset('__ALL_EQUIPMENT__')}
      else if(active.length===1){$('machineAssetSelect').value=active[0].id;await selectMachineAsset(active[0].id)}
      else setRegisterMessage(assets.length?(machineSettings.asset_selector_enabled===true?'Select an individual machine from the dropdown to view its own fault register.':'The registered-machine menu is disabled in R&M settings. Enable it to choose a machine and view its fault register.'):'No machines are registered in this category yet.');
      applyPermissions();
    }
  }
  async function loadMachine(key){
    currentMachine=machine(key);currentAsset=null;unassignedMode=false;allEquipmentMode=false;assets=[];unassignedCount=0;machinePresets=[];machineSettings={model_dropdown_enabled:true,asset_selector_enabled:true,registration_enabled:true};modelDropdownDraft=true;assetSelectorDraft=true;registrationDraft=true;
    setView('dashboardView');
    const icon=$('machineIcon');if(icon)icon.src=currentMachine.icon;
    $('machineCategoryLabel').textContent=currentMachine.sub;
    $('machineTitle').textContent='SELECT A MACHINE';
    $('machineAssetControls').hidden=true;
    $('machineAssetSelect').replaceChildren(new Option('LOADING MACHINERY…',''));
    setRegisterMessage(access?.canReadRepairMaintenanceMachinery===true?'Loading registered machines…':'Your tier does not have READ access to R&M MACHINERY.');
    applyPermissions();
    if(access?.canReadRepairMaintenanceMachinery!==true){say('R&M MACHINERY READ permission is required to select an individual machine.','dashboardStatus','error');return}
    try{
      const [result,settingsResult]=await Promise.all([
        api('asset-list',{machineType:currentMachine.key}),
        api('settings-get',{machineType:currentMachine.key})
      ]);
      machineSettings=settingsResult.settings||{model_dropdown_enabled:true,asset_selector_enabled:true};
      modelDropdownDraft=machineSettings.model_dropdown_enabled===true;
      assetSelectorDraft=machineSettings.asset_selector_enabled===true;
      assets=Array.isArray(result.assets)?result.assets:[];
      unassignedCount=Number(result.unassignedCount)||0;
      renderAssetSelect();
      const active=assets.filter(asset=>asset.status==='ACTIVE');
      if(currentMachine.key==='OTHER_EQUIPMENT'&&assets.length){
        $('machineAssetSelect').value='__ALL_EQUIPMENT__';
        await selectMachineAsset('__ALL_EQUIPMENT__');
      }else if(active.length===1){
        $('machineAssetSelect').value=active[0].id;
        await selectMachineAsset(active[0].id);
      }else if(active.length>1){
        setRegisterMessage(machineSettings.asset_selector_enabled===true?'Select an individual machine from the dropdown to view its own fault register.':'The registered-machine menu is disabled in R&M settings. Enable it to choose an individual machine and open its fault register.');
        say(active.length+' active machines registered in this category.'+(machineSettings.asset_selector_enabled===true?' Select one to continue.':' Menu currently disabled in RMS settings.'),'dashboardStatus','ok');
      }else if(assets.length>0){
        setRegisterMessage(machineSettings.asset_selector_enabled!==true
          ?'The registered-machine menu is disabled in R&M settings. Enable it to select an archived machine and view historical faults.'
          :(unassignedCount>0?'No active machines. Archived machines remain selectable for history; unassigned legacy faults are also available.':'No active machines. Archived machines remain selectable to view their historical fault records.'));
        say('No active machines are registered in this category.','dashboardStatus','ok');
      }else if(unassignedCount>0){
        setRegisterMessage(machineSettings.asset_selector_enabled!==true?'The registered-machine menu is disabled in R&M settings. Enable it to review unassigned legacy fault records.':'No machines are registered yet. Select UNASSIGNED / LEGACY FAULTS to review existing records.');
        say(unassignedCount+' existing fault record(s) are not yet assigned to a machine.','dashboardStatus','ok');
      }else{
        setRegisterMessage('No machines are registered in this category yet. Use R&M settings to register the first machine.');
        say('Machinery register is ready.','dashboardStatus','ok');
      }
      applyPermissions();
    }catch(error){
      assets=[];unassignedCount=0;renderAssetSelect();setRegisterMessage(error.message);say(error.message,'dashboardStatus','error');
    }
  }
  async function selectMachineAsset(value){
    if(!currentMachine||!value)return;
    allEquipmentMode=value==='__ALL_EQUIPMENT__';
    unassignedMode=value==='__UNASSIGNED__';
    currentAsset=(unassignedMode||allEquipmentMode)?null:assets.find(asset=>asset.id===value)||null;
    if(!unassignedMode&&!allEquipmentMode&&!currentAsset){say('The selected machine is no longer available. Refresh the category and try again.','dashboardStatus','error');return}
    $('machineTitle').textContent=allEquipmentMode?'ALL OTHER EQUIPMENT':unassignedMode?'UNASSIGNED / LEGACY FAULTS':currentAsset.name;
    $('machineAssetSelect').value=value;
    const canCreate=(access?.canCreateRepairMaintenance===true||access?.canEditRepairMaintenance===true)&&!unassignedMode&&!allEquipmentMode&&currentAsset?.status==='ACTIVE';
    $('openCreateFault').hidden=!canCreate;
    $('openCreateFault').disabled=!canCreate;
    setRegisterMessage('Loading fault records…');
    try{
      const args=allEquipmentMode?{machineType:currentMachine.key,allEquipment:true}:unassignedMode?{machineType:currentMachine.key,unassigned:true}:{machineType:currentMachine.key,assetId:currentAsset.id};
      const result=await api('list',args);faults=Array.isArray(result.faults)?result.faults:[];renderRows();
      try{if(!allEquipmentMode)await refreshMachinePresets();else renderPresetSelect();say(`${faults.length} fault${faults.length===1?'':'s'} loaded · ${allEquipmentMode?'All registered equipment':unassignedMode?'Legacy records':currentAsset.name} · ${new Date().toLocaleTimeString('en-GB')}`,'dashboardStatus','ok')}
      catch(error){renderPresetSelect();say(`Faults loaded, but machine presets could not be loaded: ${error.message}`,'dashboardStatus','error')}
    }catch(error){faults=[];renderRows();say(error.message,'dashboardStatus','error')}
    applyPermissions();
  }
  async function reloadCurrentRegister(){
    if(!currentMachine)return;
    const selected=allEquipmentMode?'__ALL_EQUIPMENT__':unassignedMode?'__UNASSIGNED__':currentAsset?.id;
    if(selected)return selectMachineAsset(selected);
  }
  async function openAssetEditor(asset=null){
    if((asset&&access?.canManageRepairMaintenanceMachinery!==true)||(!asset&&access?.canAddRepairMaintenanceMachinery!==true&&access?.canManageRepairMaintenanceMachinery!==true)||!currentMachine)return;
    try{
      assetEditorFromSettings=$('presetsOverlay')?.classList.contains('open')===true;
      assetEditorDashboardVisible=!$('dashboardView').hidden;
      editingAssetId=asset?.id||null;editingAssetRecord=asset||null;
      clearStatus('assetStatus');
      $('assetMachineType').textContent=currentMachine.label;
      $('assetCode').value=asset?.asset_code||'';
      $('assetCode').closest('.form-field').hidden=machineSettings.registration_enabled===false;
      renderAssetModelField(asset?.make_model||asset?.name||'');
      $('assetEditorTitle').textContent=asset?'EDIT MACHINERY':'ADD MACHINERY';
      $('assetSaveButton').textContent=asset?'SAVE CHANGES':'ADD MACHINERY';
      $('archiveAssetButton').hidden=!asset||asset.status!=='ACTIVE';
      showOverlay('assetOverlay');
    }catch(error){say(error.message,assetEditorFromSettings?'machineSettingsModalStatus':'dashboardStatus','error')}
  }
  async function saveAsset(event){
    event.preventDefault();if(!currentMachine||(editingAssetId?access?.canManageRepairMaintenanceMachinery!==true:(access?.canAddRepairMaintenanceMachinery!==true&&access?.canManageRepairMaintenanceMachinery!==true)))return;
    const button=$('assetSaveButton');button.disabled=true;button.textContent='SAVING…';
    try{
      const wasEdit=Boolean(editingAssetId),fromSettings=assetEditorFromSettings,dashboardWasVisible=assetEditorDashboardVisible;
      const makeModel=selectedAssetMakeModel();
      if(!makeModel)throw new Error('Make / Model is required.');
      const payload={machineType:currentMachine.key,name:makeModel,assetCode:machineSettings.registration_enabled===false?(editingAssetRecord?.asset_code||''):$('assetCode').value.trim(),makeModel};
      if(wasEdit&&access?.canManageRepairMaintenanceMachinery!==true)throw new Error('INPUT access allows adding machinery but not editing existing machines.');
      const result=wasEdit?await api('asset-update',{...payload,assetId:editingAssetId}):await api('asset-add',payload);
      const saved=result.asset;if(!saved)throw new Error('The R&M service did not confirm the machinery record.');
      closeOverlay('assetOverlay');editingAssetId=null;editingAssetRecord=null;
      if(fromSettings){
        settingsSelectedAssetId=saved.id;
        await refreshMachineConfiguration();
        if(dashboardWasVisible)await syncDashboardAssetsAfterSettings(saved.id);
        say(wasEdit?'Machine details updated.':'Machine registered successfully.','machineSettingsModalStatus','ok');
      }else{
        await loadMachine(currentMachine.key);
        if(saved.status==='ACTIVE'){ $('machineAssetSelect').value=saved.id; await selectMachineAsset(saved.id); }
        say(wasEdit?'Machine details updated.':'Machine registered successfully.','dashboardStatus','ok');
      }
    }catch(error){say(error.message,assetEditorFromSettings?'machineSettingsModalStatus':'assetStatus','error')}
    finally{button.disabled=false;button.textContent=editingAssetId?'SAVE CHANGES':'ADD MACHINERY'}
  }
  async function archiveCurrentAsset(){
    const asset=editingAssetRecord;
    if(!currentMachine||!asset||access?.canManageRepairMaintenanceMachinery!==true)return;
    if(!window.confirm('Archive “'+asset.name+'”? Its fault history and evidence will be retained, but new faults cannot be added.'))return;
    const button=$('archiveAssetButton');button.disabled=true;button.textContent='ARCHIVING…';
    try{
      await api('asset-archive',{machineType:currentMachine.key,assetId:asset.id});
      const fromSettings=assetEditorFromSettings,dashboardWasVisible=assetEditorDashboardVisible;
      closeOverlay('assetOverlay');editingAssetId=null;editingAssetRecord=null;
      if(fromSettings){
        settingsSelectedAssetId='';
        await refreshMachineConfiguration();
        if(dashboardWasVisible)await syncDashboardAssetsAfterSettings(currentAsset?.id||'');
        say('Machine archived. Its fault history remains available.','machineSettingsModalStatus','ok');
      }else{
        say('Machine archived. Its fault history remains available.','dashboardStatus','ok');
        await loadMachine(currentMachine.key);
      }
    }catch(error){say(error.message,assetEditorFromSettings?'machineSettingsModalStatus':'assetStatus','error')}
    finally{button.disabled=false;button.textContent='ARCHIVE MACHINE'}
  }
  async function readFile(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(new Error('Unable to read selected file.'));reader.onload=()=>resolve(String(reader.result||''));reader.readAsDataURL(file)})}
  async function uploadFile(faultId,file,kind){
    if(!file)return;
    if(file.size>4*1024*1024)throw new Error('File exceeds the 4 MB limit.');
    const dataUrl=await readFile(file);
    return api('upload',{faultId,filename:file.name,mimeType:file.type,kind,dataUrl});
  }
  async function createFault(event){
    event.preventDefault();if(busy||!currentMachine||!currentAsset||unassignedMode||currentAsset.status!=='ACTIVE')return;
    const preset=selectedPreset(),description=$('newFaultDescription').value.trim(),otherArea=$('newFaultOther').value.trim();
    if(!preset){say('Select an area / part of machinery.','dashboardStatus','error');return}
    if(preset.is_other&&!otherArea){say('Enter the machinery area or part.','dashboardStatus','error');$('newFaultOther').focus();return}
    if(!description)return;
    const button=$('createFaultSave');button.disabled=true;button.textContent='SAVING…';
    try{
      const result=await api('create',{machineType:currentMachine.key,assetId:currentAsset.id,presetId:preset.id,otherArea,description,priority:$('newFaultPriority').value});
      const photo=$('newFaultPhoto').files?.[0];
      if(photo){try{await uploadFile(result.fault.id,photo,'PHOTO')}catch(error){say(`Fault saved, but photo upload failed: ${error.message}`,'dashboardStatus','error')}}
      $('createForm').reset();renderPresetSelect();closeOverlay('createOverlay');await reloadCurrentRegister();say('Fault / defect created successfully.','dashboardStatus','ok');
    }catch(error){say(error.message,'dashboardStatus','error')}
    finally{button.disabled=false;button.textContent='CREATE FAULT'}
  }
  function renderPresetManager(){
    const host=$('presetItems');if(!host)return;host.replaceChildren();
    if(!machinePresets.length){const empty=document.createElement('p');empty.className='empty';empty.textContent='No presets configured for this machine.';host.appendChild(empty);return}
    machinePresets.forEach(preset=>{
      const row=document.createElement('div');row.className='preset-row';
      const name=document.createElement('strong');name.textContent=preset.name;row.appendChild(name);
      if(preset.is_other){const fixed=document.createElement('small');fixed.textContent='DEFAULT · REQUIRED';row.appendChild(fixed)}
      else{const remove=document.createElement('button');remove.type='button';remove.className='btn danger compact';remove.textContent='REMOVE';remove.addEventListener('click',()=>removeMachinePreset(preset));row.appendChild(remove)}
      host.appendChild(row);
    });
  }
  async function openPresetManager(){
    if(!currentMachine||access?.canManageRepairMaintenancePresets!==true)return;
    try{
      await Promise.all([refreshMachinePresets(),refreshMachineConfiguration()]);
      $('presetMachineTitle').textContent=currentMachine.label;showOverlay('presetsOverlay');
    }catch(error){say(error.message,'dashboardStatus','error')}
  }
  async function addMachinePreset(event){
    event.preventDefault();if(busy||!currentMachine)return;
    const name=$('newPresetName').value.trim();if(!name)return;
    const button=$('addPresetSave');button.disabled=true;button.textContent='SAVING…';
    try{await api('preset-add',{machineType:currentMachine.key,name});$('newPresetName').value='';await refreshMachinePresets();say('Machine preset added.',machineSettingsStatusTarget(),'ok')}
    catch(error){say(error.message,machineSettingsStatusTarget(),'error')}
    finally{button.disabled=false;button.textContent='ADD PRESET'}
  }
  async function removeMachinePreset(preset){
    if(!currentMachine||!preset||preset.is_other)return;
    if(!window.confirm(`Remove “${preset.name}” from ${currentMachine.label}? Existing fault records will be retained.`))return;
    try{await api('preset-delete',{machineType:currentMachine.key,presetId:preset.id});await refreshMachinePresets();say('Machine preset removed. Existing fault records were not changed.',machineSettingsStatusTarget(),'ok')}
    catch(error){say(error.message,machineSettingsStatusTarget(),'error')}
  }
  async function openDetails(id,number){
    try{
      const result=await api('get',{faultId:id});currentFault=result.fault;currentFault.displayNumber=number;
      $('detailNumber').textContent=String(number).padStart(2,'0');$('detailName').textContent=currentFault.fault_name;$('detailMachine').textContent=currentAsset?(currentAsset.asset_code?currentAsset.asset_code+' · ':'')+currentAsset.name:(unassignedMode?'UNASSIGNED / LEGACY FAULTS':machine(currentFault.machine_type).label);
      $('detailDescription').textContent=currentFault.description;const statusSelect=$('detailStatus');statusSelect.querySelectorAll('option[data-legacy="true"]').forEach(option=>option.remove());if(![...statusSelect.options].some(option=>option.value===currentFault.status)){const legacyStatus=document.createElement('option');legacyStatus.value=currentFault.status;legacyStatus.textContent=currentFault.status;legacyStatus.dataset.legacy='true';statusSelect.appendChild(legacyStatus)}statusSelect.value=currentFault.status;$('detailPriority').value=currentFault.priority;clearStatus('detailUpdateStatus');
      renderDetailPriority();renderEvidence(result.attachments||[]);renderNotes(result.notes||[]);
      const editable=access.canEditRepairMaintenance===true;
      ['detailStatus','detailPriority','updateFault','toggleNoteComposer','detailAddNote','attachFile','addPhoto'].forEach(id=>{const e=$(id);if(e)e.disabled=!editable});
      $('deleteFault').hidden=access.canDeleteRepairMaintenance!==true;
      showOverlay('detailsOverlay');
    }catch(error){say(error.message,'dashboardStatus','error')}
  }
  function renderDetailPriority(){const v=$('detailPriority').value;$('detailPriorityText').textContent=v;$('detailPriorityTag').style.borderColor=v==='HIGH'?'#ff2028':v==='MEDIUM'?'#ffd21a':'#aab5c0';}
  function renderEvidence(items){
    const photos=items.filter(x=>x.kind==='PHOTO'),files=items.filter(x=>x.kind!=='PHOTO');$('photoCount').textContent=photos.length;$('fileCount').textContent=files.length;
    $('photoItems').innerHTML=photos.map(x=>`<a href="${safe(x.signedUrl)}" target="_blank" rel="noopener"><img class="photo-thumb" src="${safe(x.signedUrl)}" alt="${safe(x.filename)}"></a>`).join('');
    $('fileItems').innerHTML=files.map(x=>`<a class="file-chip" href="${safe(x.signedUrl)}" target="_blank" rel="noopener">📎 ${safe(x.filename)}</a>`).join('');
  }
  function renderNotes(notes){$('notesList').innerHTML=notes.length?notes.map(n=>`<div class="note-item">${safe(n.note)}<small>${safe(n.created_by)} · ${safe(new Date(n.created_at).toLocaleString('en-GB'))}</small></div>`).join(''):'<div class="empty" style="padding:12px">No notes recorded.</div>'}
  async function refreshDetails(){if(!currentFault)return;const result=await api('get',{faultId:currentFault.id});currentFault=result.fault;renderEvidence(result.attachments||[]);renderNotes(result.notes||[]);}
  async function updateFault(){if(!currentFault||busy)return;const button=$('updateFault'),status=$('detailStatus').value,priority=$('detailPriority').value;button.disabled=true;button.textContent='SAVING…';clearStatus('detailUpdateStatus');say('Saving fault updates…','detailUpdateStatus');try{const result=await api('update',{faultId:currentFault.id,status,priority});if(!result.fault)throw new Error('The R&M service did not confirm that the fault was updated.');currentFault=result.fault;closeOverlay('detailsOverlay');await reloadCurrentRegister();say('Fault / defect updated.','dashboardStatus','ok')}catch(error){say(error.message,'detailUpdateStatus','error');say(error.message,'dashboardStatus','error')}finally{button.disabled=false;button.textContent='✓ UPDATE';renderDetailPriority()}}
  function startNote(){if(!currentFault)return;$('noteComposer').classList.add('open');$('noteText').focus()}
  async function saveNote(){const note=$('noteText').value.trim();if(!currentFault||!note)return;const button=$('saveNote');button.disabled=true;try{await api('note-add',{faultId:currentFault.id,note});$('noteText').value='';$('noteComposer').classList.remove('open');await refreshDetails()}catch(error){say(error.message,'dashboardStatus','error')}finally{button.disabled=false}}
  async function doUpload(file,kind){if(!currentFault||!file)return;const button=kind==='PHOTO'?$('addPhoto'):$('attachFile');button.disabled=true;try{await uploadFile(currentFault.id,file,kind);await refreshDetails();say(`${kind==='PHOTO'?'Photo':'File'} attached successfully.`,'dashboardStatus','ok')}catch(error){say(error.message,'dashboardStatus','error')}finally{button.disabled=false;$('photoInput').value='';$('fileInput').value=''}}
  async function deleteFault(){if(!currentFault||busy)return;if(!window.confirm(`Mark “${currentFault.fault_name}” as solved and permanently delete it? Its fault record, notes, photos and attached files will be deleted. This action cannot be undone.`))return;const button=$('deleteFault');button.disabled=true;button.textContent='DELETING…';try{const result=await api('delete',{faultId:currentFault.id});if(result?.ok!==true)throw new Error('The R&M service did not confirm that the fault was deleted.');closeOverlay('detailsOverlay');await reloadCurrentRegister();say('Fault / defect solved and permanently deleted, including its notes and attachments.','dashboardStatus','ok')}catch(error){say(error.message,'dashboardStatus','error')}finally{button.disabled=false;button.textContent='✓ SOLVED'}}
  async function populateAssetFilter(typeId,assetId,includeUnassigned=false){
    const typeSelect=$(typeId),assetSelect=$(assetId);if(!typeSelect||!assetSelect)return;
    const machineType=typeSelect.value||'';
    const previous=assetSelect.value;assetSelect.replaceChildren();
    const all=document.createElement('option');all.value='';all.textContent='ALL MACHINES IN CATEGORY';assetSelect.appendChild(all);
    if(!machineType){assetSelect.disabled=true;return}
    assetSelect.disabled=false;
    try{
      const result=await api('asset-list',{machineType});
      (result.assets||[]).forEach(asset=>{
        const option=document.createElement('option');option.value=asset.id;
        option.textContent=[asset.asset_code,asset.name,asset.status==='ARCHIVED'?'ARCHIVED':null].filter(Boolean).join(' · ');
        assetSelect.appendChild(option);
      });
      if(includeUnassigned&&Number(result.unassignedCount)>0){const option=document.createElement('option');option.value='__UNASSIGNED__';option.textContent='UNASSIGNED / LEGACY FAULTS';assetSelect.appendChild(option)}
      if([...assetSelect.options].some(option=>option.value===previous))assetSelect.value=previous;
    }catch(error){say(error.message,'dashboardStatus','error')}
  }
  function openReportGenerator(){
    if(access?.canExportRepairMaintenanceReports!==true||access?.canReadRepairMaintenanceMachinery!==true){say('R&M PDF reports require both export permission and R&M MACHINERY READ access.','dashboardStatus','error');return}
    $('reportMachineType').value=currentMachine?.key||'';
    $('reportAssetId').value='';
    showOverlay('reportOverlay');
    if(currentMachine){
      populateAssetFilter('reportMachineType','reportAssetId',true).then(()=>{
        $('reportAssetId').value=unassignedMode?'__UNASSIGNED__':(currentAsset?.id||'');
      });
    }else populateAssetFilter('reportMachineType','reportAssetId',true);
  }
  function reportDate(value){const d=new Date(value);return Number.isNaN(d.getTime())?'—':d.toLocaleString('en-GB')}
  function reportFileSize(value){const n=Number(value)||0;return n>=1048576?(n/1048576).toFixed(1)+' MB':Math.max(1,Math.ceil(n/1024))+' KB'}
  function renderPdfExports(reports){const host=$('pdfExportList');reports.forEach(report=>{const row=document.createElement('article');row.className='pdf-export-row';const main=document.createElement('div');main.className='pdf-export-main';const name=document.createElement('strong');name.className='pdf-export-name';name.textContent=report.file_name||'R&M PDF REPORT';main.appendChild(name);const meta=document.createElement('span');meta.className='pdf-export-meta';meta.textContent=(report.asset_name|| (report.machine_type?machine(report.machine_type).label:'ALL MACHINERY'))+' · '+(Number(report.record_count)||0)+' record(s) · '+reportDate(report.created_at)+' · '+reportFileSize(report.file_size_bytes);main.appendChild(meta);const actions=document.createElement('div');actions.className='pdf-export-actions';[['display','DISPLAY','btn'],['print','PRINT','btn'],['delete','DELETE','btn delete-export']].forEach(([action,label,cls])=>{if(action==='delete'&&access?.canDeleteRepairMaintenance!==true)return;const b=document.createElement('button');b.type='button';b.className=cls;b.textContent=label;b.addEventListener('click',()=>action==='delete'?deletePdfExport(report):openPdfExport(report,action));actions.appendChild(b)});row.append(main,actions);host.appendChild(row)})}
  async function loadPdfExports(reset=true){if(exportsLoading)return;exportsLoading=true;const host=$('pdfExportList'),more=$('loadMoreExports');if(reset){exportOffset=0;host.replaceChildren();const loading=document.createElement('div');loading.className='empty';loading.textContent='Loading PDF exports…';host.appendChild(loading);more.hidden=true}try{const result=await api('export-list',{machineType:$('pdfExportsMachineType').value||'',assetId:$('pdfExportsAssetId').value||'',offset:exportOffset});const reports=Array.isArray(result.reports)?result.reports:[];if(reset)host.replaceChildren();renderPdfExports(reports);exportOffset+=reports.length;more.hidden=result.hasMore!==true;if(reset&&!reports.length){const empty=document.createElement('div');empty.className='empty';empty.textContent='No PDF exports found for this machinery filter.';host.appendChild(empty)}}catch(error){if(reset){host.replaceChildren();const e=document.createElement('div');e.className='empty';e.textContent=error.message;host.appendChild(e)}say(error.message,'dashboardStatus','error')}finally{exportsLoading=false}}
  function openReports(){if(access?.canExportRepairMaintenanceReports!==true||access?.canReadRepairMaintenanceMachinery!==true){say('R&M PDF reports require both export permission and R&M MACHINERY READ access.','dashboardStatus','error');return}$('pdfExportsMachineType').value='';$('pdfExportsAssetId').value='';showOverlay('exportsOverlay');populateAssetFilter('pdfExportsMachineType','pdfExportsAssetId').then(()=>loadPdfExports(true))}
  async function openPdfExport(report,mode){const popup=window.open('about:blank','_blank');if(!popup){say('Allow pop-ups to open the selected PDF export.','dashboardStatus','error');return}popup.document.write('<!doctype html><title>Opening PDF export</title><p style="font:15px Arial;padding:28px">Opening stored R&amp;M PDF…</p>');try{const r=await api('export-url',{reportId:report.id});if(mode==='print')popup.addEventListener('load',()=>{try{popup.focus();popup.print()}catch{}},{once:true});popup.location.replace(r.signedUrl)}catch(error){popup.close();say(error.message,'dashboardStatus','error')}}
  async function deletePdfExport(report){if(access?.canDeleteRepairMaintenance!==true){say('Only R&M edit accounts can delete PDF exports.','dashboardStatus','error');return}if(!window.confirm('Delete “'+report.file_name+'” from PDF EXPORTS? This cannot be undone.'))return;try{await api('export-delete',{reportId:report.id});say('PDF export deleted.','dashboardStatus','ok');await loadPdfExports(true)}catch(error){say(error.message,'dashboardStatus','error')}}
  async function generatePdfReport(){if(access?.canExportRepairMaintenanceReports!==true||access?.canReadRepairMaintenanceMachinery!==true){say('R&M PDF reports require both export permission and R&M MACHINERY READ access.','dashboardStatus','error');return}const b=$('generatePdfReport'),machineType=$('reportMachineType').value||'',assetChoice=$('reportAssetId').value||'';const filters=machineType?{machineType}:{};if(assetChoice==='__UNASSIGNED__')filters.unassigned=true;else if(assetChoice)filters.assetId=assetChoice;b.disabled=true;b.textContent='CREATING PDF…';try{const r=await api('export-create',filters,90000);closeOverlay('reportOverlay');$('pdfExportsMachineType').value=machineType;$('pdfExportsAssetId').value=assetChoice&&!assetChoice.startsWith('__')?assetChoice:'';say('PDF report saved to PDF EXPORTS · '+(r.report?.file_name||'Report created'),'dashboardStatus','ok');showOverlay('exportsOverlay');await populateAssetFilter('pdfExportsMachineType','pdfExportsAssetId').then(()=>{$('pdfExportsAssetId').value=$('reportAssetId').value==='__UNASSIGNED__'?'':$('reportAssetId').value});await loadPdfExports(true)}catch(error){say(error.message,'dashboardStatus','error')}finally{b.disabled=false;b.textContent='GENERATE PDF REPORT'}}
  function applyPermissions(){
    const edit=access.canEditRepairMaintenance===true,del=access.canDeleteRepairMaintenance===true,machineRead=access.canReadRepairMaintenanceMachinery===true,exp=access.canExportRepairMaintenanceReports===true&&machineRead;
    ['updateFault','toggleNoteComposer','detailAddNote','attachFile','addPhoto'].forEach(id=>{const e=$(id);if(e)e.disabled=!edit});
    const canCreate=(access.canCreateRepairMaintenance===true||edit)&&!unassignedMode&&currentAsset?.status==='ACTIVE';
    $('openCreateFault').hidden=!canCreate;$('openCreateFault').disabled=!canCreate;
    $('deleteFault').hidden=!del;$('openReports').hidden=!exp;$('exportReportButton').hidden=!exp;$('pdfExportsButton').hidden=!exp;
    $('openRmsSettingsShortcut').hidden=!canOpenMachineryConfiguration();
    $('openSettingsWorkspace').hidden=!canOpenMachineryConfiguration();
    renderSettingsAssetManager();
  }
  async function init(){
    const session=window.DowntimeCentral?.session;
    if(!session?.token){$('loadingView').hidden=true;document.querySelector('.frame').hidden=true;$('accessDenied').classList.add('show');$('accessDeniedMessage').textContent='No active YARD HUB session. Open R&M from YARD HUB after signing in.';return}
    try{
      const result=await api('access');access=result.permissions||{};
      if(!access.canAccessYardHub||!access.canAccessRepairMaintenance)throw new Error('This account does not have access to YARD HUB · R&M. Contact an administrator.');
      $('sessionUser').textContent=String(result.user?.displayName||result.user?.username||'AUTHENTICATED USER').toUpperCase();
      applyPermissions();$('loadingView').hidden=true;renderSelector();
    }catch(error){$('loadingView').hidden=true;document.querySelector('.frame').hidden=true;$('accessDenied').classList.add('show');$('accessDeniedMessage').textContent=error.message;}
  }
  document.addEventListener('DOMContentLoaded',()=>{
    $('retrySession')?.addEventListener('click',()=>{document.querySelector('.frame').hidden=false;$('accessDenied').classList.remove('show');$('loadingView').hidden=false;init()});
    document.querySelectorAll('#machineGrid .machine-card[data-machine]').forEach(button=>button.addEventListener('click',()=>loadMachine(button.dataset.machine)));
    $('openRmsSettingsShortcut')?.addEventListener('click',()=>{if(canOpenMachineryConfiguration()){if(currentMachine)openMachineSettings(currentMachine.key);else renderSettingsSelector()}});
    $('openSettingsWorkspace')?.addEventListener('click',renderSettingsSelector);
    $('backToMachineryFromSettings')?.addEventListener('click',renderSelector);
    $('backFromCustomCategory')?.addEventListener('click',renderSelector);
    window.addEventListener('yard-hub:application-structure',event=>applyMachineCategoryConfig(event.detail?.repairMaintenanceCategories?.categories));
    document.querySelectorAll('#settingsMachineGrid .machine-card[data-settings-machine]').forEach(button=>button.addEventListener('click',()=>openMachineSettings(button.dataset.settingsMachine)));
    $('machineAssetSelect')?.addEventListener('change',event=>selectMachineAsset(event.target.value));
    document.querySelectorAll('[data-rms-tab]').forEach(button=>button.addEventListener('click',()=>setRmsSettingsTab(button.dataset.rmsTab)));
    $('settingsAddMachineryButton')?.addEventListener('click',()=>openAssetEditor());
    $('assetForm')?.addEventListener('submit',saveAsset);
    $('assetMakeModelSelect')?.addEventListener('change',()=>{$('assetMakeModelOtherField').hidden=$('assetMakeModelSelect').value!=='__CUSTOM__';if(!$('assetMakeModelOtherField').hidden)$('assetMakeModelOther').focus()});
    $('archiveAssetButton')?.addEventListener('click',archiveCurrentAsset);
    $('modelDropdownEnabled')?.addEventListener('change',handleModelDropdownDraftChange);
    $('registrationEnabled')?.addEventListener('change',handleRegistrationDraftChange);
    $('saveRegistrationSettings')?.addEventListener('click',saveRegistrationSetting);
    
    $('saveModelDropdownSettings')?.addEventListener('click',saveModelDropdownSetting);
    $('assetSelectorEnabled')?.addEventListener('change',handleAssetSelectorDraftChange);
    $('saveAssetSelectorSettings')?.addEventListener('click',saveAssetSelectorSetting);
    $('sortSelect').addEventListener('change',renderRows);
    $('backToMachinery').addEventListener('click',renderSelector);$('backToHub').addEventListener('click',()=>{window.location.assign('index.html')});
    $('openCreateFault').addEventListener('click',()=>{if(currentMachine&&currentAsset&&currentAsset.status==='ACTIVE'&&!unassignedMode){renderPresetSelect();showOverlay('createOverlay')}});$('createForm').addEventListener('submit',createFault);
    $('newFaultName').addEventListener('change',setOtherAreaVisibility);$('presetAddForm').addEventListener('submit',addMachinePreset);
    $('updateFault').addEventListener('click',updateFault);$('detailPriority').addEventListener('change',renderDetailPriority);
    $('toggleNoteComposer').addEventListener('click',startNote);$('detailAddNote')?.addEventListener('click',startNote);$('saveNote').addEventListener('click',saveNote);$('cancelNote').addEventListener('click',()=>$('noteComposer').classList.remove('open'));
    $('addPhoto').addEventListener('click',()=>$('photoInput').click());$('photoInput').addEventListener('change',e=>doUpload(e.target.files?.[0],'PHOTO'));
    $('attachFile')?.addEventListener('click',()=>$('fileInput').click());$('fileInput').addEventListener('change',e=>doUpload(e.target.files?.[0],'FILE'));
    $('deleteFault').addEventListener('click',deleteFault);
    $('openReports').addEventListener('click',openReports);$('pdfExportsButton').addEventListener('click',openReports);$('exportReportButton').addEventListener('click',openReportGenerator);$('generatePdfReport').addEventListener('click',generatePdfReport);$('pdfExportsMachineType').addEventListener('change',()=>populateAssetFilter('pdfExportsMachineType','pdfExportsAssetId').then(()=>loadPdfExports(true)));$('pdfExportsAssetId').addEventListener('change',()=>loadPdfExports(true));$('reportMachineType').addEventListener('change',()=>populateAssetFilter('reportMachineType','reportAssetId',true));$('loadMoreExports').addEventListener('click',()=>loadPdfExports(false));
    document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>closeOverlay(button.dataset.close)));
    document.querySelectorAll('.overlay').forEach(overlay=>overlay.addEventListener('click',e=>{if(e.target===overlay)closeOverlay(overlay.id)}));
    init();
  });
})();
