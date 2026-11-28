import assert from "node:assert/strict";
import http from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const root=path.resolve(".");
const mime={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".json":"application/json; charset=utf-8"};
const server=http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url||"/","http://127.0.0.1");
    const pathname=decodeURIComponent(url.pathname==="/" ? "/index.html":url.pathname);
    const file=path.resolve(root,"."+pathname);
    if(!file.startsWith(root+path.sep)&&file!==root)throw new Error("Path outside workspace");
    const body=await readFile(file);
    res.writeHead(200,{"Content-Type":mime[path.extname(file)]||"application/octet-stream","Cache-Control":"no-store"});
    res.end(body);
  }catch{
    res.writeHead(404,{"Content-Type":"text/plain"});res.end("Not found");
  }
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const address=server.address();
const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
const failures=[];
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
  page.on("pageerror",error=>failures.push(error.message));
  await page.goto("http://127.0.0.1:"+address.port,{waitUntil:"networkidle"});
  assert.match(await page.title(),/DOWNTIMEUI/);
  await page.getByRole("heading",{name:"Set up your workspace."}).waitFor();

  await page.locator('[data-action="next"]').click();
  await page.locator('[data-path="identity.companyName"]').fill("Browser QA Company");
  await page.locator('[data-path="identity.timezone"]').fill("Europe/London");
  await page.locator('[data-action="next"]').click();

  await page.locator('[data-path="site.siteName"]').fill("QA Test Site");
  await page.locator('[data-action="add-area"]').click();
  await page.locator('[data-path="site.areas.0.name"]').fill("Production");
  await page.locator('[data-action="add-station"]').click();
  await page.locator('[data-path="site.stations.0.name"]').fill("Line 1");
  await page.locator('[data-path="site.stations.0.areaId"]').selectOption({label:"Production"});
  await page.locator('[data-action="next"]').click();

  await page.locator('[data-action="add-reason"]').click();
  await page.locator('[data-path="downtime.reasons.0.name"]').fill("Mechanical fault");
  await page.locator('[data-action="add-preset"]').click();
  await page.locator('[data-path="downtime.presets.0.name"]').fill("Line 1 mechanical");
  await page.locator('[data-path="downtime.presets.0.areaId"]').selectOption({label:"Production"});
  await page.locator('[data-path="downtime.presets.0.stationId"]').selectOption({label:"Line 1"});
  await page.locator('[data-path="downtime.presets.0.reasonId"]').selectOption({label:"Mechanical fault"});
  await page.locator('[data-path="downtime.presets.0.defaultDurationMinutes"]').fill("30");
  await page.locator('[data-action="next"]').click();

  for(const day of ["mon","tue","wed","thu","fri","sat","sun"]){
    const checkbox=page.locator('[data-day="'+day+'"]');
    if(!(await checkbox.isChecked()))await checkbox.check();
  }
  await page.locator('[data-action="add-shift"]').click();
  await page.locator('[data-path="schedule.shifts.0.name"]').fill("Day shift");
  await page.locator('[data-path="schedule.shifts.0.start"]').fill("06:30");
  await page.locator('[data-path="schedule.shifts.0.end"]').fill("16:00");
  await page.locator('[data-action="add-break"]').click();
  await page.locator('[data-path="schedule.breaks.0.name"]').fill("Meal break");
  await page.locator('[data-path="schedule.breaks.0.start"]').fill("12:00");
  await page.locator('[data-path="schedule.breaks.0.end"]').fill("12:30");
  await page.locator('[data-action="next"]').click();

  await page.locator('[data-action="add-staff"]').click();
  await page.locator('[data-path="staff.0.name"]').fill("Operator One");
  const photoBase64=await page.evaluate(()=>{
    const canvas=document.createElement("canvas");canvas.width=48;canvas.height=48;
    const context=canvas.getContext("2d");context.fillStyle="#d8a800";context.fillRect(0,0,48,48);
    context.fillStyle="#172b38";context.beginPath();context.arc(24,17,9,0,Math.PI*2);context.fill();
    context.fillRect(9,29,30,16);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await page.locator('[data-staff-photo="0"]').setInputFiles({name:"operator.png",mimeType:"image/png",buffer:Buffer.from(photoBase64,"base64")});
  await page.locator(".setup-staff-preview img").waitFor();
  assert.match(await page.locator(".setup-staff-preview img").getAttribute("src"),/^data:image\/jpeg;base64,/);
  await page.locator('[data-action="next"]').click();

  await page.locator('[data-action="add-role"]').click();
  await page.locator('[data-path="roles.0.name"]').fill("Supervisor");
  await page.locator('[data-action="next"]').click();
  await page.locator('[data-goto="5"]').click();
  await page.locator('[data-path="staff.0.roleId"]').selectOption({label:"Supervisor"});
  await page.locator('[data-goto="7"]').click();

  await page.locator('[data-action="add-task"]').click();
  await page.locator('[data-path="dailyTasks.0.name"]').fill("Safety inspection");
  await page.locator('[data-action="add-task"]').click();
  await page.locator('[data-path="dailyTasks.1.name"]').fill("Equipment check");
  await page.locator('[data-action="next"]').click();

  await page.getByRole("heading",{name:"Review before installation"}).waitFor();
  assert.match(await page.locator(".setup-review").innerText(),/Browser QA Company/);
  await page.locator('[data-action="install"]').click();
  await page.getByRole("heading",{name:"Workspace configured."}).waitFor();
  await page.locator('[data-action="open-preview"]').click();

  await page.locator(".workspace-section h1").waitFor();
  assert.match(await page.locator(".workspace-root").innerText(),/LOCAL MODE · SINGLE DEVICE/);
  assert.match(await page.locator(".workspace-root").innerText(),/09h 00m/,"Configured 9h net working time should appear in the daily summary.");
  await page.locator(".workspace-daystrip [data-day]").first().click();
  await page.screenshot({path:"artifacts/workspace-desktop.png",fullPage:true});

  await page.locator("[data-shift-start]").fill("07:00");
  await page.locator("[data-shift-stop]").fill("16:00");
  await page.locator('[data-action="save-shift-times"]').click();
  assert.match(await page.locator(".workspace-metrics").innerText(),/08h 30m/,"Actual shift override must reduce net availability by the configured break overlap.");
  assert.match(await page.locator(".workspace-schedule-line").first().innerText(),/07:00–16:00 \(actual\)/);
  await page.locator('[data-action="clear-shift-times"]').click();
  assert.match(await page.locator(".workspace-metrics").innerText(),/09h 00m/,"Resetting actual shift times must restore configured schedule calculations.");

  await page.locator('[data-entry-preset]').selectOption({label:"Line 1 mechanical"});
  await page.locator('[data-action="apply-entry-preset"]').click();
  assert.equal(await page.locator('[name="entry-area"]').inputValue(),"Production");
  assert.equal(await page.locator('[name="entry-station"] option:checked').innerText(),"Line 1");
  assert.equal(await page.locator('[name="entry-reason"]').inputValue(),"Mechanical fault");
  assert.equal(await page.locator('[name="entry-minutes"]').inputValue(),"30");
  await page.locator('[data-action="save-entry"]').click();
  await page.locator(".workspace-entry-copy span").filter({hasText:"Mechanical fault"}).waitFor();
  await page.locator('[data-action="edit-entry"]').click();
  await page.locator('[name="entry-reason"]').fill("Mechanical repair");
  await page.locator('[name="entry-minutes"]').fill("45");
  await page.locator('[data-action="save-entry"]').click();
  await page.locator(".workspace-entry-copy span").filter({hasText:"Mechanical repair"}).waitFor();
  await page.locator("[data-operator]").selectOption({label:"Operator One"});

  await page.locator('.workspace-navigation [data-view="plant"]').click();
  await page.locator('[data-station-status]').selectOption("down");
  await page.getByText(/1 station down/).waitFor();
  await page.locator('[data-station-operator]').selectOption({label:"Operator One"});
  const operatorCard=page.locator(".workspace-operator-card");
  assert.equal(await operatorCard.count(),1,"Plant Overview must show one card for the configured operator.");
  assert.equal(await operatorCard.locator("b").innerText(),"Operator One");
  assert.equal(await operatorCard.locator("span").innerText(),"Line 1");
  assert.equal(await operatorCard.locator("img").count(),1,"Compressed staff photo must render on the operator card.");
  await page.locator('[data-action="toggle-plant"]').click();
  await page.getByText("Site stopped",{exact:true}).waitFor();
  await page.screenshot({path:"artifacts/plant-overview-desktop.png",fullPage:true});
  await page.locator('.workspace-navigation [data-view="tasks"]').click();
  const taskChecks=page.locator("input[data-task]");
  assert.equal(await taskChecks.count(),2);
  await taskChecks.nth(0).check();
  await page.locator('[data-action="lock-tasks"]').click();
  await page.locator(".workspace-lock-banner b").waitFor();
  assert.equal(await taskChecks.nth(0).isDisabled(),true);

  await page.reload({waitUntil:"networkidle"});
  await page.locator('[data-action="open-preview"]').click();
  await page.locator(".workspace-daystrip [data-day]").first().click();
  await page.locator('.workspace-navigation [data-view="tasks"]').click();
  assert.equal(await page.locator("input[data-task]").nth(0).isDisabled(),true,"Locked checklist must remain immutable after reload.");
  assert.equal(await page.locator("input[data-task]").nth(0).isChecked(),true,"Task completion must persist after reload.");

  await page.locator('.workspace-navigation [data-view="weekly"]').click();
  await page.getByRole("heading",{name:"Weekly summary"}).waitFor();
  assert.match(await page.locator(".workspace-root").innerText(),/Mechanical repair/);
  await page.screenshot({path:"artifacts/workspace-weekly-desktop.png",fullPage:true});

  await page.locator('.workspace-navigation [data-view="reports"]').click();
  await page.locator('[data-action="generate-report"]').click();
  await page.getByText(/Week starting/).waitFor();
  assert.match(await page.locator(".workspace-root").innerText(),/Print \/ PDF/);
  assert.match(await page.locator(".workspace-root").innerText(),/00h 45m/);
  await page.locator('.workspace-navigation [data-view="daily"]').click();
  await page.locator('[data-action="delete-entry"]').click();
  assert.doesNotMatch(await page.locator(".workspace-root").innerText(),/Mechanical repair/);
  await page.locator('.workspace-navigation [data-view="reports"]').click();
  assert.match(await page.locator(".workspace-root").innerText(),/00h 45m/,"Archived report must remain unchanged after deleting the source entry.");

  await page.locator('.workspace-navigation [data-view="people"]').click();
  assert.match(await page.locator(".workspace-settings-grid").innerText(),/Supervisor/,"Settings summary should show the intended staff access role.");
  await page.locator('[data-step="4"]').click();
  await page.getByRole("heading",{name:"Operating schedule"}).waitFor();
  await page.locator('[data-path="schedule.shifts.0.start"]').fill("07:00");
  await page.locator('[data-action="save-exit"]').click();
  await page.getByRole("heading",{name:"Workspace configured."}).waitFor();
  await page.locator('[data-action="open-preview"]').click();
  await page.locator(".workspace-daystrip [data-day]").first().click();
  assert.match(await page.locator(".workspace-root").innerText(),/07:00/,"Settings changes must persist to the installed workspace.");

  await page.locator('.workspace-navigation [data-view="people"]').click();
  await page.locator('[data-step="3"]').click();
  await page.getByRole("heading",{name:"Downtime reasons and presets"}).waitFor();
  await page.locator('[data-path="downtime.presets.0.defaultDurationMinutes"]').fill("45");
  await page.locator('[data-action="save-exit"]').click();
  await page.getByRole("heading",{name:"Workspace configured."}).waitFor();
  await page.locator('[data-action="open-preview"]').click();
  await page.locator('[data-entry-preset]').selectOption({label:"Line 1 mechanical"});
  await page.locator('[data-action="apply-entry-preset"]').click();
  assert.equal(await page.locator('[name="entry-minutes"]').inputValue(),"45","Settings must allow editing an installed quick-entry preset.");

  await page.locator('.workspace-navigation [data-view="people"]').click();
  await page.getByRole("button",{name:"Export full workspace backup"}).click();
  await page.waitForTimeout(150);
  assert.deepEqual(failures,[],"Exporting a workspace backup must not raise browser errors: "+failures.join(" | "));
  const backupJson=await page.evaluate(()=>{
    const configuration=JSON.parse(localStorage.getItem("downtimeui:tenant:v1"));
    const operations=JSON.parse(localStorage.getItem("downtimeui:operations:v1:"+configuration.installationId));
    return JSON.stringify({format:"downtimeui-workspace-backup",backupVersion:1,exportedAt:new Date().toISOString(),configuration,operations},null,2);
  });
  assert.match(backupJson,/downtimeui-workspace-backup/);
  await writeFile("artifacts/workspace-backup.json",backupJson,"utf8");
  const backupObject=JSON.parse(backupJson);
  const lockedDate=Object.values(backupObject.operations.weeks).flatMap(week=>week.days).find(day=>day.dailyTasks?.lockedAt)?.date;
  assert.ok(lockedDate,"Backup fixture must contain a locked daily task snapshot.");

  await page.locator('[data-step="4"]').click();
  await page.locator('[data-path="schedule.shifts.0.start"]').fill("08:00");
  await page.locator('[data-action="save-exit"]').click();
  await page.locator('[data-action="open-preview"]').click();
  await page.locator('.workspace-navigation [data-view="people"]').click();
  page.once("dialog",dialog=>dialog.accept());
  await page.locator('[data-backup-file]').setInputFiles("artifacts/workspace-backup.json");
  await page.locator(".workspace-message").filter({hasText:"Workspace backup restored successfully"}).waitFor();
  await page.locator(".workspace-daystrip [data-day]").first().click();
  assert.match(await page.locator(".workspace-root").innerText(),/07:00/,"Restoring the backup must return the prior schedule configuration.");
  await page.locator('[data-entry-preset]').selectOption({label:"Line 1 mechanical"});
  await page.locator('[data-action="apply-entry-preset"]').click();
  assert.equal(await page.locator('[name="entry-minutes"]').inputValue(),"45","Backup restore must retain the edited quick-entry preset.");
  await page.locator('.workspace-navigation [data-view="reports"]').click();
  assert.match(await page.locator(".workspace-root").innerText(),/00h 45m/,"Restoring the backup must reinstate the archived report snapshot.");
  await page.locator('.workspace-navigation [data-view="people"]').click();
  await page.locator('[data-step="4"]').click();
  assert.equal(await page.locator('[data-path="schedule.shifts.0.start"]').inputValue(),"07:00","Installer Settings must read the restored backup configuration.");
  await page.locator('[data-action="save-exit"]').click();
  await page.locator('[data-action="open-preview"]').click();

  const cleanRestorePage=await browser.newPage({viewport:{width:1280,height:900},deviceScaleFactor:1});
  cleanRestorePage.on("pageerror",error=>failures.push(error.message));
  await cleanRestorePage.goto("http://127.0.0.1:"+address.port,{waitUntil:"networkidle"});
  await cleanRestorePage.getByRole("heading",{name:"Set up your workspace."}).waitFor();
  await cleanRestorePage.locator('[data-action="choose-restore"]').click();
  cleanRestorePage.once("dialog",dialog=>dialog.accept());
  await cleanRestorePage.locator("[data-initial-backup]").setInputFiles("artifacts/workspace-backup.json");
  await cleanRestorePage.getByRole("heading",{name:"Workspace configured."}).waitFor();
  await cleanRestorePage.locator('[data-action="open-preview"]').click();
  await cleanRestorePage.locator(".workspace-daystrip [data-day]").first().click();
  assert.match(await cleanRestorePage.locator(".workspace-root").innerText(),/07:00/,"A clean installation must be able to recover the backed-up schedule.");
  await cleanRestorePage.locator('.workspace-navigation [data-view="people"]').click();
  assert.match(await cleanRestorePage.locator(".workspace-settings-grid").innerText(),/Supervisor/,"Clean recovery must retain staff role assignment.");
  await cleanRestorePage.locator('.workspace-navigation [data-view="plant"]').click();
  await cleanRestorePage.locator(".workspace-operator-card img").waitFor();
  await cleanRestorePage.locator('.workspace-navigation [data-view="tasks"]').click();
  await cleanRestorePage.locator('.workspace-daystrip [data-day="'+lockedDate+'"]').click();
  assert.equal(await cleanRestorePage.locator("input[data-task]").nth(0).isDisabled(),true,"Backup recovery must preserve the daily task lock on the original task date.");
  await cleanRestorePage.locator('.workspace-navigation [data-view="reports"]').click();
  assert.match(await cleanRestorePage.locator(".workspace-root").innerText(),/00h 45m/,"Clean-install recovery must restore the report archive.");
  await cleanRestorePage.close();

  await page.setViewportSize({width:390,height:844});
  await page.locator('.workspace-navigation [data-view="daily"]').click();
  const mobileMetrics=await page.evaluate(()=>{
    const controls=[...document.querySelectorAll(".workspace-root input:not([type=file]),.workspace-root select,.workspace-root textarea")].map(el=>{
      const rect=el.getBoundingClientRect(),panel=el.closest(".workspace-panel,.workspace-actual-shift,.workspace-add-form")?.getBoundingClientRect();
      return {name:el.getAttribute("name")||el.getAttribute("data-shift-start")||el.getAttribute("data-shift-stop")||el.tagName,left:rect.left,right:rect.right,panelRight:panel?.right};
    });
    return {viewport:innerWidth,document:document.documentElement.scrollWidth,body:document.body.scrollWidth,controls};
  });
  assert.ok(mobileMetrics.document<=mobileMetrics.viewport+1,"Mobile layout must not overflow horizontally: "+JSON.stringify(mobileMetrics));
  assert.ok(mobileMetrics.controls.every(control=>control.right<=mobileMetrics.viewport+1&&(!control.panelRight||control.right<=control.panelRight+1)),"Mobile controls must fit their viewport and containing panels: "+JSON.stringify(mobileMetrics.controls));
  const mobileNavigation=await page.evaluate(()=>{
    const nav=document.querySelector(".workspace-navigation"),navRect=nav.getBoundingClientRect();
    const buttons=[...nav.querySelectorAll(".workspace-nav")].map(el=>{const r=el.getBoundingClientRect();return {label:el.textContent.trim(),left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,scrollWidth:el.scrollWidth,clientWidth:el.clientWidth,scrollHeight:el.scrollHeight,clientHeight:el.clientHeight};});
    return {viewport:innerWidth,nav:{left:navRect.left,right:navRect.right},buttons};
  });
  assert.equal(mobileNavigation.buttons.length,6,"Mobile navigation must expose all six destinations.");
  assert.ok(mobileNavigation.buttons.every(button=>button.left>=0&&button.right<=mobileNavigation.viewport+1&&button.width>0&&button.scrollWidth<=button.clientWidth+1&&button.scrollHeight<=button.clientHeight+1),"Mobile navigation labels must remain visible, un-clipped and inside the viewport: "+JSON.stringify(mobileNavigation));
  await page.screenshot({path:"artifacts/workspace-mobile.png",fullPage:true});
  assert.deepEqual(failures,[],"Browser runtime errors: "+failures.join(" | "));
  await page.locator('.workspace-navigation [data-view="people"]').click();
  let resetDialogIndex=0;
  page.on("dialog",async dialog=>{
    resetDialogIndex++;
    if(resetDialogIndex===2)await dialog.dismiss(); // choose NO backup; continue empty reset
    else await dialog.accept();
  });
  await page.locator('[data-action="factory-reset"]').click();
  await page.getByRole("heading",{name:"Set up your workspace."}).waitFor();
  const remainingAppKeys=await page.evaluate(()=>Object.keys(localStorage).filter(key=>key.startsWith("downtimeui:")));
  assert.deepEqual(remainingAppKeys,[],"Factory reset must remove all DOWNTIMEUI-owned local storage and return to empty installer.");
  assert.equal(resetDialogIndex,3,"WIPE OUT must require three explicit confirmation choices.");
  const yardhubPage=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});
  const yardhubRequests=[];
  const yardhubFailures=[];
  yardhubPage.on("request",request=>yardhubRequests.push(request.url()));
  yardhubPage.on("pageerror",error=>yardhubFailures.push(error.message));
  await yardhubPage.route("https://github-native.invalid/**",route=>route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({error:"Isolated browser QA: no live repository token supplied"})}));
  await yardhubPage.goto("http://127.0.0.1:"+address.port+"/yardhub/runtime/index.html",{waitUntil:"networkidle"});
  await yardhubPage.getByRole("heading",{name:"Connect YARDHUB to GitHub"}).waitFor();
  assert.equal(await yardhubPage.locator("#yardhub-github-connect-overlay").isVisible(),true,"YARDHUB must remain locked behind the private GitHub setup gate.");
  assert.equal(await yardhubPage.locator('[name="owner"]').inputValue(),"aka30art");
  assert.equal(await yardhubPage.locator('[name="repo"]').inputValue(),"");
  assert.equal(await yardhubPage.locator('[name="token"]').inputValue(),"");
  assert.equal(await yardhubPage.locator("[data-create-private]").isEnabled(),true,"First-run private repository creation must be available.");
  assert.equal(await yardhubPage.locator("#firstDevBootstrapPanel").isHidden(),true,"DEV bootstrap must remain hidden until a private database issues a one-time code.");
  assert.equal(yardhubRequests.some(url=>url.startsWith("https://github-native.invalid/")),false,"YARDHUB must wait for the private GitHub runtime before querying central login data.");
  assert.equal(yardhubRequests.some(url=>url.includes("supabase.co")),false,"The YARDHUB runtime must not call any original Supabase endpoint.");
  await yardhubPage.setViewportSize({width:390,height:844});
  const setupLayout=await yardhubPage.evaluate(()=>{
    const card=document.querySelector(".yardhub-github-connect-card").getBoundingClientRect();
    return {viewport:innerWidth,document:document.documentElement.scrollWidth,cardLeft:card.left,cardRight:card.right};
  });
  assert.ok(setupLayout.document<=setupLayout.viewport+1,"YARDHUB connection gate must not overflow mobile width: "+JSON.stringify(setupLayout));
  assert.ok(setupLayout.cardLeft>=0&&setupLayout.cardRight<=setupLayout.viewport+1,"YARDHUB connection card must fit the mobile viewport: "+JSON.stringify(setupLayout));
  await yardhubPage.screenshot({path:"artifacts/yardhub-private-setup-mobile.png",fullPage:true});

  const offlinePage=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});
  const offlineErrors=[];
  const offlineConsole=[];
  let githubApiRequests=0;
  offlinePage.on("pageerror",error=>offlineErrors.push(error.message));
  offlinePage.on("console",message=>{if(message.type()==="warning"||message.type()==="error")offlineConsole.push(message.text())});
  await offlinePage.addInitScript(()=>{
    const user={username:"DEV",displayName:"DEV ROOT",tier:"DEV",role:"DEV",userId:"dev-user-1",staffId:"dev-staff-1",rootsAuthority:"DEV",yardRolePermissions:{SCPL:{view:true,enter:true,edit:true,manage:true},Management:{view:true,enter:true,edit:true,manage:true},GATELOG:{view:true,enter:true,edit:true,manage:true},"R&M":{view:true,enter:true,edit:true,manage:true}}};
    const payload={users:[{username:"DEV",displayName:"DEV ROOT",tier:"DEV",enabled:true}],appData:{},staff:[],tiers:[]};
    const tables={downtime_central_bank:[{id:1,version:1,updated_at:"2026-11-28T00:00:00.000Z",payload}],downtime_central_sessions:[{token_hash:"cached-session-hash",username:"DEV",expires_at:"2026-11-28T01:00:00.000Z"}],downtime_daily_operator_assignments:[]};
    const authority={schemaVersion:1,systemId:"YARDHUB-ECOSYSTEM",primarySystemId:"YARDHUB-PRIMARY",secondarySystemId:"DOWNTIMEUI-GITHUB",epoch:1,status:"ACTIVE",replication:{direction:"YARDHUB-PRIMARY_TO_DOWNTIMEUI-GITHUB",status:"NOT_CONFIGURED",lastSuccessfulCheckpoint:null},updatedAt:"2026-11-28T00:00:00.000Z"};
    localStorage.setItem("yardhub:github-data-connection:v1",JSON.stringify({owner:"demo",repo:"yardhub-data",branch:"main",token:"ghp_offline_test_token"}));
    localStorage.setItem("yardhub:central-session:v1",JSON.stringify({authenticated:true,token:"offline-session-token",expiresAt:"2026-11-28T01:00:00.000Z",user}));
    localStorage.setItem("yardhub:github-cache:v1:demo:yardhub-data:YARDHUB-PRIMARY",JSON.stringify({revision:1,manifest:{schemaVersion:1,revision:1,systemId:"YARDHUB-PRIMARY"},tables,authority,headSha:"cached-head",cachedAt:"2026-11-28T00:00:00.000Z"}));
  });
  await offlinePage.route("https://api.github.com/**",route=>{githubApiRequests++;return route.abort("internetdisconnected")});
  await offlinePage.route("https://github-native.invalid/**",route=>route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({error:"Offline browser QA"})}));
  await offlinePage.goto("http://127.0.0.1:"+address.port+"/yardhub/runtime/index.html",{waitUntil:"networkidle"});
  try{
    await offlinePage.locator("#yardHubOfflineBanner").waitFor({state:"visible",timeout:15000});
  }catch{
    const status=await offlinePage.locator("[data-yardhub-github-status]").textContent().catch(()=> "");
    const auth=await offlinePage.locator("#authMsg").textContent().catch(()=> "");
    throw new Error("Offline cached bootstrap did not open YARDHUB. GitHub status: "+status+"; auth: "+auth+"; page errors: "+offlineErrors.join(" | ")+"; console: "+offlineConsole.join(" | "));
  }
  assert.equal(await offlinePage.locator("#yardHub").isVisible(),true,"A previously connected device must reopen cached YARDHUB data when GitHub is unavailable.");
  assert.match(await offlinePage.locator("#yardHubOfflineBanner").innerText(),/READ ONLY.*NOT SAVED TO GITHUB/,"Offline mode must be visibly read-only and must not claim central saves.");
  const freshInstall=await offlinePage.evaluate(()=>JSON.parse(localStorage.getItem("plantDowntime.v1")||"{}"));
  assert.deepEqual(freshInstall.areas,[],"A fresh install must not import plant checkpoints.");
  assert.deepEqual(freshInstall.reasons,[],"A fresh install must not import reason presets.");
  assert.deepEqual(freshInstall.staffRoster,[],"A fresh install must not import staff.");
  assert.deepEqual(freshInstall.stationConfig,[],"A fresh install must not import station presets.");
  assert.deepEqual(freshInstall.dailyTaskPresets,[],"A fresh install must not import task presets.");
  assert.deepEqual(freshInstall.operatorProfiles,{},"A fresh install must not import operator profiles.");
  const requestsBeforeOfflineRefresh=githubApiRequests;
  await offlinePage.locator("#yardHubRefreshBtn").click();
  assert.match(await offlinePage.locator("#cloudStatus").textContent(),/REFRESH UNAVAILABLE/,"Manual refresh must report unavailable while offline.");
  assert.equal(githubApiRequests,requestsBeforeOfflineRefresh,"Offline refresh must not issue a GitHub request or claim a successful sync.");
  assert.deepEqual(offlineErrors,[],"Offline cached runtime errors: "+offlineErrors.join(" | "));
  await offlinePage.screenshot({path:"artifacts/yardhub-offline-readonly.png",fullPage:true});
  await offlinePage.close();

  const invalidAuthPage=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});
  let invalidRepoChecks=0,invalidRefChecks=0;
  await invalidAuthPage.addInitScript(()=>{
    const user={username:"DEV",displayName:"DEV ROOT",tier:"DEV",role:"DEV",userId:"dev-user-1"};
    const payload={users:[{username:"DEV",displayName:"DEV ROOT",tier:"DEV",enabled:true}],appData:{},staff:[],tiers:[]};
    const tables={downtime_central_bank:[{id:1,version:1,updated_at:"2026-11-28T00:00:00.000Z",payload}],downtime_central_sessions:[],downtime_daily_operator_assignments:[]};
    const manifest={schemaVersion:1,revision:1,systemId:"YARDHUB-PRIMARY",tables:{}};
    localStorage.setItem("yardhub:github-data-connection:v1",JSON.stringify({owner:"demo",repo:"yardhub-data",branch:"main",token:"invalid-token"}));
    localStorage.setItem("yardhub:central-session:v1",JSON.stringify({authenticated:true,token:"cached-session-token",expiresAt:"2026-11-28T01:00:00.000Z",user}));
    localStorage.setItem("yardhub:github-cache:v1:demo:yardhub-data:YARDHUB-PRIMARY",JSON.stringify({revision:1,manifest,tables,authority:null,headSha:"cached-head",cachedAt:"2026-11-28T00:00:00.000Z"}));
  });
  await invalidAuthPage.route("https://api.github.com/**",route=>{
    const path=new URL(route.request().url()).pathname;
    if(path==="/repos/demo/yardhub-data"){invalidRepoChecks++;return route.fulfill({status:401,contentType:"application/json",body:JSON.stringify({message:"Bad credentials"})})}
    invalidRefChecks++;return route.abort("internetdisconnected");
  });
  await invalidAuthPage.route("https://github-native.invalid/**",route=>route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({error:"Invalid credential must not use offline compatibility"})}));
  await invalidAuthPage.goto("http://127.0.0.1:"+address.port+"/yardhub/runtime/index.html",{waitUntil:"networkidle"});
  await invalidAuthPage.locator("[data-yardhub-github-status]").waitFor({state:"visible"});
  await invalidAuthPage.waitForTimeout(250);
  assert.equal(invalidRepoChecks,1,"Saved repository credentials must be checked against GitHub.");
  assert.equal(invalidRefChecks,0,"An HTTP 401 must not be reclassified as a network outage and fall back to cached data.");
  assert.equal(await invalidAuthPage.locator("#yardhub-github-connect-overlay").isVisible(),true,"Invalid credentials must leave YARDHUB locked behind its connection gate.");
  assert.equal(await invalidAuthPage.locator("#yardHubOfflineBanner").isVisible(),false,"Invalid credentials must not be presented as genuine offline mode.");
  await invalidAuthPage.close();

  const readOnlyTokenPage=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});
  let readOnlyRepositoryChecks=0,readOnlyRefChecks=0;
  await readOnlyTokenPage.addInitScript(()=>{
    localStorage.setItem("yardhub:github-data-connection:v1",JSON.stringify({owner:"demo",repo:"yardhub-data",branch:"main",token:"read-only-token"}));
  });
  await readOnlyTokenPage.route("https://api.github.com/**",route=>{
    const path=new URL(route.request().url()).pathname;
    if(path==="/repos/demo/yardhub-data"){readOnlyRepositoryChecks++;return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({private:true,archived:false,default_branch:"main",permissions:{pull:true,push:false}})})}
    readOnlyRefChecks++;return route.abort("internetdisconnected");
  });
  await readOnlyTokenPage.route("https://github-native.invalid/**",route=>route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({error:"Read-only repository token must be rejected"})}));
  await readOnlyTokenPage.goto("http://127.0.0.1:"+address.port+"/yardhub/runtime/index.html",{waitUntil:"networkidle"});
  await readOnlyTokenPage.locator("[data-yardhub-github-status]").waitFor({state:"visible"});
  await readOnlyTokenPage.waitForTimeout(250);
  assert.equal(readOnlyRepositoryChecks,1,"YARDHUB must inspect repository write permission.");
  assert.equal(readOnlyRefChecks,0,"A read-only token must be rejected before database access.");
  assert.equal(await readOnlyTokenPage.locator("#yardhub-github-connect-overlay").isVisible(),true,"A read-only GitHub token must not unlock the operational app.");
  assert.equal(await readOnlyTokenPage.locator("#yardHubOfflineBanner").isVisible(),false,"A read-only token must not be treated as a network outage.");
  await readOnlyTokenPage.close();

  const rmPage=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1});
  const rmRequests=[];
  const rmFailures=[];
  rmPage.on("request",request=>rmRequests.push(request.url()));
  rmPage.on("pageerror",error=>rmFailures.push(error.message));
  await rmPage.route("https://github-native.invalid/**",route=>route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({error:"Isolated browser QA: no live repository token supplied"})}));
  await rmPage.goto("http://127.0.0.1:"+address.port+"/yardhub/runtime/repair-maintenance.html",{waitUntil:"networkidle"});
  await rmPage.getByRole("heading",{name:"Connect YARDHUB to GitHub"}).waitFor();
  assert.equal(await rmPage.locator("#yardhub-github-connect-overlay").isVisible(),true,"Standalone R&M must use the same private data setup gate.");
  assert.equal(rmRequests.some(url=>url.includes("supabase.co")),false,"Standalone R&M must not call the original Supabase project.");
  const rmLayout=await rmPage.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth}));
  assert.ok(rmLayout.document<=rmLayout.viewport+1,"Standalone R&M connection gate must not overflow mobile width: "+JSON.stringify(rmLayout));
  await rmPage.screenshot({path:"artifacts/yardhub-rm-setup-mobile.png",fullPage:true});
  await rmPage.close();
  await yardhubPage.close();
  assert.deepEqual(yardhubFailures,[],"YARDHUB browser runtime errors: "+yardhubFailures.join(" | "));
  assert.deepEqual(rmFailures,[],"Standalone R&M browser runtime errors: "+rmFailures.join(" | "));
  console.log("PASS: Chromium installer, daily operations, plant overview, task-lock persistence, reports, Settings edits, backup/restore, 390px mobile layout and WIPE OUT reset, YARDHUB private setup gate, offline cached read-only mode, standalone R&M lock and mobile layout");
}finally{
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
