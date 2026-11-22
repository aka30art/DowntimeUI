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

  await page.locator('[name="entry-area"]').fill("Production");
  await page.locator('[name="entry-station"]').selectOption({label:"Line 1"});
  await page.locator('[name="entry-reason"]').fill("Mechanical fault");
  await page.locator('[name="entry-hours"]').fill("0");
  await page.locator('[name="entry-minutes"]').fill("30");
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
  await page.locator('[data-step="4"]').click();
  await page.getByRole("heading",{name:"Operating schedule"}).waitFor();
  await page.locator('[data-path="schedule.shifts.0.start"]').fill("07:00");
  await page.locator('[data-action="save-exit"]').click();
  await page.getByRole("heading",{name:"Workspace configured."}).waitFor();
  await page.locator('[data-action="open-preview"]').click();
  await page.locator(".workspace-daystrip [data-day]").first().click();
  assert.match(await page.locator(".workspace-root").innerText(),/07:00/,"Settings changes must persist to the installed workspace.");

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
  await page.screenshot({path:"artifacts/workspace-mobile.png",fullPage:true});
  assert.deepEqual(failures,[],"Browser runtime errors: "+failures.join(" | "));
  console.log("PASS: Chromium installer, daily operations, plant overview, task-lock persistence, reports, Settings edits, backup/restore and 390px mobile layout");
}finally{
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
